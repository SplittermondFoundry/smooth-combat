import test from "node:test";
import assert from "node:assert/strict";

import { prepareDefenderRollOptions } from "../Modul/splittermond-smoother-fight/scripts/features/active-defense/active-defense.js";
import { activeDefenseOptionSummaries } from "../Modul/splittermond-smoother-fight/scripts/features/hud/defense-options.js";

test("active-defense options expose distinct names, skills, and roll values", (context) => {
    const previousGame = globalThis.game;
    globalThis.game = { i18n: { localize: (value) => value } };
    context.after(() => {
        if (previousGame === undefined) delete globalThis.game;
        else globalThis.game = previousGame;
    });

    assert.deepEqual(activeDefenseOptionSummaries([
        { id: "acrobatics", name: "Akrobatik", skill: { label: "Akrobatik", value: 17 } },
        { id: "saber", name: "Säbel", skill: { label: "Klingenwaffen", value: { value: 19 } } },
        { id: "saber-copy", name: "Säbel", skill: { label: "Klingenwaffen", value: 19 } },
        { id: "fallback" },
    ]), [
        { label: "Akrobatik", value: 17 },
        { label: "Säbel · Klingenwaffen", value: 19 },
        { label: "fallback", value: "" },
    ]);
});

test("Defender creates and preselects a temporary named modifier when the system entry is missing", (context) => {
    const previousGame = globalThis.game;
    globalThis.game = {
        i18n: {
            localize: (key) => key === "SMOOTHER_FIGHT.HUD.DefenderModifier" ? "Verteidiger" : key,
        },
    };
    context.after(() => {
        if (previousGame === undefined) delete globalThis.game;
        else globalThis.game = previousGame;
    });

    class FakeAmountExpression {
        constructor(amount) {
            this.amount = amount;
        }
    }
    const modifierManager = {
        _modifier: new Map([
            ["woundmalus", [{ attributes: { name: "Wundabzug" }, value: new FakeAmountExpression(-1) }]],
        ]),
        add(groupId, attributes, value, selectable) {
            const key = groupId.toLocaleLowerCase();
            const modifier = { attributes, value, selectable };
            this._modifier.set(key, [...(this._modifier.get(key) ?? []), modifier]);
        },
    };
    const skill = {
        get selectableModifier() {
            return modifierManager._modifier.get("skill.sword") ?? [];
        },
    };
    const choice = {
        actor: { modifier: modifierManager },
        defense: { id: "sword", skill },
    };

    const prepared = prepareDefenderRollOptions(choice, { pendingDefenseId: "pending-defender" });
    assert.deepEqual(prepared.rollOptions, {
        preSelectedModifier: ["Verteidiger"],
        modifier: 0,
    });
    assert.equal(prepared.usesNamedModifier, true);
    const temporaryModifier = modifierManager._modifier.get("skill.sword")[0];
    assert.equal(temporaryModifier.attributes.name, "Verteidiger");
    assert.equal(temporaryModifier.value.amount, -3);
    assert.equal(temporaryModifier.value instanceof FakeAmountExpression, true);

    prepared.cleanup();
    assert.equal(modifierManager._modifier.has("skill.sword"), false);
    assert.equal(modifierManager._modifier.has("woundmalus"), true, "unrelated system modifiers must remain");
});
