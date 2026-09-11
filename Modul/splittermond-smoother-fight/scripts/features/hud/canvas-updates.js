import { hudState } from "./state.js";
import { services } from "../../core/services.js";
import { getHudContext, getPersonalHudContext } from "./context.js";
import { clearActionTooltip } from "./action-tooltips.js";
import { buildMovementTracker } from "./movement.js";
import { refreshHudMovementControls, refreshHudVisibilityParts } from "./canvas-parts.js";
import {
    attackRangePresentation, rangeStatusMarkup, spellRangePresentation,
    targetDistancePresentation, targetLinePresentation,
} from "./range.js";
import { escapeHtml, getSetting, t } from "../../shared/values.js";

// Positions are intentionally absent: only changes to the visible participants
// require updating controls/cards. Perception is read live, without flag scans.
export function hudCanvasContextKey(context) {
    return JSON.stringify(context ? [
        globalThis.canvas?.scene?.id, context.combat.id, context.combatant.id,
        context.concealed, context.actor?.id, context.token?.uuid, context.runtimeController?.id,
    ] : null);
}

function visibilitySignature(context) {
    if (!context) return null;
    // Historical cards and personal defense controls can reference other tokens
    // even when this user cannot choose the active combatant's target.
    const candidates = !getSetting("minimized", false)
        ? services.getTargetSceneTokens(context.combat).map((token) => token.uuid).sort()
        : [];
    return JSON.stringify([
        ...JSON.parse(hudCanvasContextKey(context)), context.target?.uuid,
        context.targets.map((token) => token.uuid), candidates,
    ]);
}

export function rememberHudCanvas(context) {
    hudState.canvasSignature = visibilitySignature(context);
    hudState.canvasPendingContext = null;
    hudState.canvasValues.clear();
    hudState.movementDistanceCache = new WeakMap();
}

export function isHudCanvasContextCurrent(context) {
    const previous = JSON.parse(hudState.canvasSignature ?? "null");
    return JSON.stringify(previous?.slice(0, 7) ?? null) === hudCanvasContextKey(context);
}

export function refreshHudCanvasVisibility(root, { rendering = false } = {}) {
    if (!root) return false;
    const context = getHudContext();
    const signature = visibilitySignature(context);
    if (signature === hudState.canvasSignature) return false;
    const previous = JSON.parse(hudState.canvasSignature ?? "null");
    clearActionTooltip();
    services.clearHoveredToken?.();
    const current = JSON.parse(signature ?? "null");
    if (!previous || !current || JSON.stringify(previous.slice(0, 7)) !== JSON.stringify(current.slice(0, 7))) {
        // Keep an ordinary turn handoff visible until the next HUD is ready.
        // Its old controls must not execute against the new active character.
        root.inert = true;
        if (!previous || !current || previous[0] !== current[0] || previous[1] !== current[1]
            || current[3] || (!game.user?.isGM && previous[6] !== current[6])) root.hidden = true;
        const key = hudCanvasContextKey(context);
        const requested = hudState.canvasPendingContext === key;
        hudState.canvasPendingContext = key;
        hudState.canvasPartsPending = true;
        return !rendering && !requested;
    }
    hudState.canvasSignature = signature;
    refreshHudVisibilityParts(root, context);
    hudState.canvasValues.delete("ranges");
    refreshHudCanvas(root);
    // Replay synchronous parts when the pending build mounts. Sight/movement
    // must not discard an otherwise valid, expensive character build.
    hudState.canvasPartsPending ||= Boolean(hudState.hud?.renderTask);
    return false;
}

export function refreshHudCanvas(root) {
    if (!root || root.hidden || root.classList.contains("is-hidden")) return;
    const context = getHudContext();
    if (!context || !isHudCanvasContextCurrent(context)) return;
    refreshHudMovementControls(root, context);
    const personal = root.querySelector(".sf-personal-controls") ? getPersonalHudContext(context) : null;
    const grid = globalThis.canvas?.grid;
    const rangeKey = JSON.stringify([geometry(context.token), geometry(context.target),
        geometry(personal?.token), geometry(personal?.target), grid?.size, grid?.distance, grid?.units]);
    if (changed("ranges", rangeKey)) refreshRanges(root, context, personal);
    const tracker = root.querySelector(".sf-movement-tracker");
    if (!tracker) return;
    const token = context.token?.document ?? context.token;
    const movement = token?.movement;
    const key = JSON.stringify([
        token?.uuid, token?.width, token?.height, token?.elevation, token?.movementHistory,
        grid?.size, grid?.distance, grid?.type, grid?.diagonals,
        movement?.state, movement?.recorded, movement?.history?.distance, movement?.passed?.distance,
    ]);
    if (changed("movement", key)) tracker.outerHTML = buildMovementTracker(context, { cache: hudState.movementDistanceCache });
}

function geometry(tokenLike) {
    const token = tokenLike?.document ?? tokenLike;
    return token ? [token.uuid, token.x, token.y, token.width, token.height, token.elevation] : null;
}

function refreshRanges(root, context, personal) {
    const distance = targetDistancePresentation(context);
    const line = targetLinePresentation(context, distance.text);
    if (changed("targetLine", line)) {
        const header = root.querySelector(".sf-turn-target");
        if (header) header.innerHTML = `<i class="fa-solid fa-crosshairs"></i> ${escapeHtml(line)}`;
    }
    root.querySelector(".sf-turn-target")?.classList?.toggle("is-user-target",
        context.targets.some((target) => services.isCurrentUserTarget?.(target)));
    if (changed("targetDistance", distance.text) && context.target) {
        const label = `${t("SMOOTHER_FIGHT.HUD.PrimaryTarget")}${distance.text ? ` · ${distance.text}` : ""}`;
        const portrait = root.querySelector(".sf-primary-target-panel .sf-portrait");
        const eyebrow = portrait?.querySelector(".sf-eyebrow");
        if (eyebrow) eyebrow.textContent = label;
        portrait?.setAttribute("aria-label", `${label}: ${context.target.name ?? context.target.actor?.name ?? "–"}`);
    }
    refreshActionRanges(root, context, distance.measurement, personal);
}

function changed(key, value) {
    if (hudState.canvasValues.get(key) === value) return false;
    hudState.canvasValues.set(key, value);
    return true;
}

function refreshActionRanges(root, context, measurement, personal) {
    // A player's personal melee controls may belong to a different combatant.
    const personalMeasurement = personal ? targetDistancePresentation(personal).measurement : null;
    const contexts = new Map(context.actor ? [[context.combatant.id, { context, measurement }]] : []);
    if (personal) contexts.set(personal.combatant.id, { context: personal, measurement: personalMeasurement });
    for (const entry of contexts.values()) {
        entry.attacks = new Map(Array.from(entry.context.actor.attacks ?? [], (item) => [item.id, item]));
        entry.spells = new Map(Array.from(entry.context.actor.spells ?? [], (item) => [item.id, item]));
    }
    for (const button of root.querySelectorAll('.sf-actions [data-sf-action="attack"], .sf-actions [data-sf-action="spell"], .sf-actions [data-sf-action="cast-prepared-spell"]')) {
        const combatantId = button.closest("[data-sf-context-combatant-id]")?.dataset.sfContextCombatantId ?? context.combatant.id;
        const entry = contexts.get(combatantId);
        if (!entry) continue;
        const actor = entry.context.actor;
        const attack = entry.attacks.get(button.dataset.attackId);
        const spell = entry.spells.get(button.dataset.spellId);
        const model = attack ? attackRangePresentation(attack, services.isRangedAttack(attack), entry.measurement)
            : spell ? spellRangePresentation(spell, entry.measurement, actor) : null;
        for (const status of ["within", "outside", "unknown"]) {
            button.classList.toggle(`is-range-${status}`, model?.status === status);
        }
        const label = button.querySelector(".sf-action-range-status");
        if (!model) { label?.remove(); continue; }
        if (label?.title === model.label && label.classList.contains(model.className)) continue;
        const markup = rangeStatusMarkup(model);
        if (label) label.outerHTML = markup;
        else button.querySelector(":scope > span")?.insertAdjacentHTML("beforeend", markup);
    }
}
