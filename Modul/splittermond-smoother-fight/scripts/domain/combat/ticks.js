// Page references are verified against the hash-pinned local OCR corpus in the
// companion Splittermond database project. Omit `source` for unverified rules.
export const COMBAT_TICK_ACTIONS = Object.freeze([
    { id: "standUpProne", category: "movement", kind: "continuous", ticks: 6, source: { book: "GRW", page: 159 } },
    { id: "standUpKneeling", category: "movement", kind: "continuous", ticks: 3, source: { book: "GRW", page: 159 } },
    { id: "disengage", category: "movement", kind: "immediate", ticks: 5, special: true, source: { book: "GRW", page: 159 } },
    { id: "dropProne", category: "movement", kind: "reaction", ticks: 2, source: { book: "GRW", page: 159 } },
    { id: "crawl", category: "movement", kind: "continuous", ticks: 5, special: true, source: { book: "GRW", page: 159 } },
    { id: "walk", category: "movement", kind: "continuous", ticks: 5, special: true, source: { book: "GRW", page: 159 } },
    { id: "sprint", category: "movement", kind: "continuous", ticks: 10, special: true, source: { book: "GRW", page: 159 } },
    { id: "meleeAttack", category: "melee", kind: "immediate", ticks: "wgs", actionable: false, source: { book: "GRW", page: 161 } },
    { id: "opportunityAttack", category: "melee", kind: "reaction", ticks: "wgs", actionable: false, special: true, source: { book: "GRW", page: 161 } },
    { id: "searchOpening", category: "melee", kind: "continuous", ticks: [2, 4, 6], special: true, source: { book: "GRW", page: 161 } },
    { id: "shieldBash", category: "melee", kind: "immediate", ticks: 7, special: true, source: { book: "GRW", page: 161 } },
    { id: "readyRangedAttack", category: "ranged", kind: "continuous", ticks: "wgs", actionable: false, special: true, source: { book: "GRW", page: "162–163" } },
    { id: "aim", category: "ranged", kind: "continuous", ticks: [2, 4, 6], special: true, source: { book: "GRW", page: "162–163" } },
    { id: "rangedAttack", category: "ranged", kind: "immediate", ticks: 3, actionable: false, source: { book: "GRW", page: "162–163" } },
    { id: "activeDefense", category: "defense", kind: "reaction", ticks: 3, actionable: false, special: true, source: { book: "GRW", page: "163–164" } },
    { id: "evasiveLeap", category: "defense", kind: "reaction", ticks: 3, special: true, source: { book: "GRW", page: 164 } },
    { id: "escapeGrapple", category: "defense", kind: "immediate", ticks: 5, special: true, source: { book: "GRW", page: 164 } },
    { id: "releaseGrapple", category: "defense", kind: "reaction", ticks: 3, special: true, source: { book: "GRW", page: 164 } },
    { id: "catchBreath", category: "other", kind: "continuous", ticks: 8, special: true, source: { book: "GRW", page: "165–167" } },
    { id: "focusMagic", category: "other", kind: "continuous", ticks: "spell", actionable: false, special: true, source: { book: "GRW", page: "165–167" } },
    { id: "castSpell", category: "other", kind: "immediate", ticks: 3, actionable: false, source: { book: "GRW", page: "165–167" } },
    { id: "dropItem", category: "other", kind: "immediate", ticks: 0, source: { book: "GRW", page: "165–167" } },
    { id: "useItem", category: "other", kind: "continuous", ticks: 5, special: true, source: { book: "GRW", page: "165–167" } },
    { id: "simpleCommand", category: "commands", kind: "reaction", ticks: 3, special: true, source: { book: "Die Magie", page: 180 } },
    { id: "complexCommand", category: "commands", kind: "reaction", ticks: 5, special: true, source: { book: "Die Magie", page: 180 } },
    { id: "task", category: "commands", kind: "continuous", ticks: 5, special: true, source: { book: "Die Magie", page: 180 } },
    { id: "complexTask", category: "commands", kind: "unavailable", ticks: "unavailable", actionable: false, source: { book: "Die Magie", page: 180 } },
    { id: "collectiveCommand", category: "commands", kind: "reaction", ticks: 8, special: true, source: { book: "Die Magie", page: 180 } },
    { id: "coordinate", category: "commands", kind: "continuous", ticks: 10, special: true, source: { book: "GRW", page: 104 } },
].map((action) => Object.freeze({
    ...action,
    ...(action.source ? { source: Object.freeze(action.source) } : {}),
})));

export function combatTickActionsFor(ticks = "custom") {
    if (ticks === "custom") return [...COMBAT_TICK_ACTIONS];
    const requested = Number(ticks);
    if (!Number.isFinite(requested)) return [];
    return COMBAT_TICK_ACTIONS.filter((action) => Array.isArray(action.ticks)
        ? action.ticks.includes(requested)
        : action.ticks === requested);
}

export function normalizeFavoriteTickActionIds(value, availableActionIds = COMBAT_TICK_ACTIONS.map((action) => action.id)) {
    const available = new Set(Array.from(availableActionIds ?? [], (id) => String(id)));
    const source = Array.isArray(value) ? value : [];
    return Array.from(new Set(source.map((id) => String(id))))
        .filter((id) => available.has(id));
}

export function toggleFavoriteTickActionId(value, actionId, availableActionIds = COMBAT_TICK_ACTIONS.map((action) => action.id)) {
    const available = new Set(Array.from(availableActionIds ?? [], (id) => String(id)));
    const id = String(actionId ?? "");
    const ids = normalizeFavoriteTickActionIds(value, available);
    if (!id || !available.has(id)) return { ids, changed: false, added: false };
    if (ids.includes(id)) {
        return { ids: ids.filter((candidate) => candidate !== id), changed: true, added: false };
    }
    return { ids: [...ids, id], changed: true, added: true };
}

export function tickAdvanceConfirmed(previousInitiative, currentInitiative) {
    const before = Number(previousInitiative);
    const after = Number(currentInitiative);
    return Number.isFinite(before) && Number.isFinite(after) && after > before;
}

export function actionRequiresTarget(executesNow, targetDependent = true) {
    return Boolean(executesNow && targetDependent);
}
