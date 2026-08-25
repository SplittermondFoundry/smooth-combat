import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import { isMessageSpeakerAssignedToCurrentUser } from "../Modul/splittermond-smoother-fight/scripts/features/chat/actions.js";

const contexts = new WeakMap();

configureServices({
    getAssignedUser: (combatant) => combatant.assignedUser ?? null,
    getMessageContext: (message) => contexts.get(message) ?? null,
    getRuntimeController: (combatant) => combatant.runtimeController ?? null,
    isCurrentUserTarget: () => false,
    isDefenseMessage: () => false,
    resolveSpeakerActor: (message) => message.actor ?? null,
    resolveToken: () => null,
    speakerTokenUuid: () => null,
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
