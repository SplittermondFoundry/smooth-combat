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

export function defensePhaseForOffense(message) {
    if (!isOffensiveCombatMessage(message)) return DEFENSE_PHASE.UNAVAILABLE;
    if (hasOffenseFollowUpStarted(message)) return DEFENSE_PHASE.CLOSED;

    const context = services.getMessageContext(message) ?? {};
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

export function defenseAwaitsResponse(message) {
    return defensePhaseForOffense(message) === DEFENSE_PHASE.OPEN;
}
