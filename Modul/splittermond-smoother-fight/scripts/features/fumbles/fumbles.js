import { services } from "../../core/services.js";

import {
    fullyConsumedCost,
    isOffensiveCombatMessage,
    parseStatusEffectLabel,
} from "../../combat-rules.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    cloneData,
    escapeAttr,
    escapeHtml,
    localizeSystem,
    numericValue,
    t,
} from "../../shared/values.js";

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
    await message.update({ content, [`flags.${MODULE_ID}.fumble`]: fumble });
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
        ticksApplied: false,
        weaponDamageApplied: false,
        conditionsApplied: false,
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
    for (const button of html.querySelectorAll("[data-sf-fumble-action]")) {
        if (button.dataset.smootherFightBound) continue;
        button.dataset.smootherFightBound = "true";
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await handleFumbleAction(message, button.dataset.sfFumbleAction);
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
    for (const button of root.querySelectorAll("[data-sf-fumble-action]")) {
        const action = button.dataset.sfFumbleAction;
        const applied = action === "damage"
            ? fumble.damageApplied
            : action === "ticks"
                ? fumble.ticksApplied
                : action === "weapon"
                    ? fumble.weaponDamageApplied
                : fumble.conditionsApplied;
        button.disabled = applied || !allowed;
        button.classList.toggle("is-applied", Boolean(applied));
        if (applied) button.title = t("SMOOTHER_FIGHT.HUD.AlreadyApplied");
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
    const updated = { ...fumble };
    const fumbleLabel = updated.kind === "fight"
        ? t("SMOOTHER_FIGHT.HUD.CombatFumble")
        : t("SMOOTHER_FIGHT.HUD.MagicFumble");
    if (action === "ticks" && !updated.ticksApplied && updated.ticks > 0) {
        await actor.addTicks(updated.ticks, updated.tickMessage || fumbleLabel, false);
        updated.ticksApplied = true;
        ui.notifications.info(t("SMOOTHER_FIGHT.HUD.FumbleTicksApplied", { ticks: updated.ticks, name: actor.name }));
    }
    if (action === "weapon" && !updated.weaponDamageApplied && updated.sourceItemId) {
        const item = actor.items?.get?.(updated.sourceItemId);
        if (!item || !["weapon", "shield"].includes(item.type)) throw new Error("Fumble weapon could not be resolved");
        const currentDamageLevel = Math.max(0, numericValue(item.system?.damageLevel));
        const nextDamageLevel = Math.min(2, currentDamageLevel + 1);
        await item.update({ "system.damageLevel": nextDamageLevel });
        updated.weaponDamageApplied = true;
        ui.notifications.info(t("SMOOTHER_FIGHT.HUD.FumbleWeaponDamageApplied", { item: item.name }));
    }
    if (action === "damage" && !updated.damageApplied && updated.damage > 0) {
        await actor.consumeCost("health", fullyConsumedCost(updated.damage), fumbleLabel);
        updated.damageApplied = true;
        ui.notifications.info(t("SMOOTHER_FIGHT.HUD.FumbleDamageApplied", { damage: updated.damage, name: actor.name }));
    }
    if ((action === "conditions" || action.startsWith("condition:")) && !updated.conditionsApplied && updated.conditions.length) {
        const selectedConditions = action.startsWith("condition:")
            ? [updated.conditions[Number.parseInt(action.split(":")[1], 10)]].filter(Boolean)
            : updated.conditions;
        await applyFumbleConditions(actor, selectedConditions);
        updated.conditionsApplied = true;
        ui.notifications.info(t("SMOOTHER_FIGHT.HUD.FumbleConditionsApplied", { name: actor.name }));
    }
    await services.safeSetFlag(message, "fumble", updated);
    services.scheduleRender(0);
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
