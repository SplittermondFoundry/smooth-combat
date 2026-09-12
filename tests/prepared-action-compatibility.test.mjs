import assert from "node:assert/strict";
import test from "node:test";

import {
    preparedActionId,
    setPreparedActionId,
} from "../Modul/splittermond-smoother-fight/scripts/shared/prepared-action-compatibility.js";

test("Splittermond 14.2.7 prepared-action flags remain readable and writable", async () => {
    const flags = { preparedAttack: "bow", preparedSpell: "fireball" };
    const actor = {
        flags: { splittermond: flags },
        getFlag: (scope, key) => scope === "splittermond" ? flags[key] : null,
        setFlag: async (scope, key, value) => {
            assert.equal(scope, "splittermond");
            flags[key] = value;
        },
    };

    assert.equal(preparedActionId(actor, "attack"), "bow");
    assert.equal(preparedActionId(actor, "spell"), "fireball");

    await setPreparedActionId(actor, "attack", null);
    await setPreparedActionId(actor, "spell", "healing");

    assert.equal(flags.preparedAttack, null);
    assert.equal(flags.preparedSpell, "healing");
});

test("Splittermond 14.3.0-beta4 prepared-action data is used without touching legacy flags", async () => {
    const updates = [];
    const actor = {
        system: { preparedAction: { attack: "crossbow", spell: null } },
        flags: { splittermond: { preparedAttack: "stale-bow", preparedSpell: "stale-spell" } },
        getFlag: () => assert.fail("beta4 must not read legacy prepared-action flags"),
        setFlag: () => assert.fail("beta4 must not write legacy prepared-action flags"),
        async update(change) {
            updates.push(change);
            for (const [path, value] of Object.entries(change)) {
                const kind = path.split(".").at(-1);
                this.system.preparedAction[kind] = value;
            }
        },
    };

    assert.equal(preparedActionId(actor, "attack"), "crossbow");
    assert.equal(preparedActionId(actor, "spell"), null, "a modern null must override stale legacy data");

    await setPreparedActionId(actor, "attack", null);
    await setPreparedActionId(actor, "spell", "light");

    assert.deepEqual(updates, [
        { "system.preparedAction.attack": null },
        { "system.preparedAction.spell": "light" },
    ]);
    assert.deepEqual(actor.system.preparedAction, { attack: null, spell: "light" });
    assert.deepEqual(actor.flags.splittermond, {
        preparedAttack: "stale-bow",
        preparedSpell: "stale-spell",
    });
});

test("beta4 prepared-action controllers select data-model storage even before the schema object is visible", async () => {
    const actor = {
        system: {},
        preparedAttacks: { preparedId: "bow" },
        update: async (change) => {
            assert.deepEqual(change, { "system.preparedAction.attack": null });
        },
        setFlag: () => assert.fail("a beta4 controller must prevent legacy flag writes"),
    };

    assert.equal(preparedActionId(actor, "attack"), "bow");
    await setPreparedActionId(actor, "attack", null);
});
