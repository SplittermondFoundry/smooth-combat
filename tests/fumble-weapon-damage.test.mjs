import assert from "node:assert/strict";
import test from "node:test";

import {
    getWeaponDamageLevel,
    increaseFumbleWeaponDamage,
    setWeaponDamageLevel,
} from "../Modul/splittermond-smoother-fight/scripts/features/fumbles/weapon-damage.js";

test("fumble weapon damage persists through Splittermond's suffered-damage field", async () => {
    const weapon = testWeapon({ durability: 5, sufferedDamage: 0 });

    assert.deepEqual(await increaseFumbleWeaponDamage(weapon), { previousLevel: 0, nextLevel: 1 });
    assert.deepEqual(weapon.updates, [{ "system.sufferedDamage": 6 }]);
    assert.equal(getWeaponDamageLevel(weapon), 1);

    assert.deepEqual(await increaseFumbleWeaponDamage(weapon), { previousLevel: 1, nextLevel: 2 });
    assert.deepEqual(weapon.updates[1], { "system.sufferedDamage": 11 });
    assert.equal(getWeaponDamageLevel(weapon), 2);

    assert.deepEqual(await increaseFumbleWeaponDamage(weapon), { previousLevel: 2, nextLevel: 2 });
    assert.equal(weapon.updates.length, 2);
});

test("the same native field can explicitly mark a weapon as destroyed", async () => {
    const weapon = testWeapon({ weight: 2, hardness: 3, sufferedDamage: 0 });

    assert.equal(await setWeaponDamageLevel(weapon, 3), 3);
    assert.deepEqual(weapon.updates, [{ "system.sufferedDamage": 15 }]);
    assert.equal(getWeaponDamageLevel(weapon), 3);
});

test("a weapon without durability is not accidentally destroyed by a damage-stage request", async () => {
    const weapon = testWeapon({ durability: 0, weight: 0, hardness: 0, sufferedDamage: 0 });

    await assert.rejects(increaseFumbleWeaponDamage(weapon), /no usable durability/u);
    assert.equal(weapon.updates.length, 0);
});

function testWeapon(system) {
    return {
        id: "weapon-id",
        name: "Testwaffe",
        system: { ...system },
        updates: [],
        async update(change) {
            this.updates.push(change);
            if ("system.sufferedDamage" in change) this.system.sufferedDamage = change["system.sufferedDamage"];
        },
    };
}
