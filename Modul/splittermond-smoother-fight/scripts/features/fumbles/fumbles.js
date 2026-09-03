import { services } from "../../core/services.js";

import {
    fullyConsumedCost,
    healthCostTotal,
    isOffensiveCombatMessage,
    parseStatusEffectLabel,
} from "../../combat-rules.js";

import {
    MODULE_ID,
    SOCKET,
} from "../../core/constants.js";

import { getApplicableCombat } from "../../core/combat-compatibility.js";

import {
    APPLICATION_STALE_AFTER_MS,
    applicationStateTitle,
    effectiveApplicationState,
    nextApplicationRecord,
} from "../../shared/application-state.js";

import {
    escapeAttr,
    escapeHtml,
    localizeSystem,
    numericValue,
    t,
} from "../../shared/values.js";

import {
    applyFumbleConditions,
} from "./status-effects.js";
import {
    getWeaponDamageSnapshot,
    increaseFumbleWeaponDamage,
} from "./weapon-damage.js";

const fumbleActionLocks = new Set();
const staleFumbleActionTimers = new Map();
const remoteFumbleActionRequests = new Map();
const REMOTE_FUMBLE_ACTION_TIMEOUT_MS = 15_000;

export async function attachFumbleActions(message, renderedRoot = null, sourceMessageId = null, sourceItemId = null) {
    const existing = getFumbleData(message);
    if (!(game.user.isGM || services.isOwnMessage(message)) || (existing && !sourceMessageId && !sourceItemId)) return;
    const renderedContent = renderedRoot
        ? (renderedRoot.matches?.(".message-content") ? renderedRoot : renderedRoot.querySelector?.(".message-content"))
        : null;
    const baseFumble = existing ?? createFumbleData(message, renderedContent ?? message.content);
    if (!baseFumble) return;
    const fumble = {
        ...baseFumble,
        sourceMessageId: sourceMessageId ?? baseFumble.sourceMessageId ?? null,
        sourceItemId: sourceItemId ?? baseFumble.sourceItemId ?? null,
    };
    const content = decorateFumbleCard(renderedContent?.innerHTML ?? message.content, fumble);
    if (renderedContent) renderedContent.innerHTML = content;
    try {
        await message.update({ content, [`flags.${MODULE_ID}.fumble`]: fumble });
    } catch (error) {
        console.error(`${MODULE_ID} | Could not persist required fumble state on chat message ${message.id}`, error);
        ui.notifications?.error?.(t("SMOOTHER_FIGHT.HUD.RequiredFlagFailed", { flag: "fumble" }));
        throw error;
    }
}

export function createFumbleData(message, contentOrRoot = message.content) {
    const kind = fumbleTableKind(message);
    if (!kind) return null;
    const extracted = extractFumbleEffects(contentOrRoot);
    const actor = services.resolveSpeakerActor(message);
    const sourceMessage = findFumbleSourceMessage(message, kind);
    const sourceContext = services.getMessageContext(sourceMessage);
    return {
        kind,
        actorUuid: actor?.uuid ?? null,
        actorName: actor?.name ?? message.speaker?.alias ?? "",
        sourceMessageId: sourceContext?.attackMessageId ?? sourceMessage?.id ?? null,
        sourceItemId: resolveFumbleSourceItemId(sourceMessage),
        damage: extracted.damage,
        ticks: extracted.ticks,
        tickMessage: extracted.tickMessage,
        damagesWeapon: extracted.damagesWeapon,
        conditions: extracted.conditions,
        conditionMode: extracted.conditionMode,
        damageApplied: false,
        damageApplicationStarted: false,
        ticksApplied: false,
        ticksApplicationStarted: false,
        weaponDamageApplied: false,
        weaponDamageApplicationStarted: false,
        conditionsApplied: false,
        conditionsApplicationStarted: false,
        applications: {},
    };
}

export function resolveFumbleSourceItemId(message) {
    if (!message) return null;
    const actor = services.resolveSpeakerActor(message);
    const itemData = services.getDefenseCheck(message)?.itemData
        ?? message.system?.checkReport?.itemData
        ?? message.system?.itemData;
    const ids = [itemData?.id, itemData?._id, itemData?.item?.id, itemData?.item?._id].filter(Boolean);
    const direct = ids.map((id) => actor?.items?.get?.(id)).find(Boolean);
    if (direct) return direct.id;
    const name = String(itemData?.name ?? itemData?.item?.name ?? "").trim();
    return Array.from(actor?.items ?? []).find((item) =>
        ["weapon", "shield"].includes(item.type) && item.name === name
    )?.id ?? null;
}

function findFumbleSourceMessage(message, kind) {
    return [...Array.from(game.messages?.contents ?? [])].reverse().find((candidate) => {
        if (candidate.id === message.id || isFumbleTableMessage(candidate)) return false;
        if (candidate.speaker?.actor !== message.speaker?.actor) return false;
        if (Number(candidate.timestamp) > Number(message.timestamp)) return false;
        if (kind === "magic") return services.isSpellMessage(candidate);
        if (services.isDefenseMessage(candidate)) {
            const check = services.getDefenseCheck(candidate);
            return Boolean(check?.isFumble || String(candidate.content ?? "").includes("attackFumble"));
        }
        return isOffensiveCombatMessage(candidate) && Boolean(candidate.system?.checkReport?.isFumble);
    }) ?? null;
}

export function extractFumbleEffects(contentOrRoot) {
    let root = contentOrRoot;
    if (typeof contentOrRoot === "string") {
        const template = document.createElement("template");
        template.innerHTML = contentOrRoot;
        root = template.content;
    }
    const active = root?.querySelector?.(".fumble-table-result-item-active");
    if (!active) return { damage: 0, ticks: 0, tickMessage: "", damagesWeapon: false, conditions: [], conditionMode: "all" };
    const inlineRoll = active.querySelector(".inline-roll, [data-roll]");
    const damageMatch = inlineRoll?.textContent?.trim().match(/-?\d+/u);
    const damage = Math.max(0, Number.parseInt(damageMatch?.[0] ?? "0", 10) || 0);
    const tickLink = active.querySelector(".add-tick[data-ticks]");
    const tickDirective = String(active.innerHTML ?? "").match(/@Ticks\[\s*(\d+)\s*Ticks?(?:\s*,\s*([^\]]+))?\]/iu);
    const ticks = Math.max(0, Number.parseInt(tickLink?.dataset?.ticks ?? tickDirective?.[1] ?? "0", 10) || 0);
    const tickMessage = String(tickLink?.dataset?.message ?? tickDirective?.[2] ?? "").trim();
    const conditions = [];
    for (const link of active.querySelectorAll("a[data-uuid], a[data-pack], a.content-link")) {
        const pack = link.dataset.pack ?? "";
        const uuid = link.dataset.uuid ?? (pack && link.dataset.id ? `Compendium.${pack}.Item.${link.dataset.id}` : "");
        if (!uuid.includes("splittermond.statuseffects") && !pack.includes("splittermond.statuseffects")) continue;
        const parsed = parseStatusEffectLabel(link.textContent);
        if (!parsed.name) continue;
        const condition = {
            uuid: uuid || null,
            name: parsed.name,
            level: parsed.level,
            durationTicks: statusEffectDurationTicks(link),
        };
        if (!conditions.some((existing) => sameExtractedCondition(existing, condition))) conditions.push(condition);
    }
    const activeText = Array.from(active.childNodes ?? [])
        .map((node) => String(node.textContent ?? ""))
        .join(" ");
    const damagesWeapon = /\b(?:beschädigte\s+Waffe|damaged\s+weapon)\b/iu.test(activeText);
    if (/\b(?:liegend|prone)\b/iu.test(activeText)
        && !conditions.some((condition) => /^(?:liegend|prone)$/iu.test(condition.name))) {
        conditions.push({
            uuid: null,
            name: String(game.i18n.lang ?? "").toLocaleLowerCase().startsWith("de") ? "Liegend" : "Prone",
            level: 1,
        });
    }
    const conditionMode = conditions.length > 1 && /\b(?:oder|or)\b/iu.test(activeText) ? "choose" : "all";
    return { damage, ticks, tickMessage, damagesWeapon, conditions, conditionMode };
}

function sameExtractedCondition(left, right) {
    return left.name.localeCompare(right.name, game.i18n.lang, { sensitivity: "base" }) === 0
        && left.level === right.level
        && left.durationTicks === right.durationTicks;
}

function statusEffectDurationTicks(link) {
    let trailingText = "";
    for (let sibling = link.nextSibling; sibling; sibling = sibling.nextSibling) {
        if (sibling.matches?.("a[data-uuid], a[data-pack], a.content-link")) break;
        trailingText += sibling.textContent ?? "";
    }
    const match = trailingText.match(/\b(?:für|for)\s+(?:weitere\s+|another\s+)?(\d+)\s+(?:weitere\s+)?ticks?\b/iu);
    return match ? Math.max(1, Number.parseInt(match[1], 10)) : null;
}

export function decorateFumbleCard(content, fumble) {
    if (String(content).includes("sf-fumble-actions")) return content;
    const template = document.createElement("template");
    template.innerHTML = content ?? "";
    const table = template.content.querySelector(".fumble-table-result");
    if (!table) return content;
    const actions = `<div class="sf-fumble-actions">
        <strong><i class="fa-solid fa-burst"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumble"))}</strong>
        ${getFumbleActionKeys(fumble).map((action) => fumbleActionButtonMarkup(fumble, action)).join("")}
    </div>`;
    table.insertAdjacentHTML("afterend", actions);
    const wrapper = document.createElement("div");
    wrapper.append(template.content.cloneNode(true));
    return wrapper.innerHTML;
}

export function getFumbleActionKeys(fumble) {
    const actions = [];
    if (fumble.ticks > 0) actions.push("ticks");
    if (fumble.damagesWeapon && fumble.sourceItemId) actions.push("weapon");
    if (fumble.damage > 0) actions.push("damage");
    if (fumble.conditionMode === "choose") {
        fumble.conditions.forEach((_condition, index) => actions.push(`condition:${index}`));
    } else if (fumble.conditions.length > 0) {
        actions.push("conditions");
    }
    return actions;
}

export function hasPendingFumbleActions(message) {
    const fumble = getFumbleData(message) ?? createFumbleData(message);
    if (!fumble) return false;
    return getFumbleActionKeys(fumble).some((action) =>
        getFumbleActionApplicationState(fumble, action) !== "completed"
    );
}

function fumbleActionButtonMarkup(fumble, action) {
    if (action === "ticks") return `<button type="button" data-sf-fumble-action="ticks"><i class="fa-solid fa-stopwatch"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumbleTicks", { ticks: fumble.ticks }))}</button>`;
    if (action === "weapon") return `<button type="button" data-sf-fumble-action="weapon"><i class="fa-solid fa-hammer"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumbleWeaponDamage"))}</button>`;
    if (action === "damage") return `<button type="button" data-sf-fumble-action="damage"><i class="fa-solid fa-heart-crack"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumbleDamage", { damage: fumble.damage }))}</button>`;
    if (action === "conditions") {
        const names = fumble.conditions.map((condition) => `${condition.name} ${condition.level}`).join(", ");
        return `<button type="button" data-sf-fumble-action="conditions" title="${escapeAttr(names)}"><i class="fa-solid fa-person-burst"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumbleConditions", { count: fumble.conditions.length }))}</button>`;
    }
    const index = Number.parseInt(action.split(":")[1], 10);
    const condition = fumble.conditions[index];
    if (!condition) return "";
    return `<button type="button" data-sf-fumble-action="${escapeAttr(action)}"><i class="fa-solid fa-person-burst"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumbleCondition", { condition: `${condition.name} ${condition.level}` }))}</button>`;
}

export function bindFumbleActions(message, html) {
    applyFumbleActionState(message, html);
    for (const button of html.querySelectorAll("[data-sf-fumble-recovery]")) {
        if (button.dataset.smootherFightBound) continue;
        button.dataset.smootherFightBound = "true";
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            try {
                await recoverFumbleAction(message, button.dataset.sfFumbleKind, button.dataset.sfFumbleRecovery);
            } catch (error) {
                console.error(`${MODULE_ID} | Fumble recovery failed`, error);
                ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
            }
        });
    }
    for (const button of html.querySelectorAll("[data-sf-fumble-action]")) {
        if (button.dataset.smootherFightBound) continue;
        button.dataset.smootherFightBound = "true";
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            try {
                await handleFumbleAction(message, button.dataset.sfFumbleAction);
            } catch (error) {
                console.error(`${MODULE_ID} | Fumble action failed`, error);
            }
        });
    }
}

export function enforceFumbleActionState(root) {
    for (const element of root.querySelectorAll(".sf-chat-message")) {
        const message = game.messages.get(element.dataset.messageId);
        if (message) applyFumbleActionState(message, element);
    }
}

function applyFumbleActionState(message, root) {
    const fumble = getFumbleData(message) ?? createFumbleData(message);
    if (!fumble) return;
    const actor = resolveFumbleActor(message, fumble);
    const allowed = Boolean(game.user.isGM || actor?.isOwner);
    root.querySelectorAll(".sf-fumble-recovery-actions").forEach((element) => element.remove());
    if (!allowed) {
        root.querySelectorAll(".sf-fumble-actions").forEach((element) => element.remove());
        return;
    }
    const focused = Boolean(root.closest?.('.sf-event-card[data-sf-flow-focus="true"]'));
    const uncertain = new Set();
    for (const button of root.querySelectorAll("[data-sf-fumble-action]")) {
        const action = button.dataset.sfFumbleAction;
        const definition = fumbleActionDefinition(action);
        const storedState = getFumbleActionApplicationState(fumble, action);
        const state = storedState === "idle" && hasPendingRemoteFumbleAction(message.id, action)
            ? "applying"
            : storedState;
        const blocked = state !== "idle";
        button.disabled = blocked;
        button.classList.toggle("is-applied", state === "completed");
        button.classList.toggle("is-applying", state === "applying");
        button.classList.toggle("is-uncertain", state === "uncertain");
        button.classList.toggle("is-next-fumble-action", focused && state === "idle");
        button.title = applicationStateTitle(state, operationStateLabels());
        if (state === "applying") scheduleStaleFumbleRender(message, fumble, definition);
        if (state === "uncertain" && definition) uncertain.add(definition.key);
    }
    if (game.user.isGM && uncertain.size > 0) {
        const container = root.querySelector(".sf-fumble-actions");
        for (const key of uncertain) container?.insertAdjacentHTML("beforeend", fumbleRecoveryMarkup(key));
    }
}

export async function handleFumbleAction(message, action) {
    const fumble = getFumbleData(message) ?? createFumbleData(message);
    if (!fumble) return;
    const actor = resolveFumbleActor(message, fumble);
    if (!actor || !canUserApplyFumbleAction(message, fumble, game.user)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.FumbleNotAllowed"));
        return false;
    }
    const definition = fumbleActionDefinition(action);
    if (!definition || getFumbleActionApplicationState(fumble, action) !== "idle") return false;
    if (!game.user.isGM && !canCurrentUserUpdateFumbleMessage(message)) {
        return requestRemoteFumbleAction(message, action);
    }
    return performFumbleAction(message, action, game.user);
}

export async function applyRemoteFumbleAction(message, action, user) {
    const fumble = getFumbleData(message);
    if (!fumble || !canUserApplyFumbleAction(message, fumble, user)) {
        return { applied: false, error: "not-allowed" };
    }
    try {
        const applied = await performFumbleAction(message, action, user);
        return { applied: Boolean(applied), error: applied ? null : "not-applied" };
    } catch (error) {
        console.error(`${MODULE_ID} | Remote fumble action failed`, error);
        return { applied: false, error: "failed" };
    }
}

export function finishRemoteFumbleAction(payload, sender) {
    const request = remoteFumbleActionRequests.get(payload?.requestId);
    if (!request
        || sender?.id !== request.gmId
        || payload?.messageId !== request.messageId
        || payload?.action !== request.action) return false;
    clearTimeout(request.timeoutId);
    remoteFumbleActionRequests.delete(payload.requestId);
    if (payload.error) globalThis.ui?.notifications?.error?.(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
    services.scheduleRender?.(0);
    request.resolve(Boolean(payload.applied));
    return true;
}

async function performFumbleAction(message, action, user) {
    const fumble = getFumbleData(message) ?? createFumbleData(message);
    if (!fumble) return false;
    if (action === "ticks" && services.canAdvanceCombatWorkflowTicks?.(message) === false) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.CombatFlow.TickBlocked"));
        services.scheduleRender?.(0);
        return false;
    }
    const actor = resolveFumbleActor(message, fumble);
    if (!actor || !canUserApplyFumbleAction(message, fumble, user)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.FumbleNotAllowed"));
        return false;
    }
    const definition = fumbleActionDefinition(action);
    if (!definition || getFumbleActionApplicationState(fumble, action) !== "idle") return false;
    const lockKey = message.id;
    if (fumbleActionLocks.has(lockKey)) return false;
    fumbleActionLocks.add(lockKey);
    try {
        return await applyFumbleAction(message, actor, fumble, action, definition);
    } finally {
        fumbleActionLocks.delete(lockKey);
    }
}

async function applyFumbleAction(message, actor, fumble, action, definition) {
    const fumbleLabel = fumble.kind === "fight"
        ? t("SMOOTHER_FIGHT.HUD.CombatFumble")
        : t("SMOOTHER_FIGHT.HUD.MagicFumble");
    const item = action === "weapon" ? actor.items?.get?.(fumble.sourceItemId) : null;
    if (action === "weapon" && (!item || !["weapon", "shield"].includes(item.type))) {
        throw new Error("Fumble weapon could not be resolved");
    }
    const selectedConditions = action.startsWith("condition:")
        ? [fumble.conditions[Number.parseInt(action.split(":")[1], 10)]].filter(Boolean)
        : fumble.conditions;
    const actionable = (action === "ticks" && fumble.ticks > 0)
        || (action === "weapon" && fumble.sourceItemId)
        || (action === "damage" && fumble.damage > 0)
        || ((action === "conditions" || action.startsWith("condition:")) && selectedConditions.length);
    if (!actionable) return false;

    const before = fumbleEffectSnapshot(actor, action, item);
    let updated = await setFumbleActionApplicationState(message, fumble, definition, "applying");
    let notification = null;
    try {
        if (action === "ticks") {
            await actor.addTicks(updated.ticks, updated.tickMessage || fumbleLabel, false);
            notification = t("SMOOTHER_FIGHT.HUD.FumbleTicksApplied", { ticks: updated.ticks, name: actor.name });
        }
        if (action === "weapon") {
            await increaseFumbleWeaponDamage(item);
            notification = t("SMOOTHER_FIGHT.HUD.FumbleWeaponDamageApplied", { item: item.name });
        }
        if (action === "damage") {
            await actor.consumeCost("health", fullyConsumedCost(updated.damage), fumbleLabel);
            notification = t("SMOOTHER_FIGHT.HUD.FumbleDamageApplied", { damage: updated.damage, name: actor.name });
        }
        if (action === "conditions" || action.startsWith("condition:")) {
            await applyFumbleConditions(actor, selectedConditions);
            notification = t("SMOOTHER_FIGHT.HUD.FumbleConditionsApplied", { name: actor.name });
        }
    } catch (error) {
        const changed = fumbleEffectChanged(actor, action, item, before);
        await persistFumbleFailureState(message, updated, definition, changed === false ? "idle" : "uncertain");
        throw error;
    }
    try {
        updated = await setFumbleActionApplicationState(message, updated, definition, "completed");
    } catch (error) {
        await persistFumbleFailureState(message, updated, definition, "uncertain");
        throw error;
    }
    if (notification) ui.notifications.info(notification);
    services.scheduleRender(0);
    return true;
}

function requestRemoteFumbleAction(message, action) {
    if (hasPendingRemoteFumbleAction(message.id)) return false;
    const user = globalThis.game?.user;
    const gm = services.getActivePrimaryGm?.();
    if (!user || !gm) {
        globalThis.ui?.notifications?.warn?.(localizeSystem("splittermond.chatCard.noGMConnected", "Kein GM verbunden."));
        return false;
    }
    const requestId = globalThis.foundry?.utils?.randomID?.() ?? `${user.id}:${message.id}:${Date.now()}`;
    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            remoteFumbleActionRequests.delete(requestId);
            globalThis.ui?.notifications?.error?.(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
            services.scheduleRender?.(0);
            resolve(false);
        }, REMOTE_FUMBLE_ACTION_TIMEOUT_MS);
        timeoutId?.unref?.();
        remoteFumbleActionRequests.set(requestId, {
            action,
            gmId: gm.id,
            messageId: message.id,
            resolve,
            timeoutId,
        });
        services.scheduleRender?.(0);
        globalThis.game?.socket?.emit?.(SOCKET, {
            type: "fumble-action-request",
            senderId: user.id,
            recipientId: gm.id,
            requestId,
            messageId: message.id,
            action,
        });
    });
}

function hasPendingRemoteFumbleAction(messageId, action = null) {
    return Array.from(remoteFumbleActionRequests.values()).some((request) => (
        request.messageId === messageId && (!action || request.action === action)
    ));
}

function canCurrentUserUpdateFumbleMessage(message) {
    const user = globalThis.game?.user;
    if (user?.isGM) return true;
    if (typeof message?.testUserPermission === "function") return message.testUserPermission(user, "OWNER");
    return Boolean(message?.isOwner);
}

function canUserApplyFumbleAction(message, fumble, user) {
    const actor = resolveFumbleActor(message, fumble);
    if (!actor || !user) return false;
    if (user.isGM) return true;
    if (typeof actor.testUserPermission === "function") return actor.testUserPermission(user, "OWNER");
    return Boolean(user.id === globalThis.game?.user?.id && actor.isOwner);
}

function fumbleActionDefinition(action) {
    if (action === "ticks") return { key: "ticks", applied: "ticksApplied", started: "ticksApplicationStarted" };
    if (action === "weapon") return { key: "weapon", applied: "weaponDamageApplied", started: "weaponDamageApplicationStarted" };
    if (action === "damage") return { key: "damage", applied: "damageApplied", started: "damageApplicationStarted" };
    if (action === "conditions" || String(action).startsWith("condition:")) {
        return { key: "conditions", applied: "conditionsApplied", started: "conditionsApplicationStarted" };
    }
    return null;
}

export function getFumbleActionApplicationState(fumbleOrMessage, action, now = Date.now()) {
    const fumble = getFumbleData(fumbleOrMessage) ?? fumbleOrMessage;
    const definition = fumbleActionDefinition(action);
    if (!fumble || !definition) return "idle";
    return effectiveApplicationState(fumble.applications?.[definition.key], {
        legacyCompleted: Boolean(fumble[definition.applied]),
        legacyStarted: Boolean(fumble[definition.started]),
        now,
    });
}

export async function recoverFumbleAction(message, action, decision) {
    if (!game.user?.isGM || !["retry", "complete"].includes(decision)) return false;
    const fumble = getFumbleData(message);
    const definition = fumbleActionDefinition(action);
    if (!fumble || !definition || getFumbleActionApplicationState(fumble, action) !== "uncertain") return false;
    const state = decision === "complete" ? "completed" : "idle";
    await setFumbleActionApplicationState(message, fumble, definition, state, { recoveredBy: game.user.id });
    ui.notifications.info(t(decision === "complete"
        ? "SMOOTHER_FIGHT.HUD.OperationMarkedCompleted"
        : "SMOOTHER_FIGHT.HUD.OperationReset"));
    services.scheduleRender(0);
    return true;
}

async function setFumbleActionApplicationState(message, fumble, definition, state, details = {}) {
    const updated = {
        ...fumble,
        applications: {
            ...(fumble.applications ?? {}),
            [definition.key]: nextApplicationRecord(fumble.applications?.[definition.key], state, details),
        },
        [definition.started]: state !== "idle",
        [definition.applied]: state === "completed",
    };
    await services.setRequiredFlag(message, "fumble", updated);
    if (state !== "applying") clearStaleFumbleRender(`${message.id}:${definition.key}`);
    return updated;
}

async function persistFumbleFailureState(message, fumble, definition, state) {
    try {
        await setFumbleActionApplicationState(message, fumble, definition, state);
    } catch (error) {
        console.error(`${MODULE_ID} | Could not persist ${state} fumble application state`, error);
    }
}

function fumbleEffectSnapshot(actor, action, item) {
    if (action === "damage") return healthCostTotal(actor.system?.health);
    if (action === "weapon") return getWeaponDamageSnapshot(item);
    if (action === "conditions" || action.startsWith("condition:")) {
        return Array.from(actor.items ?? [])
            .filter((candidate) => candidate.type === "statuseffect")
            .map((candidate) => [candidate.id ?? candidate.uuid ?? candidate.name, candidate.name, numericValue(candidate.system?.level)])
            .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    }
    const initiatives = Array.from(getApplicableCombat()?.combatants ?? [])
        .filter((combatant) => combatant.actorId === actor.id || combatant.actor?.uuid === actor.uuid)
        .map((combatant) => [combatant.id, Number(combatant.initiative)]);
    return initiatives.length > 0 ? initiatives : null;
}

function fumbleEffectChanged(actor, action, item, before) {
    const after = fumbleEffectSnapshot(actor, action, item);
    if (before === null || after === null) return null;
    return JSON.stringify(after) !== JSON.stringify(before);
}

function operationStateLabels() {
    return {
        completed: t("SMOOTHER_FIGHT.HUD.AlreadyApplied"),
        applying: t("SMOOTHER_FIGHT.HUD.OperationApplying"),
        uncertain: t("SMOOTHER_FIGHT.HUD.OperationUncertain"),
    };
}

function fumbleRecoveryMarkup(key) {
    return `<div class="sf-operation-recovery-actions sf-fumble-recovery-actions">
        <span><i class="fa-solid fa-triangle-exclamation"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.OperationUncertain"))}</span>
        <button type="button" data-sf-fumble-recovery="retry" data-sf-fumble-kind="${escapeAttr(key)}"><i class="fa-solid fa-rotate-left"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.RetryOperation"))}</button>
        <button type="button" data-sf-fumble-recovery="complete" data-sf-fumble-kind="${escapeAttr(key)}"><i class="fa-solid fa-check"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.MarkOperationCompleted"))}</button>
    </div>`;
}

function scheduleStaleFumbleRender(message, fumble, definition) {
    const startedAt = Number(fumble.applications?.[definition?.key]?.startedAt);
    if (!definition || !Number.isFinite(startedAt)) return;
    const remaining = APPLICATION_STALE_AFTER_MS - (Date.now() - startedAt);
    if (remaining <= 0) return;
    const key = `${message.id}:${definition.key}`;
    if (staleFumbleActionTimers.has(key)) return;
    const timer = setTimeout(() => {
        staleFumbleActionTimers.delete(key);
        services.scheduleRender(0);
    }, remaining);
    timer.unref?.();
    staleFumbleActionTimers.set(key, timer);
}

function clearStaleFumbleRender(key) {
    const timer = staleFumbleActionTimers.get(key);
    if (timer) clearTimeout(timer);
    staleFumbleActionTimers.delete(key);
}

function resolveFumbleActor(message, fumble) {
    if (fumble.actorUuid) {
        try {
            const actor = globalThis.fromUuidSync?.(fumble.actorUuid);
            if (actor) return actor;
        } catch (error) {
            console.debug(`${MODULE_ID} | Could not resolve fumble actor ${fumble.actorUuid}`, error);
        }
    }
    return services.resolveSpeakerActor(message);
}

export function getFumbleData(message) {
    return message?.getFlag?.(MODULE_ID, "fumble") ?? message?.flags?.[MODULE_ID]?.fumble ?? null;
}

export function isFumbleTableMessage(message) {
    const content = String(message?.content ?? "");
    return content.includes("fumble-table-result");
}

function fumbleTableKind(message) {
    if (!isFumbleTableMessage(message)) return null;
    const content = String(message?.content ?? "");
    const attackLabel = localizeSystem("splittermond.attackFumble", "Kampfpatzer");
    if (content.includes(attackLabel)) return "fight";
    const formula = String(message?.rolls?.[0]?.formula ?? "");
    const labels = [
        localizeSystem("splittermond.magicFumbleSorcerer", "Zauberpatzer (Zauberer)"),
        localizeSystem("splittermond.magicFumblePriest", "Zauberpatzer (Priester)"),
        localizeSystem("splittermond.focusCosts", "Fokuskosten"),
    ];
    return labels.some((label) => content.includes(label) || formula.includes(label)) ? "magic" : "fight";
}
