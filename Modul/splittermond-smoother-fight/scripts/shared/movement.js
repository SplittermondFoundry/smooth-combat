import {
    numericValue,
} from "./values.js";

export function readMovementSpeed(actor) {
    const value = actor?.derivedValues?.speed?.value ?? actor?.system?.derivedValues?.speed?.value;
    // The system's display string can contain a formula. Its calculated value includes modifiers.
    return movementNumber(value ?? actor?.system?.derivedAttributes?.speed?.value);
}

function movementNumber(value, depth = 0) {
    if (depth > 5 || value == null) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
        const text = value.trim().replace(",", ".");
        return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(text) ? Number(text) : null;
    }
    if (typeof value !== "object") return null;
    if (typeof value.calculateSync === "function") {
        try {
            return movementNumber(value.calculateSync(), depth + 1);
        } catch {
            return null;
        }
    }
    for (const key of ["calculationValue", "value", "total", "display"]) {
        const numeric = movementNumber(value[key], depth + 1);
        if (numeric !== null) return numeric;
    }
    return null;
}

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
