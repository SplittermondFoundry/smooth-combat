import test from "node:test";
import assert from "node:assert/strict";

import {
    performAttack,
    performSpell,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/actions.js";
import {
    combatPositionAttackModifiers,
    combatPositionSpellModifiers,
    isCrossbowAttack,
    opposingPositionAmount,
    ownPositionAmount,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/combat-position-modifier.js";
import {
    prepareTemporaryRollModifiers,
} from "../Modul/splittermond-smoother-fight/scripts/shared/temporary-roll-modifiers.js";
import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";

const translations = {
    "SMOOTHER_FIGHT.HUD.CombatPositionModifiers.own.kneeling": "Kampfposition: kniend",
    "SMOOTHER_FIGHT.HUD.CombatPositionModifiers.own.prone": "Kampfposition: liegend",
    "SMOOTHER_FIGHT.HUD.CombatPositionModifiers.own.flying": "Kampfposition: fliegend",
    "SMOOTHER_FIGHT.HUD.CombatPositionModifiers.target.kneeling": "Kampfposition: Gegner kniend",
    "SMOOTHER_FIGHT.HUD.CombatPositionModifiers.target.prone": "Kampfposition: Gegner liegend",
    "SMOOTHER_FIGHT.HUD.CombatPositionModifiers.target.flying": "Kampfposition: Gegner fliegend",
    "SMOOTHER_FIGHT.HUD.SmallMagicProtectionModifier": "Kleiner Magieschutz",
};

test("the complete GRW combat-position table is represented", () => {
    assert.deepEqual([
        ownPositionAmount("standing", { isRanged: false }),
        ownPositionAmount("standing", { isRanged: true }),
        opposingPositionAmount("standing", false),
        opposingPositionAmount("standing", true),
    ], [0, 0, 0, 0]);

    assert.deepEqual([
        ownPositionAmount("kneeling", { isRanged: false }),
        ownPositionAmount("kneeling", { isRanged: true }),
        opposingPositionAmount("kneeling", false),
        opposingPositionAmount("kneeling", true),
    ], [-3, 0, 3, -3]);

    assert.deepEqual([
        ownPositionAmount("prone", { isRanged: false }),
        ownPositionAmount("prone", { isRanged: true, isCrossbow: false }),
        ownPositionAmount("prone", { isRanged: true, isCrossbow: true }),
        opposingPositionAmount("prone", false),
        opposingPositionAmount("prone", true),
    ], [-6, -6, 0, 6, -6]);

    assert.deepEqual([
        ownPositionAmount("flying", { isRanged: false }),
        ownPositionAmount("flying", { isRanged: true }),
        opposingPositionAmount("flying", false),
        opposingPositionAmount("flying", true),
    ], [3, 3, -3, -3]);
});

test("GRW and Mondstahlklingen crossbow names use the prone exception", () => {
    for (const name of [
        "Handarmbrust",
        "Leichte Armbrust",
        "Schwere Armbrust",
        "Jagd-Balester",
        "Light Crossbow",
    ]) {
        assert.equal(isCrossbowAttack({ name }), true, name);
    }
    for (const name of ["Kurzbogen", "Langbogen", "Schleuder", "Stockschleuder"]) {
        assert.equal(isCrossbowAttack({ name }), false, name);
    }
    assert.equal(isCrossbowAttack({ name: "Eigenname", item: { name: "Leichte Armbrust" } }), true);
});

test("own and opposing positions produce separate transparent modifiers", (context) => {
    installGlobals(context);
    const modifiers = combatPositionAttackModifiers({
        attacker: actorInPosition("flying"),
        target: { actor: actorInPosition("prone") },
        attack: { name: "Langschwert" },
        isRanged: false,
    });

    assert.deepEqual(modifiers.map(({ amount, name, scope }) => ({ amount, name, scope })), [{
        amount: 3,
        name: "Kampfposition: fliegend",
        scope: "own",
    }, {
        amount: 6,
        name: "Kampfposition: Gegner liegend",
        scope: "target",
    }]);
});

test("only VTD spells receive the opposing ranged-position modifier", (context) => {
    installGlobals(context);
    const target = { actor: actorInPosition("prone") };
    assert.equal(combatPositionSpellModifiers({ difficulty: "VTD" }, target)[0].amount, -6);
    assert.equal(combatPositionSpellModifiers({ system: { difficulty: " vtd " } }, target)[0].amount, -6);
    assert.deepEqual(combatPositionSpellModifiers({ difficulty: "KW" }, target), []);
    assert.deepEqual(combatPositionSpellModifiers({ difficulty: "GW" }, target), []);
    assert.deepEqual(combatPositionSpellModifiers({ difficulty: 24 }, target), []);
});

test("named attack modifiers exist only during the synchronous roll snapshot", async (context) => {
    const target = tokenFor(actorInPosition("prone"), "target");
    installGlobals(context, () => target);
    const modifierManager = newModifierManager();
    let finishDialog;
    let receivedOptions;
    let observedModifiers;
    const originalRoll = (options) => {
        receivedOptions = options;
        observedModifiers = [...(modifierManager._modifier.get("skill.sword") ?? [])];
        return new Promise((resolve) => finishDialog = resolve);
    };
    const skill = {
        id: "blades",
        roll: originalRoll,
        get selectableModifier() {
            return modifierManager._modifier.get("skill.sword") ?? [];
        },
    };
    const actor = attackActor({
        attackId: "sword",
        attackName: "Langschwert",
        items: [positionMarker("flying")],
        modifierManager,
        skill,
    });

    const pendingRoll = performAttack({ actor, target: null }, "sword");
    assert.deepEqual(observedModifiers.map((modifier) => [
        modifier.attributes.name,
        modifier.value.amount,
    ]), [
        ["Kampfposition: fliegend", 3],
        ["Kampfposition: Gegner liegend", 6],
    ]);
    assert.deepEqual(receivedOptions.preSelectedModifier, [
        "Langschwert",
        "Kampfposition: fliegend",
        "Kampfposition: Gegner liegend",
    ]);
    assert.equal(modifierManager._modifier.has("skill.sword"), false);
    assert.equal(skill.roll, originalRoll);

    finishDialog(false);
    assert.equal(await pendingRoll, false);
    assert.equal(modifierManager._modifier.has("skill.sword"), false);
});

test("an open positioned attack cannot affect the next target", async (context) => {
    let liveTarget = tokenFor(actorInPosition("prone"), "prone-target");
    installGlobals(context, () => liveTarget);
    const modifierManager = newModifierManager();
    let finishFirstDialog;
    const calls = [];
    const skill = {
        id: "blades",
        roll(options) {
            calls.push({
                modifiers: [...(modifierManager._modifier.get("skill.sword") ?? [])],
                options,
            });
            if (calls.length === 1) return new Promise((resolve) => finishFirstDialog = resolve);
            return Promise.resolve(false);
        },
    };
    const actor = attackActor({
        attackId: "sword",
        attackName: "Langschwert",
        modifierManager,
        skill,
    });

    const firstRoll = performAttack({ actor }, "sword");
    assert.deepEqual(calls[0].modifiers.map((modifier) => modifier.value.amount), [6]);
    assert.equal(modifierManager._modifier.has("skill.sword"), false);

    liveTarget = tokenFor(actorInPosition("standing"), "standing-target");
    assert.equal(await performAttack({ actor }, "sword"), false);
    assert.deepEqual(calls[1].modifiers, []);
    assert.deepEqual(calls[1].options.preSelectedModifier, ["Langschwert"]);

    finishFirstDialog(false);
    assert.equal(await firstRoll, false);
});

test("a clean system falls back to the numeric sum for only this attack", async (context) => {
    const liveTarget = tokenFor(actorInPosition("prone"), "live-target");
    installGlobals(context, () => liveTarget);
    const actor = attackActor({
        attackId: "sword",
        attackName: "Langschwert",
        items: [positionMarker("kneeling")],
    });
    const received = [];

    await performAttack(
        { actor, target: tokenFor(actorInPosition("standing"), "stale-target") },
        "sword",
        { modifier: 2 },
        async (_attack, options) => {
            received.push(options);
            return false;
        },
    );
    await performAttack(
        { actor: { ...actor, items: [] }, target: liveTarget },
        "sword",
        { modifier: 2 },
        async (_attack, options) => {
            received.push(options);
            return false;
        },
    );

    assert.deepEqual(received.map((options) => options.modifier), [5, 8]);
    assert.equal(Object.keys(received[0]).some((key) => key.includes("RollSelectionId")), false);
});

test("VTD spells combine target position and magic protection without using the caster position", async (context) => {
    const targetActor = actorInPosition("kneeling");
    targetActor.items.push({
        id: "protection",
        name: "Kleiner Magieschutz",
        type: "spelleffect",
        system: { active: true },
    });
    const target = tokenFor(targetActor, "target");
    installGlobals(context, () => target);
    const modifierManager = newModifierManager();
    let observed;
    const skill = {
        id: "firemagic",
        roll(options) {
            observed = {
                modifiers: [...(modifierManager._modifier.get(this.id) ?? [])],
                options,
            };
            return Promise.resolve(false);
        },
        get selectableModifier() {
            return modifierManager._modifier.get(this.id) ?? [];
        },
    };
    const actor = spellActor({
        items: [positionMarker("flying")],
        modifierManager,
        skill,
    });

    await performSpell({ actor }, "spell");

    assert.deepEqual(observed.modifiers.map((modifier) => [
        modifier.attributes.name,
        modifier.value.amount,
    ]), [
        ["Kleiner Magieschutz", -1],
        ["Kampfposition: Gegner kniend", -3],
    ]);
    assert.deepEqual(observed.options.preSelectedModifier, [
        "Schaden",
        "Kleiner Magieschutz",
        "Kampfposition: Gegner kniend",
    ]);
    assert.equal(modifierManager._modifier.has(skill.id), false);
});

test("overlapping prepared rolls remain isolated by selection id", async (context) => {
    installGlobals(context);
    const modifierManager = newModifierManager();
    const calls = [];
    const originalRoll = (options) => {
        calls.push({
            modifiers: [...(modifierManager._modifier.get("blades") ?? [])],
            options,
        });
        return Promise.resolve(false);
    };
    const skill = { id: "blades", roll: originalRoll };
    const first = prepareTemporaryRollModifiers({
        skill,
        modifierManager,
        groupId: skill.id,
        modifiers: [{ amount: -3, name: "Erster", recordId: "first" }],
    });
    const second = prepareTemporaryRollModifiers({
        skill,
        modifierManager,
        groupId: skill.id,
        modifiers: [{ amount: 6, name: "Zweiter", recordId: "second" }],
    });

    await skill.roll(first.rollOptions);
    await skill.roll(second.rollOptions);

    assert.deepEqual(calls.map((call) => call.modifiers.map((modifier) => [
        modifier.attributes.name,
        modifier.value.amount,
    ])), [[ ["Erster", -3] ], [ ["Zweiter", 6] ]]);
    assert.equal(skill.roll, originalRoll);
    assert.equal(modifierManager._modifier.has(skill.id), false);
    first.cleanup();
    second.cleanup();
});

test("roll exceptions restore the original skill and remove only temporary modifiers", (context) => {
    installGlobals(context);
    const modifierManager = newModifierManager();
    const originalRoll = () => {
        assert.equal(modifierManager._modifier.get("blades").length, 1);
        throw new Error("dialog failed");
    };
    const skill = { id: "blades", roll: originalRoll };
    const prepared = prepareTemporaryRollModifiers({
        skill,
        modifierManager,
        groupId: skill.id,
        modifiers: [{ amount: -3, name: "Position", recordId: "position" }],
    });

    assert.throws(() => skill.roll(prepared.rollOptions), /dialog failed/u);
    assert.equal(skill.roll, originalRoll);
    assert.equal(modifierManager._modifier.has(skill.id), false);
    assert.doesNotThrow(() => {
        prepared.cleanup();
        prepared.cleanup();
    });
});

function installGlobals(context, target = () => null) {
    const previousGame = globalThis.game;
    const previousUi = globalThis.ui;
    const previousServices = {
        getRuntimeController: services.getRuntimeController,
        getTargetSelectionForUser: services.getTargetSelectionForUser,
        scheduleRender: services.scheduleRender,
        withTemporarySystemTargets: services.withTemporarySystemTargets,
    };
    globalThis.game = {
        i18n: {
            localize: (key) => translations[key] ?? key,
            format: (key, data) => Object.entries(data).reduce(
                (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
                translations[key] ?? key,
            ),
        },
    };
    globalThis.ui = { notifications: { warn: () => assert.fail("unexpected warning") } };
    services.getRuntimeController = () => ({ id: "runtime-controller" });
    services.getTargetSelectionForUser = () => {
        const selected = target();
        return { target: selected, targets: selected ? [selected] : [] };
    };
    services.scheduleRender = () => {};
    services.withTemporarySystemTargets = async (_targets, operation) => operation();
    context.after(() => {
        if (previousGame === undefined) delete globalThis.game;
        else globalThis.game = previousGame;
        if (previousUi === undefined) delete globalThis.ui;
        else globalThis.ui = previousUi;
        Object.assign(services, previousServices);
    });
}

function actorInPosition(position) {
    return { items: position === "standing" ? [] : [positionMarker(position)] };
}

function positionMarker(position) {
    const names = { flying: "Fliegend", kneeling: "Kniend", prone: "Liegend" };
    return {
        id: `position-${position}`,
        name: names[position],
        type: "statuseffect",
        system: { level: 1 },
        flags: { "splittermond-smoother-fight": { combatPosition: position } },
    };
}

function tokenFor(actor, id) {
    return { actor, id, name: id, uuid: `Scene.scene.Token.${id}` };
}

function attackActor({ attackId, attackName, items = [], modifierManager = null, skill = null }) {
    const actor = {
        attacks: [],
        id: `actor-${attackId}`,
        items,
        modifier: modifierManager,
        getFlag: () => null,
    };
    const attack = {
        actor,
        id: attackId,
        isRanged: false,
        item: { name: attackName },
        name: attackName,
        skill,
    };
    attack.roll = (options = {}) => skill?.roll?.({
        type: "attack",
        difficulty: "VTD",
        modifier: 0,
        preSelectedModifier: [attackName],
        ...structuredClone(options),
    }) ?? false;
    actor.attacks.push(attack);
    actor.rollAttack = (id, options) => {
        assert.equal(id, attackId);
        return attack.roll(options);
    };
    if (skill) skill.actor = actor;
    return actor;
}

function spellActor({ items = [], modifierManager, skill }) {
    const actor = {
        id: "caster",
        items,
        modifier: modifierManager,
        spells: [],
        getFlag: (_namespace, key) => key === "preparedSpell" ? "spell" : null,
    };
    const spell = {
        actor,
        difficulty: "VTD",
        id: "spell",
        name: "Flammenstrahl",
        skill,
    };
    actor.spells.push(spell);
    actor.rollSpell = (id, options) => {
        assert.equal(id, spell.id);
        return skill.roll({
            ...options,
            preSelectedModifier: ["Schaden"],
            type: "spell",
        });
    };
    skill.actor = actor;
    return actor;
}

function newModifierManager() {
    class AmountExpression {
        constructor(amount) {
            this.amount = amount;
        }
    }
    return {
        _modifier: new Map([[
            "template",
            [{ attributes: { name: "Vorlage" }, selectable: false, value: new AmountExpression(0) }],
        ]]),
        add(groupId, attributes, value, selectable) {
            const key = groupId.toLocaleLowerCase();
            this._modifier.set(key, [
                ...(this._modifier.get(key) ?? []),
                { attributes, selectable, value },
            ]);
        },
    };
}
