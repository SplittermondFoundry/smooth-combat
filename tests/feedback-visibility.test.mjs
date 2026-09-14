import assert from "node:assert/strict";
import test from "node:test";

import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    feedbackMarkup,
    announceMessageFeedback,
    receivePublishedFeedback,
    synchronizeFeedbackAnimations,
} from "../Modul/splittermond-smoother-fight/scripts/features/feedback/feedback.js";
import { feedbackState } from "../Modul/splittermond-smoother-fight/scripts/features/feedback/state.js";

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

test("one message keeps one feedback timeline through repeated updates and expires once", t => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
    let sequence = 0, renders = 0, removed = false;
    const actor = { uuid: "Actor.defender" }, token = { uuid: "Scene.scene.Token.defender", actor };
    globalThis.game = { user: { id: "gm", isGM: true }, settings: { get: () => false } };
    globalThis.foundry = { utils: { randomID: () => `feedback-${++sequence}` } };
    Object.assign(services, {
        isDefenseMessage: () => true, resolveSpeakerActor: () => actor,
        getMessageContext: () => ({}), speakerTokenUuid: () => token.uuid,
        resolveToken: () => token, scheduleRender: () => { renders++; },
    });
    feedbackState.heardMessageIds.clear();
    t.after(() => { feedbackState.feedback = null; feedbackState.heardMessageIds.clear(); });
    const message = { id: "defense-roll" };
    announceMessageFeedback(message);
    const id = feedbackState.feedback.id;
    const animation = { animationName: "sf-action-feedback", currentTime: 0 };
    const otherAnimation = { animationName: "other", currentTime: 5 };
    const element = { dataset: { sfFeedbackId: id }, getAnimations: () => [animation, otherAnimation], remove: () => { removed = true; } };
    const root = { querySelectorAll: () => [element] };
    for (const elapsed of [200, 400, 600]) {
        t.mock.timers.tick(200);
        announceMessageFeedback(message);
        synchronizeFeedbackAnimations(root);
        assert.equal(animation.currentTime, elapsed);
        assert.equal(otherAnimation.currentTime, 5);
        assert.equal(feedbackState.feedback.id, id);
        assert.equal(renders, 1);
    }
    assert.match(feedbackMarkup(token, actor), /data-sf-feedback-id/);
    assert.equal(feedbackMarkup({ uuid: "Scene.scene.Token.clone", actor }, actor), "");
    t.mock.timers.tick(800);
    assert.equal(feedbackMarkup(token, actor), "");
    synchronizeFeedbackAnimations(root);
    assert.equal(removed, true);
    assert.equal(renders, 2);
    announceMessageFeedback(message);
    assert.equal(feedbackState.feedback, null);
    announceMessageFeedback({ id: "next-defense-roll" });
    assert.notEqual(feedbackState.feedback.id, id);
});
