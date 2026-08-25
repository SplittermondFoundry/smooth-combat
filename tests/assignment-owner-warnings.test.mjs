import test from "node:test";
import assert from "node:assert/strict";

import {
    collectOwnerPermissionWarnings,
    collectSelectedOwnerPermissionWarnings,
} from "../Modul/splittermond-smoother-fight/scripts/features/assignments/warnings.js";

function actor(id, ownerIds = []) {
    return {
        id,
        uuid: `Actor.${id}`,
        name: id,
        testUserPermission: (user, level) => level === "OWNER" && ownerIds.includes(user.id),
    };
}

const translate = (key, data = {}) => key === "SMOOTHER_FIGHT.Settings.MissingOwnerWarningDetail"
    ? `${data.user} lacks OWNER`
    : key;

test("sheet and direct token assignments warn when their player lacks OWNER permission", () => {
    const player = { id: "patrick", name: "Patrick", isGM: false };
    const cederion = actor("cederion");
    const warnings = collectOwnerPermissionWarnings({
        sheetAssignments: [{
            actor: cederion,
            user: player,
            title: "Cederion",
            context: "Character sheet",
            reference: cederion.uuid,
            actorUuid: cederion.uuid,
            canOpenActor: true,
        }],
        tokenAssignments: [{
            actor: cederion,
            user: player,
            title: "Cederion token",
            context: "Arena · Cederion",
            reference: "Scene.arena.Token.cederion",
            actorUuid: cederion.uuid,
            canOpenActor: true,
        }],
        translate,
    });

    assert.deepEqual(warnings.map(({ assignmentKind, title, reason }) => ({ assignmentKind, title, reason })), [
        { assignmentKind: "sheet", title: "Cederion", reason: "Patrick lacks OWNER" },
        { assignmentKind: "token", title: "Cederion token", reason: "Patrick lacks OWNER" },
    ]);
    assert.ok(warnings.every((warning) => warning.isOwnerPermission && warning.canOpenActor));
});

test("OWNER players and GMs do not produce assignment permission warnings", () => {
    const owner = { id: "owner", name: "Owner", isGM: false };
    const gm = { id: "gm", name: "GM", isGM: true };
    const cederion = actor("cederion", [owner.id]);
    const assignments = [
        { actor: cederion, user: owner, title: "Owned", actorUuid: cederion.uuid },
        { actor: cederion, user: gm, title: "GM", actorUuid: cederion.uuid },
    ];

    assert.deepEqual(collectOwnerPermissionWarnings({ sheetAssignments: assignments, translate }), []);
});

test("live selection validation follows the current sheet and token selects", () => {
    const player = { id: "patrick", name: "Patrick", isGM: false };
    const cederion = actor("cederion");
    const actorUuid = cederion.uuid;
    const tokenUuid = "Scene.arena.Token.cederion";
    const warnings = collectSelectedOwnerPermissionWarnings({
        actorSelects: [{ value: player.id, dataset: { actorUuid } }],
        tokenSelects: [{ value: player.id, dataset: { actorUuid, tokenUuid } }],
        actorByUuid: new Map([[actorUuid, cederion]]),
        tokenByUuid: new Map([[tokenUuid, { actor: cederion, name: "Token" }]]),
        actorContextByUuid: new Map([[actorUuid, { name: "Cederion", typeLabel: "Character sheet" }]]),
        tokenContextByUuid: new Map([[tokenUuid, {
            displayName: "Cederion token",
            sceneName: "Arena",
            actorName: "Cederion",
        }]]),
        userById: new Map([[player.id, player]]),
        translate,
    });

    assert.deepEqual(warnings.map((warning) => warning.assignmentKind), ["sheet", "token"]);
});
