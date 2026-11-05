import {
    numberOr,
} from "./shared.js";

export function healthCostTotal(health) {
    return [health?.consumed?.value, health?.exhausted?.value, health?.channeled?.value]
        .reduce((total, value) => total + Math.max(0, numberOr(value)), 0);
}

export function snapshotHealthCosts(health, grants = []) {
    const entries = new Map(Array.from(health?.bonus?.entries ?? [], (entry) => [entry.sourceId, entry.value]));
    return {
        total: healthCostTotal(health),
        bonuses: Array.from(grants ?? [])
            .filter((grant) => grant?.sourceId && numberOr(grant.value) > 0)
            .map((grant) => {
                const granted = numberOr(grant.value);
                return {
                    sourceId: grant.sourceId,
                    granted,
                    remaining: Math.max(0, Math.min(granted, numberOr(entries.get(grant.sourceId), granted))),
                };
            }),
    };
}

export function healthDamageTaken(previous, current) {
    if (!previous || !current) return 0;
    const beforeBySource = new Map(previous.bonuses.map((bonus) => [bonus.sourceId, bonus]));
    const bonusDamage = current.bonuses.reduce((total, bonus) => {
        const before = beforeBySource.get(bonus.sourceId);
        // Changed/expired/new grants are not damage. A first withdrawal creates
        // its ledger entry, so snapshots also include the previously implicit pool.
        if (!before || before.granted !== bonus.granted) return total;
        return total + before.remaining - bonus.remaining;
    }, 0);
    return Math.max(0, current.total - previous.total + bonusDamage);
}

export function healthCostFeedbackKind(previous, current, confirmed = false) {
    const before = numberOr(previous, Number.NaN);
    const after = numberOr(current, Number.NaN);
    if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
    if (after > before) return "damage";
    if (confirmed && after === before) return "damageBlocked";
    return null;
}

export function normalizeAudioFeedbackProfile(profile, defaults = {}, allowedSoundIds = []) {
    const source = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
    const sourceEvents = source.events && typeof source.events === "object" && !Array.isArray(source.events)
        ? source.events
        : {};
    const allowed = new Set(Array.from(allowedSoundIds ?? [], (value) => String(value)));
    const events = {};

    for (const [eventId, fallbackValue] of Object.entries(defaults ?? {})) {
        const fallback = fallbackValue && typeof fallbackValue === "object" ? fallbackValue : {};
        const raw = sourceEvents[eventId] && typeof sourceEvents[eventId] === "object"
            ? sourceEvents[eventId]
            : {};
        const fallbackSound = String(fallback.sound ?? "").trim();
        const requestedSound = String(raw.sound ?? fallbackSound).trim();
        const sound = !allowed.size || allowed.has(requestedSound) ? requestedSound : fallbackSound;
        events[eventId] = {
            enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled !== false,
            sound,
            customSound: String(raw.customSound ?? "").trim(),
        };
    }

    return { version: 1, events };
}

export function fullyConsumedCost(value) {
    const amount = Math.max(0, Math.round(numberOr(value)));
    return amount > 0 ? `${amount}V${amount}` : "0";
}
