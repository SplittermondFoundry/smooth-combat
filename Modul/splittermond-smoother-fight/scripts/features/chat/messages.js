import { services } from "../../core/services.js";

import {
    COMBAT_TICK_ACTIONS,
    combatMessageKind,
    isOffensiveCombatMessage,
    mergeActiveDefenseCheck,
    totalDegreesOfSuccess,
} from "../../combat-rules.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    escapeHtml,
    localizeSystem,
    t,
} from "../../shared/values.js";

export async function createTickActionChatCard(context, actionId, selectedTicks = "custom") {
    const action = COMBAT_TICK_ACTIONS.find((candidate) => candidate.id === actionId);
    if (!action || !context?.actor) throw new Error(`Unknown combat tick action: ${actionId}`);

    const token = context.token?.document ?? context.token;
    const tokenName = token?.name ?? context.combatant?.name ?? context.actor.name ?? "–";
    const actionName = t(`SMOOTHER_FIGHT.HUD.TickActions.${action.id}.Name`);
    const kind = t(`SMOOTHER_FIGHT.HUD.TickActionKinds.${action.kind}`);
    const duration = tickActionCardDuration(action, selectedTicks);
    const description = t(`SMOOTHER_FIGHT.HUD.TickActions.${action.id}.Description`);
    const special = action.special
        ? t(`SMOOTHER_FIGHT.HUD.TickActions.${action.id}.Special`)
        : t("SMOOTHER_FIGHT.HUD.TickActionDash");
    const content = `<section class="sf-tick-action-chat-card">
        <header>
            <i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>
            <div><small>${escapeHtml(t("SMOOTHER_FIGHT.HUD.TickActionCardEyebrow"))}</small><h2>${escapeHtml(actionName)}</h2></div>
        </header>
        <dl>
            ${tickActionCardField(t("SMOOTHER_FIGHT.HUD.TickActionToken"), tokenName)}
            ${tickActionCardField(t("SMOOTHER_FIGHT.HUD.TickActionDurationHeading"), duration)}
            ${tickActionCardField(t("SMOOTHER_FIGHT.HUD.TickActionType"), kind)}
        </dl>
        <section><h3>${escapeHtml(t("SMOOTHER_FIGHT.HUD.TickActionDescription"))}</h3><p>${escapeHtml(description)}</p></section>
        <section><h3>${escapeHtml(t("SMOOTHER_FIGHT.HUD.TickActionSpecial"))}</h3><p>${escapeHtml(special)}</p></section>
    </section>`;
    const speaker = ChatMessage.getSpeaker({ actor: context.actor, token });
    return ChatMessage.create({
        speaker,
        content,
        flags: {
            [MODULE_ID]: {
                tickAction: {
                    id: action.id,
                    ticks: selectedTicks,
                    tokenUuid: token?.uuid ?? null,
                },
            },
        },
    });
}

function tickActionCardField(label, value) {
    return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function tickActionCardDuration(action, selectedTicks) {
    const selected = Number(selectedTicks);
    if (selectedTicks !== "custom" && Number.isFinite(selected)) {
        return t("SMOOTHER_FIGHT.HUD.TickActionDuration", { ticks: selected });
    }
    if (Array.isArray(action.ticks)) {
        return t("SMOOTHER_FIGHT.HUD.TickActionDurationRange", {
            first: action.ticks[0],
            last: action.ticks.at(-1),
        });
    }
    if (Number.isFinite(Number(action.ticks))) {
        return t("SMOOTHER_FIGHT.HUD.TickActionDuration", { ticks: action.ticks });
    }
    const suffix = action.ticks === "wgs" ? "Wgs" : action.ticks === "spell" ? "Spell" : "Unavailable";
    return t(`SMOOTHER_FIGHT.HUD.TickActionDuration${suffix}`);
}

export function resolveSpeakerActor(message) {
    const scene = message.speaker?.scene ? game.scenes.get(message.speaker.scene) : null;
    const tokenActor = message.speaker?.token ? scene?.tokens?.get(message.speaker.token)?.actor : null;
    return tokenActor ?? (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null);
}

export function getMessageContext(message) {
    return message?.getFlag?.(MODULE_ID, "context") ?? message?.flags?.[MODULE_ID]?.context ?? null;
}

export function getDefenseCheck(message) {
    const checkData = message?.getFlag?.("splittermond", "check") ?? message?.flags?.splittermond?.check ?? null;
    return mergeActiveDefenseCheck(checkData, message?.system?.checkReport);
}

export function isSpellMessage(message) {
    return combatMessageKind(message) === "spell";
}

export function isDamageMessage(message) {
    return combatMessageKind(message) === "damage";
}

export function isDefenseMessage(message) {
    return getDefenseCheck(message)?.type === "defense";
}

export function isCombatEventMessage(message) {
    return Boolean(
        isOffensiveCombatMessage(message)
        || isDefenseMessage(message)
        || isDamageMessage(message)
        || services.isFumbleTableMessage(message)
    );
}

export function isOwnMessage(message) {
    const authorId = message.author?.id ?? message.user?.id ?? message.user;
    return authorId === game.user.id;
}

export function speakerTokenUuid(message) {
    const scene = game.scenes?.get(message.speaker?.scene);
    return scene?.tokens?.get(message.speaker?.token)?.uuid ?? null;
}

export async function safeSetFlag(message, key, value) {
    try {
        return await message.setFlag(MODULE_ID, key, value);
    } catch (error) {
        console.debug(`${MODULE_ID} | Could not set ${key} flag on ${message.id}`, error);
        return null;
    }
}

export function checkResultMessage(report) {
    if (report.isCrit) return localizeSystem("splittermond.critical", "Kritischer Erfolg");
    if (report.isFumble) return localizeSystem("splittermond.fumble", "Patzer");
    const amount = Math.min(Math.abs(totalDegreesOfSuccess(report)), 5);
    const state = report.succeeded ? "successMessage" : "failMessage";
    return localizeSystem(`splittermond.${state}.${amount}`, report.succeeded ? "Erfolg" : "Fehlschlag");
}
