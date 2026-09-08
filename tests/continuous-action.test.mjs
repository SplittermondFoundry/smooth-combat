import assert from "node:assert/strict";
import test from "node:test";

import {
    advanceContinuousActions,
    beginContinuousAction,
    clearContinuousAction,
    completeContinuousAction,
    CONTINUOUS_ACTION_FLAG,
    CONTINUOUS_ACTION_STATUS_ID,
    getContinuousAction,
    isTokenInContinuousAction,
    MOVEMENT_ACTION_STATUS_ID,
    normalizeContinuousAction,
    registerContinuousActionStatusEffect,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/continuous-action.js";
import {
    cancelPreparedAttack,
    cancelPreparedSpell,
    performAttack,
    performSpell,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/actions.js";
import { performTickAction } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/tick-actions.js";
import { cancelMovementPlanAfterManualMove } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/movement.js";
import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";

const MODULE_ID = "splittermond-smoother-fight";

test("continuous-action records are strict token- and combat-bound tags", () => {
    const record = continuousActionRecord();
    const fixture = continuousActionFixture(record);

    assert.deepEqual(normalizeContinuousAction(record), record);
    assert.equal(isTokenInContinuousAction(fixture.token, fixture.combat), true);
    assert.equal(getContinuousAction(fixture.token, fixture.combat)?.actionId, "standUpProne");

    fixture.combat.currentTick = record.endTick;
    fixture.combat.combatant = fixture.combatant;
    assert.equal(isTokenInContinuousAction(fixture.token, fixture.combat), false);
    fixture.combat.currentTick = record.startTick;
    assert.equal(isTokenInContinuousAction({ ...fixture.token, uuid: "Token.other" }, fixture.combat), false);
    assert.equal(getContinuousAction(fixture.token, { ...fixture.combat, id: "other-combat" }), null);
    assert.equal(normalizeContinuousAction({ ...record, endTick: record.startTick }), null);
});

test("starting a continuous action writes the token tag and assigns a visible Foundry status", async () => {
    const fixture = continuousActionFixture();
    installGlobals(fixture.user);
    installGermanActionTranslations();
    const created = [];
    fixture.actor.createEmbeddedDocuments = async (type, data) => {
        created.push({ type, data: structuredClone(data) });
        return data;
    };
    services.scheduleRender = () => {};

    const record = await beginContinuousAction(fixture, {
        actionId: "standUpProne",
        startTick: 10,
        endTick: 16,
    });

    assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG).id, record.id);
    assert.equal(record.actionId, "standUpProne");
    assert.equal(record.startTick, 10);
    assert.equal(record.endTick, 16);
    assert.equal(created.length, 1);
    assert.equal(created[0].type, "ActiveEffect");
    assert.deepEqual(created[0].data[0].statuses, [CONTINUOUS_ACTION_STATUS_ID]);
    assert.equal(created[0].data[0].showIcon, 2);
    assert.equal(created[0].data[0].name, "Kontinuierliche Handlung (Aufstehen (liegend))");
    assert.equal(created[0].data[0].flags[MODULE_ID][CONTINUOUS_ACTION_FLAG].id, record.id);
    assert.match(created[0].data[0].img, /continuous-action\.svg$/u);
});

test("movement actions receive both continuous and movement assigned statuses", async () => {
    for (const [actionId, actionName, endTick] of [
        ["crawl", "Kriechen", 15],
        ["walk", "Laufen", 15],
        ["sprint", "Sprinten", 20],
    ]) {
        const fixture = continuousActionFixture();
        installGlobals(fixture.user);
        installGermanActionTranslations();
        services.scheduleRender = () => {};

        const record = await beginContinuousAction(fixture, {
            actionId,
            completionTrigger: "movement",
            startTick: 10,
            endTick,
        });

        assert.equal(record.actionId, actionId);
        assert.equal(fixture.actor.effects.length, 2);
        const continuousEffect = fixture.actor.effects.find((effect) => effect.statuses.has(CONTINUOUS_ACTION_STATUS_ID));
        const movementEffect = fixture.actor.effects.find((effect) => effect.statuses.has(MOVEMENT_ACTION_STATUS_ID));
        assert.ok(continuousEffect);
        assert.ok(movementEffect);
        assert.deepEqual(Array.from(continuousEffect.statuses), [CONTINUOUS_ACTION_STATUS_ID]);
        assert.deepEqual(Array.from(movementEffect.statuses), [MOVEMENT_ACTION_STATUS_ID]);
        assert.match(continuousEffect.img, /continuous-action\.svg$/u);
        assert.match(movementEffect.img, /movement-action\.svg$/u);
        assert.equal(continuousEffect.name, `Kontinuierliche Handlung (${actionName})`);
        assert.equal(movementEffect.name, `In Bewegung (${actionName})`);

        assert.equal(await completeContinuousAction(fixture, { trigger: "movement" }), true);
        assert.deepEqual(fixture.actor.effects, []);
    }
});

test("an existing generic marker is retained while movement adds its own status", async () => {
    const record = continuousActionRecord({ actionId: "walk" });
    const fixture = continuousActionFixture(record);
    installGlobals(fixture.user);
    installGermanActionTranslations();
    services.getActivePrimaryGm = () => fixture.user;
    services.scheduleRender = () => {};
    fixture.actor.effects = [testEffect({
        name: "Continuous action",
        description: "",
        img: "modules/splittermond-smoother-fight/assets/icons/continuous-action.svg",
        disabled: false,
        showIcon: 2,
        statuses: [CONTINUOUS_ACTION_STATUS_ID],
        flags: { [MODULE_ID]: { [CONTINUOUS_ACTION_FLAG]: record } },
    })];

    assert.equal(await advanceContinuousActions(fixture.combat), true);
    assert.equal(fixture.actor.effects.length, 2);
    const continuousEffect = fixture.actor.effects.find((effect) => effect.statuses.has(CONTINUOUS_ACTION_STATUS_ID));
    const movementEffect = fixture.actor.effects.find((effect) => effect.statuses.has(MOVEMENT_ACTION_STATUS_ID));
    assert.ok(continuousEffect);
    assert.ok(movementEffect);
    assert.deepEqual(Array.from(continuousEffect.statuses), [CONTINUOUS_ACTION_STATUS_ID]);
    assert.deepEqual(Array.from(movementEffect.statuses), [MOVEMENT_ACTION_STATUS_ID]);
    assert.equal(continuousEffect.name, "Kontinuierliche Handlung (Laufen)");
    assert.equal(movementEffect.name, "In Bewegung (Laufen)");
    assert.match(movementEffect.img, /movement-action\.svg$/u);
});

test("an existing movement marker gains the missing continuous status", async () => {
    const record = continuousActionRecord({ actionId: "sprint" });
    const fixture = continuousActionFixture(record);
    installGlobals(fixture.user);
    services.getActivePrimaryGm = () => fixture.user;
    services.scheduleRender = () => {};
    fixture.actor.effects = [testEffect({
        name: "In motion",
        description: "",
        img: "modules/splittermond-smoother-fight/assets/icons/movement-action.svg",
        disabled: false,
        showIcon: 2,
        statuses: [MOVEMENT_ACTION_STATUS_ID],
        flags: { [MODULE_ID]: { [CONTINUOUS_ACTION_FLAG]: record } },
    })];

    assert.equal(await advanceContinuousActions(fixture.combat), true);
    assert.equal(fixture.actor.effects.length, 2);
    assert.ok(fixture.actor.effects.some((effect) => effect.statuses.has(CONTINUOUS_ACTION_STATUS_ID)));
    assert.ok(fixture.actor.effects.some((effect) => effect.statuses.has(MOVEMENT_ACTION_STATUS_ID)));
});

test("tick changes extend a continuous action and its tag is removed on completion", async () => {
    const record = continuousActionRecord();
    const fixture = continuousActionFixture(record);
    installGlobals(fixture.user);
    services.getActivePrimaryGm = () => fixture.user;
    services.scheduleRender = () => {};
    fixture.combatant.initiative = 19;

    assert.equal(await advanceContinuousActions(fixture.combat), true);
    assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG).endTick, 19);
    assert.equal(fixture.actor.effects.length, 1);
    assert.equal(effectRecord(fixture.actor.effects[0]).endTick, 19);

    fixture.combat.currentTick = 19;
    fixture.combat.combatant = fixture.combatant;
    assert.equal(await advanceContinuousActions(fixture.combat), true);
    assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG), null);
    assert.deepEqual(fixture.actor.effects, []);
});

test("fractional initiative ordering does not keep completed continuous actions active", async () => {
    for (const actionId of ["coordinate", "aim", "focusMagic", "standUpProne", "useItem"]) {
        const record = continuousActionRecord({
            actionId, startTick: 10.01, endTick: 15.01,
            ...(actionId === "standUpProne" ? { startingCombatPosition: "prone" } : {}),
        });
        const fixture = continuousActionFixture(record);
        installGlobals(fixture.user);
        services.getActivePrimaryGm = () => fixture.user;
        services.scheduleRender = () => {};
        let standing = false;
        services.setCombatPosition = async (_actor, position) => standing = position === "standing";
        fixture.combat.currentTick = 15;
        fixture.combat.combatant = { id: "ahead", initiative: 15 };
        await advanceContinuousActions(fixture.combat);
        assert.equal(isTokenInContinuousAction(fixture.token, fixture.combat), true, "wait for the owner's turn");

        fixture.combat.combatant = fixture.combatant;
        assert.equal(await advanceContinuousActions(fixture.combat), true, actionId);
        assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG), null);
        assert.deepEqual(fixture.actor.effects, []);
        assert.equal(standing, actionId === "standUpProne");
    }
});

test("same-tick initiative sorting does not extend a continuous action's duration", async () => {
    const fixture = continuousActionFixture(continuousActionRecord());
    installGlobals(fixture.user);
    services.getActivePrimaryGm = () => fixture.user;
    services.scheduleRender = () => {};
    fixture.combatant.initiative = 15.02;
    assert.equal(getContinuousAction(fixture.token, fixture.combat).endTick, 15);
    await advanceContinuousActions(fixture.combat);
    assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG).endTick, 15);
    assert.equal(effectRecord(fixture.actor.effects[0]).endTick, 15);
});

test("a turn change during status persistence is processed after the pending update", async () => {
    const fixture = continuousActionFixture(continuousActionRecord({ actionId: "coordinate" }));
    installGlobals(fixture.user);
    services.getActivePrimaryGm = () => fixture.user;
    services.scheduleRender = () => {};
    const entered = Promise.withResolvers();
    const gate = Promise.withResolvers();
    const createEffects = fixture.actor.createEmbeddedDocuments;
    fixture.actor.createEmbeddedDocuments = async function (...args) {
        entered.resolve();
        await gate.promise;
        return createEffects.apply(this, args);
    };
    const synchronization = advanceContinuousActions(fixture.combat);
    await entered.promise;
    fixture.combat.currentTick = 15;
    fixture.combat.combatant = fixture.combatant;
    const completion = advanceContinuousActions(fixture.combat);
    gate.resolve();
    await Promise.all([synchronization, completion]);

    assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG), null);
    assert.deepEqual(fixture.actor.effects, []);
});

test("a queued completion survives a failed status write and does not leave the token locked", async () => {
    const fixture = continuousActionFixture(continuousActionRecord({ actionId: "aim" }));
    installGlobals(fixture.user);
    services.getActivePrimaryGm = () => fixture.user;
    services.scheduleRender = () => {};
    const entered = Promise.withResolvers();
    const gate = Promise.withResolvers();
    const createEffects = fixture.actor.createEmbeddedDocuments;
    fixture.actor.createEmbeddedDocuments = async () => {
        entered.resolve();
        await gate.promise;
        throw new Error("status write rejected");
    };
    const synchronization = assert.rejects(advanceContinuousActions(fixture.combat), /status write rejected/u);
    await entered.promise;
    const completion = completeContinuousAction(fixture, { trigger: "attack" });
    gate.resolve();
    await synchronization;
    assert.equal(await completion, true);
    assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG), null);

    fixture.actor.createEmbeddedDocuments = createEffects;
    const next = await beginContinuousAction(fixture, { actionId: "aim", startTick: 15, endTick: 17 });
    assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG).id, next.id);
    assert.equal(await completeContinuousAction(fixture, { expectedId: "continuous-1" }), false);
    assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG).id, next.id);
    await clearContinuousAction(fixture.token);
});

test("a failed status update does not skip another combatant's continuous-action completion", async () => {
    const first = continuousActionFixture(continuousActionRecord({ actionId: "coordinate" }));
    const second = continuousActionFixture(continuousActionRecord({
        actionId: "coordinate", combatantId: "second", tokenUuid: "Token.second",
    }));
    second.token.id = "second";
    second.token.uuid = "Token.second";
    second.combatant.id = "second";
    first.combat.combatants.set("second", second.combatant);
    first.combat.combatant = second.combatant;
    first.combat.currentTick = 15;
    installGlobals(first.user);
    services.getActivePrimaryGm = () => first.user;
    services.scheduleRender = () => {};
    first.actor.createEmbeddedDocuments = async () => { throw new Error("status update failed"); };

    await assert.rejects(advanceContinuousActions(first.combat), /status update failed/u);
    assert.equal(second.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG), null);
    assert.notEqual(first.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG), null);
});

test("a regular continuous action ends as soon as its combatant becomes active", async () => {
    const record = continuousActionRecord({ actionId: "coordinate" });
    const fixture = continuousActionFixture(record);
    installGlobals(fixture.user);
    services.getActivePrimaryGm = () => fixture.user;
    services.scheduleRender = () => {};
    fixture.combat.currentTick = record.endTick - 1;
    fixture.combat.combatant = fixture.combatant;

    assert.equal(await advanceContinuousActions(fixture.combat), true);
    assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG), null);
});

test("same-tick combatants ahead keep a regular continuous action active", async () => {
    const record = continuousActionRecord({ actionId: "coordinate" });
    const fixture = continuousActionFixture(record);
    const aheadA = { id: "ahead-a", initiative: record.endTick };
    const aheadB = { id: "ahead-b", initiative: record.endTick };
    installGlobals(fixture.user);
    services.getActivePrimaryGm = () => fixture.user;
    services.scheduleRender = () => {};
    fixture.combat.currentTick = record.endTick;
    fixture.combat.turns = [aheadA, aheadB, fixture.combatant];

    fixture.combat.combatant = aheadA;
    assert.equal(await advanceContinuousActions(fixture.combat), true);
    assert.equal(isTokenInContinuousAction(fixture.token, fixture.combat), true);

    fixture.combat.combatant = aheadB;
    assert.equal(await advanceContinuousActions(fixture.combat), false);
    assert.equal(isTokenInContinuousAction(fixture.token, fixture.combat), true);

    fixture.combat.combatant = fixture.combatant;
    assert.equal(await advanceContinuousActions(fixture.combat), true);
    assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG), null);
});

test("a regular action that already reached its completion tick leaves no stale marker", async () => {
    const fixture = continuousActionFixture();
    installGlobals(fixture.user);
    services.scheduleRender = () => {};
    fixture.combat.currentTick = 16;
    fixture.combatant.initiative = 16;
    fixture.combat.combatant = fixture.combatant;

    await beginContinuousAction(fixture, {
        actionId: "standUpProne",
        startTick: 10,
        endTick: 16,
    });

    assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG), null);
    assert.deepEqual(fixture.actor.effects, []);
});

test("preparatory actions become ready only when their own same-tick turn starts", async () => {
    const record = continuousActionRecord({ actionId: "focusMagic" });
    const fixture = continuousActionFixture(record);
    const ahead = { id: "ahead", initiative: record.endTick };
    installGlobals(fixture.user);
    services.getActivePrimaryGm = () => fixture.user;
    services.scheduleRender = () => {};
    fixture.combat.currentTick = record.endTick;
    fixture.combat.turns = [ahead, fixture.combatant];
    fixture.combat.combatant = ahead;

    assert.equal(await advanceContinuousActions(fixture.combat), true);
    assert.equal(isTokenInContinuousAction(fixture.token, fixture.combat), true);

    fixture.combat.combatant = fixture.combatant;
    assert.equal(await advanceContinuousActions(fixture.combat), true);
    assert.equal(isTokenInContinuousAction(fixture.token, fixture.combat), false);
    assert.equal(await completeContinuousAction(fixture, { trigger: "spell" }), false);
});

test("cancelled rolls retain preparatory actions and submitted rolls complete them", async () => {
    const target = { uuid: "Token.target", actor: { uuid: "Actor.target" } };
    const attackFixture = continuousActionFixture(continuousActionRecord({ actionId: "readyRangedAttack" }));
    installGlobals(attackFixture.user);
    game.combat = attackFixture.combat;
    services.getRuntimeController = () => attackFixture.user;
    services.getTargetSelectionForUser = () => ({ target, targets: [target] });
    services.withTemporarySystemTargets = async (_targets, operation) => operation();
    services.scheduleRender = () => {};
    attackFixture.actor.attacks = [{ id: "bow", name: "Bow", isRanged: true }];
    installSystemFlags(attackFixture.actor, { preparedAttack: "bow" });
    let submitted = false;

    assert.equal(await performAttack(attackFixture, "bow", {}, async () => submitted), false);
    assert.equal(isTokenInContinuousAction(attackFixture.token, attackFixture.combat), true);
    submitted = true;
    assert.equal(await performAttack(attackFixture, "bow", {}, async () => submitted), true);
    assert.equal(isTokenInContinuousAction(attackFixture.token, attackFixture.combat), false);

    const spellFixture = continuousActionFixture(continuousActionRecord({ actionId: "focusMagic" }));
    installGlobals(spellFixture.user);
    game.combat = spellFixture.combat;
    services.getRuntimeController = () => spellFixture.user;
    services.getTargetSelectionForUser = () => ({ target, targets: [target] });
    spellFixture.actor.spells = [{ id: "spell", name: "Spell", difficulty: 15 }];
    installSystemFlags(spellFixture.actor, { preparedSpell: "spell" });
    submitted = false;
    spellFixture.actor.rollSpell = async () => submitted;

    await performSpell(spellFixture, "spell");
    assert.equal(isTokenInContinuousAction(spellFixture.token, spellFixture.combat), true);
    submitted = true;
    await performSpell(spellFixture, "spell");
    assert.equal(isTokenInContinuousAction(spellFixture.token, spellFixture.combat), false);
});

test("a submitted attack cancels a prepared spell while a cancelled attack roll retains it", async () => {
    const target = { uuid: "Token.target", actor: { uuid: "Actor.target" } };
    const fixture = continuousActionFixture(continuousActionRecord({ actionId: "focusMagic" }));
    installGlobals(fixture.user);
    game.combat = fixture.combat;
    services.getRuntimeController = () => fixture.user;
    services.getTargetSelectionForUser = () => ({ target, targets: [target] });
    services.withTemporarySystemTargets = async (_targets, operation) => operation();
    services.scheduleRender = () => {};
    ui.notifications.info = () => {};
    fixture.actor.attacks = [{ id: "sword", name: "Sword", isRanged: false }];
    installSystemFlags(fixture.actor, { preparedSpell: "spell" });
    let submitted = false;

    assert.equal(await performAttack(fixture, "sword", {}, async () => submitted), false);
    assert.equal(fixture.actor.getFlag("splittermond", "preparedSpell"), "spell");
    assert.equal(isTokenInContinuousAction(fixture.token, fixture.combat), true);

    submitted = true;
    assert.equal(await performAttack(fixture, "sword", {}, async () => submitted), true);
    assert.equal(fixture.actor.getFlag("splittermond", "preparedSpell"), null);
    assert.equal(isTokenInContinuousAction(fixture.token, fixture.combat), false);
});

test("explicitly cancelling attack or spell preparation removes its marker", async () => {
    const attackFixture = continuousActionFixture(continuousActionRecord({ actionId: "readyRangedAttack" }));
    installGlobals(attackFixture.user);
    game.combat = attackFixture.combat;
    ui.notifications.info = () => {};
    services.scheduleRender = () => {};
    installSystemFlags(attackFixture.actor, { preparedAttack: "bow" });

    await cancelPreparedAttack(attackFixture);
    assert.equal(isTokenInContinuousAction(attackFixture.token, attackFixture.combat), false);

    const spellFixture = continuousActionFixture(continuousActionRecord({ actionId: "focusMagic" }));
    installGlobals(spellFixture.user);
    game.combat = spellFixture.combat;
    ui.notifications.info = () => {};
    installSystemFlags(spellFixture.actor, { preparedSpell: "spell" });

    await cancelPreparedSpell(spellFixture);
    assert.equal(isTokenInContinuousAction(spellFixture.token, spellFixture.combat), false);
});

test("use item books five ticks and removes its status when its own same-tick turn starts", async () => {
    const fixture = useItemActionFixture();
    const cards = [];
    services.createTickActionChatCard = async (_context, actionId, ticks) => {
        cards.push({ actionId, ticks });
        return { id: "card" };
    };

    assert.equal(await performTickAction(fixture, "useItem", "5"), true);
    const started = fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG);
    assert.equal(started.actionId, "useItem");
    assert.equal(started.completionTrigger, "tick");
    assert.equal(started.startTick, 10);
    assert.equal(started.endTick, 15);
    assert.equal(fixture.combatant.initiative, 15.01);
    assert.deepEqual(cards, [{ actionId: "useItem", ticks: 5 }]);
    assert.equal(fixture.actor.effects.length, 1);
    assert.equal(fixture.actor.effects[0].name, "Kontinuierliche Handlung (Gegenstand verwenden)");

    fixture.combat.currentTick = 14;
    assert.equal(await advanceContinuousActions(fixture.combat), false);
    assert.equal(isTokenInContinuousAction(fixture.token, fixture.combat), true);
    fixture.combat.currentTick = 15;
    fixture.combat.combatant = { id: "ahead", initiative: 15 };
    assert.equal(await advanceContinuousActions(fixture.combat), false);
    assert.equal(isTokenInContinuousAction(fixture.token, fixture.combat), true);

    fixture.combat.combatant = fixture.combatant;
    assert.equal(await advanceContinuousActions(fixture.combat), true);
    assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG), null);
    assert.deepEqual(fixture.actor.effects, []);
    assert.equal(await advanceContinuousActions(fixture.combat), false);
    assert.deepEqual(fixture.actor.effects, [], "later hooks do not recreate the completed status");
});

test("use item completes even when its turn starts before the initial status write finishes", async () => {
    const fixture = useItemActionFixture();
    const entered = Promise.withResolvers();
    const gate = Promise.withResolvers();
    const createEffects = fixture.actor.createEmbeddedDocuments;
    fixture.actor.createEmbeddedDocuments = async function (...args) {
        entered.resolve();
        await gate.promise;
        return createEffects.apply(this, args);
    };
    const action = performTickAction(fixture, "useItem", "5");
    await entered.promise;
    fixture.combat.currentTick = 15;
    fixture.combat.combatant = fixture.combatant;
    const completion = advanceContinuousActions(fixture.combat);
    gate.resolve();

    assert.deepEqual(await Promise.all([action, completion]), [true, true]);
    assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG), null);
    assert.deepEqual(fixture.actor.effects, []);
});

test("an actionable continuous reference action enters the tagged state after advancing ticks", async () => {
    const fixture = continuousActionFixture();
    fixture.actor.items = [combatPositionMarker("prone")];
    installGlobals(fixture.user);
    services.getRuntimeController = () => fixture.user;
    services.getTargetSelectionForUser = () => ({ target: null, targets: [] });
    services.addCombatTicks = async (context, ticks) => {
        context.combatant.initiative += Number(ticks);
        return Number(ticks);
    };
    services.createTickActionChatCard = async () => ({ id: "card" });

    assert.equal(await performTickAction(fixture, "standUpProne", "6"), true);
    const started = fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG);
    assert.equal(started.actionId, "standUpProne");
    assert.equal(started.startingCombatPosition, "prone");
    assert.equal(started.startTick, 10);
    assert.equal(started.endTick, 16);

    assert.equal(await performTickAction(fixture, "dropProne", "2"), true);
    assert.equal(
        fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG).id,
        started.id,
        "a reaction must not start a new continuous action"
    );
});

test("stand-up actions require confirmation when the current combat position does not match", async () => {
    const fixture = continuousActionFixture();
    installGlobals(fixture.user);
    services.getRuntimeController = () => fixture.user;
    services.getTargetSelectionForUser = () => ({ target: null, targets: [] });
    let addedTicks = 0;
    let createdCards = 0;
    services.addCombatTicks = async (context, ticks) => {
        addedTicks += Number(ticks);
        context.combatant.initiative += Number(ticks);
        return Number(ticks);
    };
    services.createTickActionChatCard = async () => {
        createdCards += 1;
        return { id: "card" };
    };
    let confirm = false;
    foundry.applications = { api: { DialogV2: { confirm: async () => confirm } } };

    assert.equal(await performTickAction(fixture, "standUpKneeling", "3"), false);
    assert.equal(addedTicks, 0);
    assert.equal(createdCards, 0);
    assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG), null);

    confirm = true;
    assert.equal(await performTickAction(fixture, "standUpKneeling", "3"), true);
    assert.equal(addedTicks, 3);
    assert.equal(createdCards, 1);
    assert.equal(
        fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG).startingCombatPosition,
        undefined,
        "a deliberately mismatched action must not force the actor to standing on completion"
    );
    let positionChanges = 0;
    services.getActivePrimaryGm = () => fixture.user;
    services.setCombatPosition = async () => {
        positionChanges += 1;
    };
    fixture.combat.currentTick = fixture.combatant.initiative;
    fixture.combat.combatant = fixture.combatant;
    assert.equal(await advanceContinuousActions(fixture.combat), true);
    assert.equal(positionChanges, 0);
});

test("successfully completed prone and kneeling stand-up actions change the position to standing", async () => {
    for (const [actionId, startingCombatPosition] of [
        ["standUpProne", "prone"],
        ["standUpKneeling", "kneeling"],
    ]) {
        const record = continuousActionRecord({ actionId, startingCombatPosition });
        const fixture = continuousActionFixture(record);
        installGlobals(fixture.user);
        services.getActivePrimaryGm = () => fixture.user;
        services.scheduleRender = () => {};
        const changes = [];
        services.setCombatPosition = async (actor, position) => {
            changes.push({ actor, position });
            return { id: position };
        };
        fixture.combat.currentTick = record.endTick;
        fixture.combat.combatant = fixture.combatant;

        assert.equal(await advanceContinuousActions(fixture.combat), true);
        assert.deepEqual(changes, [{ actor: fixture.actor, position: "standing" }]);
        assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG), null);
    }
});

test("clearing an interrupted stand-up action does not change the combat position", async () => {
    const record = continuousActionRecord({ startingCombatPosition: "prone" });
    const fixture = continuousActionFixture(record);
    installGlobals(fixture.user);
    let positionChanges = 0;
    services.setCombatPosition = async () => {
        positionChanges += 1;
    };

    assert.equal(await clearContinuousAction(fixture.token, { expectedId: record.id }), true);
    assert.equal(positionChanges, 0);
});

test("route-less movement remains continuous until the token actually moves", async () => {
    const fixture = continuousActionFixture();
    installGlobals(fixture.user);
    game.combat = fixture.combat;
    services.getRuntimeController = () => fixture.user;
    services.getTargetSelectionForUser = () => ({ target: null, targets: [] });
    services.addCombatTicks = async (context, ticks) => {
        context.combatant.initiative += Number(ticks);
        return Number(ticks);
    };
    services.createTickActionChatCard = async () => ({ id: "card" });
    services.scheduleRender = () => {};

    assert.equal(await performTickAction(fixture, "crawl", "5"), true);
    const started = fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG);
    assert.equal(started.actionId, "crawl");
    assert.equal(started.completionTrigger, "movement");

    fixture.combat.currentTick = started.endTick;
    fixture.combat.combatant = fixture.combatant;
    assert.equal(await advanceContinuousActions(fixture.combat), false);
    assert.equal(isTokenInContinuousAction(fixture.token, fixture.combat), true);

    assert.equal(await cancelMovementPlanAfterManualMove(fixture.token, {}, fixture.user.id), true);
    assert.equal(isTokenInContinuousAction(fixture.token, fixture.combat), false);
});

test("posture and crawl limits also guard reference actions with movement tracking disabled", async () => {
    for (const [actionId, distance] of [["crawl", 3], ["walk", 1], ["sprint", 1], ["standUpProne", 1]]) {
        const fixture = continuousActionFixture();
        fixture.actor.items = [combatPositionMarker("prone")];
        fixture.token.movementHistory = { distance };
        installGlobals(fixture.user);
        game.settings = { get: () => false };
        const warnings = [];
        ui.notifications.warn = (message) => warnings.push(message);
        services.getRuntimeController = () => fixture.user;
        services.getTargetSelectionForUser = () => ({ target: null, targets: [] });
        services.addCombatTicks = async () => assert.fail("invalid movement must not charge ticks");
        services.createTickActionChatCard = async () => assert.fail("invalid movement must not create a card");
        assert.equal(await performTickAction(fixture, actionId, "5"), false);
        assert.equal(fixture.combatant.initiative, 10);
        assert.equal(fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG), null);
        assert.equal(warnings.length, 1);
    }
});

test("stand up is charged once, preserves posture until the own completion turn, and blocks crawling during it", async () => {
    for (const [position, actionId, ticks] of [["prone", "standUpProne", 6], ["kneeling", "standUpKneeling", 3]]) {
        const fixture = continuousActionFixture();
        fixture.actor.items = [combatPositionMarker(position)];
        installGlobals(fixture.user);
        game.combat = fixture.combat;
        fixture.combat.combatant = fixture.combatant;
        ui.notifications.warn = () => {};
        let charged = 0;
        services.getActivePrimaryGm = () => fixture.user;
        services.getRuntimeController = () => fixture.user;
        services.getTargetSelectionForUser = () => ({ target: null, targets: [] });
        services.addCombatTicks = async (context, value) => {
            charged += Number(value);
            context.combatant.initiative += Number(value);
            context.combat.combatant = { id: "other", initiative: 11 };
            return Number(value);
        };
        services.createTickActionChatCard = async () => ({ id: "card" });
        services.setCombatPosition = async (actor, value) => {
            assert.equal(value, "standing");
            actor.items = [];
        };
        assert.equal(await performTickAction(fixture, actionId, String(ticks)), true);
        assert.equal(charged, ticks);
        const started = getContinuousAction(fixture.token, fixture.combat);
        assert.equal(started.endTick, 10 + ticks);
        assert.equal(fixture.actor.items[0].name, position);
        assert.equal(await performTickAction(fixture, actionId, String(ticks)), false);
        assert.equal(await performTickAction(fixture, "crawl", "5"), false);
        assert.equal(charged, ticks);
        assert.equal(getContinuousAction(fixture.token, fixture.combat).id, started.id);
        fixture.combat.currentTick = 10 + ticks;
        assert.equal(await advanceContinuousActions(fixture.combat), false);
        assert.equal(fixture.actor.items[0].name, position);
        fixture.combat.combatant = fixture.combatant;
        assert.equal(await advanceContinuousActions(fixture.combat), true);
        assert.deepEqual(fixture.actor.items, []);
        assert.equal(getContinuousAction(fixture.token, fixture.combat), null);
    }
});

test("simultaneous stand-up clicks cannot both book ticks before the continuous action is stored", async () => {
    const fixture = continuousActionFixture();
    fixture.actor.items = [combatPositionMarker("prone")];
    installGlobals(fixture.user);
    services.getRuntimeController = () => fixture.user;
    services.getTargetSelectionForUser = () => ({ target: null, targets: [] });
    let release;
    let entered;
    const pending = new Promise((resolve) => { release = resolve; });
    const charging = new Promise((resolve) => { entered = resolve; });
    let calls = 0;
    services.addCombatTicks = async (context, ticks) => {
        calls += 1;
        entered();
        await pending;
        context.combatant.initiative += Number(ticks);
        return Number(ticks);
    };
    services.createTickActionChatCard = async () => ({ id: "card" });
    const first = performTickAction(fixture, "standUpProne", "6");
    await charging;
    assert.equal(await performTickAction(fixture, "standUpProne", "6"), false);
    release();
    assert.equal(await first, true);
    assert.equal(calls, 1);
    assert.equal(fixture.combatant.initiative, 16);
});

test("movement already recorded before its action leaves no stale continuous marker", async () => {
    const fixture = continuousActionFixture();
    installGlobals(fixture.user);
    game.combat = fixture.combat;
    game.settings = { get: () => false };
    fixture.token.movementHistory = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    fixture.token.measureMovementPath = () => ({ distance: 2 });
    services.getRuntimeController = () => fixture.user;
    services.getTargetSelectionForUser = () => ({ target: null, targets: [] });
    services.addCombatTicks = async (context, ticks) => {
        context.combatant.initiative += Number(ticks);
        return Number(ticks);
    };
    services.createTickActionChatCard = async () => ({ id: "card" });
    services.scheduleRender = () => {};

    assert.equal(await performTickAction(fixture, "walk", "5"), true);
    assert.equal(isTokenInContinuousAction(fixture.token, fixture.combat), false);
});

test("the Foundry status definition is registered as an automatic always-visible marker", () => {
    globalThis.CONFIG = { statusEffects: {} };
    globalThis.CONST = { ACTIVE_EFFECT_SHOW_ICON: { ALWAYS: 2 } };

    assert.equal(registerContinuousActionStatusEffect(), true);
    assert.deepEqual(CONFIG.statusEffects[CONTINUOUS_ACTION_STATUS_ID], {
        id: CONTINUOUS_ACTION_STATUS_ID,
        name: "SMOOTHER_FIGHT.StatusEffects.ContinuousAction.Name",
        description: "SMOOTHER_FIGHT.StatusEffects.ContinuousAction.Description",
        img: "modules/splittermond-smoother-fight/assets/icons/continuous-action.svg",
        changes: [],
        hud: false,
        showIcon: 2,
    });
    assert.deepEqual(CONFIG.statusEffects[MOVEMENT_ACTION_STATUS_ID], {
        id: MOVEMENT_ACTION_STATUS_ID,
        name: "SMOOTHER_FIGHT.StatusEffects.MovementAction.Name",
        description: "SMOOTHER_FIGHT.StatusEffects.MovementAction.Description",
        img: "modules/splittermond-smoother-fight/assets/icons/movement-action.svg",
        changes: [],
        hud: false,
        showIcon: 2,
    });
});

function continuousActionRecord(overrides = {}) {
    const actionId = overrides.actionId ?? "standUpProne";
    return {
        version: 2,
        id: "continuous-1",
        actionId,
        completionTrigger: testCompletionTrigger(actionId),
        combatId: "combat-1",
        combatantId: "combatant-1",
        tokenUuid: "Token.actor",
        startTick: 10,
        endTick: 15,
        createdAt: 1,
        createdBy: "gm",
        updatedAt: 1,
        ...overrides,
    };
}

function testCompletionTrigger(actionId) {
    if (["aim", "readyRangedAttack", "searchOpening"].includes(actionId)) return "attack";
    if (["crawl", "walk", "sprint"].includes(actionId)) return "movement";
    if (actionId === "focusMagic") return "spell";
    return "tick";
}

function continuousActionFixture(record = null) {
    const actor = {
        id: "actor-1",
        isOwner: true,
        effects: [],
        async createEmbeddedDocuments(type, data) {
            assert.equal(type, "ActiveEffect");
            for (const source of data) this.effects.push(testEffect(source));
            return this.effects;
        },
        async deleteEmbeddedDocuments(type, ids) {
            assert.equal(type, "ActiveEffect");
            this.effects = this.effects.filter((effect) => !ids.includes(effect.id));
            return ids;
        },
    };
    const tokenFlags = { [MODULE_ID]: {} };
    if (record) tokenFlags[MODULE_ID][CONTINUOUS_ACTION_FLAG] = structuredClone(record);
    const token = {
        id: "token-1",
        uuid: "Token.actor",
        actor,
        flags: tokenFlags,
        getFlag: (scope, key) => tokenFlags[scope]?.[key] ?? null,
        setFlag: async (scope, key, value) => {
            tokenFlags[scope] ??= {};
            tokenFlags[scope][key] = structuredClone(value);
            return token;
        },
    };
    const combatant = { id: "combatant-1", initiative: record?.endTick ?? 10, token, actor };
    const combatants = new Map([[combatant.id, combatant]]);
    const combat = { id: "combat-1", currentTick: record?.startTick ?? 10, combatants };
    const user = { id: "gm", isGM: true, active: true };
    return { actor, combat, combatant, token, user };
}

function useItemActionFixture() {
    const fixture = continuousActionFixture();
    installGlobals(fixture.user);
    installGermanActionTranslations();
    game.combat = fixture.combat;
    fixture.combatant.initiative = 10.01;
    fixture.combat.combatant = fixture.combatant;
    services.getActivePrimaryGm = () => fixture.user;
    services.getRuntimeController = () => fixture.user;
    services.getTargetSelectionForUser = () => ({ target: null, targets: [] });
    services.scheduleRender = () => {};
    services.addCombatTicks = async (context, ticks) => {
        assert.equal(ticks, "5");
        context.combatant.initiative = 15.01;
        context.combat.combatant = { id: "ahead", initiative: 14 };
        return 5;
    };
    services.createTickActionChatCard = async () => ({ id: "card" });
    return fixture;
}

function combatPositionMarker(position) {
    return {
        id: `position-${position}`,
        name: position,
        type: "statuseffect",
        system: { level: 1 },
        flags: { [MODULE_ID]: { combatPosition: position } },
    };
}

function testEffect(source) {
    const effect = {
        id: `effect-${Math.random()}`,
        description: source.description,
        disabled: source.disabled,
        flags: structuredClone(source.flags),
        img: source.img,
        name: source.name,
        showIcon: source.showIcon,
        statuses: new Set(source.statuses),
        getFlag(scope, key) {
            return this.flags[scope]?.[key] ?? null;
        },
        async update(changes) {
            for (const [key, value] of Object.entries(changes)) {
                if (key === `flags.${MODULE_ID}.${CONTINUOUS_ACTION_FLAG}`) {
                    this.flags[MODULE_ID] ??= {};
                    this.flags[MODULE_ID][CONTINUOUS_ACTION_FLAG] = structuredClone(value);
                } else if (key === "statuses") this.statuses = new Set(value);
                else this[key] = value;
            }
            return this;
        },
    };
    return effect;
}

function effectRecord(effect) {
    return effect.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG);
}

function installSystemFlags(actor, splittermondFlags) {
    actor.flags = { splittermond: structuredClone(splittermondFlags), [MODULE_ID]: {} };
    actor.getFlag = (scope, key) => actor.flags[scope]?.[key] ?? null;
    actor.setFlag = async (scope, key, value) => {
        actor.flags[scope] ??= {};
        actor.flags[scope][key] = structuredClone(value);
        return actor;
    };
}

function installGlobals(user) {
    globalThis.game = {
        user,
        i18n: {
            localize: (key) => key,
            format: (key) => key,
        },
    };
    globalThis.ui = { notifications: { error: () => assert.fail("unexpected flag error") } };
    globalThis.foundry = { utils: { randomID: () => "continuous-random" } };
    globalThis.CONST = { ACTIVE_EFFECT_SHOW_ICON: { ALWAYS: 2 } };
}

function installGermanActionTranslations() {
    const translations = {
        "SMOOTHER_FIGHT.HUD.TickActions.standUpProne.Name": "Aufstehen (liegend)",
        "SMOOTHER_FIGHT.HUD.TickActions.crawl.Name": "Kriechen",
        "SMOOTHER_FIGHT.HUD.TickActions.walk.Name": "Laufen",
        "SMOOTHER_FIGHT.HUD.TickActions.sprint.Name": "Sprinten",
        "SMOOTHER_FIGHT.HUD.TickActions.useItem.Name": "Gegenstand verwenden",
    };
    globalThis.game.i18n.localize = (key) => translations[key] ?? key;
    globalThis.game.i18n.format = (key, data) => (
        key === "SMOOTHER_FIGHT.StatusEffects.ContinuousAction.AssignedName"
            ? `Kontinuierliche Handlung (${data.action})`
            : key === "SMOOTHER_FIGHT.StatusEffects.MovementAction.AssignedName"
                ? `In Bewegung (${data.action})`
                : key
    );
}
