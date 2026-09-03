export function combatWorkflowCandidates(workflows) {
    return Array.from(workflows ?? [])
        .map(workflowCandidate)
        .filter(Boolean)
        .sort((left, right) => left.createdAt - right.createdAt || left.order - right.order);
}

export function selectCombatWorkflowFocus(workflows) {
    return combatWorkflowCandidates(workflows).at(0) ?? null;
}

export function combatWorkflowAllowsTick({ isGM = false, blocker = null, messageId = null } = {}) {
    if (isGM || !blocker) return true;
    return ["defense-ticks", "fumble"].includes(blocker.step) && blocker.messageId === messageId;
}

function workflowCandidate(workflow, order = 0) {
    const cards = Array.from(workflow?.cards ?? []);
    if (!workflow?.id || !cards.length) return null;
    const base = {
        workflowId: workflow.id,
        createdAt: finiteNumber(workflow.createdAt, Number.MAX_SAFE_INTEGER),
        order: finiteNumber(workflow.order, order),
    };
    const pendingRoll = cards.find((card) => card.step === "defense-roll");
    if (pendingRoll) return candidate(base, pendingRoll, true);
    const fumble = [...cards].reverse().find((card) => card.kind === "fumble" && card.pendingAction);
    if (fumble) return candidate(base, fumble, true, "fumble");
    const defenseTicks = cards.find((card) => card.kind === "defense" && card.pendingTicks);
    if (defenseTicks) return candidate(base, defenseTicks, true, "defense-ticks");
    const canonicalOffense = [...cards].reverse().find((card) => card.kind === "offense" && card.canonical);
    if (canonicalOffense?.awaitingDefense) {
        return candidate(base, canonicalOffense, true, "defense-decision");
    }
    const interruption = cards.find((card) => card.kind === "interruption" && card.pendingAction);
    if (interruption) return candidate(base, interruption, true, "interruption");
    const damage = [...cards].reverse().find((card) => card.kind === "damage" && card.pendingAction);
    if (damage) return candidate(base, damage, false, "damage");
    if (canonicalOffense?.pendingAction) return candidate(base, canonicalOffense, false, "offense");
    const pendingCard = [...cards].reverse().find((card) => card.pendingAction);
    return pendingCard ? candidate(base, pendingCard, false) : null;
}

function candidate(base, card, blocking, step = card.step) {
    return {
        ...base,
        groupId: card.groupId,
        messageId: card.messageId ?? null,
        kind: card.kind,
        step: step ?? card.kind,
        blocking: Boolean(blocking),
        synthetic: Boolean(card.synthetic),
    };
}

function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
