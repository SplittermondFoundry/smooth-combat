import { services } from "../../core/services.js";

import {
    combatActionHighlightState,
    isDamageSelectionAction,
    isOffensiveCombatMessage,
    mayRollCombatFumble,
    mayUseRemoteChatActions,
    mayViewActorResources,
    mayViewTargetDifficulty,
    requiresRollManagementPermission,
} from "../../combat-rules.js";

import {
    MODULE_ID,
    SYSTEM_SOCKET,
} from "../../core/constants.js";

import {
    escapeAttr,
    escapeHtml,
    localizeSystem,
    t,
} from "../../shared/values.js";

import {
    addDamageRecoveryActions,
    applyDamageToLinkedTarget,
    applyDefenseNumbingDamage,
    damageApplicationTitle,
    getDamageApplicationState,
    isDamageApplicationAction,
    isDamageApplicationBlocked,
    isDamageApplicationCompleted,
    recoverDamageApplication,
    requestRemoteDamageApplication,
    resolveDamageApplicationTarget,
    validateLinkedDamageTarget,
    withTrackedDamageApplication,
} from "./damage-application.js";

import {
    advanceLegacyChatTicks,
    recoverLegacyTickApplication,
    synchronizeLegacyTickActionState,
} from "./legacy-ticks.js";

function primaryTargetTokenUuid(context) {
    return context?.primaryTargetTokenUuid ?? context?.targetTokenUuid ?? null;
}

function primaryTargetActorUuid(context) {
    return context?.primaryTargetActorUuid ?? context?.targetActorUuid ?? null;
}

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
            await advanceLegacyChatTicks(message, button);
        } catch (error) {
            console.error(`${MODULE_ID} | Failed to advance legacy chat ticks`, error);
            ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
        }
        return;
    }
    if (isLegacySplinterpointAction(button)) {
        event.preventDefault();
        event.stopPropagation();
        if (!mayManageMessageRoll(message)) {
            ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.NoOwner"));
            return;
        }
        const actor = services.resolveSpeakerActor(message);
        if (!actor?.useSplinterpointBonus) {
            ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.NoOwner"));
            return;
        }
        button.disabled = true;
        try {
            await actor.useSplinterpointBonus(message);
            services.scheduleRender(0);
        } catch (error) {
            console.error(`${MODULE_ID} | Legacy splinterpoint action failed`, error);
            ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
        } finally {
            if (button.isConnected) button.disabled = false;
        }
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
        if (localAction && String(action).toLocaleLowerCase() === "applydamagetousertargets") {
            const target = validateLinkedDamageTarget(message, game.user, true);
            if (!target) return;
            await withTrackedDamageApplication(message, () => applyDamageToLinkedTarget(message, actionData, target));
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

function markDamageRollPending(messageId) {
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

function clearPendingDamageRoll(messageId) {
    const timeoutId = services.getPendingDamageRollTimer(messageId);
    if (timeoutId) clearTimeout(timeoutId);
    services.deletePendingDamageRollTimer(messageId);
}

function isCombatFumbleRollControl(control) {
    const rollType = String(control?.dataset?.rollType ?? control?.dataset?.rolltype ?? "").toLocaleLowerCase();
    const action = String(control?.dataset?.localaction ?? control?.dataset?.localAction ?? "").toLocaleLowerCase();
    return rollType === "attackfumble" || action === "rollfumble";
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

function messageOffersFollowUpControl(message, control) {
    const template = globalThis.document?.createElement?.("template");
    const requestedKey = chatActionKey(control);
    const markup = String(message?.content ?? "");
    if (template) {
        template.innerHTML = markup;
        if (isLegacyTickAction(control)) {
            return Boolean(template.content.querySelector(".add-tick[data-ticks]"));
        }
        if (!requestedKey) return false;
        return Array.from(template.content.querySelectorAll(
            ".splittermond-chat-action[data-action], .splittermond-chat-action[data-localaction], .splittermond-chat-action[data-local-action]"
        )).some((candidate) => chatActionKey(candidate) === requestedKey);
    }
    if (isLegacyTickAction(control)) {
        return [...markup.matchAll(/<[^>]+>/gu)].some(([tag]) =>
            /\bclass\s*=\s*["'][^"']*\badd-tick\b[^"']*["']/iu.test(tag)
            && /\bdata-ticks\s*=/iu.test(tag)
        );
    }
    if (!requestedKey) return false;
    return [...markup.matchAll(/\bdata-(localaction|local-action|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu)]
        .some(([, kind, doubleQuoted, singleQuoted, unquoted]) => {
            const prefix = kind.toLocaleLowerCase() === "action" ? "remote" : "local";
            const value = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
            return `${prefix}:${value.toLocaleLowerCase()}` === requestedKey;
        });
}

function isLegacySplinterpointAction(control) {
    return Boolean(control?.matches?.(".use-splinterpoint"));
}

function addEventDefenseActions(element, message) {
    if (!isOffensiveCombatMessage(message)) return;
    if (!services.defenseAllowsModification(message)) return;
    const context = services.getMessageContext(message);
    if (!message.system?.checkReport?.succeeded && !context?.recalculatedFrom) return;
    if (context?.supersededBy) return;
    const splinterpointRecoveries = services.getDefenseSplinterpointRecoveries(message, game.user);
    const target = services.resolveToken(primaryTargetTokenUuid(context));
    if (!target?.actor && !splinterpointRecoveries.length) return;
    const attempted = new Set(context?.attemptedDefenseActorUuids ?? []);
    const mayDefendTarget = Boolean(
        target?.actor
        &&
        context?.recalculatedFrom
        && !attempted.has(target.actor.uuid)
        && (game.user.isGM || target.actor.isOwner)
    );
    const mayDefendOther = Boolean(target?.actor && services.getEligibleDefenderChoices(message, game.user).length > 0);
    const splinterpointActions = services.getDefenseSplinterpointActions(message, game.user);
    if (!mayDefendTarget && !mayDefendOther && !splinterpointActions.length && !splinterpointRecoveries.length) return;

    let actions = element.querySelector(".sf-promoted-actions");
    if (!actions) {
        const card = element.querySelector(".sf-offense-check");
        if (!card) return;
        let controls = card.querySelector(":scope > .sf-promoted-controls");
        if (!controls) {
            controls = document.createElement("div");
            controls.className = "sf-promoted-controls";
            const header = card.querySelector(":scope > .chat-message-header");
            if (header) header.after(controls);
            else card.prepend(controls);
        }
        actions = document.createElement("div");
        actions.className = "actions splittermond-chat-action-container sf-promoted-actions";
        actions.innerHTML = `<h3>${escapeHtml(localizeSystem("splittermond.furtherActions", "Weitere Aktionen"))}</h3>`;
        controls.prepend(actions);
    }

    if (mayDefendTarget) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "splittermond-chat-action sf-defender-action";
        button.dataset.sfAction = "defend-target";
        button.dataset.messageId = message.id;
        button.innerHTML = `<i class="fa-solid fa-shield-halved"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefendTarget", { target: target.name }))}`;
        actions.append(button);
    }
    if (mayDefendOther) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "splittermond-chat-action sf-defender-action";
        button.dataset.sfAction = "defend-other";
        button.dataset.messageId = message.id;
        button.innerHTML = `<i class="fa-solid fa-shield-heart"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenderAction", { target: target.name }))}`;
        actions.append(button);
    }
    for (const action of splinterpointActions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `splittermond-chat-action sf-splinterpoint-defense-action ${action.kind === "resonance" ? "sf-splinterpoint-resonance-action" : ""}`.trim();
        button.dataset.sfAction = "use-defense-splinterpoint";
        button.dataset.messageId = message.id;
        button.dataset.splinterpointActorUuid = action.actorUuid;
        const label = action.kind === "resonance"
            ? t("SMOOTHER_FIGHT.HUD.DefenseSplinterpointResonance", { target: target.name ?? target.actor.name })
            : t("SMOOTHER_FIGHT.HUD.DefenseSplinterpoint");
        button.innerHTML = `<i class="fa-solid fa-star"></i>${escapeHtml(label)}`;
        actions.append(button);
    }
    for (const application of splinterpointRecoveries) {
        const actor = services.resolveActorUuid(application.spenderActorUuid);
        const recovery = document.createElement("div");
        recovery.className = "sf-operation-recovery-actions sf-splinterpoint-recovery-actions";
        recovery.innerHTML = `<span><i class="fa-solid fa-triangle-exclamation"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.SplinterpointApplicationUncertain", { name: actor?.name ?? application.spenderActorUuid }))}</span>
            <button type="button" class="splittermond-chat-action" data-sf-action="recover-defense-splinterpoint" data-decision="retry" data-message-id="${escapeAttr(message.id)}" data-splinterpoint-actor-uuid="${escapeAttr(application.spenderActorUuid)}"><i class="fa-solid fa-rotate-left"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.RetryOperation"))}</button>
            <button type="button" class="splittermond-chat-action" data-sf-action="recover-defense-splinterpoint" data-decision="complete" data-message-id="${escapeAttr(message.id)}" data-splinterpoint-actor-uuid="${escapeAttr(application.spenderActorUuid)}"><i class="fa-solid fa-check"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.MarkOperationCompleted"))}</button>`;
        actions.append(recovery);
    }
}

export function enforceChatPermissions(root, hudContext) {
    for (const element of root.querySelectorAll(".sf-chat-message")) {
        const message = game.messages.get(element.dataset.messageId);
        if (!message) continue;
        synchronizeRenderedTickAction(element, message);
        synchronizeLegacyTickActionState(element, message);
        const mayManageRoll = mayManageMessageRoll(message);
        if (!mayManageRoll) removeRollManagementControls(element);
        const mayRollFumble = mayRollCombatFumble(
            game.user?.isGM,
            isMessageSpeakerAssignedToCurrentUser(message)
        );
        if (!mayRollFumble) removeCombatFumbleRollControls(element);
        if (!mayControlSpeakerActor(message)) removeOutgoingDamageControls(element);
        const renderedActions = getRenderedChatActionKeys(message.id);
        if (renderedActions) {
            for (const button of element.querySelectorAll(".splittermond-chat-action[data-action], .splittermond-chat-action[data-localaction], .splittermond-chat-action[data-local-action]")) {
                const key = chatActionKey(button);
                const assignedRollAction = mayManageRoll && isRollManagementControl(button);
                if (key && !renderedActions.has(key) && !assignedRollAction) button.remove();
            }
        } else {
            if (!mayManageRoll) {
                element.querySelectorAll(".splittermond-chat-action[data-action]:not([data-localaction]):not([data-local-action])").forEach((button) => button.remove());
            }
        }

        const context = services.getMessageContext(message);
        enforceSystemVisibility(element, message, context);
        enforceOffenseDefensePhaseControls(element, message);
        const defenseTarget = services.resolveToken(primaryTargetTokenUuid(context)) ?? services.getControlledTokenDocument() ?? hudContext.target;
        const mayDefend = game.user.isGM || defenseTarget?.actor?.isOwner;
        const targetAlreadyDefended = Boolean(
            defenseTarget?.actor?.uuid
            && context?.attemptedDefenseActorUuids?.includes?.(defenseTarget.actor.uuid)
        );
        if (!mayDefend || targetAlreadyDefended || context?.supersededBy || context?.recalculatedFrom || !services.defenseAllowsModification(message)) {
            element.querySelectorAll('[data-localaction="activeDefense" i], [data-local-action="activeDefense" i]').forEach((button) => {
                button.remove();
            });
        }
        addEventDefenseActions(element, message);
        decorateEventActionButtons(element, message);
        element.querySelectorAll(".splittermond-chat-action-container:not(:has(.splittermond-chat-action, .add-tick[data-ticks])), .sf-promoted-actions:not(:has(.splittermond-chat-action, .add-tick[data-ticks]))").forEach((container) => container.remove());
        element.querySelectorAll(".sf-promoted-degree-options:not(:has(.splittermond-chat-action))").forEach((container) => container.remove());
        element.querySelectorAll(".sf-promoted-controls:not(:has(.splittermond-chat-action, .add-tick[data-ticks]))").forEach((container) => container.remove());
    }
}

function synchronizeRenderedTickAction(element, message) {
    const existing = Array.from(element.querySelectorAll(".splittermond-chat-action, .add-tick[data-ticks]"))
        .some(isTickAdvanceControl);
    if (existing) return;
    const source = getRenderedChatActionElements(message.id)
        .find((button) => isTickAdvanceControl(button) && !button.disabled);
    if (!source) return;

    const card = element.querySelector(".splittermond.check, .splittermond.damage");
    if (!card) return;
    let controls = card.querySelector(":scope > .sf-promoted-controls");
    if (!controls) {
        controls = document.createElement("div");
        controls.className = "sf-promoted-controls";
        const header = card.querySelector(":scope > .chat-message-header, :scope > header");
        if (header) header.after(controls);
        else card.prepend(controls);
    }
    let actions = controls.querySelector(":scope > .sf-promoted-actions");
    if (!actions) {
        actions = document.createElement("div");
        actions.className = "actions splittermond-chat-action-container sf-promoted-actions";
        controls.prepend(actions);
    }
    actions.append(source.cloneNode(true));
}

function isTickAdvanceControl(control) {
    return isLegacyTickAction(control)
        || String(control?.dataset?.action ?? "").toLocaleLowerCase() === "advancetoken";
}

function isFocusCostControl(control) {
    return String(control?.dataset?.action ?? "").toLocaleLowerCase() === "consumecosts";
}

export function isOffenseFollowUpControl(control) {
    return isOutgoingDamageControl(control) || isFocusCostControl(control) || isTickAdvanceControl(control);
}

export function enforceOffenseDefensePhaseControls(element, message) {
    if (!element || !isOffensiveCombatMessage(message)) return;
    if (!services.defenseAllowsModification(message)) {
        element.querySelectorAll(".sf-chat-defense-response").forEach((control) => control.remove());
        element.querySelectorAll('[data-localaction="activeDefense" i], [data-local-action="activeDefense" i]')
            .forEach((button) => button.remove());
    }
    if (!services.defenseAwaitsResponse(message)) return;
    ensureActiveDefenseControl(element, message);
    decorateActiveDefenseResponseControls(element, message);
    for (const control of element.querySelectorAll(".splittermond-chat-action, .add-tick[data-ticks]")) {
        if (!isOffenseFollowUpControl(control)) continue;
        control.disabled = true;
        control.setAttribute("aria-disabled", "true");
        control.classList.add("is-awaiting-defense");
        control.title = t("SMOOTHER_FIGHT.HUD.DefenseFollowUpBlocked");
    }
}

function ensureActiveDefenseControl(element, message) {
    const selector = '[data-localaction="activeDefense" i], [data-local-action="activeDefense" i]';
    if (element.querySelectorAll(selector).length || !services.canUserDeclineActiveDefense(game.user, message)) return;
    const actions = element.querySelector?.([
        ".sf-promoted-actions",
        ".splittermond.check.attack > .actions",
        ".splittermond.check.spell > .actions",
        ".splittermond.check.attack .actions.splittermond-chat-action-container",
        ".splittermond.check.spell .actions.splittermond-chat-action-container",
    ].join(", "));
    if (!actions) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "splittermond-chat-action sf-synthetic-active-defense";
    button.dataset.localaction = "activeDefense";
    button.innerHTML = `<i class="fa-solid fa-shield-halved" aria-hidden="true"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Defense"))}`;
    actions.append(button);
}

function decorateActiveDefenseResponseControls(element, message) {
    if (!services.canUserDeclineActiveDefense(game.user, message)) return;
    for (const defenseButton of element.querySelectorAll(
        '[data-localaction="activeDefense" i], [data-local-action="activeDefense" i]'
    )) {
        if (defenseButton.closest(".sf-chat-defense-response")) continue;
        const wrapper = document.createElement("div");
        wrapper.className = "sf-chat-defense-response";
        defenseButton.replaceWith(wrapper);
        defenseButton.classList.add("sf-chat-defense-button");
        const declineButton = document.createElement("button");
        declineButton.type = "button";
        declineButton.className = "sf-chat-decline-defense";
        declineButton.dataset.sfAction = "decline-active-defense";
        declineButton.dataset.messageId = message.id;
        declineButton.title = t("SMOOTHER_FIGHT.HUD.DeclineActiveDefense");
        declineButton.setAttribute("aria-label", declineButton.title);
        declineButton.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
        wrapper.append(defenseButton, declineButton);
    }
}

function isUsableActionControl(control) {
    return !control?.disabled && control?.getAttribute?.("aria-disabled") !== "true";
}

function decorateEventActionButtons(element, message) {
    const ownsSpeaker = isMessageSpeakerAssignedToCurrentUser(message);
    const associatedDamageMessages = getAssociatedDamageMessages(element, message);
    const groupHasDamage = associatedDamageMessages.length > 0;
    if (groupHasDamage && isOffensiveCombatMessage(message)) clearPendingDamageRoll(message.id);
    const damageRollPending = isOffensiveCombatMessage(message)
        && !groupHasDamage
        && services.hasPendingDamageRoll(message.id);
    const hasPendingDamageApplication = isOffensiveCombatMessage(message)
        && associatedDamageMessages.some((damageMessage) => !isDamageApplicationCompleted(damageMessage));
    const buttons = Array.from(element.querySelectorAll(".splittermond-chat-action, .add-tick[data-ticks], .rollable[data-roll-type]"));
    const degreeOptions = element.querySelector(".sf-promoted-degree-options");
    const awaitingDefense = services.defenseAwaitsResponse(message);
    decoratePendingDefenseDegreeOptions(degreeOptions, awaitingDefense);
    if (awaitingDefense) element.querySelector(".degree-of-success")?.classList.remove("has-next-open-degrees");
    const hasPendingDegreeOptions = Number(message?.system?.openDegreesOfSuccess) > 0
        && Boolean(degreeOptions?.querySelector('input.splittermond-chat-action:not(:checked):not(:disabled)'));
    const actionHighlight = combatActionHighlightState({
        isOffense: isOffensiveCombatMessage(message),
        awaitingDefense,
        hasPendingDegreeOptions,
        followUpStarted: services.hasOffenseFollowUpStarted(message),
        isSpell: services.isSpellMessage(message),
        hasPendingFocusCost: buttons.some((button) => isFocusCostControl(button) && isUsableActionControl(button)),
        hasPendingDamage: damageRollPending || (!groupHasDamage && buttons.some((button) =>
            isOutgoingDamageControl(button) && isUsableActionControl(button)
        )),
        hasPendingDamageApplication,
    });
    const damageApplicationState = getDamageApplicationState(message);
    const damageApplicationBlocked = damageApplicationState !== "idle";
    if (ownsSpeaker && actionHighlight.degrees) {
        degreeOptions?.classList.add("is-next-degree-options");
        element.querySelector(".degree-of-success")?.classList.add("has-next-open-degrees");
    }
    for (const button of buttons) {
        const action = String(button.dataset.action ?? button.dataset.localaction ?? button.dataset.localAction ?? "").toLocaleLowerCase();
        if (damageApplicationBlocked && isDamageApplicationAction(action)) {
            button.disabled = true;
            button.classList.add(damageApplicationState === "completed" ? "is-applied" : `is-${damageApplicationState}`);
            button.title = damageApplicationTitle(damageApplicationState);
        }
        if (isFocusCostControl(button) && ownsSpeaker && actionHighlight.focus && isUsableActionControl(button)) {
            button.classList.add("is-next-focus-cost");
        }
        if (isOutgoingDamageControl(button) && ownsSpeaker && actionHighlight.damage && isUsableActionControl(button)) {
            button.classList.add("is-next-damage-roll");
        }
        if (isTickAdvanceControl(button)) {
            button.classList.add("sf-tick-advance-action");
            if (ownsSpeaker && actionHighlight.ticks && isUsableActionControl(button)) button.classList.add("is-own-action-ticks");
            if (services.isDefenseMessage(message) && ownsSpeaker && actionHighlight.ticks && isUsableActionControl(button)) button.classList.add("is-own-defense-ticks");
            if (actionHighlight.ticks && isUsableActionControl(button) && (services.isDamageMessage(message) || (groupHasDamage && isOffensiveCombatMessage(message)))) {
                button.classList.add("is-damage-ticks");
            }
        }
        if (isCombatFumbleRollControl(button) && ownsSpeaker) button.classList.add("is-own-fumble-roll");
        if (action === "applydamagetousertargets" && game.user?.isGM && !damageApplicationBlocked) {
            button.classList.add("is-gm-target-application");
        }
        if (!damageApplicationBlocked && (action === "applydamagetoself" || action === "applydamagetousertargets")) {
            const target = resolveDamageApplicationTarget(message);
            if (target && services.isCurrentUserTarget(target)) button.classList.add("is-self-target");
        }
    }
    if (services.isDamageMessage(message) && damageApplicationState === "uncertain") {
        addDamageRecoveryActions(element, "generic");
    }
}

function decoratePendingDefenseDegreeOptions(degreeOptions, awaitingDefense) {
    if (!degreeOptions) return;
    degreeOptions.classList.remove("is-next-degree-options");
    degreeOptions.querySelector(":scope > .sf-defense-decision-hint")?.remove();
    if (!awaitingDefense) return;
    const hint = document.createElement("div");
    hint.className = "sf-defense-decision-hint";
    hint.innerHTML = `<i class="fa-solid fa-hourglass-half" aria-hidden="true"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenseDecisionPendingHint"))}</span>`;
    degreeOptions.prepend(hint);
}

function getAssociatedDamageMessages(element, message) {
    if (services.isDamageMessage(message)) return [message];
    const group = element.closest(".sf-event-group");
    if (!group) return [];
    return Array.from(group.querySelectorAll(".sf-associated-card.is-damage .sf-chat-message[data-message-id]"))
        .map((damageElement) => game.messages.get(damageElement.dataset.messageId))
        .filter((damageMessage) => damageMessage && services.isDamageMessage(damageMessage));
}

export function isMessageSpeakerAssignedToCurrentUser(message) {
    const context = services.getMessageContext(message);
    if (context?.assignedUserId === game.user?.id) return true;
    const token = services.resolveToken(
        (services.isDefenseMessage(message) ? context?.defenderTokenUuid : context?.attackerTokenUuid)
        ?? services.speakerTokenUuid(message)
    );
    if (token && services.isCurrentUserTarget(token)) return true;
    const actor = services.resolveSpeakerActor(message);
    const combatant = Array.from(game.combat?.combatants ?? []).find((candidate) => candidate.actorId === actor?.id);
    const assignedUser = services.getAssignedUser?.(combatant ?? actor);
    if (assignedUser?.id === game.user?.id) return true;
    if (combatant && actor) {
        const runtimeController = services.getRuntimeController(combatant);
        if (runtimeController) return runtimeController.id === game.user?.id;
    }
    return false;
}

function getRenderedChatActionElements(messageId) {
    return Array.from(document.querySelectorAll(".message[data-message-id]"))
        .filter((element) => element.dataset.messageId === messageId && !element.closest(`#${MODULE_ID}-hud`))
        .flatMap((element) => Array.from(element.querySelectorAll(".splittermond-chat-action, .add-tick[data-ticks]")));
}

function mayManageMessageRoll(message, user = game.user) {
    const speakerActor = services.resolveSpeakerActor(message);
    const ownsSpeakerActor = Boolean(speakerActor?.testUserPermission?.(user, "OWNER") ?? speakerActor?.isOwner);
    const authorId = message?.author?.id ?? message?.user?.id ?? message?.user;
    const assignedSpeaker = Boolean(
        user?.id
        && user.id === game.user?.id
        && isMessageSpeakerAssignedToCurrentUser(message)
    );
    return mayUseRemoteChatActions(Boolean(user?.isGM), ownsSpeakerActor, authorId === user?.id, assignedSpeaker);
}

export function mayControlSpeakerActor(message, user = game.user) {
    if (user?.isGM) return true;
    const speakerActor = services.resolveSpeakerActor(message);
    return Boolean(speakerActor?.testUserPermission?.(user, "OWNER") ?? speakerActor?.isOwner);
}

function isOutgoingDamageControl(control) {
    const action = String(control?.dataset?.action ?? control?.dataset?.localaction ?? control?.dataset?.localAction ?? "")
        .trim();
    return isDamageSelectionAction(action);
}

export function removeOutgoingDamageControls(element) {
    for (const control of element.querySelectorAll(".splittermond-chat-action")) {
        if (!isOutgoingDamageControl(control)) continue;
        (control.closest(".splittermond-inline-label-input") ?? control).remove();
    }
}

function isRollManagementControl(control) {
    const isDegreeOption = Boolean(
        control?.closest?.(".sf-promoted-degree-options")
        || control?.matches?.('input[type="checkbox"].splittermond-chat-action[data-action]')
    );
    const action = isLegacyTickAction(control) ? "addTick" : control?.dataset?.action;
    return requiresRollManagementPermission(action, isDegreeOption);
}

function removeRollManagementControls(element) {
    element.querySelectorAll([
        ".sf-promoted-degree-options",
        '.splittermond-chat-action[data-action="consumeCosts" i]',
        '.splittermond-chat-action[data-action="advanceToken" i]',
        '.splittermond-chat-action[data-action="useSplinterpoint" i]',
        ".add-tick[data-ticks]",
    ].join(", ")).forEach((control) => control.remove());
}

function removeCombatFumbleRollControls(element) {
    for (const control of element.querySelectorAll(".splittermond-chat-action, .rollable[data-roll-type], .rollable[data-rolltype]")) {
        if (isCombatFumbleRollControl(control)) control.remove();
    }
}

function enforceSystemVisibility(element, message, context = services.getMessageContext(message)) {
    if (game.user.isGM) return;
    const target = resolveMessageTarget(context);
    const observer = Boolean(target?.actor?.testUserPermission?.(game.user, "OBSERVER"));
    const markedDifficulty = element.querySelector(".gm-only.difficulty, .gm-only .difficulty");
    const targetDependent = Boolean(message.system?.checkReport?.hideDifficulty || markedDifficulty);
    const mayViewDifficulty = mayViewTargetDifficulty(targetDependent, false, observer);

    for (const restricted of element.querySelectorAll(".gm-only")) {
        const isDifficulty = restricted.matches(".difficulty, .sf-chat-recalculated")
            || Boolean(restricted.querySelector(".difficulty, .sf-chat-recalculated"));
        if (!isDifficulty || !mayViewDifficulty) restricted.remove();
    }
    if (!mayViewDifficulty) {
        element.querySelectorAll(".sf-chat-recalculated").forEach((restricted) => restricted.remove());
    }
    if (!mayViewActorResources(false, observer)) {
        element.querySelectorAll(".sf-defense-value").forEach((restricted) => restricted.remove());
    }
}

export function resolveMessageTarget(context) {
    if (!context) return { token: null, actor: null };
    const token = services.resolveToken(primaryTargetTokenUuid(context));
    if (token?.actor) return { token, actor: token.actor };
    let actor = null;
    const actorUuid = primaryTargetActorUuid(context);
    if (actorUuid) {
        try {
            actor = globalThis.fromUuidSync?.(actorUuid) ?? null;
        } catch (error) {
            console.debug(`${MODULE_ID} | Could not resolve target actor ${actorUuid}`, error);
        }
    }
    return { token, actor };
}

function getRenderedChatActionKeys(messageId) {
    const messageRoots = Array.from(document.querySelectorAll(".message[data-message-id]"))
        .filter((element) => element.dataset.messageId === messageId && !element.closest(`#${MODULE_ID}-hud`));
    if (!messageRoots.length) return null;
    return new Set(messageRoots.flatMap((element) =>
        Array.from(element.querySelectorAll(".splittermond-chat-action[data-action], .splittermond-chat-action[data-localaction], .splittermond-chat-action[data-local-action]"))
            .map(chatActionKey)
            .filter(Boolean)
    ));
}

function chatActionKey(button) {
    const localAction = button?.dataset?.localaction ?? button?.dataset?.localAction;
    if (localAction) return `local:${String(localAction).toLocaleLowerCase()}`;
    const remoteAction = button?.dataset?.action;
    return remoteAction ? `remote:${String(remoteAction).toLocaleLowerCase()}` : "";
}
