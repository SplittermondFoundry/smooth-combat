import { services } from "../../core/services.js";

import {
    fullyConsumedCost,
    healthCostTotal,
    isOffensiveCombatMessage,
    parseStatusEffectLabel,
} from "../../combat-rules.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    APPLICATION_STALE_AFTER_MS,
    applicationStateTitle,
    effectiveApplicationState,
    nextApplicationRecord,
} from "../../shared/application-state.js";

import {
    cloneData,
    escapeAttr,
    escapeHtml,
    localizeSystem,
    numericValue,
    t,
} from "../../shared/values.js";

const fumbleActionLocks = new Set();
const staleFumbleActionTimers = new Map();

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

function extractFumbleEffects(contentOrRoot) {
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
        conditions.push({ uuid: uuid || null, name: parsed.name, level: parsed.level });
    }
    const activeText = String(active.textContent ?? "");
    const damagesWeapon = /\b(?:beschädigte\s+Waffe|damaged\s+weapon)\b/iu.test(activeText);
    if (/\b(?:liegend|prone)\b/iu.test(activeText)
        && !conditions.some((condition) => /^(?:liegend|prone)$/iu.test(condition.name))) {
        conditions.push({
            uuid: null,
            name: String(game.i18n.lang ?? "").toLocaleLowerCase().startsWith("de") ? "Liegend" : "Prone",
            level: 1,
        });
    }
    const conditionMode = /\b(?:oder|or)\b/iu.test(active.textContent ?? "") ? "choose" : "all";
    return { damage, ticks, tickMessage, damagesWeapon, conditions, conditionMode };
}

export function decorateFumbleCard(content, fumble) {
    if (String(content).includes("sf-fumble-actions")) return content;
    const template = document.createElement("template");
    template.innerHTML = content ?? "";
    const table = template.content.querySelector(".fumble-table-result");
    if (!table) return content;
    const conditionNames = fumble.conditions.map((condition) => `${condition.name} ${condition.level}`).join(", ");
    const conditionActions = fumble.conditionMode === "choose"
        ? fumble.conditions.map((condition, index) => `<button type="button" data-sf-fumble-action="condition:${index}"><i class="fa-solid fa-person-burst"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumbleCondition", { condition: `${condition.name} ${condition.level}` }))}</button>`).join("")
        : fumble.conditions.length
            ? `<button type="button" data-sf-fumble-action="conditions" title="${escapeAttr(conditionNames)}"><i class="fa-solid fa-person-burst"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumbleConditions", { count: fumble.conditions.length }))}</button>`
            : "";
    const actions = `<div class="sf-fumble-actions">
        <strong><i class="fa-solid fa-burst"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumble"))}</strong>
        ${fumble.ticks ? `<button type="button" data-sf-fumble-action="ticks"><i class="fa-solid fa-stopwatch"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumbleTicks", { ticks: fumble.ticks }))}</button>` : ""}
        ${fumble.damagesWeapon && fumble.sourceItemId ? `<button type="button" data-sf-fumble-action="weapon"><i class="fa-solid fa-hammer"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumbleWeaponDamage"))}</button>` : ""}
        ${fumble.damage ? `<button type="button" data-sf-fumble-action="damage"><i class="fa-solid fa-heart-crack"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumbleDamage", { damage: fumble.damage }))}</button>` : ""}
        ${conditionActions}
    </div>`;
    table.insertAdjacentHTML("afterend", actions);
    const wrapper = document.createElement("div");
    wrapper.append(template.content.cloneNode(true));
    return wrapper.innerHTML;
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
    const uncertain = new Set();
    for (const button of root.querySelectorAll("[data-sf-fumble-action]")) {
        const action = button.dataset.sfFumbleAction;
        const definition = fumbleActionDefinition(action);
        const state = getFumbleActionApplicationState(fumble, action);
        const blocked = state !== "idle";
        button.disabled = blocked || !allowed;
        button.classList.toggle("is-applied", state === "completed");
        button.classList.toggle("is-applying", state === "applying");
        button.classList.toggle("is-uncertain", state === "uncertain");
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
    if (!actor || !(game.user.isGM || actor.isOwner)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.FumbleNotAllowed"));
        return;
    }
    const definition = fumbleActionDefinition(action);
    if (!definition || getFumbleActionApplicationState(fumble, action) !== "idle") return;
    const lockKey = message.id;
    if (fumbleActionLocks.has(lockKey)) return;
    fumbleActionLocks.add(lockKey);
    try {
        await applyFumbleAction(message, actor, fumble, action, definition);
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
    if (!actionable) return;

    const before = fumbleEffectSnapshot(actor, action, item);
    let updated = await setFumbleActionApplicationState(message, fumble, definition, "applying");
    let notification = null;
    try {
        if (action === "ticks") {
            await actor.addTicks(updated.ticks, updated.tickMessage || fumbleLabel, false);
            notification = t("SMOOTHER_FIGHT.HUD.FumbleTicksApplied", { ticks: updated.ticks, name: actor.name });
        }
        if (action === "weapon") {
            const currentDamageLevel = Math.max(0, numericValue(item.system?.damageLevel));
            const nextDamageLevel = Math.min(2, currentDamageLevel + 1);
            await item.update({ "system.damageLevel": nextDamageLevel });
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
    if (action === "weapon") return numericValue(item?.system?.damageLevel);
    if (action === "conditions" || action.startsWith("condition:")) {
        return Array.from(actor.items ?? [])
            .filter((candidate) => candidate.type === "statuseffect")
            .map((candidate) => [candidate.id ?? candidate.uuid ?? candidate.name, candidate.name, numericValue(candidate.system?.level)])
            .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    }
    const initiatives = Array.from(game.combat?.combatants ?? [])
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

async function applyFumbleConditions(actor, conditions) {
    for (const condition of conditions) {
        const existing = Array.from(actor.items ?? []).find((item) =>
            item.type === "statuseffect" && item.name.localeCompare(condition.name, game.i18n.lang, { sensitivity: "base" }) === 0
        );
        if (existing) {
            const current = Math.max(0, numericValue(existing.system?.level));
            await existing.update({ "system.level": current + condition.level });
            continue;
        }
        const sourceItem = await resolveStatusEffectSource(condition);
        if (!sourceItem) throw new Error(`Status effect not found: ${condition.name}`);
        const source = cloneData(sourceItem.toObject());
        delete source._id;
        source.system ??= {};
        source.system.level = condition.level;
        await actor.createEmbeddedDocuments("Item", [source]);
    }
}

async function resolveStatusEffectSource(condition) {
    if (condition.uuid) {
        let item = null;
        try {
            item = globalThis.fromUuidSync?.(condition.uuid) ?? await globalThis.fromUuid?.(condition.uuid);
        } catch (error) {
            console.debug(`${MODULE_ID} | Could not resolve ${condition.uuid} synchronously`, error);
            item = await globalThis.fromUuid?.(condition.uuid);
        }
        if (item) return item;
    }
    const pack = game.packs.get("splittermond.statuseffects");
    if (!pack) return null;
    const index = await pack.getIndex({ fields: ["name"] });
    const entry = index.find((candidate) => candidate.name.localeCompare(condition.name, game.i18n.lang, { sensitivity: "base" }) === 0);
    return entry ? pack.getDocument(entry._id) : null;
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
