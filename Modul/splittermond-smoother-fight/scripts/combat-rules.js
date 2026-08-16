/** Pure Splittermond combat calculations shared by the Foundry integration and tests. */

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

export function healthCostTotal(health) {
    return [health?.consumed?.value, health?.exhausted?.value, health?.channeled?.value]
        .reduce((total, value) => total + Math.max(0, numberOr(value)), 0);
}

export function healthCostFeedbackKind(previous, current, confirmed = false) {
    const before = numberOr(previous, Number.NaN);
    const after = numberOr(current, Number.NaN);
    if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
    if (after > before) return "damage";
    if (confirmed && after === before) return "damageBlocked";
    return null;
}

export function tickAdvanceConfirmed(previousInitiative, currentInitiative) {
    const before = Number(previousInitiative);
    const after = Number(currentInitiative);
    return Number.isFinite(before) && Number.isFinite(after) && after > before;
}

export function attackReadiness(isRanged, attackId, preparedAttackId) {
    const prepared = Boolean(isRanged && attackId && attackId === preparedAttackId);
    return {
        ready: Boolean(!isRanged || prepared),
        prepared,
    };
}

export function actionRequiresTarget(executesNow, targetDependent = true) {
    return Boolean(executesNow && targetDependent);
}

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

export function calculateActiveDefenseValue(checkData, defensiveFeature = 0) {
    const baseDefense = numberOr(checkData?.baseDefense);
    if (!checkData?.succeeded) return baseDefense;
    return baseDefense + 1 + totalDegreesOfSuccess(checkData) + numberOr(defensiveFeature);
}

export function mergeActiveDefenseCheck(checkData, checkReport) {
    if (!checkData && !checkReport) return null;
    const merged = { ...(checkReport ?? {}), ...(checkData ?? {}) };
    for (const key of ["succeeded", "isCrit", "isFumble", "degreeOfSuccess", "roll"]) {
        merged[key] = checkReport?.[key] ?? checkData?.[key] ?? merged[key];
    }
    return merged;
}

export function parseActiveDefenseDescription(value) {
    const text = String(value ?? "");
    const defenseMatch = text.match(/^\s*([^:\r\n]+?)\s*:\s*(-?\d+)\b/u);
    const numbingMatch = text.match(/(\d+)\s*(?:Punkte?|points?)?\s*(?:Betäubungsschaden|stun damage|numbing damage)\b/iu);
    return {
        defenseLabel: defenseMatch?.[1]?.trim() ?? "",
        defenseValue: defenseMatch ? Number.parseInt(defenseMatch[2], 10) : null,
        defensePrefixLength: defenseMatch?.[0]?.length ?? 0,
        numbingDamage: Math.max(0, Number.parseInt(numbingMatch?.[1] ?? "0", 10) || 0),
    };
}

export function activeDefenseChangesDifficulty(checkData, displayedDefenseValue) {
    if (checkData?.succeeded) return true;
    const baseDefense = Number(checkData?.baseDefense);
    const displayedDefense = Number(displayedDefenseValue);
    return displayedDefenseValue !== null
        && Number.isFinite(baseDefense)
        && Number.isFinite(displayedDefense)
        && displayedDefense > baseDefense;
}

export function bestActiveDefenseValue(currentValue, candidateValue) {
    const current = Number(currentValue);
    const candidate = Number(candidateValue);
    if (!Number.isFinite(current)) return Number.isFinite(candidate) ? candidate : 0;
    if (!Number.isFinite(candidate)) return current;
    return Math.max(current, candidate);
}

export function isDefenderMasteryName(value) {
    const name = normalizeSearchText(value);
    return /^(?:verteidiger|defender)(?:\s*\(|$)/u.test(name);
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

export function findDefensiveFeatureValue(itemData) {
    const queue = [itemData?.itemFeatures, itemData?.features, itemData];
    const visited = new Set();

    while (queue.length) {
        const current = queue.shift();
        if (!current || typeof current !== "object" || visited.has(current)) continue;
        visited.add(current);

        if (Array.isArray(current)) {
            for (const entry of current) {
                const name = String(entry?.name ?? entry?.id ?? entry?.key ?? "").toLocaleLowerCase("de");
                if (name === "defensiv") return numberOr(entry?.value, 1);
                queue.push(entry);
            }
            continue;
        }

        for (const value of Object.values(current)) queue.push(value);
    }
    return 0;
}

export function linkMatchesCombatant(link, combatant) {
    if (!link || !combatant) return false;
    const tokenUuid = combatant.token?.uuid ?? combatant.tokenUuid ?? null;
    const actorUuid = combatant.actor?.uuid ?? combatant.actorUuid ?? null;
    const actorId = combatant.actor?.id ?? combatant.actorId ?? null;
    if (link.tokenUuid && tokenUuid) return link.tokenUuid === tokenUuid;
    if (link.actorUuid && actorUuid) return link.actorUuid === actorUuid;
    return Boolean(link.actorId && actorId && link.actorId === actorId);
}

export function uniqueTokensByReference(tokens) {
    const references = new Set();
    return Array.from(tokens ?? []).filter((token) => {
        const reference = token?.uuid ?? token?.id ?? null;
        if (!reference || references.has(reference)) return false;
        references.add(reference);
        return true;
    });
}

export function normalizeUserTokenLinks(value, fallbackUserId = null) {
    if (!value || typeof value !== "object") return {};

    const normalized = Object.fromEntries(Object.entries(value).map(([userId, storedLinks]) => {
        const links = (Array.isArray(storedLinks) ? storedLinks : [storedLinks])
            .filter((link) => link && typeof link === "object")
            .filter((link) => link.tokenUuid || link.actorUuid || link.actorId)
            .map((link) => ({ ...link }));
        return [userId, links];
    }));
    const result = Object.fromEntries(Object.keys(normalized).map((userId) => [userId, []]));
    const entries = Object.entries(normalized).sort(([leftId], [rightId]) => {
        if (!fallbackUserId) return 0;
        if (leftId === fallbackUserId) return 1;
        if (rightId === fallbackUserId) return -1;
        return 0;
    });
    const claimed = new Set();
    for (const [userId, links] of entries) {
        for (const link of links) {
            const key = link.tokenUuid
                ? `token:${link.tokenUuid}`
                : link.actorUuid
                    ? `actor:${link.actorUuid}`
                    : `actor-id:${link.actorId}`;
            if (claimed.has(key)) continue;
            claimed.add(key);
            result[userId].push(link);
        }
    }
    return result;
}

export function normalizeActorUserLinks(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
        .filter(([actorUuid, userId]) =>
            typeof actorUuid === "string"
            && actorUuid.length > 0
            && actorUuid !== "__proto__"
            && actorUuid !== "constructor"
            && typeof userId === "string"
            && userId.length > 0
        ));
}

export function actorLinkUuid(actorUuid, actorId = null) {
    if (typeof actorUuid === "string" && actorUuid.startsWith("Actor.")) return actorUuid;
    return actorId ? `Actor.${actorId}` : actorUuid ?? "";
}

export function normalizeSearchText(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLocaleLowerCase("de")
        .trim();
}

export function mayViewActorResources(isGm, hasObserverPermission) {
    return Boolean(isGm || hasObserverPermission);
}

export function mayViewTargetDefenses(revealToEveryone, isGm, hasObserverPermission) {
    return Boolean(revealToEveryone || isGm || hasObserverPermission);
}

export function isCombatantVisibleToUser(isGm, combatantHidden, tokenHidden = false) {
    return Boolean(isGm || (!combatantHidden && !tokenHidden));
}

export function normalizeTargetReferences(values) {
    const references = new Set();
    for (const value of values ?? []) {
        const reference = typeof value === "string"
            ? value
            : value?.document?.uuid ?? value?.uuid ?? value?.id ?? null;
        if (reference) references.add(reference);
    }
    return Array.from(references);
}

export function mayViewTargetDifficulty(isTargetDependent, isGm, hasObserverPermission) {
    return !isTargetDependent || mayViewActorResources(isGm, hasObserverPermission);
}

export function mayUseRemoteChatActions(isGm, ownsSpeakerActor, isMessageAuthor, isAssignedSpeaker = false) {
    return Boolean(isGm || ownsSpeakerActor || isMessageAuthor || isAssignedSpeaker);
}

export function isPlayersTurn({ isGm = false, userId = null, linkedUserId = null, ownsActor = false } = {}) {
    if (!userId) return false;
    if (linkedUserId) return linkedUserId === userId;
    return Boolean(!isGm && ownsActor);
}

export function requiresRollManagementPermission(action, isDegreeOption = false) {
    if (isDegreeOption) return true;
    return ["consumecosts", "advancetoken", "addtick", "usesplinterpoint"].includes(
        String(action ?? "").trim().toLocaleLowerCase()
    );
}

export function isDamageSelectionAction(action) {
    const normalized = String(action ?? "").trim().toLocaleLowerCase();
    if (!normalized || normalized.startsWith("applydamageto")) return false;
    return normalized.includes("damage");
}

export function hasSplittermondCheckUpdate(changes) {
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) return false;
    if (Object.keys(changes).some((key) =>
        key === "flags.splittermond.check" || key.startsWith("flags.splittermond.check.")
    )) return true;

    const flags = changes.flags;
    if (!flags || typeof flags !== "object" || Array.isArray(flags)) return false;
    if (Object.hasOwn(flags, "splittermond.check")) return true;
    const splittermond = flags.splittermond;
    return Boolean(splittermond && typeof splittermond === "object" && Object.hasOwn(splittermond, "check"));
}

export function hasTokenPositionUpdate(changes) {
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) return false;
    return ["x", "y", "width", "height", "elevation"].some((key) => Object.hasOwn(changes, key));
}

export function tokenDocumentCenter(token, gridSize = 100) {
    const document = token?.document ?? token;
    if (document?.x === null || document?.x === undefined || document?.x === ""
        || document?.y === null || document?.y === undefined || document?.y === "") return null;
    const x = Number(document?.x);
    const y = Number(document?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const size = Number(gridSize) > 0 ? Number(gridSize) : 100;
    const widthValue = Number(document?.width);
    const heightValue = Number(document?.height);
    const width = Number.isFinite(widthValue) && widthValue > 0 ? widthValue : 1;
    const height = Number.isFinite(heightValue) && heightValue > 0 ? heightValue : 1;
    return {
        x: x + width * size / 2,
        y: y + height * size / 2,
    };
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
    if (!currentCombatantId && !currentActorId) return open;

    const belongsToCurrent = eventCombatantId === currentCombatantId
        || Boolean(eventActorId && eventActorId === currentActorId);
    return belongsToCurrent ? open : new Set();
}

function mapValue(values, key) {
    return values?.get?.(key) ?? values?.[key] ?? null;
}

export async function withTemporarySetValues(targetSet, values, callback) {
    const original = Array.from(targetSet ?? []);
    targetSet.clear();
    for (const value of values) targetSet.add(value);
    try {
        return await callback();
    } finally {
        targetSet.clear();
        for (const value of original) targetSet.add(value);
    }
}

export function combatMessageKind(message) {
    const type = message?.type;
    const modelName = message?.system?.constructor?.name;
    if (type === "attackRollMessage" || modelName === "AttackRollMessage") return "attack";
    if (type === "spellRollMessage" || modelName === "SpellRollMessage") return "spell";
    if (type === "damageMessage" || modelName === "DamageMessage") return "damage";
    return null;
}

export function isOffensiveCombatMessage(message) {
    const kind = combatMessageKind(message);
    return kind === "attack" || kind === "spell";
}

export function parseStatusEffectLabel(value) {
    const label = String(value ?? "").trim();
    if (!label) return { name: "", level: 0 };
    const match = label.match(/^(.*?)(?:\s+(\d+))?$/u);
    return {
        name: (match?.[1] ?? label).trim(),
        level: Math.max(1, Number.parseInt(match?.[2] ?? "1", 10) || 1),
    };
}

export function fullyConsumedCost(value) {
    const amount = Math.max(0, Math.round(numberOr(value)));
    return amount > 0 ? `${amount}V${amount}` : "0";
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

export function numberOr(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}
