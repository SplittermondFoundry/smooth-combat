import { services } from "../../core/services.js";
import {
    isOffensiveCombatMessage,
    mayRollCombatFumble,
} from "../../combat-rules.js";
import {
    MODULE_ID,
    SYSTEM_SOCKET,
} from "../../core/constants.js";
import {
    localizeSystem,
    t,
} from "../../shared/values.js";
import {
    applyOwnedSelfDamage,
    applyDamageToLinkedTarget,
    applyDefenseNumbingDamage,
    isDamageApplicationAction,
    isDamageApplicationBlocked,
    recoverDamageApplication,
    requestRemoteDamageApplication,
    validateLinkedDamageTarget,
    withTrackedDamageApplication,
} from "./damage-application.js";
import {
    recoverLegacyTickApplication,
    requestLegacyChatTickAdvance,
} from "./legacy-ticks.js";
import { handleLegacySplinterpointAction } from "./legacy-splinterpoint.js";
import { rejectBlockedCombatWorkflowTick } from "./tick-flow.js";
import { messageOffersFollowUpControl } from "./follow-up-controls.js";
import {
    hasAssociatedDamageMessage,
    isDegreeOptionControl,
    isOutgoingDamageControl,
} from "./completed-offense-controls.js";
import { isCombatFumbleRollControl } from "./fumble-flow.js";
import {
    isMessageSpeakerAssignedToCurrentUser,
    isOffenseFollowUpControl,
    isRollManagementControl,
    mayControlSpeakerActor,
    mayManageMessageRoll,
} from "./rendered-controls.js";
import {
    clearPendingDamageRoll,
    markDamageRollPending,
} from "./pending-damage-roll.js";

export async function handleChatCardAction(event, button) {
    const messageElement = button.closest(".sf-chat-message");
    const message = game.messages.get(messageElement?.dataset.messageId);
    return handleChatMessageAction(event, button, message);
}

export async function handleRenderedOffenseFollowUp(event, button, message) {
    return handleChatMessageAction(event, button, message);
}

async function handleChatMessageAction(event, button, message) {
    if (!message || button.disabled) return;
    if (rejectBlockedCombatWorkflowTick(event, button, message)) return;
    if (isOffensiveCombatMessage(message)
        && hasAssociatedDamageMessage(button, message)
        && (isOutgoingDamageControl(button) || isDegreeOptionControl(button))) {
        event.preventDefault();
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.FollowUpNoLongerAvailable"));
        services.scheduleRender?.(0);
        return;
    }
    const fumbleRecovery = button.dataset.sfFumbleRecovery;
    if (fumbleRecovery) {
        event.preventDefault();
        await services.recoverFumbleAction(message, button.dataset.sfFumbleKind, fumbleRecovery);
        return;
    }
    const legacyTickRecovery = button.dataset.sfLegacyTickRecovery;
    if (legacyTickRecovery) {
        event.preventDefault();
        await recoverLegacyTickApplication(message, legacyTickRecovery);
        return;
    }
    const damageRecovery = button.dataset.sfDamageRecovery;
    if (damageRecovery) {
        event.preventDefault();
        await recoverDamageApplication(message, damageRecovery, button.dataset.sfDamageKind);
        return;
    }
    const defenseNumbingDamage = Number.parseInt(button.dataset.sfDefenseNumbingDamage ?? "", 10);
    if (Number.isFinite(defenseNumbingDamage) && defenseNumbingDamage > 0) {
        event.preventDefault();
        try {
            await applyDefenseNumbingDamage(message, defenseNumbingDamage);
        } catch (error) {
            console.error(`${MODULE_ID} | Defense stun damage failed`, error);
            ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
        }
        return;
    }
    const fumbleAction = button.dataset.sfFumbleAction;
    if (fumbleAction) {
        event.preventDefault();
        await services.handleFumbleAction(message, fumbleAction);
        return;
    }
    if (isCombatFumbleRollControl(button)) {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        try {
            await rollCombatFumble(message);
        } catch (error) {
            console.error(`${MODULE_ID} | Combat fumble roll failed`, error);
            ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
        } finally {
            if (button.isConnected) button.disabled = false;
        }
        return;
    }
    if (isLegacyTickAction(button)) {
        event.preventDefault();
        if (!mayManageMessageRoll(message)) {
            ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.NoOwner"));
            return;
        }
        if (isOffensiveCombatMessage(message)) {
            message = await beginOffenseFollowUpForControl(message, button);
            if (!message) return;
        }
        try {
            await requestLegacyChatTickAdvance(message, button);
        } catch (error) {
            console.error(`${MODULE_ID} | Failed to advance legacy chat ticks`, error);
            ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
        }
        return;
    }
    if (isLegacySplinterpointAction(button)) {
        await handleLegacySplinterpointAction(event, button, message, mayManageMessageRoll(message));
        return;
    }
    const localAction = button.dataset.localaction ?? button.dataset.localAction;
    const remoteAction = button.dataset.action;
    if (!localAction && !remoteAction) return;
    event.preventDefault();
    if (isRollManagementControl(button) && !mayManageMessageRoll(message)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.NoOwner"));
        return;
    }
    if (isOutgoingDamageControl(button) && !mayControlSpeakerActor(message)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DamageOwnerOnly"));
        return;
    }

    if (isOffensiveCombatMessage(message) && isOffenseFollowUpControl(button)) {
        message = await beginOffenseFollowUpForControl(message, button);
        if (!message) return;
    }

    const startsDamageRoll = isOutgoingDamageControl(button);
    if (startsDamageRoll) markDamageRollPending(message.id);

    try {
        if (String(localAction).toLocaleLowerCase() === "activedefense") {
            await services.beginActiveDefense(message);
            return;
        }

        const action = localAction || remoteAction;
        const actionData = { ...button.dataset, action };
        if (!game.user.isGM && localAction && String(action).toLocaleLowerCase() === "applydamagetoself") {
            const target = validateLinkedDamageTarget(message, game.user, true);
            if (!target) return;
            await applyOwnedSelfDamage(message, actionData, target);
            services.scheduleRender(); return;
        }
        if (localAction && String(action).toLocaleLowerCase() === "applydamagetousertargets") {
            const target = validateLinkedDamageTarget(message, game.user, true);
            if (!target) return;
            if (!game.user.isGM) {
                if (isDamageApplicationBlocked(message)) return;
                requestRemoteDamageApplication(message, actionData);
                services.scheduleRender();
                return;
            }
            await withTrackedDamageApplication(message, () => applyDamageToLinkedTarget(message, actionData, target));
            services.scheduleRender();
            return;
        }
        if (!game.user.isGM && localAction && isDamageApplicationAction(action)) {
            if (isDamageApplicationBlocked(message)) return;
            requestRemoteDamageApplication(message, actionData);
            services.scheduleRender();
            return;
        }
        if (localAction) {
            await withTrackedDamageApplication(message, () => message.system.handleGenericAction(actionData), action);
        } else if (!game.user.isGM) {
            const activeGm = Array.from(game.users ?? []).some((user) => user.isGM && user.active);
            if (!activeGm) {
                if (startsDamageRoll) clearPendingDamageRoll(message.id);
                ui.notifications.warn(localizeSystem("splittermond.chatCard.noGMConnected", "Kein GM verbunden."));
                return;
            }
            if (isDamageApplicationAction(action)) {
                if (isDamageApplicationBlocked(message)) return;
                requestRemoteDamageApplication(message, actionData);
                services.scheduleRender();
                return;
            }
            game.socket.emit(SYSTEM_SOCKET, {
                type: "chatAction",
                ...actionData,
                messageId: message.id,
                userId: game.user.id,
            });
        } else {
            await withTrackedDamageApplication(
                message,
                () => message.system.handleGenericAction(actionData),
                action
            );
            const content = await renderTemplate(message.system.template, message.system.getData());
            await message.update({ content });
        }
        services.scheduleRender();
    } catch (error) {
        if (startsDamageRoll) clearPendingDamageRoll(message.id);
        console.error(`${MODULE_ID} | Chat card action failed`, error);
        ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
    }
}

async function rollCombatFumble(message) {
    const actor = services.resolveSpeakerActor(message);
    const allowed = mayRollCombatFumble(
        game.user?.isGM,
        isMessageSpeakerAssignedToCurrentUser(message)
    );
    if (!actor || !allowed) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.FumbleNotAllowed"));
        return;
    }
    const sourceMessageId = services.getMessageContext(message)?.attackMessageId
        ?? (isOffensiveCombatMessage(message) ? message.id : null);
    const sourceItemId = services.resolveFumbleSourceItemId(message);
    const created = await actor.rollAttackFumble();
    if (created) await services.attachFumbleActions(created, null, sourceMessageId, sourceItemId);
    services.setCombatEventExpansionRequest("latest");
    services.scheduleRender(0);
}

function isLegacyTickAction(control) {
    return Boolean(control?.matches?.(".add-tick[data-ticks]"));
}

async function beginOffenseFollowUpForControl(message, control) {
    const latest = await services.requestOffenseFollowUp(message);
    if (!latest || messageOffersFollowUpControl(latest, control)) return latest;
    ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.FollowUpNoLongerAvailable"));
    return null;
}

function isLegacySplinterpointAction(control) {
    return Boolean(control?.matches?.(".use-splinterpoint"));
}
