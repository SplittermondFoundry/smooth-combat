import test from "node:test";
import assert from "node:assert/strict";

import {
    performAttack,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/actions.js";

import {
    installSystemRollModifierInterceptor,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/system-roll-modifier-interceptor.js";

import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";

const translations = {
    "SMOOTHER_FIGHT.HUD.CombatPositionModifiers.own.kneeling": "Kampfposition: kniend",
    "SMOOTHER_FIGHT.HUD.CombatPositionModifiers.own.prone": "Kampfposition: liegend",
    "SMOOTHER_FIGHT.HUD.CombatPositionModifiers.own.flying": "Kampfposition: fliegend",
    "SMOOTHER_FIGHT.HUD.CombatPositionModifiers.target.kneeling": "Kampfposition: Gegner kniend",
    "SMOOTHER_FIGHT.HUD.CombatPositionModifiers.target.prone": "Kampfposition: Gegner liegend",
    "SMOOTHER_FIGHT.HUD.CombatPositionModifiers.target.flying": "Kampfposition: Gegner fliegend",
    "SMOOTHER_FIGHT.HUD.SmallMagicProtectionModifier": "Kleiner Magieschutz",
    "SMOOTHER_FIGHT.HUD.SmallMagicProtectionEnhancedModifier": "Kleiner Magieschutz (Verstärkt)",
};

test("native Actor attacks from the action bar, sheets, and macros apply live combat positions", async (context) => {
    const target = tokenFor(actorInPosition("prone"), "prone-target");
    const { ActorClass, targets } = installGlobals(context, [target]);
    const modifierManager = newModifierManager();
    let observed;
    const skill = newSkill("blades", modifierManager, (options) => {
        observed = snapshotRoll(modifierManager, "skill.sword", options);
        return false;
    });
    const actor = attackActor(ActorClass, {
        attackId: "sword",
        attackName: "Langschwert",
        items: [positionMarker("flying")],
        modifierManager,
        skill,
    });

    assert.equal(installSystemRollModifierInterceptor(), true);
    const installedRollAttack = ActorClass.prototype.rollAttack;
    assert.equal(installSystemRollModifierInterceptor(), true);
    assert.equal(ActorClass.prototype.rollAttack, installedRollAttack, "installation must be idempotent");

    assert.equal(await actor.rollAttack("sword"), false);
    assert.deepEqual(observed.modifiers, [
        ["Kampfposition: fliegend", 3],
        ["Kampfposition: Gegner liegend", 6],
    ]);
    assert.deepEqual(observed.options.preSelectedModifier, [
        "Langschwert",
        "Kampfposition: fliegend",
        "Kampfposition: Gegner liegend",
    ]);
    assert.equal(modifierManager._modifier.has("skill.sword"), false);
    assert.equal(skill.roll, skill.originalRoll);

    targets.clear();
    targets.add(tokenFor(actorInPosition("standing"), "standing-target"));
    assert.equal(await actor.rollAttack("sword"), false);
    assert.deepEqual(observed.modifiers, [["Kampfposition: fliegend", 3]]);
});

test("native Actor spells combine VTD position and active target spell effects", async (context) => {
    const targetActor = actorInPosition("kneeling");
    targetActor.items.push({
        id: "protection",
        name: "Kleiner Magieschutz (Verstärkt)",
        type: "spelleffect",
        system: { active: true },
    });
    const { ActorClass } = installGlobals(context, [tokenFor(targetActor, "protected-target")]);
    const modifierManager = newModifierManager();
    let observed;
    const skill = newSkill("firemagic", modifierManager, (options) => {
        observed = snapshotRoll(modifierManager, skill.id, options);
        return false;
    });
    const actor = spellActor(ActorClass, {
        items: [positionMarker("flying")],
        modifierManager,
        skill,
    });

    installSystemRollModifierInterceptor();
    assert.equal(await actor.rollSpell("spell"), false);

    assert.deepEqual(observed.modifiers, [
        ["Kleiner Magieschutz (Verstärkt)", -2],
        ["Kampfposition: Gegner kniend", -3],
    ]);
    assert.deepEqual(observed.options.preSelectedModifier, [
        "Schaden",
        "Kleiner Magieschutz (Verstärkt)",
        "Kampfposition: Gegner kniend",
    ]);
    assert.equal(modifierManager._modifier.has(skill.id), false);
    assert.equal(skill.roll, skill.originalRoll);
});

test("HUD-prepared target modifiers pass the Actor interceptor exactly once", async (context) => {
    const target = tokenFor(actorInPosition("prone"), "target");
    const { ActorClass } = installGlobals(context, [target]);
    const modifierManager = newModifierManager();
    let observed;
    const skill = newSkill("blades", modifierManager, (options) => {
        observed = snapshotRoll(modifierManager, "skill.sword", options);
        return false;
    });
    const actor = attackActor(ActorClass, {
        attackId: "sword",
        attackName: "Langschwert",
        items: [positionMarker("flying")],
        modifierManager,
        skill,
    });
    installSystemRollModifierInterceptor();
    assert.equal(await performAttack({ actor }, "sword"), false);

    assert.deepEqual(observed.modifiers, [
        ["Kampfposition: fliegend", 3],
        ["Kampfposition: Gegner liegend", 6],
    ]);
    assert.equal(
        Object.keys(actor.lastAttackOptions).some((key) => key.includes("targetModifiersPrepared")),
        false,
        "the private hand-off marker must not reach Splittermond",
    );
});

test("an open native roll cannot leak into another target and exceptions still clean up", async (context) => {
    const proneTarget = tokenFor(actorInPosition("prone"), "prone-target");
    const { ActorClass, targets } = installGlobals(context, [proneTarget]);
    const modifierManager = newModifierManager();
    let finishFirst;
    const calls = [];
    const skill = newSkill("blades", modifierManager, (options) => {
        calls.push(snapshotRoll(modifierManager, "skill.sword", options));
        if (calls.length === 1) return new Promise((resolve) => finishFirst = resolve);
        if (calls.length === 3) throw new Error("dialog failed");
        return false;
    });
    const actor = attackActor(ActorClass, {
        attackId: "sword",
        attackName: "Langschwert",
        modifierManager,
        skill,
    });
    installSystemRollModifierInterceptor();

    const firstRoll = actor.rollAttack("sword");
    await waitUntil(() => calls.length === 1);
    assert.deepEqual(calls[0].modifiers, [["Kampfposition: Gegner liegend", 6]]);
    assert.equal(modifierManager._modifier.has("skill.sword"), false);

    targets.clear();
    targets.add(tokenFor(actorInPosition("standing"), "standing-target"));
    assert.equal(await actor.rollAttack("sword"), false);
    assert.deepEqual(calls[1].modifiers, []);

    finishFirst(false);
    assert.equal(await firstRoll, false);

    targets.clear();
    targets.add(proneTarget);
    await assert.rejects(() => actor.rollAttack("sword"), /dialog failed/u);
    assert.equal(modifierManager._modifier.has("skill.sword"), false);
    assert.equal(skill.roll, skill.originalRoll);
});

function installGlobals(context, initialTargets) {
    const previousConfig = globalThis.CONFIG;
    const previousGame = globalThis.game;
    const previousServices = {
        getRuntimeController: services.getRuntimeController,
        getTargetSelectionForUser: services.getTargetSelectionForUser,
        scheduleRender: services.scheduleRender,
        withTemporarySystemTargets: services.withTemporarySystemTargets,
    };
    const targets = new Set(initialTargets.map((target) => tokenObjectFor(target)));
    class ActorClass {
        async rollAttack(attackId, options = {}) {
            this.lastAttackOptions = options;
            await Promise.resolve();
            return this.attacks.find((attack) => attack.id === attackId)?.roll(options);
        }

        async rollSpell(spellId, options = {}) {
            this.lastSpellOptions = options;
            await Promise.resolve();
            return this.spells.find((spell) => spell.id === spellId)?.roll(options);
        }
    }
    globalThis.CONFIG = {
        ...(previousConfig ?? {}),
        Actor: { documentClass: ActorClass },
        splittermond: { skillGroups: { ranged: ["throwing", "longrange"] } },
    };
    globalThis.game = {
        ...(previousGame ?? {}),
        i18n: {
            localize: (key) => translations[key] ?? key,
        },
        user: { targets },
    };
    services.getRuntimeController = () => globalThis.game.user;
    services.getTargetSelectionForUser = () => {
        const target = Array.from(targets)[0]?.document ?? null;
        return { target, targets: target ? [target] : [] };
    };
    services.scheduleRender = () => {};
    services.withTemporarySystemTargets = async (requested, operation) => {
        const previous = Array.from(targets);
        targets.clear();
        for (const target of requested ?? []) targets.add(tokenObjectFor(target));
        try {
            return await operation();
        } finally {
            targets.clear();
            for (const target of previous) targets.add(target);
        }
    };
    context.after(() => {
        if (previousConfig === undefined) delete globalThis.CONFIG;
        else globalThis.CONFIG = previousConfig;
        if (previousGame === undefined) delete globalThis.game;
        else globalThis.game = previousGame;
        Object.assign(services, previousServices);
    });
    return { ActorClass, targets };
}

function attackActor(ActorClass, {
    attackId,
    attackName,
    items = [],
    modifierManager,
    skill,
}) {
    const actor = new ActorClass();
    Object.assign(actor, {
        attacks: [],
        id: `actor-${attackId}`,
        items,
        modifier: modifierManager,
        getFlag: () => null,
    });
    const attack = {
        actor,
        id: attackId,
        isRanged: false,
        item: { name: attackName },
        name: attackName,
        skill,
        async roll(options = {}) {
            await Promise.resolve();
            return skill.roll({
                type: "attack",
                difficulty: "VTD",
                modifier: 0,
                preSelectedModifier: [attackName],
                ...structuredClone(options),
            });
        },
    };
    actor.attacks.push(attack);
    skill.actor = actor;
    return actor;
}

function spellActor(ActorClass, { items = [], modifierManager, skill }) {
    const actor = new ActorClass();
    Object.assign(actor, {
        id: "caster",
        items,
        modifier: modifierManager,
        spells: [],
    });
    const spell = {
        actor,
        difficulty: "VTD",
        id: "spell",
        name: "Flammenstrahl",
        skill,
        async roll(options = {}) {
            await Promise.resolve();
            return skill.roll({
                ...structuredClone(options),
                preSelectedModifier: ["Schaden"],
                type: "spell",
            });
        },
    };
    actor.spells.push(spell);
    skill.actor = actor;
    return actor;
}

function newSkill(id, modifierManager, roll) {
    const skill = {
        id,
        roll,
        get selectableModifier() {
            return modifierManager._modifier.get(id) ?? [];
        },
    };
    skill.originalRoll = roll;
    return skill;
}

function snapshotRoll(modifierManager, groupId, options) {
    return {
        modifiers: [...(modifierManager._modifier.get(groupId) ?? [])].map((modifier) => [
            modifier.attributes.name,
            modifier.value.amount,
        ]),
        options,
    };
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

function tokenObjectFor(document) {
    return { actor: document.actor, document, id: document.id };
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
        add(groupId, attributes, value, origin = null, selectable = false) {
            const key = groupId.toLocaleLowerCase();
            this._modifier.set(key, [
                ...(this._modifier.get(key) ?? []),
                { attributes, origin, selectable, value },
            ]);
        },
    };
}

async function waitUntil(predicate) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail("condition was not reached");
}
