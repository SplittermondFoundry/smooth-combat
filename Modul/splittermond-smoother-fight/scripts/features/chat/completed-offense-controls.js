import {
    isDamageSelectionAction,
    isOffensiveCombatMessage,
} from "../../combat-rules.js";

import { services } from "../../core/services.js";

export function isOutgoingDamageControl(control) {
    const action = String(control?.dataset?.action ?? control?.dataset?.localaction ?? control?.dataset?.localAction ?? "")
        .trim();
    return isDamageSelectionAction(action);
}

export function isDegreeOptionControl(control) {
    return Boolean(
        control?.closest?.(".sf-promoted-degree-options")
        || control?.matches?.('input[type="checkbox"].splittermond-chat-action[data-action]')
    );
}

export function removeOutgoingDamageControls(element) {
    for (const control of element.querySelectorAll(".splittermond-chat-action")) {
        if (!isOutgoingDamageControl(control)) continue;
        (control.closest(".splittermond-inline-label-input") ?? control).remove();
    }
}

export function getAssociatedDamageMessages(element, message) {
    if (services.isDamageMessage?.(message)) return [message];
    const group = element.closest(".sf-event-group");
    const rendered = group
        ? Array.from(group.querySelectorAll(".sf-associated-card.is-damage .sf-chat-message[data-message-id]"))
        .map((damageElement) => game.messages.get(damageElement.dataset.messageId))
        .filter((damageMessage) => damageMessage && services.isDamageMessage?.(damageMessage))
        : [];
    const collected = services.collectCombatEventGroups?.({ combat: globalThis.game?.combat })
        ?.find((candidate) => candidate?.primary?.id === message?.id)?.damages ?? [];
    const linked = messageCollection().filter((candidate) => (
        services.isDamageMessage?.(candidate)
        && services.getMessageContext?.(candidate)?.attackMessageId === message?.id
    ));
    return [...new Map([...rendered, ...collected, ...linked]
        .filter(Boolean)
        .map((candidate) => [candidate.id, candidate])).values()];
}

export function hasAssociatedDamageMessage(element, message) {
    return getAssociatedDamageMessages(element, message).length > 0;
}

export function suppressCompletedOffenseControls(element, message) {
    if (!element || !isOffensiveCombatMessage(message) || !hasAssociatedDamageMessage(element, message)) return false;
    removeOutgoingDamageControls(element);
    removeDegreeOptionControls(element);
    return true;
}

export function removeDegreeOptionControls(element) {
    const containers = new Set();
    for (const control of element.querySelectorAll('input[type="checkbox"].splittermond-chat-action[data-action]')) {
        containers.add(control.closest(".sf-promoted-degree-options, .splittermond-chat-action-container.chat-card-segment") ?? control);
    }
    for (const container of containers) container.remove();
}

function messageCollection() {
    const messages = globalThis.game?.messages;
    return Array.from(messages?.contents ?? messages?.values?.() ?? messages ?? []);
}
