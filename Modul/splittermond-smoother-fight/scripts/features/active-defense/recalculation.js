import { activeDefenseState } from "./state.js";
import { persistMissingDefensiveFeature } from "./system-compatibility.js";

import { services } from "../../core/services.js";

import {
    activeDefenseChangesDifficulty,
    attackOutcomeChanged,
    bestActiveDefenseValue,
    isOffensiveCombatMessage,
    recalculateAttackReport,
    resolveActiveDefenseResult,
    totalDegreesOfSuccess,
} from "../../combat-rules.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    cloneData,
    escapeHtml,
    localizeSystem,
    t,
} from "../../shared/values.js";

function primaryTargetTokenUuid(context) {
    return context?.primaryTargetTokenUuid ?? context?.targetTokenUuid ?? null;
}

function finiteNumber(value) {
    return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
        ? Number(value)
        : null;
}

export function resolveRootOffenseMessage(offenseMessageId) {
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

export function resolveLatestOffenseMessage(message) {
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

export function resolveProcessedDefenseOffense(offenseMessageId, defenseMessageId) {
    const root = resolveRootOffenseMessage(offenseMessageId);
    const latest = resolveLatestOffenseMessage(root);
    const defenseMessageIds = services.getMessageContext(latest)?.defenseMessageIds;
    return defenseMessageIds?.includes?.(defenseMessageId) ? latest : null;
}

export async function queueAttackOperation(offenseMessageId, callback) {
    const root = resolveRootOffenseMessage(offenseMessageId);
    if (!root) return null;
    const previous = activeDefenseState.attackProcessingQueues.get(root.id) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => callback(root, resolveLatestOffenseMessage(root)));
    activeDefenseState.attackProcessingQueues.set(root.id, operation);
    try {
        return await operation;
    } finally {
        if (activeDefenseState.attackProcessingQueues.get(root.id) === operation) {
            activeDefenseState.attackProcessingQueues.delete(root.id);
        }
    }
}

export function queueDefenseForAttack(offenseMessageId, defenseMessage, defenseCheck, displayedDefenseValue, pending) {
    return queueAttackOperation(offenseMessageId, (root) => recreateOffenseAfterDefense(
        root,
        defenseMessage,
        defenseCheck,
        displayedDefenseValue,
        pending
    ));
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
    const previousCandidate = finiteNumber(existingDefenseContext.resultingDefenseValue);
    const alreadyProcessed = originalContext.defenseMessageIds?.includes?.(defenseMessage.id);
    if (alreadyProcessed && (previousCandidate === null || candidateDefense <= previousCandidate)) return original;

    const splinterpointBonus = Math.max(0, finiteNumber(originalContext.vtdSplinterpointBonus) ?? 0);
    const previousActiveDefense = finiteNumber(originalContext.activeDefenseValue)
        ?? (finiteNumber(originalContext.defenseValue) === null
            ? null
            : Number(originalContext.defenseValue) - splinterpointBonus);
    const newActiveDefense = bestActiveDefenseValue(previousActiveDefense, candidateDefense);
    const newDefense = newActiveDefense + splinterpointBonus;
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
        baseDefenseValue: finiteNumber(originalContext.baseDefenseValue)
            ?? finiteNumber(defenseCheck.baseDefense)
            ?? finiteNumber(calculatedBase),
        activeDefenseValue: newActiveDefense,
        attemptedDefenseActorUuids,
        defenseMessageIds,
    };
    if (!activeDefenseChangesDifficulty(defenseCheck, displayedDefenseValue)) {
        await setOffenseContext(original, historyContext);
        return original;
    }
    if (finiteNumber(originalContext.defenseValue) !== null && newDefense <= Number(originalContext.defenseValue)) {
        await setOffenseContext(original, historyContext);
        return original;
    }
    return applyEffectiveDefense(root, original, {
        ...historyContext,
        defenseMessageId: defenseMessage.id,
        defenseValue: newDefense,
        defenseType: defenseCheck.defenseType,
    }, newDefense, defenseCheck.defenseType);
}

export function recreateOffenseAfterSplinterpoint(root, original, { actorUuid, kind }) {
    if (!root || !original || !isOffensiveCombatMessage(original)) return null;
    const originalContext = services.getMessageContext(original) ?? {};
    const previousBonus = Math.max(0, finiteNumber(originalContext.vtdSplinterpointBonus) ?? 0);
    const bonus = kind === "resonance" ? 2 : 3;
    const appliedResonanceActorUuids = Array.from(new Set(
        originalContext.vtdSplinterpointResonanceActorUuids ?? []
    ));
    if (kind === "resonance" && appliedResonanceActorUuids.length > 0) return null;
    const resonanceActorUuids = kind === "resonance"
        ? [...appliedResonanceActorUuids, actorUuid]
        : appliedResonanceActorUuids;
    const baseDefense = finiteNumber(originalContext.baseDefenseValue)
        ?? finiteNumber(root.system?.checkReport?.difficulty)
        ?? finiteNumber(original.system?.checkReport?.difficulty)
        ?? 0;
    const activeDefenseValue = finiteNumber(originalContext.activeDefenseValue)
        ?? (finiteNumber(originalContext.defenseValue) === null
            ? baseDefense
            : Number(originalContext.defenseValue) - previousBonus);
    const vtdSplinterpointBonus = previousBonus + bonus;
    const defenseValue = activeDefenseValue + vtdSplinterpointBonus;
    const defenseType = originalContext.defenseType ?? original.system?.checkReport?.defenseType ?? "defense";
    const context = {
        ...originalContext,
        rootAttackMessageId: root.id,
        baseDefenseValue: baseDefense,
        activeDefenseValue,
        vtdSplinterpointActorUuid: kind === "primary"
            ? actorUuid
            : originalContext.vtdSplinterpointActorUuid,
        vtdSplinterpointResonanceActorUuids: resonanceActorUuids,
        vtdSplinterpointBonus,
        defenseValue,
        defenseType,
    };
    return applyEffectiveDefense(root, original, context, defenseValue, defenseType);
}

async function applyEffectiveDefense(root, original, context, defenseValue, defenseType) {
    const systemSource = cloneData(original.system?.toObject?.() ?? original.toObject().system);
    const previousReport = systemSource.checkReport;
    const config = globalThis.CONFIG?.splittermond ?? {};
    const recalculatedReport = recalculateAttackReport(previousReport, defenseValue, {
        triumphBonus: config.check?.degreeOfSuccess?.triumphBonus ?? 3,
        fumblePenalty: config.check?.degreeOfSuccess?.fumblePenalty ?? -3,
        grazingHitBasePenalty: config.grazingHitBasePenalty ?? 2,
    });
    if (!attackOutcomeChanged(previousReport, recalculatedReport)) {
        const banner = defenseBanner(previousReport, defenseType, defenseValue);
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
        ...(source.flags[MODULE_ID] ?? {}),
        context: {
            ...context,
            supersededBy: null,
            recalculatedFrom: original.id,
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
        const banner = defenseBanner(systemSource.checkReport, defenseType, defenseValue);
        await created.update({ content: decorateRecalculatedCard(rendered, banner) });
        await services.setRequiredFlag(original, "context", {
            ...(services.getMessageContext(original) ?? {}),
            ...context,
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

function setOffenseContext(message, context) {
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
