import assert from "node:assert/strict";
import test from "node:test";

import {
    warnIfSpellOutOfRange,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/range-warning.js";

function installRangeFixture(targetX = 100) {
    const warnings = [];
    globalThis.canvas = {
        grid: {
            size: 100,
            type: 1,
            units: "m",
            measurePath: () => ({ distance: targetX / 50 }),
        },
    };
    globalThis.game = {
        i18n: {
            localize: (key) => key,
            format: (key, data) => `${key}:${JSON.stringify(data)}`,
        },
    };
    globalThis.ui = { notifications: { warn: (message) => warnings.push(message) } };
    return {
        warnings,
        context: {
            actor: { items: [] },
            token: { x: 0, y: 0, width: 1, height: 1 },
            target: { x: targetX, y: 0, width: 1, height: 1 },
        },
    };
}

test("adjacent touch spells pass the execution-time range warning", () => {
    const { context, warnings } = installRangeFixture(100);

    const assessment = warnIfSpellOutOfRange(context, {
        name: "Touch spell",
        range: "Berührung",
    });

    assert.equal(assessment.status, "within");
    assert.deepEqual(warnings, []);
});

test("Hand des Zauberers grants touch range only in the matching spell school", () => {
    const { context, warnings } = installRangeFixture(100);
    context.actor.items = [{
        type: "mastery",
        name: "Hand des Zauberers",
        system: { skill: "firemagic" },
    }];
    const fireSpell = {
        name: "Fire spell",
        range: "Zauberer",
        system: { skill: "firemagic" },
    };
    const windSpell = {
        name: "Wind spell",
        range: "Zauberer",
        system: { skill: "windmagic" },
    };

    assert.equal(warnIfSpellOutOfRange(context, fireSpell).status, "within");
    assert.equal(warnIfSpellOutOfRange(context, windSpell).status, "unknown");
    assert.deepEqual(warnings, []);
});

test("a non-adjacent touch spell remains visibly out of range", () => {
    const { context, warnings } = installRangeFixture(200);

    const assessment = warnIfSpellOutOfRange(context, {
        name: "Touch spell",
        range: "Berührung",
    });

    assert.equal(assessment.status, "outside");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /SpellRangeWarning/u);
    assert.match(warnings[0], /Berührung/u);
});
