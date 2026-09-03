import { services } from "../../core/services.js";

import {
    isOffensiveCombatMessage,
} from "../../combat-rules.js";

export const DEFENSE_PHASE = Object.freeze({
    OPEN: "open",
    RESOLVED: "resolved",
    DECLINED: "declined",
    CLOSED: "closed",
    UNAVAILABLE: "unavailable",
});

const PERSISTED_PHASES = new Set(Object.values(DEFENSE_PHASE));

function contentOffersActiveDefense(message) {
    return /data-local-?action\s*=\s*["']activeDefense["']/iu.test(String(message?.content ?? ""));
}

function improvedOffenseOffersActiveDefense(message, context) {
    return !context.defenseDeclinedAt
        && !context.defenseMessageId
        && !context.defenseMessageIds?.length
        && !context.supersededBy
        && !context.recalculatedFrom
        && (contentOffersActiveDefense(message)
            || (context.initialCheckSucceeded === false && message.system?.checkReport?.succeeded === true));
}

export function hasOffenseFollowUpStarted(message) {
    const system = message?.system;
    return Boolean(
        system?.damageHandler?.used
        || system?.damageHandler?.damageUsed
        || system?.focusCostHandler?.used
        || system?.tickCostHandler?.used
    );
}

export function initialDefensePhaseForOffense(message) {
    return Boolean(
        isOffensiveCombatMessage(message)
        && message.system?.checkReport?.succeeded
        && contentOffersActiveDefense(message)
    ) ? DEFENSE_PHASE.OPEN : DEFENSE_PHASE.UNAVAILABLE;
}

export async function reopenDefensePhaseAfterOutcomeChange(message) {
    if (!isOffensiveCombatMessage(message)) return null;
    if (hasOffenseFollowUpStarted(message)) return null;

    const context = services.getMessageContext(message) ?? {};
    if (context.defensePhase !== DEFENSE_PHASE.UNAVAILABLE) return null;
    if (!improvedOffenseOffersActiveDefense(message, context)) return null;
    if (!(context.primaryTargetTokenUuid ?? context.targetTokenUuid ?? context.primaryTargetActorUuid ?? context.targetActorUuid)) {
        return null;
    }

    await services.setRequiredFlag(message, "context", {
        ...context,
        defensePhase: DEFENSE_PHASE.OPEN,
        defenseOpenedAt: Date.now(),
        defenseOpenReason: "outcome-improved",
    });
    return message;
}

export function defensePhaseForOffense(message) {
    if (!isOffensiveCombatMessage(message)) return DEFENSE_PHASE.UNAVAILABLE;
    if (hasOffenseFollowUpStarted(message)) return DEFENSE_PHASE.CLOSED;

    const context = services.getMessageContext(message) ?? {};
    if (context.defensePhase === DEFENSE_PHASE.UNAVAILABLE && improvedOffenseOffersActiveDefense(message, context)) {
        return DEFENSE_PHASE.OPEN;
    }
    if (PERSISTED_PHASES.has(context.defensePhase)) return context.defensePhase;
    if (context.defenseDeclinedAt) return DEFENSE_PHASE.DECLINED;
    if (context.defenseMessageIds?.length || context.defenseMessageId || context.recalculatedFrom) {
        return DEFENSE_PHASE.RESOLVED;
    }
    if (message.system?.checkReport?.succeeded && contentOffersActiveDefense(message)) {
        return DEFENSE_PHASE.OPEN;
    }
    return DEFENSE_PHASE.UNAVAILABLE;
}

export function defenseAllowsModification(message) {
    const phase = defensePhaseForOffense(message);
    return phase === DEFENSE_PHASE.OPEN || phase === DEFENSE_PHASE.RESOLVED;
}

export function hasActorDeclinedDefense(message, actorUuid) {
    if (!message || !actorUuid) return false;
    const context = services.getMessageContext(message) ?? {};
    return Array.from(context.declinedDefenseActorUuids ?? []).includes(actorUuid);
}

export function hasTokenDeclinedDefense(message, tokenUuid) {
    if (!message || !tokenUuid) return false;
    const context = services.getMessageContext(message) ?? {};
    return Array.from(context.declinedDefenseTokenUuids ?? []).includes(tokenUuid);
}

export function hasDefenseParticipantDecided(context, { actorUuid = null, tokenUuid = null } = {}) {
    const attemptedActors = new Set(context?.attemptedDefenseActorUuids ?? []);
    const attemptedTokens = new Set(context?.attemptedDefenseTokenUuids ?? []);
    const declinedActors = new Set(context?.declinedDefenseActorUuids ?? []);
    const declinedTokens = new Set(context?.declinedDefenseTokenUuids ?? []);
    return Boolean(
        (tokenUuid && (attemptedTokens.has(tokenUuid) || declinedTokens.has(tokenUuid)))
        || (actorUuid && (attemptedActors.has(actorUuid) || declinedActors.has(actorUuid)))
    );
}

export function defensePhaseAfterParticipantDecision(context, {
    targetActorUuid = null,
    targetTokenUuid = null,
    eligibleDefenderRemains = false,
} = {}) {
    const targetDecisionPending = Boolean(
        (targetActorUuid || targetTokenUuid)
        && !hasDefenseParticipantDecided(context, {
            actorUuid: targetActorUuid,
            tokenUuid: targetTokenUuid,
        })
    );
    if (targetDecisionPending || eligibleDefenderRemains) return DEFENSE_PHASE.OPEN;
    const defenseAttempted = Boolean(
        context?.defenseMessageId
        || context?.defenseMessageIds?.length
        || context?.attemptedDefenseActorUuids?.length
        || context?.attemptedDefenseTokenUuids?.length
    );
    return defenseAttempted ? DEFENSE_PHASE.RESOLVED : DEFENSE_PHASE.DECLINED;
}

export function defenseAwaitsResponse(message) {
    return defensePhaseForOffense(message) === DEFENSE_PHASE.OPEN;
}
