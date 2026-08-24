export const APPLICATION_STALE_AFTER_MS = 30_000;

const APPLICATION_STATES = new Set(["idle", "applying", "completed", "uncertain"]);

export function effectiveApplicationState(record, {
    legacyCompleted = false,
    legacyStarted = false,
    now = Date.now(),
    staleAfter = APPLICATION_STALE_AFTER_MS,
} = {}) {
    if (record && APPLICATION_STATES.has(record.state)) {
        if (record.state !== "applying") return record.state;
        const startedAt = Number(record.startedAt);
        return Number.isFinite(startedAt) && now - startedAt < staleAfter ? "applying" : "uncertain";
    }
    if (legacyCompleted) return "completed";
    if (legacyStarted) return "uncertain";
    return "idle";
}

export function nextApplicationRecord(previous, state, details = {}, now = Date.now()) {
    if (!APPLICATION_STATES.has(state)) throw new Error(`Unsupported application state: ${state}`);
    const record = previous && typeof previous === "object" ? previous : {};
    return {
        ...record,
        ...details,
        state,
        attemptId: state === "applying" ? createAttemptId(now) : record.attemptId ?? null,
        startedAt: state === "applying" ? now : record.startedAt ?? null,
        updatedAt: now,
    };
}

export function applicationStateTitle(state, labels) {
    if (state === "completed") return labels.completed;
    if (state === "applying") return labels.applying;
    if (state === "uncertain") return labels.uncertain;
    return "";
}

function createAttemptId(now) {
    const random = globalThis.crypto?.randomUUID?.()
        ?? Math.random().toString(36).slice(2);
    return `${now}-${random}`;
}
