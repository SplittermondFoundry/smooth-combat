import { hudState } from "./state.js";

import { services } from "../../core/services.js";

import { getHudContext } from "./context.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    getSetting,
} from "../../shared/values.js";

export function scheduleRender(delay = 40) {
    clearTimeout(hudState.renderTimer);
    hudState.renderTimer = setTimeout(() => void hudState.hud?.render(), delay);
}

export function scheduleRenderAfterTokenMovement(token) {
    queueMicrotask(() => {
        const object = token?.object ?? canvas?.tokens?.get?.(token?.id);
        const movement = object?.movementAnimationPromise;
        if (!movement || typeof movement.then !== "function") {
            scheduleRender(0);
            return;
        }
        movement.then(
            () => scheduleRender(0),
            () => scheduleRender(0),
        );
    });
}

export function toggleHudMinimizedFromKeybinding() {
    if (!getSetting("enabled", true) || !getHudContext()) return false;
    void setHudMinimized(!getSetting("minimized", false));
    return true;
}

export async function setHudMinimized(minimized) {
    const hud = hudState.hud?.element;
    const shell = hud?.querySelector?.(".sf-shell");
    const previousBounds = shell?.getBoundingClientRect?.();
    await game.settings.set(MODULE_ID, "minimized", minimized);

    // The setting change schedules a regular render. Replace it with this immediate
    // render so it cannot swap out the shell while its transition is still running.
    clearTimeout(hudState.renderTimer);
    hudState.renderTimer = null;
    await hudState.hud?.render?.();

    const nextShell = hudState.hud?.element?.querySelector?.(".sf-shell");
    if (!previousBounds || !nextShell?.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

    const nextBounds = nextShell.getBoundingClientRect();
    if (!previousBounds.width || !previousBounds.height || !nextBounds.width || !nextBounds.height) return;

    const previousCenter = previousBounds.left + previousBounds.width / 2;
    const nextCenter = nextBounds.left + nextBounds.width / 2;
    const offsetX = previousCenter - nextCenter;
    const offsetY = previousBounds.bottom - nextBounds.bottom;
    const scaleX = previousBounds.width / nextBounds.width;
    const scaleY = previousBounds.height / nextBounds.height;
    const animation = nextShell.animate([
        {
            opacity: 0.72,
            transformOrigin: "bottom center",
            transform: `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scaleX}, ${scaleY})`,
        },
        {
            opacity: 1,
            transformOrigin: "bottom center",
            transform: "translate3d(0, 0, 0) scale(1, 1)",
        },
    ], { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" });
    void animation.finished.catch(() => null).finally(() => animation.cancel());
}

export function toggleHudVisibilityFromKeybinding() {
    if (!getSetting("enabled", true) || !getHudContext()) return false;
    hudState.hiddenByShortcut = !hudState.hiddenByShortcut;
    services.clearCombatEventExpansionRequest();
    scheduleRender(0);
    return true;
}

export function requestCombatEventExpansion(request) {
    if (!getSetting("enabled", true) || !getSetting("showCards", true) || hudState.hiddenByShortcut || !getHudContext()) {
        return false;
    }
    services.setCombatEventExpansionRequest(request);
    if (request === "latest") {
        services.setCombatEventCardsCollapsed(false);
        if (getSetting("minimized", false)) void game.settings.set(MODULE_ID, "minimized", false);
    }
    scheduleRender(0);
    return true;
}

export function syncSystemActionBar(hudVisible, minimized = false) {
    const bar = document.querySelector("#token-action-bar");
    if (!bar) return;
    const shouldHide = hudVisible && !minimized && getSetting("hideSystemBar", true);
    bar.classList.toggle("sf-system-bar-hidden", shouldHide);
}

export function syncMinimizedHudPosition(hud, minimized) {
    hud.classList.toggle("is-minimized", minimized);
    hud.classList.remove("is-action-bar-aligned");
    hud.style.removeProperty("--sf-minimized-center");
    hud.style.removeProperty("--sf-minimized-top");
    if (!minimized) return;

    const hotbarSelectors = [
        "#custom-hotbar",
        "#hotbar",
    ];
    const bounds = hotbarSelectors
        .map((selector) => document.querySelector(selector))
        .filter((element) => element && window.getComputedStyle(element).display !== "none")
        .map((element) => element.getBoundingClientRect())
        .find((candidate) => candidate.width > 0 && candidate.height > 0);
    if (!bounds) return;

    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const hudWidth = Math.min(620, Math.max(0, viewportWidth - 24));
    const halfWidth = hudWidth / 2;
    const desiredCenter = bounds.left + bounds.width / 2;
    const center = Math.min(viewportWidth - halfWidth - 12, Math.max(halfWidth + 12, desiredCenter));
    const top = bounds.top - 6;
    hud.classList.add("is-action-bar-aligned");
    hud.style.setProperty("--sf-minimized-center", `${Math.round(center)}px`);
    hud.style.setProperty("--sf-minimized-top", `${Math.round(top)}px`);
}

export function isUnmodifiedKeyAvailable(key) {
    const coreKeybindingsRegistered = game.settings?.settings?.has?.("core.keybindings") === true;
    const customBindings = coreKeybindingsRegistered
        ? game.settings.get("core", "keybindings") ?? {}
        : {};
    for (const [actionId, config] of game.keybindings.actions ?? []) {
        const editable = Object.hasOwn(customBindings, actionId) ? customBindings[actionId] : config.editable;
        const bindings = [...(config.uneditable ?? []), ...(editable ?? [])];
        if (bindings.some((binding) => binding?.key === key && !(binding.modifiers?.length))) return false;
    }
    return true;
}
