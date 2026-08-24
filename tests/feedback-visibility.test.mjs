import assert from "node:assert/strict";
import test from "node:test";

import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    feedbackMarkup,
    receivePublishedFeedback,
} from "../Modul/splittermond-smoother-fight/scripts/features/feedback/feedback.js";

test("published feedback for an imperceptible token is ignored", () => {
    const actor = {
        uuid: "Actor.assassin",
        testUserPermission: () => false,
    };
    const token = {
        uuid: "Scene.scene.Token.assassin",
        actor,
    };
    globalThis.game = { user: { id: "player", isGM: false } };
    services.resolveToken = () => token;
    services.isTokenPerceivableByUser = () => false;

    receivePublishedFeedback("damageBlocked", {
        tokenUuid: token.uuid,
        actorUuid: actor.uuid,
    });

    assert.equal(feedbackMarkup(token, actor), "");
});
