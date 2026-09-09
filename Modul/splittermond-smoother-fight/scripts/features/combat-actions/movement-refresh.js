import { getApplicableCombat } from "../../core/combat-compatibility.js";
import { services } from "../../core/services.js";
import { combatActionState } from "./state.js";
import { syncDefaultMovementRoutePreviews } from "./movement.js";
import { refreshMovementTokenControlVisibility } from "./movement-controls.js";
import { refreshMovementRoutePreviewCanvasVisibility } from "./movement-preview.js";

export function scheduleDefaultMovementRoutePreviews(combat = getApplicableCombat()) {
    if (!combat) return;
    combatActionState.movementPreviewCombat = combat;
    if (combatActionState.movementPreviewFrame !== null) return;
    combatActionState.movementPreviewFrame = requestAnimationFrame(() => {
        combatActionState.movementPreviewFrame = null;
        const current = combatActionState.movementPreviewCombat;
        combatActionState.movementPreviewCombat = null;
        syncDefaultMovementRoutePreviews(current);
    });
}

export function clearMovementPreviewRefresh() {
    if (combatActionState.movementPreviewFrame !== null) cancelAnimationFrame(combatActionState.movementPreviewFrame);
    combatActionState.movementPreviewFrame = null;
    combatActionState.movementPreviewCombat = null;
    combatActionState.movementVisibilitySignature = null;
}

export function refreshMovementVisibility() {
    refreshMovementTokenControlVisibility();
    refreshMovementRoutePreviewCanvasVisibility();
    const combat = getApplicableCombat();
    if (!combat) return;
    // Revealing a token can expose a previously undrawn default route. Read only
    // visibility here; reconcile documents once if the membership actually changes.
    const signature = JSON.stringify([combat.id, Array.from(combat.combatants ?? []).map((entry) => {
        const token = entry.token?.document ?? entry.token;
        return [entry.id, token?.uuid, globalThis.game?.user?.isGM
            || services.isTokenPerceivableByUser?.(token, globalThis.game?.user) === true];
    })]);
    if (signature === combatActionState.movementVisibilitySignature) return;
    combatActionState.movementVisibilitySignature = signature;
    scheduleDefaultMovementRoutePreviews(combat);
}
