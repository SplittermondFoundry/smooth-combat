/** Pure Splittermond combat calculations shared by the Foundry integration and tests. */

export const DEFAULT_CHECK_CONFIG = Object.freeze({
    triumphBonus: 3,
    fumblePenalty: -3,
    grazingHitBasePenalty: 2,
});

export function totalDegreesOfSuccess(report) {
    return numberOr(report?.degreeOfSuccess?.fromRoll) + numberOr(report?.degreeOfSuccess?.modification);
}

export function calculateActiveDefenseValue(checkData, defensiveFeature = 0) {
    const baseDefense = numberOr(checkData?.baseDefense);
    if (!checkData?.succeeded) return baseDefense;
    return baseDefense + 1 + totalDegreesOfSuccess(checkData) + numberOr(defensiveFeature);
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

export function mayViewTargetDifficulty(isTargetDependent, isGm, hasObserverPermission) {
    return !isTargetDependent || mayViewActorResources(isGm, hasObserverPermission);
}

export function mayUseRemoteChatActions(isGm, ownsSpeakerActor, isMessageAuthor) {
    return Boolean(isGm || ownsSpeakerActor || isMessageAuthor);
}

export function isPlayersTurn({ isGm = false, userId = null, linkedUserId = null, ownsActor = false } = {}) {
    if (isGm || !userId) return false;
    return linkedUserId ? linkedUserId === userId : Boolean(ownsActor);
}

export function requiresRollManagementPermission(action, isDegreeOption = false) {
    if (isDegreeOption) return true;
    return ["consumecosts", "advancetoken", "usesplinterpoint"].includes(
        String(action ?? "").trim().toLocaleLowerCase()
    );
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

export function resolveCombatEventOpenIds(previousEventIds, previousOpenEventIds, currentEventIds, turn = {}) {
    const previous = new Set(previousEventIds ?? []);
    const previouslyOpen = new Set(previousOpenEventIds ?? []);
    const current = Array.from(currentEventIds ?? []);
    const newEventIds = current.filter((eventId) => !previous.has(eventId));
    const open = newEventIds.length
        ? new Set([newEventIds.at(-1)])
        : new Set(current.filter((eventId) => previouslyOpen.has(eventId)));

    const previousCombatantId = turn.previousCombatantId ?? null;
    const currentCombatantId = turn.currentCombatantId ?? null;
    if (!previousCombatantId || !currentCombatantId || previousCombatantId === currentCombatantId) return open;

    const latestEventId = current.at(-1);
    if (!latestEventId) return open;
    const eventCombatantId = mapValue(turn.eventCombatantIds, latestEventId);
    const eventActorId = mapValue(turn.eventActorIds, latestEventId);
    const belongsToPrevious = eventCombatantId
        ? eventCombatantId === previousCombatantId
        : Boolean(eventActorId && eventActorId === turn.previousActorId);
    const belongsToCurrent = eventCombatantId
        ? eventCombatantId === currentCombatantId
        : Boolean(eventActorId && eventActorId === turn.currentActorId);
    if (belongsToPrevious && !belongsToCurrent) open.delete(latestEventId);
    return open;
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

export function numberOr(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}
