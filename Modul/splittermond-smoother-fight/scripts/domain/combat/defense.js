import {
    normalizeSearchText,
} from "../assignments.js";

import {
    totalDegreesOfSuccess,
} from "./attack.js";

import {
    numberOr,
} from "../shared.js";

export function calculateActiveDefenseValue(checkData, defensiveFeature = 0) {
    const baseDefense = numberOr(checkData?.baseDefense);
    if (!checkData?.succeeded) return baseDefense;
    return baseDefense + 1 + totalDegreesOfSuccess(checkData) + numberOr(defensiveFeature);
}

export function calculateActiveDefenseDifficulty(baseDifficulty, distractingFeature = 0) {
    const base = numberOr(baseDifficulty, 15);
    const level = Math.max(0, numberOr(distractingFeature));
    return base + 5 * level;
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

export function findDistractingFeatureValue(...sources) {
    return Math.max(0, ...sources.map((source) => findFeatureValue(source, "ablenkend")));
}

function findFeatureValue(source, featureName) {
    const queue = [source];
    const visited = new Set();
    let highest = 0;

    while (queue.length) {
        const current = queue.shift();
        if (!current) continue;

        if (typeof current === "string") {
            highest = Math.max(highest, featureValueFromText(current, featureName));
            continue;
        }
        if (typeof current !== "object" || visited.has(current)) continue;
        visited.add(current);

        if (typeof current.featureValue === "function") {
            try {
                highest = Math.max(highest, positiveFeatureValue(current.featureValue("Ablenkend"), 0));
                continue;
            } catch {
                // Serialized feature data remains available through the traversal below.
            }
        }

        const name = normalizeSearchText(current.name ?? current.id ?? current.key ?? "");
        if (name === featureName) highest = Math.max(highest, positiveFeatureValue(current.value, 1));
        for (const value of Object.values(current)) {
            if (typeof value !== "function") queue.push(value);
        }
    }
    return highest;
}

function featureValueFromText(value, featureName) {
    for (const entry of String(value).split(",")) {
        const match = entry.trim().match(/^(.+?)(?:\s+(\d+))?$/u);
        if (normalizeSearchText(match?.[1]) !== featureName) continue;
        return positiveFeatureValue(match?.[2], 1);
    }
    return 0;
}

function positiveFeatureValue(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
