import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    onCreateChatMessage,
    onUpdateChatMessage,
} from "../Modul/splittermond-smoother-fight/scripts/features/chat/lifecycle.js";

const harness = {
    calls: [],
    contexts: new WeakMap(),
    defense: false,
    fumble: false,
    assignedUser: null,
    runtimeController: null,
    primaryTargetUuid: null,
    pendingKinds: new Map(),
    reopenedOffenses: [],
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
    claimPendingOffenseKind: (actorId) => {
        record("claimPendingOffenseKind", actorId);
        const pendingKind = harness.pendingKinds.get(actorId) ?? null;
        harness.pendingKinds.delete(actorId);
        return pendingKind;
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
        return harness.defense;
    },
    isFumbleTableMessage: (message) => {
        record("isFumbleTableMessage", message);
        return harness.fumble;
    },
    isOwnMessage: (message) => message.author?.id === game.user.id,
    initialDefensePhaseForOffense: () => "unavailable",
    normalizePendingDefense: (value) => value,
    processDefenseMessage: async (...args) => record("processDefenseMessage", ...args),
    reopenDefensePhaseAfterOutcomeChange: async (message) => {
        harness.reopenedOffenses.push(message);
        return message;
    },
    setRequiredFlag: async (message, key, value) => {
        record("setRequiredFlag", message, key, value);
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
    harness.defense = false;
    harness.fumble = fumble;
    harness.primaryTargetUuid = null;
    harness.pendingKinds = new Map();
    harness.reopenedOffenses = [];

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
    const currentUser = { id: "current-user", targets: new Set([targetA]) };
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
        system: { checkReport: { succeeded: false } },
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

    return { actor, attackerToken, assignedUser, combatant, currentUser, hooks, message, runtimeController, targetA, targetB };
}

test("updated defense checks queue behind processing while internal context updates do not", async (t) => {
    const gameDescriptor = Object.getOwnPropertyDescriptor(globalThis, "game");
    const hooksDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Hooks");
    t.after(() => {
        if (gameDescriptor) Object.defineProperty(globalThis, "game", gameDescriptor);
        else delete globalThis.game;
        if (hooksDescriptor) Object.defineProperty(globalThis, "Hooks", hooksDescriptor);
        else delete globalThis.Hooks;
    });
    const fixture = createFixture({ diceActive: false });
    fixture.currentUser.isGM = true;
    harness.defense = true;

    await onUpdateChatMessage(fixture.message, {
        "flags.splittermond.check.degreeOfSuccess.fromRoll": 7,
    });
    assert.deepEqual(callsOf("processDefenseMessage").map(({ args }) => args), [[
        fixture.message,
        null,
        { allowForeign: false, queueIfBusy: true },
    ]]);

    harness.calls.length = 0;
    await onUpdateChatMessage(fixture.message, {
        "flags.splittermond-smoother-fight.context.resultingDefenseValue": 36,
    });
    assert.deepEqual(callsOf("processDefenseMessage").map(({ args }) => args), [[
        fixture.message,
        null,
        { allowForeign: false, queueIfBusy: false },
    ]]);
});

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
        fixture.currentUser.targets = new Set([fixture.targetA, fixture.targetB]);
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
            outOfTurn: false,
            assignedUserId: fixture.assignedUser.id,
            runtimeControllerId: fixture.runtimeController.id,
            initialCheckSucceeded: false,
            defensePhase: "unavailable",
            createdAt: context.createdAt,
        });
        assert.equal(callsOf("getTargetSelectionForUser").length, 1);
    });

    await t.test("a manual GM roll uses the author's targets instead of an online runtime controller's targets", async () => {
        const fixture = createFixture({ diceActive: false });
        fixture.currentUser.isGM = true;
        fixture.currentUser.targets = new Set([fixture.targetB]);
        fixture.runtimeController.targets = new Set([fixture.targetA]);
        harness.primaryTargetUuid = fixture.targetB.uuid;

        await onCreateChatMessage(fixture.message);

        const context = harness.contexts.get(fixture.message);
        assert.equal(context?.primaryTargetTokenUuid, fixture.targetB.uuid);
        assert.deepEqual(context?.targetTokenUuids, [fixture.targetB.uuid]);
        assert.equal(context?.assignedUserId, fixture.assignedUser.id);
        assert.equal(context?.runtimeControllerId, fixture.runtimeController.id);
        assert.equal(callsOf("getTargetSelectionForUser")[0]?.args[0], fixture.currentUser);
    });

    await t.test("an attack by a non-active combatant is marked as out of turn", async () => {
        const fixture = createFixture({ diceActive: false });
        game.combat.combatant = { id: "active-combatant" };

        await onCreateChatMessage(fixture.message);

        assert.equal(harness.contexts.get(fixture.message)?.combatantId, fixture.combatant.id);
        assert.equal(harness.contexts.get(fixture.message)?.outOfTurn, true);
    });

    await t.test("with Dice So Nice disabled the existing processing remains immediate", async () => {
        const fixture = createFixture({ diceActive: false, fumble: true });

        await onCreateChatMessage(fixture.message);

        assert.equal(harness.contexts.get(fixture.message)?.targetTokenUuid, fixture.targetA.uuid);
        assert.deepEqual(
            harness.calls
                .filter((entry) => ["setRequiredFlag", "attachFumbleActions", "announceMessageFeedback"].includes(entry.name))
                .map((entry) => entry.name),
            ["setRequiredFlag", "attachFumbleActions", "announceMessageFeedback"]
        );
        assert.equal(fixture.hooks.callbacks("diceSoNiceRollComplete").length, 0);
    });

    await t.test("one chat creation produces and continues its context exactly once", async () => {
        const fixture = createFixture({ fumble: true });
        const processing = onCreateChatMessage(fixture.message);

        await completeDiceAnimation(fixture, 2);
        await processing;

        assert.equal(callsOf("setRequiredFlag").length, 1);
        assert.equal(callsOf("getTargetSelectionForUser").length, 1);
        assert.equal(callsOf("attachFumbleActions").length, 1);
        assert.equal(callsOf("announceMessageFeedback").length, 1);
    });

    await t.test("PendingOffenseKind is claimed once without clearing a successor", async () => {
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
        const successor = { kind: "spell", expiresAt: Date.now() + 60_000 };
        harness.pendingKinds.set(fixture.actor.id, successor);
        await Promise.resolve();

        assert.equal(harness.contexts.get(fixture.message)?.actionKind, pendingKind.kind);
        assert.equal(harness.contexts.get(fixture.message)?.primaryTargetTokenUuid, pendingKind.primaryTargetTokenUuid);
        assert.deepEqual(harness.contexts.get(fixture.message)?.targetTokenUuids, pendingKind.targetTokenUuids);
        assert.equal(harness.pendingKinds.get(fixture.actor.id), successor);

        await completeDiceAnimation(fixture);
        await processing;

        assert.deepEqual(callsOf("claimPendingOffenseKind").map((entry) => entry.args), [[fixture.actor.id]]);
        assert.equal(harness.pendingKinds.get(fixture.actor.id), successor);
        assert.equal(harness.contexts.get(fixture.message)?.actionKind, pendingKind.kind);
    });
});

test("a content-only rerender that turns an offense successful reopens active defense", async (t) => {
    const gameDescriptor = Object.getOwnPropertyDescriptor(globalThis, "game");
    t.after(() => {
        if (gameDescriptor) Object.defineProperty(globalThis, "game", gameDescriptor);
        else delete globalThis.game;
    });
    const fixture = createFixture({ diceActive: false });
    fixture.message.content = '<button data-localaction="activeDefense">Abwehr</button>';

    await onUpdateChatMessage(fixture.message, {
        content: fixture.message.content,
    });

    assert.deepEqual(harness.reopenedOffenses, [fixture.message]);
    assert.equal(callsOf("processDefenseMessage").length, 0);
});
