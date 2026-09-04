import test from "node:test";
import assert from "node:assert/strict";

import { performSpell } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/actions.js";
import {
    prepareSpellTargetRollOptions,
    smallMagicProtectionModifier,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/spell-target-modifier.js";
import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";

const translations = {
    "SMOOTHER_FIGHT.HUD.SmallMagicProtectionModifier": "Kleiner Magieschutz",
    "SMOOTHER_FIGHT.HUD.SmallMagicProtectionEnhancedModifier": "Kleiner Magieschutz (Verstärkt)",
};

test("small magic protection is detected only as an active spell effect on the target", (context) => {
    installGlobals(context);
    const active = spellEffect("Kleiner Magieschutz", true, "active");
    const target = {
        actor: {
            items: new Map([
                ["wrong-type", { type: "statuseffect", name: "Kleiner Magieschutz", system: { active: true } }],
                ["inactive", spellEffect("Kleiner Magieschutz (Verstärkt)", false, "inactive")],
                ["unrelated", spellEffect("Großer Magieschutz (Verstärkt)", true, "unrelated")],
                [active.id, active],
            ]),
        },
    };

    const modifier = smallMagicProtectionModifier(target);
    assert.equal(modifier.amount, -1);
    assert.equal(modifier.name, "Kleiner Magieschutz");
    assert.equal(modifier.effect, active);
    assert.equal(smallMagicProtectionModifier({ actor: { items: [spellEffect("Kleiner Magieschutzlos", true)] } }), null);
});

test("enhanced small magic protection is recognized independent of case, punctuation, and umlaut spelling", (context) => {
    installGlobals(context);
    for (const name of [
        "Kleiner Magieschutz – VERSTÄRKT!",
        "Kleiner Magieschutz (verstaerkt)",
        "Kleiner Magieschutz, verstärkte Fassung",
        "Verstärkt: Kleiner Magieschutz",
    ]) {
        const modifier = smallMagicProtectionModifier({ actor: { items: [spellEffect(name, true)] } });
        assert.equal(modifier.amount, -2, name);
        assert.equal(modifier.name, "Kleiner Magieschutz (Verstärkt)", name);
    }
    assert.equal(
        smallMagicProtectionModifier({ actor: { items: [spellEffect("Kleiner Magieschutz (unverstärkt)", true)] } }).amount,
        -1,
    );
});

test("enhanced protection takes precedence when normal and enhanced effects are both active", (context) => {
    installGlobals(context);
    const target = {
        actor: {
            items: [
                spellEffect("Kleiner Magieschutz", true, "normal"),
                spellEffect("Kleiner Magieschutz (Verstärkt)", true, "enhanced"),
            ],
        },
    };

    const modifier = smallMagicProtectionModifier(target);
    assert.equal(modifier.amount, -2);
    assert.equal(modifier.name, "Kleiner Magieschutz (Verstärkt)");
    assert.equal(modifier.effect.id, "enhanced");
});

test("the named target modifier remains selected when the system replaces spell roll selections", async (context) => {
    installGlobals(context);
    const modifierManager = newModifierManager();
    let receivedOptions;
    let temporaryModifier;
    const originalRoll = async (options) => {
        receivedOptions = options;
        temporaryModifier = modifierManager._modifier.get("protectionmagic")?.[0];
        return false;
    };
    const skill = {
        id: "protectionmagic",
        roll: originalRoll,
        get selectableModifier() {
            return modifierManager._modifier.get(this.id) ?? [];
        },
    };
    const spell = {
        id: "spell-1",
        actor: { modifier: modifierManager },
        skill,
    };
    const target = {
        actor: {
            uuid: "Actor.target",
            items: [spellEffect("Kleiner Magieschutz", true, "effect-1")],
        },
    };

    const prepared = prepareSpellTargetRollOptions(spell, target);
    assert.equal(prepared.usesNamedModifier, true);
    assert.equal(modifierManager._modifier.has(skill.id), false);

    const roll = skill.roll({
        ...prepared.rollOptions,
        checkMessageData: { spell: { id: spell.id } },
        preSelectedModifier: ["Schutz"],
        type: "spell",
    });
    assert.equal(temporaryModifier.attributes.name, "Kleiner Magieschutz");
    assert.equal(temporaryModifier.value.amount, -1);
    assert.equal(temporaryModifier.selectable, true);
    assert.equal(modifierManager._modifier.has(skill.id), false);
    assert.equal(skill.roll, originalRoll);
    await roll;
    assert.deepEqual(receivedOptions.preSelectedModifier, ["Schutz", "Kleiner Magieschutz"]);

    prepared.cleanup();
    assert.equal(skill.roll, originalRoll);
    assert.equal(modifierManager._modifier.has(skill.id), false);
});

test("an open protected roll cannot leak its modifier into a later roll against an unprotected target", async (context) => {
    installGlobals(context);
    const modifierManager = newModifierManager();
    let finishProtectedRoll;
    const calls = [];
    const originalRoll = (options) => {
        calls.push({
            modifiers: [...(modifierManager._modifier.get("shadowmagic") ?? [])],
            options,
        });
        if (calls.length === 1) {
            return new Promise((resolve) => finishProtectedRoll = resolve);
        }
        return Promise.resolve(false);
    };
    const skill = {
        id: "shadowmagic",
        roll: originalRoll,
        get selectableModifier() {
            return modifierManager._modifier.get(this.id) ?? [];
        },
    };
    const spell = { id: "spell-1", actor: { modifier: modifierManager }, skill };
    const target = {
        actor: {
            uuid: "Actor.target",
            items: [spellEffect("Kleiner Magieschutz", true, "effect-1")],
        },
    };

    const protectedRoll = prepareSpellTargetRollOptions(spell, target);
    const pendingDialog = skill.roll({
        ...protectedRoll.rollOptions,
        preSelectedModifier: ["Schatten"],
    });
    assert.equal(calls[0].modifiers.length, 1);
    assert.equal(calls[0].modifiers[0].attributes.name, "Kleiner Magieschutz");
    assert.equal(modifierManager._modifier.has(skill.id), false);
    assert.equal(skill.roll, originalRoll);

    const unprotectedRoll = prepareSpellTargetRollOptions(spell, { actor: { items: [] } });
    await skill.roll({
        ...unprotectedRoll.rollOptions,
        preSelectedModifier: ["Schatten"],
    });
    assert.deepEqual(calls[1].modifiers, []);
    assert.deepEqual(calls[1].options.preSelectedModifier, ["Schatten"]);

    finishProtectedRoll(false);
    await pendingDialog;
    protectedRoll.cleanup();
});

test("casting from the HUD applies enhanced small magic protection and cleans it up after cancellation", async (context) => {
    const modifierManager = newModifierManager();
    let receivedOptions;
    const skill = {
        id: "firemagic",
        async roll(options) {
            receivedOptions = options;
            const temporaryModifier = modifierManager._modifier.get(this.id)[0];
            assert.equal(temporaryModifier.attributes.name, "Kleiner Magieschutz (Verstärkt)");
            assert.equal(temporaryModifier.value.amount, -2);
            return false;
        },
        get selectableModifier() {
            return modifierManager._modifier.get(this.id) ?? [];
        },
    };
    const target = {
        uuid: "Scene.scene.Token.target",
        actor: {
            uuid: "Actor.target",
            items: [spellEffect("Kleiner Magieschutz [vErStÄrKt]", true, "enhanced")],
        },
    };
    const runtimeController = { id: "controller" };
    const actor = {
        id: "caster",
        modifier: modifierManager,
        spells: [],
        getFlag: (_namespace, key) => key === "preparedSpell" ? "spell-1" : null,
        rollSpell: async (spellId, options) => {
            assert.equal(spellId, "spell-1");
            return skill.roll({
                ...options,
                checkMessageData: { spell: { id: spellId } },
                preSelectedModifier: ["Schaden"],
                type: "spell",
            });
        },
    };
    const spell = {
        actor,
        difficulty: "VTD",
        id: "spell-1",
        name: "Flammenstrahl",
        skill,
    };
    actor.spells.push(spell);
    installGlobals(context, { runtimeController, target });

    await performSpell({ actor }, spell.id);

    assert.deepEqual(receivedOptions.preSelectedModifier, ["Schaden", "Kleiner Magieschutz (Verstärkt)"]);
    assert.equal(modifierManager._modifier.has(skill.id), false);
});

function spellEffect(name, active, id = name) {
    return {
        id,
        name,
        type: "spelleffect",
        system: { active },
    };
}

function newModifierManager() {
    class AmountExpression {
        constructor(amount) {
            this.amount = amount;
        }
    }
    return {
        _modifier: new Map([
            ["template", [{
                attributes: { name: "Vorlage" },
                selectable: false,
                value: new AmountExpression(0),
            }]],
        ]),
        add(groupId, attributes, value, origin = null, selectable = false) {
            const key = groupId.toLocaleLowerCase();
            const modifier = { attributes, origin, selectable, value };
            this._modifier.set(key, [...(this._modifier.get(key) ?? []), modifier]);
        },
    };
}

function installGlobals(context, { runtimeController = null, target = null } = {}) {
    const previousGame = globalThis.game;
    const previousUi = globalThis.ui;
    globalThis.game = {
        i18n: {
            localize: (key) => translations[key] ?? key,
        },
    };
    globalThis.ui = { notifications: { warn: () => assert.fail("unexpected warning") } };
    services.getRuntimeController = () => runtimeController;
    services.getTargetSelectionForUser = () => ({ target, targets: target ? [target] : [] });
    services.scheduleRender = () => {};
    services.withTemporarySystemTargets = async (_targets, operation) => operation();
    context.after(() => {
        if (previousGame === undefined) delete globalThis.game;
        else globalThis.game = previousGame;
        if (previousUi === undefined) delete globalThis.ui;
        else globalThis.ui = previousUi;
    });
}
