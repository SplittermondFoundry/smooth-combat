import { hudState } from "./state.js";
import { services } from "../../core/services.js";
import { getHudContext, getPersonalHudContext } from "./context.js";
import { clearActionTooltip } from "./action-tooltips.js";
import { buildMovementTracker } from "./movement.js";
import {
    attackRangePresentation, rangeStatusMarkup, spellRangePresentation,
    targetDistancePresentation, targetLinePresentation,
} from "./range.js";
import { escapeHtml, getSetting, t } from "../../shared/values.js";

// Positions are intentionally absent: only changes to the visible participants
// require rebuilding controls/cards. Perception is read live, without flag scans.
function visibilitySignature(context) {
    if (!context) return null;
    // Historical cards and personal defense controls can reference other tokens
    // even when this user cannot choose the active combatant's target.
    const candidates = !getSetting("minimized", false)
        ? services.getTargetSceneTokens(context.combat).map((token) => token.uuid)
        : [];
    return JSON.stringify([
        globalThis.canvas?.scene?.id, context.combat.id, context.combatant.id,
        context.concealed, context.actor?.id, context.token?.uuid,
        context.runtimeController?.id, context.target?.uuid,
        context.targets.map((token) => token.uuid), candidates,
    ]);
}

export function rememberHudCanvas(context) {
    hudState.canvasSignature = visibilitySignature(context);
    hudState.canvasValues.clear();
    hudState.movementDistanceCache = new WeakMap();
}

export function refreshHudCanvasVisibility(root) {
    if (!root) return false;
    const signature = visibilitySignature(getHudContext());
    if (signature === hudState.canvasSignature) return false;
    hudState.canvasSignature = signature;
    root.hidden = true;
    clearActionTooltip();
    services.clearHoveredToken?.();
    return true;
}

export function refreshHudCanvas(root) {
    if (!root || root.hidden || root.classList.contains("is-hidden")) return;
    const context = getHudContext();
    if (!context) return;
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
