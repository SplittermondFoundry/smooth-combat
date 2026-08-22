import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import { onCreateChatMessage } from "../Modul/splittermond-smoother-fight/scripts/features/chat/lifecycle.js";

const harness = {
    calls: [],
    contexts: new WeakMap(),
    fumble: false,
    assignedUser: null,
    runtimeController: null,
    primaryTargetUuid: null,
    pendingKinds: new Map(),
};

function record(name, ...args) {
    harness.calls.push({ name, args });
}

function callsOf(name) {
    return harness.calls.filter((entry) => entry.name === name);
}

configureServices({
    announceMessageFeedback: (message) => record("announceMessageFeedback", message),
    attachFumbleActions: async (message) => record("attachFumbleActions", message),
    clearPendingOffenseKind: (actorId) => {
        record("clearPendingOffenseKind", actorId);
        harness.pendingKinds.delete(actorId);
    },
    getAssignedUser: (combatant) => {
        record("getAssignedUser", combatant);
        return harness.assignedUser;
    },
    getRuntimeController: (combatant) => {
        record("getRuntimeController", combatant);
        return harness.runtimeController;
    },
    getMessageContext: (message) => harness.contexts.get(message) ?? null,
    getPendingOffenseKind: (actorId) => {
        record("getPendingOffenseKind", actorId);
        return harness.pendingKinds.get(actorId);
    },
    getTargetSelectionForUser: (user) => {
        record("getTargetSelectionForUser", user);
        const targets = Array.from(user?.targets ?? []);
        const target = targets.find((candidate) => candidate.uuid === harness.primaryTargetUuid) ?? targets.at(-1) ?? null;
        return {
            targets,
            target,
            targetTokenUuids: targets.map((candidate) => candidate.uuid),
            targetActorUuids: targets.map((candidate) => candidate.actor?.uuid).filter(Boolean),
            primaryTargetTokenUuid: target?.uuid ?? null,
            primaryTargetActorUuid: target?.actor?.uuid ?? null,
        };
    },
    isDefenseMessage: (message) => {
        record("isDefenseMessage", message);
        return false;
    },
    isFumbleTableMessage: (message) => {
        record("isFumbleTableMessage", message);
        return harness.fumble;
    },
    isOwnMessage: (message) => message.author?.id === game.user.id,
    processDefenseMessage: async (message) => record("processDefenseMessage", message),
    safeSetFlag: async (message, key, value) => {
        record("safeSetFlag", message, key, value);
        if (key === "context") harness.contexts.set(message, value);
        return true;
    },
    speakerTokenUuid: () => null,
});

function createHooksHarness() {
    let nextId = 1;
    const registrations = new Map();
    return {
        api: {
            on: (name, callback) => {
                const id = nextId;
                nextId += 1;
                registrations.set(id, { name, callback });
                return id;
            },
            off: (name, id) => {
                if (registrations.get(id)?.name === name) registrations.delete(id);
            },
        },
        callbacks: (name) => Array.from(registrations.values())
            .filter((entry) => entry.name === name)
            .map((entry) => entry.callback),
    };
}

function createFixture({ diceActive = true, fumble = false, pendingKind = null } = {}) {
    harness.calls.length = 0;
    harness.contexts = new WeakMap();
    harness.fumble = fumble;
    harness.primaryTargetUuid = null;
    harness.pendingKinds = new Map();

    const actor = { id: "actor-attacker", uuid: "Actor.attacker" };
    const attackerToken = {
        id: "token-attacker",
        uuid: "Scene.scene.Token.attacker",
        actor,
    };
    const targetA = {
        id: "target-a",
        uuid: "Scene.scene.Token.target-a",
        name: "Ziel A",
        actor: { uuid: "Actor.target-a" },
    };
    const targetB = {
        id: "target-b",
        uuid: "Scene.scene.Token.target-b",
        name: "Ziel B",
        actor: { uuid: "Actor.target-b" },
    };
    const assignedUser = { id: "assigned-user", targets: new Set([targetA]), active: true };
    const runtimeController = { id: "runtime-controller", targets: assignedUser.targets, active: true };
    const combatant = {
        id: "combatant-attacker",
        actorId: actor.id,
        tokenId: attackerToken.id,
        actor,
        token: attackerToken,
    };
    const currentUser = { id: "current-user", targets: new Set() };
    const message = {
        id: "attack-message",
        type: "attackRollMessage",
        author: currentUser,
        speaker: {
            actor: actor.id,
            token: attackerToken.id,
        },
        _dice3danimating: diceActive,
        _dice3dPendingRenders: diceActive ? 1 : 0,
    };
    const hooks = createHooksHarness();

    harness.assignedUser = assignedUser;
    harness.runtimeController = runtimeController;
    harness.primaryTargetUuid = targetA.uuid;
    if (pendingKind) harness.pendingKinds.set(actor.id, pendingKind);
    globalThis.game = {
        actors: new Map([[actor.id, actor]]),
        combat: { id: "combat-1", combatants: [combatant] },
        modules: { get: (id) => id === "dice-so-nice" ? { active: diceActive } : null },
        user: currentUser,
    };
    globalThis.Hooks = hooks.api;

    return { actor, attackerToken, assignedUser, combatant, hooks, message, runtimeController, targetA, targetB };
}

async function waitForDiceHook(hooks) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const callbacks = hooks.callbacks("diceSoNiceRollComplete");
        if (callbacks.length) return callbacks;
        await Promise.resolve();
    }
    assert.fail("Dice-So-Nice completion hook was not registered");
}

async function completeDiceAnimation(fixture, times = 1) {
    const callbacks = await waitForDiceHook(fixture.hooks);
    fixture.message._dice3danimating = false;
    fixture.message._dice3dPendingRenders = 0;
    for (let completion = 0; completion < times; completion += 1) {
        for (const callback of callbacks) callback(fixture.message.id);
    }
}

test("chat creation freezes offense mechanics before Dice So Nice presentation waits", async (t) => {
    const gameDescriptor = Object.getOwnPropertyDescriptor(globalThis, "game");
    const hooksDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Hooks");
    t.after(() => {
        if (gameDescriptor) Object.defineProperty(globalThis, "game", gameDescriptor);
        else delete globalThis.game;
        if (hooksDescriptor) Object.defineProperty(globalThis, "Hooks", hooksDescriptor);
        else delete globalThis.Hooks;
    });

    await t.test("A and B remain selected while B is frozen as the primary target", async () => {
        const fixture = createFixture();
        fixture.runtimeController.targets = new Set([fixture.targetA, fixture.targetB]);
        harness.primaryTargetUuid = fixture.targetB.uuid;
        const processing = onCreateChatMessage(fixture.message);

        harness.primaryTargetUuid = fixture.targetA.uuid;
        await completeDiceAnimation(fixture);
        await processing;

        const context = harness.contexts.get(fixture.message);
        assert.deepEqual(context, {
            combatId: "combat-1",
            combatantId: fixture.combatant.id,
            attackerTokenUuid: fixture.attackerToken.uuid,
            attackerActorUuid: fixture.actor.uuid,
            primaryTargetTokenUuid: fixture.targetB.uuid,
            primaryTargetActorUuid: fixture.targetB.actor.uuid,
            primaryTargetName: fixture.targetB.name,
            targetTokenUuid: fixture.targetB.uuid,
            targetActorUuid: fixture.targetB.actor.uuid,
            targetName: fixture.targetB.name,
            targetTokenUuids: [fixture.targetA.uuid, fixture.targetB.uuid],
            targetActorUuids: [fixture.targetA.actor.uuid, fixture.targetB.actor.uuid],
            targetNames: [fixture.targetA.name, fixture.targetB.name],
            actionKind: null,
            assignedUserId: fixture.assignedUser.id,
            runtimeControllerId: fixture.runtimeController.id,
            createdAt: context.createdAt,
        });
        assert.equal(callsOf("getTargetSelectionForUser").length, 1);
    });

    await t.test("with Dice So Nice disabled the existing processing remains immediate", async () => {
        const fixture = createFixture({ diceActive: false, fumble: true });

        await onCreateChatMessage(fixture.message);

        assert.equal(harness.contexts.get(fixture.message)?.targetTokenUuid, fixture.targetA.uuid);
        assert.deepEqual(
            harness.calls
                .filter((entry) => ["safeSetFlag", "attachFumbleActions", "announceMessageFeedback"].includes(entry.name))
                .map((entry) => entry.name),
            ["safeSetFlag", "attachFumbleActions", "announceMessageFeedback"]
        );
        assert.equal(fixture.hooks.callbacks("diceSoNiceRollComplete").length, 0);
    });

    await t.test("one chat creation produces and continues its context exactly once", async () => {
        const fixture = createFixture({ fumble: true });
        const processing = onCreateChatMessage(fixture.message);

        await completeDiceAnimation(fixture, 2);
        await processing;

        assert.equal(callsOf("safeSetFlag").length, 1);
        assert.equal(callsOf("getTargetSelectionForUser").length, 1);
        assert.equal(callsOf("attachFumbleActions").length, 1);
        assert.equal(callsOf("announceMessageFeedback").length, 1);
    });

    await t.test("PendingOffenseKind is consumed once before delayed presentation", async () => {
        const pendingKind = {
            kind: "ranged",
            expiresAt: Date.now() + 60_000,
            primaryTargetTokenUuid: "Scene.scene.Token.frozen",
            primaryTargetActorUuid: "Actor.frozen",
            primaryTargetName: "Eingefrorenes Ziel",
            targetTokenUuids: ["Scene.scene.Token.other", "Scene.scene.Token.frozen"],
            targetActorUuids: ["Actor.other", "Actor.frozen"],
            targetNames: ["Weiteres Ziel", "Eingefrorenes Ziel"],
        };
        const fixture = createFixture({ pendingKind });
        const processing = onCreateChatMessage(fixture.message);

        assert.equal(harness.pendingKinds.has(fixture.actor.id), false);
        assert.equal(harness.contexts.get(fixture.message)?.actionKind, pendingKind.kind);
        assert.equal(harness.contexts.get(fixture.message)?.primaryTargetTokenUuid, pendingKind.primaryTargetTokenUuid);
        assert.deepEqual(harness.contexts.get(fixture.message)?.targetTokenUuids, pendingKind.targetTokenUuids);
        assert.deepEqual(callsOf("clearPendingOffenseKind").map((entry) => entry.args), [[fixture.actor.id]]);

        await completeDiceAnimation(fixture);
        await processing;

        assert.equal(callsOf("getPendingOffenseKind").length, 1);
        assert.equal(callsOf("clearPendingOffenseKind").length, 1);
        assert.equal(harness.contexts.get(fixture.message)?.actionKind, pendingKind.kind);
    });
});
