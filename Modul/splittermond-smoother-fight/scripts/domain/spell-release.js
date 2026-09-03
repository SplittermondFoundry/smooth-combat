import { combatMessageKind } from "./messages.js";

export function preparedSpellReleaseTickCost(message, context) {
    if (combatMessageKind(message) !== "spell"
        || context?.actionKind !== "spell"
        || !context?.combatId
        || !context?.combatantId
        || context?.supersededBy
        || message?.system?.tickCostHandler?.isOption === true) return null;
    const configured = Number(message?.system?.tickCostHandler?.baseTickCost);
    return Number.isFinite(configured) && configured > 0
        ? Math.round(configured)
        : 3;
}
