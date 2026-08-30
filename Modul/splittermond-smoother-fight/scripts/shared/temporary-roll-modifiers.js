import {
    installTemporarySelectableModifier,
} from "./temporary-selectable-modifier.js";

const ROLL_SELECTION_ID = "smootherFightTemporaryRollSelectionId";
const rollSelectionRecords = new WeakMap();

export function prepareTemporaryRollModifiers({
    skill,
    modifierManager = null,
    groupId,
    rollOptions = {},
    modifiers = [],
    defaultSelectedModifiers = [],
}) {
    const normalizedModifiers = normalizeModifiers(modifiers);
    if (!normalizedModifiers.length) return emptyPreparedRoll(rollOptions);

    const selectionId = temporarySelectionId();
    const cleanupSelection = installRollSelection(skill, selectionId, {
        groupId,
        modifierManager,
        modifiers: normalizedModifiers,
    });
    if (!cleanupSelection) return numericPreparedRoll(rollOptions, normalizedModifiers);

    const selected = Array.isArray(rollOptions?.preSelectedModifier)
        ? rollOptions.preSelectedModifier
        : [];
    return {
        cleanup: cleanupSelection,
        modifiers: normalizedModifiers,
        rollOptions: {
            ...(rollOptions ?? {}),
            [ROLL_SELECTION_ID]: selectionId,
            preSelectedModifier: uniqueModifierNames([
                ...defaultSelectedModifiers,
                ...selected,
                ...normalizedModifiers.map((modifier) => modifier.name),
            ]),
        },
        usesNamedModifier: true,
    };
}

function installRollSelection(skill, selectionId, record) {
    if (!skill || (typeof skill !== "object" && typeof skill !== "function") || typeof skill.roll !== "function") {
        return null;
    }

    let state = rollSelectionRecords.get(skill);
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
        state.wrappedRoll = function smootherFightTemporaryModifierRoll(options = {}) {
            const activeSelectionId = options?.[ROLL_SELECTION_ID];
            const activeRecord = state.entries.get(activeSelectionId);
            if (!activeRecord) return state.originalRoll.call(this, options);

            const nextOptions = { ...(options ?? {}) };
            delete nextOptions[ROLL_SELECTION_ID];
            const modifierNames = new Set(activeRecord.modifiers.map(({ name }) => normalizedName(name)));
            const originalSelection = Array.isArray(options?.preSelectedModifier)
                ? options.preSelectedModifier
                : [];
            const selected = originalSelection.filter((name) => !modifierNames.has(normalizedName(name)));
            const installedNames = [];
            const modifierCleanups = [];
            let numericFallback = 0;

            for (const modifier of activeRecord.modifiers) {
                const cleanupModifier = installTemporarySelectableModifier({
                    skill,
                    modifierManager: activeRecord.modifierManager,
                    groupId: activeRecord.groupId,
                    recordId: modifier.recordId,
                    name: modifier.name,
                    amount: modifier.amount,
                });
                if (cleanupModifier) {
                    modifierCleanups.push(cleanupModifier);
                    installedNames.push(modifier.name);
                } else {
                    numericFallback += modifier.amount;
                }
            }

            nextOptions.preSelectedModifier = uniqueModifierNames([...selected, ...installedNames]);
            if (numericFallback !== 0) {
                const existingModifier = Number(nextOptions.modifier);
                nextOptions.modifier = (Number.isFinite(existingModifier) ? existingModifier : 0) + numericFallback;
            }
            try {
                return state.originalRoll.call(this, nextOptions);
            } finally {
                for (const cleanup of modifierCleanups.reverse()) cleanup();
                releaseRollSelection(skill, state, activeSelectionId);
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
        rollSelectionRecords.set(skill, state);
    }

    state.entries.set(selectionId, record);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        releaseRollSelection(skill, state, selectionId);
    };
}

function releaseRollSelection(skill, state, selectionId) {
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
    rollSelectionRecords.delete(skill);
}

function numericPreparedRoll(rollOptions, modifiers) {
    const existingModifier = Number(rollOptions?.modifier);
    const amount = modifiers.reduce((total, modifier) => total + modifier.amount, 0);
    return {
        cleanup: () => {},
        modifiers,
        rollOptions: {
            ...(rollOptions ?? {}),
            modifier: (Number.isFinite(existingModifier) ? existingModifier : 0) + amount,
        },
        usesNamedModifier: false,
    };
}

function emptyPreparedRoll(rollOptions) {
    return {
        cleanup: () => {},
        modifiers: [],
        rollOptions,
        usesNamedModifier: false,
    };
}

function normalizeModifiers(modifiers) {
    return Array.from(modifiers ?? []).map((modifier, index) => ({
        ...modifier,
        amount: Number(modifier?.amount),
        name: String(modifier?.name ?? "").trim(),
        recordId: String(modifier?.recordId ?? `temporary-roll-modifier:${index}`).trim(),
    })).filter((modifier) => (
        modifier.name
        && modifier.recordId
        && Number.isFinite(modifier.amount)
        && modifier.amount !== 0
    ));
}

function uniqueModifierNames(names) {
    const seen = new Set();
    return names.filter((name) => {
        const normalized = String(name ?? "").trim();
        const key = normalizedName(normalized);
        if (!normalized || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function normalizedName(value) {
    return String(value ?? "").trim().toLocaleLowerCase();
}

function temporarySelectionId() {
    return globalThis.foundry?.utils?.randomID?.()
        ?? globalThis.crypto?.randomUUID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
