import { services } from "../../core/services.js";
import { SOCKET } from "../../core/constants.js";

const remoteTargets = new Map();
const published = new Map();
const keyOf = (userId, tokenUuid) => `${userId}:${tokenUuid}`;

export function clearHudFocusTargetSync() { remoteTargets.clear(); published.clear(); }

export function changeHudFocusMode() {
    published.clear();
    game.socket?.emit?.(SOCKET, { type: "hud-focus-target-update", senderId: game.user.id, reset: true });
    services.scheduleRender?.();
}

export function getPublishedHudFocusTargets(userId, tokenUuid) {
    return remoteTargets.get(keyOf(userId, tokenUuid));
}

export function publishHudFocusTargets(context, value) {
    const tokenUuid = context.token?.uuid;
    if (!tokenUuid) return;
    const targets = { references: value.targets.map(token => token.uuid), primary: value.target?.uuid ?? null };
    const key = keyOf(game.user.id, tokenUuid), signature = JSON.stringify(targets);
    if (published.get(key) === signature) return;
    published.set(key, signature);
    game.socket?.emit?.(SOCKET, { type: "hud-focus-target-update", senderId: game.user.id, tokenUuid,
        targetTokenUuids: targets.references, primaryTargetTokenUuid: targets.primary });
}

// Called only after lifecycle has authenticated the socket sender.
export function receiveHudFocusTargets(payload, sender) {
    if (payload.reset === true) {
        for (const key of remoteTargets.keys()) if (key.startsWith(`${sender.id}:`)) remoteTargets.delete(key);
        services.scheduleRender?.();
        return true;
    }
    const token = services.resolveToken?.(payload.tokenUuid);
    if (!token?.actor || (!sender.isGM && !token.actor.testUserPermission?.(sender, "OWNER"))) return false;
    if (!Array.isArray(payload.targetTokenUuids) || !payload.targetTokenUuids.every(id => typeof id === "string")) return false;
    const references = [...new Set(payload.targetTokenUuids)];
    const primary = references.includes(payload.primaryTargetTokenUuid) ? payload.primaryTargetTokenUuid : references.at(-1) ?? null;
    remoteTargets.set(keyOf(sender.id, token.uuid), { references, primary });
    services.scheduleRender?.();
    return true;
}
