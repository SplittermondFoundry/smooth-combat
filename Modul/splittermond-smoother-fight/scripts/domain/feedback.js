import {
    numberOr,
} from "./shared.js";

export function healthCostTotal(health) {
    return [health?.consumed?.value, health?.exhausted?.value, health?.channeled?.value]
        .reduce((total, value) => total + Math.max(0, numberOr(value)), 0);
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
