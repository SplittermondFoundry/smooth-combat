import { targetingState } from "./state.js";

import { services } from "../../core/services.js";

import {
    normalizeTargetReferences,
    uniqueTokensByReference,
} from "../../combat-rules.js";

import {
    MODULE_ID,
    SOCKET,
} from "../../core/constants.js";

import {
    t,
} from "../../shared/values.js";

export function getTargetsForUser(user) {
    if (!user) return [];
    let uuids = normalizeTargetReferences(targetingState.targetByUser.get(user.id));
    if (user.id === game.user.id) {
        uuids = normalizeTargetReferences(user.targets);
        targetingState.targetByUser.set(user.id, uuids);
    }
    return uuids.map(resolveToken).filter((target) => target && (game.user.isGM || !target.hidden));
}

export function rememberTargetReferences(userId, references) {
    targetingState.targetByUser.set(userId, references);
}

export function getSceneTokens() {
    const scene = canvas?.scene;
    if (!scene) return [];
    return Array.from(scene.tokens ?? []).filter((token) => game.user.isGM || !token.hidden);
}

export function getAllSceneTokens() {
    return Array.from(game.scenes ?? []).flatMap((scene) => Array.from(scene.tokens ?? []));
}

export function getTargetSceneTokens(combat) {
    const sceneId = canvas?.scene?.id;
    const combatTokens = Array.from(combat.combatants ?? [])
        .map((combatant) => combatant.token ?? resolveCombatantToken(combatant))
        .filter((token) => token && (!sceneId || token.parent?.id === sceneId) && (game.user.isGM || !token.hidden));
    return uniqueTokensByReference([...combatTokens, ...getSceneTokens()]);
}

export function resolveCombatantToken(combatant) {
    return combatant?.tokenId ? canvas?.scene?.tokens?.get(combatant.tokenId) ?? null : null;
}

export function resolveToken(uuid) {
    if (!uuid) return null;
    const resolved = globalThis.fromUuidSync?.(uuid);
    if (resolved?.documentName === "Token" || resolved?.constructor?.name?.includes("TokenDocument")) return resolved;
    return getSceneTokens().find((token) => token.uuid === uuid || token.id === uuid) ?? null;
}

export function tokenUuid(tokenOrObject) {
    return tokenOrObject?.document?.uuid ?? tokenOrObject?.uuid ?? null;
}

export async function setTargetFromQuickMenu(context, uuid) {
    if (!canChooseTarget(context)) return;
    const token = resolveToken(uuid);
    if (!token) return;
    const recipient = game.user.isGM ? (context.linkedUser ?? game.user) : game.user;
    const current = new Set(context.targets.map((candidate) => candidate.uuid));
    const targeted = !current.has(token.uuid);
    if (targeted) current.add(token.uuid);
    else current.delete(token.uuid);
    const targetUuids = Array.from(current);
    targetingState.targetByUser.set(recipient.id, targetUuids);

    if (recipient.id === game.user.id) {
        setLocalTarget(token, targeted, false);
        publishOwnTarget();
    } else {
        game.socket.emit(SOCKET, {
            type: "set-target",
            senderId: game.user.id,
            recipientId: recipient.id,
            tokenUuid: token.uuid,
            targeted,
            releaseOthers: false,
        });
        game.socket.emit(SOCKET, {
            type: "target-update",
            senderId: game.user.id,
            userId: recipient.id,
            tokenUuids: targetUuids,
        });
    }
    ui.notifications.info(t(targeted ? "SMOOTHER_FIGHT.HUD.TargetAdded" : "SMOOTHER_FIGHT.HUD.TargetRemoved", { target: token.name }));
    services.scheduleRender();
}

export function setLocalTarget(tokenDocument, targeted = true, releaseOthers = false) {
    const tokenObject = tokenDocument.object ?? canvas?.tokens?.get(tokenDocument.id);
    tokenObject?.setTarget(targeted, { user: game.user, releaseOthers, groupSelection: false });
}

export function canChooseTarget(context) {
    return Boolean(
        game.user.isGM ||
        context.linkedUser?.id === game.user.id ||
        (!context.linkedUser && context.actor?.isOwner)
    );
}

export function bindQuickTargetHover(root) {
    for (const button of root.querySelectorAll([
        '.sf-quick-targets [data-sf-action="set-target"]',
        '.sf-personal-combatant-picker [data-sf-action="select-personal-combatant"]',
    ].join(", "))) {
        if (!button.dataset.tokenUuid) continue;
        const highlight = () => highlightToken(button.dataset.tokenUuid);
        button.addEventListener("pointerenter", highlight);
        button.addEventListener("focus", highlight);
        button.addEventListener("pointerleave", clearHoveredToken);
        button.addEventListener("blur", clearHoveredToken);
    }
}

function highlightToken(uuid) {
    const tokenDocument = resolveToken(uuid);
    const tokenObject = tokenDocument?.object ?? canvas?.tokens?.get(tokenDocument?.id);
    if (!tokenObject || targetingState.hoveredToken?.object === tokenObject) return;
    clearHoveredToken();
    targetingState.hoveredToken = { object: tokenObject, wasHovered: Boolean(tokenObject.hover) };
    tokenObject.hover = true;
    refreshTokenHover(tokenObject);
}

export function clearHoveredToken() {
    const state = targetingState.hoveredToken;
    if (!state) return;
    targetingState.hoveredToken = null;
    state.object.hover = state.wasHovered;
    refreshTokenHover(state.object);
}

function refreshTokenHover(tokenObject) {
    try {
        tokenObject.renderFlags?.set?.({ refreshState: true });
        tokenObject.refresh?.();
    } catch (error) {
        console.debug(`${MODULE_ID} | Could not refresh token hover state`, error);
    }
}

export function publishOwnTarget(explicitUuids) {
    if (!game.user) return;
    const targetUuids = normalizeTargetReferences(explicitUuids === undefined ? game.user.targets : explicitUuids);
    targetingState.targetByUser.set(game.user.id, targetUuids);
    game.socket?.emit(SOCKET, {
        type: "target-update",
        senderId: game.user.id,
        userId: game.user.id,
        targetUuids,
        tokenUuid: targetUuids.at(-1) ?? null,
    });
}
