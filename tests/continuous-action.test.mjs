import assert from "node:assert/strict";
import test from "node:test";

import {
    advanceContinuousActions,
    beginContinuousAction,
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

test("an actionable continuous reference action enters the tagged state after advancing ticks", async () => {
    const fixture = continuousActionFixture();
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
    assert.equal(started.startTick, 10);
    assert.equal(started.endTick, 16);

    assert.equal(await performTickAction(fixture, "dropProne", "2"), true);
    assert.equal(
        fixture.token.getFlag(MODULE_ID, CONTINUOUS_ACTION_FLAG).id,
        started.id,
        "a reaction must not start a new continuous action"
    );
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
