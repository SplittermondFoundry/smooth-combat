import {
    movementPathThroughFractions,
} from "../../domain/combat/movement.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    services,
} from "../../core/services.js";

import {
    t,
} from "../../shared/values.js";

const ROUTE_OUTLINE_COLOR = 0x111a1e;
const COMPLETED_COLOR = 0xd8a85d;
const ROUTE_HIGHLIGHT_COLOR = 0xffd166;
const COMPACT_LABEL_SCALE = 0.72;
const HOVERED_LABEL_SCALE = 1;
const ROUTE_COLORS = [
    0x6cc9c1,
    0x86b5ff,
    0xc994e8,
    0xe58c87,
    0x8ed081,
    0xe0b15b,
];
const routePreviews = new Map();
let hoveredRouteReference = null;

export function movementRoutePreviewModel(tokenLike, plan, gridSize = globalThis.canvas?.grid?.size) {
    const token = tokenDocument(tokenLike);
    const route = Array.from(plan?.route ?? []);
    const size = positiveNumber(gridSize, 100);
    if (!token || route.length < 2) return null;
    const points = route.map((point) => waypointCenter(point, token, size)).filter(Boolean);
    if (points.length < 2) return null;

    const milestones = Array.from(plan?.milestones ?? [])
        .map((milestone) => {
            const fraction = normalizedFraction(milestone?.fraction);
            const routePoint = movementPathThroughFractions(
                route,
                plan?.segmentLengths,
                0,
                [fraction],
            ).at(-1);
            const point = waypointCenter(routePoint, token, size);
            if (!point) return null;
            return {
                completed: fraction <= normalizedFraction(plan?.completedFraction),
                fraction,
                fractionLabel: movementFractionLabel(fraction),
                point,
                tick: displayedWholeNumber(milestone?.tick),
                tickOffset: displayedWholeNumber(milestone?.tickOffset),
            };
        })
        .filter(Boolean)
        .sort((left, right) => left.fraction - right.fraction);

    return {
        milestones,
        points,
        start: {
            point: points[0],
            tick: displayedWholeNumber(plan?.startTick),
        },
        tokenName: String(token.name ?? token.actor?.name ?? tokenReference(token)),
    };
}

export function toggleMovementRoutePreviewCanvas(tokenLike, plan, { persistent = false } = {}) {
    const token = tokenDocument(tokenLike);
    const tokenReference = token?.uuid ?? token?.id;
    if (!tokenReference) return null;
    if (isMovementRoutePreviewCanvasVisible(token)) {
        const currentPreview = routePreviews.get(tokenReference);
        if (persistent && !currentPreview.persistent) {
            currentPreview.persistent = true;
            return true;
        }
        clearMovementRoutePreviewCanvas(token);
        return false;
    }

    const drawing = drawMovementRoutePreview(token, plan);
    if (!drawing) return null;
    routePreviews.set(tokenReference, { ...drawing, persistent, tokenReference });
    refreshMovementRoutePreviewCanvasScale();
    return true;
}

export function clearMovementRoutePreviewCanvas(tokenLike = null, { temporaryOnly = false } = {}) {
    const token = tokenDocument(tokenLike);
    const tokenReference = token?.uuid ?? token?.id ?? null;
    const references = tokenReference ? [tokenReference] : Array.from(routePreviews.keys());
    let cleared = false;
    for (const reference of references) {
        const preview = routePreviews.get(reference);
        if (!preview || (temporaryOnly && preview.persistent)) continue;
        routePreviews.delete(reference);
        clearRouteHighlight(reference);
        if (!preview.container?.destroyed) {
            preview.container.parent?.removeChild?.(preview.container);
            preview.container.destroy?.({ children: true });
        }
        cleared = true;
    }
    return cleared;
}

export function isMovementRoutePreviewCanvasVisible(tokenLike) {
    const token = tokenDocument(tokenLike);
    const tokenReference = token?.uuid ?? token?.id;
    const preview = tokenReference ? routePreviews.get(tokenReference) : null;
    return Boolean(preview?.container && !preview.container.destroyed);
}

export function isMovementRoutePreviewCanvasPersistent(tokenLike) {
    const token = tokenDocument(tokenLike);
    const tokenReference = token?.uuid ?? token?.id;
    return Boolean(tokenReference && routePreviews.get(tokenReference)?.persistent
        && isMovementRoutePreviewCanvasVisible(token));
}

export function refreshMovementRoutePreviewCanvasScale() {
    if (!routePreviews.size) return false;
    const scale = 1 / Math.max(Number(globalThis.canvas?.stage?.scale?.x) || 1, 0.1);
    routePreviews.forEach((preview) => {
        preview.markerContainers.forEach((marker) => marker.scale?.set?.(scale));
    });
    return true;
}

export function refreshMovementRoutePreviewCanvas(tokenLike, plan) {
    const token = tokenDocument(tokenLike);
    const reference = tokenReference(token);
    const preview = routePreviews.get(reference);
    const completedFraction = normalizedFraction(plan?.completedFraction);
    if (!preview || preview.completedFraction === completedFraction) return false;
    const persistent = preview.persistent;
    clearMovementRoutePreviewCanvas(token);
    const drawing = drawMovementRoutePreview(token, plan);
    if (!drawing) return false;
    routePreviews.set(reference, { ...drawing, persistent, tokenReference: reference });
    refreshMovementRoutePreviewCanvasScale();
    return true;
}

function drawMovementRoutePreview(token, plan) {
    const parent = globalThis.canvas?.interface;
    const pixi = globalThis.PIXI;
    const model = movementRoutePreviewModel(token, plan);
    if (!parent?.addChild || !pixi?.Container || !pixi?.Graphics || !pixi?.Text || !model) return null;
    const reference = tokenReference(token);
    const routeColor = routeColorForToken(reference);

    const container = new pixi.Container();
    container.name = `${MODULE_ID}-movement-route-preview`;
    container.eventMode = "auto";
    container.interactiveChildren = true;
    container.sortableChildren = true;
    container.zIndex = 1000;

    const outline = routeGraphics(pixi, model.points, ROUTE_OUTLINE_COLOR, 9, 0.82);
    const route = routeGraphics(pixi, model.points, routeColor, 4, 1);
    const highlight = routeGraphics(pixi, model.points, ROUTE_HIGHLIGHT_COLOR, 10, 0.95);
    const hitArea = routeGraphics(pixi, model.points, routeColor, 28, 0.001);
    outline.zIndex = 0;
    route.zIndex = 1;
    highlight.zIndex = 2;
    highlight.visible = false;
    hitArea.zIndex = 3;
    container.addChild(outline, route, highlight, hitArea);

    const markerContainers = [];
    const labelContainers = [];
    const nextOpenMilestoneIndex = model.milestones.findIndex((milestone) => !milestone.completed);
    const startMarker = addMarker(container, pixi, model.start.point, COMPLETED_COLOR, 8, t("SMOOTHER_FIGHT.HUD.MovementRouteStart", {
        tick: model.start.tick,
        token: model.tokenName,
    }), routeColor, 4, 58, false);
    markerContainers.push(startMarker.markerContainer);
    labelContainers.push(startMarker.labelContainer);
    model.milestones.forEach((milestone, index) => {
        const label = t("SMOOTHER_FIGHT.HUD.MovementRouteMilestone", {
            fraction: milestone.fractionLabel,
            offset: milestone.tickOffset,
            tick: milestone.tick,
        });
        const marker = addMarker(
            container,
            pixi,
            milestone.point,
            milestone.completed ? COMPLETED_COLOR : routeColor,
            10,
            label,
            routeColor,
            5 + index,
            undefined,
            index === nextOpenMilestoneIndex,
        );
        markerContainers.push(marker.markerContainer);
        labelContainers.push(marker.labelContainer);
    });

    bindRouteHover([hitArea, ...markerContainers], reference);

    parent.addChild(container);
    return {
        completedFraction: normalizedFraction(plan?.completedFraction),
        container,
        highlight,
        labelContainers,
        markerContainers,
    };
}

function routeGraphics(pixi, points, color, width, alpha) {
    const graphics = new pixi.Graphics();
    graphics.lineStyle(width, color, alpha);
    graphics.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => graphics.lineTo(point.x, point.y));
    return graphics;
}

function addMarker(
    container,
    pixi,
    point,
    color,
    radius,
    text,
    routeColor,
    zIndex,
    labelOffset = radius + 8,
    compactVisible = false,
) {
    const markerContainer = new pixi.Container();
    markerContainer.eventMode = "static";
    markerContainer.cursor = "pointer";
    markerContainer.position?.set?.(point.x, point.y);
    markerContainer.zIndex = zIndex;
    container.addChild(markerContainer);

    const marker = new pixi.Graphics();
    marker.lineStyle(3, ROUTE_OUTLINE_COLOR, 0.95);
    marker.beginFill(color, 0.95);
    marker.drawCircle(0, 0, radius);
    marker.endFill();
    markerContainer.addChild(marker);

    const labelContainer = new pixi.Container();
    labelContainer.name = `${MODULE_ID}-movement-route-label`;
    labelContainer.eventMode = "none";
    labelContainer.alpha = 0.82;
    labelContainer.compactVisible = compactVisible;
    labelContainer.visible = compactVisible;
    labelContainer.scale?.set?.(COMPACT_LABEL_SCALE);
    markerContainer.addChild(labelContainer);

    const label = new pixi.Text(text, {
        fill: 0xf7f1df,
        fontFamily: "Signika, sans-serif",
        fontSize: 15,
        fontWeight: "700",
        lineJoin: "round",
        stroke: ROUTE_OUTLINE_COLOR,
        strokeThickness: 3,
    });
    label.anchor?.set?.(0.5, 1);
    const labelY = -labelOffset;
    label.position?.set?.(0, labelY);

    const paddingX = 7;
    const paddingY = 3;
    const labelWidth = positiveNumber(label.width, String(text).length * 7.5);
    const labelHeight = positiveNumber(label.height, 18);
    const background = new pixi.Graphics();
    background.lineStyle(2, routeColor, 0.95);
    background.beginFill(ROUTE_OUTLINE_COLOR, 0.92);
    background.drawRoundedRect(
        -(labelWidth / 2) - paddingX,
        labelY - labelHeight - paddingY,
        labelWidth + (paddingX * 2),
        labelHeight + (paddingY * 2),
        5,
    );
    background.endFill();
    labelContainer.addChild(background, label);
    return { labelContainer, markerContainer };
}

function bindRouteHover(targets, reference) {
    for (const target of targets) {
        target.eventMode = "static";
        target.cursor = "pointer";
        target.on?.("pointerenter", () => highlightRoute(reference));
        target.on?.("pointerleave", () => clearRouteHighlight(reference));
    }
}

function highlightRoute(reference) {
    if (hoveredRouteReference && hoveredRouteReference !== reference) {
        const previous = routePreviews.get(hoveredRouteReference);
        if (previous?.highlight) previous.highlight.visible = false;
        if (previous?.container) previous.container.zIndex = 1000;
        if (previous) setPreviewLabelPresentation(previous, false);
    }
    const preview = routePreviews.get(reference);
    if (!preview) return;
    hoveredRouteReference = reference;
    preview.highlight.visible = true;
    preview.container.zIndex = 2000;
    setPreviewLabelPresentation(preview, true);
    services.highlightToken?.(reference);
}

function clearRouteHighlight(reference) {
    const preview = routePreviews.get(reference);
    if (preview?.highlight) preview.highlight.visible = false;
    if (preview?.container) preview.container.zIndex = 1000;
    if (preview) setPreviewLabelPresentation(preview, false);
    if (hoveredRouteReference !== reference) return;
    hoveredRouteReference = null;
    services.clearHoveredToken?.();
}

function setPreviewLabelPresentation(preview, expanded) {
    preview.labelContainers?.forEach((label) => {
        label.scale?.set?.(expanded ? HOVERED_LABEL_SCALE : COMPACT_LABEL_SCALE);
        label.alpha = expanded ? 1 : 0.82;
        label.visible = expanded || label.compactVisible;
    });
}

function waypointCenter(point, token, gridSize) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const width = positiveNumber(point?.width, token?.width, 1) * gridSize;
    const height = positiveNumber(point?.height, token?.height, 1) * gridSize;
    return { x: x + (width / 2), y: y + (height / 2) };
}

function movementFractionLabel(fraction) {
    if (Math.abs(fraction - 0.25) < 0.001) return "¼";
    if (Math.abs(fraction - 0.5) < 0.001) return "½";
    if (Math.abs(fraction - 0.75) < 0.001) return "¾";
    if (Math.abs(fraction - 1) < 0.001) return t("SMOOTHER_FIGHT.HUD.MovementRouteDestination");
    return `${Math.round(fraction * 100)} %`;
}

function tokenDocument(tokenLike) {
    return tokenLike?.document ?? tokenLike ?? null;
}

function tokenReference(tokenLike) {
    const token = tokenDocument(tokenLike);
    return String(token?.uuid ?? token?.id ?? "token");
}

function routeColorForToken(reference) {
    const hash = Array.from(String(reference)).reduce(
        (value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0,
        0,
    );
    return ROUTE_COLORS[hash % ROUTE_COLORS.length];
}

function displayedWholeNumber(value) {
    return Math.trunc(finiteNumber(value));
}

function normalizedFraction(value) {
    return Math.min(1, Math.max(0, finiteNumber(value)));
}

function finiteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

function positiveNumber(...values) {
    for (const value of values) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) return numeric;
    }
    return 1;
}
