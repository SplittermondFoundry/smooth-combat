import test from "node:test";
import assert from "node:assert/strict";
import {
    actorLinkUuid,
    calculateActiveDefenseValue,
    combatMessageKind,
    findDefensiveFeatureValue,
    fullyConsumedCost,
    linkMatchesCombatant,
    normalizeActorUserLinks,
    normalizeSearchText,
    normalizeUserTokenLinks,
    parseStatusEffectLabel,
    recalculateAttackReport,
    totalDegreesOfSuccess,
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

test("attack, spell, and damage chat messages are classified as combat events", () => {
    assert.equal(combatMessageKind({ type: "attackRollMessage" }), "attack");
    assert.equal(combatMessageKind({ type: "spellRollMessage" }), "spell");
    assert.equal(combatMessageKind({ system: { constructor: { name: "SpellRollMessage" } } }), "spell");
    assert.equal(combatMessageKind({ type: "damageMessage" }), "damage");
    assert.equal(combatMessageKind({ type: "simple" }), null);
});

test("status effect labels split the condition name from its level", () => {
    assert.deepEqual(parseStatusEffectLabel("Erschöpft 2"), { name: "Erschöpft", level: 2 });
    assert.deepEqual(parseStatusEffectLabel("Angsterfüllt"), { name: "Angsterfüllt", level: 1 });
});

test("fumble health loss uses Splittermond's fully consumed cost notation", () => {
    assert.equal(fullyConsumedCost(6), "6V6");
    assert.equal(fullyConsumedCost(0), "0");
});
