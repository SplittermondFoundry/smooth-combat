import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import { MODULE_ID } from "../Modul/splittermond-smoother-fight/scripts/core/constants.js";
import { handleChatCardAction } from "../Modul/splittermond-smoother-fight/scripts/features/chat/action-dispatch.js";
import { getDamageApplicationState } from "../Modul/splittermond-smoother-fight/scripts/features/chat/damage-application.js";
import { setRequiredFlag } from "../Modul/splittermond-smoother-fight/scripts/features/chat/messages.js";
import {
    addPendingDamageApplication,
    findPendingDamageApplicationForActor,
    hasCompletedDamageApplication,
    recordCompletedDamageApplication,
    removePendingDamageApplication,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-events/service.js";
import { analyzeCombatEventGroups } from "../Modul/splittermond-smoother-fight/scripts/features/combat-events/workflow.js";
import { installHealthCostFeedbackInterceptor, withTrackedHealthCosts } from "../Modul/splittermond-smoother-fight/scripts/features/feedback/feedback.js";
import { withTemporarySystemTargets } from "../Modul/splittermond-smoother-fight/scripts/features/targeting/targeting.js";

let fixture;
configureServices({
    addPendingDamageApplication,
    findPendingDamageApplicationForActor,
    hasCompletedDamageApplication,
    recordCompletedDamageApplication,
    removePendingDamageApplication,
    getDamageApplicationState,
    setRequiredFlag,
    withTemporarySystemTargets,
    withTrackedHealthCosts,
    canAdvanceCombatWorkflowTicks: () => true,
    collectCombatEventGroups: () => [fixture.group],
    defenseAwaitsResponse: () => false,
    getMessageContext: (message) => message?.flags?.[MODULE_ID]?.context ?? null,
    getHudContext: () => ({ target: fixture.target }),
    getSceneTokens: () => [fixture.target],
    resolveToken: (uuid) => uuid === fixture.target.uuid ? fixture.target : null,
    resolveSpeakerActor: () => fixture.attacker,
    mayUserApplyDamageToActor: () => true,
    scheduleRender: () => {},
    requestContinuousActionInterruptionForDamage: async (request) => fixture.interruptions.push(request),
});

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function installFixture(t, action = "applyDamageToUserTargets", {
    hook = "installed", damage = 3, cancelled = false, fails = false, method = "consumeCost",
} = {}) {
    const previous = Object.fromEntries(["game", "CONFIG", "canvas", "foundry", "ui"].map((key) => [key, globalThis[key]]));
    t.after(() => Object.assign(globalThis, previous));
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const costStarted = deferred();
    const costFinished = deferred();
    const costArgument = method === "applyCost"
        ? Object.freeze({ consumed: damage, exhausted: 0, channeled: 0 })
        : String(damage);
    class Actor {
        uuid = "Scene.scene.Token.target.Actor.target";
        system = { health: { consumed: { value: 0 }, exhausted: { value: 0 }, channeled: { value: 0 } } };
        async [method](resource, cost) {
            assert.equal(resource, "health");
            assert.equal(cost, costArgument, "preserve the native cost object or legacy string");
            costStarted.resolve();
            await costFinished.promise;
            this.system.health.consumed.value += method === "applyCost" ? cost.consumed : Number(cost);
            if (fails) throw new Error("Health updated, later operation failed");
        }
    }
    const actor = new Actor();
    const attacker = { uuid: "Actor.attacker" };
    const target = { id: "target", uuid: "Scene.scene.Token.target", actor };
    target.object = { document: target };
    const offense = {
        id: `${t.name}-attack`, type: "attackRollMessage", timestamp: 1,
        content: '<button data-action="advanceToken">Ticks</button>',
        flags: { [MODULE_ID]: { context: { primaryTargetTokenUuid: target.uuid } } },
    };
    const message = {
        id: `${t.name}-damage`, type: "damageMessage", timestamp: 2,
        content: `<button data-local-action="${action}">Apply</button>`,
        flags: { [MODULE_ID]: { context: { primaryTargetTokenUuid: target.uuid } } },
        getFlag(scope, key) { return this.flags[scope]?.[key]; },
        async setFlag(scope, key, value) {
            this.flags[scope][key] = structuredClone(value);
            return this;
        },
        system: {
            // Both native versions await the dialog but not the resource update:
            // 14.2.7 uses consumeCost(health, string), 14.3 beta3 applyCost(health, cost).
            async handleGenericAction(data) {
                assert.equal(data.action, "applyDamageToTargets");
                await Promise.resolve();
                if (cancelled) return;
                for (const selected of game.user.targets) {
                    void selected.document.actor[method]("health", costArgument);
                }
            },
        },
    };
    fixture = { actor, attacker, target, offense, message, interruptions: [], errors: [], costStarted, costFinished,
        group: { primary: offense, kind: "attack", damages: [message], defenses: [], fumbles: [] } };
    globalThis.game = {
        user: { id: "gm", isGM: true, targets: new Set(action === "applyDamageToTargets" ? [target.object] : []) },
        messages: new Map([[offense.id, offense], [message.id, message]]),
        i18n: { localize: (key) => key },
        settings: { get: () => false },
    };
    globalThis.canvas = { tokens: { get: () => target.object } };
    globalThis.CONFIG = { Actor: { documentClass: Actor } };
    globalThis.foundry = { utils: { randomID: () => "attempt" } };
    globalThis.ui = { notifications: { error: (value) => fixture.errors.push(value), warn: (value) => assert.fail(value) } };
    const original = Actor.prototype[method];
    if (hook !== "missing") installHealthCostFeedbackInterceptor();
    if (hook === "replaced") Actor.prototype[method] = original;
    if (hook === "instance") Object.defineProperty(actor, method, { configurable: true, writable: true, value: original });
    fixture.originalDescriptor = Object.getOwnPropertyDescriptor(actor, method);
    const button = { dataset: { localAction: action }, closest: (selector) => selector === ".sf-chat-message"
        ? { dataset: { messageId: message.id } } : null };
    fixture.click = () => handleChatCardAction({ preventDefault() {} }, button);
    fixture.focus = () => analyzeCombatEventGroups([fixture.group]).focus;
    return fixture;
}

for (const action of ["applyDamageToTargets", "applyDamageToUserTargets"]) {
    for (const hook of ["installed", "missing", "replaced", "instance"]) {
        test(`Splittermond 14.3 applyCost: GM HUD ${action}, ${hook} hook`, async (t) => {
            const f = installFixture(t, action, { hook, method: "applyCost", damage: 7 });
            const operation = f.click();
            await f.costStarted.promise;
            assert.equal(getDamageApplicationState(f.message), "applying");
            assert.equal(f.focus().messageId, f.message.id);
            f.costFinished.resolve();
            await operation;
            assert.equal(f.actor.system.health.consumed.value, 7);
            assert.equal(getDamageApplicationState(f.message), "completed");
            assert.equal(f.focus().messageId, f.offense.id);
            assert.equal(f.interruptions.length, 1);
            assert.deepEqual(f.errors, []);
            assert.deepEqual(Object.getOwnPropertyDescriptor(f.actor, "applyCost"), f.originalDescriptor);
            await f.click();
            assert.equal(f.actor.system.health.consumed.value, 7);
        });
    }
}

for (const action of ["applyDamageToTargets", "applyDamageToUserTargets"]) {
    for (const hook of ["installed", "missing", "replaced", "instance"]) {
        test(`GM HUD ${action}, ${hook} feedback hook: returns to attack ticks after the health update`, async (t) => {
            const f = installFixture(t, action, { hook });
            assert.equal(f.focus().messageId, f.message.id);
            const operation = f.click();
            await f.costStarted.promise;
            assert.equal(getDamageApplicationState(f.message), "applying");
            assert.equal(f.focus().messageId, f.message.id);
            f.costFinished.resolve();
            await operation;
            assert.equal(f.actor.system.health.consumed.value, 3);
            assert.equal(getDamageApplicationState(f.message), "completed");
            assert.equal(f.focus().messageId, f.offense.id);
            assert.equal(f.interruptions.length, 1);
            assert.deepEqual(f.errors, []);
            assert.deepEqual(Object.getOwnPropertyDescriptor(f.actor, "consumeCost"), f.originalDescriptor);
            await f.click();
            assert.equal(f.actor.system.health.consumed.value, 3, "completed damage cannot be applied twice");
        });
    }
}

test("cancelling the GM damage dialog keeps the damage action open and restores the actor", async (t) => {
    const f = installFixture(t, "applyDamageToUserTargets", { hook: "missing", cancelled: true });
    await f.click();
    assert.equal(getDamageApplicationState(f.message), "idle");
    assert.equal(f.focus().messageId, f.message.id);
    assert.equal(f.actor.system.health.consumed.value, 0);
    assert.deepEqual(Object.getOwnPropertyDescriptor(f.actor, "consumeCost"), f.originalDescriptor);
});

test("confirmed zero damage also completes the damage step without the ready hook", async (t) => {
    const f = installFixture(t, "applyDamageToUserTargets", { hook: "missing", damage: 0 });
    const operation = f.click();
    await f.costStarted.promise;
    f.costFinished.resolve();
    await operation;
    assert.equal(getDamageApplicationState(f.message), "completed");
    assert.equal(f.focus().messageId, f.offense.id);
    assert.equal(f.actor.system.health.consumed.value, 0);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.interruptions, []);
});

test("a failed cost after damage changed remains uncertain and cannot apply damage twice", async (t) => {
    t.mock.method(console, "error", () => {});
    const f = installFixture(t, "applyDamageToUserTargets", { hook: "missing", fails: true });
    const operation = f.click();
    await f.costStarted.promise;
    f.costFinished.resolve();
    await operation;
    assert.equal(getDamageApplicationState(f.message), "uncertain");
    assert.equal(f.focus().messageId, f.message.id);
    await f.click();
    assert.equal(f.actor.system.health.consumed.value, 3);
    assert.deepEqual(Object.getOwnPropertyDescriptor(f.actor, "consumeCost"), f.originalDescriptor);
});

test("overlapping observations restore the method when the earlier action finishes first", async (t) => {
    const f = installFixture(t);
    const first = { completionPromises: [] };
    const second = { completionPromises: [] };
    const firstGate = deferred();
    const secondGate = deferred();
    const a = withTrackedHealthCosts(first, [f.actor], () => firstGate.promise);
    const b = withTrackedHealthCosts(second, [f.actor], async () => {
        await secondGate.promise;
        return f.actor.consumeCost("health", "3");
    });
    firstGate.resolve();
    await a;
    secondGate.resolve();
    f.costFinished.resolve();
    await b;
    assert.deepEqual(first.completionPromises, []);
    assert.equal((await Promise.all(second.completionPromises)).length, 1);
    assert.deepEqual(Object.getOwnPropertyDescriptor(f.actor, "consumeCost"), f.originalDescriptor);
});

test("a method replacement during an observation survives cleanup", async (t) => {
    const f = installFixture(t);
    const replacement = () => "new implementation";
    await withTrackedHealthCosts({ completionPromises: [] }, [f.actor], async () => {
        f.actor.consumeCost = replacement;
    });
    assert.equal(f.actor.consumeCost, replacement);
});

for (const options of [{ cancelled: true }, { damage: 0 }, { fails: true }]) {
    test(`applyCost preserves cancellation, zero-damage and failure semantics: ${JSON.stringify(options)}`, async (t) => {
        t.mock.method(console, "error", () => {});
        const f = installFixture(t, "applyDamageToUserTargets", { ...options, method: "applyCost", hook: "missing" });
        const operation = f.click();
        if (!options.cancelled) {
            await f.costStarted.promise;
            f.costFinished.resolve();
        }
        await operation;
        const expected = options.cancelled ? "idle" : options.fails ? "uncertain" : "completed";
        assert.equal(getDamageApplicationState(f.message), expected);
        assert.equal(f.focus().messageId, expected === "completed" ? f.offense.id : f.message.id);
        assert.deepEqual(Object.getOwnPropertyDescriptor(f.actor, "applyCost"), f.originalDescriptor);
    });
}

test("legacy and modern cost methods delegating to each other record damage once", async (t) => {
    const f = installFixture(t);
    class CompatibleActor {
        uuid = f.actor.uuid;
        system = f.actor.system;
        consumeCost(resource, cost) { return this.applyCost(resource, { consumed: Number(cost) }); }
        applyCost(resource, cost) {
            assert.equal(resource, "health");
            this.system.health.consumed.value += cost.consumed;
            return Promise.resolve("applied");
        }
    }
    const actor = new CompatibleActor();
    CONFIG.Actor.documentClass = CompatibleActor;
    installHealthCostFeedbackInterceptor();
    const original = actor.applyCost;
    installHealthCostFeedbackInterceptor();
    assert.equal(actor.applyCost, original, "ready interception is idempotent");
    const application = { completionPromises: [] };
    assert.equal(await withTrackedHealthCosts(application, [actor], () => actor.consumeCost("health", "7")), "applied");
    const outcomes = await Promise.all(application.completionPromises);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].damage, 7);
    assert.equal(Object.hasOwn(actor, "consumeCost"), false);
    assert.equal(Object.hasOwn(actor, "applyCost"), false);
});

test("focus applyCost calls preserve their arguments and do not complete a damage application", async (t) => {
    installFixture(t);
    const cost = Object.freeze({ consumed: 2, exhausted: 1, channeled: 0 });
    const result = Promise.resolve("focus applied");
    const actor = {
        applyCost(resource, value, description) {
            assert.equal(resource, "focus");
            assert.equal(value, cost);
            assert.equal(description, "Spell");
            return result;
        },
    };
    const application = { completionPromises: [] };
    await withTrackedHealthCosts(application, [actor], () => {
        assert.equal(actor.applyCost("focus", cost, "Spell"), result);
    });
    assert.deepEqual(application.completionPromises, []);
});
