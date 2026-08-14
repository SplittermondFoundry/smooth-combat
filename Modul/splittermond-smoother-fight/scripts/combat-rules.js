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
    return Boolean(
        (link.tokenUuid && tokenUuid && link.tokenUuid === tokenUuid) ||
        (link.actorUuid && actorUuid && link.actorUuid === actorUuid) ||
        (link.actorId && actorId && link.actorId === actorId)
    );
}

export function normalizeUserTokenLinks(value) {
    if (!value || typeof value !== "object") return {};

    return Object.fromEntries(Object.entries(value).map(([userId, storedLinks]) => {
        const links = (Array.isArray(storedLinks) ? storedLinks : [storedLinks])
            .filter((link) => link && typeof link === "object")
            .filter((link) => link.tokenUuid || link.actorUuid || link.actorId)
            .map((link) => ({ ...link }));
        return [userId, links];
    }));
}

export function combatMessageKind(message) {
    const type = message?.type;
    const modelName = message?.system?.constructor?.name;
    if (type === "attackRollMessage" || modelName === "AttackRollMessage") return "attack";
    if (type === "spellRollMessage" || modelName === "SpellRollMessage") return "spell";
    if (type === "damageMessage" || modelName === "DamageMessage") return "damage";
    return null;
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
