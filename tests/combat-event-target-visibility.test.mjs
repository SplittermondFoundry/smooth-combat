import assert from "node:assert/strict";
import test from "node:test";

import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import { getMessageTargetName } from "../Modul/splittermond-smoother-fight/scripts/features/combat-events/view.js";

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
