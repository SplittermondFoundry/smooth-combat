import { activeDefenseState } from "./state.js";

import {
    activeDefenseDifficultyForOffense,
    invokeActiveDefenseRoll,
    launchDirectActiveDefense,
} from "./difficulty.js";

import {
    clearPendingDefense,
    normalizePendingDefense,
    registerPendingDefenseCleanup,
} from "./pending.js";

import {
    queueDefenseForAttack,
    resolveLatestOffenseMessage,
    resolveProcessedDefenseOffense,
} from "./recalculation.js";

import {
    defenseAllowsModification,
} from "./phase.js";

export { normalizePendingDefense };

import { services } from "../../core/services.js";
import {
    isDefenderMasteryName,
    isOffensiveCombatMessage,
    parseActiveDefenseDescription,
} from "../../combat-rules.js";

import {
    MODULE_ID,
    SOCKET,
} from "../../core/constants.js";

import {
    escapeHtml,
    getSetting,
    localizeSystem,
    t,
} from "../../shared/values.js";

import {
    installTemporarySelectableModifier,
} from "../../shared/temporary-selectable-modifier.js";

import {
    measureTokenDistance,
} from "../../shared/token-distance.js";

function primaryTargetTokenUuid(context) {
    return context?.primaryTargetTokenUuid ?? context?.targetTokenUuid ?? null;
}

function primaryTargetActorUuid(context) {
    return context?.primaryTargetActorUuid ?? context?.targetActorUuid ?? null;
}

const PENDING_DEFENSE_TTL_MS = 10 * 60 * 1000;

function createPendingDefenseId() {
    return globalThis.crypto?.randomUUID?.()
        ?? globalThis.foundry?.utils?.randomID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function schedulePendingDefenseCleanup(pending) {
    const delay = Math.max(0, pending.expiresAt - Date.now());
    const timeoutId = setTimeout(() => clearPendingDefense(pending.pendingDefenseId), delay);
    timeoutId?.unref?.();
    activeDefenseState.pendingDefenseTimers.set(pending.pendingDefenseId, timeoutId);
}

function rememberPendingDefense(message, targetOverride = null, options = {}) {
    const context = services.getMessageContext(message);
    const target = targetOverride
        ?? services.resolveToken(primaryTargetTokenUuid(context))
        ?? getControlledTokenDocument()
        ?? services.getHudContext()?.target;
    const defender = options.defender ?? target;
    const difficulty = activeDefenseDifficultyForOffense(message);
    clearPendingDefense(activeDefenseState.pendingDefense?.pendingDefenseId);
    const pending = {
        pendingDefenseId: createPendingDefenseId(),
        attackMessageId: message.id,
        primaryTargetTokenUuid: target?.uuid ?? null,
        primaryTargetActorUuid: target?.actor?.uuid ?? null,
        targetTokenUuid: target?.uuid ?? null,
        targetActorUuid: target?.actor?.uuid ?? null,
        defenderTokenUuid: defender?.uuid ?? null,
        defenderActorUuid: defender?.actor?.uuid ?? null,
        defenseId: options.defense?.id ?? null,
        defenseSkillId: options.defense?.skill?.id ?? null,
        assisted: Boolean(options.assisted),
        ...difficulty,
        startedAt: Date.now(),
        expiresAt: Date.now() + PENDING_DEFENSE_TTL_MS,
    };
    activeDefenseState.pendingDefense = pending;
    schedulePendingDefenseCleanup(pending);
    return { pending, target };
}

export function getControlledTokenDocument() {
    const controlled = Array.from(canvas?.tokens?.controlled ?? []);
    return controlled.at(-1)?.document ?? null;
}

function pendingMatchesDefenseMessage(pending, message) {
    if (!pending || pending.expiresAt < Date.now()) return false;
    const target = services.resolveToken(pending.targetTokenUuid);
    const defender = services.resolveToken(pending.defenderTokenUuid);
    const expectedActor = pending.assisted ? defender?.actor : target?.actor;
    return !expectedActor || !message.speaker?.actor || expectedActor.id === message.speaker.actor;
}

export async function claimPendingDefenseForMessage(message) {
    const existing = normalizePendingDefense(services.getMessageContext(message));
    if (existing || !services.isOwnMessage(message)) return existing;
    const pending = Array.from(activeDefenseState.rollingDefenses.values())
        .reverse()
        .find((candidate) => pendingMatchesDefenseMessage(candidate, message));
    if (!pending) return null;

    await services.setRequiredFlag(message, "context", {
        ...(services.getMessageContext(message) ?? {}),
        ...pending,
    });
    activeDefenseState.claimedDefenses.set(message.id, pending);
    clearPendingDefense(pending.pendingDefenseId);
    return pending;
}

export async function processDefenseMessage(
    message,
    pendingOverride = null,
    { allowForeign = false, queueIfBusy = true } = {}
) {
    const previous = activeDefenseState.processingDefenseMessages.get(message.id);
    if (previous && !queueIfBusy) return null;
    const operation = (previous ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => processDefenseMessageOnce(message, pendingOverride, { allowForeign }));
    activeDefenseState.processingDefenseMessages.set(message.id, operation);
    try {
        return await operation;
    } finally {
        if (activeDefenseState.processingDefenseMessages.get(message.id) === operation) {
            activeDefenseState.claimedDefenses.delete(message.id);
            activeDefenseState.processingDefenseMessages.delete(message.id);
        }
    }
}

async function processDefenseMessageOnce(message, pendingOverride = null, { allowForeign = false } = {}) {
    if ((!allowForeign && !services.isOwnMessage(message)) || !getSetting("defenseRecalculation", true)) return;
    const check = services.getDefenseCheck(message);
    if (!check) return;

    const pending = normalizePendingDefense(pendingOverride)
        ?? normalizePendingDefense(services.getMessageContext(message))
        ?? normalizePendingDefense(activeDefenseState.claimedDefenses.get(message.id));
    if (!pending?.attackMessageId || pending.expiresAt < Date.now()) return;

    const offense = resolveLatestOffenseMessage(game.messages.get(pending.attackMessageId));
    if (!defenseAllowsModification(offense)) return;

    if (!pendingMatchesDefenseMessage(pending, message)) return;
    if (pending.assisted && !isValidDefenderAttempt(pending, message)) return;
    const processedOffense = resolveProcessedDefenseOffense(pending.attackMessageId, message.id);
    requestLatestEventForDefense(pending);

    const existingDefenseContext = services.getMessageContext(message) ?? {};
    const contentTemplate = document.createElement("template");
    contentTemplate.innerHTML = message.content ?? "";
    const defenseDescription = contentTemplate.content.querySelector?.(".degree-of-success-description");
    const defensePresentation = parseActiveDefenseDescription(
        defenseDescription?.textContent ?? contentTemplate.content.textContent
    );
    const numbingDamage = defensePresentation.numbingDamage;
    if (!processedOffense) {
        await services.setRequiredFlag(message, "context", {
            ...existingDefenseContext,
            pendingDefenseId: pending.pendingDefenseId,
            attackMessageId: pending.attackMessageId,
            primaryTargetTokenUuid: pending.targetTokenUuid,
            primaryTargetActorUuid: pending.targetActorUuid,
            targetTokenUuid: pending.targetTokenUuid,
            targetActorUuid: pending.targetActorUuid,
            defenderTokenUuid: pending.defenderTokenUuid,
            defenderActorUuid: pending.defenderActorUuid,
            defenseId: pending.defenseId,
            defenseSkillId: pending.defenseSkillId,
            assisted: pending.assisted,
            numbingDamage: existingDefenseContext.numbingDamage ?? (numbingDamage || null),
            numbingDamageApplied: Boolean(existingDefenseContext.numbingDamageApplied),
        });
    }

    if (!game.user.isGM) {
        const gm = services.getActivePrimaryGm();
        if (!gm) {
            ui.notifications.warn(localizeSystem("splittermond.chatCard.noGMConnected", "Kein GM verbunden."));
            return;
        }
        game.socket.emit(SOCKET, {
            type: "recalculate-defense",
            senderId: game.user.id,
            recipientId: gm.id,
            defenseMessageId: message.id,
            pending,
        });
        return;
    }

    const newOffense = await queueDefenseForAttack(
        pending.attackMessageId,
        message,
        check,
        defensePresentation.defenseValue,
        pending
    );
    if (newOffense) services.scheduleRender(0);
    return newOffense;
}

function requestLatestEventForDefense(pending) {
    const offense = game.messages.get(pending?.attackMessageId);
    const combatant = game.combat?.combatant;
    if (!offense || !combatant || !services.messageBelongsToCombatant(offense, combatant)) return;
    services.setCombatEventExpansionRequest("latest");
    services.scheduleRender(0);
}

export function isDefenseMessageProcessing(messageId) {
    return activeDefenseState.processingDefenseMessages.has(messageId);
}

function startPendingDefenseRoll(pending) {
    if (!pending?.pendingDefenseId || pending.expiresAt < Date.now()) return false;
    if (activeDefenseState.pendingDefense?.pendingDefenseId !== pending.pendingDefenseId) return false;
    activeDefenseState.rollingDefenses.set(pending.pendingDefenseId, pending);
    return true;
}

function watchPendingDefenseRoll(result, pending) {
    Promise.resolve(result).then(
        () => clearPendingDefense(pending.pendingDefenseId),
        () => clearPendingDefense(pending.pendingDefenseId)
    );
}

async function runPendingDefenseRoll(pending, operation) {
    if (!startPendingDefenseRoll(pending)) return null;
    try {
        return await operation();
    } finally {
        clearPendingDefense(pending.pendingDefenseId);
    }
}

function interceptPendingDefenseActorRoll(actor, pending) {
    const originalActorRoll = actor?.rollActiveDefense;
    if (typeof originalActorRoll !== "function") return null;
    const hadOwnRoll = Object.hasOwn(actor, "rollActiveDefense");
    let installed = false;
    let captured = false;
    let unregisterCleanup = () => {};
    const restore = () => {
        unregisterCleanup();
        unregisterCleanup = () => {};
        if (!installed || actor.rollActiveDefense !== interceptActorRoll) return;
        if (hadOwnRoll) actor.rollActiveDefense = originalActorRoll;
        else delete actor.rollActiveDefense;
        installed = false;
    };
    const interceptActorRoll = function (...rollArgs) {
        captured = true;
        restore();
        if (!startPendingDefenseRoll(pending)) return originalActorRoll.apply(this, rollArgs);
        try {
            const result = pending.distractingFeatureValue > 0
                ? invokeActiveDefenseRoll(originalActorRoll, this, rollArgs, pending.activeDefenseDifficulty)
                : originalActorRoll.apply(this, rollArgs);
            watchPendingDefenseRoll(result, pending);
            return result;
        } catch (error) {
            clearPendingDefense(pending.pendingDefenseId);
            throw error;
        }
    };
    try {
        actor.rollActiveDefense = interceptActorRoll;
        installed = actor.rollActiveDefense === interceptActorRoll;
    } catch {
        installed = false;
    }
    if (!installed) return null;
    unregisterCleanup = registerPendingDefenseCleanup(pending.pendingDefenseId, restore);
    return {
        get captured() {
            return captured;
        },
        restore,
    };
}

function observeActiveDefenseDialog(dialog, pending, actorRollInterceptor) {
    if (!dialog || typeof dialog.close !== "function") return false;
    const originalClose = dialog.close;
    dialog.close = function (...args) {
        if (!actorRollInterceptor.captured) clearPendingDefense(pending.pendingDefenseId);
        return originalClose.apply(this, args);
    };
    return true;
}

async function launchActorActiveDefense(actor, type, pending) {
    const normalizedType = String(type ?? "defense").toLocaleLowerCase();
    if (!["defense", "vtd"].includes(normalizedType)) {
        return runPendingDefenseRoll(pending, () => launchDirectActiveDefense(actor, type, pending));
    }
    const actorRollInterceptor = interceptPendingDefenseActorRoll(actor, pending);
    if (!actorRollInterceptor) {
        clearPendingDefense(pending.pendingDefenseId);
        return actor.activeDefenseDialog(type || undefined);
    }
    try {
        const dialog = await actor.activeDefenseDialog(type || undefined);
        if (!actorRollInterceptor.captured && dialog?.rendered === false) {
            clearPendingDefense(pending.pendingDefenseId);
        } else if (!observeActiveDefenseDialog(dialog, pending, actorRollInterceptor)) {
            clearPendingDefense(pending.pendingDefenseId);
        }
        return dialog;
    } catch (error) {
        clearPendingDefense(pending.pendingDefenseId);
        throw error;
    }
}

export async function beginActiveDefense(message) {
    message = resolveLatestOffenseMessage(message);
    if (!message || !defenseAllowsModification(message)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenseNoLongerAvailable"));
        return;
    }
    const { pending, target } = rememberPendingDefense(message);
    if (!target?.actor || !(game.user.isGM || target.actor.isOwner)) {
        clearPendingDefense(pending.pendingDefenseId);
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenseNotAllowed"));
        return;
    }
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.WaitingForDefense", { target: target.name }));
    const type = message.system?.checkReport?.defenseType ?? "defense";
    await launchActorActiveDefense(target.actor, type, pending);
}

export async function beginAdditionalTargetDefense(message) {
    if (!message) return;
    message = resolveLatestOffenseMessage(message);
    if (!defenseAllowsModification(message)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenseNoLongerAvailable"));
        return;
    }
    const context = services.getMessageContext(message);
    const target = services.resolveToken(primaryTargetTokenUuid(context));
    const attempted = new Set(context?.attemptedDefenseActorUuids ?? []);
    if (!target?.actor || attempted.has(target.actor.uuid) || !(game.user.isGM || target.actor.isOwner)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenseNotAllowed"));
        return;
    }
    const { pending } = rememberPendingDefense(message, target, { defender: target });
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.WaitingForDefense", { target: target.name }));
    const type = message.system?.checkReport?.defenseType ?? context?.defenseType ?? "defense";
    await launchActorActiveDefense(target.actor, type, pending);
}

export async function beginDefenderDefense(message) {
    if (!message) return;
    message = resolveLatestOffenseMessage(message);
    if (!defenseAllowsModification(message)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenseNoLongerAvailable"));
        return;
    }
    const choices = getEligibleDefenderChoices(message, game.user);
    if (!choices.length) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenderUnavailable"));
        return;
    }
    const target = services.resolveToken(primaryTargetTokenUuid(services.getMessageContext(message)));
    if (!target?.actor) return;

    const options = choices.map((choice, index) =>
        `<option value="${index}">${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenderChoice", {
            defender: choice.token.name ?? choice.actor.name,
            defense: choice.defense.name,
        }))}</option>`
    ).join("");
    const content = `<form class="sf-defender-dialog">
        <p>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenderRule", { target: target.name }))}</p>
        <div class="form-group"><label>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenderDefense"))}</label><select name="choice">${options}</select></div>
    </form>`;
    const selectedIndex = await foundry.applications.api.DialogV2.wait({
        id: `${MODULE_ID}-defender-dialog`,
        window: { title: t("SMOOTHER_FIGHT.HUD.DefenderDialogTitle", { target: target.name }) },
        position: { width: 470 },
        content,
        buttons: [
            {
                action: "roll",
                label: t("SMOOTHER_FIGHT.HUD.DefenderRoll"),
                icon: "fa-solid fa-shield-halved",
                callback: (_event, button) => Number(button.form.elements.choice.value),
                default: true,
            },
            {
                action: "cancel",
                label: t("SMOOTHER_FIGHT.Settings.Cancel"),
                icon: "fa-solid fa-xmark",
                callback: () => null,
            },
        ],
        close: () => null,
        modal: true,
    });
    if (!Number.isInteger(selectedIndex)) return;

    const currentChoices = getEligibleDefenderChoices(message, game.user);
    const selected = choices[selectedIndex];
    const current = currentChoices.find((choice) =>
        choice.token.uuid === selected?.token.uuid && choice.defense.id === selected?.defense.id
    );
    if (!current) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenderUnavailable"));
        return;
    }

    const { pending } = rememberPendingDefense(message, target, {
        defender: current.token,
        defense: current.defense,
        assisted: true,
    });
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.WaitingForDefender", {
        defender: current.token.name ?? current.actor.name,
        target: target.name,
    }));
    try {
        const baseDefense = await target.actor.derivedValues.defense.value.calculate();
        const difficulty = pending.activeDefenseDifficulty;
        const preparedModifier = prepareDefenderRollOptions(current, pending);
        try {
            await runPendingDefenseRoll(pending, () => current.defense.skill.roll({
                type: "defense",
                ...preparedModifier.rollOptions,
                difficulty,
                title: t("SMOOTHER_FIGHT.HUD.DefenderRollTitle", {
                    defender: current.token.name ?? current.actor.name,
                    target: target.name,
                }),
                checkMessageData: {
                    defenseType: "defense",
                    baseDefense,
                    itemData: current.defense,
                },
            }));
        } finally {
            preparedModifier.cleanup();
        }
    } catch (error) {
        clearPendingDefense(pending.pendingDefenseId);
        throw error;
    }
}

export function prepareDefenderRollOptions(choice, pending) {
    const skill = choice?.defense?.skill;
    let defenderModifier = null;
    try {
        defenderModifier = Array.from(skill?.selectableModifier ?? [])
            .find((modifier) => isDefenderMasteryName(modifier?.attributes?.name));
    } catch (_error) {
        // Continue with the temporary modifier or the numeric compatibility fallback.
    }
    if (defenderModifier) {
        return {
            cleanup: () => {},
            rollOptions: {
                preSelectedModifier: [defenderModifier.attributes.name],
                modifier: 0,
            },
            usesNamedModifier: true,
        };
    }

    const name = t("SMOOTHER_FIGHT.HUD.DefenderModifier");
    const cleanup = installTemporarySelectableModifier({
        skill,
        modifierManager: choice?.actor?.modifier,
        groupId: `skill.${choice?.defense?.id ?? ""}`,
        recordId: `defender:${pending?.pendingDefenseId ?? ""}`,
        name,
        amount: -3,
    });
    return cleanup ? {
        cleanup,
        rollOptions: {
            preSelectedModifier: [name],
            modifier: 0,
        },
        usesNamedModifier: true,
    } : {
        cleanup: () => {},
        rollOptions: {
            preSelectedModifier: [],
            modifier: -3,
        },
        usesNamedModifier: false,
    };
}

export function getEligibleDefenderChoices(message, user) {
    if (!message || !user || !isOffensiveCombatMessage(message)) return [];
    if (!defenseAllowsModification(message)) return [];
    const context = services.getMessageContext(message);
    if (context?.supersededBy || (!message.system?.checkReport?.succeeded && !context?.recalculatedFrom)) return [];
    if (!services.messageOffersActiveDefense(message) && !context?.recalculatedFrom && !context?.defensePhase) return [];
    const defenseType = String(message.system?.checkReport?.defenseType ?? context?.defenseType ?? "defense").toLocaleLowerCase();
    if (defenseType !== "defense" && defenseType !== "vtd") return [];
    const target = services.resolveToken(primaryTargetTokenUuid(context));
    if (!target?.actor) return [];
    const attempted = new Set(context?.attemptedDefenseActorUuids ?? []);
    const choices = [];
    for (const combatant of Array.from(game.combat?.combatants ?? [])) {
        const token = combatant.token?.document ?? combatant.token ?? services.resolveCombatantToken(combatant);
        const actor = token?.actor ?? combatant.actor;
        if (!token?.uuid || !actor || actor.id === target.actor.id || attempted.has(actor.uuid)) continue;
        if (!(user.isGM || actor.testUserPermission?.(user, "OWNER"))) continue;
        if (!hasDefenderMastery(actor) || measureTokenDistance(token, target) > 2) continue;
        for (const defense of getCombatDefenseOptions(actor, { requireDefenderMastery: true })) choices.push({ token, actor, defense });
    }
    return choices;
}

function getCombatDefenseOptions(actor, { requireDefenderMastery = false } = {}) {
    const masteries = getDefenderMasteries(actor);
    const masterySkills = new Set(masteries.map((mastery) => mastery.system?.skill).filter(Boolean));
    return Array.from(actor?.activeDefense?.defense ?? []).filter((defense) => {
        if (!defense?.skill || defense.id === "acrobatics" || defense.skill.id === "acrobatics") return false;
        return !requireDefenderMastery || !masterySkills.size || masterySkills.has(defense.skill.id);
    });
}

function hasDefenderMastery(actor) {
    return getDefenderMasteries(actor).length > 0;
}

function getDefenderMasteries(actor) {
    return Array.from(actor?.items ?? []).filter((item) =>
        item.type === "mastery" && isDefenderMasteryName(item.name)
    );
}

export function canUserSubmitDefense(user, pending, message) {
    const offense = resolveLatestOffenseMessage(game.messages.get(pending?.attackMessageId));
    if (!defenseAllowsModification(offense)) return false;
    const target = services.resolveToken(pending?.targetTokenUuid);
    if (!target?.actor) return false;
    if (!pending.assisted) return Boolean(target.actor.testUserPermission?.(user, "OWNER"));
    const defender = services.resolveToken(pending.defenderTokenUuid);
    return Boolean(defender?.actor?.testUserPermission?.(user, "OWNER") && isValidDefenderAttempt(pending, message));
}

function isValidDefenderAttempt(pending, message) {
    const target = services.resolveToken(pending?.targetTokenUuid);
    const defender = services.resolveToken(pending?.defenderTokenUuid);
    const check = services.getDefenseCheck(message);
    const offense = resolveLatestOffenseMessage(game.messages.get(pending?.attackMessageId));
    const offenseContext = services.getMessageContext(offense);
    const attempted = new Set(offenseContext?.attemptedDefenseActorUuids ?? []);
    if (!target?.actor || !defender?.actor || !check || target.actor.id === defender.actor.id) return false;
    if (pending.defenderActorUuid && pending.defenderActorUuid !== defender.actor.uuid) return false;
    if (message.speaker?.actor && message.speaker.actor !== defender.actor.id) return false;
    if (attempted.has(defender.actor.uuid) || !hasDefenderMastery(defender.actor)) return false;
    if (String(check.defenseType).toLocaleLowerCase() !== "defense") return false;
    if (check.itemData?.id === "acrobatics" || check.itemData?.skill?.id === "acrobatics") return false;
    const validOption = getCombatDefenseOptions(defender.actor, { requireDefenderMastery: true })
        .some((defense) => defenseMatchesPendingCheck(defense, pending, check.itemData));
    return validOption && measureTokenDistance(defender, target) <= 2;
}

function defenseMatchesPendingCheck(defense, pending, itemData) {
    if (!defense) return false;
    if (pending.defenseId && defense.id !== pending.defenseId) return false;
    if (pending.defenseSkillId && defense.skill?.id !== pending.defenseSkillId) return false;

    const submittedIds = new Set([
        itemData?.id,
        itemData?._id,
        itemData?.item?.id,
        itemData?.item?._id,
    ].filter(Boolean));
    if (submittedIds.has(defense.id)) return true;

    const submittedSkillId = itemData?.skill?.id ?? itemData?.skill?._id;
    const sameSkill = Boolean(submittedSkillId && submittedSkillId === defense.skill?.id);
    const submittedName = String(itemData?.name ?? itemData?.item?.name ?? "").trim();
    return sameSkill && Boolean(submittedName && submittedName === String(defense.name ?? "").trim());
}
