import { activeDefenseState } from "./state.js";

import {
    queueAttackOperation,
    recreateOffenseAfterSplinterpoint,
    resolveLatestOffenseMessage,
    resolveRootOffenseMessage,
} from "./recalculation.js";

import {
    defenseAllowsModification,
} from "./phase.js";

import { services } from "../../core/services.js";

import {
    isOffensiveCombatMessage,
} from "../../combat-rules.js";

import {
    MODULE_ID,
    SOCKET,
} from "../../core/constants.js";

import { getApplicableCombat } from "../../core/combat-compatibility.js";

import {
    APPLICATION_STALE_AFTER_MS,
    effectiveApplicationState,
    nextApplicationRecord,
} from "../../shared/application-state.js";

import {
    localizeSystem,
    t,
} from "../../shared/values.js";

const staleSplinterpointTimers = new Map();

function primaryTargetTokenUuid(context) {
    return context?.primaryTargetTokenUuid ?? context?.targetTokenUuid ?? null;
}

function actorUuid(actor) {
    return actor?.uuid ?? (actor?.id ? `Actor.${actor.id}` : null);
}

function availableSplinterpoints(actor) {
    const value = actor?.splinterpoints?.value ?? actor?.system?.splinterpoints?.value;
    return Math.max(0, Number(value) || 0);
}

function userOwnsActor(user, actor) {
    if (!user || !actor) return false;
    if (user.isGM) return true;
    const explicitPermission = actor.testUserPermission?.(user, "OWNER");
    return Boolean(explicitPermission || (user.id === game.user?.id && actor.isOwner));
}

function combatantToken(combatant) {
    if (!combatant) return null;
    return combatant?.token?.document ?? combatant?.token ?? services.resolveCombatantToken(combatant);
}

function combatantActor(combatant) {
    const token = combatantToken(combatant);
    return token?.actor ?? combatant?.actor ?? null;
}

function isVtdAttack(message, context) {
    const defenseType = String(message?.system?.checkReport?.defenseType ?? context?.defenseType ?? "defense")
        .trim()
        .toLocaleLowerCase();
    return defenseType === "defense" || defenseType === "vtd";
}

export function getDefenseSplinterpointActions(message, user = game.user) {
    if (!message || !user || !isOffensiveCombatMessage(message)) return [];
    if (!defenseAllowsModification(message)) return [];
    const context = services.getMessageContext(message) ?? {};
    if (context.supersededBy || !isVtdAttack(message, context)) return [];
    if (!services.messageOffersActiveDefense(message) && !context.recalculatedFrom && !context.defensePhase) return [];
    const target = services.resolveToken(primaryTargetTokenUuid(context));
    const targetActor = target?.actor;
    const targetActorUuid = actorUuid(targetActor);
    if (!targetActor || !targetActorUuid) return [];

    if (!context.vtdSplinterpointActorUuid) {
        return userOwnsActor(user, targetActor)
            && availableSplinterpoints(targetActor) > 0
            && getDefenseSplinterpointApplicationStatus(message, targetActorUuid).state === "idle"
            ? [{ kind: "primary", actorUuid: targetActorUuid }]
            : [];
    }

    const appliedResonances = new Set(context.vtdSplinterpointResonanceActorUuids ?? []);
    if (appliedResonances.size > 0) return [];
    const combatants = Array.from(getApplicableCombat()?.combatants ?? []);
    const actions = [];
    const seenActors = new Set();
    for (const combatant of combatants) {
        const actor = combatantActor(combatant);
        const uuid = actorUuid(actor);
        if (!actor || !uuid || uuid === targetActorUuid || seenActors.has(uuid) || appliedResonances.has(uuid)) continue;
        seenActors.add(uuid);
        if (Number(actor.system?.experience?.heroLevel) < 3 || availableSplinterpoints(actor) < 1) continue;
        if (!userOwnsActor(user, actor)) continue;
        const controller = services.getRuntimeController(combatant);
        if (!user.isGM && controller?.id !== user.id) continue;
        if (getDefenseSplinterpointApplicationStatus(message, uuid).state !== "idle") continue;
        actions.push({ kind: "resonance", actorUuid: uuid });
    }
    return actions;
}

export async function requestDefenseSplinterpoint(message, spenderActorUuid) {
    const action = getDefenseSplinterpointActions(message, game.user)
        .find((candidate) => candidate.actorUuid === spenderActorUuid);
    if (!action) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenseSplinterpointNotAllowed"));
        return null;
    }
    if (game.user.isGM) return applyDefenseSplinterpointForUser(message, spenderActorUuid, game.user);

    const gm = services.getActivePrimaryGm();
    if (!gm) {
        ui.notifications.warn(localizeSystem("splittermond.chatCard.noGMConnected", "Kein GM verbunden."));
        return null;
    }
    game.socket.emit(SOCKET, {
        type: "apply-defense-splinterpoint",
        senderId: game.user.id,
        recipientId: gm.id,
        messageId: message.id,
        spenderActorUuid,
    });
    return true;
}

export async function applyDefenseSplinterpointForUser(message, spenderActorUuid, user) {
    if (!game.user?.isGM || !message || !user || typeof spenderActorUuid !== "string") return null;
    if (activeDefenseState.splinterpointActorLocks.has(spenderActorUuid)) return null;
    activeDefenseState.splinterpointActorLocks.add(spenderActorUuid);
    try {
        return await queueAttackOperation(message.id, async (root, original) => {
            const action = getDefenseSplinterpointActions(original, user)
                .find((candidate) => candidate.actorUuid === spenderActorUuid);
            const actor = services.resolveActorUuid(spenderActorUuid);
            const previousPoints = availableSplinterpoints(actor);
            if (!action || !actor || previousPoints < 1) return null;

            let applying = await setDefenseSplinterpointApplicationState(root, spenderActorUuid, "applying", {
                kind: action.kind,
                previousPoints,
                initiatedBy: user.id,
            });
            try {
                await actor.update({ "system.splinterpoints.value": previousPoints - 1 });
            } catch (error) {
                const state = availableSplinterpoints(actor) === previousPoints ? "idle" : "uncertain";
                await persistSplinterpointFailureState(root, spenderActorUuid, state, applying);
                throw error;
            }
            let result = null;
            try {
                result = await recreateOffenseAfterSplinterpoint(root, original, {
                    actorUuid: spenderActorUuid,
                    kind: action.kind,
                });
                if (!result) throw new Error("Defense splinterpoint produced no offense result");
            } catch (error) {
                let refunded = availableSplinterpoints(actor) === previousPoints;
                if (!refunded && availableSplinterpoints(actor) === previousPoints - 1) {
                    try {
                        await actor.update({ "system.splinterpoints.value": previousPoints });
                        refunded = availableSplinterpoints(actor) === previousPoints;
                    } catch (refundError) {
                        console.error(`${MODULE_ID} | Could not refund failed defense splinterpoint`, refundError);
                    }
                }
                const state = refunded && !error?.successorCleanupFailed ? "idle" : "uncertain";
                await persistSplinterpointFailureState(root, spenderActorUuid, state, applying);
                throw error;
            }

            try {
                applying = await setDefenseSplinterpointApplicationState(root, spenderActorUuid, "completed", {
                    resultMessageId: result.id,
                });
            } catch (error) {
                await persistSplinterpointFailureState(root, spenderActorUuid, "uncertain", applying);
                throw error;
            }

            const resultContext = services.getMessageContext(result) ?? {};
            const target = services.resolveToken(primaryTargetTokenUuid(resultContext));
            const combatant = Array.from(getApplicableCombat()?.combatants ?? [])
                .find((candidate) => actorUuid(combatantActor(candidate)) === spenderActorUuid);
            try {
                await services.createDefenseSplinterpointChatCard({
                    actor,
                    token: combatantToken(combatant),
                    targetName: target?.name ?? target?.actor?.name ?? resultContext.primaryTargetName ?? "–",
                    targetTokenUuid: target?.uuid ?? primaryTargetTokenUuid(resultContext),
                    defenseValue: Number(resultContext.defenseValue),
                    kind: action.kind,
                    attackMessageId: root.id,
                });
            } catch (error) {
                console.error(`${MODULE_ID} | Could not create defense splinterpoint chat card`, error);
                ui.notifications?.error?.(t("SMOOTHER_FIGHT.HUD.DefenseSplinterpointChatFailed"));
            }
            services.setCombatEventExpansionRequest("latest");
            services.scheduleRender(0);
            return result;
        });
    } finally {
        activeDefenseState.splinterpointActorLocks.delete(spenderActorUuid);
    }
}

export function getDefenseSplinterpointApplicationStatus(message, spenderActorUuid, now = Date.now()) {
    const root = resolveRootOffenseMessage(message?.id) ?? message;
    const records = root?.getFlag?.(MODULE_ID, "defenseSplinterpointApplications")
        ?? root?.flags?.[MODULE_ID]?.defenseSplinterpointApplications
        ?? {};
    const record = records[spenderActorUuid] ?? null;
    let state = effectiveApplicationState(record, { now });
    if (record && splinterpointEffectIsVisible(root, spenderActorUuid, record.kind)) state = "completed";
    else if (state === "completed") state = "uncertain";
    if (state === "applying") scheduleStaleSplinterpointRender(root, spenderActorUuid, record);
    return { state, record, root };
}

export function getDefenseSplinterpointRecoveries(message, user = game.user) {
    if (!user?.isGM) return [];
    const root = resolveRootOffenseMessage(message?.id) ?? message;
    const records = root?.getFlag?.(MODULE_ID, "defenseSplinterpointApplications")
        ?? root?.flags?.[MODULE_ID]?.defenseSplinterpointApplications
        ?? {};
    return Object.keys(records).map((spenderActorUuid) => ({
        spenderActorUuid,
        ...getDefenseSplinterpointApplicationStatus(root, spenderActorUuid),
    })).filter((application) => application.state === "uncertain");
}

export async function recoverDefenseSplinterpointApplication(message, spenderActorUuid, decision) {
    if (!game.user?.isGM || !["retry", "complete"].includes(decision)) return false;
    const application = getDefenseSplinterpointApplicationStatus(message, spenderActorUuid);
    if (application.state !== "uncertain") return false;
    await setDefenseSplinterpointApplicationState(
        application.root,
        spenderActorUuid,
        decision === "complete" ? "completed" : "idle",
        { recoveredBy: game.user.id }
    );
    ui.notifications.info(t(decision === "complete"
        ? "SMOOTHER_FIGHT.HUD.OperationMarkedCompleted"
        : "SMOOTHER_FIGHT.HUD.OperationReset"));
    services.scheduleRender(0);
    return true;
}

async function setDefenseSplinterpointApplicationState(root, spenderActorUuid, state, details = {}) {
    const records = root.getFlag?.(MODULE_ID, "defenseSplinterpointApplications")
        ?? root.flags?.[MODULE_ID]?.defenseSplinterpointApplications
        ?? {};
    const updated = {
        ...records,
        [spenderActorUuid]: nextApplicationRecord(records[spenderActorUuid], state, {
            spenderActorUuid,
            ...details,
        }),
    };
    await services.setRequiredFlag(root, "defenseSplinterpointApplications", updated);
    if (state !== "applying") clearStaleSplinterpointRender(`${root?.id}:${spenderActorUuid}`);
    return updated[spenderActorUuid];
}

async function persistSplinterpointFailureState(root, spenderActorUuid, state, fallback) {
    try {
        const records = root.getFlag?.(MODULE_ID, "defenseSplinterpointApplications")
            ?? root.flags?.[MODULE_ID]?.defenseSplinterpointApplications
            ?? {};
        const updated = {
            ...records,
            [spenderActorUuid]: nextApplicationRecord(records[spenderActorUuid] ?? fallback, state),
        };
        await services.setRequiredFlag(root, "defenseSplinterpointApplications", updated);
    } catch (error) {
        console.error(`${MODULE_ID} | Could not persist ${state} defense splinterpoint state`, error);
    }
}

function splinterpointEffectIsVisible(root, spenderActorUuid, kind) {
    const latest = resolveLatestOffenseMessage(root);
    const context = services.getMessageContext(latest) ?? {};
    if (kind === "resonance") return context.vtdSplinterpointResonanceActorUuids?.includes?.(spenderActorUuid);
    return context.vtdSplinterpointActorUuid === spenderActorUuid;
}

function scheduleStaleSplinterpointRender(root, spenderActorUuid, record) {
    const startedAt = Number(record?.startedAt);
    if (!Number.isFinite(startedAt)) return;
    const remaining = APPLICATION_STALE_AFTER_MS - (Date.now() - startedAt);
    const key = `${root?.id}:${spenderActorUuid}`;
    if (remaining <= 0 || staleSplinterpointTimers.has(key)) return;
    const timer = setTimeout(() => {
        staleSplinterpointTimers.delete(key);
        services.scheduleRender(0);
    }, remaining);
    timer.unref?.();
    staleSplinterpointTimers.set(key, timer);
}

function clearStaleSplinterpointRender(key) {
    const timer = staleSplinterpointTimers.get(key);
    if (timer) clearTimeout(timer);
    staleSplinterpointTimers.delete(key);
}
