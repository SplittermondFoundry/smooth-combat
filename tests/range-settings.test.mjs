import assert from "node:assert/strict";
import test from "node:test";

import {
    configuredMeleeRange,
} from "../Modul/splittermond-smoother-fight/scripts/shared/range-settings.js";

test("the configured melee range keeps two metres as its safe fallback", () => {
    let storedValue = 4.5;
    globalThis.game = { settings: { get: () => storedValue } };

    assert.equal(configuredMeleeRange(), 4.5);
    storedValue = 0;
    assert.equal(configuredMeleeRange(), 2);
    storedValue = "unbekannt";
    assert.equal(configuredMeleeRange(), 2);
});
