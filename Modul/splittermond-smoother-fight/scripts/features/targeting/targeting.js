import { targetingState } from "./state.js";

import { services } from "../../core/services.js";

import {
    normalizeTargetReferences,
    normalizeTargetSelection,
    uniqueTokensByReference,
    withTemporarySetValues,
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

export async function setTargetFromQuickMenu(context, uuid, { additive = false, replaceSelection = !additive } = {}) {
    const recipient = runtimeControllerFor(context);
    if (!recipient) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.RuntimeControllerUnavailable"));
        return false;
    }
    if (!canChooseTarget(context, recipient)) return false;
    const token = resolveToken(uuid);
    if (!token) return false;
    const liveContext = recipient.id === context.runtimeController?.id
        ? context
        : services.getTargetSelectionForUser(recipient);
    const current = new Set(liveContext.targets.map((candidate) => candidate.uuid));
    const alreadySelected = current.has(token.uuid);
    if (additive && alreadySelected) return false;
    const existingPrimaryTargetUuid = liveContext.target?.uuid
        ?? targetingState.primaryTargetByUser.get(recipient.id)
        ?? null;
    if (replaceSelection) {
        current.clear();
        current.add(token.uuid);
    }
    else current.add(token.uuid);
    const primaryTargetTokenUuid = additive
        ? existingPrimaryTargetUuid ?? token.uuid
        : token.uuid;
    const selection = rememberTargetReferences(recipient.id, current, primaryTargetTokenUuid);
    const releaseOthers = replaceSelection;

    if (recipient.id === game.user.id) {
        setLocalTarget(token, true, releaseOthers);
        publishOwnTarget(selection.targetTokenUuids, selection.primaryTargetTokenUuid);
    } else {
        emitRemoteSetTarget(recipient.id, token, true, selection, releaseOthers);
        emitTargetUpdate(recipient.id, selection);
    }
    ui.notifications.info(t(additive ? "SMOOTHER_FIGHT.HUD.TargetAdded" : "SMOOTHER_FIGHT.HUD.PrimaryTargetChanged", { target: token.name }));
    services.scheduleRender();
    return true;
}

export async function removeTargetFromQuickMenu(context, uuid) {
    const recipient = runtimeControllerFor(context);
    if (!recipient) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.RuntimeControllerUnavailable"));
        return;
    }
    if (!canChooseTarget(context, recipient)) return;
    const token = resolveToken(uuid);
    if (!token) return;
    const liveContext = recipient.id === context.runtimeController?.id
        ? context
        : services.getTargetSelectionForUser(recipient);
    const current = new Set(liveContext.targets.map((candidate) => candidate.uuid));
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

function emitRemoteSetTarget(recipientId, token, targeted, selection, releaseOthers = false) {
    game.socket.emit(SOCKET, {
        type: "set-target",
        senderId: game.user.id,
        recipientId,
        tokenUuid: token.uuid,
        targeted,
        releaseOthers,
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

export function canChooseTarget(context, runtimeController = runtimeControllerFor(context)) {
    return Boolean(
        game.user.isGM ||
        runtimeController?.id === game.user.id
    );
}

function runtimeControllerFor(context) {
    const subject = context?.combatant ?? context?.token ?? context?.actor ?? null;
    const resolved = subject ? services.getRuntimeController?.(subject) : null;
    const controller = resolved ?? context?.runtimeController ?? null;
    return controller?.active ? controller : null;
}

export async function withTemporarySystemTargets(targets, callback) {
    // Splittermond 14.3 resolves attack and resistance-spell difficulty from the
    // first entry of game.user.targets inside Skill.roll(); its actor roll API has
    // no target parameter. Keep that system-facing state exact and transactional.
    const targetSet = game.user?.targets;
    const requested = Array.from(targets ?? []).filter(Boolean);
    if (!requested.length) return callback();
    if (!targetSet?.clear || !targetSet?.add) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.SystemTargetUnavailable"));
        return null;
    }
    const targetObjects = requested.map((target) => {
        if (target.document) return target;
        return target.object ?? canvas?.tokens?.get?.(target.id) ?? null;
    }).filter(Boolean);
    if (targetObjects.length !== requested.length) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.SystemTargetUnavailable"));
        return null;
    }
    return withTemporarySetValues(targetSet, targetObjects, callback);
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
