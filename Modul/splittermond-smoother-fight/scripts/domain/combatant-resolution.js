/**
 * Resolves token-scoped combat identity without guessing between combatants
 * that share one Actor. An explicit but unmatched token reference deliberately
 * blocks the weaker Actor fallback.
 */
export function resolveCombatantByReferences(combatants, {
    combatantId = null,
    tokenReferences = [],
    actorReferences = [],
} = {}, {
    resolveToken = defaultCombatantToken,
} = {}) {
    const candidates = Array.from(combatants?.values?.() ?? combatants ?? [])
        .map((candidate) => Array.isArray(candidate) && candidate.length === 2 ? candidate[1] : candidate)
        .filter(Boolean);
    if (combatantId) {
        const exactCombatant = candidates.find((candidate) => candidate.id === combatantId);
        if (exactCombatant) return exactCombatant;
    }

    const tokenAliases = referenceAliases(tokenReferences, "Token");
    if (tokenAliases.size > 0) {
        return uniqueMatch(candidates, (candidate) => referencesOverlap(
            tokenAliases,
            tokenReferencesForCombatant(candidate, resolveToken)
        ));
    }

    const actorAliases = referenceAliases(actorReferences, "Actor");
    if (actorAliases.size === 0) return null;
    return uniqueMatch(candidates, (candidate) => referencesOverlap(
        actorAliases,
        actorReferencesForCombatant(candidate)
    ));
}

function uniqueMatch(candidates, predicate) {
    let match = null;
    for (const candidate of candidates) {
        if (!predicate(candidate)) continue;
        if (match) return null;
        match = candidate;
    }
    return match;
}

function tokenReferencesForCombatant(combatant, resolveToken) {
    const token = resolveToken?.(combatant) ?? defaultCombatantToken(combatant);
    return referenceAliases([
        combatant?.tokenId,
        combatant?.tokenUuid,
        token?.id,
        token?.uuid,
    ], "Token");
}

function actorReferencesForCombatant(combatant) {
    return referenceAliases([
        combatant?.actorId,
        combatant?.actorUuid,
        combatant?.actor?.id,
        combatant?.actor?.uuid,
    ], "Actor");
}

function referenceAliases(references, documentName) {
    const aliases = new Set();
    for (const reference of references ?? []) {
        const value = String(reference ?? "").trim();
        if (!value) continue;
        aliases.add(value);
        const embeddedId = new RegExp(`(?:^|\\.)${documentName}\\.([^.]+)$`, "u").exec(value)?.[1];
        if (embeddedId) aliases.add(embeddedId);
    }
    return aliases;
}

function referencesOverlap(left, right) {
    return Array.from(left).some((reference) => right.has(reference));
}

function defaultCombatantToken(combatant) {
    return combatant?.token?.document ?? combatant?.token ?? null;
}
