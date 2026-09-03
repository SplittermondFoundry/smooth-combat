import {
    MODULE_ID,
    SOCKET,
} from "../../core/constants.js";

import { services } from "../../core/services.js";

import { activeDefenseState } from "./state.js";

function primaryTargetTokenUuid(context) {
    return context?.primaryTargetTokenUuid ?? context?.targetTokenUuid ?? null;
}

function primaryTargetActorUuid(context) {
    return context?.primaryTargetActorUuid ?? context?.targetActorUuid ?? null;
}

export function normalizePendingDefense(value) {
    if (!value || typeof value !== "object" || typeof value.attackMessageId !== "string") return null;
    const targetTokenUuid = primaryTargetTokenUuid(value);
    const targetActorUuid = primaryTargetActorUuid(value);
    return {
        pendingDefenseId: typeof value.pendingDefenseId === "string" ? value.pendingDefenseId : null,
        attackMessageId: value.attackMessageId,
        primaryTargetTokenUuid: typeof targetTokenUuid === "string" ? targetTokenUuid : null,
        primaryTargetActorUuid: typeof targetActorUuid === "string" ? targetActorUuid : null,
        targetTokenUuid: typeof targetTokenUuid === "string" ? targetTokenUuid : null,
        targetActorUuid: typeof targetActorUuid === "string" ? targetActorUuid : null,
        defenderTokenUuid: typeof value.defenderTokenUuid === "string" ? value.defenderTokenUuid : null,
        defenderActorUuid: typeof value.defenderActorUuid === "string" ? value.defenderActorUuid : null,
        defenseId: typeof value.defenseId === "string" ? value.defenseId : null,
        defenseSkillId: typeof value.defenseSkillId === "string" ? value.defenseSkillId : null,
        assisted: Boolean(value.assisted),
        distractingFeatureValue: Math.max(0, Number(value.distractingFeatureValue) || 0),
        activeDefenseDifficulty: Number.isFinite(Number(value.activeDefenseDifficulty))
            ? Number(value.activeDefenseDifficulty)
            : 15,
        startedAt: Number(value.startedAt) || 0,
        expiresAt: Number(value.expiresAt) || Date.now() + 60 * 1000,
    };
}

export function clearPendingDefense(pendingDefenseId) {
    if (!pendingDefenseId) return;
    const pending = activeDefenseState.rollingDefenses.get(pendingDefenseId)
        ?? (activeDefenseState.pendingDefense?.pendingDefenseId === pendingDefenseId
            ? activeDefenseState.pendingDefense
            : null);
    const cleanups = activeDefenseState.pendingDefenseCleanups.get(pendingDefenseId);
    activeDefenseState.pendingDefenseCleanups.delete(pendingDefenseId);
    for (const cleanup of cleanups ?? []) {
        try {
            cleanup();
        } catch (error) {
            console.debug(`${MODULE_ID} | Could not clean up an active-defense interceptor`, error);
        }
    }
    const timeoutId = activeDefenseState.pendingDefenseTimers.get(pendingDefenseId);
    if (timeoutId) clearTimeout(timeoutId);
    activeDefenseState.pendingDefenseTimers.delete(pendingDefenseId);
    activeDefenseState.rollingDefenses.delete(pendingDefenseId);
    if (activeDefenseState.pendingDefense?.pendingDefenseId === pendingDefenseId) {
        activeDefenseState.pendingDefense = null;
    }
    if (pending) publishPendingDefense(pending, false);
    services.scheduleRender?.(0);
}

export function publishPendingDefense(pending, active = true) {
    const normalized = normalizePendingDefense(pending);
    if (!normalized?.pendingDefenseId || !globalThis.game?.socket?.emit) return false;
    game.socket.emit(SOCKET, {
        type: "active-defense-pending",
        senderId: game.user?.id,
        active: Boolean(active),
        pending: normalized,
    });
    return true;
}

export function receivePublishedPendingDefense(value, senderId, active = true) {
    const pending = normalizePendingDefense(value);
    if (!pending?.pendingDefenseId || typeof senderId !== "string") return false;
    if (!active) {
        const existing = activeDefenseState.publishedPendingDefenses.get(pending.pendingDefenseId);
        if (existing?.senderId !== senderId) return false;
        activeDefenseState.publishedPendingDefenses.delete(pending.pendingDefenseId);
    } else {
        activeDefenseState.publishedPendingDefenses.set(pending.pendingDefenseId, {
            ...pending,
            senderId,
        });
    }
    services.scheduleRender?.(0);
    return true;
}

export function registerPendingDefenseCleanup(pendingDefenseId, cleanup) {
    const cleanups = activeDefenseState.pendingDefenseCleanups.get(pendingDefenseId) ?? new Set();
    cleanups.add(cleanup);
    activeDefenseState.pendingDefenseCleanups.set(pendingDefenseId, cleanups);
    return () => {
        cleanups.delete(cleanup);
        if (cleanups.size === 0) activeDefenseState.pendingDefenseCleanups.delete(pendingDefenseId);
    };
}
