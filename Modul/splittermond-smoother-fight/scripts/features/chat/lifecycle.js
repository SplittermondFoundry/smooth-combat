import { services } from "../../core/services.js";

import {
    mayControlSpeakerActor,
    removeOutgoingDamageControls,
} from "./actions.js";

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

export async function onCreateChatMessage(message) {
    try {
        if (isOffensiveCombatMessage(message)) await attachCombatContext(message);
        await waitForDiceSoNice(message);
        if (services.isFumbleTableMessage(message)) await services.attachFumbleActions(message);
        if (services.isDefenseMessage(message)) await services.processDefenseMessage(message);
        services.announceMessageFeedback(message);
    } catch (error) {
        console.error(`${MODULE_ID} | Failed to process chat message`, error);
    }
}

export async function onUpdateChatMessage(message, changes) {
    if ((!hasSplittermondCheckUpdate(changes) && !hasDefenseContextUpdate(changes)) || !services.isDefenseMessage(message)) return;
    try {
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
            { allowForeign: processForAuthor }
        );
        services.announceMessageFeedback(message);
    } catch (error) {
        console.error(`${MODULE_ID} | Failed to process updated defense message`, error);
    }
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

async function waitForDiceSoNice(message) {
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
    const combat = game.combat;
    const speakerCombatant = Array.from(combat?.combatants ?? []).find((combatant) =>
        (message.speaker?.token && combatant.tokenId === message.speaker.token) ||
        (message.speaker?.actor && combatant.actorId === message.speaker.actor)
    );
    const actor = speakerCombatant?.actor ?? (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null);
    const linkedUser = speakerCombatant && actor ? services.getLinkedUser(speakerCombatant, actor) : game.user;
    const targets = services.getTargetsForUser(linkedUser);
    const target = targets.at(-1) ?? null;
    const pendingKind = services.getPendingOffenseKind(actor?.id);
    if (pendingKind) services.clearPendingOffenseKind(actor?.id);
    const context = {
        combatId: combat?.id ?? null,
        combatantId: speakerCombatant?.id ?? null,
        attackerTokenUuid: speakerCombatant?.token?.uuid ?? services.speakerTokenUuid(message),
        attackerActorUuid: actor?.uuid ?? null,
        targetTokenUuid: target?.uuid ?? null,
        targetActorUuid: target?.actor?.uuid ?? null,
        targetName: target?.name ?? target?.actor?.name ?? null,
        targetTokenUuids: targets.map((candidate) => candidate.uuid),
        targetActorUuids: targets.map((candidate) => candidate.actor?.uuid).filter(Boolean),
        targetNames: targets.map((candidate) => candidate.name ?? candidate.actor?.name).filter(Boolean),
        actionKind: pendingKind?.expiresAt >= createdAt ? pendingKind.kind : null,
        linkedUserId: linkedUser?.id ?? game.user.id,
        createdAt,
    };
    await services.safeSetFlag(message, "context", context);
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
}

export function prepareRenderedChatMessage(message, html) {
    if (!html) return;
    if (services.isFumbleTableMessage(message) && !services.getFumbleData(message)) void services.attachFumbleActions(message, html);
    if (!mayControlSpeakerActor(message)) {
        removeOutgoingDamageControls(html);
        html.querySelectorAll(".splittermond-chat-action-container:not(:has(.splittermond-chat-action))").forEach((container) => container.remove());
    }
    captureSystemActiveDefense(message, html);
    services.bindFumbleActions(message, html);
}
