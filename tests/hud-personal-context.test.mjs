import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    getHudContext,
    getPersonalHudCandidates,
    getPersonalHudContext,
    resetPersonalCombatantSelection,
    selectPersonalCombatantFromMenu,
} from "../Modul/splittermond-smoother-fight/scripts/features/hud/context.js";

const harness = {
    controlledToken: null,
    player: null,
    renderCalls: 0,
};

configureServices({
    getAssignedUser: (combatant) => combatant.assignedUser ?? null,
    getControlledTokenDocument: () => harness.controlledToken,
    getRuntimeController: (combatant) => combatant.runtimeController ?? null,
    getTargetSelectionForUser: () => ({
        target: null,
        targets: [],
        primaryTargetTokenUuid: null,
        primaryTargetActorUuid: null,
    }),
    resolveCombatantToken: (combatant) => combatant.token ?? null,
    scheduleRender: () => harness.renderCalls += 1,
    tokenUuid: (token) => token?.uuid ?? null,
});

function combatant(id, controller, { owner = false } = {}) {
    const actor = { id: `actor-${id}`, isOwner: owner, name: `Actor ${id}` };
    const token = {
        id: `token-${id}`,
        uuid: `Scene.scene.Token.token-${id}`,
        name: `Token ${id}`,
        actor,
        object: { control: () => {} },
    };
    return {
        id,
        actor,
        token,
        tokenId: token.id,
        hidden: false,
        initiative: 20,
        runtimeController: controller,
    };
}

function installFixture() {
    resetPersonalCombatantSelection();
    harness.controlledToken = null;
    harness.renderCalls = 0;
    const player = { id: "player", isGM: false, name: "Player" };
    const other = { id: "other", isGM: false, name: "Other" };
    const active = combatant("active", other);
    const first = combatant("first", player, { owner: true });
    const second = combatant("second", player, { owner: true });
    const combat = {
        id: "combat",
        started: true,
        combatant: active,
        combatants: [active, first, second],
        turns: [active, first, second],
    };
    harness.player = player;
    globalThis.game = { combat, user: player };
    globalThis.canvas = { tokens: { get: () => null } };
    return { active, combat, first, second };
}

test("an owned controlled token selects personal HUD controls outside the player's turn", () => {
    const { active, first, second } = installFixture();
    harness.controlledToken = second.token;

    const activeContext = getHudContext();
    const candidates = getPersonalHudCandidates(activeContext);
    const personalContext = getPersonalHudContext(activeContext);

    assert.equal(activeContext.combatant, active);
    assert.deepEqual(candidates.map(({ combatant: candidate }) => candidate.id), [first.id, second.id]);
    assert.ok(candidates.every((candidate) => candidate.owned));
    assert.equal(personalContext?.combatant, second);
    assert.equal(personalContext?.personal, true);
});

test("the personal combatant menu selects HUD controls outside the player's turn", () => {
    const { active, first } = installFixture();
    const activeContext = getHudContext();
    assert.equal(getPersonalHudContext(activeContext), null);

    selectPersonalCombatantFromMenu(activeContext, first.id);

    const personalContext = getPersonalHudContext(activeContext);
    assert.equal(activeContext.combatant, active);
    assert.equal(personalContext?.combatant, first);
    assert.equal(personalContext?.personal, true);
    assert.equal(harness.renderCalls, 1);
});
