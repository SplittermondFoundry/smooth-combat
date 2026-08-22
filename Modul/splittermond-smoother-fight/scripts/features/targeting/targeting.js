import { targetingState } from "./state.js";

import { services } from "../../core/services.js";

import {
    normalizeTargetReferences,
    normalizeTargetSelection,
    uniqueTokensByReference,
} from "../../combat-rules.js";

import {
    MODULE_ID,
    SOCKET,
} from "../../core/constants.js";

import {
    t,
} from "../../shared/values.js";

export function getTargetSelectionForUser(user) {
    if (!user) return emptyTargetSelection();
    let selection = rememberTargetReferences(user.id, targetingState.targetByUser.get(user.id));
    if (user.id === game.user.id) {
        selection = rememberTargetReferences(user.id, user.targets);
    }
    const targets = selection.targetTokenUuids
        .map(resolveToken)
        .filter((target) => target && (game.user.isGM || !target.hidden));
    const target = targets.find((candidate) => candidate.uuid === selection.primaryTargetTokenUuid)
        ?? targets.at(-1)
        ?? null;
    const targetTokenUuids = targets.map((candidate) => candidate.uuid);
    const targetActorUuids = targets.map((candidate) => candidate.actor?.uuid).filter(Boolean);
    return {
        targets,
        target,
        targetTokenUuids,
        targetActorUuids,
        primaryTargetTokenUuid: target?.uuid ?? null,
        primaryTargetActorUuid: target?.actor?.uuid ?? null,
        targetTokenUuid: target?.uuid ?? null,
        targetActorUuid: target?.actor?.uuid ?? null,
    };
}

function emptyTargetSelection() {
    return {
        targets: [],
        target: null,
        targetTokenUuids: [],
        targetActorUuids: [],
        primaryTargetTokenUuid: null,
        primaryTargetActorUuid: null,
        targetTokenUuid: null,
        targetActorUuid: null,
    };
}

export function rememberTargetReferences(
    userId,
    references,
    primaryTargetTokenUuid = targetingState.primaryTargetByUser.get(userId)
) {
    const selection = normalizeTargetSelection(references, primaryTargetTokenUuid);
    targetingState.targetByUser.set(userId, selection.targetTokenUuids);
    targetingState.primaryTargetByUser.set(userId, selection.primaryTargetTokenUuid);
    return selection;
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
    const alreadySelected = current.has(token.uuid);
    const existingPrimaryTargetUuid = context.target?.uuid
        ?? targetingState.primaryTargetByUser.get(recipient.id)
        ?? null;
    current.add(token.uuid);
    const primaryTargetTokenUuid = alreadySelected
        ? token.uuid
        : existingPrimaryTargetUuid ?? token.uuid;
    const selection = rememberTargetReferences(recipient.id, current, primaryTargetTokenUuid);

    if (recipient.id === game.user.id) {
        if (!alreadySelected) setLocalTarget(token, true, false);
        publishOwnTarget(selection.targetTokenUuids, selection.primaryTargetTokenUuid);
    } else {
        if (!alreadySelected) emitRemoteSetTarget(recipient.id, token, true, selection);
        emitTargetUpdate(recipient.id, selection);
    }
    ui.notifications.info(t(alreadySelected ? "SMOOTHER_FIGHT.HUD.PrimaryTargetChanged" : "SMOOTHER_FIGHT.HUD.TargetAdded", { target: token.name }));
    services.scheduleRender();
}

export async function removeTargetFromQuickMenu(context, uuid) {
    if (!canChooseTarget(context)) return;
    const token = resolveToken(uuid);
    if (!token) return;
    const recipient = game.user.isGM ? (context.linkedUser ?? game.user) : game.user;
    const current = new Set(context.targets.map((candidate) => candidate.uuid));
    if (!current.delete(token.uuid)) return;
    const selection = rememberTargetReferences(recipient.id, current);

    if (recipient.id === game.user.id) {
        setLocalTarget(token, false, false);
        publishOwnTarget(selection.targetTokenUuids, selection.primaryTargetTokenUuid);
    } else {
        emitRemoteSetTarget(recipient.id, token, false, selection);
        emitTargetUpdate(recipient.id, selection);
    }
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.TargetRemoved", { target: token.name }));
    services.scheduleRender();
}

function emitRemoteSetTarget(recipientId, token, targeted, selection) {
    game.socket.emit(SOCKET, {
        type: "set-target",
        senderId: game.user.id,
        recipientId,
        tokenUuid: token.uuid,
        targeted,
        releaseOthers: false,
        targetUuids: selection.targetTokenUuids,
        primaryTargetTokenUuid: selection.primaryTargetTokenUuid,
        primaryTargetActorUuid: resolveToken(selection.primaryTargetTokenUuid)?.actor?.uuid ?? null,
    });
}

function emitTargetUpdate(userId, selection) {
    const primaryTarget = resolveToken(selection.primaryTargetTokenUuid);
    const targetActorUuids = selection.targetTokenUuids
        .map((uuid) => resolveToken(uuid)?.actor?.uuid)
        .filter(Boolean);
    game.socket.emit(SOCKET, {
        type: "target-update",
        senderId: game.user.id,
        userId,
        targetUuids: selection.targetTokenUuids,
        targetTokenUuids: selection.targetTokenUuids,
        targetActorUuids,
        primaryTargetTokenUuid: selection.primaryTargetTokenUuid,
        primaryTargetActorUuid: primaryTarget?.actor?.uuid ?? null,
        targetTokenUuid: selection.primaryTargetTokenUuid,
        tokenUuid: selection.primaryTargetTokenUuid,
        targetActorUuid: primaryTarget?.actor?.uuid ?? null,
    });
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

export function publishOwnTarget(explicitUuids, explicitPrimaryTargetTokenUuid) {
    if (!game.user) return;
    const targetUuids = normalizeTargetReferences(explicitUuids === undefined ? game.user.targets : explicitUuids);
    const selection = rememberTargetReferences(game.user.id, targetUuids, explicitPrimaryTargetTokenUuid);
    if (game.socket?.emit) emitTargetUpdate(game.user.id, selection);
}
