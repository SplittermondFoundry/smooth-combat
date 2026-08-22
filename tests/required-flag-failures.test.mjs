import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import { handleChatCardAction } from "../Modul/splittermond-smoother-fight/scripts/features/chat/actions.js";
import {
    safeSetFlag,
    setOptionalFlag,
    setRequiredFlag,
} from "../Modul/splittermond-smoother-fight/scripts/features/chat/messages.js";
import { installHealthCostFeedbackInterceptor } from "../Modul/splittermond-smoother-fight/scripts/features/feedback/feedback.js";
import { handleFumbleAction } from "../Modul/splittermond-smoother-fight/scripts/features/fumbles/fumbles.js";

const MODULE_ID = "splittermond-smoother-fight";
const harness = {
    completedDamageApplications: new Set(),
    errors: [],
    infos: [],
    legacyLocks: new Set(),
    messages: new Map(),
    pendingDamageApplications: [],
};

function clone(value) {
    return structuredClone(value);
}

class TestMessage {
    constructor(id, {
        actor = null,
        context = null,
        fumble = null,
        noResultCalls = [],
        rejectCalls = [],
        skipPersistenceCalls = [],
    } = {}) {
        this.id = id;
        this.actor = actor;
        this.author = { id: "gm" };
        this.user = "gm";
        this.speaker = { actor: actor?.id ?? null };
        this.flags = { [MODULE_ID]: {} };
        if (context) this.flags[MODULE_ID].context = clone(context);
        if (fumble) this.flags[MODULE_ID].fumble = clone(fumble);
        this.noResultCalls = new Set(noResultCalls);
        this.rejectCalls = new Set(rejectCalls);
        this.skipPersistenceCalls = new Set(skipPersistenceCalls);
        this.setFlagCalls = 0;
        this.system = {
            handleGenericAction: async () => undefined,
        };
    }

    getFlag(scope, key) {
        return this.flags[scope]?.[key];
    }

    async setFlag(scope, key, value) {
        this.setFlagCalls += 1;
        await Promise.resolve();
        if (this.rejectCalls.has(this.setFlagCalls)) {
            throw new Error(`Injected setFlag rejection ${this.id}#${this.setFlagCalls}`);
        }
        if (!this.skipPersistenceCalls.has(this.setFlagCalls)) {
            this.flags[scope] ??= {};
            this.flags[scope][key] = clone(value);
        }
        return this.noResultCalls.has(this.setFlagCalls) ? undefined : this;
    }
}

class TestActor {
    constructor(id) {
        this.id = id;
        this.uuid = `Actor.${id}`;
        this.name = id;
        this.isOwner = true;
        this.items = new Map();
        this.tickApplications = 0;
        this.damageApplications = 0;
        this.system = {
            health: {
                consumed: { value: 0 },
                exhausted: { value: 0 },
                channeled: { value: 0 },
            },
        };
    }

    testUserPermission() {
        return true;
    }

    async addTicks(ticks) {
        this.tickApplications += 1;
        const combatant = Array.from(game.combat?.combatants ?? []).find((candidate) => candidate.actorId === this.id);
        if (combatant) combatant.initiative += ticks;
    }

    async consumeCost() {
        this.damageApplications += 1;
        this.system.health.consumed.value += 1;
    }
}

configureServices({
    addPendingDamageApplication: (application) => harness.pendingDamageApplications.push(application),
    addPendingLegacyTickMessage: (messageId) => harness.legacyLocks.add(messageId),
    collectCombatEventGroups: () => [],
    deletePendingLegacyTickMessage: (messageId) => harness.legacyLocks.delete(messageId),
    findPendingDamageApplicationForActor: (actorUuid) => [...harness.pendingDamageApplications]
        .reverse()
        .find((application) => !application.actorUuids.size || application.actorUuids.has(actorUuid)) ?? null,
    getActivePrimaryGm: () => game.user,
    getHudContext: () => null,
    getMessageContext: (message) => message?.flags?.[MODULE_ID]?.context ?? null,
    getRuntimeController: () => game.user,
    getSceneTokens: () => [],
    handleFumbleAction,
    hasCompletedDamageApplication: (messageId) => harness.completedDamageApplications.has(messageId),
    hasPendingLegacyTickMessage: (messageId) => harness.legacyLocks.has(messageId),
    isDefenseMessage: () => false,
    isOwnMessage: (message) => (message.author?.id ?? message.user) === game.user.id,
    recordCompletedDamageApplication: (messageId) => harness.completedDamageApplications.add(messageId),
    removePendingDamageApplication: (application) => {
        const index = harness.pendingDamageApplications.lastIndexOf(application);
        if (index >= 0) harness.pendingDamageApplications.splice(index, 1);
    },
    resolveSpeakerActor: (message) => message?.actor ?? null,
    resolveToken: () => null,
    scheduleRender: () => {},
    setRequiredFlag,
    speakerTokenUuid: () => null,
    withTemporarySystemTargets: (_targets, operation) => operation(),
});

function resetHarness() {
    harness.completedDamageApplications.clear();
    harness.errors.length = 0;
    harness.infos.length = 0;
    harness.legacyLocks.clear();
    harness.messages.clear();
    harness.pendingDamageApplications.length = 0;
    globalThis.game = {
        combat: { combatants: [] },
        i18n: {
            format: (key, data) => `${key}:${data?.flag ?? ""}`,
            lang: "de",
            localize: (key) => key,
        },
        messages: { get: (id) => harness.messages.get(id) },
        socket: { emit: () => {} },
        user: { id: "gm", isGM: true, targets: new Set() },
    };
    globalThis.ui = {
        notifications: {
            error: (message) => harness.errors.push(message),
            info: (message) => harness.infos.push(message),
            warn: () => {},
        },
    };
    globalThis.foundry = { utils: { randomID: () => "feedback" } };
}

function clickEvent() {
    return {
        preventDefault() {},
        stopPropagation() {},
    };
}

function actionButton(message, dataset, { legacy = false } = {}) {
    return {
        closest: (selector) => selector === ".sf-chat-message" ? { dataset: { messageId: message.id } } : null,
        dataset,
        disabled: false,
        isConnected: true,
        matches: (selector) => legacy && selector === ".add-tick[data-ticks]",
    };
}

function fumbleData() {
    return {
        kind: "fight",
        actorUuid: null,
        actorName: "Patzernder",
        sourceMessageId: null,
        sourceItemId: null,
        damage: 0,
        ticks: 3,
        tickMessage: "Patzer",
        damagesWeapon: false,
        conditions: [],
        conditionMode: "all",
        damageApplied: false,
        damageApplicationStarted: false,
        ticksApplied: false,
        ticksApplicationStarted: false,
        weaponDamageApplied: false,
        weaponDamageApplicationStarted: false,
        conditionsApplied: false,
        conditionsApplicationStarted: false,
    };
}

test("optional flag writes absorb setFlag rejection while required writes notify and reject", async (t) => {
    resetHarness();
    t.mock.method(console, "debug", () => {});
    t.mock.method(console, "error", () => {});
    const optional = new TestMessage("optional", { rejectCalls: [1, 2] });

    assert.equal(await setOptionalFlag(optional, "uiHint", true), null);
    assert.equal(await safeSetFlag(optional, "uiHint", true), null);
    assert.equal(harness.errors.length, 0);

    const required = new TestMessage("required", { rejectCalls: [1] });
    await assert.rejects(setRequiredFlag(required, "context", {}), /Could not persist required context flag/u);
    assert.equal(harness.errors.length, 1);
    assert.match(harness.errors[0], /context/u);
});

test("required flag writes accept an empty Foundry result only after a matching read-back", async (t) => {
    resetHarness();
    t.mock.method(console, "error", () => {});
    const expected = {
        attackMessageId: "attack",
        defenseMessageIds: ["defense"],
        nested: { completed: true },
    };
    const persisted = new TestMessage("persisted", { noResultCalls: [1] });

    assert.equal(await setRequiredFlag(persisted, "context", expected), persisted);
    assert.deepEqual(persisted.getFlag(MODULE_ID, "context"), expected);
    assert.equal(harness.errors.length, 0);

    const missing = new TestMessage("missing", {
        noResultCalls: [1],
        skipPersistenceCalls: [1],
    });
    await assert.rejects(
        setRequiredFlag(missing, "context", expected),
        /Could not persist required context flag/u
    );
    assert.equal(harness.errors.length, 1);
});

test("a rejected fumble write before the effect prevents the mechanical application", async (t) => {
    resetHarness();
    t.mock.method(console, "error", () => {});
    const actor = new TestActor("fumble-preflight");
    const message = new TestMessage("fumble-preflight", {
        actor,
        fumble: fumbleData(),
        rejectCalls: [1],
    });

    await assert.rejects(handleFumbleAction(message, "ticks"), /Could not persist required fumble flag/u);

    assert.equal(actor.tickApplications, 0);
    assert.equal(message.flags[MODULE_ID].fumble.ticksApplicationStarted, false);
    assert.equal(harness.errors.length, 1);
});

test("a rejected fumble completion leaves a persistent retry barrier and prevents double application", async (t) => {
    resetHarness();
    t.mock.method(console, "error", () => {});
    const actor = new TestActor("fumble-completion");
    const message = new TestMessage("fumble-completion", {
        actor,
        fumble: fumbleData(),
        rejectCalls: [2],
    });

    await assert.rejects(handleFumbleAction(message, "ticks"), /Could not persist required fumble flag/u);
    await handleFumbleAction(message, "ticks");

    assert.equal(actor.tickApplications, 1);
    assert.equal(message.flags[MODULE_ID].fumble.ticksApplicationStarted, true);
    assert.equal(message.flags[MODULE_ID].fumble.ticksApplied, false);
    assert.equal(message.setFlagCalls, 2, "the retry is blocked by the durable write-ahead marker");
    assert.equal(harness.infos.length, 0, "success is not announced when completion persistence failed");
});

test("the in-memory fumble lock closes the parallel-click gap before the persistent marker is visible", async () => {
    resetHarness();
    const actor = new TestActor("fumble-parallel");
    const message = new TestMessage("fumble-parallel", {
        actor,
        fumble: fumbleData(),
    });

    await Promise.all([
        handleFumbleAction(message, "ticks"),
        handleFumbleAction(message, "ticks"),
    ]);

    assert.equal(actor.tickApplications, 1);
    assert.equal(message.flags[MODULE_ID].fumble.ticksApplicationStarted, true);
    assert.equal(message.flags[MODULE_ID].fumble.ticksApplied, true);
    assert.equal(message.setFlagCalls, 2);
});

test("rejected legacy-tick completion cannot advance the actor twice", async (t) => {
    resetHarness();
    t.mock.method(console, "error", () => {});
    const actor = new TestActor("legacy-ticks");
    const combatant = { id: "combatant", actorId: actor.id, initiative: 10 };
    game.combat.combatants = [combatant];
    const message = new TestMessage("legacy-ticks", { actor, rejectCalls: [2] });
    harness.messages.set(message.id, message);
    const button = actionButton(message, { ticks: "3", message: "Aktion" }, { legacy: true });

    await handleChatCardAction(clickEvent(), button);
    await handleChatCardAction(clickEvent(), button);

    assert.equal(actor.tickApplications, 1);
    assert.equal(combatant.initiative, 13);
    assert.equal(message.flags[MODULE_ID].legacyTickAdvanceStarted, true);
    assert.equal(message.flags[MODULE_ID].legacyTickAdvanceApplied, undefined);
    assert.equal(message.setFlagCalls, 2);
});

test("rejected stun-damage completion cannot apply defense damage twice", async (t) => {
    resetHarness();
    t.mock.method(console, "error", () => {});
    const actor = new TestActor("defense-damage");
    const message = new TestMessage("defense-damage", {
        actor,
        context: { numbingDamage: 3, numbingDamageApplied: false },
        rejectCalls: [2],
    });
    harness.messages.set(message.id, message);
    const button = actionButton(message, { sfDefenseNumbingDamage: "3" });

    await assert.rejects(handleChatCardAction(clickEvent(), button), /Could not persist required context flag/u);
    await handleChatCardAction(clickEvent(), button);

    assert.equal(actor.damageApplications, 1);
    assert.equal(message.flags[MODULE_ID].context.numbingDamageApplicationStarted, true);
    assert.equal(message.flags[MODULE_ID].context.numbingDamageApplied, false);
    assert.equal(message.setFlagCalls, 2);
});

test("rejected generic-damage completion leaves damageApplicationStarted as the retry barrier", async (t) => {
    resetHarness();
    t.mock.method(console, "error", () => {});
    globalThis.CONFIG = { Actor: { documentClass: TestActor } };
    installHealthCostFeedbackInterceptor();
    const actor = new TestActor("generic-damage");
    const message = new TestMessage("generic-damage", { actor, rejectCalls: [2] });
    message.system.handleGenericAction = () => actor.consumeCost("health", "1V1");
    harness.messages.set(message.id, message);
    const button = actionButton(message, { localaction: "applyDamageToSelf" });

    await handleChatCardAction(clickEvent(), button);
    await handleChatCardAction(clickEvent(), button);

    assert.equal(actor.damageApplications, 1);
    assert.equal(message.flags[MODULE_ID].damageApplicationStarted, true);
    assert.equal(message.flags[MODULE_ID].damageApplicationCompleted, undefined);
    assert.equal(message.setFlagCalls, 2);
    assert.equal(harness.completedDamageApplications.has(message.id), false);
});
