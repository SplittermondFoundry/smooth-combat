import { services } from "../../core/services.js";

import { getApplicableCombat } from "../../core/combat-compatibility.js";

import { resolveCombatantByReferences } from "../../domain/combatant-resolution.js";

import {
    enforceOffenseDefensePhaseControls,
    handleRenderedOffenseFollowUp,
    isOffenseFollowUpControl,
    mayControlSpeakerActor,
} from "./actions.js";

import {
    removeOutgoingDamageControls,
    suppressCompletedOffenseControls,
} from "./completed-offense-controls.js";

import {
    ensureSpellReleaseTickControl,
    isTickAdvanceControl,
    synchronizeCombatWorkflowTickActionState,
} from "./tick-flow.js";

import {
    synchronizeLegacyTickActionState,
} from "./legacy-ticks.js";

import {
    hasSplittermondCheckUpdate,
    isOffensiveCombatMessage,
} from "../../combat-rules.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    t,
} from "../../shared/values.js";

import {
    localizeTickActionChatCard,
} from "./tick-action-localization.js";

export async function onCreateChatMessage(message) {
    try {
        if (isOffensiveCombatMessage(message)) await attachCombatContext(message);
        const defenseMessage = services.isDefenseMessage(message);
        if (defenseMessage) await services.claimPendingDefenseForMessage(message);
        await waitForDiceSoNice(message);
        if (services.isFumbleTableMessage(message)) await services.attachFumbleActions(message);
        if (defenseMessage) await services.processDefenseMessage(message);
        services.announceMessageFeedback(message);
    } catch (error) {
        console.error(`${MODULE_ID} | Failed to process chat message`, error);
    }
}

export async function onUpdateChatMessage(message, changes) {
    const checkUpdated = hasSplittermondCheckUpdate(changes);
    const offenseOutcomeUpdated = checkUpdated || hasContentUpdate(changes);
    const maySynchronize = maySynchronizeMessageUpdate(message);
    if (checkUpdated && maySynchronize) {
        try {
            await services.reconcileContinuousActionInterruptionRoll?.(message);
        } catch (error) {
            console.error(`${MODULE_ID} | Failed to restore a continuous action after a check update`, error);
        }
    }
    if (offenseOutcomeUpdated && isOffensiveCombatMessage(message) && maySynchronize) {
        try {
            await services.reopenDefensePhaseAfterOutcomeChange(message);
        } catch (error) {
            console.error(`${MODULE_ID} | Failed to reopen active defense after an updated offense`, error);
        }
    }
    if ((!checkUpdated && !hasDefenseContextUpdate(changes)) || !services.isDefenseMessage(message)) return;
    try {
        await waitForDiceSoNice(message);
        const author = message.author ?? game.users.get(message.user?.id ?? message.user);
        const pending = services.normalizePendingDefense(services.getMessageContext(message));
        const processForAuthor = Boolean(
            game.user.isGM
            && !services.isOwnMessage(message)
            && author
            && pending
            && services.canUserSubmitDefense(author, pending, message)
        );
        await services.processDefenseMessage(
            message,
            processForAuthor ? pending : null,
            {
                allowForeign: processForAuthor,
                queueIfBusy: checkUpdated,
            }
        );
        services.announceMessageFeedback(message);
    } catch (error) {
        console.error(`${MODULE_ID} | Failed to process updated defense message`, error);
    }
}

function hasContentUpdate(changes) {
    return Boolean(changes && typeof changes === "object" && Object.hasOwn(changes, "content"));
}

function maySynchronizeMessageUpdate(message) {
    if (services.isOwnMessage(message)) return true;
    const author = message.author ?? game.users?.get?.(message.user?.id ?? message.user);
    if (author?.active) return false;
    if (!game.user?.isGM) return false;
    const primaryGm = services.getActivePrimaryGm?.();
    return !primaryGm || primaryGm.id === game.user.id;
}

function hasDefenseContextUpdate(changes) {
    if (!changes || typeof changes !== "object") return false;
    const contextPath = `flags.${MODULE_ID}.context`;
    return Object.keys(changes).some((key) => key === contextPath || key.startsWith(`${contextPath}.`))
        || Boolean(changes.flags?.[MODULE_ID]?.context);
}

export async function waitForChatMessage(messageId, attempts = 12) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const message = game.messages.get(messageId);
        if (message) return message;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
}

export async function waitForDefenseProcessing(messageId, attempts = 20) {
    for (let attempt = 0; attempt < attempts && services.isDefenseMessageProcessing(messageId); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

export async function waitForDiceSoNice(message) {
    if (!game.modules?.get?.("dice-so-nice")?.active) return;
    await Promise.resolve();
    if (!isDiceAnimationPending(message)) return;

    await new Promise((resolve) => {
        let timeoutId = null;
        let hookId = null;
        const finish = () => {
            if (timeoutId) clearTimeout(timeoutId);
            if (hookId !== null) Hooks.off("diceSoNiceRollComplete", hookId);
            resolve();
        };
        hookId = Hooks.on("diceSoNiceRollComplete", (messageId) => {
            if (messageId !== message.id) return;
            queueMicrotask(() => {
                if (!isDiceAnimationPending(message)) finish();
            });
        });
        timeoutId = setTimeout(finish, 30000);
        if (!isDiceAnimationPending(message)) finish();
    });
}

export function isDiceAnimationPending(message) {
    return Boolean(message?._dice3danimating || Number(message?._dice3dPendingRenders) > 0);
}

async function attachCombatContext(message) {
    if (services.getMessageContext(message) || !services.isOwnMessage(message)) return;
    const createdAt = Date.now();
    const combat = getApplicableCombat();
    const combatants = Array.from(combat?.combatants ?? []);
    const speakerTokenUuid = services.speakerTokenUuid(message);
    const speakerCombatant = resolveCombatantByReferences(combatants, {
        tokenReferences: [message.speaker?.token, speakerTokenUuid],
        actorReferences: [message.speaker?.actor],
    }, {
        resolveToken: services.resolveCombatantToken,
    });
    const activeCombatant = combat?.combatant ?? combat?.turns?.[0] ?? null;
    const actor = speakerCombatant?.actor ?? (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null);
    const assignmentSubject = speakerCombatant ?? actor;
    const assignedUser = assignmentSubject ? services.getAssignedUser(assignmentSubject) : null;
    const runtimeController = assignmentSubject ? services.getRuntimeController(assignmentSubject) : null;
    const speakerToken = speakerCombatant?.token?.document
        ?? speakerCombatant?.token
        ?? services.resolveCombatantToken?.(speakerCombatant)
        ?? null;
    const author = message.author
        ?? game.users?.get?.(message.user?.id ?? message.user)
        ?? game.user;
    const targetSelection = services.getTargetSelectionForUser(author);
    const pendingKind = services.claimPendingOffenseKind(actor?.id);
    const targetContext = combatTargetContext(
        pendingKind?.expiresAt >= createdAt ? pendingKind : null,
        targetSelection
    );
    const context = {
        combatId: combat?.id ?? null,
        combatantId: speakerCombatant?.id ?? null,
        attackerTokenUuid: speakerTokenUuid ?? speakerToken?.uuid ?? null,
        attackerActorUuid: actor?.uuid ?? null,
        ...targetContext,
        actionKind: pendingKind?.expiresAt >= createdAt ? pendingKind.kind : null,
        outOfTurn: Boolean(activeCombatant && speakerCombatant && activeCombatant.id !== speakerCombatant.id),
        assignedUserId: assignedUser?.id ?? null,
        runtimeControllerId: runtimeController?.id ?? null,
        attackerInitiativeAtCreation: Number.isFinite(Number(speakerCombatant?.initiative))
            ? Number(speakerCombatant.initiative)
            : null,
        initialCheckSucceeded: message.system?.checkReport?.succeeded === true,
        defensePhase: services.initialDefensePhaseForOffense(message),
        createdAt,
    };
    await services.setRequiredFlag(message, "context", context);
}

function combatTargetContext(pendingKind, selection) {
    if (pendingKind && Object.hasOwn(pendingKind, "primaryTargetTokenUuid")) {
        const primaryTargetTokenUuid = pendingKind.primaryTargetTokenUuid ?? null;
        const primaryTargetActorUuid = pendingKind.primaryTargetActorUuid ?? null;
        const primaryTargetName = pendingKind.primaryTargetName ?? pendingKind.targetName ?? null;
        return {
            primaryTargetTokenUuid,
            primaryTargetActorUuid,
            primaryTargetName,
            targetTokenUuid: primaryTargetTokenUuid,
            targetActorUuid: primaryTargetActorUuid,
            targetName: primaryTargetName,
            targetTokenUuids: Array.from(pendingKind.targetTokenUuids ?? []),
            targetActorUuids: Array.from(pendingKind.targetActorUuids ?? []),
            targetNames: Array.from(pendingKind.targetNames ?? []),
        };
    }
    const targets = Array.from(selection?.targets ?? []);
    const primaryTarget = selection?.target ?? null;
    const primaryTargetTokenUuid = selection?.primaryTargetTokenUuid ?? primaryTarget?.uuid ?? null;
    const primaryTargetActorUuid = selection?.primaryTargetActorUuid ?? primaryTarget?.actor?.uuid ?? null;
    const primaryTargetName = primaryTarget?.name ?? primaryTarget?.actor?.name ?? null;
    return {
        primaryTargetTokenUuid,
        primaryTargetActorUuid,
        primaryTargetName,
        targetTokenUuid: primaryTargetTokenUuid,
        targetActorUuid: primaryTargetActorUuid,
        targetName: primaryTargetName,
        targetTokenUuids: targets.map((candidate) => candidate.uuid).filter(Boolean),
        targetActorUuids: targets.map((candidate) => candidate.actor?.uuid).filter(Boolean),
        targetNames: targets.map((candidate) => candidate.name ?? candidate.actor?.name).filter(Boolean),
    };
}

function captureSystemActiveDefense(message, html) {
    if (!html || !isOffensiveCombatMessage(message)) return;
    for (const button of html.querySelectorAll('[data-localaction="activeDefense" i], [data-local-action="activeDefense" i]')) {
        if (button.dataset.smootherFightCaptured) continue;
        button.dataset.smootherFightCaptured = "true";
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            void services.beginActiveDefense(message).catch((error) => {
                console.error(`${MODULE_ID} | Active defense failed`, error);
                ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
            });
        }, { capture: true });
    }
    for (const button of html.querySelectorAll('.sf-chat-decline-defense[data-sf-action="decline-active-defense"]')) {
        if (button.dataset.smootherFightCaptured) continue;
        button.dataset.smootherFightCaptured = "true";
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            button.disabled = true;
            void services.requestActiveDefenseDecline(message, button.dataset.defenderTokenUuid ?? null).then((requested) => {
                if (!requested && button.isConnected) button.disabled = false;
            }).catch((error) => {
                console.error(`${MODULE_ID} | Declining active defense failed`, error);
                ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
                if (button.isConnected) button.disabled = false;
            });
        }, { capture: true });
    }
}

function captureSystemOffenseFollowUps(message, html) {
    if (!html || !isOffensiveCombatMessage(message)) return;
    for (const button of html.querySelectorAll(".splittermond-chat-action, .add-tick[data-ticks]")) {
        if (!isOffenseFollowUpControl(button)
            || button.disabled
            || button.dataset.smootherFightTickFlowCaptured
            || button.dataset.smootherFightFollowUpCaptured) continue;
        button.dataset.smootherFightFollowUpCaptured = "true";
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            const operation = handleRenderedOffenseFollowUp(event, button, message);
            button.disabled = true;
            void operation.catch((error) => {
                console.error(`${MODULE_ID} | Offense follow-up failed`, error);
                ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
            }).finally(() => {
                if (button.isConnected) button.disabled = false;
            });
        }, { capture: true });
    }
}

function captureSystemTickFlowControls(message, html) {
    if (!html) return;
    for (const button of html.querySelectorAll(".splittermond-chat-action, .add-tick[data-ticks]")) {
        if (!isTickAdvanceControl(button) || button.disabled || button.dataset.smootherFightTickFlowCaptured) continue;
        button.dataset.smootherFightTickFlowCaptured = "true";
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            const operation = handleRenderedOffenseFollowUp(event, button, message);
            button.disabled = true;
            void operation.catch((error) => {
                console.error(`${MODULE_ID} | Tick action failed`, error);
                ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
            }).finally(() => {
                resynchronizeCapturedTickControl(button, message);
            });
        }, { capture: true });
    }
}

export function resynchronizeCapturedTickControl(button, message) {
    if (!button?.isConnected) return false;
    button.disabled = false;
    const elements = new Set();
    const localElement = button.closest?.("[data-message-id], .message-content, .sf-chat-message, .chat-message")
        ?? button.parentElement;
    if (localElement) elements.add(localElement);
    const messageId = String(message?.id ?? "");
    if (messageId) {
        for (const element of globalThis.document?.querySelectorAll?.("[data-message-id]") ?? []) {
            if (element.dataset?.messageId === messageId) elements.add(element);
        }
    }
    for (const element of elements) {
        synchronizeLegacyTickActionState(element, message);
        synchronizeCombatWorkflowTickActionState(element, message);
    }
    return true;
}

export function prepareRenderedChatMessage(message, html) {
    if (!html) return;
    localizeTickActionChatCard(message, html);
    ensureSpellReleaseTickControl(html, message);
    if (services.isFumbleTableMessage(message) && !services.getFumbleData(message)) void services.attachFumbleActions(message, html);
    if (!mayControlSpeakerActor(message)) {
        removeOutgoingDamageControls(html);
        html.querySelectorAll(".splittermond-chat-action-container:not(:has(.splittermond-chat-action))").forEach((container) => container.remove());
    }
    suppressCompletedOffenseControls(html, message);
    enforceOffenseDefensePhaseControls(html, message);
    synchronizeLegacyTickActionState(html, message);
    synchronizeCombatWorkflowTickActionState(html, message);
    captureSystemActiveDefense(message, html);
    captureSystemTickFlowControls(message, html);
    captureSystemOffenseFollowUps(message, html);
    services.bindContinuousActionInterruptionCard?.(message, html);
    services.bindFumbleActions(message, html);
}

export function prepareExistingRenderedChatMessages(root = globalThis.document) {
    if (!root?.querySelectorAll) return;
    for (const html of root.querySelectorAll('.message[data-message-id]')) {
        if (html.closest?.(`#${MODULE_ID}-hud`)) continue;
        const message = game.messages?.get?.(html.dataset?.messageId);
        if (message) prepareRenderedChatMessage(message, html);
    }
}
