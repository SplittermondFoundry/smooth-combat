const TEMPORARY_MODIFIER_MARKER = "smootherFightTemporaryModifierId";
const temporarySelectableModifierRecords = new WeakMap();

export function installTemporarySelectableModifier({
    skill,
    modifierManager = null,
    groupId,
    recordId,
    name,
    amount,
}) {
    const normalizedGroupId = String(groupId ?? "").trim();
    const normalizedRecordId = String(recordId ?? "").trim();
    const normalizedName = String(name ?? "").trim();
    const numericAmount = Number(amount);
    let manager = modifierManager;
    try {
        manager ??= skill?.actor?.modifier;
    } catch (_error) {
        return null;
    }
    const modifierMap = manager?._modifier;
    if (!skill
        || !normalizedGroupId
        || !normalizedRecordId
        || !normalizedName
        || !Number.isFinite(numericAmount)
        || typeof manager?.add !== "function"
        || !(modifierMap instanceof Map)) {
        return null;
    }

    const groupKey = normalizedGroupId.toLowerCase();
    const recordKey = `${normalizedRecordId}:${groupKey}`;
    const records = temporarySelectableModifierRecords.get(manager) ?? new Map();
    const existingRecord = records.get(recordKey);
    if (existingRecord && modifierMap.get(groupKey)?.includes(existingRecord.modifier)) {
        existingRecord.references += 1;
        return temporaryModifierCleanup(manager, records, recordKey, existingRecord);
    }
    records.delete(recordKey);

    const templateValue = findExpressionTemplate(skill, modifierMap);
    const expressionPrototype = templateValue ? Object.getPrototypeOf(templateValue) : null;
    if (!expressionPrototype) return null;

    const value = Object.create(expressionPrototype);
    Object.defineProperty(value, "amount", {
        configurable: true,
        enumerable: true,
        value: numericAmount,
    });
    const marker = `${normalizedRecordId}:${temporaryModifierId()}`;
    const attributes = {
        [TEMPORARY_MODIFIER_MARKER]: marker,
        name: normalizedName,
        type: "innate",
    };
    try {
        manager.add(normalizedGroupId, attributes, value, true);
    } catch (_error) {
        return null;
    }

    let added = modifierMap.get(groupKey)?.find((modifier) => (
        modifier?.attributes?.[TEMPORARY_MODIFIER_MARKER] === marker
    ));
    if (added?.selectable === false) {
        removeModifier(modifierMap, groupKey, added);
        try {
            manager.add(normalizedGroupId, attributes, value, null, true);
        } catch (_error) {
            return null;
        }
        added = modifierMap.get(groupKey)?.find((modifier) => (
            modifier?.attributes?.[TEMPORARY_MODIFIER_MARKER] === marker
        ));
    }
    if (added?.selectable === false) {
        removeModifier(modifierMap, groupKey, added);
        return null;
    }
    if (!added) return null;
    const record = { groupKey, modifier: added, references: 1 };
    records.set(recordKey, record);
    temporarySelectableModifierRecords.set(manager, records);
    return temporaryModifierCleanup(manager, records, recordKey, record);
}

function findExpressionTemplate(skill, modifierMap) {
    try {
        const selectableTemplate = Array.from(skill.selectableModifier ?? [])
            .map((modifier) => modifier?.value)
            .find(isAmountExpression);
        if (selectableTemplate) return selectableTemplate;
        for (const modifiers of modifierMap.values()) {
            const managerTemplate = Array.from(modifiers ?? [])
                .map((modifier) => modifier?.value)
                .find(isAmountExpression);
            if (managerTemplate) return managerTemplate;
        }
    } catch (_error) {
        return null;
    }
    return null;
}

function isAmountExpression(value) {
    return Number.isFinite(Number(value?.amount)) && Boolean(Object.getPrototypeOf(value));
}

function temporaryModifierCleanup(manager, records, recordKey, record) {
    let released = false;
    return () => {
        if (released) return;
        released = true;
        record.references -= 1;
        if (record.references > 0) return;
        removeModifier(manager._modifier, record.groupKey, record.modifier);
        records.delete(recordKey);
        if (records.size === 0) temporarySelectableModifierRecords.delete(manager);
    };
}

function removeModifier(modifierMap, groupKey, modifier) {
    const modifiers = modifierMap?.get(groupKey);
    const index = modifiers?.indexOf(modifier) ?? -1;
    if (index >= 0) modifiers.splice(index, 1);
    if (modifiers?.length === 0) modifierMap.delete(groupKey);
}

function temporaryModifierId() {
    return globalThis.foundry?.utils?.randomID?.()
        ?? globalThis.crypto?.randomUUID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
