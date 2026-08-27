import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    getGmCheatRollPreset,
    installGmCheatRollInterceptor,
    toggleGmCheatRoll,
} from "../Modul/splittermond-smoother-fight/scripts/features/gm-cheat/gm-cheat.js";

const WORKSPACE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("GM cheat mode detects and presets the dice of the next evaluated roll", async () => {
    class TestDie {
        constructor(number, faces = 10) {
            this.number = number;
            this.faces = faces;
        }

        randomFace() {
            return Math.min(6, this.faces);
        }
    }

    class TestRoll {
        constructor(dice, formula) {
            this.dice = dice;
            this.formula = formula;
            this._evaluated = false;
            this.results = [];
        }

        async evaluate() {
            this.results = this.dice.flatMap((term) =>
                Array.from({ length: term.number }, () => term.randomFace())
            );
            this._evaluated = true;
            return this;
        }
    }

    const notifications = [];
    const selections = [
        { values: [5] },
        { values: [3, 9, 4] },
        { values: [1, 2, 8, 10] },
        null,
    ];
    const dialogConfigs = [];
    globalThis.CONFIG = { Dice: { rolls: [TestRoll], terms: { d: TestDie } } };
    globalThis.game = {
        user: { id: "gm", isGM: true },
        i18n: {
            localize: (key) => key,
            format: (key, data) => `${key}:${JSON.stringify(data)}`,
        },
    };
    globalThis.ui = { notifications: { info: (message) => notifications.push(message) } };
    globalThis.foundry = {
        applications: {
            api: {
                DialogV2: {
                    wait: async (config) => {
                        dialogConfigs.push(config);
                        return selections.shift() ?? null;
                    },
                },
            },
        },
    };

    assert.equal(installGmCheatRollInterceptor(), true);
    assert.equal(installGmCheatRollInterceptor(), true, "installing twice must not wrap the Roll class twice");
    assert.equal(await toggleGmCheatRoll(), true);
    assert.deepEqual(getGmCheatRollPreset(), { armed: true });
    assert.equal(dialogConfigs.length, 0, "arming must not ask for results before a roll is known");

    const hudPreview = new TestRoll([new TestDie(1, 10)], "1d10");
    await hudPreview.evaluate({ allowInteractive: false });
    assert.deepEqual(hudPreview.results, [6], "a non-interactive HUD calculation must roll normally");
    assert.equal(dialogConfigs.length, 0, "a non-interactive HUD calculation must not open the cheat dialog");
    assert.deepEqual(getGmCheatRollPreset(), { armed: true }, "a HUD calculation must not consume cheat mode");

    const deterministic = new TestRoll([], "7 + 3");
    await deterministic.evaluate();
    assert.deepEqual(getGmCheatRollPreset(), { armed: true }, "a roll without dice must not consume cheat mode");

    const damageDie = new TestDie(1, 6);
    const damage = new TestRoll([damageDie], "1d6 + 2");
    await damage.evaluate();
    assert.deepEqual(damage.results, [5], "a detected single d6 damage die must be presettable");
    assert.equal(getGmCheatRollPreset(), null);
    assert.match(dialogConfigs[0].content, /1W6/u);
    assert.match(dialogConfigs[0].content, /name="die0"[^>]*max="6"/u);
    assert.doesNotMatch(dialogConfigs[0].content, /name="die1"/u);
    assert.equal(damageDie.randomFace(), 6, "the die's original random function must be restored afterwards");

    assert.equal(await toggleGmCheatRoll(), true);
    const mixed = new TestRoll([new TestDie(2, 10), new TestDie(1, 6)], "2d10 + 1d6");
    await mixed.evaluate();
    assert.deepEqual(mixed.results, [3, 9, 4], "mixed dice terms must keep their detected order and ranges");
    assert.match(dialogConfigs[1].content, /2W10 \+ 1W6/u);

    assert.equal(await toggleGmCheatRoll(), true);
    const risk = new TestRoll([new TestDie(4, 10)], "4d10ri");
    await risk.evaluate();
    assert.deepEqual(risk.results, [1, 2, 8, 10], "all four visible dice of a risk roll must be prescribed");
    assert.equal(getGmCheatRollPreset(), null);

    assert.equal(await toggleGmCheatRoll(), true);
    const normal = new TestRoll([new TestDie(1, 8)], "1d8");
    await normal.evaluate();
    assert.deepEqual(normal.results, [6], "choosing normal rolling must preserve the original random result");
    assert.equal(getGmCheatRollPreset(), null);
    assert.equal(notifications.length, 8, "arming and resolving each captured roll only notifies the local GM");

    globalThis.game.user = { id: "player", isGM: false };
    assert.equal(await toggleGmCheatRoll(), false);
    assert.equal(getGmCheatRollPreset(), null);
});

test("the cheat control is rendered behind an explicit GM-only guard", async () => {
    const viewPath = path.join(
        WORKSPACE_ROOT,
        "Modul",
        "splittermond-smoother-fight",
        "scripts",
        "features",
        "hud",
        "view.js",
    );
    const source = await readFile(viewPath, "utf8");
    assert.match(source, /function buildGmCheatToggle\(\) \{\s*if \(!game\.user\?\.isGM\) return "";/u);
    assert.match(source, /data-sf-action="toggle-cheat-roll"/u);
});
