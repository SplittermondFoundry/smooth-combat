import assert from "node:assert/strict";
import test from "node:test";

import { registerSocket } from "../Modul/splittermond-smoother-fight/scripts/core/lifecycle.js";
import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import { MODULE_ID, SOCKET, SYSTEM_SOCKET } from "../Modul/splittermond-smoother-fight/scripts/core/constants.js";
import {
    beginOffenseFollowUp,
    finishOffenseFollowUpRequest,
    requestOffenseFollowUp,
} from "../Modul/splittermond-smoother-fight/scripts/features/active-defense/phase-actions.js";
import { defenseAwaitsResponse } from "../Modul/splittermond-smoother-fight/scripts/features/active-defense/phase.js";
import { activeDefenseState } from "../Modul/splittermond-smoother-fight/scripts/features/active-defense/state.js";
import { handleRenderedOffenseFollowUp } from "../Modul/splittermond-smoother-fight/scripts/features/chat/action-dispatch.js";
import { setRequiredFlag } from "../Modul/splittermond-smoother-fight/scripts/features/chat/messages.js";

let fixture;
configureServices({
    beginOffenseFollowUp,
    defenseAwaitsResponse,
    finishOffenseFollowUpRequest,
    requestOffenseFollowUp,
    setRequiredFlag,
    getActivePrimaryGm: () => fixture.gm,
    getMessageContext: (message) => message?.flags?.[MODULE_ID]?.context ?? null,
    resolveSpeakerActor: (message) => message?.actor ?? null,
    resolveToken: () => null,
    speakerTokenUuid: () => null,
    isDamageMessage: (message) => message?.type === "damageMessage",
    isDefenseMessage: () => false,
    waitForChatMessage: async (id) => game.messages.get(id),
    scheduleRender: () => {},
    getPendingDamageRollTimer: (id) => fixture.damageTimers.get(id),
    setPendingDamageRollTimer: (id, timer) => fixture.damageTimers.set(id, timer),
    deletePendingDamageRollTimer: (id) => fixture.damageTimers.delete(id),
});

class UserCollection extends Map {
    [Symbol.iterator]() { return this.values(); }
}

function installFixture(t, phase = "declined") {
    const player = { id: "player", isGM: false, active: true };
    const gm = { id: "gm", isGM: true, active: true };
    const actor = { id: "hero", testUserPermission: (user) => user.id === player.id || user.isGM };
    const message = {
        id: "attack",
        type: "attackRollMessage",
        author: player,
        actor,
        speaker: { actor: actor.id },
        // Match the action names and data used by Splittermond 14.2.7.
        content: '<button data-action="applyDamage"></button><input data-action="damageUpdate" data-multiplicity="1" type="checkbox"><button data-action="advanceToken"></button>',
        flags: { [MODULE_ID]: { context: { defensePhase: phase } } },
        system: { checkReport: { succeeded: true } },
        writes: [],
        async setFlag(scope, key, value) {
            assert.equal(game.user.id, gm.id, "only the GM closes the defense phase");
            this.writes.push({ scope, key, value });
            this.flags[scope][key] = structuredClone(value);
            return this;
        },
        getFlag(scope, key) { return this.flags[scope]?.[key]; },
    };
    fixture = { player, gm, actor, message, queue: [], emitted: [], warnings: [], errors: [], damageTimers: new Map() };
    globalThis.game = {
        user: player,
        users: new UserCollection([[player.id, player], [gm.id, gm]]),
        messages: new Map([[message.id, message]]),
        i18n: { localize: (key) => key, format: (key) => key },
        socket: {
            on: (channel, handler) => {
                assert.equal(channel, SOCKET);
                fixture.handler = handler;
            },
            emit: (channel, payload) => {
                const event = { channel, payload: structuredClone(payload), senderId: game.user.id };
                fixture.emitted.push(event);
                if (channel === SOCKET) fixture.queue.push(event);
            },
        },
    };
    globalThis.foundry = { utils: { randomID: () => "request-id" } };
    globalThis.ui = { notifications: {
        warn: (message) => fixture.warnings.push(message),
        error: (message) => fixture.errors.push(message),
    } };
    registerSocket();
    t.after(() => {
        for (const timer of fixture.damageTimers.values()) clearTimeout(timer);
        for (const request of activeDefenseState.offenseFollowUpRequests.values()) clearTimeout(request.timeoutId);
        activeDefenseState.offenseFollowUpRequests.clear();
        activeDefenseState.attackProcessingQueues.clear();
        delete globalThis.game;
        delete globalThis.foundry;
        delete globalThis.ui;
    });
    return fixture;
}

async function deliverNext(recipient) {
    const event = fixture.queue.shift();
    assert.ok(event, "the sending client emitted a module request or response");
    assert.equal(event.payload.recipientId, recipient.id);
    game.user = recipient;
    // Foundry supplies the authenticated identity independently of the payload.
    await fixture.handler(event.payload, event.senderId);
}

function clickControl(action) {
    return handleRenderedOffenseFollowUp({ preventDefault() {} }, {
        dataset: { action, ...(action === "damageUpdate" ? { multiplicity: "1" } : {}) },
        disabled: false,
        closest: () => null,
        matches: (selector) => action === "damageUpdate" && selector.startsWith('input[type="checkbox"]'),
    }, fixture.message);
}

for (const phase of ["declined", "resolved", "unavailable"]) {
    for (const action of ["damageUpdate", "applyDamage", "advanceToken"]) {
        test(`a player's ${action} action completes the real GM round trip after ${phase} defense`, async (t) => {
            const f = installFixture(t, phase);
            const pending = clickControl(action);
            assert.equal(f.emitted.length, 1);
            assert.equal(f.emitted[0].payload.type, "begin-offense-follow-up");
            assert.equal(f.emitted.some((event) => event.channel === SYSTEM_SOCKET), false);

            await deliverNext(f.gm);
            assert.equal(f.message.flags[MODULE_ID].context.defensePhase, phase === "unavailable" ? phase : "closed");
            if (phase !== "unavailable") assert.equal(f.message.flags[MODULE_ID].context.defenseClosedBy, f.player.id);
            await deliverNext(f.player);
            await pending;

            const systemActions = f.emitted.filter((event) => event.channel === SYSTEM_SOCKET);
            assert.deepEqual(systemActions.map((event) => event.payload), [{
                type: "chatAction", action, messageId: f.message.id, userId: f.player.id,
                ...(action === "damageUpdate" ? { multiplicity: "1" } : {}),
            }]);
            assert.equal(f.message.writes.length, phase === "unavailable" ? 0 : 1);
            assert.equal(activeDefenseState.offenseFollowUpRequests.size, 0);
            assert.deepEqual(f.errors, []);
        });
    }
}

test("the real GM round trip blocks damage while a defense response is pending", async (t) => {
    const f = installFixture(t, "open");
    const pending = clickControl("applyDamage");
    await deliverNext(f.gm);
    await deliverNext(f.player);
    await pending;

    assert.equal(f.message.writes.length, 0);
    assert.equal(f.emitted.some((event) => event.channel === SYSTEM_SOCKET), false);
    assert.deepEqual(f.warnings, ["SMOOTHER_FIGHT.HUD.DefenseAwaitingResponse"]);
    assert.deepEqual(f.errors, []);
    assert.equal(activeDefenseState.offenseFollowUpRequests.size, 0);
});

test("a missing GM receiver reports the unanswered request and never forwards the action", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = installFixture(t);
    const logged = t.mock.method(console, "error", () => {});
    const pending = clickControl("advanceToken");
    t.mock.timers.tick(10_000);
    await pending;

    assert.equal(f.message.writes.length, 0);
    assert.equal(f.emitted.some((event) => event.channel === SYSTEM_SOCKET), false);
    assert.equal(activeDefenseState.offenseFollowUpRequests.size, 0);
    assert.deepEqual(f.errors, ["SMOOTHER_FIGHT.HUD.ActionFailed"]);
    assert.equal(logged.mock.callCount(), 1);
    assert.match(logged.mock.calls[0].arguments[0], /Timed out waiting for the GM/u);
    assert.deepEqual(logged.mock.calls[0].arguments[1], {
        requestId: "request-id",
        messageId: f.message.id,
        senderId: f.player.id,
        recipientId: f.gm.id,
    });
});
