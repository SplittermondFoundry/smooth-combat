import { SOCKET } from "../../core/constants.js";
import { services } from "../../core/services.js";

const REMOTE_MOVEMENT_ABORT_TIMEOUT_MS = 15_000;
const remoteMovementAbortRequests = new Map();

export function requestRemoteMovementPlanAbort(token, combat, planId) {
    const gm = services.getActivePrimaryGm?.();
    const user = globalThis.game?.user;
    if (!gm || !planId || !user || !globalThis.game?.socket?.emit) return Promise.resolve(false);
    const requestId = globalThis.foundry?.utils?.randomID?.()
        ?? `${user.id}:${token.id}:${Date.now()}`;
    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            remoteMovementAbortRequests.delete(requestId);
            resolve(false);
        }, REMOTE_MOVEMENT_ABORT_TIMEOUT_MS);
        remoteMovementAbortRequests.set(requestId, {
            gmId: gm.id,
            planId,
            resolve,
            timeoutId,
            tokenUuid: token.uuid,
        });
        globalThis.game.socket.emit(SOCKET, {
            type: "movement-plan-abort-request",
            senderId: user.id,
            recipientId: gm.id,
            requestId,
            combatId: combat.id,
            tokenUuid: token.uuid,
            planId,
        });
    });
}

export function finishRemoteMovementPlanAbort(payload, sender) {
    const request = remoteMovementAbortRequests.get(payload?.requestId);
    if (!request || sender?.id !== request.gmId
        || payload?.tokenUuid !== request.tokenUuid
        || payload?.planId !== request.planId) return false;
    clearTimeout(request.timeoutId);
    remoteMovementAbortRequests.delete(payload.requestId);
    request.resolve(Boolean(payload.applied));
    return true;
}
