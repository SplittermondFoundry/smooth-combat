import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    getHudContext,
    getPersonalHudCandidates,
    getPersonalHudContext,
    resetPersonalCombatantSelection,
    selectPersonalCombatantFromMenu,
    syncActiveCombatantTokenSelection,
} from "../Modul/splittermond-smoother-fight/scripts/features/hud/context.js";
import { buildTickActionReference } from "../Modul/splittermond-smoother-fight/scripts/features/hud/tick-action-reference.js";
import { buildHud } from "../Modul/splittermond-smoother-fight/scripts/features/hud/view.js";
import { toggleFavoriteTickAction } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/actions.js";
import { getAttackPreparation } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/attack-preparation.js";

const harness = {
    controlledToken: null,
    controlCalls: [],
    movementTracking: true,
    player: null,
    revealTargetDefenses: false,
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
    getAttackPreparation,
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
        object: { control: (options) => {
            harness.controlCalls.push({ id, options });
            harness.controlledToken = token;
        } },
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
    harness.controlCalls = [];
    harness.movementTracking = true;
    harness.revealTargetDefenses = false;
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
                revealTargetDefenses: harness.revealTargetDefenses,
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

test("the active owned combatant becomes the player's selected canvas token", () => {
    const { combat, first, second } = installFixture();
    combat.combatant = first;
    harness.controlledToken = second.token;

    assert.equal(syncActiveCombatantTokenSelection(combat), true);
    assert.deepEqual(harness.controlCalls, [{ id: first.id, options: { releaseOthers: true } }]);
    assert.equal(getPersonalHudContext(getHudContext())?.combatant, first);
});

test("the active GM-controlled combatant becomes the GM's selected canvas token", () => {
    const { combat, first, second } = installFixture();
    const gm = { id: "gm", isGM: true, name: "GM" };
    globalThis.game.user = gm;
    first.runtimeController = gm;
    combat.combatant = first;
    harness.controlledToken = second.token;

    assert.equal(syncActiveCombatantTokenSelection(combat), true);
    assert.deepEqual(harness.controlCalls, [{ id: first.id, options: { releaseOthers: true } }]);
});

test("successive tick turns keep switching the selected canvas token", () => {
    const { combat, first, second } = installFixture();

    for (const current of [first, second, first]) {
        combat.combatant = current;
        assert.equal(syncActiveCombatantTokenSelection(combat), true);
    }

    assert.deepEqual(harness.controlCalls, [
        { id: first.id, options: { releaseOthers: true } },
        { id: second.id, options: { releaseOthers: true } },
        { id: first.id, options: { releaseOthers: true } },
    ]);
});

test("favorite tick actions are pinned once above the regular categories", () => {
    installFixture();
    const html = buildTickActionReference({
        getFlag: (_moduleId, key) => key === "favoriteTickActionIds" ? ["shieldBash", "walk"] : null,
    });

    assert.ok(html.indexOf("TickActionCategories.favorites") < html.indexOf("TickActionCategories.movement"));
    assert.equal((html.match(/data-tick-action-id="shieldBash"/gu) ?? []).length, 2, "one action control and one favorite toggle");
    assert.match(html, /data-sf-action="toggle-favorite-tick-action"/u);
    assert.match(html, /data-sf-tick-action-category="favorites"/u);
});

test("toggling a tick-action favorite persists the actor-specific order", async () => {
    installFixture();
    const writes = [];
    const actor = {
        getFlag: () => ["walk"],
        setFlag: async (...args) => writes.push(args),
    };
    globalThis.ui = { notifications: { info: () => {} } };

    await toggleFavoriteTickAction({ actor }, "shieldBash");

    assert.deepEqual(writes, [[
        "splittermond-smoother-fight",
        "favoriteTickActionIds",
        ["walk", "shieldBash"],
    ]]);
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

test("a pending attack preparation is visible and dismissible in personal HUD controls", async () => {
    const { first } = installFixture();
    harness.controlledToken = first.token;
    first.actor.getFlag = (namespace, key) => (
        namespace === "splittermond-smoother-fight" && key === "attackPreparation"
            ? {
                id: "aim-1",
                actionId: "aim",
                ticks: 4,
                bonus: 2,
                combatId: "combat",
                combatantId: "first",
                attackId: "bow",
                targetTokenUuid: "Scene.scene.Token.rattling",
                targetActorUuid: "Actor.rattling",
                targetName: "Rattling",
            }
            : null
    );

    const html = await buildHud(getHudContext());

    assert.match(html, /class="sf-attack-preparation-status"/u);
    assert.match(html, /data-sf-attack-preparation-id="aim-1"/u);
    assert.match(html, /Rattling/u);
    assert.match(html, /data-sf-action="clear-attack-preparation"/u);
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

test("the active combatant's defenses and resources follow the foreign-stat world options", async () => {
    const { active } = installFixture();
    active.actor.derivedValues = {
        defense: { value: 21 },
        bodyresist: { value: 18 },
        mindresist: { value: 16 },
    };
    active.actor.system = {
        healthBar: { value: 12, max: 17 },
        focusBar: { value: 9, max: 14 },
    };
    active.actor.testUserPermission = () => false;

    const concealed = await buildHud(getHudContext());
    assert.match(concealed, /SMOOTHER_FIGHT\.HUD\.DefensesHidden/u);
    assert.doesNotMatch(concealed, /<small>VTD<\/small>21/u);
    assert.doesNotMatch(concealed, /12\/17/u);
    assert.doesNotMatch(concealed, /9\/14/u);

    harness.revealTargetDefenses = true;
    harness.revealTargetResources = true;
    const revealed = await buildHud(getHudContext());
    assert.match(revealed, /<small>VTD<\/small>21/u);
    assert.match(revealed, /<small>KW<\/small>18/u);
    assert.match(revealed, /<small>GW<\/small>16/u);
    assert.match(revealed, /12\/17/u);
    assert.match(revealed, /9\/14/u);
});
