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
import { buildHud } from "../Modul/splittermond-smoother-fight/scripts/features/hud/view.js";

const harness = {
    controlledToken: null,
    movementTracking: true,
    player: null,
    revealTargetResources: false,
    renderCalls: 0,
    targetSelection: {
        target: null,
        targets: [],
        primaryTargetTokenUuid: null,
        primaryTargetActorUuid: null,
    },
};

configureServices({
    canChooseTarget: () => false,
    feedbackMarkup: () => "",
    getAttackSpeed: async (attack) => attack.weaponSpeed ?? 0,
    getAssignedUser: (combatant) => combatant.assignedUser ?? null,
    getControlledTokenDocument: () => harness.controlledToken,
    getRuntimeController: (combatant) => combatant.runtimeController ?? null,
    getTargetSelectionForUser: () => harness.targetSelection,
    hasPendingActiveDefense: () => false,
    isPreparingSpell: () => false,
    isRangedAttack: (attack) => Boolean(attack.isRanged),
    isCurrentUserTarget: () => false,
    resolveCombatantToken: (combatant) => combatant.token ?? null,
    scheduleRender: () => harness.renderCalls += 1,
    tokenUuid: (token) => token?.uuid ?? null,
});

function combatant(id, controller, { owner = false } = {}) {
    const actor = {
        id: `actor-${id}`,
        isOwner: owner,
        name: `Actor ${id}`,
        attacks: [],
        items: [],
        skills: {},
        getFlag: () => null,
    };
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
    harness.movementTracking = true;
    harness.revealTargetResources = false;
    harness.renderCalls = 0;
    harness.targetSelection = {
        target: null,
        targets: [],
        primaryTargetTokenUuid: null,
        primaryTargetActorUuid: null,
    };
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
    globalThis.game = {
        combat,
        user: player,
        i18n: {
            lang: "de",
            localize: (key) => key,
            format: (key, data) => `${key}:${JSON.stringify(data)}`,
        },
        settings: {
            get: (_moduleId, key) => ({
                minimized: false,
                movementTracking: harness.movementTracking,
                revealTargetDefenses: false,
                revealTargetResources: harness.revealTargetResources,
                showCards: false,
                theme: "dark",
            })[key],
        },
    };
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

test("personal HUD controls expose melee attacks but not ranged attacks outside the player's turn", async () => {
    const { first } = installFixture();
    harness.controlledToken = first.token;
    first.actor.attacks = [
        { id: "sword", name: "Sword", img: "sword.webp", isRanged: false, weaponSpeed: 6 },
        { id: "bow", name: "Bow", img: "bow.webp", isRanged: true, weaponSpeed: 8 },
    ];

    const html = await buildHud(getHudContext());

    assert.match(html, /data-sf-context-actor-id="actor-first"/u);
    assert.match(html, /data-attack-id="sword"/u);
    assert.doesNotMatch(html, /data-attack-id="bow"/u);
    assert.match(html, /SMOOTHER_FIGHT\.HUD\.TickActions\.meleeAttack\.Name/u);
});

test("movement tracking setting shows and hides the tracker for the active combatant", async () => {
    const { active } = installFixture();
    active.actor.isOwner = true;
    active.actor.derivedValues = { speed: { value: 7 } };
    active.runtimeController = harness.player;
    const tokenDocument = {
        ...active.token,
        movementHistory: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        measureMovementPath: () => ({ distance: 10 }),
    };
    active.token = { document: tokenDocument };

    const context = getHudContext();
    assert.equal(context.token, tokenDocument);
    const enabled = await buildHud(context);
    assert.match(enabled, /class="sf-movement-tracker is-sprint"/u);
    assert.match(enabled, /data-tick-action-id="sprint"/u);

    harness.movementTracking = false;
    const disabled = await buildHud(getHudContext());
    assert.doesNotMatch(disabled, /sf-movement-tracker/u);
});

test("the world option reveals a foreign target's health and focus", async () => {
    installFixture();
    const targetActor = {
        img: "target.webp",
        name: "Target actor",
        derivedValues: {},
        system: {
            healthBar: { value: 7, max: 13 },
            focusBar: { value: 5, max: 11 },
        },
        testUserPermission: () => false,
    };
    const target = {
        actor: targetActor,
        name: "Foreign target",
        uuid: "Scene.scene.Token.foreign-target",
    };
    harness.targetSelection = {
        target,
        targets: [target],
        primaryTargetTokenUuid: target.uuid,
        primaryTargetActorUuid: null,
    };

    const concealed = await buildHud(getHudContext());
    assert.doesNotMatch(concealed, /7\/13/u);
    assert.doesNotMatch(concealed, /5\/11/u);

    harness.revealTargetResources = true;
    const revealed = await buildHud(getHudContext());
    assert.match(revealed, /7\/13/u);
    assert.match(revealed, /5\/11/u);
});
