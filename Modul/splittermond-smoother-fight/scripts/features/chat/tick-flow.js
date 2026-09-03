import { services } from "../../core/services.js";
import { MODULE_ID } from "../../core/constants.js";
import { preparedSpellReleaseTickCost } from "../../domain/spell-release.js";
import { escapeHtml, t } from "../../shared/values.js";

export function isTickAdvanceControl(control) {
    return Boolean(control?.matches?.(".add-tick[data-ticks]"))
        || String(control?.dataset?.action ?? "").toLocaleLowerCase() === "advancetoken";
}

export function spellReleaseTickCost(message) {
    const context = services.getMessageContext?.(message)
        ?? message?.flags?.[MODULE_ID]?.context
        ?? null;
    return preparedSpellReleaseTickCost(message, context);
}

export function isSyntheticSpellReleaseTickControl(control) {
    return control?.dataset?.sfSpellReleaseTicks === "true";
}

export function ensureSpellReleaseTickControl(element, message) {
    const ticks = spellReleaseTickCost(message);
    if (!element?.querySelectorAll || !ticks) return false;
    const controls = Array.from(element.querySelectorAll(
        ".splittermond-chat-action, .add-tick[data-ticks]"
    ));
    if (controls.some(isTickAdvanceControl)) return false;

    const actions = element.querySelector?.([
        ".splittermond.check.spell .actions.splittermond-chat-action-container",
        ".splittermond.check.spell .sf-promoted-actions",
        ".splittermond.check .actions.splittermond-chat-action-container",
    ].join(", "));
    const document = element.ownerDocument ?? globalThis.document;
    if (!actions?.append || !document?.createElement) return false;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "splittermond-chat-action add-tick sf-spell-release-tick";
    button.dataset.ticks = String(ticks);
    button.dataset.message = t("SMOOTHER_FIGHT.HUD.TickActions.castSpell.Name");
    button.dataset.sfSpellReleaseTicks = "true";
    button.innerHTML = `<i class="fas fa-stopwatch" aria-hidden="true"></i> ${escapeHtml(t("SMOOTHER_FIGHT.HUD.TickActionDuration", { ticks }))}`;
    actions.append(button);
    return true;
}

export function rejectBlockedCombatWorkflowTick(event, button, message) {
    if (!isTickAdvanceControl(button)) return false;
    const pending = services.messageHasPendingTicks?.(message);
    const allowed = services.canAdvanceCombatWorkflowTicks?.(message);
    if (pending !== false && allowed !== false) return false;
    event.preventDefault();
    event.stopImmediatePropagation?.();
    ui.notifications.warn(t(pending === false
        ? "SMOOTHER_FIGHT.HUD.AlreadyApplied"
        : "SMOOTHER_FIGHT.HUD.CombatFlow.TickBlocked"));
    services.scheduleRender?.(0);
    return true;
}

export function synchronizeCombatWorkflowTickActionState(element, message) {
    const pending = services.messageHasPendingTicks?.(message);
    const allowed = services.canAdvanceCombatWorkflowTicks?.(message);
    if (pending !== false && allowed !== false) return;
    const label = t(pending === false
        ? "SMOOTHER_FIGHT.HUD.AlreadyApplied"
        : "SMOOTHER_FIGHT.HUD.CombatFlow.TickBlocked");
    for (const control of element.querySelectorAll(".splittermond-chat-action, .add-tick[data-ticks]")) {
        if (!isTickAdvanceControl(control)) continue;
        control.disabled = true;
        control.setAttribute("aria-disabled", "true");
        control.title = label;
        control.classList.add(pending === false ? "is-applied" : "is-awaiting-defense");
    }
}
