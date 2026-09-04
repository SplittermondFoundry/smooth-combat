import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    findCombatantForToken,
    getHudContext,
    getPersonalHudCandidates,
    getPersonalHudContext,
    reconcileControlledCombatTokenSelection,
    resetPersonalCombatantSelection,
    selectPersonalCombatantFromMenu,
    syncActiveCombatantTokenSelection,
} from "../Modul/splittermond-smoother-fight/scripts/features/hud/context.js";
import { buildTickActionReference } from "../Modul/splittermond-smoother-fight/scripts/features/hud/tick-action-reference.js";
import { buildHud } from "../Modul/splittermond-smoother-fight/scripts/features/hud/view.js";
import {
    abortSelectedTokenMovement,
    DEFEATED_TOKEN_OVERLAY_ICON,
    markZeroHealthTargetDefeated,
    setCombatantDefeatedWithOverlay,
    toggleSelectedTokenPersistentMovementRoute,
    toggleSelectedTokenMovementRoute,
} from "../Modul/splittermond-smoother-fight/scripts/features/hud/controller.js";
import { toggleFavoriteTickAction } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/actions.js";
import { getAttackPreparation } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/attack-preparation.js";

const harness = {
    abortCalls: [],
    abortableMovement: null,
    controlledToken: null,
    controlCalls: [],
    meleeRange: 2,
    minimized: false,
    movementTracking: true,
    pendingDefense: null,
    pendingInterruption: null,
    pendingInterruptions: null,
    player: null,
    revealTargetDefenses: false,
    revealTargetResources: false,
    renderCalls: 0,
    routePreviewVisible: false,
    routePreviewPersistent: false,
    routeToggleCalls: [],
    targetSelection: {
        target: null,
        targets: [],
        primaryTargetTokenUuid: null,
        primaryTargetActorUuid: null,
    },
};

configureServices({
    abortMovementPlan: async (...args) => {
        harness.abortCalls.push(args);
        return true;
    },
    canChooseTarget: () => false,
    feedbackMarkup: () => "",
    getAttackSpeed: async (attack) => attack.weaponSpeed ?? 0,
    getAssignedUser: (combatant) => combatant.assignedUser ?? null,
    getAttackPreparation,
    getControlledTokenDocument: () => harness.controlledToken,
    getAbortableControlledTokenMovement: () => harness.abortableMovement,
    getGmCheatRollPreset: () => null,
    getRuntimeController: (combatant) => combatant.runtimeController ?? null,
    getTargetSelectionForUser: () => harness.targetSelection,
    getPendingActiveDefense: () => harness.pendingDefense,
    getPendingContinuousActionInterruption: () => harness.pendingInterruption,
    getPendingContinuousActionInterruptionsForCurrentUser: () => harness.pendingInterruptions,
    isMovementRoutePreviewVisible: () => harness.routePreviewVisible,
    isMovementRoutePreviewPersistent: () => harness.routePreviewPersistent,
    isPreparingSpell: () => false,
    isRangedAttack: (attack) => Boolean(attack.isRanged),
    isCurrentUserTarget: () => false,
    resolveToken: (reference) => Array.from(globalThis.game?.combat?.combatants ?? [])
        .map((candidate) => candidate.token?.document ?? candidate.token)
        .find((token) => token?.uuid === reference || token?.id === reference) ?? null,
    resolveCombatantToken: (combatant) => combatant.token ?? null,
    scheduleRender: () => harness.renderCalls += 1,
    toggleMovementRoutePreview: (...args) => {
        harness.routeToggleCalls.push(args);
        harness.routePreviewVisible = !harness.routePreviewVisible;
        if (!harness.routePreviewVisible) harness.routePreviewPersistent = false;
        return harness.routePreviewVisible;
    },
    togglePersistentMovementRoutePreview: (...args) => {
        harness.routeToggleCalls.push(args);
        if (harness.routePreviewPersistent) {
            harness.routePreviewPersistent = false;
            harness.routePreviewVisible = false;
        } else {
            harness.routePreviewPersistent = true;
            harness.routePreviewVisible = true;
        }
        return harness.routePreviewVisible;
    },
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

function activeEffectFixture(id, source) {
    return {
        id,
        disabled: source.disabled,
        flags: structuredClone(source.flags),
        img: source.img,
        showIcon: source.showIcon,
        statuses: new Set(source.statuses),
        async update(changes) {
            for (const [key, value] of Object.entries(changes)) {
                if (key === "flags.core.overlay") this.flags.core.overlay = value;
                else if (key === "flags.splittermond-smoother-fight.defeatedTokenOverlay") {
                    this.flags["splittermond-smoother-fight"] ??= {};
                    this.flags["splittermond-smoother-fight"].defeatedTokenOverlay = value;
                } else this[key] = value;
            }
            return this;
        },
    };
}

function installFixture() {
    resetPersonalCombatantSelection();
    harness.abortCalls = [];
    harness.abortableMovement = null;
    harness.controlledToken = null;
    harness.controlCalls = [];
    harness.meleeRange = 2;
    harness.minimized = false;
    harness.movementTracking = true;
    harness.pendingDefense = null;
    harness.pendingInterruption = null;
    harness.pendingInterruptions = null;
    harness.revealTargetDefenses = false;
    harness.revealTargetResources = false;
    harness.renderCalls = 0;
    harness.routePreviewVisible = false;
    harness.routePreviewPersistent = false;
    harness.routeToggleCalls = [];
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
            format: (key, data) => key === "SMOOTHER_FIGHT.HUD.RuntimeControllerFor"
                ? `Steuerung: ${data.controller} · ${data.assigned} offline`
                : `${key}:${JSON.stringify(data)}`,
        },
        settings: {
            get: (_moduleId, key) => ({
                minimized: harness.minimized,
                meleeRange: harness.meleeRange,
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

test("the HUD follows the active scene combat instead of a stale viewed combat", () => {
    const { active, combat } = installFixture();
    const scene = { id: "battle-scene" };
    const defeated = combatant("defeated", harness.player, { owner: true });
    defeated.isDefeated = true;
    const staleCombat = {
        id: "stale-combat",
        started: true,
        isActive: false,
        scene,
        combatant: defeated,
        combatants: [defeated],
        turns: [defeated],
    };
    combat.isActive = true;
    combat.scene = scene.id;
    globalThis.game.combat = staleCombat;
    globalThis.game.combats = new Map([
        [staleCombat.id, staleCombat],
        [combat.id, combat],
    ]);
    globalThis.canvas.scene = scene;

    const context = getHudContext();

    assert.equal(context?.combat, combat);
    assert.equal(context?.combatant, active);
    assert.notEqual(context?.combatant, defeated);
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

test("runtime GM fallback explains an offline assigned user in expanded and minimized HUDs", async () => {
    const { active } = installFixture();
    const gm = { id: "gm", isGM: true, name: "GM" };
    active.assignedUser = { id: "patrick", isGM: false, name: "Patrick", active: false };
    active.runtimeController = gm;
    globalThis.game.user = gm;

    const expanded = await buildHud(getHudContext());
    assert.match(expanded, /class="sf-your-turn"/u);
    assert.match(expanded, /class="sf-runtime-controller"/u);
    assert.match(expanded, /Steuerung: GM · Patrick offline/u);

    harness.minimized = true;
    const minimized = await buildHud(getHudContext());
    assert.match(minimized, /class="sf-shell is-current-user-turn is-minimized"/u);
    assert.match(minimized, /class="sf-runtime-controller"/u);
    assert.match(minimized, /Steuerung: GM · Patrick offline/u);
});

test("runtime controller notice stays hidden without an actual fallback", async () => {
    const { active } = installFixture();
    const assignedUser = { id: "player", isGM: false, name: "Player", active: true };
    active.actor.isOwner = true;
    active.assignedUser = assignedUser;
    active.runtimeController = assignedUser;
    globalThis.game.user = assignedUser;

    assert.doesNotMatch(await buildHud(getHudContext()), /sf-runtime-controller/u);

    assignedUser.active = false;
    active.runtimeController = null;
    assert.doesNotMatch(await buildHud(getHudContext()), /sf-runtime-controller/u);
});

test("reload keeps selecting the active GM-controlled combatant", () => {
    const { combat, first, second } = installFixture();
    const gm = { id: "gm", isGM: true, name: "GM" };
    globalThis.game.user = gm;
    first.runtimeController = gm;
    combat.combatant = first;
    harness.controlledToken = second.token;

    assert.equal(reconcileControlledCombatTokenSelection(combat), true);
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

test("reload replaces an identically named defeated token with the exact in-combat token", () => {
    const { combat, first } = installFixture();
    combat.combatants = [combat.combatant, first];
    combat.turns = [combat.combatant, first];
    first.actor.name = "Feenhörnchen";
    first.token.name = "Feenhörnchen";
    const defeatedToken = {
        id: "token-defeated-feenhoernchen",
        uuid: "Scene.scene.Token.token-defeated-feenhoernchen",
        name: "Feenhörnchen",
        actor: first.actor,
        object: { release: () => assert.fail("the valid in-combat replacement should release the stale token") },
    };
    harness.controlledToken = defeatedToken;

    assert.equal(reconcileControlledCombatTokenSelection(combat), true);
    assert.deepEqual(harness.controlCalls, [{ id: first.id, options: { releaseOthers: true } }]);
    assert.equal(harness.controlledToken, first.token);
    assert.equal(findCombatantForToken(combat, harness.controlledToken), first);
});

test("reload releases an out-of-combat token instead of guessing between combatants", () => {
    const { combat, first } = installFixture();
    let released = false;
    const defeatedToken = {
        id: "token-defeated-feenhoernchen",
        uuid: "Scene.scene.Token.token-defeated-feenhoernchen",
        name: "Feenhörnchen",
        actor: first.actor,
        object: { release: () => released = true },
    };
    harness.controlledToken = defeatedToken;

    assert.equal(reconcileControlledCombatTokenSelection(combat), true);
    assert.equal(released, true);
    assert.deepEqual(harness.controlCalls, []);
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

test("a pending active defense uses a wide response button with a dedicated decline action", async () => {
    const { first } = installFixture();
    harness.controlledToken = first.token;
    harness.pendingDefense = {
        message: { id: "attack-awaiting-defense" },
        target: first.token,
    };

    const html = await buildHud(getHudContext());

    assert.match(html, /class="sf-action-menu sf-defense-response-control is-defense-alert"/u);
    assert.match(html, /class="sf-defense-response" data-sf-action="respond-active-defense" data-message-id="attack-awaiting-defense"/u);
    assert.match(html, /class="sf-decline-defense" data-sf-action="decline-active-defense" data-message-id="attack-awaiting-defense"/u);
    assert.match(html, /fa-solid fa-xmark/u);
});

test("a pending Defender decision uses the same dedicated decline action for the exact helper token", async () => {
    const { first } = installFixture();
    harness.controlledToken = first.token;
    harness.pendingDefense = {
        message: { id: "attack-awaiting-defender" },
        target: { uuid: "Token.target", name: "Protected target" },
        defender: first.token,
        role: "defender",
    };

    const html = await buildHud(getHudContext());

    assert.match(html, /data-sf-action="respond-defender-defense"/u);
    assert.match(html, /data-defender-token-uuid="Scene\.scene\.Token\.token-first"/u);
    assert.match(html, /data-sf-action="decline-active-defense"[^>]*data-defender-token-uuid="Scene\.scene\.Token\.token-first"/u);
    assert.match(html, /SMOOTHER_FIGHT\.HUD\.DefenderAction/u);
});

test("a pending continuous-action interruption is highlighted in personal HUD controls", async () => {
    const { first } = installFixture();
    harness.controlledToken = first.token;
    harness.pendingInterruption = {
        id: "interrupt-1",
        actionId: "focusMagic",
        difficulty: 18,
    };

    const html = await buildHud(getHudContext());

    assert.match(html, /class="sf-action-menu sf-defense-response-control sf-continuous-interruption-control is-defense-alert"/u);
    assert.match(html, /data-sf-action="roll-continuous-action-interruption" data-request-id="interrupt-1"/u);
    assert.match(html, /ContinuousActionInterruptionHudDifficulty/u);
});

test("a GM sees a non-active damaged token's pending interruption in the active HUD", async () => {
    const { first } = installFixture();
    globalThis.game.user = { id: "gm", isGM: true, name: "GM" };
    harness.pendingInterruptions = [{
        request: {
            id: "interrupt-non-active",
            actionId: "focusMagic",
            difficulty: 17,
            tokenUuid: first.token.uuid,
        },
        token: first.token,
    }];

    const html = await buildHud(getHudContext());

    assert.match(html, /data-request-id="interrupt-non-active"/u);
    assert.match(html, new RegExp(`data-sf-token-uuid="${first.token.uuid}"`, "u"));
    assert.match(html, new RegExp(first.token.name, "u"));
});

test("the primary target distance drives advisory attack and spell range states", async () => {
    const { combat, first } = installFixture();
    combat.combatant = first;
    first.token.x = 0;
    first.token.y = 0;
    first.token.width = 1;
    first.token.height = 1;
    first.actor.attacks = [
        { id: "sword", name: "Sword", img: "sword.webp", isRanged: false, range: 0, weaponSpeed: 6 },
        { id: "bow", name: "Bow", img: "bow.webp", isRanged: true, range: 10, weaponSpeed: 8 },
    ];
    first.actor.spells = [
        { id: "bolt", name: "Bolt", img: "bolt.webp", difficulty: "VTD", range: "7 m", castDuration: 5 },
        { id: "touch", name: "Touch", img: "touch.webp", difficulty: 18, range: "Berührung", castDuration: 3 },
        {
            id: "caster",
            name: "Caster",
            img: "caster.webp",
            difficulty: 18,
            range: "Zauberer",
            castDuration: 3,
            skill: { id: "firemagic", label: "Fire magic" },
            system: { skill: "firemagic" },
        },
    ];
    const target = {
        id: "target",
        uuid: "Scene.scene.Token.target",
        name: "Target",
        x: 300,
        y: 0,
        width: 1,
        height: 1,
        actor: { name: "Target actor", derivedValues: {}, system: {} },
    };
    harness.targetSelection = {
        target,
        targets: [target],
        primaryTargetTokenUuid: target.uuid,
        primaryTargetActorUuid: null,
    };
    globalThis.canvas = {
        grid: {
            size: 100,
            units: "m",
            measurePath: () => ({ distance: 7.4 }),
        },
        tokens: { get: () => null },
    };

    const html = await buildHud(getHudContext());

    assert.match(html, /SMOOTHER_FIGHT\.HUD\.PrimaryTarget · 7,4 m/u);
    assert.match(html, /class="sf-attack-option-roll [^"]*is-range-outside" data-sf-action="attack" data-attack-id="sword"/u);
    assert.match(html, /class="sf-attack-option-roll [^"]*is-range-within" data-sf-action="attack" data-attack-id="bow"/u);
    assert.match(html, /data-spell-id="bolt" class="[^"]*is-range-outside/u);
    assert.match(html, /data-spell-id="touch" class="[^"]*is-range-outside/u);
    const casterWithoutMastery = html.match(/<button[^>]*data-spell-id="caster"[\s\S]*?<\/button>/u)?.[0];
    assert.ok(casterWithoutMastery);
    assert.doesNotMatch(casterWithoutMastery, /is-range-/u);
    assert.doesNotMatch(casterWithoutMastery, /sf-action-range-status/u);
    assert.match(html, /SMOOTHER_FIGHT\.HUD\.AttackRangeOutside/u);
    assert.match(html, /SMOOTHER_FIGHT\.HUD\.RangeWithin/u);
    assert.match(html, /SMOOTHER_FIGHT\.HUD\.SpellRangeOutside/u);
    assert.doesNotMatch(html, /SMOOTHER_FIGHT\.HUD\.RangeUnknown/u);

    harness.meleeRange = 8;
    const extendedMeleeRange = await buildHud(getHudContext());
    assert.match(extendedMeleeRange, /class="sf-attack-option-roll [^"]*is-range-within" data-sf-action="attack" data-attack-id="sword"/u);

    target.x = 100;
    first.actor.items = [{
        type: "mastery",
        name: "Hand des Zauberers",
        system: { id: "hand-des-zauberers", skill: "firemagic" },
    }];
    const adjacentTouchRange = await buildHud(getHudContext());
    assert.match(adjacentTouchRange, /data-spell-id="touch" class="[^"]*is-range-within/u);
    assert.match(adjacentTouchRange, /data-spell-id="caster" class="[^"]*is-range-within/u);

    first.actor.items[0].system.skill = "windmagic";
    const wrongSchoolMastery = await buildHud(getHudContext());
    assert.match(wrongSchoolMastery, /data-spell-id="touch" class="[^"]*is-range-within/u);
    const casterWithWrongSchoolMastery = wrongSchoolMastery.match(/<button[^>]*data-spell-id="caster"[\s\S]*?<\/button>/u)?.[0];
    assert.ok(casterWithWrongSchoolMastery);
    assert.doesNotMatch(casterWithWrongSchoolMastery, /is-range-/u);
    assert.doesNotMatch(casterWithWrongSchoolMastery, /sf-action-range-status/u);
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

test("the combat HUD aborts the selected non-active token's movement", async () => {
    const { active, combat, second } = installFixture();
    globalThis.game.user = { id: "gm", isGM: true, name: "GM" };
    harness.controlledToken = second.token;
    harness.abortableMovement = second.token;

    const html = await buildHud(getHudContext());

    assert.match(html, new RegExp(active.actor.name, "u"), "the regular HUD remains on the active combatant");
    assert.match(html, /class="sf-combat-controls sf-selected-movement-control"/u);
    assert.match(html, /data-sf-action="abort-selected-movement"/u);
    assert.match(html, /data-sf-action="toggle-movement-route"/u);
    assert.match(html, /data-sf-action="toggle-persistent-movement-route"/u);
    assert.match(html, /aria-pressed="false"/u);
    assert.match(html, /data-token-uuid="Scene\.scene\.Token\.token-second"/u);
    assert.match(html, /Token second/u);

    assert.equal(await abortSelectedTokenMovement(combat, second.token.uuid), true);
    assert.deepEqual(harness.abortCalls, [[second.token, combat]]);

    assert.equal(toggleSelectedTokenMovementRoute(combat, second.token.uuid), true);
    assert.deepEqual(harness.routeToggleCalls, [[second.token, combat]]);
    const visibleRouteHtml = await buildHud(getHudContext());
    assert.match(visibleRouteHtml, /aria-pressed="true"/u);
    assert.match(visibleRouteHtml, /SMOOTHER_FIGHT\.HUD\.HideMovementRoute/u);
    assert.equal(toggleSelectedTokenMovementRoute(combat, second.token.uuid), false);
    assert.equal(harness.routePreviewVisible, false);

    assert.equal(toggleSelectedTokenPersistentMovementRoute(combat, second.token.uuid), true);
    assert.equal(harness.routePreviewPersistent, true);
    const persistentRouteHtml = await buildHud(getHudContext());
    assert.match(persistentRouteHtml, /SMOOTHER_FIGHT\.HUD\.HidePersistentMovementRoute/u);
    assert.equal(toggleSelectedTokenPersistentMovementRoute(combat, second.token.uuid), false);
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

test("a player sees a defeated primary target without receiving its hidden health", async () => {
    const { combat } = installFixture();
    const targetActor = {
        img: "target.webp",
        name: "Defeated target actor",
        derivedValues: {},
        system: {
            healthBar: { value: 0, max: 21 },
            focusBar: { value: 2, max: 2 },
        },
        testUserPermission: () => false,
    };
    const target = {
        actor: targetActor,
        id: "defeated-target",
        name: "Defeated target",
        uuid: "Scene.scene.Token.defeated-target",
    };
    combat.combatants.push({
        actor: targetActor,
        id: "defeated-target-combatant",
        isDefeated: true,
        token: target,
        tokenId: target.id,
    });
    harness.targetSelection = {
        target,
        targets: [target],
        primaryTargetTokenUuid: target.uuid,
        primaryTargetActorUuid: null,
    };

    const html = await buildHud(getHudContext());

    assert.match(html, /class="sf-portrait sf-target [^"]*sf-is-primary-target[^"]*sf-is-defeated/u);
    assert.match(html, /class="sf-primary-target-defeated-status"/u);
    assert.match(html, /SMOOTHER_FIGHT\.HUD\.Defeated/u);
    assert.doesNotMatch(html, /0\/21/u);
    assert.doesNotMatch(html, /2\/2/u);
    assert.doesNotMatch(html, /data-sf-action="mark-target-defeated"/u);
});

test("active actor and primary target portraits share the same dedicated header", async () => {
    installFixture();
    const targetActor = {
        img: "target.webp",
        name: "Target actor",
        derivedValues: {},
        system: {},
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

    const html = await buildHud(getHudContext());
    const actorCard = html.match(/<aside class="sf-portrait sf-actor[^"]*"[\s\S]*?<\/aside>/u)?.[0];
    const targetCard = html.match(/<aside class="sf-portrait sf-target[^"]*"[\s\S]*?<\/aside>/u)?.[0];

    assert.ok(actorCard);
    assert.ok(targetCard);
    assert.match(actorCard, /<div class="sf-portrait-header">\s*<span class="sf-eyebrow">SMOOTHER_FIGHT\.HUD\.Active<\/span>\s*<\/div>\s*<div class="sf-portrait-image">/u);
    assert.match(targetCard, /<div class="sf-portrait-header">\s*<span class="sf-eyebrow">SMOOTHER_FIGHT\.HUD\.PrimaryTarget<\/span>\s*<\/div>\s*<div class="sf-portrait-image">/u);
    assert.doesNotMatch(html, /class="sf-portrait-image">\s*<span class="sf-eyebrow">/u);
});

test("the GM can mark a zero-health primary target combatant defeated with a skull overlay", async (t) => {
    const { combat } = installFixture();
    globalThis.game.user = { id: "gm", isGM: true, name: "GM" };
    const originalConfig = globalThis.CONFIG;
    globalThis.CONFIG = { specialStatusEffects: { DEFEATED: "dead" } };
    t.after(() => globalThis.CONFIG = originalConfig);
    const createdEffects = [];
    const targetActor = {
        effects: [],
        img: "target.webp",
        name: "Target actor",
        derivedValues: {},
        system: { healthBar: { value: 0, max: 13 } },
        createEmbeddedDocuments: async (type, sources) => {
            createdEffects.push({ type, sources });
            const effects = sources.map((source, index) => activeEffectFixture(`defeated-${index}`, source));
            targetActor.effects.push(...effects);
            return effects;
        },
    };
    const target = {
        actor: targetActor,
        id: "zero-health-target",
        name: "Zero-health target",
        uuid: "Scene.scene.Token.zero-health-target",
    };
    const updates = [];
    const targetCombatant = {
        actor: targetActor,
        id: "target-combatant",
        isDefeated: false,
        token: target,
        tokenId: target.id,
        update: async (changes) => {
            updates.push(changes);
            targetCombatant.isDefeated = Boolean(changes.defeated);
        },
    };
    combat.combatants.push(targetCombatant);
    harness.targetSelection = {
        target,
        targets: [target],
        primaryTargetTokenUuid: target.uuid,
        primaryTargetActorUuid: null,
    };

    const html = await buildHud(getHudContext());
    const defeatControlIndex = html.indexOf('class="sf-primary-target-defeat"');
    const targetHeaderIndex = html.lastIndexOf('class="sf-portrait-header"', defeatControlIndex);
    const targetImageIndex = html.indexOf('class="sf-portrait-image"', targetHeaderIndex);

    assert.match(html, /class="sf-primary-target-defeat"/u);
    assert.match(html, /data-sf-action="mark-target-defeated"/u);
    assert.match(html, /data-token-uuid="Scene\.scene\.Token\.zero-health-target"/u);
    assert.ok(targetHeaderIndex >= 0 && targetHeaderIndex < defeatControlIndex);
    assert.ok(defeatControlIndex < targetImageIndex);
    assert.equal(await markZeroHealthTargetDefeated(getHudContext(), target.uuid), true);
    assert.deepEqual(updates, [{ defeated: true }]);
    assert.equal(DEFEATED_TOKEN_OVERLAY_ICON, "icons/svg/skull.svg");
    assert.equal(createdEffects.length, 1);
    assert.equal(createdEffects[0].type, "ActiveEffect");
    assert.deepEqual(createdEffects[0].sources[0], {
        name: "EFFECT.StatusDead",
        img: "icons/svg/skull.svg",
        changes: [],
        disabled: false,
        showIcon: 2,
        statuses: ["dead"],
        flags: {
            core: { overlay: true },
            "splittermond-smoother-fight": { defeatedTokenOverlay: true },
        },
    });
    const defeatedHtml = await buildHud(getHudContext());
    assert.doesNotMatch(defeatedHtml, /data-sf-action="mark-target-defeated"/u);
    assert.match(defeatedHtml, /class="sf-primary-target-defeated-status"/u);
});

test("the active combatant defeat control adds and removes the same skull overlay", async (t) => {
    const { active } = installFixture();
    const originalConfig = globalThis.CONFIG;
    globalThis.CONFIG = { specialStatusEffects: { DEFEATED: "dead" } };
    t.after(() => globalThis.CONFIG = originalConfig);
    const combatantUpdates = [];
    const createdEffects = [];
    const deletedEffects = [];
    active.actor.effects = [];
    active.update = async (changes) => {
        combatantUpdates.push(changes);
        active.isDefeated = Boolean(changes.defeated);
    };
    active.actor.createEmbeddedDocuments = async (type, sources) => {
        assert.equal(type, "ActiveEffect");
        createdEffects.push(...sources);
        const effects = sources.map((source, index) => activeEffectFixture(`active-defeated-${index}`, source));
        active.actor.effects.push(...effects);
        return effects;
    };
    active.actor.deleteEmbeddedDocuments = async (type, ids) => {
        assert.equal(type, "ActiveEffect");
        deletedEffects.push(...ids);
        active.actor.effects = active.actor.effects.filter((effect) => !ids.includes(effect.id));
    };

    assert.equal(await setCombatantDefeatedWithOverlay(active, true), true);
    assert.equal(await setCombatantDefeatedWithOverlay(active, false), true);

    assert.deepEqual(combatantUpdates, [{ defeated: true }, { defeated: false }]);
    assert.equal(createdEffects.length, 1);
    assert.equal(createdEffects[0].img, "icons/svg/skull.svg");
    assert.deepEqual(createdEffects[0].statuses, ["dead"]);
    assert.equal(createdEffects[0].flags.core.overlay, true);
    assert.deepEqual(deletedEffects, ["active-defeated-0"]);
    assert.deepEqual(active.actor.effects, []);
});

test("the target defeat shortcut stays hidden without every required condition", async () => {
    const { combat } = installFixture();
    const target = {
        actor: {
            name: "Target actor",
            derivedValues: {},
            system: { healthBar: { value: 0, max: 13 } },
        },
        id: "conditional-target",
        name: "Conditional target",
        uuid: "Scene.scene.Token.conditional-target",
    };
    const targetCombatant = {
        id: "conditional-combatant",
        isDefeated: false,
        token: target,
        tokenId: target.id,
        update: async () => assert.fail("an ineligible target must not be updated"),
    };
    combat.combatants.push(targetCombatant);
    harness.targetSelection = {
        target,
        targets: [target],
        primaryTargetTokenUuid: target.uuid,
        primaryTargetActorUuid: null,
    };

    assert.doesNotMatch(await buildHud(getHudContext()), /data-sf-action="mark-target-defeated"/u, "players never see the shortcut");
    assert.equal(await markZeroHealthTargetDefeated(getHudContext(), target.uuid), false);

    globalThis.game.user = { id: "gm", isGM: true, name: "GM" };
    target.actor.system.healthBar.value = 1;
    assert.doesNotMatch(await buildHud(getHudContext()), /data-sf-action="mark-target-defeated"/u, "positive health hides the shortcut");
    assert.equal(await markZeroHealthTargetDefeated(getHudContext(), target.uuid), false);

    target.actor.system.healthBar.value = 0;
    combat.combatants.pop();
    assert.doesNotMatch(await buildHud(getHudContext()), /data-sf-action="mark-target-defeated"/u, "non-combat targets cannot be defeated");
    assert.equal(await markZeroHealthTargetDefeated(getHudContext(), target.uuid), false);
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
