import assert from "node:assert/strict";
import test from "node:test";

import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    getTargetSelectionForUser,
    rememberTargetReferences,
    removeTargetFromQuickMenu,
    setTargetFromQuickMenu,
} from "../Modul/splittermond-smoother-fight/scripts/features/targeting/targeting.js";

function createToken(id) {
    const actor = { uuid: `Actor.${id}` };
    const token = {
        id,
        uuid: `Scene.scene.Token.${id}`,
        documentName: "Token",
        name: `Ziel ${id.toUpperCase()}`,
        actor,
    };
    token.object = {
        document: token,
        setTarget: (targeted, options) => targetingHarness.targetCalls.push([token.uuid, targeted, options?.releaseOthers ?? false]),
    };
    return token;
}

const targetingHarness = {
    targetCalls: [],
    socketPayloads: [],
};

test("quick targeting selects a primary target normally and adds secondary targets with Shift", async () => {
    const targetA = createToken("a");
    const targetB = createToken("b");
    const targetC = createToken("c");
    const tokens = new Map([targetA, targetB, targetC].map((token) => [token.uuid, token]));
    const user = { id: "player", isGM: false, active: true, targets: new Set([targetA.object, targetB.object]) };
    targetingHarness.targetCalls.length = 0;
    targetingHarness.socketPayloads.length = 0;
    services.scheduleRender = () => {};
    services.getRuntimeController = () => user;
    globalThis.fromUuidSync = (uuid) => tokens.get(uuid) ?? null;
    globalThis.game = {
        user,
        i18n: {
            format: (key, data) => `${key}:${data.target}`,
            localize: (key) => key,
        },
        socket: { emit: (_channel, payload) => targetingHarness.socketPayloads.push(payload) },
    };
    globalThis.ui = { notifications: { info: () => {}, warn: () => {} } };
    globalThis.canvas = { scene: { tokens: new Map() }, tokens: { get: () => null } };

    const firstSelection = rememberTargetReferences("first-target-user", [targetA.uuid]);
    const extendedSelection = rememberTargetReferences("first-target-user", [targetA.uuid, targetB.uuid]);
    assert.equal(firstSelection.primaryTargetTokenUuid, targetA.uuid);
    assert.equal(extendedSelection.primaryTargetTokenUuid, targetA.uuid);

    rememberTargetReferences(user.id, [targetA.uuid, targetB.uuid], targetB.uuid);
    const initial = getTargetSelectionForUser(user);
    assert.deepEqual(initial.targetTokenUuids, [targetA.uuid, targetB.uuid]);
    assert.equal(initial.primaryTargetTokenUuid, targetB.uuid);
    assert.equal(initial.targetTokenUuid, targetB.uuid);
    assert.equal(initial.primaryTargetActorUuid, targetB.actor.uuid);

    const context = { actor: { isOwner: true }, runtimeController: user, target: targetB, targets: [targetA, targetB] };
    await setTargetFromQuickMenu(context, targetA.uuid);
    assert.deepEqual(targetingHarness.targetCalls, [[targetA.uuid, true, true]]);
    assert.deepEqual(targetingHarness.socketPayloads.at(-1).targetTokenUuids, [targetA.uuid]);
    assert.equal(targetingHarness.socketPayloads.at(-1).primaryTargetTokenUuid, targetA.uuid);
    assert.equal(targetingHarness.socketPayloads.at(-1).primaryTargetActorUuid, targetA.actor.uuid);
    assert.equal(targetingHarness.socketPayloads.at(-1).targetTokenUuid, targetA.uuid);
    assert.deepEqual(targetingHarness.socketPayloads.at(-1).targetActorUuids, [targetA.actor.uuid]);

    targetingHarness.socketPayloads.length = 0;
    await setTargetFromQuickMenu({ ...context, target: targetA, targets: [targetA] }, targetC.uuid, { additive: true });
    assert.deepEqual(targetingHarness.targetCalls.at(-1), [targetC.uuid, true, false]);
    assert.deepEqual(targetingHarness.socketPayloads.at(-1).targetTokenUuids, [targetA.uuid, targetC.uuid]);
    assert.equal(targetingHarness.socketPayloads.at(-1).primaryTargetTokenUuid, targetA.uuid);

    targetingHarness.targetCalls.length = 0;
    targetingHarness.socketPayloads.length = 0;
    await setTargetFromQuickMenu(
        { ...context, target: targetA, targets: [targetA, targetC] },
        targetC.uuid,
        { replaceSelection: false }
    );
    assert.deepEqual(targetingHarness.targetCalls, [[targetC.uuid, true, false]]);
    assert.deepEqual(targetingHarness.socketPayloads.at(-1).targetTokenUuids, [targetA.uuid, targetC.uuid]);
    assert.equal(targetingHarness.socketPayloads.at(-1).primaryTargetTokenUuid, targetC.uuid);

    targetingHarness.targetCalls.length = 0;
    targetingHarness.socketPayloads.length = 0;
    await removeTargetFromQuickMenu({ ...context, target: targetC, targets: [targetA, targetC] }, targetA.uuid);
    assert.deepEqual(targetingHarness.targetCalls, [[targetA.uuid, false, false]]);
    assert.deepEqual(targetingHarness.socketPayloads.at(-1).targetTokenUuids, [targetC.uuid]);
    assert.equal(targetingHarness.socketPayloads.at(-1).primaryTargetTokenUuid, targetC.uuid);
});

test("an active GM substitutes locally without sending target operations to an offline player", async () => {
    const target = createToken("fallback");
    const offlinePlayer = { id: "offline-player", isGM: false, active: false, targets: new Set() };
    const gm = { id: "primary-gm", isGM: true, active: true, targets: new Set() };
    targetingHarness.targetCalls.length = 0;
    targetingHarness.socketPayloads.length = 0;
    services.getRuntimeController = () => gm;
    services.scheduleRender = () => {};
    globalThis.fromUuidSync = (uuid) => uuid === target.uuid ? target : null;
    globalThis.game = {
        user: gm,
        i18n: {
            format: (key, data) => `${key}:${data.target}`,
            localize: (key) => key,
        },
        socket: { emit: (_channel, payload) => targetingHarness.socketPayloads.push(payload) },
    };
    globalThis.ui = { notifications: { info: () => {}, warn: () => assert.fail("GM fallback is available") } };
    globalThis.canvas = { scene: { tokens: new Map() }, tokens: { get: () => null } };

    await setTargetFromQuickMenu({
        actor: { isOwner: true },
        assignedUser: offlinePlayer,
        runtimeController: gm,
        target: null,
        targets: [],
    }, target.uuid);

    assert.deepEqual(targetingHarness.targetCalls, [[target.uuid, true, true]]);
    assert.ok(targetingHarness.socketPayloads.every((payload) => payload.recipientId !== offlinePlayer.id));
    assert.equal(targetingHarness.socketPayloads.at(-1).userId, gm.id);
});

test("missing runtime control reports a clean unavailable state", async () => {
    const target = createToken("unavailable");
    let warnings = 0;
    services.getRuntimeController = () => null;
    globalThis.game = {
        user: { id: "observer", isGM: false, active: true, targets: new Set() },
        i18n: { localize: (key) => key },
        socket: { emit: () => assert.fail("no target operation should be emitted") },
    };
    globalThis.ui = { notifications: { warn: () => warnings += 1 } };

    await setTargetFromQuickMenu({ actor: {}, runtimeController: null, target: null, targets: [] }, target.uuid);
    assert.equal(warnings, 1);
});
