import { combatEventState } from "./state.js";

import { collectCombatEventPresentation } from "./service.js";

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
    const presentation = collectCombatEventPresentation(context);
    const { groups, focus } = presentation;
    const title = combatEventState.cardsCollapsed ? t("SMOOTHER_FIGHT.HUD.ExpandCards") : t("SMOOTHER_FIGHT.HUD.CollapseCards");
    const body = !groups.length
        ? `<p class="sf-events-empty">${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoEvents"))}</p>`
        : groups.map((group, index) => buildEventGroup(group, index === groups.length - 1, context, focus)).join("");
    return `<section class="sf-events ${combatEventState.cardsCollapsed ? "is-collapsed" : ""}">
        <button type="button" class="sf-events-heading" data-sf-action="toggle-cards" title="${escapeAttr(title)}">
            <span><i class="fa-solid fa-message"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.CombatEvents"))}</span>
            <i class="fa-solid fa-chevron-down sf-events-chevron"></i>
        </button>
        <div class="sf-event-scroller">${body}</div>
    </section>`;
}

function buildEventGroup(group, isLatest, hudContext, focus = null) {
    if (group.kind === "interruption") return buildStandaloneInterruptionGroup(group, focus);
    const primary = group.primary;
    const interruptions = group.interruptions ?? [];
    const context = services.getMessageContext(primary);
    const recalculated = context?.recalculatedFrom;
    const superseded = context?.supersededBy;
    const defensePhase = services.defensePhaseForOffense(primary);
    const defenseAlert = shouldHighlightActiveDefense(group, isLatest, hudContext, context);
    const badge = group.kind === "spell"
        ? `<span class="sf-event-badge is-spell"><i class="fa-solid fa-wand-sparkles"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Spells"))}</span>`
        : recalculated
        ? `<span class="sf-event-badge is-defense"><i class="fa-solid fa-shield-halved"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenseResult"))}</span>`
        : superseded
            ? `<span class="sf-event-badge is-muted">${escapeHtml(t("SMOOTHER_FIGHT.HUD.OriginalAttack"))}</span>`
            : "";
    const defensePending = defensePhase === "open" && !superseded && group.damages.length === 0;
    const defenseBadge = defenseAlert
        ? `<span class="sf-event-badge is-defense-alert"><i class="fa-solid fa-shield-halved"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenseAvailable"))}</span>`
        : defensePending
            ? `<span class="sf-event-badge is-defense-pending"><i class="fa-solid fa-hourglass-half"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefensePending"))}</span>`
            : defensePhase === "declined" && !superseded
                ? `<span class="sf-event-badge is-defense-declined"><i class="fa-solid fa-xmark"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenseDeclined"))}</span>`
                : "";
    const targetBadge = buildEventTargetBadge(context);
    const focused = focus?.groupId === primary.id;
    const open = focused && !combatEventState.cardsCollapsed ? "open" : "";
    const defaultMessageId = defaultOpenMessageId(group);
    const focusBadge = focused
        ? `<span class="sf-event-badge is-flow-focus"><i class="fa-solid fa-forward-step"></i>${escapeHtml(flowStepLabel(focus.step))}</span>`
        : "";
    const eventActorId = primary.speaker?.actor ?? "";
    return `<details class="sf-event-group ${defenseAlert ? "is-defense-alert" : ""} ${focused ? "is-flow-focus" : ""}" data-event-id="${escapeAttr(primary.id)}" data-event-combatant-id="${escapeAttr(context?.combatantId ?? "")}" data-event-actor-id="${escapeAttr(eventActorId)}" data-event-out-of-turn="${Boolean(context?.outOfTurn)}" ${open}>
        <summary><span>${escapeHtml(primary.speaker?.alias ?? primary.author?.name ?? t(group.kind === "spell" ? "SMOOTHER_FIGHT.HUD.Spells" : "SMOOTHER_FIGHT.HUD.Attacks"))}</span>${focusBadge}${badge}${defenseBadge}${targetBadge}<i class="fa-solid fa-chevron-down"></i></summary>
        <div class="sf-event-body">
            ${focused && focus.synthetic ? buildPendingDefenseEvent(focus) : ""}
            ${group.defenses.map((message) => buildAssociatedEvent(message, {
                kind: "defense",
                icon: "fa-shield",
                label: `${t("SMOOTHER_FIGHT.HUD.DefenseResult")} · ${message.speaker?.alias ?? message.author?.name ?? "–"}`,
                open: focus ? focused && focus.messageId === message.id : defaultMessageId === message.id,
                focused: focused && focus?.messageId === message.id,
            })).join("")}
            ${buildAssociatedEvent(primary, {
                kind: "offense",
                icon: group.kind === "spell" ? "fa-wand-sparkles" : "fa-hand-fist",
                label: t(group.kind === "spell" ? "SMOOTHER_FIGHT.HUD.Spells" : "SMOOTHER_FIGHT.HUD.Attacks"),
                open: focus ? focused && focus.messageId === primary.id : defaultMessageId === primary.id,
                focused: focused && focus?.messageId === primary.id,
            })}
            ${group.damages.map((message) => buildAssociatedEvent(message, {
                kind: "damage",
                icon: "fa-droplet",
                label: t("SMOOTHER_FIGHT.HUD.Damage"),
                open: focus ? focused && focus.messageId === message.id : defaultMessageId === message.id,
                focused: focused && focus?.messageId === message.id,
            })).join("")}
            ${interruptions.map((message) => buildAssociatedEvent(message, {
                kind: "interruption",
                icon: "fa-triangle-exclamation",
                label: interruptionLabel(message, true),
                open: focus ? focused && focus.messageId === message.id : defaultMessageId === message.id,
                focused: focused && focus?.messageId === message.id,
            })).join("")}
            ${group.fumbles.map((message) => buildAssociatedEvent(message, {
                kind: "fumble",
                icon: "fa-burst",
                label: services.getFumbleData(message)?.kind === "fight"
                    ? t("SMOOTHER_FIGHT.HUD.CombatFumble")
                    : t("SMOOTHER_FIGHT.HUD.MagicFumble"),
                open: focus ? focused && focus.messageId === message.id : defaultMessageId === message.id,
                focused: focused && focus?.messageId === message.id,
            })).join("")}
        </div>
    </details>`;
}

function buildStandaloneInterruptionGroup(group, focus) {
    const message = group.primary;
    const card = services.getContinuousActionInterruptionCard?.(message) ?? {};
    const focused = focus?.groupId === message.id;
    const open = focused && !combatEventState.cardsCollapsed ? "open" : "";
    const focusBadge = focused
        ? `<span class="sf-event-badge is-flow-focus"><i class="fa-solid fa-forward-step"></i>${escapeHtml(flowStepLabel("interruption"))}</span>`
        : "";
    return `<details class="sf-event-group is-interruption ${focused ? "is-flow-focus" : ""}" data-event-id="${escapeAttr(message.id)}" data-event-combatant-id="${escapeAttr(card.combatantId ?? "")}" data-event-actor-id="${escapeAttr(message.speaker?.actor ?? "")}" data-event-out-of-turn="true" ${open}>
        <summary><span>${escapeHtml(message.speaker?.alias ?? message.author?.name ?? t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptionTitle"))}</span>${focusBadge}<span class="sf-event-badge is-interruption"><i class="fa-solid fa-triangle-exclamation"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptionTitle"))}</span><i class="fa-solid fa-chevron-down"></i></summary>
        <div class="sf-event-body">
            ${buildAssociatedEvent(message, {
                kind: "interruption",
                icon: "fa-triangle-exclamation",
                label: interruptionLabel(message),
                open: focused,
                focused,
            })}
        </div>
    </details>`;
}

function interruptionLabel(message, includeActor = false) {
    const label = t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptionTitle");
    const actor = message.speaker?.alias ?? message.author?.name;
    return includeActor && actor ? `${label} · ${actor}` : label;
}

function buildAssociatedEvent(message, { kind, icon, label, open = false, focused = false }) {
    return `<details class="sf-associated-card sf-event-card is-${escapeAttr(kind)} ${focused ? "is-flow-focus" : ""}" data-subevent-id="${escapeAttr(message.id)}" data-subevent-kind="${escapeAttr(kind)}" data-subevent-actor-id="${escapeAttr(message.speaker?.actor ?? "")}" data-sf-flow-focus="${focused}" ${open ? "open" : ""}>
        <summary><span><i class="fa-solid ${escapeAttr(icon)}"></i>${escapeHtml(label)}</span><i class="fa-solid fa-chevron-down"></i></summary>
        <div class="sf-associated-body">${chatMessageHtml(message)}</div>
    </details>`;
}

function buildPendingDefenseEvent(focus) {
    const label = flowStepLabel(focus.step);
    return `<details class="sf-associated-card sf-event-card is-defense is-defense-rolling is-flow-focus" data-subevent-id="${escapeAttr(focus.messageId)}" data-subevent-kind="defense" data-sf-flow-focus="true" open>
        <summary><span><i class="fa-solid fa-shield-halved"></i>${escapeHtml(label)}</span><i class="fa-solid fa-chevron-down"></i></summary>
        <div class="sf-defense-progress" role="status"><i class="fa-solid fa-dice fa-beat"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ActiveDefenseInProgress"))}</span></div>
    </details>`;
}

function defaultOpenMessageId(group) {
    return [group.primary, ...group.defenses, ...group.damages, ...(group.interruptions ?? []), ...group.fumbles]
        .sort((left, right) => Number(left.timestamp) - Number(right.timestamp))
        .at(-1)?.id ?? group.primary.id;
}

function flowStepLabel(step) {
    const suffix = {
        "defense-decision": "DefenseDecision",
        "defense-roll": "DefenseRoll",
        "defense-ticks": "DefenseTicks",
        damage: "Damage",
        fumble: "Fumble",
        interruption: "Interruption",
        offense: "Offense",
    }[step] ?? "Offense";
    return t(`SMOOTHER_FIGHT.HUD.CombatFlow.${suffix}`);
}

function buildEventTargetBadge(context) {
    const targetName = getMessageTargetName(context);
    if (!targetName) return "";
    const label = t("SMOOTHER_FIGHT.HUD.EventPrimaryTarget", { target: targetName });
    return `<span class="sf-event-target" title="${escapeAttr(label)}"><i class="fa-solid fa-crosshairs"></i>${escapeHtml(label)}</span>`;
}

export function getMessageTargetName(context) {
    const target = services.resolveMessageTarget(context);
    if (!mayViewMessageTarget(context, target)) return "";
    return context?.primaryTargetName
        ?? context?.targetName
        ?? target?.token?.name
        ?? target?.actor?.name
        ?? context?.targetNames?.at?.(-1)
        ?? "";
}

function mayViewMessageTarget(context, target) {
    if (game.user?.isGM) return true;
    if (primaryTargetTokenUuid(context)) {
        return services.isTokenPerceivableByUser(target?.token, game.user);
    }
    return Boolean(target?.actor?.testUserPermission?.(game.user, "OBSERVER"));
}

function primaryTargetTokenUuid(context) {
    return context?.primaryTargetTokenUuid ?? context?.targetTokenUuid ?? null;
}

function shouldHighlightActiveDefense(group, isLatest, hudContext, messageContext) {
    return Boolean(pendingActiveDefenseParticipant(group, isLatest, hudContext, messageContext));
}

function pendingActiveDefenseParticipant(group, isLatest, hudContext, messageContext) {
    if (group.damages.length > 0) return false;
    if (!services.defenseAwaitsResponse(group.primary)) return false;
    if (messageContext?.supersededBy) return false;
    const storedTarget = services.resolveToken(primaryTargetTokenUuid(messageContext));
    if (storedTarget) {
        const contextTokenUuid = services.tokenUuid?.(hudContext?.token) ?? hudContext?.token?.uuid ?? null;
        const targetPending = !(services.hasDefenseParticipantDecided?.(messageContext, {
            actorUuid: storedTarget.actor?.uuid,
            tokenUuid: storedTarget.uuid,
        }) ?? Boolean(
            messageContext?.attemptedDefenseActorUuids?.includes?.(storedTarget.actor?.uuid)
            || messageContext?.declinedDefenseActorUuids?.includes?.(storedTarget.actor?.uuid)
        ));
        const controlsTarget = Boolean(
            services.isCurrentUserTarget(storedTarget)
            || (contextTokenUuid && contextTokenUuid === storedTarget.uuid
                && (game.user?.isGM || storedTarget.actor?.isOwner))
        );
        if (targetPending && controlsTarget) {
            return { role: "target", target: storedTarget, defender: null };
        }

        const defenderChoices = services.getEligibleDefenderChoices?.(group.primary, game.user) ?? [];
        const defender = defenderChoices.find((choice) => choice.token?.uuid === contextTokenUuid)?.token ?? null;
        if (defender) return { role: "defender", target: storedTarget, defender };
        return null;
    }
    return isLatest && services.isCurrentUserTarget(hudContext?.target)
        ? { role: "target", target: hudContext.target, defender: null }
        : null;
}

export function hasPendingActiveDefense(context) {
    return Boolean(getPendingActiveDefense(context));
}

export function getPendingActiveDefense(context) {
    const presentation = collectCombatEventPresentation(context);
    if (presentation.focus && presentation.focus.step !== "defense-decision") return null;
    const focused = presentation.focus?.step === "defense-decision"
        ? presentation.groups.find((group) => group.primary.id === presentation.focus.groupId)
        : null;
    const latest = focused ?? presentation.groups.at(-1);
    if (!latest) return null;
    const messageContext = services.getMessageContext(latest.primary);
    const participant = pendingActiveDefenseParticipant(latest, true, context, messageContext);
    if (!participant) return null;
    return {
        message: latest.primary,
        target: participant.target ?? services.resolveToken(primaryTargetTokenUuid(messageContext)) ?? context?.target ?? null,
        defender: participant.defender,
        role: participant.role,
    };
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
    enforceInterruptionCardPermission(template.content, message);
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

function enforceInterruptionCardPermission(root, message) {
    const buttons = root.querySelectorAll('[data-sf-action="roll-continuous-action-interruption"]');
    if (!buttons.length) return;
    const card = services.getContinuousActionInterruptionCard?.(message);
    const mayRoll = services.canCurrentUserRollContinuousActionInterruption?.(message);
    for (const button of buttons) {
        if (card?.tokenUuid) button.dataset.sfTokenUuid = card.tokenUuid;
        if (card?.requestId) button.dataset.requestId = card.requestId;
        if (mayRoll) {
            button.classList.add("is-next-interruption-roll");
            button.disabled = false;
            button.removeAttribute("aria-disabled");
            continue;
        }
        (button.closest?.(".sf-continuous-action-interruption-actions") ?? button).remove();
    }
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
    const allowed = Boolean(actor && (game.user.isGM || actor.isOwner));
    const state = services.getNumbingDamageApplicationState(message);
    const blocked = state !== "idle";
    const actions = document.createElement("div");
    actions.className = "sf-defense-consequence-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sf-defense-damage-action ${allowed ? "is-own-defense-damage" : ""} ${state === "completed" ? "is-applied" : blocked ? `is-${state}` : ""}`.trim();
    button.dataset.sfDefenseNumbingDamage = String(damage);
    button.disabled = blocked || !allowed;
    button.title = state === "completed"
        ? t("SMOOTHER_FIGHT.HUD.AlreadyApplied")
        : state === "applying"
            ? t("SMOOTHER_FIGHT.HUD.DamageApplying")
            : state === "uncertain"
                ? t("SMOOTHER_FIGHT.HUD.DamageApplicationUncertain")
                : "";
    button.innerHTML = `<i class="fa-solid fa-heart-crack"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyDefenseNumbingDamage", {
        damage,
        name: actor?.name ?? message.speaker?.alias ?? "–",
    }))}`;
    actions.append(button);
    if (state === "uncertain") services.addDamageRecoveryActions(actions, "numbing");
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
