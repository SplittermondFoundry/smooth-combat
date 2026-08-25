import { hudState } from "./state.js";
import { services } from "../../core/services.js";

import {
    attackControlState,
} from "../../combat-rules.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    displayLabel,
    displayValue,
    escapeAttr,
    escapeHtml,
    t,
} from "../../shared/values.js";

export function spellFocusCosts(spell) {
    return displayLabel(spell?.costs ?? spell?.system?.costs, "–");
}

export function resolveActionItem(actor, element) {
    const spellId = element?.dataset?.spellId;
    if (spellId) {
        return actor?.spells?.find((spell) => spell.id === spellId)
            ?? actor?.items?.get?.(spellId)
            ?? null;
    }

    const attackId = element?.dataset?.attackId;
    if (attackId) {
        const attack = actor?.attacks?.find((candidate) => candidate.id === attackId);
        return attack?.item ?? actor?.items?.get?.(attackId) ?? null;
    }

    const itemId = element?.dataset?.itemId;
    return itemId ? actor?.items?.get?.(itemId) ?? null : null;
}

export function buildAttackTooltipModel(actor, attack, speed, isRanged = false, missingValue = "–") {
    const skillLabel = displayLabel(attack?.skill?.label, attack?.skill?.id);
    const skillValue = displayValue(attack?.skill?.value, "");
    const attackIds = Array.from(actor?.attacks ?? [], (candidate) => candidate.id);
    const defaultAttackId = attackControlState(
        attackIds,
        actor?.getFlag?.(MODULE_ID, "defaultAttackId"),
    ).defaultAttackId;
    const statuses = [];
    if (attack?.id === defaultAttackId) statuses.push(t("SMOOTHER_FIGHT.HUD.DefaultAttack"));
    if (isRanged && actor?.getFlag?.("splittermond", "preparedAttack") === attack?.id) {
        statuses.push(t("SMOOTHER_FIGHT.HUD.PreparedAttack"));
    }

    const range = isRanged ? displayValue(attack?.range, "") : "";
    return {
        name: displayLabel(attack?.name, attack?.id),
        img: attack?.img ?? "icons/svg/sword.svg",
        skill: [skillLabel, skillValue].filter((value) => value !== "").join(" "),
        speed: displayValue(speed, missingValue),
        damage: displayValue(attack?.damage, missingValue),
        features: attackFeaturesText(attack),
        range: range === "" ? "" : t("SMOOTHER_FIGHT.HUD.AttackRangeValue", { range }),
        statuses,
    };
}

export function buildEquipmentTooltipModel(actor, item, attack = null, speed = "", isRanged = null) {
    const sourceAttack = attack ?? attackFromEquipment(actor, item);
    const model = buildAttackTooltipModel(
        actor,
        sourceAttack,
        attack ? speed : sourceAttack.weaponSpeed,
        isRanged ?? services.isRangedAttack(sourceAttack),
        "",
    );
    model.name = displayLabel(item?.name, model.name);
    model.img = item?.img ?? model.img;
    model.statuses.unshift(t(item?.system?.equipped
        ? "SMOOTHER_FIGHT.HUD.EquippedStatus"
        : "SMOOTHER_FIGHT.HUD.UnequippedStatus"));
    return model;
}

export function bindActionTooltips(root, context) {
    for (const button of root.querySelectorAll("[data-spell-id]")) {
        const spell = resolveActionItem(context.actor, button);
        if (spell) bindTooltipEvents(button, () => showSpellTooltip(button, spell));
    }

    for (const button of root.querySelectorAll('[data-sf-action="attack"][data-attack-id]')) {
        const attack = context.actor?.attacks?.find((candidate) => candidate.id === button.dataset.attackId);
        if (attack) bindTooltipEvents(button, () => showAttackTooltip(button, context.actor, attack));
    }

    for (const button of root.querySelectorAll('[data-sf-action="toggle-equipped"][data-item-id]')) {
        const item = resolveActionItem(context.actor, button);
        if (item) bindTooltipEvents(button, () => showEquipmentTooltip(button, context.actor, item));
    }
}

function bindTooltipEvents(button, show) {
    button.addEventListener("mouseenter", show);
    button.addEventListener("mouseleave", () => clearActionTooltip(button));
    button.addEventListener("focus", show);
    button.addEventListener("blur", () => clearActionTooltip(button));
}

function showSpellTooltip(anchor, spell) {
    if (hudState.actionTooltip?.anchor === anchor) return;
    clearActionTooltip();

    const description = itemPlainText(spell.description ?? spell.system?.description);
    const enhancement = itemPlainText(spell.enhancementDescription ?? spell.system?.enhancementDescription);
    const enhancementCosts = displayLabel(spell.enhancementCosts ?? spell.system?.enhancementCosts, "–");
    showActionTooltip(anchor, "spell", `
        <header>
            <img src="${escapeAttr(spell.img ?? "icons/svg/book.svg")}" alt="">
            <span><strong>${escapeHtml(spell.name)}</strong><small>${escapeHtml(t("SMOOTHER_FIGHT.HUD.FocusCosts", { costs: spellFocusCosts(spell) }))}</small></span>
        </header>
        <section>
            <h4>${escapeHtml(t("SMOOTHER_FIGHT.HUD.SpellDescription"))}</h4>
            <p>${escapeHtml(description || t("SMOOTHER_FIGHT.HUD.NoSpellDescription"))}</p>
        </section>
        <section>
            <h4>${escapeHtml(t("SMOOTHER_FIGHT.HUD.SpellEnhancement"))}<span>${escapeHtml(enhancementCosts)}</span></h4>
            <p>${escapeHtml(enhancement || t("SMOOTHER_FIGHT.HUD.NoSpellEnhancement"))}</p>
        </section>
        ${tooltipFooter()}
    `);
}

async function showAttackTooltip(anchor, actor, attack) {
    await showAttackLikeTooltip(anchor, async () => buildAttackTooltipModel(
        actor,
        attack,
        await services.getAttackSpeed(attack),
        services.isRangedAttack(attack),
    ));
}

async function showEquipmentTooltip(anchor, actor, item) {
    const attack = liveEquipmentAttack(actor, item);
    await showAttackLikeTooltip(anchor, async () => buildEquipmentTooltipModel(
        actor,
        item,
        attack,
        attack ? await services.getAttackSpeed(attack) : "",
        attack ? services.isRangedAttack(attack) : null,
    ));
}

async function showAttackLikeTooltip(anchor, buildModel) {
    if (hudState.actionTooltip?.anchor === anchor || hudState.actionTooltipRequest?.anchor === anchor) return;
    clearActionTooltip();

    const request = { anchor, token: Symbol("attack-tooltip") };
    hudState.actionTooltipRequest = request;
    const model = await buildModel();
    if (hudState.actionTooltipRequest?.token !== request.token) return;
    hudState.actionTooltipRequest = null;
    renderAttackTooltip(anchor, model);
}

function renderAttackTooltip(anchor, model) {
    const rows = [
        [t("SMOOTHER_FIGHT.HUD.AttackWeaponSpeed"), model.speed],
        [t("SMOOTHER_FIGHT.HUD.AttackDamage"), model.damage],
        [t("SMOOTHER_FIGHT.HUD.AttackFeatures"), model.features],
        [t("SMOOTHER_FIGHT.HUD.AttackRange"), model.range],
        [t("SMOOTHER_FIGHT.HUD.AttackStatus"), model.statuses.join(" · ")],
    ].filter(([, value]) => value !== "");
    showActionTooltip(anchor, "attack", `
        <header>
            <img src="${escapeAttr(model.img)}" alt="">
            <span><strong>${escapeHtml(model.name)}</strong><small>${escapeHtml(model.skill)}</small></span>
        </header>
        <dl class="sf-attack-tooltip-stats">
            ${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
        </dl>
        ${tooltipFooter()}
    `);
}

function showActionTooltip(anchor, kind, markup) {
    const tooltip = document.createElement("aside");
    tooltip.id = `${MODULE_ID}-action-tooltip`;
    tooltip.className = `sf-action-tooltip is-${kind}`;
    tooltip.setAttribute("role", "tooltip");
    tooltip.innerHTML = markup;
    document.body.append(tooltip);
    anchor.setAttribute("aria-describedby", tooltip.id);
    hudState.actionTooltip = { anchor, element: tooltip };
    positionTooltip(anchor, tooltip);
}

function positionTooltip(anchor, tooltip) {
    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const gap = 10;
    const viewportGap = 8;
    let left = anchorRect.right + gap;
    if (left + tooltipRect.width > window.innerWidth - viewportGap) {
        left = anchorRect.left - tooltipRect.width - gap;
    }
    left = Math.max(viewportGap, Math.min(left, window.innerWidth - tooltipRect.width - viewportGap));
    const top = Math.max(
        viewportGap,
        Math.min(anchorRect.top, window.innerHeight - tooltipRect.height - viewportGap),
    );
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
    tooltip.classList.add("is-visible");
}

export function clearActionTooltip(anchor = null) {
    const request = hudState.actionTooltipRequest;
    if (request && (!anchor || request.anchor === anchor)) hudState.actionTooltipRequest = null;

    const state = hudState.actionTooltip;
    if (!state || (anchor && state.anchor !== anchor)) return;
    hudState.actionTooltip = null;
    state.anchor?.removeAttribute?.("aria-describedby");
    state.element?.remove?.();
}

function tooltipFooter() {
    return `<footer><i class="fa-solid fa-arrow-pointer"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.OpenItemHint"))}</footer>`;
}

function attackFeaturesText(attack) {
    const direct = displayFeatureValue(attack?.features);
    if (direct) return direct;
    const referenced = displayFeatureValue(attack?.featuresAsRef);
    if (referenced) return referenced;
    return displayFeatureValue(attack?.item?.system?.features);
}

function liveEquipmentAttack(actor, item) {
    const attacks = Array.from(actor?.attacks ?? []);
    return attacks.find((attack) => attack.id === item?.id)
        ?? attacks.find((attack) => attack.item?.id === item?.id && !attack.isSecondaryAttack)
        ?? attacks.find((attack) => attack.item?.id === item?.id)
        ?? null;
}

function attackFromEquipment(actor, item) {
    const rawSkill = item?.system?.skill;
    const skillId = typeof rawSkill === "string" ? rawSkill : rawSkill?.id;
    const actorSkill = actor?.skills?.get?.(skillId) ?? actor?.skills?.[skillId];
    return {
        id: item?.id,
        name: item?.name,
        img: item?.img,
        item,
        skill: actorSkill ?? {
            id: skillId,
            label: skillId ? `splittermond.skillLabel.${skillId}` : "",
            value: "",
        },
        weaponSpeed: item?.system?.weaponSpeed,
        damage: item?.system?.damage,
        features: item?.system?.features,
        range: item?.system?.range,
    };
}

function displayFeatureValue(value) {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) return value.map((entry) => displayLabel(entry)).filter(Boolean).join(", ");
    if (typeof value.features === "string") return value.features.trim();
    if (typeof value.featuresAsStringList === "function") {
        try {
            return value.featuresAsStringList().map((entry) => displayLabel(entry)).filter(Boolean).join(", ");
        } catch {
            return "";
        }
    }
    return "";
}

function itemPlainText(value) {
    const source = String(value ?? "").trim();
    if (!source) return "";
    const template = document.createElement("template");
    template.innerHTML = source
        .replace(/<br\s*\/?\s*>/giu, "\n")
        .replace(/<\/(?:p|div|li|h[1-6])>/giu, "\n");
    return String(template.content.textContent ?? "")
        .replace(/\u00a0/gu, " ")
        .replace(/[ \t]+\n/gu, "\n")
        .replace(/\n[ \t]+/gu, "\n")
        .replace(/\n{3,}/gu, "\n\n")
        .replace(/[ \t]{2,}/gu, " ")
        .trim();
}
