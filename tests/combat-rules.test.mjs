import test from "node:test";
import assert from "node:assert/strict";
import {
    actionRequiresTarget,
    activeDefenseChangesDifficulty,
    actorLinkUuid,
    attackControlSelection,
    attackControlState,
    attackOutcomeChanged,
    attackReadiness,
    bestActiveDefenseValue,
    calculateActiveDefenseValue,
    combatActionHighlightState,
    combatMessageKind,
    combatTickActionsFor,
    findDefensiveFeatureValue,
    fullyConsumedCost,
    hasSplittermondCheckUpdate,
    hasTokenPositionUpdate,
    healthCostFeedbackKind,
    healthCostTotal,
    isCombatantVisibleToUser,
    isDamageSelectionAction,
    isDefenderMasteryName,
    isPlayersTurn,
    isRedundantDeletedTokenLink,
    isTargetDependentDifficulty,
    isOffensiveCombatMessage,
    linkMatchesCombatant,
    mayUseRemoteChatActions,
    mayViewActorResources,
    mayViewTargetDefenses,
    mayViewTargetDifficulty,
    mergeActiveDefenseCheck,
    normalizeAudioFeedbackProfile,
    normalizeActorUserLinks,
    normalizeFavoriteSkillIds,
    normalizeSearchText,
    normalizeTargetReferences,
    normalizeUserTokenLinks,
    parseActiveDefenseDescription,
    parseStatusEffectLabel,
    recalculateAttackReport,
    reorderFavoriteSkillIds,
    replaceManagedUserTokenLinks,
    requiresRollManagementPermission,
    resolveCombatEventOpenIds,
    selectPersonalCombatant,
    tickAdvanceConfirmed,
    tokenDocumentCenter,
    totalDegreesOfSuccess,
    toggleFavoriteSkillId,
    uniqueTokensByReference,
    visibleCanvasCenterY,
    withTemporarySetValues,
} from "../Modul/splittermond-smoother-fight/scripts/combat-rules.js";

function attackReport(overrides = {}) {
    return {
        roll: { total: 26, dice: [{ total: 12 }] },
        skill: { points: 6 },
        difficulty: 18,
        succeeded: true,
        isFumble: false,
        isCrit: false,
        degreeOfSuccess: { fromRoll: 2, modification: 0 },
        maneuvers: [],
        ...overrides,
    };
}

test("successful active defense increases the base defense by 1 + EG + Defensiv", () => {
    const value = calculateActiveDefenseValue({
        baseDefense: 20,
        succeeded: true,
        degreeOfSuccess: { fromRoll: 2, modification: 1 },
    }, 2);
    assert.equal(value, 26);
});

test("failed active defense leaves the base defense unchanged", () => {
    assert.equal(calculateActiveDefenseValue({ baseDefense: 20, succeeded: false }, 3), 20);
});

test("audio feedback profiles preserve valid personal and custom world settings", () => {
    const defaults = {
        defense: { enabled: true, sound: "shield" },
        turn: { enabled: true, sound: "turn" },
    };
    const profile = normalizeAudioFeedbackProfile({
        version: 1,
        events: {
            defense: { enabled: false, sound: "custom", customSound: "  sounds/defense.ogg  " },
            turn: { enabled: true, sound: "unknown" },
            removedEvent: { enabled: true, sound: "custom", customSound: "ignored.ogg" },
        },
    }, defaults, ["shield", "turn", "custom"]);

    assert.deepEqual(profile, {
        version: 1,
        events: {
            defense: { enabled: false, sound: "custom", customSound: "sounds/defense.ogg" },
            turn: { enabled: true, sound: "turn", customSound: "" },
        },
    });
});

test("combat action highlighting advances from open degrees through focus costs to ticks", () => {
    assert.deepEqual(combatActionHighlightState({
        isOffense: true,
        hasPendingDegreeOptions: true,
        isSpell: true,
        hasPendingFocusCost: true,
        hasPendingDamage: true,
    }), { degrees: true, focus: false, damage: false, ticks: false });
    assert.deepEqual(combatActionHighlightState({
        isOffense: true,
        hasPendingDegreeOptions: true,
        followUpStarted: true,
        isSpell: true,
        hasPendingFocusCost: true,
        hasPendingDamage: true,
    }), { degrees: false, focus: true, damage: false, ticks: false });
    assert.deepEqual(combatActionHighlightState({ isSpell: true, hasPendingFocusCost: true }), {
        degrees: false,
        focus: true,
        damage: false,
        ticks: false,
    });
    assert.deepEqual(combatActionHighlightState({ isOffense: true, hasPendingDamage: true }), {
        degrees: false,
        focus: false,
        damage: true,
        ticks: false,
    });
    assert.deepEqual(combatActionHighlightState({
        isOffense: true,
        hasPendingDamageApplication: true,
    }), {
        degrees: false,
        focus: false,
        damage: false,
        ticks: false,
    });
    assert.deepEqual(combatActionHighlightState({ isSpell: true }), {
        degrees: false,
        focus: false,
        damage: false,
        ticks: true,
    });
});

test("active defense uses the rendered check report when the message flag only contains input data", () => {
    const check = mergeActiveDefenseCheck({
        type: "defense",
        baseDefense: 22,
        succeeded: false,
        itemData: { name: "Turmschild" },
    }, {
        succeeded: true,
        degreeOfSuccess: { fromRoll: 2, modification: 0 },
    });
    assert.equal(check.succeeded, true);
    assert.deepEqual(check.degreeOfSuccess, { fromRoll: 2, modification: 0 });
    assert.equal(calculateActiveDefenseValue(check, 1), 26);
});

test("active defense descriptions separate defense values from stun damage", () => {
    assert.deepEqual(parseActiveDefenseDescription("VTD: 23 + 3 Punkte Betäubungsschaden"), {
        defenseLabel: "VTD",
        defenseValue: 23,
        defensePrefixLength: 7,
        numbingDamage: 3,
    });
});

test("a narrowly failed defense still counts when the system card reports a higher defense", () => {
    assert.equal(activeDefenseChangesDifficulty({ baseDefense: 22, succeeded: false }, 23), true);
    assert.equal(activeDefenseChangesDifficulty({ baseDefense: 22, succeeded: false }, 22), false);
});

test("multiple active defenses retain the better defense value", () => {
    assert.equal(bestActiveDefenseValue(24, 27), 27);
    assert.equal(bestActiveDefenseValue(27, 24), 27);
});

test("the Defender mastery is recognized with an optional threshold suffix", () => {
    assert.equal(isDefenderMasteryName("Verteidiger"), true);
    assert.equal(isDefenderMasteryName("Verteidiger (Schwelle 1)"), true);
    assert.equal(isDefenderMasteryName("Magischer Verteidiger"), false);
});

test("only resistance-based spell difficulties require a target", () => {
    assert.equal(isTargetDependentDifficulty("VTD"), true);
    assert.equal(isTargetDependentDifficulty(" kw "), true);
    assert.equal(isTargetDependentDifficulty("gw"), true);
    assert.equal(isTargetDependentDifficulty(23), false);
    assert.equal(isTargetDependentDifficulty("20"), false);
    assert.equal(isTargetDependentDifficulty(""), false);
});

test("attack is recalculated against the improved defense", () => {
    const result = recalculateAttackReport(attackReport(), 24);
    assert.equal(result.succeeded, true);
    assert.equal(result.difficulty, 24);
    assert.equal(result.degreeOfSuccess.fromRoll, 0);
});

test("active defense can turn an attack into a failure", () => {
    const result = recalculateAttackReport(attackReport(), 27);
    assert.equal(result.succeeded, false);
    assert.equal(result.degreeOfSuccess.fromRoll, 0);
});

test("active defense recreates attack cards only for changed outcomes", () => {
    assert.equal(attackOutcomeChanged(
        attackReport(),
        attackReport({ difficulty: 19 })
    ), false);
    assert.equal(attackOutcomeChanged(
        attackReport(),
        attackReport({ degreeOfSuccess: { fromRoll: 1, modification: 0 } })
    ), true);
    assert.equal(attackOutcomeChanged(
        attackReport({ degreeOfSuccess: { fromRoll: 0, modification: 0 } }),
        attackReport({ succeeded: false, degreeOfSuccess: { fromRoll: 0, modification: 0 } })
    ), true);
});

test("critical and fumble modifiers remain compatible with Splittermond", () => {
    const critical = recalculateAttackReport(attackReport({ isCrit: true }), 20);
    assert.equal(critical.degreeOfSuccess.fromRoll, 5);

    const fumble = recalculateAttackReport(attackReport({ isFumble: true }), 18);
    assert.equal(fumble.succeeded, false);
    assert.equal(fumble.degreeOfSuccess.fromRoll, -1);
});

test("grazing hit penalty is recalculated from selected maneuvers", () => {
    const result = recalculateAttackReport(attackReport({ maneuvers: [{}, {}] }), 24);
    assert.equal(result.grazingHitPenalty, 4);
    assert.equal(totalDegreesOfSuccess(result), 0);
});

test("health damage totals include consumed, exhausted, and channeled costs", () => {
    assert.equal(healthCostTotal({
        consumed: { value: "5" },
        exhausted: { value: 3 },
        channeled: { value: 2 },
    }), 10);
    assert.equal(healthCostTotal({ consumed: { value: -4 } }), 0);
    assert.equal(healthCostTotal(undefined), 0);
});

test("confirmed zero damage uses different feedback from applied damage", () => {
    assert.equal(healthCostFeedbackKind(4, 7, true), "damage");
    assert.equal(healthCostFeedbackKind(4, 4, true), "damageBlocked");
    assert.equal(healthCostFeedbackKind(4, 4, false), null);
    assert.equal(healthCostFeedbackKind(4, 2, true), null);
});

test("legacy tick movement is consumed only after initiative actually advances", () => {
    assert.equal(tickAdvanceConfirmed(9, 12), true);
    assert.equal(tickAdvanceConfirmed(9, 9), false);
    assert.equal(tickAdvanceConfirmed(9, undefined), false);
});

test("combat tick references cover every fixed action duration", () => {
    for (const ticks of [2, 3, 4, 5, 6, 7, 8, 10]) {
        assert.ok(combatTickActionsFor(ticks).length > 0, `missing reference for ${ticks} ticks`);
    }
    assert.equal(combatTickActionsFor(1).length, 0);
    assert.ok(combatTickActionsFor(10).some((action) => action.id === "coordinate"));
});

test("aiming and searching for an opening appear at 2, 4, and 6 ticks", () => {
    for (const ticks of [2, 4, 6]) {
        const ids = combatTickActionsFor(ticks).map((action) => action.id);
        assert.ok(ids.includes("aim"));
        assert.ok(ids.includes("searchOpening"));
    }
});

test("the custom tick reference includes fixed, variable, free, and unavailable actions", () => {
    const ids = combatTickActionsFor("custom").map((action) => action.id);
    for (const id of ["dropItem", "meleeAttack", "focusMagic", "complexTask", "coordinate"]) {
        assert.ok(ids.includes(id));
    }
});

test("only ranged attacks use the persistent prepared-attack state", () => {
    assert.deepEqual(attackReadiness(false, "melee", null), { ready: true, prepared: false });
    assert.deepEqual(attackReadiness(false, "melee", "melee"), { ready: true, prepared: false });
    assert.deepEqual(attackReadiness(true, "bow", null), { ready: false, prepared: false });
    assert.deepEqual(attackReadiness(true, "bow", "bow"), { ready: true, prepared: true });
    assert.deepEqual(attackReadiness(true, "bow", "crossbow"), { ready: false, prepared: false });
});

test("preparing attacks and spells does not require a target until execution", () => {
    assert.equal(actionRequiresTarget(false), false);
    assert.equal(actionRequiresTarget(false, true), false);
    assert.equal(actionRequiresTarget(true, false), false);
    assert.equal(actionRequiresTarget(true, true), true);
});

test("token focus uses the center between the tick bar and HUD", () => {
    assert.equal(visibleCanvasCenterY(800, 140, 560), 350);
    assert.equal(visibleCanvasCenterY(800, null, 560), 280);
    assert.equal(visibleCanvasCenterY(800, 140, null), 470);
    assert.equal(visibleCanvasCenterY(800, 600, 500), 400);
});

test("attack controls expose a sole attack or an explicit default directly", () => {
    assert.deepEqual(attackControlState(["sword"], null, 0), {
        defaultAttackId: "sword",
        automaticDefaultAttackId: "sword",
        directAttackId: "sword",
        showMenu: false,
    });
    assert.deepEqual(attackControlState(["sword"], null, 1), {
        defaultAttackId: "sword",
        automaticDefaultAttackId: "sword",
        directAttackId: "sword",
        showMenu: true,
    });
    assert.deepEqual(attackControlState(["sword", "bow"], "bow", 2), {
        defaultAttackId: "bow",
        automaticDefaultAttackId: null,
        directAttackId: "bow",
        showMenu: true,
    });
    assert.deepEqual(attackControlState(["sword", "bow"], "missing", 0), {
        defaultAttackId: null,
        automaticDefaultAttackId: null,
        directAttackId: null,
        showMenu: true,
    });
});

test("a prepared ranged attack takes priority over the default attack", () => {
    assert.deepEqual(attackControlSelection("bow", "sword"), { attackId: "bow", mode: "prepared" });
    assert.deepEqual(attackControlSelection(null, "sword"), { attackId: "sword", mode: "default" });
    assert.deepEqual(attackControlSelection(null, null), { attackId: null, mode: "menu" });
});

test("skill favorites are normalized, removable, and limited to four", () => {
    assert.deepEqual(normalizeFavoriteSkillIds(["stealth", "stale", "stealth", "athletics"], ["stealth", "athletics"]), [
        "stealth",
        "athletics",
    ]);
    assert.deepEqual(toggleFavoriteSkillId(["stealth"], "stealth", ["stealth", "athletics"]), {
        ids: [],
        changed: true,
        added: false,
        limitReached: false,
    });
    assert.deepEqual(toggleFavoriteSkillId(["a", "b", "c", "d"], "e", ["a", "b", "c", "d", "e"]), {
        ids: ["a", "b", "c", "d"],
        changed: false,
        added: false,
        limitReached: true,
    });
});

test("skill favorites can be reordered before or after another favorite", () => {
    assert.deepEqual(reorderFavoriteSkillIds(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]);
    assert.deepEqual(reorderFavoriteSkillIds(["a", "b", "c", "d"], "a", "c", true), ["b", "c", "a", "d"]);
    assert.deepEqual(reorderFavoriteSkillIds(["a", "b"], "missing", "b"), ["a", "b"]);
});

test("personal HUD controls use the selected owned token or the only owned combatant", () => {
    const first = { id: "first", tokenId: "token-a", tokenUuid: "Scene.scene.Token.token-a", owned: true };
    const second = { id: "second", tokenId: "token-b", tokenUuid: "Scene.scene.Token.token-b", owned: true };
    const foreign = { id: "foreign", tokenId: "token-c", tokenUuid: "Scene.scene.Token.token-c", owned: false };

    assert.equal(selectPersonalCombatant([first, second, foreign], second.tokenUuid), second);
    assert.equal(selectPersonalCombatant([first, second, foreign], first.tokenId), first);
    assert.equal(selectPersonalCombatant([first, second, foreign]), null);
    assert.equal(selectPersonalCombatant([first, second, foreign], null, second.id), second);
    assert.equal(selectPersonalCombatant([first, second, foreign], first.tokenId, second.id), first);
    assert.equal(selectPersonalCombatant([first, foreign]), first);
    assert.equal(selectPersonalCombatant([first, second, foreign], foreign.tokenUuid), null);
});

test("Defensiv is found in serialized feature lists", () => {
    assert.equal(findDefensiveFeatureValue({
        itemFeatures: { internalFeatureList: [{ name: "Defensiv", value: 2 }] },
    }), 2);
});

test("token mapping prefers exact token or actor matches", () => {
    const combatant = {
        token: { uuid: "Scene.s1.Token.t1" },
        actor: { uuid: "Actor.a1", id: "a1" },
    };
    assert.equal(linkMatchesCombatant({ tokenUuid: "Scene.s1.Token.t1" }, combatant), true);
    assert.equal(linkMatchesCombatant({ actorUuid: "Actor.a1" }, combatant), true);
    assert.equal(linkMatchesCombatant({ actorId: "other" }, combatant), false);
    assert.equal(linkMatchesCombatant({ tokenUuid: "Scene.s1.Token.t2", actorUuid: "Actor.a1" }, combatant), false);
});

test("target candidates retain different tokens that share the same name", () => {
    const first = { uuid: "Scene.scene.Token.first", id: "first", name: "Farruk" };
    const second = { uuid: "Scene.scene.Token.second", id: "second", name: "Farruk" };
    assert.deepEqual(
        uniqueTokensByReference([first, second, first]).map((token) => token.uuid),
        [first.uuid, second.uuid]
    );
});

test("legacy single-token mappings are normalized to multiple-token lists", () => {
    const normalized = normalizeUserTokenLinks({
        user1: { tokenUuid: "Scene.s1.Token.t1", label: "Farruk" },
        user2: [
            { tokenUuid: "Scene.s1.Token.t2", label: "Stavi" },
            { actorUuid: "Actor.a3", label: "Yi Mao" },
        ],
        empty: null,
    });

    assert.deepEqual(normalized.user1, [{ tokenUuid: "Scene.s1.Token.t1", label: "Farruk" }]);
    assert.equal(normalized.user2.length, 2);
    assert.deepEqual(normalized.empty, []);
});

test("a token can only be assigned once and explicit players win over the fallback GM", () => {
    const normalized = normalizeUserTokenLinks({
        gm: [
            { tokenUuid: "Scene.s1.Token.t1", label: "Farruk" },
            { tokenUuid: "Scene.s1.Token.t2", label: "Stavi" },
        ],
        player: [{ tokenUuid: "Scene.s1.Token.t1", label: "Farruk" }],
    }, "gm");

    assert.deepEqual(normalized.player.map((link) => link.tokenUuid), ["Scene.s1.Token.t1"]);
    assert.deepEqual(normalized.gm.map((link) => link.tokenUuid), ["Scene.s1.Token.t2"]);
});

test("saving one set of token assignments preserves tokens outside the managed set", () => {
    const merged = replaceManagedUserTokenLinks({
        player: [
            { tokenUuid: "Scene.current.Token.old", label: "Old current token" },
            { tokenUuid: "Scene.other.Token.keep", label: "Other scene" },
            { actorUuid: "Actor.legacy", label: "Legacy sheet mapping" },
        ],
        gm: [],
    }, new Set(["Scene.current.Token.old", "Scene.current.Token.new"]), {
        player: [],
        gm: [{ tokenUuid: "Scene.current.Token.new", label: "New current token" }],
    }, "gm");

    assert.deepEqual(merged.player, [
        { tokenUuid: "Scene.other.Token.keep", label: "Other scene" },
        { actorUuid: "Actor.legacy", label: "Legacy sheet mapping" },
    ]);
    assert.deepEqual(merged.gm, [{ tokenUuid: "Scene.current.Token.new", label: "New current token" }]);
});

test("a deleted duplicate token link is redundant only for the same scene, sheet, and effective user", () => {
    const link = {
        tokenUuid: "Scene.scene1.Token.deleted",
        actorUuid: "Actor.hero",
    };
    const survivingToken = {
        uuid: "Scene.scene1.Token.surviving",
        sceneId: "scene1",
        actorUuid: "Actor.hero",
        effectiveUserId: "player1",
    };

    assert.equal(isRedundantDeletedTokenLink("player1", link, [survivingToken]), true);
    assert.equal(isRedundantDeletedTokenLink("player2", link, [survivingToken]), false);
    assert.equal(isRedundantDeletedTokenLink("player1", link, [{ ...survivingToken, sceneId: "scene2" }]), false);
    assert.equal(isRedundantDeletedTokenLink("player1", link, [{ ...survivingToken, actorUuid: "Actor.other" }]), false);
    assert.equal(isRedundantDeletedTokenLink("player1", { ...link, tokenUuid: "invalid" }, [survivingToken]), false);
});

test("a deleted token link is redundant when its sheet already has the same user assignment", () => {
    assert.equal(isRedundantDeletedTokenLink("player1", {
        tokenUuid: "Scene.deletedScene.Token.deleted",
        actorUuid: "Scene.deletedScene.Token.deleted.Actor.hero",
    }, [], {
        "Actor.hero": "player1",
    }), true);
    assert.equal(isRedundantDeletedTokenLink("player2", {
        tokenUuid: "Scene.deletedScene.Token.deleted",
        actorUuid: "Actor.hero",
    }, [], {
        "Actor.hero": "player1",
    }), false);
});

test("deleted duplicate detection supports stored actor ids from older assignments", () => {
    assert.equal(isRedundantDeletedTokenLink("player1", {
        tokenUuid: "Scene.scene1.Token.deleted",
        actorId: "hero",
    }, [{
        uuid: "Scene.scene1.Token.surviving",
        sceneId: "scene1",
        actorUuid: "Actor.hero",
        effectiveUserId: "player1",
    }]), true);
});

test("actor assignments keep exactly one user per character or NPC sheet", () => {
    assert.deepEqual(normalizeActorUserLinks({
        "Actor.hero": "player1",
        "Actor.npc": "player2",
        "Actor.unassigned": "",
        invalid: null,
    }), {
        "Actor.hero": "player1",
        "Actor.npc": "player2",
    });
    assert.deepEqual(normalizeActorUserLinks([]), {});
});

test("unlinked synthetic tokens resolve to their stable source sheet UUID", () => {
    assert.equal(actorLinkUuid("Actor.hero", "hero"), "Actor.hero");
    assert.equal(actorLinkUuid("Scene.scene.Token.token.Actor.hero", "hero"), "Actor.hero");
    assert.equal(actorLinkUuid("Scene.scene.Token.token.Actor.hero"), "Actor.hero");
});

test("sheet search is case- and accent-insensitive", () => {
    assert.equal(normalizeSearchText("  Äijagar  "), "aijagar");
    assert.equal(normalizeSearchText("GRAULWURM"), "graulwurm");
});

test("health and focus require observer permission unless the viewer is a GM", () => {
    assert.equal(mayViewActorResources(false, false), false);
    assert.equal(mayViewActorResources(false, true), true);
    assert.equal(mayViewActorResources(true, false), true);
});

test("target defenses stay private by default and can be revealed by the world option", () => {
    assert.equal(mayViewTargetDefenses(false, false, false), false);
    assert.equal(mayViewTargetDefenses(false, false, true), true);
    assert.equal(mayViewTargetDefenses(false, true, false), true);
    assert.equal(mayViewTargetDefenses(true, false, false), true);
});

test("players never receive hidden combatants as their current HUD actor", () => {
    assert.equal(isCombatantVisibleToUser(false, false), true);
    assert.equal(isCombatantVisibleToUser(false, true), false);
    assert.equal(isCombatantVisibleToUser(false, false, true), false);
    assert.equal(isCombatantVisibleToUser(true, true), true);
    assert.equal(isCombatantVisibleToUser(true, true, true), true);
});

test("multi-target references are stable and de-duplicated", () => {
    assert.deepEqual(normalizeTargetReferences([
        { document: { uuid: "Scene.s.Token.a" } },
        { uuid: "Scene.s.Token.b" },
        "Scene.s.Token.a",
        null,
    ]), ["Scene.s.Token.a", "Scene.s.Token.b"]);
});

test("target-dependent difficulties require observer permission unless the viewer is a GM", () => {
    assert.equal(mayViewTargetDifficulty(true, false, false), false);
    assert.equal(mayViewTargetDifficulty(true, false, true), true);
    assert.equal(mayViewTargetDifficulty(true, true, false), true);
    assert.equal(mayViewTargetDifficulty(false, false, false), true);
});

test("remote chat actions match Splittermond's owner, author, and GM permissions", () => {
    assert.equal(mayUseRemoteChatActions(false, false, false), false);
    assert.equal(mayUseRemoteChatActions(false, true, false), true);
    assert.equal(mayUseRemoteChatActions(false, false, true), true);
    assert.equal(mayUseRemoteChatActions(false, false, false, true), true);
    assert.equal(mayUseRemoteChatActions(true, false, false), true);
});

test("the assigned user receives the turn highlight, including an assigned GM", () => {
    assert.equal(isPlayersTurn({ userId: "player", linkedUserId: "player" }), true);
    assert.equal(isPlayersTurn({ userId: "player", linkedUserId: "other", ownsActor: true }), false);
    assert.equal(isPlayersTurn({ userId: "player", ownsActor: true }), true);
    assert.equal(isPlayersTurn({ isGm: true, userId: "gm", linkedUserId: "gm" }), true);
    assert.equal(isPlayersTurn({ isGm: true, userId: "gm", linkedUserId: "player", ownsActor: true }), false);
    assert.equal(isPlayersTurn({ isGm: true, userId: "gm", ownsActor: true }), false);
});

test("roll management permissions cover EG, focus, ticks, and splinter points", () => {
    assert.equal(requiresRollManagementPermission("anyDegreeOption", true), true);
    assert.equal(requiresRollManagementPermission("consumeCosts"), true);
    assert.equal(requiresRollManagementPermission("advanceToken"), true);
    assert.equal(requiresRollManagementPermission("addTick"), true);
    assert.equal(requiresRollManagementPermission("useSplinterpoint"), true);
    assert.equal(requiresRollManagementPermission("activeDefense"), false);
    assert.equal(requiresRollManagementPermission("applyDamage"), false);
});

test("damage selection is owner-only while damage application remains available to its recipient", () => {
    assert.equal(isDamageSelectionAction("applyDamage"), true);
    assert.equal(isDamageSelectionAction("damageUpdate"), true);
    assert.equal(isDamageSelectionAction("applyDamageToSelf"), false);
    assert.equal(isDamageSelectionAction("applyDamageToUserTargets"), false);
});

test("Splittermond check updates are detected for flat and nested Foundry changes", () => {
    assert.equal(hasSplittermondCheckUpdate({ "flags.splittermond.check": { succeeded: true } }), true);
    assert.equal(hasSplittermondCheckUpdate({ "flags.splittermond.check.succeeded": true }), true);
    assert.equal(hasSplittermondCheckUpdate({ flags: { splittermond: { check: { succeeded: true } } } }), true);
    assert.equal(hasSplittermondCheckUpdate({ flags: { "splittermond.check": { succeeded: true } } }), true);
    assert.equal(hasSplittermondCheckUpdate({ flags: { "splittermond-smoother-fight": { context: {} } } }), false);
    assert.equal(hasSplittermondCheckUpdate({ content: "updated card" }), false);
});

test("token movement and size changes trigger a Defender distance refresh", () => {
    assert.equal(hasTokenPositionUpdate({ x: 120 }), true);
    assert.equal(hasTokenPositionUpdate({ y: 240, elevation: 1 }), true);
    assert.equal(hasTokenPositionUpdate({ width: 2, height: 2 }), true);
    assert.equal(hasTokenPositionUpdate({ hidden: false }), false);
    assert.equal(hasTokenPositionUpdate({ rotation: 90 }), false);
});

test("Defender distance uses current token document coordinates before a stale canvas center", () => {
    assert.deepEqual(tokenDocumentCenter({
        document: { x: 200, y: 300, width: 2, height: 1 },
        center: { x: 50, y: 50 },
    }, 100), { x: 300, y: 350 });
    assert.deepEqual(tokenDocumentCenter({ x: 0, y: 0 }, 70), { x: 35, y: 35 });
    assert.equal(tokenDocumentCenter({ x: null, y: 10 }, 100), null);
});

test("a new combat event closes older cards and opens only the newest event", () => {
    assert.deepEqual(
        [...resolveCombatEventOpenIds(["attack-1"], ["attack-1"], ["attack-1", "spell-2"])],
        ["spell-2"]
    );
    assert.deepEqual(
        [...resolveCombatEventOpenIds(["attack-1", "spell-2"], ["attack-1"], ["attack-1", "spell-2"])],
        ["attack-1"]
    );
});

test("all events close when the latest event does not belong to the active combatant", () => {
    const turn = {
        previousCombatantId: "combatant-1",
        currentCombatantId: "combatant-2",
        currentActorId: "actor-2",
        eventCombatantIds: new Map([
            ["attack-old", "combatant-3"],
            ["attack-current", "combatant-1"],
        ]),
    };
    assert.deepEqual(
        [...resolveCombatEventOpenIds(
            ["attack-old", "attack-current"],
            ["attack-old", "attack-current"],
            ["attack-old", "attack-current"],
            turn
        )],
        []
    );
    assert.deepEqual(
        [...resolveCombatEventOpenIds(
            ["attack-old"],
            ["attack-old"],
            ["attack-old", "attack-next"],
            { ...turn, eventCombatantIds: new Map([["attack-next", "combatant-2"]]) }
        )],
        ["attack-next"]
    );
});

test("deleting a combat event opens only the newest remaining event of the active actor", () => {
    const previous = ["attack-old", "attack-current", "attack-deleted"];
    const current = ["attack-old", "attack-current"];
    assert.deepEqual(
        [...resolveCombatEventOpenIds(previous, ["attack-old", "attack-deleted"], current, {
            currentCombatantId: "combatant-2",
            currentActorId: "actor-2",
            eventCombatantIds: new Map([
                ["attack-old", "combatant-1"],
                ["attack-current", "combatant-2"],
            ]),
        })],
        ["attack-current"]
    );
});

test("deleting the current event leaves older actors' events collapsed", () => {
    assert.deepEqual(
        [...resolveCombatEventOpenIds(
            ["attack-old", "attack-deleted"],
            ["attack-deleted"],
            ["attack-old"],
            {
                currentCombatantId: "combatant-2",
                currentActorId: "actor-2",
                eventCombatantIds: new Map([["attack-old", "combatant-1"]]),
                eventActorIds: new Map([["attack-old", "actor-1"]]),
            }
        )],
        []
    );
});

test("deleting an associated message reselects the newest event even when event IDs stay unchanged", () => {
    assert.deepEqual(
        [...resolveCombatEventOpenIds(
            ["attack-old", "attack-current"],
            ["attack-old"],
            ["attack-old", "attack-current"],
            {
                forceLatestEvent: true,
                currentCombatantId: "combatant-2",
                eventCombatantIds: new Map([
                    ["attack-old", "combatant-1"],
                    ["attack-current", "combatant-2"],
                ]),
            }
        )],
        ["attack-current"]
    );
});

test("a Defender subevent closes with the defender's completed turn", () => {
    assert.deepEqual(
        [...resolveCombatEventOpenIds(
            ["attack"],
            ["attack"],
            ["attack"],
            {
                previousCombatantId: "defender-combatant",
                currentCombatantId: "next-combatant",
                previousActorId: "defender-actor",
                currentActorId: "next-actor",
                eventCombatantIds: new Map([["attack", "attacker-combatant"]]),
                eventActorIds: new Map([["attack", "defender-actor"]]),
            }
        )],
        []
    );
});

test("a Defender result keeps the current attacker's event open", () => {
    assert.deepEqual(
        [...resolveCombatEventOpenIds(
            ["attack"],
            ["attack"],
            ["attack"],
            {
                currentCombatantId: "attacker-combatant",
                currentActorId: "attacker-actor",
                eventCombatantIds: new Map([["attack", "attacker-combatant"]]),
                eventActorIds: new Map([["attack", "attacker-actor"]]),
            }
        )],
        ["attack"]
    );
});

test("temporary system targets are restored after applying linked-target damage", async () => {
    const targets = new Set(["original"]);
    await withTemporarySetValues(targets, ["linked"], async () => {
        assert.deepEqual([...targets], ["linked"]);
    });
    assert.deepEqual([...targets], ["original"]);

    await assert.rejects(withTemporarySetValues(targets, ["linked"], async () => {
        throw new Error("damage failed");
    }));
    assert.deepEqual([...targets], ["original"]);
});

test("attack, spell, and damage chat messages are classified as combat events", () => {
    assert.equal(combatMessageKind({ type: "attackRollMessage" }), "attack");
    assert.equal(combatMessageKind({ type: "spellRollMessage" }), "spell");
    assert.equal(combatMessageKind({ system: { constructor: { name: "SpellRollMessage" } } }), "spell");
    assert.equal(combatMessageKind({ type: "damageMessage" }), "damage");
    assert.equal(combatMessageKind({ type: "simple" }), null);
});

test("attacks and spells can be recalculated after active defense", () => {
    assert.equal(isOffensiveCombatMessage({ type: "attackRollMessage" }), true);
    assert.equal(isOffensiveCombatMessage({ type: "spellRollMessage" }), true);
    assert.equal(isOffensiveCombatMessage({ type: "damageMessage" }), false);
});

test("status effect labels split the condition name from its level", () => {
    assert.deepEqual(parseStatusEffectLabel("Erschöpft 2"), { name: "Erschöpft", level: 2 });
    assert.deepEqual(parseStatusEffectLabel("Angsterfüllt"), { name: "Angsterfüllt", level: 1 });
});

test("fumble health loss uses Splittermond's fully consumed cost notation", () => {
    assert.equal(fullyConsumedCost(6), "6V6");
    assert.equal(fullyConsumedCost(0), "0");
});
