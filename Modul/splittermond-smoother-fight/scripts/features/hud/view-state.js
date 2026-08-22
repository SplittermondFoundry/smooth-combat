import { hudState } from "./state.js";

import { services } from "../../core/services.js";

import {
    resolveCombatEventOpenIds,
} from "../../combat-rules.js";

export function captureHudViewState(root) {
    const scroller = root?.querySelector?.(".sf-event-scroller");
    if (!scroller) return null;
    const groups = Array.from(scroller.querySelectorAll(".sf-event-group[data-event-id]"));
    const subevents = Array.from(scroller.querySelectorAll(".sf-associated-card[data-subevent-id]"));
    return {
        scrollTop: scroller.scrollTop,
        eventIds: new Set(groups.map((group) => group.dataset.eventId)),
        openEventIds: new Set(groups.filter((group) => group.open).map((group) => group.dataset.eventId)),
        subeventIds: new Set(subevents.map((subevent) => subevent.dataset.subeventId)),
        openSubeventIds: new Set(subevents.filter((subevent) => subevent.open).map((subevent) => subevent.dataset.subeventId)),
    };
}

export function restoreHudViewState(root, state, { forceLatestEvent = false } = {}) {
    if (!state) return;
    const scroller = root?.querySelector?.(".sf-event-scroller");
    if (!scroller) return;

    const groups = Array.from(scroller.querySelectorAll(".sf-event-group[data-event-id]"));
    const currentEventIds = groups.map((group) => group.dataset.eventId);
    const eventCombatantIds = new Map(groups.map((group) => [group.dataset.eventId, group.dataset.eventCombatantId || null]));
    const eventActorIds = new Map(groups.map((group) => [group.dataset.eventId, group.dataset.eventActorId || null]));
    const openEventIds = resolveCombatEventOpenIds(state.eventIds, state.openEventIds, currentEventIds, {
        currentCombatantId: root.dataset.activeCombatantId || null,
        currentActorId: root.dataset.activeActorId || null,
        eventCombatantIds,
        eventActorIds,
        forceLatestEvent,
    });
    groups.forEach((group) => {
        group.open = openEventIds.has(group.dataset.eventId);
    });
    let newestDamage = null;
    for (const group of groups) {
        const subevents = Array.from(group.querySelectorAll(":scope > .sf-event-body > .sf-associated-card[data-subevent-id]"));
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
