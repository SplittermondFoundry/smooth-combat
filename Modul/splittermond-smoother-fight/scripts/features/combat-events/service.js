import { combatEventState } from "./state.js";

import { services } from "../../core/services.js";

import {
    isOffensiveCombatMessage,
} from "../../combat-rules.js";

import {
    getSetting,
} from "../../shared/values.js";

export function collectCombatEventGroups(context) {
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
            ? groups.find((candidate) => candidate.primary.id === fumble.sourceMessageId)
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

    const max = Number(getSetting("maxCards", 3)) || 3;
    return groups.slice(-max);
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
