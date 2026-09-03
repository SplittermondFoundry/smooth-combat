import test from "node:test";
import assert from "node:assert/strict";

import {
    getApplicableCombat,
    installCombatantSortCompatibility,
} from "../Modul/splittermond-smoother-fight/scripts/core/combat-compatibility.js";

function actor({ intuition, initiative }) {
    return {
        system: {
            attributes: { intuition: { value: intuition } },
            derivedValues: { initiative: { value: initiative } },
        },
    };
}

function setup() {
    let originalCalls = 0;
    class CombatDocument {
        _sortCombatants(left, right) {
            originalCalls += 1;
            let leftValue = Number.parseFloat(left.initiative);
            let rightValue = Number.parseFloat(right.initiative);
            if (leftValue === rightValue) {
                leftValue = -left.actor.system.attributes.intuition.value;
                rightValue = -right.actor.system.attributes.intuition.value;
            }
            if (leftValue === rightValue) {
                leftValue = -left.actor.system.derivedValues.initiative.value;
                rightValue = -right.actor.system.derivedValues.initiative.value;
            }
            return leftValue - rightValue;
        }
    }

    const actors = new Map();
    globalThis.CONFIG = { Combat: { documentClass: CombatDocument } };
    globalThis.game = {
        system: { id: "splittermond" },
        actors: { get: (id) => actors.get(id) },
    };
    return { CombatDocument, actors, originalCalls: () => originalCalls };
}

test("combat compatibility keeps the original sorter for prepared actors", () => {
    const { CombatDocument, originalCalls } = setup();
    const left = { initiative: 7, actor: actor({ intuition: 5, initiative: 8 }) };
    const right = { initiative: 7, actor: actor({ intuition: 3, initiative: 10 }) };

    assert.equal(installCombatantSortCompatibility(), true);
    assert.equal(new CombatDocument()._sortCombatants(left, right), -2);
    assert.equal(originalCalls(), 1);
});

test("combat compatibility safely sorts a same-tick combatant with a transient null actor", () => {
    const { CombatDocument, actors, originalCalls } = setup();
    actors.set("left", actor({ intuition: 5, initiative: 8 }));
    actors.set("right", actor({ intuition: 3, initiative: 10 }));
    const left = { initiative: 7, actor: null, actorId: "left" };
    const right = { initiative: 7, actor: null, actorId: "right" };

    assert.equal(installCombatantSortCompatibility(), true);
    assert.equal(new CombatDocument()._sortCombatants(left, right), -2);
    assert.equal(originalCalls(), 0);
});

test("combat compatibility falls back to tick order and remains idempotent", () => {
    const { CombatDocument } = setup();
    const left = { initiative: 4, actor: null };
    const right = { initiative: 7, actor: null };

    assert.equal(installCombatantSortCompatibility(), true);
    const installed = CombatDocument.prototype._sortCombatants;
    assert.equal(installCombatantSortCompatibility(), true);
    assert.equal(CombatDocument.prototype._sortCombatants, installed);
    assert.equal(new CombatDocument()._sortCombatants(left, right), -3);
    assert.equal(new CombatDocument()._sortCombatants({ ...left, initiative: 7 }, right), 0);
});

test("combat compatibility sorts defeated combatants behind living combatants during reload", () => {
    const { CombatDocument } = setup();
    const defeated = { initiative: 13, actor: null, isDefeated: true };
    const living = { initiative: 15, actor: null, isDefeated: false };

    assert.equal(installCombatantSortCompatibility(), true);
    assert.ok(new CombatDocument()._sortCombatants(defeated, living) > 0);
    assert.deepEqual([defeated, living].sort((left, right) => (
        new CombatDocument()._sortCombatants(left, right)
    )), [living, defeated]);
});

test("the applicable combat matches Splittermond's active combat on the current scene", () => {
    const scene = { id: "battle-scene" };
    const staleViewedCombat = { id: "stale", isActive: false, scene };
    const activeCombat = { id: "active", isActive: true, scene: scene.id };
    const foreignActiveCombat = { id: "foreign", isActive: true, scene: "other-scene" };
    globalThis.canvas = { scene };
    globalThis.game = {
        combat: staleViewedCombat,
        combats: new Map([
            [staleViewedCombat.id, staleViewedCombat],
            [foreignActiveCombat.id, foreignActiveCombat],
            [activeCombat.id, activeCombat],
        ]),
    };

    assert.equal(getApplicableCombat(), activeCombat);
});

test("the applicable combat retains the viewed fallback without a combat collection", () => {
    const viewedCombat = { id: "viewed" };
    globalThis.game = { combat: viewedCombat };
    delete globalThis.canvas;

    assert.equal(getApplicableCombat(), viewedCombat);
});
