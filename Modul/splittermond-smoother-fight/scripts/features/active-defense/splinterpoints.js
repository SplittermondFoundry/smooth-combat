import { activeDefenseState } from "./state.js";

import {
    queueAttackOperation,
    recreateOffenseAfterSplinterpoint,
} from "./recalculation.js";

import { services } from "../../core/services.js";

import {
    isOffensiveCombatMessage,
} from "../../combat-rules.js";

import {
    MODULE_ID,
    SOCKET,
} from "../../core/constants.js";

import {
    localizeSystem,
    t,
} from "../../shared/values.js";

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
    const context = services.getMessageContext(message) ?? {};
    if (context.supersededBy || !isVtdAttack(message, context)) return [];
    if (!services.messageOffersActiveDefense(message) && !context.recalculatedFrom) return [];
    const target = services.resolveToken(primaryTargetTokenUuid(context));
    const targetActor = target?.actor;
    const targetActorUuid = actorUuid(targetActor);
    if (!targetActor || !targetActorUuid) return [];

    if (!context.vtdSplinterpointActorUuid) {
        return userOwnsActor(user, targetActor) && availableSplinterpoints(targetActor) > 0
            ? [{ kind: "primary", actorUuid: targetActorUuid }]
            : [];
    }

    const appliedResonances = new Set(context.vtdSplinterpointResonanceActorUuids ?? []);
    if (appliedResonances.size > 0) return [];
    const combatants = Array.from(game.combat?.combatants ?? []);
    const targetCombatant = combatants.find((combatant) => {
        const token = combatantToken(combatant);
        return actorUuid(combatantActor(combatant)) === targetActorUuid
            || (target?.uuid && token?.uuid === target.uuid);
    });
    const targetPlayerId = targetCombatant
        ? services.getAssignedUser(targetCombatant)?.id ?? services.getRuntimeController(targetCombatant)?.id ?? null
        : null;
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
        const playerId = services.getAssignedUser(combatant)?.id ?? controller?.id ?? null;
        if (targetPlayerId && playerId === targetPlayerId) continue;
        if (!user.isGM && controller?.id !== user.id) continue;
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

            await actor.update({ "system.splinterpoints.value": previousPoints - 1 });
            let result = null;
            try {
                result = await recreateOffenseAfterSplinterpoint(root, original, {
                    actorUuid: spenderActorUuid,
                    kind: action.kind,
                });
                if (!result) throw new Error("Defense splinterpoint produced no offense result");
            } catch (error) {
                if (availableSplinterpoints(actor) === previousPoints - 1) {
                    await actor.update({ "system.splinterpoints.value": previousPoints });
                }
                throw error;
            }

            const resultContext = services.getMessageContext(result) ?? {};
            const target = services.resolveToken(primaryTargetTokenUuid(resultContext));
            const combatant = Array.from(game.combat?.combatants ?? [])
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
