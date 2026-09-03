import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    installSystemActionBarActiveDefenseInterceptor,
} from "../Modul/splittermond-smoother-fight/scripts/features/active-defense/system-action-bar.js";

const harness = {};
configureServices({
    beginStandaloneActiveDefense: (...args) => harness.beginStandaloneActiveDefense(...args),
    getControlledTokenDocument: () => harness.controlledToken ?? null,
    resolveCombatantToken: (...args) => harness.resolveCombatantToken?.(...args) ?? null,
});

test("the Splittermond action bar routes active defense through the continuous-action guard", async () => {
    const calls = [];
    const actor = { id: "actor", uuid: "Actor.actor" };
    const token = { id: "token", uuid: "Scene.scene.Token.token", actor };
    let originalCalls = 0;
    const actionBar = {
        currentActor: actor,
        rollDefense() {
            originalCalls += 1;
        },
    };
    harness.beginStandaloneActiveDefense = async (...args) => calls.push(args);
    harness.controlledToken = token;
    harness.resolveCombatantToken = () => null;

    assert.equal(installSystemActionBarActiveDefenseInterceptor(actionBar), true);
    assert.equal(installSystemActionBarActiveDefenseInterceptor(actionBar), true, "installation is idempotent");
    actionBar.rollDefense({}, { dataset: { defenseType: "vtd" } });
    await Promise.resolve();

    assert.equal(originalCalls, 0);
    assert.deepEqual(calls, [[{ actor, token }, "vtd"]]);
});

test("the action bar retains its native defense when no unambiguous token can be resolved", () => {
    const actor = { id: "actor", uuid: "Actor.actor" };
    let originalCalls = 0;
    const actionBar = {
        currentActor: actor,
        rollDefense() {
            originalCalls += 1;
        },
    };
    harness.beginStandaloneActiveDefense = async () => undefined;
    harness.controlledToken = null;
    harness.resolveCombatantToken = () => null;
    globalThis.game = {
        combat: {
            combatants: [
                { token: { actor } },
                { token: { actor } },
            ],
        },
    };

    assert.equal(installSystemActionBarActiveDefenseInterceptor(actionBar), true);
    actionBar.rollDefense({}, { dataset: { defenseType: "kw" } });
    assert.equal(originalCalls, 1);
});
