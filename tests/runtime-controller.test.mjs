import assert from "node:assert/strict";
import test from "node:test";

import {
    getActivePrimaryGm,
    getAssignedUser,
    getCurrentTurnController,
    getRuntimeController,
    isCurrentUserTarget,
} from "../Modul/splittermond-smoother-fight/scripts/features/assignments/assignments.js";
import { isPlayersTurn } from "../Modul/splittermond-smoother-fight/scripts/domain/permissions.js";

function fixture() {
    const player = { id: "player-a", name: "Patrick", isGM: false, active: true };
    const primaryGm = { id: "gm-z", name: "Primary GM", isGM: true, active: true };
    const fallbackGmA = { id: "gm-a", name: "Fallback A", isGM: true, active: true };
    const fallbackGmB = { id: "gm-b", name: "Fallback B", isGM: true, active: true };
    const actor = {
        id: "actor-a",
        uuid: "Actor.actor-a",
        testUserPermission: (user, level) => level === "OWNER" && user.id === player.id,
    };
    const token = {
        id: "token-a",
        uuid: "Scene.scene.Token.token-a",
        documentName: "Token",
        actorId: actor.id,
        actor,
    };
    const combatant = { id: "combatant-a", actorId: actor.id, actor, token };
    const settings = {
        primaryGmId: primaryGm.id,
        userTokenLinks: { [player.id]: [{ tokenUuid: token.uuid }] },
        actorUserLinks: {},
    };
    const usersById = new Map([player, primaryGm, fallbackGmA, fallbackGmB].map((user) => [user.id, user]));
    const users = {
        get: (id) => usersById.get(id),
        [Symbol.iterator]: () => usersById.values(),
    };
    let settingWrites = 0;
    globalThis.game = {
        user: player,
        users,
        settings: {
            get: (_moduleId, key) => settings[key],
            set: () => {
                settingWrites += 1;
                throw new Error("runtime resolution must not persist settings");
            },
        },
    };
    return {
        actor,
        combat: { combatant, turns: [combatant] },
        combatant,
        fallbackGmA,
        fallbackGmB,
        player,
        primaryGm,
        settings,
        token,
        settingWrites: () => settingWrites,
    };
}

test("assigned users stay persistent while runtime control follows presence", () => {
    const state = fixture();

    assert.equal(getAssignedUser(state.combatant), state.player);
    assert.equal(getRuntimeController(state.combatant), state.player);
    assert.equal(getCurrentTurnController(state.combat), state.player);
    assert.equal(isPlayersTurn({ userId: state.player.id, controllerUserId: state.player.id }), true);
    assert.equal(isPlayersTurn({ isGm: true, userId: state.primaryGm.id, controllerUserId: state.player.id }), false);

    state.player.active = false;
    assert.equal(getAssignedUser(state.combatant), state.player);
    assert.equal(getRuntimeController(state.combatant), state.primaryGm);
    assert.equal(getCurrentTurnController(state.combat), state.primaryGm);
    assert.equal(isPlayersTurn({ isGm: true, userId: state.primaryGm.id, controllerUserId: state.primaryGm.id }), true);
    assert.equal(isCurrentUserTarget(state.token), false);

    game.user = state.primaryGm;
    assert.equal(isCurrentUserTarget(state.token), true);

    state.player.active = true;
    assert.equal(getAssignedUser(state.combatant), state.player);
    assert.equal(getRuntimeController(state.combatant), state.player);
    assert.equal(state.settingWrites(), 0);
});

test("primary GM preference and deterministic fallback only use active GMs", () => {
    const state = fixture();
    state.player.active = false;

    assert.equal(getActivePrimaryGm(), state.primaryGm);
    assert.equal(getRuntimeController(state.combatant), state.primaryGm);

    state.primaryGm.active = false;
    assert.equal(getActivePrimaryGm(), state.fallbackGmA);
    assert.equal(getRuntimeController(state.combatant), state.fallbackGmA);

    state.fallbackGmA.active = false;
    assert.equal(getRuntimeController(state.combatant), state.fallbackGmB);

    state.fallbackGmB.active = false;
    assert.equal(getActivePrimaryGm(), null);
    assert.equal(getRuntimeController(state.combatant), null);
    assert.equal(getAssignedUser(state.combatant), state.player);
});

test("Foundry OWNER fallback remains stable across online changes", () => {
    const state = fixture();
    state.settings.userTokenLinks = {};
    state.settings.actorUserLinks = {};

    assert.equal(getAssignedUser(state.actor), state.player);
    state.player.active = false;
    assert.equal(getAssignedUser(state.actor), state.player);
    assert.equal(getRuntimeController(state.actor), state.primaryGm);
});
