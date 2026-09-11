import { hudState } from "./state.js";
import { services } from "../../core/services.js";
import { getPersonalHudContext } from "./context.js";
import { buildAdvanceButtons, buildDefenseControl, buildTargetColumn, continuousActionInterruptionControls } from "./view.js";
import { buildSelectedMovementControl } from "./movement.js";
import { bindQuickTargetSearch, captureQuickTargetViewState, restoreQuickTargetViewState } from "./quick-targets.js";
import { getSetting } from "../../shared/values.js";

// Remember generated markup before permission decorators and interactive state
// modify it. An unchanged source subtree must retain those changes and listeners.
export function rememberHudMarkup(root) {
    hudState.canvasMarkup = new WeakMap();
    for (const part of root.querySelectorAll(".sf-target-column, .sf-tick-buttons, .sf-defense-menu, .sf-defense-response-control, .sf-events, .sf-selected-movement-control")) {
        rememberNodes(part);
    }
}

function rememberNodes(node, added = null) {
    hudState.canvasMarkup.set(node, markup(node));
    added?.add(node);
    for (const child of node.childNodes ?? []) rememberNodes(child, added);
}

function markup(node) {
    return node.outerHTML ?? node.nodeValue ?? "";
}

function nodeKey(node) {
    const data = node.dataset;
    const identity = data?.eventId ?? data?.subeventId ?? data?.messageId
        ?? data?.sfTokenUuid ?? data?.tokenUuid ?? data?.sfMenu ?? "";
    return [node.nodeName, identity, data?.sfAction ?? "", node.classList?.[0] ?? ""].join("|");
}

function patchNode(current, next, added) {
    const source = markup(next);
    if (hudState.canvasMarkup.get(current) === source) return;
    if (current.nodeType !== 1) {
        if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    } else {
        for (const attribute of [...current.attributes]) {
            if (attribute.name === "open" && current.nodeName === "DETAILS") continue;
            if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
        }
        for (const attribute of next.attributes) {
            if (attribute.name === "open" && current.nodeName === "DETAILS") continue;
            if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
        }
        const available = new Map();
        for (const child of current.childNodes) {
            const key = nodeKey(child);
            if (!available.has(key)) available.set(key, []);
            available.get(key).push(child);
        }
        let position = current.firstChild;
        for (const child of [...next.childNodes]) {
            const retained = available.get(nodeKey(child))?.shift();
            const node = retained ?? child;
            if (retained) patchNode(retained, child, added);
            else rememberNodes(node, added);
            if (node !== position) current.insertBefore(node, position);
            position = node.nextSibling;
        }
        for (const unused of available.values()) for (const node of unused) node.remove();
    }
    hudState.canvasMarkup.set(current, source);
}

function patchPart(current, html, added, parent = current?.parentElement, before = null) {
    if (!current && !parent) return;
    const template = document.createElement("template");
    template.innerHTML = html;
    const next = template.content.firstElementChild;
    if (!next) { current?.remove(); return; }
    if (current && nodeKey(current) === nodeKey(next)) patchNode(current, next, added);
    else {
        rememberNodes(next, added);
        if (current) current.replaceWith(next);
        else parent.insertBefore(next, before);
    }
}

export function refreshHudMovementControls(root, context) {
    if (getSetting("minimized", false)) return;
    const center = root.querySelector(".sf-center");
    if (!center) return;
    const html = buildSelectedMovementControl(context.combat);
    if (hudState.canvasValues.get("selectedMovement") === html) return;
    hudState.canvasValues.set("selectedMovement", html);
    const anchor = center.querySelector(":scope > .sf-movement-tracker, :scope > .sf-actions, :scope > .sf-events");
    patchPart(center.querySelector(".sf-selected-movement-control"), html, new Set(), center, anchor);
}

function refreshInterruptionControls(actions, context, added) {
    const template = document.createElement("template");
    template.innerHTML = continuousActionInterruptionControls(context);
    const requestKey = (node) => node.querySelector("[data-request-id]")?.dataset.requestId ?? nodeKey(node);
    const previous = new Map([...actions.querySelectorAll(":scope > .sf-continuous-interruption-control")]
        .map((node) => [requestKey(node), node]));
    for (const next of template.content.children) {
        const key = requestKey(next);
        patchPart(previous.get(key), next.outerHTML, added, actions, actions.firstChild);
        previous.delete(key);
    }
    for (const node of previous.values()) node.remove();
}

export function refreshHudVisibilityParts(root, context) {
    // All affected parts are synchronous. A lost target therefore disappears
    // before the browser paints, without hiding the HUD or awaiting attack data.
    if (getSetting("minimized", false)) return;
    context = services.prepareCombatEventContext?.(context) ?? context;
    const added = new Set();
    const quickState = captureQuickTargetViewState(root.querySelector(".sf-quick-targets"));
    const column = root.querySelector(".sf-target-column");
    if (column) patchPart(column, buildTargetColumn(context), added);

    const personalRoot = root.querySelector(".sf-personal-controls");
    const personal = personalRoot ? getPersonalHudContext(context) : null;
    const actionContext = personal ? { ...personal, combatEventPresentation: context.combatEventPresentation } : context;
    const controls = personalRoot ?? root.querySelector(".sf-center");
    const ticks = controls?.querySelector(".sf-tick-buttons");
    if (ticks && actionContext.actor) patchPart(ticks, buildAdvanceButtons(actionContext, Boolean(personal)), added);
    const actions = controls?.querySelector(".sf-actions");
    if (actions && actionContext.actor && (!personalRoot || personal)) {
        refreshInterruptionControls(actions, actionContext, added);
        const defense = actions.querySelector(":scope > .sf-defense-response-control:not(.sf-continuous-interruption-control), :scope > .sf-defense-menu");
        patchPart(defense, buildDefenseControl(actionContext, Boolean(personalRoot)), added, actions);
    }
    const events = root.querySelector(".sf-events");
    if (events) patchPart(events, services.buildCombatEvents(context), added);
    services.enforceChatPermissions?.(root, context);
    services.enforceFumbleActionState?.(root);

    // Retained controls already have listeners. Bind only inserted controls.
    const inserted = { querySelectorAll: (selector) => [...root.querySelectorAll(selector)].filter((node) => added.has(node)) };
    services.bindQuickTargetHover?.(inserted);
    bindQuickTargetSearch(inserted);
    restoreQuickTargetViewState(root, quickState);
}
