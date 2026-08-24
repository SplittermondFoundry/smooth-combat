import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    getMovementReversalApplicationStatus,
    getPreparationApplicationStatus,
    prepareCombatAction,
    recoverMovementReversalApplication,
    recoverPreparationApplication,
    resetCompletedMovementReversalApplication,
    revertTokenMovementApplication,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/applications.js";

const MODULE_ID = "splittermond-smoother-fight";

configureServices({
    scheduleRender: () => {},
});

function installGlobals(combatant = null) {
    const combatants = combatant ? [combatant] : [];
    combatants.get = (id) => combatants.find((candidate) => candidate.id === id);
    globalThis.game = {
        combat: { combatants },
        i18n: {
            format: (key) => key,
            localize: (key) => key,
        },
        user: { id: "gm", isGM: true },
    };
    globalThis.ui = {
        notifications: {
            error: () => {},
            info: () => {},
        },
    };
}

class TestActor {
    constructor(combatant) {
        this.id = "actor";
        this.uuid = "Actor.actor";
        this.combatant = combatant;
        this.flags = { splittermond: {}, [MODULE_ID]: {} };
        this.tickCalls = 0;
        this.rejectPreparedFlag = false;
        this.rejectPreparationState = false;
        this.tickError = null;
    }

    getFlag(scope, key) {
        return this.flags[scope]?.[key];
    }

    async setFlag(scope, key, value) {
        if (scope === "splittermond" && key.startsWith("prepared") && this.rejectPreparedFlag) {
            throw new Error("prepared flag rejected");
        }
        if (scope === MODULE_ID && key === "preparationApplication" && this.rejectPreparationState) {
            throw new Error("preparation state rejected");
        }
        this.flags[scope] ??= {};
        this.flags[scope][key] = structuredClone(value);
        return this;
    }

    async addTicks(ticks) {
        this.tickCalls += 1;
        if (this.tickError) throw this.tickError;
        this.combatant.initiative += ticks;
    }
}

class TestToken {
    constructor() {
        this.id = "token";
        this.uuid = "Scene.scene.Token.token";
        this.x = 100;
        this.y = 0;
        this.elevation = 0;
        this.movementHistory = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
        this.flags = { [MODULE_ID]: {} };
        this.revertCalls = 0;
        this.clearCalls = 0;
        this.clearError = null;
        this.rejectState = false;
    }

    getFlag(scope, key) {
        return this.flags[scope]?.[key];
    }

    async setFlag(scope, key, value) {
        if (this.rejectState) throw new Error("movement state rejected");
        this.flags[scope] ??= {};
        this.flags[scope][key] = structuredClone(value);
        return this;
    }

    async revertRecordedMovement() {
        this.revertCalls += 1;
        this.x = 0;
        return true;
    }

    async clearMovementHistory() {
        this.clearCalls += 1;
        if (this.clearError) throw this.clearError;
        this.movementHistory = [];
    }
}

test("a preparation failure without consumed ticks returns to idle and remains retryable", async () => {
    const combatant = { id: "combatant", initiative: 10 };
    installGlobals(combatant);
    const actor = new TestActor(combatant);
    actor.tickError = new Error("ticks rejected");
    const context = { actor, combatant };

    await assert.rejects(prepareCombatAction(context, {
        kind: "attack",
        itemId: "bow",
        ticks: 5,
        label: "Bow",
    }), /ticks rejected/u);

    assert.equal(getPreparationApplicationStatus(actor).state, "idle");
    assert.equal(combatant.initiative, 10);
    actor.tickError = null;
    assert.equal(await prepareCombatAction(context, {
        kind: "attack",
        itemId: "bow",
        ticks: 5,
        label: "Bow",
    }), true);
    assert.equal(combatant.initiative, 15);
    assert.equal(actor.getFlag("splittermond", "preparedAttack"), "bow");
    assert.equal(getPreparationApplicationStatus(actor).state, "completed");
});

test("consumed preparation ticks with a rejected prepared flag become uncertain until GM recovery", async () => {
    const combatant = { id: "combatant", initiative: 20 };
    installGlobals(combatant);
    const actor = new TestActor(combatant);
    actor.rejectPreparedFlag = true;
    const context = { actor, combatant };

    await assert.rejects(prepareCombatAction(context, {
        kind: "spell",
        itemId: "fireball",
        ticks: 8,
        label: "Fireball",
    }), /prepared flag rejected/u);

    assert.equal(combatant.initiative, 28);
    assert.equal(getPreparationApplicationStatus(actor).state, "uncertain");
    assert.equal(await prepareCombatAction(context, {
        kind: "spell",
        itemId: "fireball",
        ticks: 8,
        label: "Fireball",
    }), false);
    assert.equal(actor.tickCalls, 1);

    actor.rejectPreparedFlag = false;
    assert.equal(await recoverPreparationApplication(actor, "complete"), true);
    assert.equal(actor.getFlag("splittermond", "preparedSpell"), "fireball");
    assert.equal(getPreparationApplicationStatus(actor).state, "completed");
});

test("a rejected preparation write prevents tick consumption", async (t) => {
    t.mock.method(console, "error", () => {});
    const combatant = { id: "combatant", initiative: 5 };
    installGlobals(combatant);
    const actor = new TestActor(combatant);
    actor.rejectPreparationState = true;

    await assert.rejects(prepareCombatAction({ actor, combatant }, {
        kind: "attack",
        itemId: "crossbow",
        ticks: 7,
        label: "Crossbow",
    }), /Could not persist required preparationApplication flag/u);
    assert.equal(actor.tickCalls, 0);
    assert.equal(combatant.initiative, 5);
});

test("movement reversal becomes uncertain when cleanup fails after the token moved", async () => {
    installGlobals();
    const token = new TestToken();
    token.clearError = new Error("history cleanup failed");

    await assert.rejects(revertTokenMovementApplication({ token }), /history cleanup failed/u);
    assert.equal(token.x, 0);
    assert.equal(getMovementReversalApplicationStatus(token).state, "uncertain");
    assert.equal(await revertTokenMovementApplication({ token }), false);
    assert.equal(token.revertCalls, 1);

    token.clearError = null;
    assert.equal(await recoverMovementReversalApplication(token, "complete"), true);
    assert.deepEqual(token.movementHistory, []);
    assert.equal(getMovementReversalApplicationStatus(token).state, "idle");

    token.x = 100;
    token.movementHistory = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    assert.equal(getMovementReversalApplicationStatus(token).state, "completed");
    assert.equal(await resetCompletedMovementReversalApplication(token), true);
    assert.equal(getMovementReversalApplicationStatus(token).state, "idle");
});

test("a rejected movement write prevents the token from moving", async (t) => {
    t.mock.method(console, "error", () => {});
    installGlobals();
    const token = new TestToken();
    token.rejectState = true;

    await assert.rejects(
        revertTokenMovementApplication({ token }),
        /Could not persist required movementReversalApplication flag/u
    );
    assert.equal(token.revertCalls, 0);
    assert.equal(token.x, 100);
});
