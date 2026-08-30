import { MODULE_ID } from "../../core/constants.js";
import {
    COMBAT_POSITION_ICONS,
    resolveCombatPosition,
} from "./positions.js";

const OVERLAY_LABEL = `${MODULE_ID}.combat-position-overlay`;
const overlayRefreshVersions = new WeakMap();

export function combatPositionOverlayPresentation(actor) {
    const position = resolveCombatPosition(actor);
    const icon = position.ambiguous ? null : COMBAT_POSITION_ICONS[position.id];
    return icon ? { id: position.id, icon } : null;
}

export async function refreshCombatPositionOverlay(tokenLike) {
    const token = canvasTokenObject(tokenLike);
    if (!token?.actor || typeof token.addChild !== "function") return false;

    const version = (overlayRefreshVersions.get(token) ?? 0) + 1;
    overlayRefreshVersions.set(token, version);
    const presentation = combatPositionOverlayPresentation(token.actor);
    const currentOverlay = findOverlay(token);

    if (!presentation) {
        removeOverlay(currentOverlay);
        return Boolean(currentOverlay);
    }
    if (currentOverlay?.combatPositionId === presentation.id) {
        layoutOverlay(currentOverlay, token);
        return true;
    }

    removeOverlay(currentOverlay);
    const texture = await loadOverlayTexture(presentation.icon);
    if (!texture || overlayRefreshVersions.get(token) !== version) return false;
    const latestPresentation = combatPositionOverlayPresentation(token.actor);
    if (latestPresentation?.id !== presentation.id || latestPresentation.icon !== presentation.icon) return false;

    const Sprite = globalThis.PIXI?.Sprite;
    if (!Sprite) return false;
    const overlay = typeof Sprite.from === "function" ? Sprite.from(texture) : new Sprite(texture);
    overlay.name = OVERLAY_LABEL;
    overlay.label = OVERLAY_LABEL;
    overlay.combatPositionId = presentation.id;
    overlay.eventMode = "none";
    overlay.interactive = false;
    overlay.alpha = 0.72;
    overlay.zIndex = 1000;
    overlay.anchor?.set?.(0.5, 0.5);
    layoutOverlay(overlay, token);
    token.addChild(overlay);
    return true;
}

export function refreshCombatPositionOverlaysForActor(actor) {
    if (!actor) return Promise.resolve([]);
    const tokens = Array.from(globalThis.canvas?.tokens?.placeables ?? [])
        .filter((token) => actorsMatch(token?.actor, actor));
    return Promise.allSettled(tokens.map((token) => refreshCombatPositionOverlay(token)));
}

export function refreshAllCombatPositionOverlays() {
    const updates = Array.from(globalThis.canvas?.tokens?.placeables ?? [])
        .map((token) => refreshCombatPositionOverlay(token));
    return Promise.allSettled(updates);
}

function canvasTokenObject(tokenLike) {
    if (tokenLike?.actor && typeof tokenLike.addChild === "function") return tokenLike;
    return tokenLike?.object ?? tokenLike?.document?.object ?? null;
}

function findOverlay(token) {
    return token.getChildByLabel?.(OVERLAY_LABEL)
        ?? token.getChildByName?.(OVERLAY_LABEL)
        ?? Array.from(token.children ?? []).find((child) =>
            child?.label === OVERLAY_LABEL || child?.name === OVERLAY_LABEL
        )
        ?? null;
}

function removeOverlay(overlay) {
    if (!overlay) return;
    overlay.parent?.removeChild?.(overlay);
    overlay.destroy?.({ children: true });
}

function layoutOverlay(overlay, token) {
    const width = positiveDimension(token.w ?? token.width);
    const height = positiveDimension(token.h ?? token.height);
    const size = Math.max(24, Math.min(width, height) * 0.62);
    overlay.width = size;
    overlay.height = size;
    overlay.x = width / 2;
    overlay.y = height / 2;
}

async function loadOverlayTexture(icon) {
    const loader = globalThis.foundry?.canvas?.loadTexture ?? globalThis.loadTexture;
    if (typeof loader !== "function") return null;
    try {
        return await loader(icon);
    } catch (error) {
        console.debug(`${MODULE_ID} | Could not load combat position overlay`, error);
        return null;
    }
}

function actorsMatch(left, right) {
    return left === right
        || (left?.uuid && left.uuid === right?.uuid)
        || (left?.id && left.id === right?.id);
}

function positiveDimension(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 100;
}
