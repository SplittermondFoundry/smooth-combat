import {
    tokenDocumentCenter,
} from "../domain/foundry-changes.js";

import {
    formatMovementDistance,
} from "./movement.js";

export function tokenDistanceMeasurement(left, right, canvasContext = globalThis.canvas) {
    const distance = measureTokenDistance(left, right, canvasContext);
    const unit = sceneDistanceUnit(canvasContext);
    return {
        distance,
        unit,
        metric: isMeterUnit(unit),
        available: Number.isFinite(distance),
    };
}

export function measureTokenDistance(left, right, canvasContext = globalThis.canvas) {
    const gridSize = Number(canvasContext?.grid?.size) || 100;
    const leftPoint = tokenMeasurementPoint(left, gridSize);
    const rightPoint = tokenMeasurementPoint(right, gridSize);
    if (!leftPoint || !rightPoint) return Number.POSITIVE_INFINITY;

    try {
        const measured = canvasContext?.grid?.measurePath?.([leftPoint, rightPoint]);
        const measuredDistance = Number(measured?.distance);
        if (Number.isFinite(measuredDistance) && measuredDistance >= 0) return measuredDistance;
    } catch {
        // Fall back to a straight-line measurement when the active grid cannot measure this pair.
    }

    const gridDistance = Number(canvasContext?.grid?.distance ?? canvasContext?.scene?.grid?.distance) || 1;
    const horizontal = Math.hypot(rightPoint.x - leftPoint.x, rightPoint.y - leftPoint.y)
        / gridSize * gridDistance;
    return Math.hypot(horizontal, rightPoint.elevation - leftPoint.elevation);
}

export function formatTokenDistance(measurement) {
    if (!measurement?.available) return "";
    const value = formatMovementDistance(measurement.distance);
    return [value, measurement.unit].filter(Boolean).join(" ");
}

export function sceneDistanceUnit(canvasContext = globalThis.canvas) {
    const unit = String(canvasContext?.grid?.units ?? canvasContext?.scene?.grid?.units ?? "").trim();
    return unit;
}

export function isMeterUnit(value) {
    const unit = String(value ?? "").trim().toLocaleLowerCase().replace(/\.$/u, "");
    return ["m", "meter", "meters", "metre", "metres"].includes(unit);
}

function tokenMeasurementPoint(token, gridSize) {
    const center = tokenDocumentCenter(token, gridSize) ?? tokenObjectCenter(token);
    if (!center) return null;
    const document = token?.document ?? token;
    const elevation = Number(document?.elevation);
    return {
        x: center.x,
        y: center.y,
        elevation: Number.isFinite(elevation) ? elevation : 0,
    };
}

function tokenObjectCenter(token) {
    const object = token?.object ?? globalThis.canvas?.tokens?.get?.(token?.id);
    return object?.center && Number.isFinite(Number(object.center.x)) && Number.isFinite(Number(object.center.y))
        ? { x: Number(object.center.x), y: Number(object.center.y) }
        : null;
}
