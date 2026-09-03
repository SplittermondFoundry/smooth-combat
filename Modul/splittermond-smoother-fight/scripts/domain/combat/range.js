export const DEFAULT_MELEE_RANGE = 2;

const TOUCH_RANGE_KEYS = new Set(["beruhrung", "beruehrung", "touch"]);
const CASTER_RANGE_KEYS = new Set(["zauberer", "caster"]);
const SORCERERS_HAND_KEYS = new Set(["handdeszauberers", "sorcerershand"]);

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

export function assessSpellRange(distance, range, {
    metric = true,
    adjacent = null,
    casterHasSorcerersHand = false,
} = {}) {
    const kind = spellRangeKind(range);
    if (kind === "touch" || (kind === "caster" && casterHasSorcerersHand)) {
        return touchAssessment(distance, adjacent);
    }

    const measuredDistance = nonNegativeNumber(distance);
    if (measuredDistance === null || !metric) return unknownAssessment();

    const maximum = parseExactMeterRange(range);
    return maximum === null
        ? unknownAssessment()
        : distanceAssessment(measuredDistance, maximum, "listed");
}

export function spellRangeKind(value) {
    const candidate = value && typeof value === "object" ? value.value : value;
    const key = ruleKey(candidate);
    if (TOUCH_RANGE_KEYS.has(key)) return "touch";
    if (CASTER_RANGE_KEYS.has(key)) return "caster";
    return null;
}

export function hasSorcerersHandForSpell(actor, spell) {
    const spellSchoolId = magicSchoolId(spell?.system?.skill) || magicSchoolId(spell?.skill);
    if (!spellSchoolId) return false;

    return Array.from(actor?.items ?? []).some((item) => {
        if (item?.type !== "mastery") return false;
        if (![item.system?.id, item.name].some((value) => SORCERERS_HAND_KEYS.has(ruleKey(value)))) return false;
        return magicSchoolId(item.system?.skill) === spellSchoolId;
    });
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

function touchAssessment(distance, adjacent) {
    if (typeof adjacent !== "boolean") return unknownAssessment();
    return {
        status: adjacent ? "within" : "outside",
        distance: nonNegativeNumber(distance),
        maximum: null,
        source: "touch",
    };
}

function magicSchoolId(value) {
    const candidate = value && typeof value === "object" ? value.id : value;
    return ruleKey(candidate);
}

function ruleKey(value) {
    return String(value ?? "")
        .normalize("NFKD")
        .replace(/\p{Mark}/gu, "")
        .replace(/\s*\([^)]*\)\s*$/u, "")
        .toLocaleLowerCase("de-DE")
        .replace(/ß/gu, "ss")
        .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function unknownAssessment() {
    return { status: "unknown", distance: null, maximum: null, source: null };
}
