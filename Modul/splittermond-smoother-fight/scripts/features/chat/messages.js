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

import {
    formatMovementDistance,
    readTokenMovementDistance,
} from "../../shared/movement.js";

const MOVEMENT_ACTIONS = new Set(["walk", "sprint"]);

export function createDefenseSplinterpointChatCard({
    actor,
    token = null,
    targetName,
    targetTokenUuid = null,
    defenseValue,
    kind,
    attackMessageId,
}) {
    if (!actor || !["primary", "resonance"].includes(kind) || !Number.isFinite(Number(defenseValue))) {
        throw new Error("Invalid defense splinterpoint chat data");
    }
    const reason = t(kind === "resonance"
        ? "SMOOTHER_FIGHT.HUD.DefenseSplinterpointChatResonanceReason"
        : "SMOOTHER_FIGHT.HUD.DefenseSplinterpointChatPrimaryReason");
    const content = `<section class="sf-tick-action-chat-card sf-defense-splinterpoint-chat-card">
        <header>
            <i class="fa-solid fa-star" aria-hidden="true"></i>
            <div><small>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenseSplinterpointChatEyebrow"))}</small><h2>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenseSplinterpointChatTitle"))}</h2></div>
        </header>
        <dl>
            ${tickActionCardField(t("SMOOTHER_FIGHT.HUD.DefenseSplinterpointChatActor"), actor.name ?? "–")}
            ${tickActionCardField(t("SMOOTHER_FIGHT.HUD.DefenseSplinterpointChatTarget"), targetName ?? "–")}
            ${tickActionCardField(t("SMOOTHER_FIGHT.HUD.DefenseSplinterpointChatReason"), reason)}
            ${tickActionCardField(t("SMOOTHER_FIGHT.HUD.DefenseSplinterpointChatNewDefense"), defenseValue)}
        </dl>
    </section>`;
    return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor, token: token?.document ?? token }),
        content,
        flags: {
            [MODULE_ID]: {
                defenseSplinterpoint: {
                    attackMessageId,
                    actorUuid: actor.uuid ?? null,
                    targetTokenUuid,
                    kind,
                    defenseValue: Number(defenseValue),
                },
            },
        },
    });
}

export async function createTickActionChatCard(context, actionId, selectedTicks = "custom", options = {}) {
    const action = COMBAT_TICK_ACTIONS.find((candidate) => candidate.id === actionId);
    if (!action || !context?.actor) throw new Error(`Unknown combat tick action: ${actionId}`);

    const token = context.token?.document ?? context.token;
    const tokenName = token?.name ?? context.combatant?.name ?? context.actor.name ?? "–";
    const actionName = t(`SMOOTHER_FIGHT.HUD.TickActions.${action.id}.Name`);
    const kind = t(`SMOOTHER_FIGHT.HUD.TickActionKinds.${action.kind}`);
    const duration = tickActionCardDuration(action, selectedTicks);
    const description = options.description ?? t(`SMOOTHER_FIGHT.HUD.TickActions.${action.id}.Description`);
    const baseSpecial = options.special ?? (action.special
        ? t(`SMOOTHER_FIGHT.HUD.TickActions.${action.id}.Special`)
        : t("SMOOTHER_FIGHT.HUD.TickActionDash"));
    const special = MOVEMENT_ACTIONS.has(action.id)
        ? `${baseSpecial} (${t("SMOOTHER_FIGHT.HUD.MovementDistance", {
            distance: formatMovementDistance(options.movementDistance ?? readTokenMovementDistance(token)),
        })})`
        : baseSpecial;
    const source = action.source
        ? `<footer class="sf-tick-action-chat-source"><small>${escapeHtml(t("SMOOTHER_FIGHT.HUD.TickActionSource", action.source))}</small></footer>`
        : "";
    const bonus = Number(options.bonus);
    const preparationData = Number.isInteger(bonus) && bonus > 0
        ? {
            bonus,
            targetActorUuid: options.targetActorUuid ?? null,
            targetName: options.targetName ?? null,
            targetTokenUuid: options.targetTokenUuid ?? null,
        }
        : {};
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
        ${source}
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
                    ...preparationData,
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

export async function setOptionalFlag(message, key, value) {
    try {
        return await message.setFlag(MODULE_ID, key, value);
    } catch (error) {
        console.debug(`${MODULE_ID} | Could not set ${key} flag on ${message.id}`, error);
        return null;
    }
}

/**
 * Persists combat state which must not be lost without stopping the workflow.
 * Callers may rely on a rejection here to avoid applying a mechanical effect.
 */
export async function setRequiredFlag(message, key, value) {
    try {
        const updated = await message.setFlag(MODULE_ID, key, value);
        if (!updated && !requiredFlagMatches(message, key, value)) {
            throw new Error("The document update returned no result and the stored value does not match");
        }
        return updated || message;
    } catch (cause) {
        const error = new Error(`Could not persist required ${key} flag on chat message ${message?.id ?? "unknown"}`, {
            cause,
        });
        console.error(`${MODULE_ID} | ${error.message}`, cause);
        ui.notifications?.error?.(t("SMOOTHER_FIGHT.HUD.RequiredFlagFailed", { flag: key }));
        throw error;
    }
}

function requiredFlagMatches(message, key, expected) {
    const stored = message?.getFlag?.(MODULE_ID, key) ?? message?.flags?.[MODULE_ID]?.[key];
    return flagValuesEqual(stored, expected);
}

function flagValuesEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left)
            && Array.isArray(right)
            && left.length === right.length
            && left.every((value, index) => flagValuesEqual(value, right[index]));
    }
    if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key) => Object.hasOwn(right, key) && flagValuesEqual(left[key], right[key]));
}

// Backwards-compatible name for explicitly best-effort metadata.
export const safeSetFlag = setOptionalFlag;

export function checkResultMessage(report) {
    if (report.isCrit) return localizeSystem("splittermond.critical", "Kritischer Erfolg");
    if (report.isFumble) return localizeSystem("splittermond.fumble", "Patzer");
    const amount = Math.min(Math.abs(totalDegreesOfSuccess(report)), 5);
    const state = report.succeeded ? "successMessage" : "failMessage";
    return localizeSystem(`splittermond.${state}.${amount}`, report.succeeded ? "Erfolg" : "Fehlschlag");
}
