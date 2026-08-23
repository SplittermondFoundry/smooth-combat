import {
    numericValue,
} from "./values.js";

export function readTokenMovementDistance(contextToken) {
    const token = contextToken?.document ?? contextToken;
    if (!token) return 0;
    const history = token.movementHistory;
    if (!Array.isArray(history)) {
        return numericValue(history?.distance ?? token.movement?.history?.distance);
    }

    let recordedDistance = numericValue(history.at(-1)?.distance);
    if (typeof token.measureMovementPath === "function") {
        try {
            recordedDistance = numericValue(token.measureMovementPath(history)?.distance);
        } catch {
            // Retain the cumulative distance exposed by the last measured waypoint.
        }
    }

    const movement = token.movement;
    const movementInProgress = movement?.state === "pending" || movement?.state === "paused";
    if (movement?.recorded === false && movementInProgress) {
        const liveDistance = numericValue(movement.history?.distance) + numericValue(movement.passed?.distance);
        return Math.max(recordedDistance, liveDistance);
    }
    return recordedDistance;
}

export function formatMovementDistance(value) {
    const rounded = Math.round(numericValue(value) * 100) / 100;
    try {
        return new Intl.NumberFormat(game.i18n.lang, { maximumFractionDigits: 2 }).format(rounded);
    } catch {
        return String(rounded);
    }
}
