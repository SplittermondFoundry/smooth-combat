import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    enforceOffenseDefensePhaseControls,
    isMessageSpeakerAssignedToCurrentUser,
} from "../Modul/splittermond-smoother-fight/scripts/features/chat/actions.js";

const contexts = new WeakMap();

configureServices({
    canUserDeclineActiveDefense: () => true,
    defenseAllowsModification: () => true,
    defenseAwaitsResponse: () => true,
    getAssignedUser: (combatant) => combatant.assignedUser ?? null,
    getMessageContext: (message) => contexts.get(message) ?? null,
    getRuntimeController: (combatant) => combatant.runtimeController ?? null,
    isCurrentUserTarget: () => false,
    isDefenseMessage: () => false,
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
    assert.deepEqual(defenseButton.classList.values, ["sf-chat-defense-button"]);
    assert.equal(root.wrapper.children[0], defenseButton);
    assert.equal(root.wrapper.children[1].className, "sf-chat-decline-defense");
    assert.equal(root.wrapper.children[1].dataset.sfAction, "decline-active-defense");
    assert.equal(root.wrapper.children[1].dataset.messageId, "attack");
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
