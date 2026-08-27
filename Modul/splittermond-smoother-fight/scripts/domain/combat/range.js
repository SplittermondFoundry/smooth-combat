export const DEFAULT_MELEE_RANGE = 2;

export function assessAttackRange(distance, range, isRanged, { metric = true, meleeRange = DEFAULT_MELEE_RANGE } = {}) {
    const measuredDistance = nonNegativeNumber(distance);
    if (measuredDistance === null || !metric) return unknownAssessment();

    const listedRange = exactNumericRange(range);
    const maximum = isRanged
        ? listedRange
        : listedRange !== null && listedRange > 0 ? listedRange : positiveNumber(meleeRange);
    if (maximum === null || maximum <= 0) return unknownAssessment();
    return distanceAssessment(measuredDistance, maximum, isRanged ? "listed" : "melee");
}

export function assessSpellRange(distance, range, { metric = true } = {}) {
    const measuredDistance = nonNegativeNumber(distance);
    if (measuredDistance === null || !metric) return unknownAssessment();

    const maximum = parseExactMeterRange(range);
    return maximum === null
        ? unknownAssessment()
        : distanceAssessment(measuredDistance, maximum, "listed");
}

export function parseExactMeterRange(value) {
    const direct = exactNumericRange(value);
    if (direct !== null) return direct;
    if (typeof value !== "string") return null;

    const match = value.trim().match(/^(\d+(?:[.,]\d+)?)\s*(?:m|meter|meters|metre|metres)?$/iu);
    if (!match) return null;
    const parsed = Number(match[1].replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function exactNumericRange(value) {
    const candidate = value && typeof value === "object" ? value.value : value;
    if (typeof candidate !== "number") return null;
    return Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
}

function nonNegativeNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function positiveNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function distanceAssessment(distance, maximum, source) {
    return {
        status: distance <= maximum + 1e-9 ? "within" : "outside",
        distance,
        maximum,
        source,
    };
}

function unknownAssessment() {
    return { status: "unknown", distance: null, maximum: null, source: null };
}
