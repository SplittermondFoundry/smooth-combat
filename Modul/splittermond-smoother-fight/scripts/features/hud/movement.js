import {
    services,
} from "../../core/services.js";

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
    const reversal = services.getMovementReversalApplicationStatus?.(context.token) ?? { state: "idle", record: null };
    const reversalBlocked = reversal.state !== "idle";
    const reversalTitle = reversal.state === "completed"
        ? t("SMOOTHER_FIGHT.HUD.AlreadyApplied")
        : reversal.state === "applying"
            ? t("SMOOTHER_FIGHT.HUD.OperationApplying")
            : reversal.state === "uncertain"
                ? t("SMOOTHER_FIGHT.HUD.OperationUncertain")
                : undoLabel;
    const undoButton = state.moved > 0
        ? `<button type="button" class="sf-movement-undo ${reversalBlocked ? `is-${escapeAttr(reversal.state)}` : ""}" data-sf-action="revert-movement" title="${escapeAttr(reversalTitle)}" aria-label="${escapeAttr(reversalTitle)}" ${reversalBlocked ? "disabled" : ""}><i class="fa-solid fa-rotate-left" aria-hidden="true"></i><span>${escapeHtml(undoLabel)}</span></button>`
        : "";
    const reversalRecovery = reversal.state === "uncertain" && game.user?.isGM
        ? `<div class="sf-operation-recovery-actions sf-movement-recovery-actions">
            <span><i class="fa-solid fa-triangle-exclamation"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.OperationUncertain"))}</span>
            <button type="button" data-sf-action="recover-movement" data-decision="retry"><i class="fa-solid fa-rotate-left"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.RetryOperation"))}</button>
            <button type="button" data-sf-action="recover-movement" data-decision="complete"><i class="fa-solid fa-check"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.MarkOperationCompleted"))}</button>
        </div>`
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
        ${reversalRecovery}
    </section>`;
}

export function buildSelectedMovementControl(combat) {
    const token = services.getAbortableControlledTokenMovement(combat);
    const tokenReference = token?.uuid ?? token?.id;
    if (!token || !tokenReference) return "";
    const tokenName = token.name ?? token.actor?.name ?? "–";
    const description = t("SMOOTHER_FIGHT.HUD.SelectedMovementPlan", { token: tokenName });
    const abortLabel = t("SMOOTHER_FIGHT.HUD.AbortMovement");
    const routeVisible = services.isMovementRoutePreviewVisible(token);
    const routePersistent = services.isMovementRoutePreviewPersistent(token);
    const routeLabel = t(routeVisible
        ? "SMOOTHER_FIGHT.HUD.HideMovementRoute"
        : "SMOOTHER_FIGHT.HUD.ShowMovementRoute");
    const persistentLabel = t(routePersistent
        ? "SMOOTHER_FIGHT.HUD.HidePersistentMovementRoute"
        : "SMOOTHER_FIGHT.HUD.ShowPersistentMovementRoute");
    return `
        <section class="sf-combat-controls sf-selected-movement-control" aria-label="${escapeAttr(description)}">
            <span><i class="fa-solid fa-route" aria-hidden="true"></i> ${escapeHtml(description)}</span>
            <button type="button" class="sf-icon-button ${routeVisible ? "is-active" : ""}" data-sf-action="toggle-movement-route" data-token-uuid="${escapeAttr(tokenReference)}" title="${escapeAttr(routeLabel)}" aria-pressed="${routeVisible}">
                <i class="fa-solid fa-map-location-dot" aria-hidden="true"></i><span>${escapeHtml(routeLabel)}</span>
            </button>
            <button type="button" class="sf-icon-button ${routePersistent ? "is-active" : ""}" data-sf-action="toggle-persistent-movement-route" data-token-uuid="${escapeAttr(tokenReference)}" title="${escapeAttr(persistentLabel)}" aria-pressed="${routePersistent}">
                <i class="fa-solid fa-thumbtack" aria-hidden="true"></i><span>${escapeHtml(persistentLabel)}</span>
            </button>
            <button type="button" class="sf-icon-button is-danger" data-sf-action="abort-selected-movement" data-token-uuid="${escapeAttr(tokenReference)}" title="${escapeAttr(abortLabel)}">
                <i class="fa-solid fa-person-circle-xmark" aria-hidden="true"></i><span>${escapeHtml(abortLabel)}</span>
            </button>
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
