import { resolveCombatPosition } from "../../shared/combat-position-state.js";
import { t } from "../../shared/values.js";

const CROSSBOW_NAME = /(?:armbrust|balester|crossbow)/u;

export function combatPositionAttackModifiers({
    attacker,
    target,
    attack,
    isRanged,
}) {
    const ranged = Boolean(isRanged);
    return [
        ownPositionModifier(attacker, { attack, isRanged: ranged }),
        opposingPositionModifier(target, { isRanged: ranged }),
    ].filter(Boolean);
}

export function combatPositionSpellModifiers(spell, target) {
    const difficulty = spell?.difficulty ?? spell?.system?.difficulty;
    if (String(difficulty ?? "").trim().toLocaleUpperCase() !== "VTD") return [];
    return [opposingPositionModifier(target, { isRanged: true })].filter(Boolean);
}

export function isCrossbowAttack(attack) {
    return attackNames(attack).some((name) => CROSSBOW_NAME.test(normalizeName(name)));
}

export function ownPositionModifier(actor, { attack, isRanged }) {
    const position = unambiguousPosition(actor);
    const amount = ownPositionAmount(position, {
        isCrossbow: Boolean(isRanged) && isCrossbowAttack(attack),
        isRanged: Boolean(isRanged),
    });
    return positionModifier("own", position, amount);
}

export function opposingPositionModifier(target, { isRanged }) {
    const position = unambiguousPosition(target?.actor ?? target);
    const amount = opposingPositionAmount(position, Boolean(isRanged));
    return positionModifier("target", position, amount);
}

export function ownPositionAmount(position, { isCrossbow = false, isRanged = false } = {}) {
    switch (position) {
        case "kneeling": return isRanged ? 0 : -3;
        case "prone": return isRanged && isCrossbow ? 0 : -6;
        case "flying": return 3;
        default: return 0;
    }
}

export function opposingPositionAmount(position, isRanged = false) {
    switch (position) {
        case "kneeling": return isRanged ? -3 : 3;
        case "prone": return isRanged ? -6 : 6;
        case "flying": return -3;
        default: return 0;
    }
}

function positionModifier(scope, position, amount) {
    if (!position || !amount) return null;
    return {
        amount,
        name: t(`SMOOTHER_FIGHT.HUD.CombatPositionModifiers.${scope}.${position}`),
        position,
        recordId: `combat-position:${scope}:${position}:${amount}`,
        scope,
    };
}

function unambiguousPosition(actor) {
    const resolved = resolveCombatPosition(actor);
    return resolved.ambiguous ? null : resolved.id;
}

function attackNames(attack) {
    return [
        attack?.name,
        attack?.item?.name,
        attack?.item?.system?.name,
    ].filter(Boolean);
}

function normalizeName(value) {
    return String(value ?? "")
        .normalize("NFKD")
        .replace(/\p{Mark}/gu, "")
        .trim()
        .toLocaleLowerCase("de");
}
