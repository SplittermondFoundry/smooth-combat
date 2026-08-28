import {
    services,
} from "../../core/services.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    APPLICATION_STALE_AFTER_MS,
    effectiveApplicationState,
    nextApplicationRecord,
} from "../../shared/application-state.js";

import {
    setRequiredDocumentFlag,
} from "../../shared/document-flags.js";

import {
    t,
} from "../../shared/values.js";

import {
    beginContinuousAction,
} from "./continuous-action.js";

const preparationLocks = new Set();
const movementReversalLocks = new Set();
const staleApplicationTimers = new Map();

export function getPreparationApplicationStatus(actor, now = Date.now()) {
    const record = actor?.getFlag?.(MODULE_ID, "preparationApplication")
        ?? actor?.flags?.[MODULE_ID]?.preparationApplication
        ?? null;
    let state = effectiveApplicationState(record, { now });
    if (record?.itemId && preparedItemId(actor, record.kind) === record.itemId) state = "completed";
    else if (state === "completed") state = "idle";
    if (state === "applying") scheduleStaleRender(`preparation:${actor?.id}`, record);
    return { state, record };
}

export async function prepareCombatAction(context, { kind, itemId, ticks, label }) {
    const actor = context?.actor;
    if (!actor || !["attack", "spell"].includes(kind) || !itemId || !Number.isFinite(Number(ticks))) return false;
    const lockKey = actor.uuid ?? actor.id;
    if (!lockKey || preparationLocks.has(lockKey) || getPreparationApplicationStatus(actor).state !== "idle") return false;
    preparationLocks.add(lockKey);
    const previousInitiative = combatantInitiative(context.combatant);
    let applying = null;
    try {
        applying = await setPreparationApplicationState(actor, "applying", {
            kind,
            itemId,
            ticks: Number(ticks),
            previousInitiative: Number.isFinite(previousInitiative) ? previousInitiative : null,
            initiatedBy: game.user?.id ?? null,
        });
        try {
            await actor.addTicks(Number(ticks), label);
        } catch (error) {
            const changed = initiativeChanged(context.combatant, previousInitiative);
            await persistPreparationFailureState(actor, changed === false ? "idle" : "uncertain", applying);
            throw error;
        }

        try {
            await actor.setFlag("splittermond", preparedFlag(kind), itemId);
        } catch (error) {
            if (preparedItemId(actor, kind) !== itemId) {
                await persistPreparationFailureState(actor, "uncertain", applying);
                throw error;
            }
            console.debug(`${MODULE_ID} | Prepared ${kind} flag rejected after a matching read-back`, error);
        }

        try {
            await setPreparationApplicationState(actor, "completed");
        } catch (error) {
            const stored = actor.getFlag?.(MODULE_ID, "preparationApplication")
                ?? actor.flags?.[MODULE_ID]?.preparationApplication;
            if (stored?.state === "completed") {
                services.scheduleRender(0);
                return true;
            }
            await persistPreparationFailureState(actor, "uncertain", applying);
            throw error;
        }
        await beginContinuousAction(context, {
            actionId: kind === "attack" ? "readyRangedAttack" : "focusMagic",
            startTick: previousInitiative,
            endTick: combatantInitiative(context.combatant),
        });
        services.scheduleRender(0);
        return true;
    } finally {
        preparationLocks.delete(lockKey);
    }
}

export async function clearPreparationApplication(actor, kind) {
    await actor.setFlag("splittermond", preparedFlag(kind), null);
    const existing = actor.getFlag?.(MODULE_ID, "preparationApplication")
        ?? actor.flags?.[MODULE_ID]?.preparationApplication;
    if (existing && typeof existing === "object") {
        await setPreparationApplicationState(actor, "idle", { clearedBy: game.user?.id ?? null });
    }
}

export async function recoverPreparationApplication(actor, decision) {
    if (!game.user?.isGM || !actor || !["retry", "complete"].includes(decision)) return false;
    const { state, record } = getPreparationApplicationStatus(actor);
    if (state !== "uncertain" || !record?.itemId || !["attack", "spell"].includes(record.kind)) return false;
    if (decision === "complete") {
        await actor.setFlag("splittermond", preparedFlag(record.kind), record.itemId);
        await setPreparationApplicationState(actor, "completed", { recoveredBy: game.user.id });
    } else {
        await setPreparationApplicationState(actor, "idle", { recoveredBy: game.user.id });
    }
    notifyRecovery(decision);
    services.scheduleRender(0);
    return true;
}

export function getMovementReversalApplicationStatus(tokenLike, now = Date.now()) {
    const token = tokenLike?.document ?? tokenLike;
    const record = token?.getFlag?.(MODULE_ID, "movementReversalApplication")
        ?? token?.flags?.[MODULE_ID]?.movementReversalApplication
        ?? null;
    if (!record || record.historyFingerprint !== movementHistoryFingerprint(token)) return { state: "idle", record };
    const state = effectiveApplicationState(record, { now });
    if (state === "applying") scheduleStaleRender(`movement:${token?.uuid ?? token?.id}`, record);
    return { state, record };
}

export async function revertTokenMovementApplication(context) {
    const token = context?.token?.document ?? context?.token;
    if (!token || typeof token.revertRecordedMovement !== "function") return false;
    if (typeof token.setFlag !== "function") {
        const reverted = await token.revertRecordedMovement();
        if (!reverted) return false;
        await token.clearMovementHistory?.();
        services.scheduleRender(0);
        return true;
    }
    const lockKey = token.uuid ?? token.id ?? token;
    if (!lockKey || movementReversalLocks.has(lockKey) || getMovementReversalApplicationStatus(token).state !== "idle") return false;
    movementReversalLocks.add(lockKey);
    const historyFingerprint = movementHistoryFingerprint(token);
    const previousPosition = tokenPositionFingerprint(token);
    let applying = null;
    try {
        applying = await setMovementReversalApplicationState(token, "applying", {
            historyFingerprint,
            previousPosition,
            initiatedBy: game.user?.id ?? null,
        });
        let reverted;
        try {
            reverted = await token.revertRecordedMovement();
        } catch (error) {
            const changed = tokenPositionFingerprint(token) !== previousPosition;
            await persistMovementFailureState(token, changed ? "uncertain" : "idle", applying);
            throw error;
        }
        if (!reverted) {
            const changed = tokenPositionFingerprint(token) !== previousPosition;
            await setMovementReversalApplicationState(token, changed ? "uncertain" : "idle");
            return false;
        }
        try {
            await token.clearMovementHistory?.();
        } catch (error) {
            await persistMovementFailureState(token, "uncertain", applying);
            throw error;
        }
        try {
            await setMovementReversalApplicationState(token, "completed");
        } catch (error) {
            await persistMovementFailureState(token, "uncertain", applying);
            throw error;
        }
        services.scheduleRender(0);
        return true;
    } finally {
        movementReversalLocks.delete(lockKey);
    }
}

export async function recoverMovementReversalApplication(tokenLike, decision) {
    const token = tokenLike?.document ?? tokenLike;
    if (!game.user?.isGM || !token || !["retry", "complete"].includes(decision)) return false;
    if (getMovementReversalApplicationStatus(token).state !== "uncertain") return false;
    if (decision === "complete") await token.clearMovementHistory?.();
    await setMovementReversalApplicationState(token, decision === "complete" ? "completed" : "idle", {
        recoveredBy: game.user.id,
    });
    notifyRecovery(decision);
    services.scheduleRender(0);
    return true;
}

export async function resetCompletedMovementReversalApplication(tokenLike) {
    const token = tokenLike?.document ?? tokenLike;
    const record = token?.getFlag?.(MODULE_ID, "movementReversalApplication")
        ?? token?.flags?.[MODULE_ID]?.movementReversalApplication;
    if (!token || record?.state !== "completed") return false;
    try {
        await setMovementReversalApplicationState(token, "idle", { resetAfterMovement: true });
        return true;
    } catch (error) {
        console.error(`${MODULE_ID} | Could not reset completed movement reversal state`, error);
        return false;
    }
}

async function setPreparationApplicationState(actor, state, details = {}) {
    const previous = actor.getFlag?.(MODULE_ID, "preparationApplication")
        ?? actor.flags?.[MODULE_ID]?.preparationApplication;
    const record = nextApplicationRecord(previous, state, details);
    await setRequiredDocumentFlag(actor, "preparationApplication", record);
    if (state !== "applying") clearStaleRender(`preparation:${actor?.id}`);
    return record;
}

async function persistPreparationFailureState(actor, state, fallback) {
    try {
        const previous = actor.getFlag?.(MODULE_ID, "preparationApplication")
            ?? actor.flags?.[MODULE_ID]?.preparationApplication
            ?? fallback;
        await setRequiredDocumentFlag(actor, "preparationApplication", nextApplicationRecord(previous, state));
    } catch (error) {
        console.error(`${MODULE_ID} | Could not persist ${state} preparation state`, error);
    }
}

async function setMovementReversalApplicationState(token, state, details = {}) {
    const previous = token.getFlag?.(MODULE_ID, "movementReversalApplication")
        ?? token.flags?.[MODULE_ID]?.movementReversalApplication;
    const record = nextApplicationRecord(previous, state, details);
    await setRequiredDocumentFlag(token, "movementReversalApplication", record);
    if (state !== "applying") clearStaleRender(`movement:${token?.uuid ?? token?.id}`);
    return record;
}

async function persistMovementFailureState(token, state, fallback) {
    try {
        const previous = token.getFlag?.(MODULE_ID, "movementReversalApplication")
            ?? token.flags?.[MODULE_ID]?.movementReversalApplication
            ?? fallback;
        await setRequiredDocumentFlag(token, "movementReversalApplication", nextApplicationRecord(previous, state));
    } catch (error) {
        console.error(`${MODULE_ID} | Could not persist ${state} movement reversal state`, error);
    }
}

function preparedFlag(kind) {
    return kind === "attack" ? "preparedAttack" : "preparedSpell";
}

function preparedItemId(actor, kind) {
    return actor?.getFlag?.("splittermond", preparedFlag(kind));
}

function combatantInitiative(combatant) {
    const current = game.combat?.combatants?.get?.(combatant?.id) ?? combatant;
    return Number(current?.initiative);
}

function initiativeChanged(combatant, previous) {
    const current = combatantInitiative(combatant);
    if (!Number.isFinite(previous) || !Number.isFinite(current)) return null;
    return current !== previous;
}

function movementHistoryFingerprint(token) {
    const history = token?.movementHistory ?? token?.movement?.history ?? null;
    try {
        return JSON.stringify(history);
    } catch {
        return String(history);
    }
}

function tokenPositionFingerprint(token) {
    return JSON.stringify([token?.x, token?.y, token?.elevation]);
}

function scheduleStaleRender(key, record) {
    const startedAt = Number(record?.startedAt);
    if (!key || !Number.isFinite(startedAt)) return;
    const remaining = APPLICATION_STALE_AFTER_MS - (Date.now() - startedAt);
    if (remaining <= 0 || staleApplicationTimers.has(key)) return;
    const timer = setTimeout(() => {
        staleApplicationTimers.delete(key);
        services.scheduleRender(0);
    }, remaining);
    timer.unref?.();
    staleApplicationTimers.set(key, timer);
}

function clearStaleRender(key) {
    const timer = staleApplicationTimers.get(key);
    if (timer) clearTimeout(timer);
    staleApplicationTimers.delete(key);
}

function notifyRecovery(decision) {
    ui.notifications.info(t(decision === "complete"
        ? "SMOOTHER_FIGHT.HUD.OperationMarkedCompleted"
        : "SMOOTHER_FIGHT.HUD.OperationReset"));
}
