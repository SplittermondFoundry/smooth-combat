export const COMBAT_TICK_ACTIONS = Object.freeze([
    { id: "standUpProne", category: "movement", kind: "continuous", ticks: 6 },
    { id: "standUpKneeling", category: "movement", kind: "continuous", ticks: 3 },
    { id: "disengage", category: "movement", kind: "immediate", ticks: 5, special: true },
    { id: "dropProne", category: "movement", kind: "reaction", ticks: 2 },
    { id: "crawl", category: "movement", kind: "continuous", ticks: 5, special: true },
    { id: "walk", category: "movement", kind: "continuous", ticks: 5, special: true },
    { id: "sprint", category: "movement", kind: "continuous", ticks: 10, special: true },
    { id: "meleeAttack", category: "melee", kind: "immediate", ticks: "wgs" },
    { id: "opportunityAttack", category: "melee", kind: "reaction", ticks: "wgs", special: true },
    { id: "searchOpening", category: "melee", kind: "continuous", ticks: [2, 4, 6], special: true },
    { id: "shieldBash", category: "melee", kind: "immediate", ticks: 7, special: true },
    { id: "readyRangedAttack", category: "ranged", kind: "continuous", ticks: "wgs", special: true },
    { id: "aim", category: "ranged", kind: "continuous", ticks: [2, 4, 6], special: true },
    { id: "rangedAttack", category: "ranged", kind: "immediate", ticks: 3 },
    { id: "activeDefense", category: "defense", kind: "reaction", ticks: 3, special: true },
    { id: "evasiveLeap", category: "defense", kind: "reaction", ticks: 3, special: true },
    { id: "escapeGrapple", category: "defense", kind: "immediate", ticks: 5, special: true },
    { id: "releaseGrapple", category: "defense", kind: "reaction", ticks: 3, special: true },
    { id: "catchBreath", category: "other", kind: "continuous", ticks: 8, special: true },
    { id: "focusMagic", category: "other", kind: "continuous", ticks: "spell", special: true },
    { id: "castSpell", category: "other", kind: "immediate", ticks: 3 },
    { id: "dropItem", category: "other", kind: "immediate", ticks: 0 },
    { id: "useItem", category: "other", kind: "continuous", ticks: 5, special: true },
    { id: "simpleCommand", category: "commands", kind: "reaction", ticks: 3, special: true },
    { id: "complexCommand", category: "commands", kind: "reaction", ticks: 5, special: true },
    { id: "task", category: "commands", kind: "continuous", ticks: 5, special: true },
    { id: "complexTask", category: "commands", kind: "unavailable", ticks: "unavailable" },
    { id: "collectiveCommand", category: "commands", kind: "reaction", ticks: 8, special: true },
    { id: "coordinate", category: "commands", kind: "continuous", ticks: 10, special: true },
].map((action) => Object.freeze(action)));

export function combatTickActionsFor(ticks = "custom") {
    if (ticks === "custom") return [...COMBAT_TICK_ACTIONS];
    const requested = Number(ticks);
    if (!Number.isFinite(requested)) return [];
    return COMBAT_TICK_ACTIONS.filter((action) => Array.isArray(action.ticks)
        ? action.ticks.includes(requested)
        : action.ticks === requested);
}

export function tickAdvanceConfirmed(previousInitiative, currentInitiative) {
    const before = Number(previousInitiative);
    const after = Number(currentInitiative);
    return Number.isFinite(before) && Number.isFinite(after) && after > before;
}

export function actionRequiresTarget(executesNow, targetDependent = true) {
    return Boolean(executesNow && targetDependent);
}
