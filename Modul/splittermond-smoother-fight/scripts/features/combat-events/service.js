import { combatEventState } from "./state.js";

import { services } from "../../core/services.js";

import { getApplicableCombat } from "../../core/combat-compatibility.js";

import {
    isOffensiveCombatMessage,
} from "../../combat-rules.js";

import {
    getSetting,
} from "../../shared/values.js";

import {
    analyzeCombatEventGroups,
} from "./workflow.js";

import {
    combatWorkflowAllowsTick,
} from "../../domain/combat-flow.js";

export function collectCombatEventGroups(context) {
    return collectCombatEventPresentation(context).groups;
}

export function collectCombatEventPresentation(context) {
    const groups = collectAllCombatEventGroups(context);
    return analyzeCombatEventGroups(groups, {
        maxCards: getSetting("maxCards", 3),
        pendingDefense: services.getRunningActiveDefense?.(),
    });
}

function getCombatWorkflowFocus(contextOrCombat = getApplicableCombat()) {
    const combat = contextOrCombat?.combat ?? contextOrCombat;
    if (!combat) return null;
    return collectCombatEventPresentation({ combat }).focus;
}

export function getBlockingCombatWorkflow(contextOrCombat = getApplicableCombat()) {
    const focus = getCombatWorkflowFocus(contextOrCombat);
    return focus?.blocking ? focus : null;
}

export function canAdvanceCombatWorkflowTicks(message, contextOrCombat = getApplicableCombat()) {
    const blocker = getBlockingCombatWorkflow(contextOrCombat);
    return combatWorkflowAllowsTick({
        isGM: game.user?.isGM,
        blocker,
        messageId: message?.id,
    });
}

function collectAllCombatEventGroups(context) {
    const messages = Array.from(game.messages?.contents ?? game.messages ?? [])
        .filter((message) => message.visible !== false);
    const combatActorIds = new Set(Array.from(context.combat.combatants ?? []).map((c) => c.actorId).filter(Boolean));
    const primaryMessages = messages.filter((message) => {
        if (services.isDiceAnimationPending(message)) return false;
        if (!isOffensiveCombatMessage(message)) return false;
        const cardContext = services.getMessageContext(message);
        if (cardContext) return cardContext.combatId === context.combat.id;
        return Number(message.timestamp) >= combatEventState.startedAt && combatActorIds.has(message.speaker?.actor);
    });

    const groups = primaryMessages.map((primary) => ({
        primary,
        kind: services.isSpellMessage(primary) ? "spell" : "attack",
        damages: [],
        defenses: [],
        fumbles: [],
        interruptions: [],
    }));
    for (const message of messages) {
        if (services.isDiceAnimationPending(message)) continue;
        if (!services.isDamageMessage(message) && !services.isDefenseMessage(message) && !services.isFumbleTableMessage(message)) continue;
        const fumble = services.getFumbleData(message);
        const cardContext = services.getMessageContext(message);
        let group = services.isDefenseMessage(message)
            ? [...groups].reverse().find((candidate) => {
                const primaryContext = services.getMessageContext(candidate.primary);
                return primaryContext?.defenseMessageId === message.id
                    || primaryContext?.defenseMessageIds?.includes?.(message.id);
            })
            : null;
        group ??= fumble?.sourceMessageId
            ? findEventGroupForSource(groups, fumble.sourceMessageId)
            : cardContext?.attackMessageId
            ? groups.find((candidate) => candidate.primary.id === cardContext.attackMessageId)
            : null;
        if (!group) {
            group = [...groups].reverse().find((candidate) =>
                message.timestamp >= candidate.primary.timestamp &&
                (services.isFumbleTableMessage(message)
                    ? (fumble?.kind === "fight" ? candidate.kind === "attack" : candidate.kind === "spell")
                        && message.speaker?.actor === candidate.primary.speaker?.actor
                    : services.isDefenseMessage(message)
                    ? candidate.kind === "attack"
                    : message.speaker?.actor === candidate.primary.speaker?.actor)
            );
        }
        if (!group) continue;
        if (services.isFumbleTableMessage(message)) group.fumbles.push(message);
        else (services.isDamageMessage(message) ? group.damages : group.defenses).push(message);
    }

    for (const message of messages) {
        if (!services.isContinuousActionInterruptionPending?.(message, context.combat)) continue;
        const interruption = services.getContinuousActionInterruptionCard?.(message);
        if (!interruption || (interruption.combatId && interruption.combatId !== context.combat.id)) continue;
        const group = findEventGroupForSource(groups, interruption.sourceMessageId);
        if (group) {
            group.interruptions.push(message);
            continue;
        }
        groups.push({
            primary: message,
            kind: "interruption",
            damages: [],
            defenses: [],
            fumbles: [],
            interruptions: [],
        });
    }

    return groups;
}

function findEventGroupForSource(groups, sourceMessageId) {
    if (!sourceMessageId) return null;
    return groups.find((group) => [
        group.primary,
        ...group.damages,
        ...group.defenses,
        ...group.fumbles,
    ].some((message) => message.id === sourceMessageId)) ?? null;
}

export function setCombatEventCardsCollapsed(collapsed) {
    combatEventState.cardsCollapsed = Boolean(collapsed);
}

export function toggleCombatEventCardsCollapsed() {
    combatEventState.cardsCollapsed = !combatEventState.cardsCollapsed;
}

export function getCombatEventExpansionRequest() {
    return combatEventState.eventExpansionRequest;
}

export function setCombatEventExpansionRequest(request) {
    combatEventState.eventExpansionRequest = request;
}

export function clearCombatEventExpansionRequest() {
    combatEventState.eventExpansionRequest = null;
}

export function isCombatEventDeletionPending() {
    return combatEventState.combatEventDeletionPending;
}

export function markCombatEventDeletionPending() {
    combatEventState.combatEventDeletionPending = true;
}

export function clearCombatEventDeletionPending() {
    combatEventState.combatEventDeletionPending = false;
}

export function getPendingDamageRollTimer(messageId) {
    return combatEventState.pendingDamageRolls.get(messageId);
}

export function setPendingDamageRollTimer(messageId, timeoutId) {
    combatEventState.pendingDamageRolls.set(messageId, timeoutId);
}

export function deletePendingDamageRollTimer(messageId) {
    combatEventState.pendingDamageRolls.delete(messageId);
}

export function hasPendingDamageRoll(messageId) {
    return combatEventState.pendingDamageRolls.has(messageId);
}

export function addPendingDamageApplication(application) {
    combatEventState.pendingDamageApplications.push(application);
}

export function removePendingDamageApplication(application) {
    const index = combatEventState.pendingDamageApplications.lastIndexOf(application);
    if (index >= 0) combatEventState.pendingDamageApplications.splice(index, 1);
}

export function findPendingDamageApplicationForActor(actorUuid) {
    return [...combatEventState.pendingDamageApplications].reverse().find((candidate) =>
        !candidate.actorUuids.size || candidate.actorUuids.has(actorUuid)
    ) ?? null;
}

export function hasCompletedDamageApplication(messageId) {
    return combatEventState.completedDamageApplicationMessageIds.has(messageId);
}

export function recordCompletedDamageApplication(messageId) {
    combatEventState.completedDamageApplicationMessageIds.add(messageId);
}

export function hasPendingLegacyTickMessage(messageId) {
    return combatEventState.pendingLegacyTickMessages.has(messageId);
}

export function addPendingLegacyTickMessage(messageId) {
    combatEventState.pendingLegacyTickMessages.add(messageId);
}

export function deletePendingLegacyTickMessage(messageId) {
    combatEventState.pendingLegacyTickMessages.delete(messageId);
}
