import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    enforceOffenseDefensePhaseControls,
    hasUsableAssociatedDefenseTickAction,
    isMessageSpeakerAssignedToCurrentUser,
} from "../Modul/splittermond-smoother-fight/scripts/features/chat/actions.js";
import {
    decorateCombatFumbleRollControl,
    hasPendingCombatFumbleStep,
} from "../Modul/splittermond-smoother-fight/scripts/features/chat/fumble-flow.js";
import {
    createPromotedDefenseResponse,
    removeActiveDefenseResponse,
} from "../Modul/splittermond-smoother-fight/scripts/features/chat/rendered-controls.js";

const contexts = new WeakMap();
let pendingFumbleActions = false;

configureServices({
    canUserDeclineActiveDefense: () => true,
    defenseAllowsModification: () => true,
    defenseAwaitsResponse: () => true,
    getAssignedUser: (combatant) => combatant.assignedUser ?? null,
    getFumbleData: (message) => message?.fumble ?? null,
    getMessageContext: (message) => contexts.get(message) ?? null,
    getRuntimeController: (combatant) => combatant.runtimeController ?? null,
    hasPendingFumbleActions: () => pendingFumbleActions,
    isCurrentUserTarget: () => false,
    isDefenseMessage: () => false,
    isFumbleTableMessage: (message) => Boolean(message?.fumble),
    resolveSpeakerActor: (message) => message.actor ?? null,
    resolveToken: () => null,
    speakerTokenUuid: () => null,
});

test("an open active-defense action gains a directly adjacent decline button", (t) => {
    const previousDocument = globalThis.document;
    const currentUser = { id: "defender", isGM: false };
    const root = { wrapper: null };
    const defenseButton = {
        dataset: { localaction: "activeDefense" },
        classList: { values: [], add(value) { this.values.push(value); } },
        closest: () => null,
        replaceWith(wrapper) { root.wrapper = wrapper; },
    };
    root.querySelectorAll = (selector) => {
        if (selector === ".sf-chat-defense-response") return [];
        if (selector.includes("activeDefense")) return [defenseButton];
        if (selector === ".splittermond-chat-action, .add-tick[data-ticks]") return [defenseButton];
        return [];
    };
    globalThis.document = {
        createElement: (tag) => ({
            tag,
            children: [],
            dataset: {},
            setAttribute(name, value) { this[name] = value; },
            append(...children) { this.children.push(...children); },
        }),
    };
    globalThis.game = {
        i18n: { localize: (key) => key },
        user: currentUser,
    };
    t.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    });

    enforceOffenseDefensePhaseControls(root, { id: "attack", type: "attackRollMessage" });

    assert.equal(root.wrapper.className, "sf-chat-defense-response");
    assert.deepEqual(defenseButton.classList.values, ["sf-chat-defense-button", "is-next-active-defense"]);
    assert.equal(root.wrapper.children[0], defenseButton);
    assert.equal(root.wrapper.children[1].className, "sf-chat-decline-defense");
    assert.equal(root.wrapper.children[1].dataset.sfAction, "decline-active-defense");
    assert.equal(root.wrapper.children[1].dataset.messageId, "attack");
});

test("an open defense phase restores a missing active-defense action", (t) => {
    const previousDocument = globalThis.document;
    const currentUser = { id: "defender", isGM: false };
    const actions = {
        children: [],
        append(child) {
            this.children.push(child);
        },
    };
    const root = {
        wrapper: null,
        defenseButton: null,
        querySelector: () => actions,
        querySelectorAll(selector) {
            if (selector === ".sf-chat-defense-response") return [];
            if (selector.includes("activeDefense")) return this.defenseButton ? [this.defenseButton] : [];
            if (selector === ".splittermond-chat-action, .add-tick[data-ticks]") {
                return this.defenseButton ? [this.defenseButton] : [];
            }
            return [];
        },
    };
    globalThis.document = {
        createElement: (tag) => {
            const element = {
                tag,
                children: [],
                dataset: {},
                classList: { values: [], add(value) { this.values.push(value); } },
                closest: () => null,
                setAttribute(name, value) { this[name] = value; },
                append(...children) { this.children.push(...children); },
                replaceWith(wrapper) { root.wrapper = wrapper; },
            };
            if (tag === "button" && !root.defenseButton) root.defenseButton = element;
            return element;
        },
    };
    globalThis.game = {
        i18n: { localize: (key) => key },
        user: currentUser,
    };
    t.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    });

    enforceOffenseDefensePhaseControls(root, { id: "attack", type: "attackRollMessage" });

    assert.equal(actions.children.length, 1);
    assert.equal(actions.children[0].dataset.localaction, "activeDefense");
    assert.match(actions.children[0].className, /sf-synthetic-active-defense/u);
    assert.deepEqual(actions.children[0].classList.values, ["sf-chat-defense-button", "is-next-active-defense"]);
    assert.equal(root.wrapper.children[0], actions.children[0]);
    assert.equal(root.wrapper.children[1].dataset.sfAction, "decline-active-defense");
});

test("a recalculated target defense keeps its decline button beside the replacement action", (t) => {
    const previousDocument = globalThis.document;
    const previousGame = globalThis.game;
    globalThis.document = {
        createElement: (tag) => ({
            tag,
            children: [],
            dataset: {},
            className: "",
            setAttribute(name, value) { this[name] = value; },
            append(...children) { this.children.push(...children); },
        }),
    };
    globalThis.game = {
        i18n: { localize: (key) => key },
    };
    t.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousGame === undefined) delete globalThis.game;
        else globalThis.game = previousGame;
    });

    const response = createPromotedDefenseResponse({
        message: { id: "recalculated-attack" },
        action: "defend-target",
        icon: "fa-shield-halved",
        label: "Eigene Aktive Abwehr",
    });

    assert.equal(response.className, "sf-chat-defense-response");
    assert.equal(response.children.length, 2);
    assert.equal(response.children[0].dataset.sfAction, "defend-target");
    assert.equal(response.children[0].dataset.messageId, "recalculated-attack");
    assert.equal(response.children[1].dataset.sfAction, "decline-active-defense");
    assert.equal(response.children[1].dataset.messageId, "recalculated-attack");

    const staleGroup = { removed: false, remove() { this.removed = true; } };
    const staleButton = {
        removed: false,
        closest: (selector) => selector === ".sf-chat-defense-response" ? staleGroup : null,
        remove() { this.removed = true; },
    };
    removeActiveDefenseResponse(staleButton);
    assert.equal(staleGroup.removed, true);
    assert.equal(staleButton.removed, false, "the old action and X are removed as one group");
});

test("fumble ownership follows the character assignment instead of broad actor ownership", () => {
    const currentUser = { id: "unassigned-player", isGM: false };
    const assignedUser = { id: "assigned-player", isGM: false };
    const actor = {
        id: "actor",
        isOwner: true,
        testUserPermission: () => true,
    };
    const combatant = { actorId: actor.id, assignedUser };
    const message = { actor };
    globalThis.game = {
        combat: { combatants: [combatant] },
        user: currentUser,
    };

    contexts.set(message, { assignedUserId: assignedUser.id });
    assert.equal(isMessageSpeakerAssignedToCurrentUser(message), false);

    contexts.set(message, { assignedUserId: currentUser.id });
    assert.equal(isMessageSpeakerAssignedToCurrentUser(message), true);

    contexts.delete(message);
    assert.equal(isMessageSpeakerAssignedToCurrentUser(message), false);

    globalThis.game.combat.combatants = [];
    assert.equal(isMessageSpeakerAssignedToCurrentUser(message), false);
});

test("a pending combat fumble keeps tick highlighting behind the fumble step", () => {
    const fumbleControl = {
        dataset: { rollType: "attackFumble" },
    };
    const completedFumble = { id: "fumble-result" };
    const fumbleElement = { dataset: { messageId: completedFumble.id } };
    const group = {
        querySelectorAll: () => [],
    };
    const card = {
        closest: (selector) => selector === ".sf-event-group" ? group : null,
    };
    globalThis.game = {
        messages: {
            get: (id) => id === completedFumble.id ? completedFumble : null,
        },
    };

    assert.equal(hasPendingCombatFumbleStep(card, [fumbleControl]), true);

    group.querySelectorAll = () => [fumbleElement];
    pendingFumbleActions = true;
    assert.equal(hasPendingCombatFumbleStep(card, [fumbleControl]), true);
    assert.equal(hasPendingCombatFumbleStep(card, []), true);

    pendingFumbleActions = false;
    assert.equal(hasPendingCombatFumbleStep(card, [fumbleControl]), false);
});

test("a completed persisted fumble suppresses the source-card prompt without relying on rendered grouping", () => {
    const fumbleControl = { dataset: { rollType: "attackFumble" } };
    const defense = { id: "defense-source" };
    const completedFumble = {
        id: "persisted-fumble",
        fumble: { sourceMessageId: defense.id },
    };
    const group = { querySelectorAll: () => [] };
    const card = {
        dataset: { messageId: defense.id },
        closest: (selector) => selector === ".sf-event-group" ? group : null,
    };
    contexts.set(defense, { attackMessageId: "attack" });
    globalThis.game = {
        messages: {
            contents: [defense, completedFumble],
            get: (id) => [defense, completedFumble].find((message) => message.id === id) ?? null,
        },
    };

    pendingFumbleActions = false;
    assert.equal(hasPendingCombatFumbleStep(card, [fumbleControl]), false);

    pendingFumbleActions = true;
    assert.equal(hasPendingCombatFumbleStep(card, [fumbleControl]), true);
});

test("a persisted fumble result marks its original table control as completed", () => {
    const classes = [];
    const attributes = {};
    const control = {
        dataset: { rollType: "attackFumble" },
        classList: { add: (name) => classes.push(name) },
        setAttribute: (name, value) => { attributes[name] = value; },
        disabled: false,
    };
    globalThis.game = { i18n: { localize: (key) => key } };

    decorateCombatFumbleRollControl(control, { hasResult: true, ownsSpeaker: true, pending: false });

    assert.equal(control.disabled, true);
    assert.equal(attributes["aria-disabled"], "true");
    assert.deepEqual(classes, ["is-applied"]);
});

test("message action highlighting follows an active runtime substitute", () => {
    const currentUser = { id: "primary-gm", isGM: true };
    const assignedUser = { id: "inactive-player", isGM: false };
    const actor = {
        id: "actor",
        isOwner: true,
        testUserPermission: () => true,
    };
    const combatant = {
        actorId: actor.id,
        assignedUser,
        runtimeController: currentUser,
    };
    const message = { actor };
    globalThis.game = {
        combat: { combatants: [combatant] },
        user: currentUser,
    };

    contexts.set(message, {
        assignedUserId: assignedUser.id,
        runtimeControllerId: currentUser.id,
    });

    assert.equal(isMessageSpeakerAssignedToCurrentUser(message), true);
});

test("a usable tick action on an associated active defense takes priority", () => {
    const usableTickAction = {
        dataset: { action: "advanceToken" },
        disabled: false,
        getAttribute: () => null,
    };
    const appliedTickAction = {
        dataset: { action: "advanceToken" },
        disabled: true,
        getAttribute: () => "true",
    };
    const defenseElement = {
        querySelectorAll: () => [usableTickAction, appliedTickAction],
    };
    const group = {
        querySelectorAll: () => [defenseElement],
    };
    const offenseElement = {
        closest: (selector) => selector === ".sf-event-group" ? group : null,
    };

    assert.equal(hasUsableAssociatedDefenseTickAction(offenseElement), true);
    usableTickAction.disabled = true;
    usableTickAction.getAttribute = () => "true";
    assert.equal(hasUsableAssociatedDefenseTickAction(offenseElement), false);
});
