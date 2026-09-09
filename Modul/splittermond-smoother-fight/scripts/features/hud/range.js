import {
    assessAttackRange,
    assessSpellRange,
    hasSorcerersHandForSpell,
    spellRangeKind,
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

export function targetLinePresentation(context, distanceText = "") {
    if (!context.target) return t("SMOOTHER_FIGHT.HUD.NoTargetDetail");
    const user = context.runtimeController?.name ?? t("SMOOTHER_FIGHT.HUD.NoRuntimeController");
    const target = context.target.name ?? context.target.actor?.name ?? "–";
    const additional = Math.max(0, context.targets.length - 1);
    return `${t("SMOOTHER_FIGHT.HUD.PlayerPrimaryTargetName", { user, target })}${distanceText ? ` · ${distanceText}` : ""}${additional ? ` (+${additional})` : ""}`;
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

export function spellRangePresentation(spell, measurement, actor = spell?.actor) {
    if (!measurement) return null;
    const listedRange = spell?.range ?? spell?.system?.range;
    const casterHasSorcerersHand = hasSorcerersHandForSpell(actor, spell);
    if (spellRangeKind(listedRange) === "caster" && !casterHasSorcerersHand) return null;
    return presentation(assessSpellRange(
        measurement.distance,
        listedRange,
        {
            metric: measurement.metric,
            adjacent: measurement.adjacent,
            casterHasSorcerersHand,
        }
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
