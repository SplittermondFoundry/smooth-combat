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
        setTarget: (targeted) => targetingHarness.targetCalls.push([token.uuid, targeted]),
    };
    return token;
}

const targetingHarness = {
    targetCalls: [],
    socketPayloads: [],
};

test("quick targeting promotes, adds, and removes targets without collapsing the target set", async () => {
    const targetA = createToken("a");
    const targetB = createToken("b");
    const targetC = createToken("c");
    const tokens = new Map([targetA, targetB, targetC].map((token) => [token.uuid, token]));
    const user = { id: "player", isGM: false, targets: new Set([targetA.object, targetB.object]) };
    targetingHarness.targetCalls.length = 0;
    targetingHarness.socketPayloads.length = 0;
    services.scheduleRender = () => {};
    globalThis.fromUuidSync = (uuid) => tokens.get(uuid) ?? null;
    globalThis.game = {
        user,
        i18n: {
            format: (key, data) => `${key}:${data.target}`,
            localize: (key) => key,
        },
        socket: { emit: (_channel, payload) => targetingHarness.socketPayloads.push(payload) },
    };
    globalThis.ui = { notifications: { info: () => {} } };
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

    const context = { actor: { isOwner: true }, linkedUser: user, target: targetB, targets: [targetA, targetB] };
    await setTargetFromQuickMenu(context, targetA.uuid);
    assert.deepEqual(targetingHarness.targetCalls, []);
    assert.deepEqual(targetingHarness.socketPayloads.at(-1).targetTokenUuids, [targetA.uuid, targetB.uuid]);
    assert.equal(targetingHarness.socketPayloads.at(-1).primaryTargetTokenUuid, targetA.uuid);
    assert.equal(targetingHarness.socketPayloads.at(-1).primaryTargetActorUuid, targetA.actor.uuid);
    assert.equal(targetingHarness.socketPayloads.at(-1).targetTokenUuid, targetA.uuid);
    assert.deepEqual(targetingHarness.socketPayloads.at(-1).targetActorUuids, [targetA.actor.uuid, targetB.actor.uuid]);

    targetingHarness.socketPayloads.length = 0;
    await setTargetFromQuickMenu({ ...context, target: targetA }, targetC.uuid);
    assert.deepEqual(targetingHarness.targetCalls, [[targetC.uuid, true]]);
    assert.deepEqual(targetingHarness.socketPayloads.at(-1).targetTokenUuids, [targetA.uuid, targetB.uuid, targetC.uuid]);
    assert.equal(targetingHarness.socketPayloads.at(-1).primaryTargetTokenUuid, targetA.uuid);

    targetingHarness.targetCalls.length = 0;
    targetingHarness.socketPayloads.length = 0;
    await removeTargetFromQuickMenu({ ...context, target: targetA }, targetA.uuid);
    assert.deepEqual(targetingHarness.targetCalls, [[targetA.uuid, false]]);
    assert.deepEqual(targetingHarness.socketPayloads.at(-1).targetTokenUuids, [targetB.uuid]);
    assert.equal(targetingHarness.socketPayloads.at(-1).primaryTargetTokenUuid, targetB.uuid);
});
