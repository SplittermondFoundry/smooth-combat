import {
    prepareTemporaryRollModifiers,
} from "../../shared/temporary-roll-modifiers.js";

import {
    combatPositionSpellModifiers,
} from "./combat-position-modifier.js";

import {
    t,
} from "../../shared/values.js";

const SPELL_EFFECT_ITEM_TYPE = "spelleffect";
const SMALL_MAGIC_PROTECTION_NAME = /\bkleiner magieschutz\b/u;
const ENHANCED_EFFECT_NAME = /\b(?:verstarkt|verstaerkt)\p{Letter}*\b/u;

export function smallMagicProtectionModifier(target) {
    const effects = collectionValues(target?.actor?.items)
        .filter((item) => item?.type === SPELL_EFFECT_ITEM_TYPE && item?.system?.active === true)
        .map((item) => ({ item, normalizedName: normalizeEffectName(item.name) }))
        .filter(({ normalizedName }) => SMALL_MAGIC_PROTECTION_NAME.test(normalizedName));
    if (!effects.length) return null;

    const enhanced = effects.some(({ normalizedName }) => ENHANCED_EFFECT_NAME.test(normalizedName));
    const amount = enhanced ? -2 : -1;
    return {
        amount,
        effect: enhanced
            ? effects.find(({ normalizedName }) => ENHANCED_EFFECT_NAME.test(normalizedName))?.item
            : effects[0].item,
        name: t(enhanced
            ? "SMOOTHER_FIGHT.HUD.SmallMagicProtectionEnhancedModifier"
            : "SMOOTHER_FIGHT.HUD.SmallMagicProtectionModifier"),
        recordId: `small-magic-protection:${amount}`,
    };
}

export function prepareSpellTargetRollOptions(spell, target, rollOptions = {}) {
    const modifiers = [
        smallMagicProtectionModifier(target),
        ...combatPositionSpellModifiers(spell, target),
    ].filter(Boolean);
    return prepareSpellRollModifiers(spell, rollOptions, modifiers);
}

function prepareSpellRollModifiers(spell, rollOptions, modifiers) {
    return prepareTemporaryRollModifiers({
        skill: spell?.skill,
        modifierManager: spell?.actor?.modifier ?? spell?.skill?.actor?.modifier,
        groupId: spell?.skill?.id,
        rollOptions,
        modifiers,
    });
}

function collectionValues(collection) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (Array.isArray(collection.contents)) return collection.contents;
    if (typeof collection.values === "function") return Array.from(collection.values());
    return Array.from(collection);
}

function normalizeEffectName(value) {
    return String(value ?? "")
        .normalize("NFKD")
        .replace(/\p{Mark}/gu, "")
        .trim()
        .toLocaleLowerCase("de");
}
