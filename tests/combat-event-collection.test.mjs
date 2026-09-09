import assert from "node:assert/strict";
import test from "node:test";
import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import { collectCombatEventPresentation, getBlockingCombatWorkflow, prepareCombatEventContext } from "../Modul/splittermond-smoother-fight/scripts/features/combat-events/service.js";
import { getPendingActiveDefense } from "../Modul/splittermond-smoother-fight/scripts/features/combat-events/view.js";

function fixture(t, messages, maxCards = messages.length) {
    const previousGame = globalThis.game;
    let contextReads = 0;
    const mocks = {
        getMessageContext: (message) => { contextReads++; return message?.context ?? null; },
        isDiceAnimationPending: () => false,
        isSpellMessage: () => false,
        isDamageMessage: (message) => message?.type === "damageMessage",
        isDefenseMessage: (message) => message?.type === "defenseMessage",
        isFumbleTableMessage: (message) => message?.type === "fumbleMessage",
        getFumbleData: (message) => message?.fumble,
        hasPendingFumbleActions: () => false,
        defenseAwaitsResponse: () => false,
        getDamageApplicationState: () => "completed",
        getRunningActiveDefense: () => null,
        isContinuousActionInterruptionPending: (message) => Boolean(message?.interruption),
        getContinuousActionInterruptionCard: (message) => message.interruption,
    };
    const previousServices = Object.fromEntries(Object.keys(mocks).map((key) => [key, services[key]]));
    Object.assign(services, mocks);
    const combat = { id: "combat", combatants: [{ actorId: "attacker" }] };
    globalThis.game = { combat, messages: { contents: messages }, settings: { get: () => maxCards } };
    t.after(() => { globalThis.game = previousGame; Object.assign(services, previousServices); });
    return { combat, collect: () => collectCombatEventPresentation({ combat }), reads: () => contextReads };
}

function attack(id, timestamp, context = {}) {
    return { id, timestamp, type: "attackRollMessage", speaker: { actor: "attacker" },
        context: { combatId: "combat", ...context } };
}

test("collecting a long combat keeps explicit defense links with bounded context reads", (t) => {
    const count = 200;
    const messages = Array.from({ length: count }, (_, i) => [
        attack(`attack-${i}`, i * 2, { defenseMessageIds: [`defense-${i}`] }),
        { id: `defense-${i}`, timestamp: i * 2 + 1, type: "defenseMessage",
            context: { attackMessageId: `attack-${i}` } },
    ]).flat();
    const harness = fixture(t, messages);
    const { groups } = harness.collect();
    assert.equal(groups.length, count);
    for (const [i, group] of groups.entries()) assert.equal(group.defenses[0]?.id, `defense-${i}`);
    t.diagnostic(`200 attacks + 200 defenses: ${harness.reads()} context reads`);
    assert.ok(harness.reads() < count * 25, "message association must not rescan every attack for each defense");
});

test("recalculated defense links win over the original attack and carry fumbles and interruptions", (t) => {
    const messages = [
        attack("original", 1, { defenseMessageId: "defense" }),
        { id: "defense", timestamp: 2, type: "defenseMessage", context: { attackMessageId: "original" } },
        attack("recalculated", 3, { defenseMessageIds: ["defense"], recalculatedFrom: "original" }),
        { id: "fumble", timestamp: 4, type: "fumbleMessage", fumble: { sourceMessageId: "defense", kind: "fight" } },
        { id: "determination", timestamp: 5, interruption: { combatId: "combat", sourceMessageId: "fumble" } },
    ];
    const { groups } = fixture(t, messages).collect();
    assert.equal(groups.find((group) => group.primary.id === "original").defenses.length, 0);
    const recalculated = groups.find((group) => group.primary.id === "recalculated");
    assert.deepEqual(recalculated.defenses.map((message) => message.id), ["defense"]);
    assert.deepEqual(recalculated.fumbles.map((message) => message.id), ["fumble"]);
    assert.deepEqual(recalculated.interruptions.map((message) => message.id), ["determination"]);
});

test("legacy links, hidden messages and old pending interruptions retain their behavior", (t) => {
    const messages = [
        attack("old", 1),
        { id: "damage", timestamp: 2, type: "damageMessage", speaker: { actor: "attacker" } },
        { id: "pending", timestamp: 3, interruption: { combatId: "combat", sourceMessageId: "damage" } },
        attack("new", 4),
        { ...attack("hidden", 5), visible: false },
        { id: "legacy-defense", timestamp: 6, type: "defenseMessage" },
        { id: "unrelated", timestamp: 7, interruption: { combatId: "other-combat", sourceMessageId: "damage" } },
        { id: "standalone", timestamp: 8, interruption: { combatId: "combat", sourceMessageId: "deleted" } },
    ];
    const { groups } = fixture(t, messages, 1).collect();
    const old = groups.find((group) => group.primary.id === "old");
    assert.equal(old.interruptions[0]?.id, "pending", "old pending work survives the display limit");
    assert.equal(groups.some((group) => group.primary.id === "hidden"), false);
    assert.equal(groups.some((group) => group.primary.id === "standalone"), true);
    assert.equal(groups.some((group) => group.interruptions.some((message) => message.id === "unrelated")), false);
});

test("one render shares its event collection while subsequent renders see changed messages", (t) => {
    const messages = Array.from({ length: 200 }, (_, i) => attack(`attack-${i}`, i));
    const harness = fixture(t, messages, 3);
    const context = prepareCombatEventContext({ combat: harness.combat });
    const readsAfterCollection = harness.reads();
    assert.equal(getBlockingCombatWorkflow(context), null);
    assert.equal(getPendingActiveDefense(context), null);
    assert.equal(harness.reads(), readsAfterCollection + 1, "defense and tick controls reuse the same collection");
    assert.equal(Object.hasOwn(harness.combat, "combatEventPresentation"), false);
    messages.push(attack("new", 500));
    const next = prepareCombatEventContext({ combat: harness.combat });
    assert.notEqual(next.combatEventPresentation, context.combatEventPresentation);
    assert.equal(next.combatEventPresentation.groups.at(-1).primary.id, "new");
    messages.at(-1).visible = false;
    const hidden = prepareCombatEventContext({ combat: harness.combat });
    assert.equal(hidden.combatEventPresentation.groups.at(-1).primary.id, "attack-199");
});
