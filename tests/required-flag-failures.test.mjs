import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    handleChatCardAction,
} from "../Modul/splittermond-smoother-fight/scripts/features/chat/actions.js";
import {
    applyRemoteDamageApplication,
    getDamageApplicationState,
    getNumbingDamageApplicationState,
} from "../Modul/splittermond-smoother-fight/scripts/features/chat/damage-application.js";
import {
    safeSetFlag,
    setOptionalFlag,
    setRequiredFlag,
} from "../Modul/splittermond-smoother-fight/scripts/features/chat/messages.js";
import { installHealthCostFeedbackInterceptor } from "../Modul/splittermond-smoother-fight/scripts/features/feedback/feedback.js";
import {
    getFumbleActionApplicationState,
    handleFumbleAction,
    recoverFumbleAction,
} from "../Modul/splittermond-smoother-fight/scripts/features/fumbles/fumbles.js";

const MODULE_ID = "splittermond-smoother-fight";
const harness = {
    requestOffenseFollowUp: async (message) => message,
    completedDamageApplications: new Set(),
    errors: [],
    infos: [],
    interruptionRequests: [],
    legacyLocks: new Set(),
    messages: new Map(),
    pendingDamageApplications: [],
    remoteTargets: [],
    tokens: new Map(),
    warnings: [],
};

function clone(value) {
    return structuredClone(value);
}

class TestMessage {
    constructor(id, {
        actor = null,
        content = "",
        context = null,
        fumble = null,
        noResultCalls = [],
        rejectCalls = [],
        skipPersistenceCalls = [],
        type = "base",
    } = {}) {
        this.id = id;
        this.content = content;
        this.type = type;
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
        this.createdItems = [];
        this.tickApplications = 0;
        this.damageApplications = 0;
        this.splinterpointApplications = [];
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
        if (this.tickError) throw this.tickError;
        this.tickApplications += 1;
        const combatant = Array.from(game.combat?.combatants ?? []).find((candidate) => candidate.actorId === this.id);
        if (combatant) combatant.initiative += ticks;
        if (this.tickErrorAfterMutation) throw this.tickErrorAfterMutation;
    }

    async consumeCost() {
        if (this.damageError) throw this.damageError;
        this.damageApplications += 1;
        this.system.health.consumed.value += 1;
        if (this.damageErrorAfterMutation) throw this.damageErrorAfterMutation;
    }

    async createEmbeddedDocuments(documentName, sources) {
        assert.equal(documentName, "Item");
        const created = sources.map((source, index) => {
            const item = clone(source);
            item.id = `${this.id}-item-${this.createdItems.length + index}`;
            item.update = async function update(change) {
                if ("system.level" in change) this.system.level = change["system.level"];
            };
            return item;
        });
        for (const item of created) {
            this.items.set(item.id, item);
            this.createdItems.push(item);
        }
        return created;
    }

    async useSplinterpointBonus(message) {
        this.splinterpointApplications.push(message);
    }
}

configureServices({
    addPendingDamageApplication: (application) => harness.pendingDamageApplications.push(application),
    addPendingLegacyTickMessage: (messageId) => harness.legacyLocks.add(messageId),
    requestOffenseFollowUp: (...args) => harness.requestOffenseFollowUp(...args),
    collectCombatEventGroups: () => [],
    deletePendingLegacyTickMessage: (messageId) => harness.legacyLocks.delete(messageId),
    findPendingDamageApplicationForActor: (actorUuid) => [...harness.pendingDamageApplications]
        .reverse()
        .find((application) => !application.actorUuids.size || application.actorUuids.has(actorUuid)) ?? null,
    getActivePrimaryGm: () => Array.from(game.users ?? []).find((user) => user.isGM && user.active)
        ?? (game.user?.isGM ? game.user : null),
    getHudContext: () => null,
    getTargetSelectionForUser: () => ({ targets: harness.remoteTargets }),
    getMessageContext: (message) => message?.flags?.[MODULE_ID]?.context ?? null,
    getRuntimeController: () => game.user,
    getSceneTokens: () => [],
    handleFumbleAction,
    hasCompletedDamageApplication: (messageId) => harness.completedDamageApplications.has(messageId),
    hasPendingLegacyTickMessage: (messageId) => harness.legacyLocks.has(messageId),
    isDefenseMessage: () => false,
    isOwnMessage: (message) => (message.author?.id ?? message.user) === game.user.id,
    recordCompletedDamageApplication: (messageId) => harness.completedDamageApplications.add(messageId),
    requestContinuousActionInterruptionForDamage: async (request) => harness.interruptionRequests.push(request),
    removePendingDamageApplication: (application) => {
        const index = harness.pendingDamageApplications.lastIndexOf(application);
        if (index >= 0) harness.pendingDamageApplications.splice(index, 1);
    },
    resolveSpeakerActor: (message) => message?.actor ?? null,
    resolveToken: (uuid) => harness.tokens.get(uuid) ?? null,
    mayUserApplyDamageToActor: (user, actor) => Boolean(user?.isGM || actor?.testUserPermission?.(user, "OWNER")),
    scheduleRender: () => {},
    setRequiredFlag,
    speakerTokenUuid: () => null,
    withTemporarySystemTargets: (_targets, operation) => operation(),
});

function resetHarness() {
    harness.requestOffenseFollowUp = async (message) => message;
    harness.completedDamageApplications.clear();
    harness.errors.length = 0;
    harness.infos.length = 0;
    harness.interruptionRequests.length = 0;
    harness.legacyLocks.clear();
    harness.messages.clear();
    harness.pendingDamageApplications.length = 0;
    harness.remoteTargets.length = 0;
    harness.tokens.clear();
    harness.warnings.length = 0;
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
        users: [],
    };
    globalThis.ui = {
        notifications: {
            error: (message) => harness.errors.push(message),
            info: (message) => harness.infos.push(message),
            warn: (message) => harness.warnings.push(message),
        },
    };
    globalThis.foundry = { utils: { randomID: () => "feedback" } };
}

test("a stale damage control cannot run against a defense successor that no longer offers it", async () => {
    resetHarness();
    const actor = new TestActor("stale-damage-attacker");
    const original = new TestMessage("stale-damage-original", {
        actor,
        content: '<button class="splittermond-chat-action" data-action="rollDamage">Damage</button>',
        type: "attackRollMessage",
    });
    const successor = new TestMessage("stale-damage-successor", {
        actor,
        content: '<button class="splittermond-chat-action" data-action="advanceToken">Ticks</button>',
        type: "attackRollMessage",
    });
    let genericActions = 0;
    successor.system.handleGenericAction = async () => {
        genericActions += 1;
    };
    harness.messages.set(original.id, original);
    harness.messages.set(successor.id, successor);
    harness.requestOffenseFollowUp = async () => successor;

    await handleChatCardAction(clickEvent(), actionButton(original, { action: "rollDamage" }));

    assert.equal(genericActions, 0);
    assert.deepEqual(harness.warnings, ["SMOOTHER_FIGHT.HUD.FollowUpNoLongerAvailable"]);
});

function clickEvent() {
    return {
        preventDefault() {},
        stopPropagation() {},
    };
}

function actionButton(message, dataset, { legacy = false, legacySplinterpoint = false } = {}) {
    return {
        closest: (selector) => selector === ".sf-chat-message" ? { dataset: { messageId: message.id } } : null,
        dataset,
        disabled: false,
        isConnected: true,
        matches: (selector) => (legacy && selector === ".add-tick[data-ticks]")
            || (legacySplinterpoint && selector === ".use-splinterpoint"),
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

test("player splinterpoint actions dispatch directly through the Splittermond socket", async () => {
    resetHarness();
    const emitted = [];
    const player = { id: "player", isGM: false, targets: new Set() };
    const actor = new TestActor("splinterpoint-actor");
    const message = new TestMessage("splinterpoint", { actor });
    harness.messages.set(message.id, message);
    game.user = player;
    game.users = [player, { id: "gm", isGM: true, active: true }];
    game.socket.emit = (...args) => emitted.push(args);

    await handleChatCardAction(
        clickEvent(),
        actionButton(message, { action: "useSplinterpoint" })
    );

    assert.deepEqual(emitted, [[
        "system.splittermond",
        {
            type: "chatAction",
            action: "useSplinterpoint",
            messageId: message.id,
            userId: player.id,
        },
    ]]);
});

test("legacy active-defense splinterpoints use the speaker actor from the HUD", async () => {
    resetHarness();
    const actor = new TestActor("defender");
    const message = new TestMessage("legacy-defense", { actor });
    harness.messages.set(message.id, message);

    await handleChatCardAction(
        clickEvent(),
        actionButton(message, {}, { legacySplinterpoint: true })
    );

    assert.deepEqual(actor.splinterpointApplications, [message]);
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

test("a rejected fumble effect without a mutation returns to idle and can be retried", async (t) => {
    resetHarness();
    t.mock.method(console, "error", () => {});
    const actor = new TestActor("fumble-retry");
    const combatant = { id: "fumble-combatant", actorId: actor.id, initiative: 10 };
    game.combat.combatants = [combatant];
    const message = new TestMessage("fumble-retry", { actor, fumble: fumbleData() });
    actor.tickError = new Error("ticks rejected");

    await assert.rejects(handleFumbleAction(message, "ticks"), /ticks rejected/u);
    assert.equal(getFumbleActionApplicationState(message, "ticks"), "idle");
    assert.equal(combatant.initiative, 10);

    actor.tickError = null;
    await handleFumbleAction(message, "ticks");
    assert.equal(combatant.initiative, 13);
    assert.equal(getFumbleActionApplicationState(message, "ticks"), "completed");
});

test("a rejected fumble effect after a mutation becomes uncertain", async (t) => {
    resetHarness();
    t.mock.method(console, "error", () => {});
    const actor = new TestActor("fumble-partial");
    const combatant = { id: "fumble-combatant", actorId: actor.id, initiative: 10 };
    game.combat.combatants = [combatant];
    const message = new TestMessage("fumble-partial", { actor, fumble: fumbleData() });
    actor.tickErrorAfterMutation = new Error("ticks failed late");

    await assert.rejects(handleFumbleAction(message, "ticks"), /ticks failed late/u);
    assert.equal(combatant.initiative, 13);
    assert.equal(getFumbleActionApplicationState(message, "ticks"), "uncertain");
    await handleFumbleAction(message, "ticks");
    assert.equal(combatant.initiative, 13);
});

test("a rejected fumble completion becomes uncertain and prevents double application", async (t) => {
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
    assert.equal(message.flags[MODULE_ID].fumble.applications.ticks.state, "uncertain");
    assert.equal(getFumbleActionApplicationState(message, "ticks"), "uncertain");
    assert.equal(message.setFlagCalls, 3, "the explicit uncertain state blocks the retry");
    assert.equal(harness.infos.length, 0, "success is not announced when completion persistence failed");

    await recoverFumbleAction(message, "ticks", "complete");
    assert.equal(getFumbleActionApplicationState(message, "ticks"), "completed");
    assert.equal(message.flags[MODULE_ID].fumble.ticksApplied, true);
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

test("fumble conditions are embedded only in the actor identified by the token actor UUID", async (t) => {
    resetHarness();
    const speakerActor = new TestActor("speaker-actor");
    const tokenActor = new TestActor("synthetic-token-actor");
    tokenActor.uuid = "Scene.scene.Token.token.Actor.synthetic-token-actor";
    const fumble = {
        ...fumbleData(),
        actorUuid: tokenActor.uuid,
        ticks: 0,
        conditions: [
            { name: "Erschöpft", level: 2, uuid: null, durationTicks: null },
            { name: "Benommen", level: 1, uuid: null, durationTicks: 30 },
        ],
    };
    const message = new TestMessage("token-fumble", { actor: speakerActor, fumble });
    const previousFromUuidSync = globalThis.fromUuidSync;
    globalThis.fromUuidSync = (uuid) => uuid === tokenActor.uuid ? tokenActor : null;
    t.after(() => {
        if (previousFromUuidSync === undefined) delete globalThis.fromUuidSync;
        else globalThis.fromUuidSync = previousFromUuidSync;
    });

    await handleFumbleAction(message, "conditions");

    assert.equal(speakerActor.createdItems.length, 0);
    assert.deepEqual(tokenActor.createdItems.map((item) => [
        item.name,
        item.system.level,
        item.system.combatEvent.interval,
    ]), [
        ["Erschöpft", 2, null],
        ["Benommen", 1, 30],
    ]);
    assert.equal(getFumbleActionApplicationState(message, "conditions"), "completed");
});

test("a weapon fumble advances the source weapon through Splittermond's persistent damage fields", async () => {
    resetHarness();
    const actor = new TestActor("weapon-actor");
    const weapon = {
        id: "weapon-id",
        name: "Langschwert",
        type: "weapon",
        system: { durability: 5, sufferedDamage: 6, damageLevel: 1 },
        async update(change) {
            assert.deepEqual(change, { "system.sufferedDamage": 11 });
            this.system.sufferedDamage = change["system.sufferedDamage"];
            this.system.damageLevel = 2;
        },
    };
    actor.items.set(weapon.id, weapon);
    const message = new TestMessage("weapon-fumble", {
        actor,
        fumble: {
            ...fumbleData(),
            ticks: 0,
            damagesWeapon: true,
            sourceItemId: weapon.id,
        },
    });

    await handleFumbleAction(message, "weapon");

    assert.equal(weapon.system.sufferedDamage, 11);
    assert.equal(weapon.system.damageLevel, 2);
    assert.equal(getFumbleActionApplicationState(message, "weapon"), "completed");
});

test("rejected legacy-tick completion becomes uncertain and cannot advance the actor twice", async (t) => {
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
    assert.equal(message.flags[MODULE_ID].legacyTickAdvance.state, "uncertain");
    assert.equal(message.flags[MODULE_ID].legacyTickAdvanceStarted, undefined);
    assert.equal(message.flags[MODULE_ID].legacyTickAdvanceApplied, undefined);
    assert.equal(message.setFlagCalls, 3);

    await handleChatCardAction(clickEvent(), actionButton(message, {
        sfLegacyTickRecovery: "complete",
    }));
    assert.equal(message.flags[MODULE_ID].legacyTickAdvance.state, "completed");
});

test("a rejected legacy tick without an initiative change returns to idle", async (t) => {
    resetHarness();
    t.mock.method(console, "error", () => {});
    const actor = new TestActor("legacy-retry");
    actor.tickError = new Error("ticks rejected");
    const combatant = { id: "combatant", actorId: actor.id, initiative: 7 };
    game.combat.combatants = [combatant];
    const message = new TestMessage("legacy-retry", { actor });
    harness.messages.set(message.id, message);
    const button = actionButton(message, { ticks: "2" }, { legacy: true });

    await handleChatCardAction(clickEvent(), button);
    assert.equal(message.flags[MODULE_ID].legacyTickAdvance.state, "idle");
    assert.equal(combatant.initiative, 7);

    actor.tickError = null;
    await handleChatCardAction(clickEvent(), button);
    assert.equal(message.flags[MODULE_ID].legacyTickAdvance.state, "completed");
    assert.equal(combatant.initiative, 9);
});

test("a rejected legacy tick after initiative changed becomes uncertain", async (t) => {
    resetHarness();
    t.mock.method(console, "error", () => {});
    const actor = new TestActor("legacy-partial");
    actor.tickErrorAfterMutation = new Error("ticks failed late");
    const combatant = { id: "combatant", actorId: actor.id, initiative: 4 };
    game.combat.combatants = [combatant];
    const message = new TestMessage("legacy-partial", { actor });
    harness.messages.set(message.id, message);
    const button = actionButton(message, { ticks: "3" }, { legacy: true });

    await handleChatCardAction(clickEvent(), button);
    assert.equal(message.flags[MODULE_ID].legacyTickAdvance.state, "uncertain");
    assert.equal(combatant.initiative, 7);
    await handleChatCardAction(clickEvent(), button);
    assert.equal(combatant.initiative, 7);
});

test("rejected stun-damage completion becomes uncertain and cannot apply defense damage twice", async (t) => {
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

    await handleChatCardAction(clickEvent(), button);
    await handleChatCardAction(clickEvent(), button);

    assert.equal(actor.damageApplications, 1);
    assert.equal(message.flags[MODULE_ID].context.numbingDamageApplicationStarted, true);
    assert.equal(message.flags[MODULE_ID].context.numbingDamageApplied, false);
    assert.equal(message.flags[MODULE_ID].context.numbingDamageApplication.state, "uncertain");
    assert.equal(getNumbingDamageApplicationState(message), "uncertain");
    assert.equal(message.setFlagCalls, 3);
});

test("rejected generic-damage completion becomes uncertain and remains a retry barrier", async (t) => {
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
    assert.equal(message.flags[MODULE_ID].damageApplication.state, "uncertain");
    assert.equal(getDamageApplicationState(message), "uncertain");
    assert.equal(message.setFlagCalls, 3);
    assert.equal(harness.completedDamageApplications.has(message.id), false);
});

test("missing linked targets abort before starting damage and remain retryable", async () => {
    resetHarness();
    const message = new TestMessage("missing-linked-target", {
        context: { primaryTargetTokenUuid: "Scene.scene.Token.missing" },
    });
    harness.messages.set(message.id, message);
    const button = actionButton(message, { localaction: "applyDamageToUserTargets" });

    await handleChatCardAction(clickEvent(), button);
    await handleChatCardAction(clickEvent(), button);

    assert.equal(getDamageApplicationState(message), "idle");
    assert.equal(message.setFlagCalls, 0);
    assert.equal(harness.warnings.length, 2);
});

test("missing target permission aborts before starting damage and remains retryable", async () => {
    resetHarness();
    const player = { id: "player", isGM: false, targets: new Set() };
    game.user = player;
    const targetActor = new TestActor("unowned-target");
    targetActor.testUserPermission = () => false;
    const target = {
        id: "unowned-target",
        uuid: "Scene.scene.Token.unowned-target",
        actor: targetActor,
        object: {},
    };
    harness.tokens.set(target.uuid, target);
    const message = new TestMessage("unowned-linked-target", {
        context: { primaryTargetTokenUuid: target.uuid },
    });
    harness.messages.set(message.id, message);
    const button = actionButton(message, { localaction: "applyDamageToUserTargets" });

    await handleChatCardAction(clickEvent(), button);

    assert.equal(getDamageApplicationState(message), "idle");
    assert.equal(message.setFlagCalls, 0);
    assert.equal(harness.warnings.length, 1);
});

test("a rejected health cost without a health mutation returns generic damage to idle", async (t) => {
    resetHarness();
    t.mock.method(console, "error", () => {});
    globalThis.CONFIG = { Actor: { documentClass: TestActor } };
    installHealthCostFeedbackInterceptor();
    const actor = new TestActor("generic-safe-failure");
    actor.damageError = new Error("No health cost was consumed");
    const message = new TestMessage("generic-safe-failure", { actor });
    message.system.handleGenericAction = () => actor.consumeCost("health", "1V1");
    harness.messages.set(message.id, message);
    const button = actionButton(message, { localaction: "applyDamageToSelf" });

    await handleChatCardAction(clickEvent(), button);
    assert.equal(getDamageApplicationState(message), "idle");
    assert.equal(actor.damageApplications, 0);

    actor.damageError = null;
    await handleChatCardAction(clickEvent(), button);
    assert.equal(getDamageApplicationState(message), "completed");
    assert.equal(actor.damageApplications, 1);
});

test("a rejected health cost after a mutation becomes uncertain", async (t) => {
    resetHarness();
    t.mock.method(console, "error", () => {});
    const actor = new TestActor("generic-ambiguous-failure");
    actor.damageErrorAfterMutation = new Error("Health changed before the failure");
    const message = new TestMessage("generic-ambiguous-failure", { actor });
    message.system.handleGenericAction = () => actor.consumeCost("health", "1V1");
    harness.messages.set(message.id, message);
    const button = actionButton(message, { localaction: "applyDamageToSelf" });

    await handleChatCardAction(clickEvent(), button);
    await handleChatCardAction(clickEvent(), button);

    assert.equal(getDamageApplicationState(message), "uncertain");
    assert.equal(actor.damageApplications, 1);
});

test("parallel generic-damage clicks produce one completed application", async () => {
    resetHarness();
    const actor = new TestActor("parallel-generic-damage");
    let releaseAction;
    const actionGate = new Promise((resolve) => {
        releaseAction = resolve;
    });
    const message = new TestMessage("parallel-generic-damage", { actor });
    message.system.handleGenericAction = async () => {
        await actionGate;
        return actor.consumeCost("health", "1V1");
    };
    harness.messages.set(message.id, message);
    const button = actionButton(message, { localaction: "applyDamageToSelf" });

    const first = handleChatCardAction(clickEvent(), button);
    const second = handleChatCardAction(clickEvent(), button);
    releaseAction();
    await Promise.all([first, second]);

    assert.equal(actor.damageApplications, 1);
    assert.equal(getDamageApplicationState(message), "completed");
    assert.equal(message.setFlagCalls, 2);
    assert.deepEqual(harness.interruptionRequests, [{
        actorUuid: actor.uuid,
        tokenUuid: null,
        damage: 1,
        sourceMessageId: message.id,
    }]);
});

test("remote multi-target damage is completed only after every observed health cost", async () => {
    resetHarness();
    const player = { id: "player", isGM: false, targets: new Set() };
    const firstActor = new TestActor("remote-first");
    const secondActor = new TestActor("remote-second");
    harness.remoteTargets.push(
        { actor: firstActor, object: {} },
        { actor: secondActor, object: {} }
    );
    const message = new TestMessage("remote-multi-target");
    message.system.handleGenericAction = async () => {
        await firstActor.consumeCost("health", "1V1");
        await secondActor.consumeCost("health", "1V1");
    };
    harness.messages.set(message.id, message);

    const result = await applyRemoteDamageApplication(
        message,
        { action: "applyDamageToTargets" },
        player
    );

    assert.deepEqual(result, { state: "completed", error: null });
    assert.equal(firstActor.damageApplications, 1);
    assert.equal(secondActor.damageApplications, 1);
    assert.equal(getDamageApplicationState(message), "completed");
});

test("a rejected stun cost without a health mutation returns to idle and can be retried", async (t) => {
    resetHarness();
    t.mock.method(console, "error", () => {});
    const actor = new TestActor("stun-safe-failure");
    actor.damageError = new Error("No stun damage was consumed");
    const message = new TestMessage("stun-safe-failure", {
        actor,
        context: { numbingDamage: 3 },
    });
    harness.messages.set(message.id, message);
    const button = actionButton(message, { sfDefenseNumbingDamage: "3" });

    await handleChatCardAction(clickEvent(), button);
    assert.equal(getNumbingDamageApplicationState(message), "idle");
    assert.equal(actor.damageApplications, 0);

    actor.damageError = null;
    await handleChatCardAction(clickEvent(), button);
    assert.equal(getNumbingDamageApplicationState(message), "completed");
    assert.equal(actor.damageApplications, 1);
});

test("GM recovery can release or complete an uncertain generic damage application", async () => {
    resetHarness();
    const message = new TestMessage("damage-recovery");
    message.flags[MODULE_ID].damageApplication = {
        state: "uncertain",
        attemptId: "attempt",
        startedAt: Date.now() - 60_000,
    };
    harness.messages.set(message.id, message);

    await handleChatCardAction(
        clickEvent(),
        actionButton(message, { sfDamageRecovery: "retry", sfDamageKind: "generic" })
    );
    assert.equal(getDamageApplicationState(message), "idle");

    message.flags[MODULE_ID].damageApplication.state = "uncertain";
    await handleChatCardAction(
        clickEvent(),
        actionButton(message, { sfDamageRecovery: "complete", sfDamageKind: "generic" })
    );
    assert.equal(getDamageApplicationState(message), "completed");
});

test("GM recovery can release or complete uncertain defense stun damage", async () => {
    resetHarness();
    const message = new TestMessage("stun-recovery", {
        context: {
            numbingDamage: 3,
            numbingDamageApplication: {
                state: "uncertain",
                attemptId: "attempt",
                startedAt: Date.now() - 60_000,
            },
            numbingDamageApplicationStarted: true,
            numbingDamageApplied: false,
        },
    });
    harness.messages.set(message.id, message);

    await handleChatCardAction(
        clickEvent(),
        actionButton(message, { sfDamageRecovery: "retry", sfDamageKind: "numbing" })
    );
    assert.equal(getNumbingDamageApplicationState(message), "idle");
    assert.equal(message.flags[MODULE_ID].context.numbingDamageApplicationStarted, false);

    message.flags[MODULE_ID].context.numbingDamageApplication.state = "uncertain";
    await handleChatCardAction(
        clickEvent(),
        actionButton(message, { sfDamageRecovery: "complete", sfDamageKind: "numbing" })
    );
    assert.equal(getNumbingDamageApplicationState(message), "completed");
    assert.equal(message.flags[MODULE_ID].context.numbingDamageApplied, true);
});

test("stale applying records become uncertain while recent attempts remain applying", () => {
    resetHarness();
    const now = Date.now();
    const message = new TestMessage("stale-applying");
    message.flags[MODULE_ID].damageApplication = {
        state: "applying",
        attemptId: "attempt",
        startedAt: now,
    };

    assert.equal(getDamageApplicationState(message, now + 1_000), "applying");
    assert.equal(getDamageApplicationState(message, now + 31_000), "uncertain");
});

test("legacy started-only flags are treated as uncertain until a GM recovers them", () => {
    resetHarness();
    const damage = new TestMessage("legacy-damage");
    damage.flags[MODULE_ID].damageApplicationStarted = true;
    const stun = new TestMessage("legacy-stun", {
        context: { numbingDamageApplicationStarted: true, numbingDamageApplied: false },
    });

    assert.equal(getDamageApplicationState(damage), "uncertain");
    assert.equal(getNumbingDamageApplicationState(stun), "uncertain");
});
