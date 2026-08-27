import {
    t,
} from "../../shared/values.js";

import {
    installTemporarySelectableModifier,
} from "../../shared/temporary-selectable-modifier.js";

const SPELL_EFFECT_ITEM_TYPE = "spelleffect";
const SMALL_MAGIC_PROTECTION_NAME = /\bkleiner magieschutz\b/u;
const ENHANCED_EFFECT_NAME = /\b(?:verstarkt|verstaerkt)\p{Letter}*\b/u;
const SPELL_ROLL_SELECTION_ID = "smootherFightSpellRollSelectionId";
const spellRollSelectionRecords = new WeakMap();

export function smallMagicProtectionModifier(target) {
    const effects = collectionValues(target?.actor?.items)
        .filter((item) => item?.type === SPELL_EFFECT_ITEM_TYPE && item?.system?.active === true)
        .map((item) => ({ item, normalizedName: normalizeEffectName(item.name) }))
        .filter(({ normalizedName }) => SMALL_MAGIC_PROTECTION_NAME.test(normalizedName));
    if (!effects.length) return null;

    const enhanced = effects.some(({ normalizedName }) => ENHANCED_EFFECT_NAME.test(normalizedName));
    return {
        amount: enhanced ? -2 : -1,
        effect: enhanced
            ? effects.find(({ normalizedName }) => ENHANCED_EFFECT_NAME.test(normalizedName))?.item
            : effects[0].item,
        name: t(enhanced
            ? "SMOOTHER_FIGHT.HUD.SmallMagicProtectionEnhancedModifier"
            : "SMOOTHER_FIGHT.HUD.SmallMagicProtectionModifier"),
    };
}

export function prepareSmallMagicProtectionRollOptions(spell, target, rollOptions = {}) {
    const modifier = smallMagicProtectionModifier(target);
    if (!modifier) return emptyPreparedRoll(rollOptions);

    const skill = spell?.skill;
    const recordId = `small-magic-protection:${modifier.amount}`;
    const selectionId = temporarySelectionId();
    const cleanupSelection = installSpellRollSelection(skill, selectionId, {
        amount: modifier.amount,
        installModifier: () => installTemporarySelectableModifier({
            skill,
            modifierManager: spell?.actor?.modifier,
            groupId: skill?.id,
            recordId,
            name: modifier.name,
            amount: modifier.amount,
        }),
        modifierName: modifier.name,
    });
    if (!cleanupSelection) return numericPreparedRoll(rollOptions, modifier);

    const selected = Array.isArray(rollOptions?.preSelectedModifier)
        ? rollOptions.preSelectedModifier
        : [];
    return {
        cleanup: cleanupSelection,
        modifier,
        rollOptions: {
            ...(rollOptions ?? {}),
            [SPELL_ROLL_SELECTION_ID]: selectionId,
            preSelectedModifier: uniqueModifierNames([...selected, modifier.name]),
        },
        usesNamedModifier: true,
    };
}

function installSpellRollSelection(skill, selectionId, record) {
    if (!skill || (typeof skill !== "object" && typeof skill !== "function") || typeof skill.roll !== "function") {
        return null;
    }

    let state = spellRollSelectionRecords.get(skill);
    if (state && skill.roll !== state.wrappedRoll) return null;
    if (!state) {
        const ownDescriptor = Object.getOwnPropertyDescriptor(skill, "roll");
        const originalRoll = skill.roll;
        state = {
            entries: new Map(),
            originalRoll,
            ownDescriptor,
            wrappedRoll: null,
        };
        state.wrappedRoll = function smootherFightSpellRoll(options = {}) {
            const activeSelectionId = options?.[SPELL_ROLL_SELECTION_ID];
            const activeRecord = state.entries.get(activeSelectionId);
            if (!activeRecord) return state.originalRoll.call(this, options);
            const selected = Array.isArray(options?.preSelectedModifier)
                ? options.preSelectedModifier
                : [];
            const nextOptions = {
                ...(options ?? {}),
            };
            delete nextOptions[SPELL_ROLL_SELECTION_ID];
            const cleanupModifier = activeRecord.installModifier();
            if (cleanupModifier) {
                nextOptions.preSelectedModifier = uniqueModifierNames([
                    ...selected,
                    activeRecord.modifierName,
                ]);
            } else {
                const existingModifier = Number(nextOptions.modifier);
                nextOptions.modifier = (Number.isFinite(existingModifier) ? existingModifier : 0)
                    + activeRecord.amount;
                nextOptions.preSelectedModifier = selected.filter((name) => (
                    String(name ?? "").trim().toLocaleLowerCase()
                    !== activeRecord.modifierName.toLocaleLowerCase()
                ));
            }
            try {
                return state.originalRoll.call(this, nextOptions);
            } finally {
                cleanupModifier?.();
                releaseSpellRollSelection(skill, state, activeSelectionId);
            }
        };
        try {
            Object.defineProperty(skill, "roll", {
                configurable: true,
                writable: true,
                value: state.wrappedRoll,
            });
        } catch (_error) {
            return null;
        }
        if (skill.roll !== state.wrappedRoll) return null;
        spellRollSelectionRecords.set(skill, state);
    }

    state.entries.set(selectionId, record);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        releaseSpellRollSelection(skill, state, selectionId);
    };
}

function releaseSpellRollSelection(skill, state, selectionId) {
    state.entries.delete(selectionId);
    if (state.entries.size) return;
    try {
        if (skill.roll === state.wrappedRoll) {
            if (state.ownDescriptor) Object.defineProperty(skill, "roll", state.ownDescriptor);
            else delete skill.roll;
        }
    } catch (_error) {
        if (skill.roll === state.wrappedRoll) skill.roll = state.originalRoll;
    }
    spellRollSelectionRecords.delete(skill);
}

function numericPreparedRoll(rollOptions, modifier) {
    const existingModifier = Number(rollOptions?.modifier);
    return {
        cleanup: () => {},
        modifier,
        rollOptions: {
            ...(rollOptions ?? {}),
            modifier: (Number.isFinite(existingModifier) ? existingModifier : 0) + modifier.amount,
        },
        usesNamedModifier: false,
    };
}

function emptyPreparedRoll(rollOptions) {
    return {
        cleanup: () => {},
        modifier: null,
        rollOptions,
        usesNamedModifier: false,
    };
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

function uniqueModifierNames(names) {
    const seen = new Set();
    return names.filter((name) => {
        const normalized = String(name ?? "").trim();
        const key = normalized.toLocaleLowerCase();
        if (!normalized || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function temporarySelectionId() {
    return globalThis.foundry?.utils?.randomID?.()
        ?? globalThis.crypto?.randomUUID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
