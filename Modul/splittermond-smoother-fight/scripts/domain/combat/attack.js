import {
    clone,
    numberOr,
} from "../shared.js";

export const DEFAULT_CHECK_CONFIG = Object.freeze({
    triumphBonus: 3,
    fumblePenalty: -3,
    grazingHitBasePenalty: 2,
});

export function totalDegreesOfSuccess(report) {
    return numberOr(report?.degreeOfSuccess?.fromRoll) + numberOr(report?.degreeOfSuccess?.modification);
}

export function attackOutcomeChanged(previousReport, nextReport) {
    return totalDegreesOfSuccess(previousReport) !== totalDegreesOfSuccess(nextReport)
        || Boolean(previousReport?.succeeded) !== Boolean(nextReport?.succeeded);
}

export function attackReadiness(isRanged, attackId, preparedAttackId) {
    const prepared = Boolean(isRanged && attackId && attackId === preparedAttackId);
    return {
        ready: Boolean(!isRanged || prepared),
        prepared,
    };
}

export function attackControlState(attackIds, storedDefaultAttackId, equipmentCount = 0) {
    const ids = Array.from(new Set((attackIds ?? []).filter(Boolean)));
    const storedAttackId = ids.includes(storedDefaultAttackId) ? storedDefaultAttackId : null;
    const automaticDefaultAttackId = ids.length === 1 ? ids[0] : null;
    const defaultAttackId = storedAttackId ?? automaticDefaultAttackId;
    const directAttackId = defaultAttackId;
    return {
        defaultAttackId,
        automaticDefaultAttackId,
        directAttackId,
        showMenu: Boolean(storedAttackId || numberOr(equipmentCount) > 0 || !directAttackId),
    };
}

export function attackControlSelection(preparedAttackId, directAttackId) {
    if (preparedAttackId) return { attackId: preparedAttackId, mode: "prepared" };
    if (directAttackId) return { attackId: directAttackId, mode: "default" };
    return { attackId: null, mode: "menu" };
}

export function isTargetDependentDifficulty(value) {
    return ["VTD", "KW", "GW"].includes(String(value ?? "").trim().toUpperCase());
}

export function recalculateAttackReport(report, difficulty, config = {}) {
    const settings = { ...DEFAULT_CHECK_CONFIG, ...config };
    const cloned = clone(report);
    const difference = numberOr(cloned?.roll?.total) - numberOr(difficulty);
    let fromRoll = Math.sign(difference) * Math.floor(Math.abs(difference / 3));

    if (numberOr(cloned?.skill?.points) < 1) fromRoll = Math.min(fromRoll, 0);

    const succeeded = difference >= 0 && !cloned.isFumble;
    if (cloned.isFumble) fromRoll = Math.min(fromRoll + settings.fumblePenalty, -1);
    if (cloned.isCrit && succeeded) fromRoll += settings.triumphBonus;
    if (Object.is(fromRoll, -0)) fromRoll = 0;

    cloned.difficulty = numberOr(difficulty);
    cloned.succeeded = succeeded;
    cloned.degreeOfSuccess = {
        fromRoll,
        modification: numberOr(cloned?.degreeOfSuccess?.modification),
    };

    const availableDegrees = totalDegreesOfSuccess(cloned) - (cloned.maneuvers?.length ?? 0);
    cloned.grazingHitPenalty = succeeded && availableDegrees < 0
        ? settings.grazingHitBasePenalty * (cloned.maneuvers?.length ?? 0)
        : 0;

    return cloned;
}
