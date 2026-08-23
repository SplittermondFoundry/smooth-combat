import {
    movementTrackerState,
} from "../../domain/combat/movement.js";

import {
    escapeAttr,
    escapeHtml,
    getDerivedValue,
    numericValue,
    t,
} from "../../shared/values.js";

import {
    formatMovementDistance,
    readTokenMovementDistance,
} from "../../shared/movement.js";

export {
    readTokenMovementDistance,
} from "../../shared/movement.js";

export function buildMovementTracker(context) {
    const speed = numericValue(getDerivedValue(context.actor, "speed"));
    const state = movementTrackerState(readTokenMovementDistance(context.token), speed);
    const moved = formatMovementDistance(state.moved);
    const freeLimit = formatMovementDistance(state.freeLimit);
    const walkLimit = formatMovementDistance(state.walkLimit);
    const sprintLimit = formatMovementDistance(state.sprintLimit);
    const trackerLabel = t("SMOOTHER_FIGHT.HUD.MovementTracker");
    const status = movementStatus(state);
    const progressLabel = t("SMOOTHER_FIGHT.HUD.MovementProgress", {
        distance: moved,
        maximum: sprintLimit,
    });
    const sections = [
        movementSection("free", t("SMOOTHER_FIGHT.HUD.FreeMovementShort"), freeLimit, state.sectionProgress.free, state),
        movementSection("walk", t("SMOOTHER_FIGHT.HUD.TickActions.walk.Name"), walkLimit, state.sectionProgress.walk, state),
        movementSection("sprint", t("SMOOTHER_FIGHT.HUD.TickActions.sprint.Name"), sprintLimit, state.sectionProgress.sprint, state),
    ].join("");
    const undoLabel = t("SMOOTHER_FIGHT.HUD.UndoMovement");
    const undoButton = state.moved > 0
        ? `<button type="button" class="sf-movement-undo" data-sf-action="revert-movement" title="${escapeAttr(undoLabel)}" aria-label="${escapeAttr(undoLabel)}"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i><span>${escapeHtml(undoLabel)}</span></button>`
        : "";

    return `<section class="sf-movement-tracker is-${escapeAttr(state.phase)}" aria-label="${escapeAttr(trackerLabel)}">
        <header class="sf-movement-heading">
            <span><i class="fa-solid fa-route" aria-hidden="true"></i><strong>${escapeHtml(trackerLabel)}</strong><b>${escapeHtml(t("SMOOTHER_FIGHT.HUD.MovementDistance", { distance: moved }))}</b></span>
            <small>${escapeHtml(status)}</small>
        </header>
        <div class="sf-movement-controls">
            <div class="sf-movement-bar">
                <div class="sf-movement-sections" role="group" aria-label="${escapeAttr(progressLabel)}">${sections}</div>
            </div>
            ${undoButton ? `<div class="sf-movement-actions">${undoButton}</div>` : ""}
        </div>
    </section>`;
}

function movementSection(id, name, distance, progress, state) {
    const className = `sf-movement-section sf-movement-section-${id}`;
    const style = `--sf-movement-fill:${progress.toFixed(3)}%`;
    const content = `<small>${escapeHtml(name)}</small><b>${escapeHtml(t("SMOOTHER_FIGHT.HUD.MovementMeters", { distance }))}</b>`;
    const ticks = movementSectionActionTicks(id, state);
    if (!ticks) return `<span class="${className}" style="${style}">${content}</span>`;

    const label = t("SMOOTHER_FIGHT.HUD.MovementAction", { action: name, ticks });
    const icon = id === "walk" ? "fa-person-walking" : "fa-person-running";
    const tickLabel = t("SMOOTHER_FIGHT.HUD.MovementTicks", { ticks });
    return `<button type="button" class="${className} sf-movement-section-action" style="${style}" data-sf-action="share-tick-action" data-tick-action-id="${escapeAttr(id)}" data-tick-action-ticks="${escapeAttr(ticks)}" data-tick-action-advance="${escapeAttr(ticks)}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">${content}<em class="sf-movement-section-ticks"><i class="fa-solid ${icon}" aria-hidden="true"></i>${escapeHtml(tickLabel)}</em></button>`;
}

function movementSectionActionTicks(id, state) {
    if (!state.available || state.moved <= state.freeLimit) return null;
    if (id === "walk") return 5;
    if (id === "sprint" && state.moved > state.walkLimit) return 10;
    return null;
}

function movementStatus(state) {
    switch (state.phase) {
        case "walk":
            return t("SMOOTHER_FIGHT.HUD.MovementWalkRequired");
        case "sprint":
            return t("SMOOTHER_FIGHT.HUD.MovementSprintRequired");
        case "excess":
            return t("SMOOTHER_FIGHT.HUD.MovementExcess", { distance: formatMovementDistance(state.excess) });
        case "unavailable":
            return t("SMOOTHER_FIGHT.HUD.MovementSpeedUnavailable");
        default:
            return t("SMOOTHER_FIGHT.HUD.MovementFree", { distance: formatMovementDistance(state.freeLimit) });
    }
}
