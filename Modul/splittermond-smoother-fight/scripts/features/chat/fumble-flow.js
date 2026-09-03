import { services } from "../../core/services.js";
import { t } from "../../shared/values.js";

export function isCombatFumbleRollControl(control) {
    const rollType = String(control?.dataset?.rollType ?? control?.dataset?.rolltype ?? "").toLocaleLowerCase();
    const action = String(control?.dataset?.localaction ?? control?.dataset?.localAction ?? "").toLocaleLowerCase();
    return rollType === "attackfumble" || action === "rollfumble";
}

export function decorateCombatFumbleRollControl(control, { hasResult, ownsSpeaker, pending }) {
    if (!isCombatFumbleRollControl(control)) return;
    if (hasResult) {
        control.disabled = true;
        control.setAttribute("aria-disabled", "true");
        control.classList.add("is-applied");
        control.title = t("SMOOTHER_FIGHT.HUD.AlreadyApplied");
    } else if (ownsSpeaker && pending) {
        control.classList.add("is-own-fumble-roll");
    }
}

export function hasPendingCombatFumbleStep(element, controls = null) {
    const buttons = controls ?? Array.from(element?.querySelectorAll?.(
        ".splittermond-chat-action, .add-tick[data-ticks], .rollable[data-roll-type]"
    ) ?? []);
    const associatedFumbles = getAssociatedCombatFumbleMessages(element);
    if (associatedFumbles.length) {
        return associatedFumbles.some((fumbleMessage) => (
            !fumbleMessage || (services.hasPendingFumbleActions?.(fumbleMessage) ?? true)
        ));
    }
    return buttons.some(isCombatFumbleRollControl);
}

export function getAssociatedCombatFumbleMessages(element) {
    const messageId = element?.dataset?.messageId
        ?? element?.closest?.(".sf-chat-message[data-message-id]")?.dataset?.messageId;
    const message = game.messages?.get?.(messageId);
    const context = services.getMessageContext?.(message) ?? {};
    const sourceMessageIds = new Set([
        message?.id,
        context.attackMessageId,
        context.rootAttackMessageId,
        context.recalculatedFrom,
    ].filter(Boolean));
    const belongsToMessage = (candidate) => {
        if (!message) return true;
        const sourceMessageId = services.getFumbleData?.(candidate)?.sourceMessageId;
        if (!sourceMessageId || !sourceMessageIds.has(sourceMessageId)) return false;
        const sourceActorId = message.speaker?.actor;
        const fumbleActorId = candidate?.speaker?.actor;
        return !sourceActorId || !fumbleActorId || sourceActorId === fumbleActorId;
    };
    const group = element?.closest?.(".sf-event-group");
    const rendered = group
        ? Array.from(group.querySelectorAll(".sf-associated-card.is-fumble .sf-chat-message[data-message-id]"))
            .map((fumbleElement) => game.messages.get(fumbleElement.dataset.messageId))
            .filter((candidate) => candidate && belongsToMessage(candidate))
        : [];
    if (rendered.length) return rendered;

    if (!message) return [];
    const messages = Array.from(game.messages?.contents
        ?? game.messages?.values?.()
        ?? []);
    return messages.filter((candidate) => {
        if (!services.isFumbleTableMessage?.(candidate)) return false;
        return belongsToMessage(candidate);
    });
}
