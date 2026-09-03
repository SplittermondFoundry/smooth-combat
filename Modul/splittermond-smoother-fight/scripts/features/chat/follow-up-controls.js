import { services } from "../../core/services.js";
import {
    isSyntheticSpellReleaseTickControl,
    spellReleaseTickCost,
} from "./tick-flow.js";

export function chatActionKey(control) {
    const localAction = control?.dataset?.localaction ?? control?.dataset?.localAction;
    if (localAction) return `local:${String(localAction).toLocaleLowerCase()}`;
    const remoteAction = control?.dataset?.action;
    return remoteAction ? `remote:${String(remoteAction).toLocaleLowerCase()}` : "";
}

export function messageOffersFollowUpControl(message, control) {
    const template = globalThis.document?.createElement?.("template");
    const requestedKey = chatActionKey(control);
    const markup = String(message?.content ?? "");
    if (template) {
        template.innerHTML = markup;
        if (isLegacyTickAction(control)) {
            return Boolean(template.content.querySelector(".add-tick[data-ticks]"))
                || syntheticSpellTickStillAvailable(message, control);
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
        ) || syntheticSpellTickStillAvailable(message, control);
    }
    if (!requestedKey) return false;
    return [...markup.matchAll(/\bdata-(localaction|local-action|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu)]
        .some(([, kind, doubleQuoted, singleQuoted, unquoted]) => {
            const prefix = kind.toLocaleLowerCase() === "action" ? "remote" : "local";
            const value = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
            return `${prefix}:${value.toLocaleLowerCase()}` === requestedKey;
        });
}

function isLegacyTickAction(control) {
    return Boolean(control?.matches?.(".add-tick[data-ticks]"));
}

function syntheticSpellTickStillAvailable(message, control) {
    return isSyntheticSpellReleaseTickControl(control)
        && Number(control?.dataset?.ticks) === spellReleaseTickCost(message)
        && services.messageHasPendingTicks?.(message) !== false;
}
