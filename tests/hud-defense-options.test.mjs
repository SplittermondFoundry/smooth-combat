import test from "node:test";
import assert from "node:assert/strict";

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
