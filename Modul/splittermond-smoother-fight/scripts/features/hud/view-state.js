import { hudState } from "./state.js";

import { services } from "../../core/services.js";

import {
    resolveCombatEventOpenIds,
} from "../../combat-rules.js";

import {
    captureSpellListViewState,
    restoreSpellListViewState,
} from "./spell-filters.js";

export function captureHudViewState(root) {
    const scroller = root?.querySelector?.(".sf-event-scroller");
    const tickActionReference = root?.querySelector?.(".sf-tick-action-reference");
    const spellList = captureSpellListViewState(root);
    if (!scroller && !tickActionReference && !spellList) return null;
    const groups = Array.from(scroller?.querySelectorAll(".sf-event-group[data-event-id]") ?? []);
    const subevents = Array.from(scroller?.querySelectorAll(".sf-associated-card[data-subevent-id]") ?? []);
    const focusedEvent = scroller?.querySelector('.sf-event-card[data-sf-flow-focus="true"]')
        ?.closest?.(".sf-event-group[data-event-id]");
    const tickActionPopover = tickActionReference?.querySelector(":scope > .sf-tick-action-popover");
    const tickActionFilter = tickActionPopover?.querySelector("[data-sf-tick-action-filter]");
    return {
        scrollTop: scroller?.scrollTop ?? 0,
        eventIds: new Set(groups.map((group) => group.dataset.eventId)),
        openEventIds: new Set(groups.filter((group) => group.open).map((group) => group.dataset.eventId)),
        outOfTurnEventIds: new Set(groups.filter((group) => group.dataset.eventOutOfTurn === "true").map((group) => group.dataset.eventId)),
        subeventIds: new Set(subevents.map((subevent) => subevent.dataset.subeventId)),
        openSubeventIds: new Set(subevents.filter((subevent) => subevent.open).map((subevent) => subevent.dataset.subeventId)),
        focusedEventId: focusedEvent?.dataset?.eventId ?? null,
        tickActionReferenceOpen: Boolean(tickActionReference?.open),
        tickActionFilter: tickActionFilter?.value ?? "",
        tickActionScrollTop: tickActionPopover?.scrollTop ?? 0,
        spellListActorId: root?.dataset?.activeActorId ?? null,
        spellList,
    };
}

export function restoreHudViewState(root, state, { forceLatestEvent = false } = {}) {
    if (!state) return;
    restoreTickActionReferenceState(root, state);
    if (state.spellListActorId === (root?.dataset?.activeActorId ?? null)) {
        restoreSpellListViewState(root, state.spellList);
    }
    const scroller = root?.querySelector?.(".sf-event-scroller");
    if (!scroller) return;

    const groups = Array.from(scroller.querySelectorAll(".sf-event-group[data-event-id]"));
    const currentEventIds = groups.map((group) => group.dataset.eventId);
    const eventCombatantIds = new Map(groups.map((group) => [group.dataset.eventId, group.dataset.eventCombatantId || null]));
    const eventActorIds = new Map(groups.map((group) => [group.dataset.eventId, group.dataset.eventActorId || null]));
    const outOfTurnEventIds = new Set(groups.filter((group) => group.dataset.eventOutOfTurn === "true").map((group) => group.dataset.eventId));
    const focusedEventId = scroller.querySelector('.sf-event-card[data-sf-flow-focus="true"]')
        ?.closest?.(".sf-event-group[data-event-id]")?.dataset?.eventId ?? null;
    const openEventIds = resolveCombatEventOpenIds(state.eventIds, state.openEventIds, currentEventIds, {
        currentCombatantId: root.dataset.activeCombatantId || null,
        currentActorId: root.dataset.activeActorId || null,
        eventCombatantIds,
        eventActorIds,
        outOfTurnEventIds,
        previousOutOfTurnEventIds: state.outOfTurnEventIds,
        forceLatestEvent,
        flowManaged: true,
        previousFocusedEventId: state.focusedEventId,
        focusedEventId,
    });
    groups.forEach((group) => {
        group.open = openEventIds.has(group.dataset.eventId);
    });
    let newestDamage = null;
    for (const group of groups) {
        const subevents = Array.from(group.querySelectorAll(":scope > .sf-event-body > .sf-associated-card[data-subevent-id]"));
        if (!shouldRestoreCombatSubevents(group.dataset.eventId, state.focusedEventId, focusedEventId)) {
            subevents.forEach((subevent) => {
                subevent.open = false;
            });
            continue;
        }
        const newDamages = subevents.filter((subevent) =>
            subevent.dataset.subeventKind === "damage" && !state.subeventIds?.has(subevent.dataset.subeventId)
        );
        if (newDamages.length) {
            newestDamage = newDamages.at(-1);
            subevents.forEach((subevent) => {
                if (subevent.dataset.subeventKind === "defense" || subevent.dataset.subeventKind === "damage") {
                    subevent.open = subevent === newestDamage;
                }
            });
            continue;
        }
        subevents.forEach((subevent) => {
            if (!state.subeventIds?.has(subevent.dataset.subeventId)) return;
            subevent.open = state.openSubeventIds?.has(subevent.dataset.subeventId);
        });
    }
    if (!currentEventIds.some((eventId) => state.eventIds.has(eventId))) return;

    const restoreScroll = () => {
        if (!scroller.isConnected) return;
        const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const scrollerRect = scroller.getBoundingClientRect();
        const damageRect = newestDamage?.getBoundingClientRect();
        const damageBottom = damageRect
            ? scroller.scrollTop + damageRect.bottom - scrollerRect.top - scroller.clientHeight
            : 0;
        scroller.scrollTop = Math.min(Math.max(state.scrollTop, damageBottom), maximum);
    };
    restoreScroll();
    requestAnimationFrame(restoreScroll);
}

export function shouldRestoreCombatSubevents(eventId, previousFocusedEventId, focusedEventId) {
    if (!previousFocusedEventId || previousFocusedEventId !== eventId) return true;
    return focusedEventId === previousFocusedEventId;
}

function restoreTickActionReferenceState(root, state) {
    const disclosure = root?.querySelector?.(".sf-tick-action-reference");
    if (!disclosure) return;
    disclosure.open = Boolean(state.tickActionReferenceOpen);
    const popover = disclosure.querySelector(":scope > .sf-tick-action-popover");
    const filter = popover?.querySelector("[data-sf-tick-action-filter]");
    if (filter && state.tickActionFilter) {
        filter.value = state.tickActionFilter;
        filter.dispatchEvent(new Event("input"));
    }
    const restoreScroll = () => {
        if (popover?.isConnected) popover.scrollTop = state.tickActionScrollTop ?? 0;
    };
    restoreScroll();
    requestAnimationFrame(restoreScroll);
}

export function applyCombatEventExpansionRequest(root) {
    const request = services.getCombatEventExpansionRequest();
    if (!request) return;
    const scroller = root?.querySelector?.(".sf-event-scroller");
    if (!scroller) return;

    services.clearCombatEventExpansionRequest();
    const groups = Array.from(scroller.querySelectorAll(".sf-event-group[data-event-id]"));
    groups.forEach((group) => {
        group.open = false;
    });
    if (request !== "latest") return;

    const latest = groups.at(-1);
    if (!latest) return;
    latest.open = true;
    requestAnimationFrame(() => {
        if (!latest.isConnected || !scroller.isConnected) return;
        const top = Math.max(0, latest.offsetTop - scroller.offsetTop);
        const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTop = Math.min(top, maximum);
    });
}

export function applyCombatWorkflowFocus(root) {
    const events = root?.querySelector?.(".sf-events");
    const scroller = events?.querySelector?.(".sf-event-scroller");
    if (!scroller || events.classList.contains("is-collapsed")) return false;
    const focus = scroller.querySelector('.sf-event-card[data-sf-flow-focus="true"]');
    if (!focus) {
        const opened = Array.from(scroller.querySelectorAll(".sf-event-card[open]"));
        opened.slice(0, -1).forEach((card) => {
            card.open = false;
        });
        return false;
    }
    const group = focus.closest(".sf-event-group");
    scroller.querySelectorAll(".sf-event-group[open]").forEach((candidate) => {
        candidate.open = candidate === group;
    });
    scroller.querySelectorAll(".sf-event-card[open]").forEach((candidate) => {
        candidate.open = candidate === focus;
    });
    if (group) group.open = true;
    focus.open = true;
    return true;
}

export function enforceCombatEventAccordion(root, disclosure) {
    if (!disclosure?.open || !root?.contains?.(disclosure)) return false;
    if (disclosure.matches?.(".sf-event-card")) {
        const group = disclosure.closest(".sf-event-group");
        root.querySelectorAll(".sf-event-card[open]").forEach((candidate) => {
            if (candidate !== disclosure) candidate.open = false;
        });
        root.querySelectorAll(".sf-event-group[open]").forEach((candidate) => {
            if (candidate !== group) candidate.open = false;
        });
        if (group) group.open = true;
        return true;
    }
    if (!disclosure.matches?.(".sf-event-group")) return false;
    root.querySelectorAll(".sf-event-group[open]").forEach((candidate) => {
        if (candidate !== disclosure) candidate.open = false;
    });
    const cards = Array.from(disclosure.querySelectorAll(":scope > .sf-event-body > .sf-event-card"));
    if (!cards.some((card) => card.open)) cards.at(-1)?.setAttribute("open", "");
    return true;
}

export function requestActionMenuExpansion(context, trigger, menuId) {
    hudState.actionMenuExpansionRequest = {
        actorId: context.actor?.id ?? null,
        combatantId: context.combatant?.id ?? null,
        menuId,
        scrollTop: trigger.closest(".sf-action-popover")?.scrollTop ?? 0,
    };
}

export function clearActionMenuExpansionRequest() {
    hudState.actionMenuExpansionRequest = null;
}

export function applyActionMenuExpansionRequest(root) {
    const request = hudState.actionMenuExpansionRequest;
    if (!request) return;
    hudState.actionMenuExpansionRequest = null;
    let scope = root;
    if (request.combatantId && request.combatantId !== root.dataset.activeCombatantId) {
        scope = Array.from(root.querySelectorAll("[data-sf-context-combatant-id]"))
            .find((candidate) => candidate.dataset.sfContextCombatantId === request.combatantId);
        if (!scope) return;
    } else if (request.actorId && request.actorId !== root.dataset.activeActorId) {
        return;
    }

    const menu = Array.from(scope.querySelectorAll(".sf-actions details[data-sf-menu]"))
        .find((candidate) => candidate.dataset.sfMenu === request.menuId);
    if (!menu) return;
    menu.open = true;

    const popover = menu.querySelector(":scope > .sf-action-popover");
    if (!popover) return;
    const restoreScroll = () => {
        if (popover.isConnected) popover.scrollTop = request.scrollTop;
    };
    restoreScroll();
    requestAnimationFrame(restoreScroll);
}
