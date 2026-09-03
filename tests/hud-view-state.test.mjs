import assert from "node:assert/strict";
import test from "node:test";

import {
    shouldRestoreCombatSubevents,
} from "../Modul/splittermond-smoother-fight/scripts/features/hud/view-state.js";

test("a completed automatic combat focus cannot reopen its old attack card", () => {
    assert.equal(shouldRestoreCombatSubevents("attack", "attack", null), false);
    assert.equal(shouldRestoreCombatSubevents("attack", "attack", "next-attack"), false);
});

test("an unchanged focus and manually opened history retain their subevent state", () => {
    assert.equal(shouldRestoreCombatSubevents("attack", "attack", "attack"), true);
    assert.equal(shouldRestoreCombatSubevents("history", null, null), true);
    assert.equal(shouldRestoreCombatSubevents("history", "attack", null), true);
});
