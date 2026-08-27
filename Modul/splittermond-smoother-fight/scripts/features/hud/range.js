import {
    assessAttackRange,
    assessSpellRange,
} from "../../domain/combat/range.js";

import {
    escapeAttr,
    escapeHtml,
    t,
} from "../../shared/values.js";

import {
    formatTokenDistance,
    tokenDistanceMeasurement,
} from "../../shared/token-distance.js";

import {
    configuredMeleeRange,
} from "../../shared/range-settings.js";

export function targetDistancePresentation(context) {
    if (!context?.token || !context?.target) return { measurement: null, text: "" };
    const measurement = tokenDistanceMeasurement(context.token, context.target);
    return { measurement, text: formatTokenDistance(measurement) };
}

export function attackRangePresentation(attack, isRanged, measurement) {
    if (!measurement) return null;
    return presentation(assessAttackRange(
        measurement.distance,
        attack?.range ?? attack?.system?.range,
        isRanged,
        { metric: measurement.metric, meleeRange: configuredMeleeRange() }
    ), "attack");
}

export function spellRangePresentation(spell, measurement) {
    if (!measurement) return null;
    return presentation(assessSpellRange(
        measurement.distance,
        spell?.range ?? spell?.system?.range,
        { metric: measurement.metric }
    ), "spell");
}

export function rangeStatusMarkup(model) {
    if (!model) return "";
    return `<small class="sf-action-range-status ${escapeAttr(model.className)}" title="${escapeAttr(model.label)}"><i class="fa-solid ${escapeAttr(model.icon)}" aria-hidden="true"></i>${escapeHtml(model.label)}</small>`;
}

function presentation(assessment, kind) {
    const status = assessment.status;
    const key = status === "within"
        ? "SMOOTHER_FIGHT.HUD.RangeWithin"
        : status === "outside"
            ? kind === "spell" ? "SMOOTHER_FIGHT.HUD.SpellRangeOutside" : "SMOOTHER_FIGHT.HUD.AttackRangeOutside"
            : "SMOOTHER_FIGHT.HUD.RangeUnknown";
    return {
        ...assessment,
        className: `is-${status}`,
        buttonClass: `is-range-${status}`,
        icon: status === "within" ? "fa-check" : status === "outside" ? "fa-triangle-exclamation" : "fa-circle-question",
        label: t(key),
    };
}
