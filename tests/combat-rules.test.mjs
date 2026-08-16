import test from "node:test";
import assert from "node:assert/strict";
import {
    activeDefenseChangesDifficulty,
    actorLinkUuid,
    bestActiveDefenseValue,
    calculateActiveDefenseValue,
    combatMessageKind,
    findDefensiveFeatureValue,
    fullyConsumedCost,
    hasSplittermondCheckUpdate,
    isCombatantVisibleToUser,
    isDamageSelectionAction,
    isDefenderMasteryName,
    isPlayersTurn,
    isTargetDependentDifficulty,
    isOffensiveCombatMessage,
    linkMatchesCombatant,
    mayUseRemoteChatActions,
    mayViewActorResources,
    mayViewTargetDefenses,
    mayViewTargetDifficulty,
    mergeActiveDefenseCheck,
    normalizeActorUserLinks,
    normalizeSearchText,
    normalizeTargetReferences,
    normalizeUserTokenLinks,
    parseActiveDefenseDescription,
    parseStatusEffectLabel,
    recalculateAttackReport,
    requiresRollManagementPermission,
    resolveCombatEventOpenIds,
    totalDegreesOfSuccess,
    uniqueTokensByReference,
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
    assert.equal(isCombatantVisibleToUser(true, true), true);
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
    assert.equal(mayUseRemoteChatActions(true, false, false), true);
});

test("the active player is identified without highlighting the GM or other owners", () => {
    assert.equal(isPlayersTurn({ userId: "player", linkedUserId: "player" }), true);
    assert.equal(isPlayersTurn({ userId: "player", linkedUserId: "other", ownsActor: true }), false);
    assert.equal(isPlayersTurn({ userId: "player", ownsActor: true }), true);
    assert.equal(isPlayersTurn({ isGm: true, userId: "gm", linkedUserId: "gm" }), false);
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
