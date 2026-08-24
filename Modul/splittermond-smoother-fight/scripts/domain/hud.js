import {
    mapValue,
} from "./foundry-changes.js";

import {
    numberOr,
} from "./shared.js";

export function visibleCanvasCenterY(viewportHeight, tickBarBottom, hudTop) {
    const height = Number(viewportHeight);
    if (!Number.isFinite(height) || height <= 0) return 0;

    const boundary = (value, fallback) => {
        if (value === null || value === undefined || value === "") return fallback;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? Math.min(height, Math.max(0, numeric)) : fallback;
    };
    const top = boundary(tickBarBottom, 0);
    const bottom = boundary(hudTop, height);
    return bottom > top ? top + ((bottom - top) / 2) : height / 2;
}

export function normalizeFavoriteSkillIds(value, availableSkillIds, limit = 4) {
    const available = new Set(Array.from(availableSkillIds ?? [], (id) => String(id)));
    const maximum = Math.max(0, Math.floor(numberOr(limit, 4)));
    const source = Array.isArray(value) ? value : [];
    return Array.from(new Set(source.map((id) => String(id))))
        .filter((id) => available.has(id))
        .slice(0, maximum);
}

export function toggleFavoriteSkillId(value, skillId, availableSkillIds, limit = 4) {
    const available = new Set(Array.from(availableSkillIds ?? [], (id) => String(id)));
    const id = String(skillId ?? "");
    const ids = normalizeFavoriteSkillIds(value, available, limit);
    if (!id || !available.has(id)) return { ids, changed: false, added: false, limitReached: false };
    if (ids.includes(id)) {
        return { ids: ids.filter((candidate) => candidate !== id), changed: true, added: false, limitReached: false };
    }
    if (ids.length >= Math.max(0, Math.floor(numberOr(limit, 4)))) {
        return { ids, changed: false, added: false, limitReached: true };
    }
    return { ids: [...ids, id], changed: true, added: true, limitReached: false };
}

export function reorderFavoriteSkillIds(value, sourceSkillId, targetSkillId, placeAfter = false) {
    const ids = Array.from(new Set((Array.isArray(value) ? value : []).map((id) => String(id))));
    const source = String(sourceSkillId ?? "");
    const target = String(targetSkillId ?? "");
    if (!source || !target || source === target || !ids.includes(source) || !ids.includes(target)) return ids;
    const reordered = ids.filter((id) => id !== source);
    const targetIndex = reordered.indexOf(target);
    reordered.splice(targetIndex + (placeAfter ? 1 : 0), 0, source);
    return reordered;
}

export function selectPersonalCombatant(candidates, controlledTokenReference = null, preferredCombatantId = null) {
    const owned = Array.from(candidates ?? []).filter((candidate) => candidate?.owned);
    const controlled = String(controlledTokenReference ?? "").trim();
    if (controlled) {
        const selected = owned.find((candidate) => [candidate.tokenUuid, candidate.tokenId]
            .some((reference) => String(reference ?? "") === controlled));
        if (selected) return selected;
    }
    const preferred = String(preferredCombatantId ?? "").trim();
    if (preferred) {
        const selected = owned.find((candidate) => String(candidate.id ?? candidate.combatant?.id ?? "") === preferred);
        if (selected) return selected;
    }
    return owned.length === 1 ? owned[0] : null;
}

export function resolveCombatEventOpenIds(previousEventIds, previousOpenEventIds, currentEventIds, turn = {}) {
    const previous = new Set(previousEventIds ?? []);
    const previouslyOpen = new Set(previousOpenEventIds ?? []);
    const current = Array.from(currentEventIds ?? []);
    const currentSet = new Set(current);
    const newEventIds = current.filter((eventId) => !previous.has(eventId));
    const removedEventIds = Array.from(previous).filter((eventId) => !currentSet.has(eventId));
    const structureChanged = newEventIds.length > 0
        || removedEventIds.length > 0
        || Boolean(turn.forceLatestEvent);
    const latestEventId = current.at(-1);
    const open = structureChanged
        ? new Set(latestEventId ? [latestEventId] : [])
        : new Set(current.filter((eventId) => previouslyOpen.has(eventId)));

    const currentCombatantId = turn.currentCombatantId ?? null;
    if (!latestEventId) return open;
    const eventCombatantId = mapValue(turn.eventCombatantIds, latestEventId);
    const eventActorId = mapValue(turn.eventActorIds, latestEventId);
    const currentActorId = turn.currentActorId ?? null;
    const outOfTurn = new Set(turn.outOfTurnEventIds ?? []).has(latestEventId);
    const newlyMarkedOutOfTurn = outOfTurn && !new Set(turn.previousOutOfTurnEventIds ?? []).has(latestEventId);
    if (newlyMarkedOutOfTurn) return new Set([latestEventId]);
    if (!currentCombatantId && !currentActorId) return open;

    const belongsToCurrent = eventCombatantId === currentCombatantId
        || Boolean(eventActorId && eventActorId === currentActorId);
    return belongsToCurrent || outOfTurn ? open : new Set();
}

export function combatActionHighlightState({
    isOffense = false,
    hasPendingDegreeOptions = false,
    followUpStarted = false,
    isSpell = false,
    hasPendingFocusCost = false,
    hasPendingDamage = false,
    hasPendingDamageApplication = false,
} = {}) {
    const degrees = Boolean(isOffense && hasPendingDegreeOptions && !followUpStarted);
    const focus = Boolean(!degrees && isSpell && hasPendingFocusCost);
    const damage = Boolean(!degrees && !focus && isOffense && hasPendingDamage);
    return {
        degrees,
        focus,
        damage,
        ticks: !degrees && !focus && !damage && !hasPendingDamageApplication,
    };
}
