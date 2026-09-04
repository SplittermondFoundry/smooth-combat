import assert from "node:assert/strict";
import test from "node:test";

import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    getMessageTargetName,
    messageBelongsToCombatant,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-events/view.js";

test("combat events suppress stored target identities which the current player cannot perceive", () => {
    const player = { id: "player", isGM: false };
    const token = { uuid: "Scene.scene.Token.assassin", name: "Assassine" };
    const actor = { name: "Assassine", testUserPermission: () => false };
    const context = {
        primaryTargetTokenUuid: token.uuid,
        primaryTargetName: "Assassine",
    };

    globalThis.game = { user: player };
    services.resolveMessageTarget = () => ({ token, actor });
    services.isTokenPerceivableByUser = () => false;

    assert.equal(getMessageTargetName(context), "");

    services.isTokenPerceivableByUser = () => true;
    assert.equal(getMessageTargetName(context), "Assassine");

    globalThis.game.user = { id: "gm", isGM: true };
    services.isTokenPerceivableByUser = () => false;
    assert.equal(getMessageTargetName(context), "Assassine");
});

test("an actor-only message belongs to no combatant when the actor occurs more than once", () => {
    const first = { id: "wolf-a", actorId: "wolf", tokenId: "token-a" };
    const second = { id: "wolf-b", actorId: "wolf", tokenId: "token-b" };
    globalThis.game = { combat: { combatants: [first, second] } };
    const message = { speaker: { actor: "wolf" } };

    assert.equal(messageBelongsToCombatant(message, first, null), false);
    assert.equal(messageBelongsToCombatant(message, second, null), false);

    message.speaker.token = second.tokenId;
    assert.equal(messageBelongsToCombatant(message, first, null), false);
    assert.equal(messageBelongsToCombatant(message, second, null), true);
});
