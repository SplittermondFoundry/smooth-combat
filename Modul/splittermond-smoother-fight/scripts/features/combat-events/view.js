import { combatEventState } from "./state.js";

import { services } from "../../core/services.js";

import {
    parseActiveDefenseDescription,
} from "../../combat-rules.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    escapeAttr,
    escapeHtml,
    t,
} from "../../shared/values.js";

export function buildCombatEvents(context) {
    const groups = services.collectCombatEventGroups(context);
    const title = combatEventState.cardsCollapsed ? t("SMOOTHER_FIGHT.HUD.ExpandCards") : t("SMOOTHER_FIGHT.HUD.CollapseCards");
    const body = !groups.length
        ? `<p class="sf-events-empty">${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoEvents"))}</p>`
        : groups.map((group, index) => buildEventGroup(group, index === groups.length - 1, context)).join("");
    return `<section class="sf-events ${combatEventState.cardsCollapsed ? "is-collapsed" : ""}">
        <button type="button" class="sf-events-heading" data-sf-action="toggle-cards" title="${escapeAttr(title)}">
            <span><i class="fa-solid fa-message"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.CombatEvents"))}</span>
            <i class="fa-solid fa-chevron-down sf-events-chevron"></i>
        </button>
        <div class="sf-event-scroller">${body}</div>
    </section>`;
}

function buildEventGroup(group, isLatest, hudContext) {
    const primary = group.primary;
    const context = services.getMessageContext(primary);
    const recalculated = context?.recalculatedFrom;
    const superseded = context?.supersededBy;
    const defenseAlert = shouldHighlightActiveDefense(group, isLatest, hudContext, context);
    const badge = group.kind === "spell"
        ? `<span class="sf-event-badge is-spell"><i class="fa-solid fa-wand-sparkles"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Spells"))}</span>`
        : recalculated
        ? `<span class="sf-event-badge is-defense"><i class="fa-solid fa-shield-halved"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenseResult"))}</span>`
        : superseded
            ? `<span class="sf-event-badge is-muted">${escapeHtml(t("SMOOTHER_FIGHT.HUD.OriginalAttack"))}</span>`
            : "";
    const defenseBadge = defenseAlert
        ? `<span class="sf-event-badge is-defense-alert"><i class="fa-solid fa-shield-halved"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenseAvailable"))}</span>`
        : "";
    const targetBadge = buildEventTargetBadge(context);
    const belongsToActiveCombatant = messageBelongsToCombatant(primary, hudContext.combatant, context);
    const open = isLatest && belongsToActiveCombatant && !combatEventState.cardsCollapsed ? "open" : "";
    const hasDamage = group.damages.length > 0;
    const eventActorId = primary.speaker?.actor ?? "";
    return `<details class="sf-event-group ${defenseAlert ? "is-defense-alert" : ""}" data-event-id="${escapeAttr(primary.id)}" data-event-combatant-id="${escapeAttr(context?.combatantId ?? "")}" data-event-actor-id="${escapeAttr(eventActorId)}" ${open}>
        <summary><span>${escapeHtml(primary.speaker?.alias ?? primary.author?.name ?? t(group.kind === "spell" ? "SMOOTHER_FIGHT.HUD.Spells" : "SMOOTHER_FIGHT.HUD.Attacks"))}</span>${badge}${defenseBadge}${targetBadge}<i class="fa-solid fa-chevron-down"></i></summary>
        <div class="sf-event-body">
            ${group.defenses.map((message) => buildAssociatedEvent(message, {
                kind: "defense",
                icon: "fa-shield",
                label: `${t("SMOOTHER_FIGHT.HUD.DefenseResult")} · ${message.speaker?.alias ?? message.author?.name ?? "–"}`,
                open: !hasDamage,
            })).join("")}
            ${chatMessageHtml(primary)}
            ${group.damages.map((message, index) => buildAssociatedEvent(message, {
                kind: "damage",
                icon: "fa-droplet",
                label: t("SMOOTHER_FIGHT.HUD.Damage"),
                open: index === group.damages.length - 1,
            })).join("")}
            ${group.fumbles.map((message, index) => buildAssociatedEvent(message, {
                kind: "fumble",
                icon: "fa-burst",
                label: services.getFumbleData(message)?.kind === "fight"
                    ? t("SMOOTHER_FIGHT.HUD.CombatFumble")
                    : t("SMOOTHER_FIGHT.HUD.MagicFumble"),
                open: index === group.fumbles.length - 1,
            })).join("")}
        </div>
    </details>`;
}

function buildAssociatedEvent(message, { kind, icon, label, open = false }) {
    return `<details class="sf-associated-card is-${escapeAttr(kind)}" data-subevent-id="${escapeAttr(message.id)}" data-subevent-kind="${escapeAttr(kind)}" data-subevent-actor-id="${escapeAttr(message.speaker?.actor ?? "")}" ${open ? "open" : ""}>
        <summary><span><i class="fa-solid ${escapeAttr(icon)}"></i>${escapeHtml(label)}</span><i class="fa-solid fa-chevron-down"></i></summary>
        <div class="sf-associated-body">${chatMessageHtml(message)}</div>
    </details>`;
}

function buildEventTargetBadge(context) {
    const targetName = getMessageTargetName(context);
    if (!targetName) return "";
    const label = t("SMOOTHER_FIGHT.HUD.EventPrimaryTarget", { target: targetName });
    return `<span class="sf-event-target" title="${escapeAttr(label)}"><i class="fa-solid fa-crosshairs"></i>${escapeHtml(label)}</span>`;
}

function getMessageTargetName(context) {
    const target = services.resolveMessageTarget(context);
    return context?.primaryTargetName
        ?? context?.targetName
        ?? target?.token?.name
        ?? target?.actor?.name
        ?? context?.targetNames?.at?.(-1)
        ?? "";
}

function primaryTargetTokenUuid(context) {
    return context?.primaryTargetTokenUuid ?? context?.targetTokenUuid ?? null;
}

function shouldHighlightActiveDefense(group, isLatest, hudContext, messageContext) {
    if (group.damages.length > 0) return false;
    if (!messageOffersActiveDefense(group.primary) && !messageContext?.recalculatedFrom) return false;
    if (messageContext?.supersededBy) return false;
    const storedTarget = services.resolveToken(primaryTargetTokenUuid(messageContext));
    if (storedTarget) {
        const alreadyDefended = messageContext?.attemptedDefenseActorUuids?.includes?.(storedTarget.actor?.uuid);
        return !alreadyDefended && services.isCurrentUserTarget(storedTarget);
    }
    return Boolean(isLatest && services.isCurrentUserTarget(hudContext?.target));
}

export function hasPendingActiveDefense(context) {
    const groups = services.collectCombatEventGroups(context);
    const latest = groups.at(-1);
    if (!latest) return false;
    return shouldHighlightActiveDefense(latest, true, context, services.getMessageContext(latest.primary));
}

export function messageOffersActiveDefense(message) {
    return /data-local-?action\s*=\s*["']activeDefense["']/iu.test(String(message?.content ?? ""));
}

export function messageBelongsToCombatant(message, combatant, messageContext = services.getMessageContext(message)) {
    if (!message || !combatant) return false;
    if (messageContext?.combatantId) return messageContext.combatantId === combatant.id;
    if (message.speaker?.token && combatant.tokenId) return message.speaker.token === combatant.tokenId;
    return Boolean(message.speaker?.actor && message.speaker.actor === combatant.actorId);
}

function chatMessageHtml(message) {
    let content = message.content ?? "";
    if (services.isFumbleTableMessage(message)) {
        const fumble = services.getFumbleData(message) ?? services.createFumbleData(message, content);
        if (fumble) content = services.decorateFumbleCard(content, fumble);
    }
    content = promoteChatCardActions(content, message);
    content = scopeChatCardIds(content, message.id);
    return `<article class="sf-chat-message message" data-message-id="${escapeAttr(message.id)}"><div class="message-content">${content}</div></article>`;
}

function promoteChatCardActions(content, message) {
    const template = document.createElement("template");
    template.innerHTML = content ?? "";
    arrangeCheckResults(template.content, message);
    for (const actions of template.content.querySelectorAll(".splittermond.check > .actions, .actions.splittermond-chat-action-container")) {
        const precedingOptions = actions.previousElementSibling;
        const degreeOptions = precedingOptions?.matches(".splittermond-chat-action-container.chat-card-segment")
            && precedingOptions.querySelector(".splittermond-chat-action")
            ? precedingOptions
            : null;
        const promotedControls = document.createElement("div");
        promotedControls.className = "sf-promoted-controls";
        actions.classList.add("sf-promoted-actions");
        const card = actions.parentElement;
        const header = card?.querySelector(":scope > .chat-message-header");
        if (header) header.after(promotedControls);
        else card?.prepend(promotedControls);
        promotedControls.append(actions);
        if (degreeOptions) {
            degreeOptions.classList.add("sf-promoted-degree-options");
            promotedControls.append(degreeOptions);
        }
    }
    const wrapper = document.createElement("div");
    wrapper.append(template.content.cloneNode(true));
    return wrapper.innerHTML;
}

function arrangeCheckResults(root, message) {
    arrangeDamageResult(root, message);
    const recalculated = root.querySelector(".sf-chat-recalculated");
    const defenseMessage = services.isDefenseMessage(message);
    for (const card of root.querySelectorAll(".splittermond.check")) {
        const roll = card.querySelector(":scope > .roll-summary");
        const degrees = card.querySelector(":scope > .degree-of-success");
        if (!roll || !degrees || roll.closest(".sf-check-result-grid")) continue;
        if (card.matches(".attack, .spell")) {
            card.classList.add("sf-offense-check");
            addOffenseTarget(card, message);
            makeRollCollapsible(roll);
        } else if (defenseMessage) {
            card.classList.add("sf-defense-check");
            makeRollCollapsible(roll);
        }
        const summary = document.createElement("div");
        summary.className = "sf-check-result-grid";
        roll.dataset.sfLabel = t("SMOOTHER_FIGHT.HUD.RollResult");
        degrees.dataset.sfLabel = t("SMOOTHER_FIGHT.HUD.DegreesOfSuccess");
        roll.before(summary);
        summary.append(roll, degrees);
        if (defenseMessage) {
            const defenseValue = card.querySelector(":scope > .degree-of-success-description");
            if (defenseValue) {
                const defenseBadge = decorateDefenseValue(defenseValue, message, summary);
                if (defenseBadge) degrees.append(defenseBadge);
            }
        }
        if (recalculated && card.matches(".attack, .spell")) degrees.append(recalculated);
    }
}

function arrangeDamageResult(root, message) {
    if (!services.isDamageMessage(message)) return;
    for (const card of root.querySelectorAll(".splittermond.damage")) {
        const roll = card.querySelector(":scope > .roll-summary");
        if (!roll) continue;
        card.classList.add("sf-damage-check");
        roll.dataset.sfLabel = t("SMOOTHER_FIGHT.HUD.DamageRoll");
        makeRollCollapsible(roll);
    }
}

function addOffenseTarget(card, message) {
    if (card.querySelector(":scope > .sf-offense-target")) return;
    const header = card.querySelector(":scope > .chat-message-header");
    const messageContext = services.getMessageContext(message);
    const targetName = getMessageTargetName(messageContext);
    if (!header || !targetName) return;

    const targetToken = services.resolveToken(primaryTargetTokenUuid(messageContext));
    const label = t(targetToken ? "SMOOTHER_FIGHT.HUD.ShowPrimaryEventTarget" : "SMOOTHER_FIGHT.HUD.EventPrimaryTarget", { target: targetName });
    const target = document.createElement(targetToken ? "button" : "div");
    target.className = "sf-offense-target";
    target.title = label;
    target.setAttribute("aria-label", label);
    if (targetToken) {
        target.type = "button";
        target.dataset.sfAction = "show-token";
        target.dataset.tokenUuid = targetToken.uuid;
    }
    target.innerHTML = `<i class="fa-solid fa-crosshairs"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.PrimaryTarget"))}</span><strong>${escapeHtml(targetName)}</strong>`;
    header.after(target);
}

function makeRollCollapsible(roll) {
    const total = roll.querySelector(":scope > .roll-total");
    if (!total || roll.querySelector(":scope > .sf-roll-breakdown")) return;
    const detailNodes = Array.from(roll.childNodes).filter((node) =>
        node !== total && (node.nodeType === Node.ELEMENT_NODE || String(node.textContent ?? "").trim())
    );
    if (!detailNodes.length) return;

    const breakdown = document.createElement("div");
    breakdown.className = "sf-roll-breakdown";
    breakdown.hidden = true;
    detailNodes.forEach((node) => breakdown.append(node));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "sf-roll-toggle";
    toggle.dataset.sfRollToggle = "";
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = `<span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.RollDetails"))}</span><i class="fa-solid fa-chevron-down"></i>`;

    roll.classList.remove("expanded", "sf-expanded-roll-result");
    roll.classList.add("sf-collapsible-roll");
    roll.append(toggle, breakdown);
}

function decorateDefenseValue(element, message, summary) {
    const parsed = parseActiveDefenseDescription(element.textContent);
    if (!parsed.defenseLabel || !Number.isFinite(parsed.defenseValue)) return null;

    const badge = document.createElement("div");
    badge.className = "sf-defense-value";
    const label = document.createElement("span");
    label.textContent = parsed.defenseLabel;
    const value = document.createElement("strong");
    value.textContent = String(parsed.defenseValue);
    badge.append(label, value);

    removeLeadingText(element, parsed.defensePrefixLength);
    if (!String(element.textContent ?? "").trim()) {
        element.remove();
        return badge;
    }

    element.classList.add("sf-defense-consequences");
    if (parsed.numbingDamage > 0) addDefenseNumbingDamageAction(element, message, parsed.numbingDamage);
    summary.after(element);
    return badge;
}

function removeLeadingText(element, length) {
    let remaining = Math.max(0, length);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && remaining > 0) {
        const take = Math.min(remaining, node.data.length);
        node.data = node.data.slice(take);
        remaining -= take;
        node = walker.nextNode();
    }
    element.normalize();
}

function addDefenseNumbingDamageAction(element, message, damage) {
    const actor = services.resolveSpeakerActor(message);
    const context = services.getMessageContext(message) ?? {};
    const allowed = Boolean(actor && (game.user.isGM || actor.isOwner));
    const applied = Boolean(context.numbingDamageApplied || context.numbingDamageApplicationStarted);
    const actions = document.createElement("div");
    actions.className = "sf-defense-consequence-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sf-defense-damage-action ${allowed ? "is-own-defense-damage" : ""} ${applied ? "is-applied" : ""}`.trim();
    button.dataset.sfDefenseNumbingDamage = String(damage);
    button.disabled = applied || !allowed;
    button.title = applied ? t("SMOOTHER_FIGHT.HUD.AlreadyApplied") : "";
    button.innerHTML = `<i class="fa-solid fa-heart-crack"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyDefenseNumbingDamage", {
        damage,
        name: actor?.name ?? message.speaker?.alias ?? "–",
    }))}`;
    actions.append(button);
    element.append(actions);
}

function scopeChatCardIds(content, messageId) {
    const template = document.createElement("template");
    template.innerHTML = content ?? "";
    const idMap = new Map();
    for (const element of template.content.querySelectorAll("[id]")) {
        const originalId = element.id;
        const scopedId = `${MODULE_ID}-${messageId}-${originalId}`;
        idMap.set(originalId, scopedId);
        element.id = scopedId;
    }
    for (const label of template.content.querySelectorAll("label[for]")) {
        const scopedId = idMap.get(label.htmlFor);
        if (scopedId) label.htmlFor = scopedId;
    }
    const wrapper = document.createElement("div");
    wrapper.append(template.content.cloneNode(true));
    return wrapper.innerHTML;
}
