import assert from "node:assert/strict";
import test from "node:test";

import {
    resolveCombatantByReferences,
} from "../Modul/splittermond-smoother-fight/scripts/domain/combatant-resolution.js";

function sharedActorCombatants() {
    const actor = { id: "wolf", uuid: "Actor.wolf" };
    return [
        {
            id: "wolf-a",
            actor,
            actorId: actor.id,
            tokenId: "token-a",
            token: { id: "token-a", uuid: "Scene.scene.Token.token-a" },
        },
        {
            id: "wolf-b",
            actor,
            actorId: actor.id,
            tokenId: "token-b",
            token: { id: "token-b", uuid: "Scene.scene.Token.token-b" },
        },
    ];
}

test("combatant resolution prefers an exact persisted combatant id", () => {
    const combatants = sharedActorCombatants();
    assert.equal(resolveCombatantByReferences(combatants, {
        combatantId: combatants[1].id,
        actorReferences: [combatants[1].actorId],
    }), combatants[1]);
});

test("combatant resolution prefers an exact token over a shared actor", () => {
    const combatants = sharedActorCombatants();
    assert.equal(resolveCombatantByReferences(combatants, {
        tokenReferences: [combatants[1].token.uuid],
        actorReferences: [combatants[1].actorId],
    }), combatants[1]);
});

test("combatant resolution accepts a unique actor fallback", () => {
    const [combatant] = sharedActorCombatants();
    assert.equal(resolveCombatantByReferences([combatant], {
        actorReferences: [combatant.actor.uuid],
    }), combatant);
});

test("combatant resolution rejects an ambiguous actor fallback", () => {
    const combatants = sharedActorCombatants();
    assert.equal(resolveCombatantByReferences(combatants, {
        actorReferences: [combatants[0].actorId],
    }), null);
});

test("an explicit unmatched token does not fall through to its actor", () => {
    const [combatant] = sharedActorCombatants();
    assert.equal(resolveCombatantByReferences([combatant], {
        tokenReferences: ["Scene.scene.Token.not-in-combat"],
        actorReferences: [combatant.actorId],
    }), null);
});
