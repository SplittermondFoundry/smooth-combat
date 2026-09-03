import { services } from "../../core/services.js";

export function markDamageRollPending(messageId) {
    if (!messageId) return;
    const existing = services.getPendingDamageRollTimer(messageId);
    if (existing) clearTimeout(existing);
    const timeoutId = setTimeout(() => {
        services.deletePendingDamageRollTimer(messageId);
        services.scheduleRender(0);
    }, 60_000);
    services.setPendingDamageRollTimer(messageId, timeoutId);
    services.scheduleRender(0);
}

export function clearPendingDamageRoll(messageId) {
    const timeoutId = services.getPendingDamageRollTimer(messageId);
    if (timeoutId) clearTimeout(timeoutId);
    services.deletePendingDamageRollTimer(messageId);
}
