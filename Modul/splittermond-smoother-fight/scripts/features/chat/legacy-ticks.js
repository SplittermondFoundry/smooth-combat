import {
    tickAdvanceConfirmed,
} from "../../combat-rules.js";

import {
    MODULE_ID,
    SOCKET,
} from "../../core/constants.js";

import { getApplicableCombat } from "../../core/combat-compatibility.js";

import { resolveCombatantByReferences } from "../../domain/combatant-resolution.js";

import {
    services,
} from "../../core/services.js";

import {
    spellReleaseTickCost,
} from "./tick-flow.js";

import {
    APPLICATION_STALE_AFTER_MS,
    applicationStateTitle,
    effectiveApplicationState,
    nextApplicationRecord,
} from "../../shared/application-state.js";

import {
    escapeHtml,
    localizeSystem,
    t,
} from "../../shared/values.js";

const staleLegacyTickTimers = new Map();
const remoteLegacyTickRequests = new Map();
const legacyTickPromptMessages = new Set();
const REMOTE_LEGACY_TICK_TIMEOUT_MS = 15_000;

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

export async function requestLegacyChatTickAdvance(message, button) {
    const user = globalThis.game?.user;
    const offeredTicks = positiveTickCount(button?.dataset?.ticks);
    if (!message || !offeredTicks || !canUserAdvanceLegacyChatTicks(message, user)) {
        globalThis.ui?.notifications?.warn?.(t("SMOOTHER_FIGHT.HUD.NoOwner"));
        return false;
    }
    if (services.hasPendingLegacyTickMessage(message.id)
        || legacyTickPromptMessages.has(message.id)
        || getLegacyTickApplicationState(message) !== "idle") return false;

    legacyTickPromptMessages.add(message.id);
    let ticks;
    try {
        ticks = await chooseLegacyTickCount(offeredTicks, button?.dataset?.message);
    } finally {
        legacyTickPromptMessages.delete(message.id);
    }
    if (!ticks
        || services.hasPendingLegacyTickMessage(message.id)
        || getLegacyTickApplicationState(message) !== "idle") return false;
    const selectedButton = {
        dataset: {
            message: button?.dataset?.message,
            ticks: String(ticks),
        },
    };
    if (user.isGM) return advanceLegacyChatTicks(message, selectedButton, user);

    const gm = services.getActivePrimaryGm?.();
    if (!gm) {
        globalThis.ui?.notifications?.warn?.(localizeSystem("splittermond.chatCard.noGMConnected", "Kein GM verbunden."));
        return false;
    }

    const requestId = globalThis.foundry?.utils?.randomID?.() ?? `${user.id}:${message.id}:${Date.now()}`;
    services.addPendingLegacyTickMessage(message.id);
    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            remoteLegacyTickRequests.delete(requestId);
            services.deletePendingLegacyTickMessage(message.id);
            globalThis.ui?.notifications?.error?.(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
            services.scheduleRender?.(0);
            resolve(false);
        }, REMOTE_LEGACY_TICK_TIMEOUT_MS);
        timeoutId?.unref?.();
        remoteLegacyTickRequests.set(requestId, {
            gmId: gm.id,
            messageId: message.id,
            resolve,
            timeoutId,
        });
        globalThis.game?.socket?.emit?.(SOCKET, {
            type: "legacy-tick-advance-request",
            senderId: user.id,
            recipientId: gm.id,
            requestId,
            messageId: message.id,
            offeredTicks,
            ticks,
        });
    });
}

export async function applyRemoteLegacyTickAdvance(message, actionData, user) {
    const offered = offeredLegacyTickControl(message, actionData?.offeredTicks ?? actionData?.ticks);
    const ticks = positiveTickCount(actionData?.ticks);
    if (!offered || !ticks || !canUserAdvanceLegacyChatTicks(message, user)) {
        return { applied: false, error: "not-allowed" };
    }
    try {
        const applied = await advanceLegacyChatTicks(message, {
            dataset: {
                ...offered,
                ticks: String(ticks),
            },
        }, user);
        return { applied: Boolean(applied), error: applied ? null : "not-applied" };
    } catch (error) {
        console.error(`${MODULE_ID} | Remote legacy tick advance failed`, error);
        return { applied: false, error: "failed" };
    }
}

export function finishRemoteLegacyTickAdvance(payload, sender) {
    const request = remoteLegacyTickRequests.get(payload?.requestId);
    if (!request
        || sender?.id !== request.gmId
        || payload?.messageId !== request.messageId) return false;
    clearTimeout(request.timeoutId);
    remoteLegacyTickRequests.delete(payload.requestId);
    services.deletePendingLegacyTickMessage(request.messageId);
    if (payload.error) globalThis.ui?.notifications?.error?.(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
    services.scheduleRender?.(0);
    request.resolve(Boolean(payload.applied));
    return true;
}

export function canUserAdvanceLegacyChatTicks(message, user) {
    const actor = services.resolveSpeakerActor(message);
    if (!actor || !user) return false;
    if (user.isGM) return true;
    const ownsActor = typeof actor.testUserPermission === "function"
        ? actor.testUserPermission(user, "OWNER")
        : Boolean(user.id === globalThis.game?.user?.id && actor.isOwner);
    if (ownsActor) return true;
    const context = services.getMessageContext?.(message);
    if (context?.assignedUserId === user.id) return true;
    const combatant = resolveMessageSpeakerCombatant(message, actor);
    return services.getAssignedUser?.(combatant ?? actor)?.id === user.id;
}

export async function advanceLegacyChatTicks(message, button, user = globalThis.game?.user) {
    if (services.hasPendingLegacyTickMessage(message.id) || getLegacyTickApplicationState(message) !== "idle") return;
    const actor = services.resolveSpeakerActor(message);
    const ticks = positiveTickCount(button.dataset.ticks);
    if (!actor || !ticks || !canUserAdvanceLegacyChatTicks(message, user)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.NoOwner"));
        return false;
    }

    const combatant = resolveMessageSpeakerCombatant(message, actor);
    if (!combatant) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.AmbiguousCombatant"));
        return false;
    }
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
            await actor.addTicks(ticks, button.dataset.message || undefined, false);
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
        return true;
    } finally {
        services.deletePendingLegacyTickMessage(message.id);
    }
}

async function chooseLegacyTickCount(defaultTicks, message) {
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (!DialogV2?.wait) {
        globalThis.ui?.notifications?.error?.(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
        return null;
    }
    const result = await DialogV2.wait({
        classes: ["splittermond", "tick-addition-dialog"],
        window: {
            title: localizeSystem("splittermond.applications.addTickDialogue.title", "Ticks hinzufügen"),
        },
        content: `<p>${escapeHtml(message ?? "")}</p>
            <div>
                <input name="timeInput" type="number" class="ticks" min="1" step="1" value="${defaultTicks}">
                <label for="timeInput">T</label>
            </div>`,
        buttons: [{
            action: "confirm",
            label: localizeSystem("splittermond.applications.addTickDialogue.okLabel", "OK"),
            icon: "fa-solid fa-check",
            callback: (_event, button) => Number(button.form?.elements?.timeInput?.valueAsNumber),
            default: true,
        }],
        close: () => null,
        modal: true,
    });
    return positiveTickCount(result);
}

function positiveTickCount(value) {
    const ticks = Number(value);
    if (!Number.isFinite(ticks) || ticks < 1) return null;
    return Math.round(ticks);
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
    const combat = getApplicableCombat();
    if (!combat) return null;
    const context = services.getMessageContext(message);
    const defenseMessage = services.isDefenseMessage(message);
    const contextTokenReference = defenseMessage
        ? context?.defenderTokenUuid
        : context?.attackerTokenUuid;
    return resolveCombatantByReferences(combat.combatants, {
        combatantId: defenseMessage ? null : context?.combatantId,
        tokenReferences: [contextTokenReference, services.speakerTokenUuid(message), message.speaker?.token],
        actorReferences: [actor?.uuid, actor?.id, message.speaker?.actor],
    }, {
        resolveToken: services.resolveCombatantToken,
    });
}

function currentCombatantInitiative(combatant) {
    const current = getApplicableCombat()?.combatants?.get?.(combatant?.id) ?? combatant;
    return Number(current?.initiative);
}

function legacyTickFailureState(previous, current) {
    if (!Number.isFinite(previous) || !Number.isFinite(current)) return "uncertain";
    return tickAdvanceConfirmed(previous, current) ? "uncertain" : "idle";
}

function offeredLegacyTickControl(message, requestedTicks) {
    const ticks = Number(requestedTicks);
    if (!Number.isFinite(ticks) || ticks < 1) return null;
    const tags = String(message?.content ?? "").match(/<(?:button|a)\b[^>]*>/giu) ?? [];
    for (const tag of tags) {
        const classes = htmlAttribute(tag, "class").split(/\s+/u);
        if (!classes.includes("add-tick")) continue;
        if (Number(htmlAttribute(tag, "data-ticks")) !== ticks) continue;
        return {
            ticks: String(ticks),
            message: htmlAttribute(tag, "data-message") || undefined,
        };
    }
    if (spellReleaseTickCost(message) === ticks) {
        return {
            ticks: String(ticks),
            message: t("SMOOTHER_FIGHT.HUD.TickActions.castSpell.Name"),
        };
    }
    return null;
}

function htmlAttribute(tag, name) {
    const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "iu"));
    return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
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
