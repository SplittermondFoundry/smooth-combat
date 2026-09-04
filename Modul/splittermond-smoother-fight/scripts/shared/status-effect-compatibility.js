/** Encode a status timer for the installed Splittermond Item data model. */
export function statusEffectTimingData(combatEvent) {
    if (!usesLegacyStatusTiming()) return { combatEvent: { ...combatEvent } };

    const data = {};
    for (const [modernKey, legacyKey] of [
        ["startTick", "startTick"],
        ["interval", "interval"],
        ["repeats", "times"],
    ]) {
        if (Object.hasOwn(combatEvent, modernKey)) data[legacyKey] = combatEvent[modernKey] ?? 0;
    }
    return data;
}

/** Flat document updates preserve unrelated timer fields and Item data. */
export function statusEffectTimingUpdate(combatEvent) {
    const data = statusEffectTimingData(combatEvent);
    const prefix = data.combatEvent ? "system.combatEvent." : "system.";
    return Object.fromEntries(Object.entries(data.combatEvent ?? data).map(([key, value]) => [
        `${prefix}${key}`, value,
    ]));
}

function usesLegacyStatusTiming() {
    // Early 14.3 prereleases still used the 14.2 schema. Prefer the live model
    // over the version and do not cache a result from before system init.
    const fields = globalThis.CONFIG?.Item?.dataModels?.statuseffect?.schema?.fields;
    if (fields && Object.hasOwn(fields, "combatEvent")) return false;
    if (fields && ["startTick", "interval", "times"].every((key) => Object.hasOwn(fields, key))) return true;
    return /^14\.2\.\d+(?:[-+].*)?$/u.test(String(globalThis.game?.system?.version ?? ""));
}
