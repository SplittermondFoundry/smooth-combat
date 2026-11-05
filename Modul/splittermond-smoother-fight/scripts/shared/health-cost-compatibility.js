import { snapshotHealthCosts } from "../domain/feedback.js";

export function snapshotActorHealthCosts(actor) {
    return snapshotHealthCosts(actor?.system?.health, actor?.bonusGrants?.healthpoints);
}

export function applyHealthDamage(actor, amount, description, { consumed = false } = {}) {
    const damage = Math.max(0, Math.round(Number(amount)));
    if (!Number.isFinite(damage)) throw new TypeError("Health damage must be finite");
    if (typeof actor?.applyCost === "function") {
        // The system publishes the native PrimaryCost model in its hook schema.
        // Use that model so the system's validated hook receives a real instance.
        const PrimaryCost = globalThis.game?.splittermond?.API?.hooks?.onApplyCost?.defineSchema?.()?.[2]?.model;
        if (typeof PrimaryCost !== "function") throw new Error("Splittermond PrimaryCost model is unavailable");
        const cost = new PrimaryCost({
            _nonConsumed: consumed ? 0 : damage,
            _consumed: consumed ? damage : 0,
            _isChanneled: false,
        });
        return actor.applyCost("health", cost, description);
    }
    if (typeof actor?.consumeCost !== "function") throw new Error("Splittermond health cost API is unavailable");
    return actor.consumeCost("health", consumed && damage > 0 ? `${damage}V${damage}` : String(damage), description);
}
