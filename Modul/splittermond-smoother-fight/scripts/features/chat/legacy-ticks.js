import {
    tickAdvanceConfirmed,
} from "../../combat-rules.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    services,
} from "../../core/services.js";

import {
    APPLICATION_STALE_AFTER_MS,
    applicationStateTitle,
    effectiveApplicationState,
    nextApplicationRecord,
} from "../../shared/application-state.js";

import {
    escapeHtml,
    t,
} from "../../shared/values.js";

const staleLegacyTickTimers = new Map();

export function getLegacyTickApplicationState(message, now = Date.now()) {
    const record = message?.getFlag?.(MODULE_ID, "legacyTickAdvance")
        ?? message?.flags?.[MODULE_ID]?.legacyTickAdvance;
    return effectiveApplicationState(record, {
        legacyCompleted: Boolean(message?.getFlag?.(MODULE_ID, "legacyTickAdvanceApplied")
            ?? message?.flags?.[MODULE_ID]?.legacyTickAdvanceApplied),
        legacyStarted: Boolean(message?.getFlag?.(MODULE_ID, "legacyTickAdvanceStarted")
            ?? message?.flags?.[MODULE_ID]?.legacyTickAdvanceStarted),
        now,
    });
}

export async function advanceLegacyChatTicks(message, button) {
    if (services.hasPendingLegacyTickMessage(message.id) || getLegacyTickApplicationState(message) !== "idle") return;
    const actor = services.resolveSpeakerActor(message);
    const ticks = Number(button.dataset.ticks);
    const mayAdvance = Boolean(game.user.isGM || actor?.testUserPermission?.(game.user, "OWNER") || actor?.isOwner);
    if (!actor || !Number.isFinite(ticks) || ticks < 1 || !mayAdvance) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.NoOwner"));
        return;
    }

    const combatant = resolveMessageSpeakerCombatant(message, actor);
    const previousInitiative = Number(combatant?.initiative);
    services.addPendingLegacyTickMessage(message.id);
    let applying = null;
    try {
        applying = await setLegacyTickApplicationState(message, "applying", {
            actorUuid: actor.uuid ?? null,
            ticks,
            previousInitiative: Number.isFinite(previousInitiative) ? previousInitiative : null,
        });
        try {
            await actor.addTicks(ticks, button.dataset.message || undefined);
        } catch (error) {
            const currentInitiative = currentCombatantInitiative(combatant);
            const state = legacyTickFailureState(previousInitiative, currentInitiative);
            await persistLegacyTickFailureState(message, state, applying);
            throw error;
        }

        const currentInitiative = currentCombatantInitiative(combatant);
        const state = tickAdvanceConfirmed(previousInitiative, currentInitiative) ? "completed" : "idle";
        try {
            await setLegacyTickApplicationState(message, state);
        } catch (error) {
            await persistLegacyTickFailureState(message, state === "completed" ? "uncertain" : "idle", applying);
            throw error;
        }
        services.scheduleRender(0);
    } finally {
        services.deletePendingLegacyTickMessage(message.id);
    }
}

export function synchronizeLegacyTickActionState(element, message) {
    element.querySelectorAll(".sf-legacy-tick-recovery-actions").forEach((control) => control.remove());
    const state = getLegacyTickApplicationState(message);
    if (state === "idle") return;
    for (const button of element.querySelectorAll(".add-tick[data-ticks]")) {
        button.disabled = true;
        button.classList.toggle("is-applied", state === "completed");
        button.classList.toggle("is-applying", state === "applying");
        button.classList.toggle("is-uncertain", state === "uncertain");
        button.title = applicationStateTitle(state, operationStateLabels());
    }
    if (state === "applying") scheduleStaleLegacyTickRender(message);
    if (state === "uncertain" && game.user?.isGM) {
        const container = element.querySelector(".sf-promoted-actions, .splittermond-chat-action-container, .sf-promoted-controls");
        container?.insertAdjacentHTML("beforeend", legacyTickRecoveryMarkup());
    }
}

export async function recoverLegacyTickApplication(message, decision) {
    if (!game.user?.isGM || !["retry", "complete"].includes(decision)) return false;
    if (getLegacyTickApplicationState(message) !== "uncertain") return false;
    await setLegacyTickApplicationState(message, decision === "complete" ? "completed" : "idle", {
        recoveredBy: game.user.id,
    });
    ui.notifications.info(t(decision === "complete"
        ? "SMOOTHER_FIGHT.HUD.OperationMarkedCompleted"
        : "SMOOTHER_FIGHT.HUD.OperationReset"));
    services.scheduleRender(0);
    return true;
}

async function setLegacyTickApplicationState(message, state, details = {}) {
    const previous = message.getFlag?.(MODULE_ID, "legacyTickAdvance")
        ?? message.flags?.[MODULE_ID]?.legacyTickAdvance;
    const record = nextApplicationRecord(previous, state, details);
    await services.setRequiredFlag(message, "legacyTickAdvance", record);
    if (state !== "applying") clearStaleLegacyTickRender(message.id);
    return record;
}

async function persistLegacyTickFailureState(message, state, applying) {
    try {
        const current = message.getFlag?.(MODULE_ID, "legacyTickAdvance")
            ?? message.flags?.[MODULE_ID]?.legacyTickAdvance
            ?? applying;
        await services.setRequiredFlag(message, "legacyTickAdvance", nextApplicationRecord(current, state));
    } catch (error) {
        console.error(`${MODULE_ID} | Could not persist ${state} legacy tick state`, error);
    }
}

function resolveMessageSpeakerCombatant(message, actor = services.resolveSpeakerActor(message)) {
    const combat = game.combat;
    if (!combat) return null;
    const context = services.getMessageContext(message);
    const token = services.resolveToken(
        (services.isDefenseMessage(message) ? context?.defenderTokenUuid : context?.attackerTokenUuid)
        ?? services.speakerTokenUuid(message)
    );
    return Array.from(combat.combatants ?? []).find((combatant) =>
        (token?.uuid && services.tokenUuid(services.resolveCombatantToken(combatant)) === token.uuid)
        || (token?.id && combatant.tokenId === token.id)
        || combatant.actorId === actor?.id
        || combatant.actor?.uuid === actor?.uuid
    ) ?? null;
}

function currentCombatantInitiative(combatant) {
    const current = game.combat?.combatants?.get?.(combatant?.id) ?? combatant;
    return Number(current?.initiative);
}

function legacyTickFailureState(previous, current) {
    if (!Number.isFinite(previous) || !Number.isFinite(current)) return "uncertain";
    return tickAdvanceConfirmed(previous, current) ? "uncertain" : "idle";
}

function operationStateLabels() {
    return {
        completed: t("SMOOTHER_FIGHT.HUD.AlreadyApplied"),
        applying: t("SMOOTHER_FIGHT.HUD.OperationApplying"),
        uncertain: t("SMOOTHER_FIGHT.HUD.OperationUncertain"),
    };
}

function legacyTickRecoveryMarkup() {
    return `<div class="sf-operation-recovery-actions sf-legacy-tick-recovery-actions">
        <span><i class="fa-solid fa-triangle-exclamation"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.OperationUncertain"))}</span>
        <button type="button" data-sf-legacy-tick-recovery="retry"><i class="fa-solid fa-rotate-left"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.RetryOperation"))}</button>
        <button type="button" data-sf-legacy-tick-recovery="complete"><i class="fa-solid fa-check"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.MarkOperationCompleted"))}</button>
    </div>`;
}

function scheduleStaleLegacyTickRender(message) {
    const record = message.getFlag?.(MODULE_ID, "legacyTickAdvance")
        ?? message.flags?.[MODULE_ID]?.legacyTickAdvance;
    const startedAt = Number(record?.startedAt);
    if (!Number.isFinite(startedAt)) return;
    const remaining = APPLICATION_STALE_AFTER_MS - (Date.now() - startedAt);
    if (remaining <= 0 || staleLegacyTickTimers.has(message.id)) return;
    const timer = setTimeout(() => {
        staleLegacyTickTimers.delete(message.id);
        services.scheduleRender(0);
    }, remaining);
    timer.unref?.();
    staleLegacyTickTimers.set(message.id, timer);
}

function clearStaleLegacyTickRender(messageId) {
    const timer = staleLegacyTickTimers.get(messageId);
    if (timer) clearTimeout(timer);
    staleLegacyTickTimers.delete(messageId);
}
