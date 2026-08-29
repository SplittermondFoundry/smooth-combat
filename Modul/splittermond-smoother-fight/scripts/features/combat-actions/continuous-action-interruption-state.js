import {
    services,
} from "../../core/services.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    setRequiredDocumentFlag,
} from "../../shared/document-flags.js";

export const INTERRUPTION_FLAG = "continuousActionInterruptions";
export const INTERRUPTION_VERSION = 1;
const interruptionLocks = new Set();

export function normalizeContinuousActionInterruption(value) {
    if (!value || typeof value !== "object" || Number(value.version) !== INTERRUPTION_VERSION) return null;
    const id = optionalString(value.id);
    const actionRecordId = optionalString(value.actionRecordId);
    const actionId = optionalString(value.actionId);
    const combatId = optionalString(value.combatId);
    const combatantId = optionalString(value.combatantId);
    const tokenUuid = optionalString(value.tokenUuid);
    const actorUuid = optionalString(value.actorUuid);
    const damage = Number(value.damage);
    const difficulty = Number(value.difficulty);
    if (!id || !actionRecordId || !actionId || !combatId || !combatantId || !tokenUuid || !actorUuid
        || !Number.isFinite(damage) || damage <= 0 || !Number.isFinite(difficulty)) {
        return null;
    }
    return {
        version: INTERRUPTION_VERSION,
        id,
        actionRecordId,
        actionId,
        combatId,
        combatantId,
        tokenUuid,
        actorUuid,
        damage,
        disturbingAttackLevels: nonNegativeInteger(value.disturbingAttackLevels),
        difficulty,
        sourceMessageId: optionalString(value.sourceMessageId),
        createdAt: nullableNumber(value.createdAt),
        createdBy: optionalString(value.createdBy),
    };
}

export function readInterruptionRequests(token) {
    const stored = token?.getFlag?.(MODULE_ID, INTERRUPTION_FLAG)
        ?? token?.flags?.[MODULE_ID]?.[INTERRUPTION_FLAG];
    return Array.isArray(stored) ? stored.map(normalizeContinuousActionInterruption).filter(Boolean) : [];
}

export async function clearContinuousActionInterruptionRequests(token, { actionRecordId = null } = {}) {
    if (!token) return false;
    return withInterruptionLock(token, async () => {
        const requests = readInterruptionRequests(token);
        const retained = actionRecordId
            ? requests.filter((request) => request.actionRecordId !== actionRecordId)
            : [];
        if (retained.length === requests.length) return false;
        await setRequiredDocumentFlag(token, INTERRUPTION_FLAG, retained);
        services.scheduleRender?.(0);
        return true;
    });
}

export async function withInterruptionLock(token, operation) {
    const key = token?.uuid ?? token?.id;
    if (!key || interruptionLocks.has(key)) return null;
    interruptionLocks.add(key);
    try {
        return await operation();
    } finally {
        interruptionLocks.delete(key);
    }
}

function optionalString(value) {
    const normalized = String(value ?? "").trim();
    return normalized || null;
}

function nullableNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function nonNegativeInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}
