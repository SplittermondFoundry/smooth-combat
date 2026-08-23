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

export { normalizePendingDefense };

import { services } from "../../core/services.js";
import { persistMissingDefensiveFeature } from "./system-compatibility.js";

import {
    activeDefenseChangesDifficulty,
    attackOutcomeChanged,
    bestActiveDefenseValue,
    isDefenderMasteryName,
    isOffensiveCombatMessage,
    parseActiveDefenseDescription,
    recalculateAttackReport,
    resolveActiveDefenseResult,
    tokenDocumentCenter,
    totalDegreesOfSuccess,
} from "../../combat-rules.js";

import {
    MODULE_ID,
    SOCKET,
} from "../../core/constants.js";

import {
    cloneData,
    escapeHtml,
    getSetting,
    localizeSystem,
    t,
} from "../../shared/values.js";

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

export async function processDefenseMessage(message, pendingOverride = null, { allowForeign = false } = {}) {
    if (activeDefenseState.processingDefenseMessages.has(message.id)) return null;
    activeDefenseState.processingDefenseMessages.add(message.id);
    try {
        return await processDefenseMessageOnce(message, pendingOverride, { allowForeign });
    } finally {
        activeDefenseState.claimedDefenses.delete(message.id);
        activeDefenseState.processingDefenseMessages.delete(message.id);
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

function resolveRootOffenseMessage(offenseMessageId) {
    let current = game.messages.get(offenseMessageId);
    const visited = new Set();
    while (current && isOffensiveCombatMessage(current) && !visited.has(current.id)) {
        visited.add(current.id);
        const context = services.getMessageContext(current);
        const rootId = context?.rootAttackMessageId;
        const previousId = context?.recalculatedFrom;
        const previous = game.messages.get(rootId ?? previousId);
        if (!previous || !isOffensiveCombatMessage(previous)) return current;
        current = previous;
    }
    return current && isOffensiveCombatMessage(current) ? current : null;
}

function resolveProcessedDefenseOffense(offenseMessageId, defenseMessageId) {
    const root = resolveRootOffenseMessage(offenseMessageId);
    const latest = resolveLatestOffenseMessage(root);
    const defenseMessageIds = services.getMessageContext(latest)?.defenseMessageIds;
    return defenseMessageIds?.includes?.(defenseMessageId) ? latest : null;
}

async function queueDefenseForAttack(offenseMessageId, defenseMessage, defenseCheck, displayedDefenseValue, pending) {
    const root = resolveRootOffenseMessage(offenseMessageId);
    if (!root) return null;
    const previous = activeDefenseState.attackProcessingQueues.get(root.id) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => recreateOffenseAfterDefense(
        root,
        defenseMessage,
        defenseCheck,
        displayedDefenseValue,
        pending
    ));
    activeDefenseState.attackProcessingQueues.set(root.id, operation);
    try {
        return await operation;
    } finally {
        if (activeDefenseState.attackProcessingQueues.get(root.id) === operation) {
            activeDefenseState.attackProcessingQueues.delete(root.id);
        }
    }
}

async function recreateOffenseAfterDefense(root, defenseMessage, defenseCheck, displayedDefenseValue, pending) {
    const original = resolveLatestOffenseMessage(root);
    if (!original || !isOffensiveCombatMessage(original)) return null;

    const originalContext = services.getMessageContext(original) ?? {};
    const existingDefenseContext = services.getMessageContext(defenseMessage) ?? pending ?? {};
    const target = services.resolveToken(primaryTargetTokenUuid(originalContext));
    const calculatedBase = await target?.actor?.derivedValues?.[defenseCheck.defenseType]?.value?.calculate?.();
    const resolvedDefense = resolveActiveDefenseResult(defenseCheck, displayedDefenseValue, {
        knownDefensiveFeature: existingDefenseContext.defensiveFeatureValue,
        fallbackBaseDefense: calculatedBase,
    });
    const candidateDefense = resolvedDefense.defenseValue;
    const featureValue = resolvedDefense.defensiveFeatureValue;
    await persistMissingDefensiveFeature(defenseMessage, featureValue);
    const previousCandidate = existingDefenseContext.resultingDefenseValue;
    const hasPreviousCandidate = previousCandidate !== null
        && previousCandidate !== undefined
        && previousCandidate !== ""
        && Number.isFinite(Number(previousCandidate));
    const alreadyProcessed = originalContext.defenseMessageIds?.includes?.(defenseMessage.id);
    if (alreadyProcessed && (!hasPreviousCandidate || candidateDefense <= Number(previousCandidate))) return original;

    const newDefense = bestActiveDefenseValue(originalContext.defenseValue, candidateDefense);
    const actorUuid = pending?.defenderActorUuid ?? services.resolveSpeakerActor(defenseMessage)?.uuid ?? null;
    const attemptedDefenseActorUuids = Array.from(new Set([
        ...(originalContext.attemptedDefenseActorUuids ?? []),
        actorUuid,
    ].filter(Boolean)));
    const defenseMessageIds = Array.from(new Set([
        ...(originalContext.defenseMessageIds ?? []),
        originalContext.defenseMessageId,
        defenseMessage.id,
    ].filter(Boolean)));
    await services.setRequiredFlag(defenseMessage, "context", {
        ...existingDefenseContext,
        resultingDefenseValue: candidateDefense,
        effectiveDefenseValue: newDefense,
        defensiveFeatureValue: featureValue,
    });

    const historyContext = {
        ...originalContext,
        rootAttackMessageId: root.id,
        attemptedDefenseActorUuids,
        defenseMessageIds,
    };
    if (!activeDefenseChangesDifficulty(defenseCheck, displayedDefenseValue)) {
        await setOffenseContext(original, historyContext);
        return original;
    }
    if (Number.isFinite(Number(originalContext.defenseValue)) && newDefense <= Number(originalContext.defenseValue)) {
        await setOffenseContext(original, historyContext);
        return original;
    }
    const systemSource = cloneData(original.system?.toObject?.() ?? original.toObject().system);
    const previousReport = systemSource.checkReport;
    const config = globalThis.CONFIG?.splittermond ?? {};
    const recalculatedReport = recalculateAttackReport(previousReport, newDefense, {
        triumphBonus: config.check?.degreeOfSuccess?.triumphBonus ?? 3,
        fumblePenalty: config.check?.degreeOfSuccess?.fumblePenalty ?? -3,
        grazingHitBasePenalty: config.grazingHitBasePenalty ?? 2,
    });
    if (!attackOutcomeChanged(previousReport, recalculatedReport)) {
        const context = {
            ...historyContext,
            defenseMessageId: defenseMessage.id,
            defenseValue: newDefense,
            defenseType: defenseCheck.defenseType,
        };
        const banner = defenseBanner(systemSource.checkReport, defenseCheck.defenseType, newDefense);
        await updateOffenseCard(original, context, decorateRecalculatedCard(original.content, banner));
        return original;
    }
    systemSource.checkReport = recalculatedReport;
    systemSource.checkReport.degreeOfSuccessMessage = services.checkResultMessage(systemSource.checkReport);
    systemSource.openDegreesOfSuccess = Math.max(
        0,
        totalDegreesOfSuccess(systemSource.checkReport) - (systemSource.checkReport.maneuvers?.length ?? 0)
    );
    resetOffenseHandlers(systemSource);

    const source = cloneData(original.toObject());
    delete source._id;
    delete source._stats;
    delete source.timestamp;
    source.user = game.user.id;
    source.sound = null;
    source.system = systemSource;
    source.content = original.content;
    source.flags ??= {};
    source.flags[MODULE_ID] = {
        context: {
            ...historyContext,
            supersededBy: null,
            recalculatedFrom: original.id,
            defenseMessageId: defenseMessage.id,
            defenseMessageIds,
            defenseValue: newDefense,
            defenseType: defenseCheck.defenseType,
            attemptedDefenseActorUuids,
            createdAt: Date.now(),
        },
    };
    if (source.flags.splittermond?.chatCard) source.flags.splittermond.chatCard.messageId = null;

    let created = null;
    try {
        created = await ChatMessage.create(source);
        if (!created) throw new Error("ChatMessage.create returned no successor");
    } catch (error) {
        notifyRequiredContextFailure(error, original.id);
        throw error;
    }
    try {
        const rendered = await renderTemplate(created.system.template, created.system.getData());
        const banner = defenseBanner(systemSource.checkReport, defenseCheck.defenseType, newDefense);
        await created.update({ content: decorateRecalculatedCard(rendered, banner) });
        await services.setRequiredFlag(original, "context", {
            ...(services.getMessageContext(original) ?? historyContext),
            rootAttackMessageId: root.id,
            attemptedDefenseActorUuids,
            defenseMessageIds,
            supersededBy: created.id,
        });
        return created;
    } catch (error) {
        try {
            await created.delete?.();
        } catch (cleanupError) {
            console.debug(`${MODULE_ID} | Could not remove incomplete attack successor ${created.id}`, cleanupError);
        }
        throw error;
    }
}

async function updateOffenseCard(message, context, content) {
    try {
        return await message.update({
            content,
            [`flags.${MODULE_ID}.context`]: context,
        });
    } catch (error) {
        notifyRequiredContextFailure(error, message.id);
        throw error;
    }
}

async function setOffenseContext(message, context) {
    return services.setRequiredFlag(message, "context", context);
}

function notifyRequiredContextFailure(error, messageId) {
    console.error(`${MODULE_ID} | Could not persist required attack context on chat message ${messageId}`, error);
    ui.notifications?.error?.(t("SMOOTHER_FIGHT.HUD.RequiredFlagFailed", { flag: "context" }));
}

function defenseBanner(report, defenseType, defenseValue) {
    const defenseLabel = localizeSystem(`splittermond.derivedAttribute.${defenseType}.short`, String(defenseType).toUpperCase());
    const hiddenClass = report.hideDifficulty ? " gm-only" : "";
    return `<div class="sf-chat-recalculated${hiddenClass}"><i class="fa-solid fa-shield-halved"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NewDefense", { defense: defenseLabel }))}</span><strong>${escapeHtml(defenseValue)}</strong></div>`;
}

function resetOffenseHandlers(systemSource) {
    if (systemSource.damageHandler) {
        systemSource.damageHandler.damageUsed = false;
        systemSource.damageHandler.penaltyUsed = false;
        systemSource.damageHandler.damageAddition = 0;
        systemSource.damageHandler.consumedGrazingHitCost = false;
        systemSource.damageHandler.convertedToNumbingDamage = false;
    }
    resetCheckedOptions(systemSource.damageHandler?.options);
    resetCheckedOptions(systemSource.noActionOptionsHandler);
}

function resetCheckedOptions(value, visited = new Set()) {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Object.hasOwn(value, "checked") && typeof value.checked === "boolean") value.checked = false;
    for (const nested of Object.values(value)) resetCheckedOptions(nested, visited);
}

function decorateRecalculatedCard(content, banner) {
    const template = document.createElement("template");
    template.innerHTML = content;
    template.content.querySelectorAll(".sf-chat-recalculated").forEach((element) => element.remove());
    template.content.querySelectorAll('[data-localaction="activeDefense" i], [data-local-action="activeDefense" i]').forEach((button) => button.remove());
    const wrapper = document.createElement("div");
    wrapper.append(template.content.cloneNode(true));
    return `${banner}${wrapper.innerHTML}`;
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
        const defenderModifier = Array.from(current.defense.skill.selectableModifier ?? [])
            .find((modifier) => isDefenderMasteryName(modifier?.attributes?.name));
        await runPendingDefenseRoll(pending, () => current.defense.skill.roll({
            type: "defense",
            preSelectedModifier: defenderModifier ? [defenderModifier.attributes.name] : [],
            difficulty,
            modifier: defenderModifier ? 0 : -3,
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
    } catch (error) {
        clearPendingDefense(pending.pendingDefenseId);
        throw error;
    }
}

export function getEligibleDefenderChoices(message, user) {
    if (!message || !user || !isOffensiveCombatMessage(message)) return [];
    const context = services.getMessageContext(message);
    if (context?.supersededBy || !message.system?.checkReport?.succeeded) return [];
    if (!services.messageOffersActiveDefense(message) && !context?.recalculatedFrom) return [];
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

function resolveLatestOffenseMessage(message) {
    let current = message;
    const visited = new Set();
    while (current && !visited.has(current.id)) {
        visited.add(current.id);
        const nextId = services.getMessageContext(current)?.supersededBy;
        const next = nextId ? game.messages.get(nextId) : null;
        if (!next || !isOffensiveCombatMessage(next)) break;
        current = next;
    }
    return current;
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

function measureTokenDistance(left, right) {
    const leftPoint = tokenCenter(left);
    const rightPoint = tokenCenter(right);
    if (!leftPoint || !rightPoint) return Number.POSITIVE_INFINITY;
    try {
        const measured = canvas?.grid?.measurePath?.([leftPoint, rightPoint]);
        if (Number.isFinite(Number(measured?.distance))) return Number(measured.distance);
    } catch (error) {
        console.debug(`${MODULE_ID} | Could not measure Defender distance through the grid`, error);
    }
    const gridSize = Number(canvas?.grid?.size) || 100;
    const gridDistance = Number(canvas?.scene?.grid?.distance) || 1;
    return Math.hypot(rightPoint.x - leftPoint.x, rightPoint.y - leftPoint.y) / gridSize * gridDistance;
}

function tokenCenter(token) {
    const documentCenter = tokenDocumentCenter(token, canvas?.grid?.size);
    if (documentCenter) return documentCenter;
    const object = token?.object ?? canvas?.tokens?.get?.(token?.id);
    if (object?.center) return { x: object.center.x, y: object.center.y };
    return null;
}

export function canUserSubmitDefense(user, pending, message) {
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
