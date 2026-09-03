import {
    assessAttackRange,
    assessSpellRange,
    hasSorcerersHandForSpell,
} from "../../domain/combat/range.js";

import {
    formatTokenDistance,
    tokenDistanceMeasurement,
} from "../../shared/token-distance.js";

import {
    configuredMeleeRange,
} from "../../shared/range-settings.js";

import {
    t,
} from "../../shared/values.js";

export function warnIfAttackOutOfRange(context, attack, isRanged) {
    const measurement = actionMeasurement(context);
    if (!measurement) return null;
    const assessment = assessAttackRange(
        measurement.distance,
        attack?.range ?? attack?.system?.range,
        isRanged,
        { metric: measurement.metric, meleeRange: configuredMeleeRange() }
    );
    return warnIfOutside(assessment, measurement, attack, "AttackRangeWarning");
}

export function warnIfSpellOutOfRange(context, spell) {
    const measurement = actionMeasurement(context);
    if (!measurement) return null;
    const assessment = assessSpellRange(
        measurement.distance,
        spell?.range ?? spell?.system?.range,
        {
            metric: measurement.metric,
            adjacent: measurement.adjacent,
            casterHasSorcerersHand: hasSorcerersHandForSpell(context.actor, spell),
        }
    );
    return warnIfOutside(assessment, measurement, spell, "SpellRangeWarning");
}

function actionMeasurement(context) {
    if (!context?.token || !context?.target) return null;
    return tokenDistanceMeasurement(context.token, context.target);
}

function warnIfOutside(assessment, measurement, action, translationKey) {
    if (assessment.status !== "outside") return assessment;
    const listedRange = action?.range ?? action?.system?.range;
    globalThis.ui?.notifications?.warn?.(t(`SMOOTHER_FIGHT.HUD.${translationKey}`, {
        action: action?.name ?? "–",
        distance: formatTokenDistance(measurement),
        range: assessment.maximum === null
            ? String(listedRange ?? "–")
            : formatTokenDistance({
                available: true,
                distance: assessment.maximum,
                unit: measurement.unit,
            }),
    }));
    return assessment;
}
