import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    beginActiveDefense,
    claimPendingDefenseForMessage,
    processDefenseMessage,
} from "../Modul/splittermond-smoother-fight/scripts/features/active-defense/active-defense.js";
import { activeDefenseState } from "../Modul/splittermond-smoother-fight/scripts/features/active-defense/state.js";
import { setRequiredFlag } from "../Modul/splittermond-smoother-fight/scripts/features/chat/messages.js";

const MODULE_ID = "splittermond-smoother-fight";
const harness = {
    checks: new Map(),
    messages: new Map(),
    tokens: new Map(),
    nextMessageId: 1,
    rejectSetFlag: null,
};

function clone(value) {
    return structuredClone(value);
}

class TestMessage {
    constructor(source) {
        this.id = source._id ?? `successor-${harness.nextMessageId++}`;
        this.type = source.type ?? "base";
        this.user = source.user ?? "gm";
        this.author = source.author ?? { id: this.user };
        this.speaker = clone(source.speaker ?? {});
        this.content = source.content ?? "";
        this.flags = clone(source.flags ?? {});
        this._systemSource = clone(source.system ?? {});
        this.setFlagCalls = 0;
        this.refreshSystem();
    }

    refreshSystem() {
        const data = this._systemSource;
        this.system = {
            ...data,
            template: data.template ?? "attack-card.hbs",
            getData: () => clone(data),
            toObject: () => clone(data),
        };
    }

    async setFlag(scope, key, value) {
        this.setFlagCalls += 1;
        await Promise.resolve();
        if (harness.rejectSetFlag?.({ message: this, scope, key, value })) {
            throw new Error(`Injected setFlag rejection for ${this.id}.${key}`);
        }
        this.flags[scope] ??= {};
        this.flags[scope][key] = clone(value);
        return this;
    }

    async update(changes) {
        await Promise.resolve();
        if (Object.hasOwn(changes, "content")) this.content = changes.content;
        const contextPath = `flags.${MODULE_ID}.context`;
        if (Object.hasOwn(changes, contextPath)) {
            this.flags[MODULE_ID] ??= {};
            this.flags[MODULE_ID].context = clone(changes[contextPath]);
        }
        return this;
    }

    async delete() {
        harness.messages.delete(this.id);
        return this;
    }

    toObject() {
        return {
            _id: this.id,
            type: this.type,
            user: this.user,
            speaker: clone(this.speaker),
            content: this.content,
            flags: clone(this.flags),
            system: clone(this._systemSource),
        };
    }
}

class FakeFragment {
    constructor(html = "") {
        this.html = html;
        this.textContent = html.replaceAll(/<[^>]*>/gu, " ").replaceAll(/\s+/gu, " ").trim();
    }

    querySelectorAll(selector) {
        if (selector !== ".sf-chat-recalculated") return [];
        return this.html.includes("sf-chat-recalculated")
            ? [{ remove: () => {
                this.html = this.html.replaceAll(/<div class="sf-chat-recalculated[^"]*">[\s\S]*?<\/div>/gu, "");
            } }]
            : [];
    }

    cloneNode() {
        return new FakeFragment(this.html);
    }
}

function installGlobals() {
    globalThis.document = {
        createElement: (tag) => {
            if (tag === "template") {
                return {
                    content: new FakeFragment(),
                    set innerHTML(value) {
                        this.content = new FakeFragment(String(value ?? ""));
                    },
                };
            }
            return {
                innerHTML: "",
                append(fragment) {
                    this.innerHTML = fragment.html;
                },
            };
        },
    };
    globalThis.foundry = { utils: { deepClone: clone, randomID: () => `nonce-${Date.now()}` } };
    globalThis.CONFIG = { splittermond: {} };
    globalThis.canvas = { tokens: { controlled: [] } };
    globalThis.ui = { notifications: { info: () => {}, warn: () => {} } };
    globalThis.renderTemplate = async () => '<article class="splittermond check attack">Angriff</article>';
    globalThis.ChatMessage = {
        create: async (source) => {
            await new Promise((resolve) => setImmediate(resolve));
            const message = new TestMessage(source);
            harness.messages.set(message.id, message);
            return message;
        },
    };
    globalThis.game = {
        user: { id: "gm", isGM: true },
        users: [],
        messages: {
            get: (id) => harness.messages.get(id),
            get contents() { return Array.from(harness.messages.values()); },
        },
        settings: { get: () => true },
        i18n: {
            format: (_key, data) => `Neue Abwehr ${data?.defense ?? ""}`,
            localize: (key) => key.includes(".short") ? "VTD" : key,
        },
        combat: null,
    };
}

configureServices({
    checkResultMessage: (report) => report.succeeded ? "Erfolg" : "Fehlschlag",
    getDefenseCheck: (message) => harness.checks.get(message.id) ?? null,
    getHudContext: () => null,
    getMessageContext: (message) => message?.flags?.[MODULE_ID]?.context ?? null,
    isOwnMessage: (message) => (message.author?.id ?? message.user) === game.user.id,
    messageBelongsToCombatant: () => false,
    resolveSpeakerActor: (message) => ({ uuid: `Actor.${message.speaker?.actor ?? "unknown"}` }),
    resolveToken: (uuid) => harness.tokens.get(uuid) ?? null,
    setRequiredFlag,
    scheduleRender: () => {},
    setCombatEventExpansionRequest: () => {},
});

function resetHarness() {
    for (const timeoutId of activeDefenseState.pendingDefenseTimers.values()) clearTimeout(timeoutId);
    for (const cleanups of activeDefenseState.pendingDefenseCleanups.values()) {
        for (const cleanup of cleanups) cleanup();
    }
    activeDefenseState.pendingDefense = null;
    activeDefenseState.pendingDefenseTimers.clear();
    activeDefenseState.pendingDefenseCleanups.clear();
    activeDefenseState.rollingDefenses.clear();
    activeDefenseState.claimedDefenses.clear();
    activeDefenseState.processingDefenseMessages.clear();
    activeDefenseState.attackProcessingQueues.clear();
    harness.checks.clear();
    harness.messages.clear();
    harness.tokens.clear();
    harness.nextMessageId = 1;
    harness.rejectSetFlag = null;
    installGlobals();
}

function attackReport(overrides = {}) {
    return {
        difficulty: 20,
        succeeded: true,
        isCrit: false,
        isFumble: false,
        roll: { total: 30 },
        skill: { points: 8 },
        degreeOfSuccess: { fromRoll: 3, modification: 0 },
        maneuvers: [],
        hideDifficulty: false,
        ...overrides,
    };
}

function createAttack(id, report = attackReport(), context = {}) {
    const message = new TestMessage({
        _id: id,
        type: "attackRollMessage",
        content: '<article class="splittermond check attack">Ursprungsangriff</article>',
        flags: { [MODULE_ID]: { context: clone(context) } },
        system: { checkReport: report, openDegreesOfSuccess: 3, template: "attack-card.hbs" },
    });
    harness.messages.set(id, message);
    return message;
}

function createDefense(id, value, actorId) {
    const message = new TestMessage({
        _id: id,
        content: `VTD: ${value}`,
        speaker: { actor: actorId },
        author: { id: "gm" },
    });
    harness.messages.set(id, message);
    harness.checks.set(id, {
        type: "defense",
        defenseType: "defense",
        baseDefense: 20,
        succeeded: true,
        degreeOfSuccess: { fromRoll: value - 21, modification: 0 },
        itemData: { id: `defense-${actorId}`, itemFeatures: [] },
    });
    return message;
}

function pendingFor(attack, defense, index) {
    return {
        pendingDefenseId: `pending-${index}`,
        attackMessageId: attack.id,
        defenderActorUuid: `Actor.${defense.speaker.actor}`,
        assisted: false,
        startedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
    };
}

test("parallel defenses against one root attack form one complete canonical successor chain", async () => {
    resetHarness();
    const root = createAttack("attack-root");
    const lowerDefense = createDefense("defense-lower", 24, "defender-a");
    const higherDefense = createDefense("defense-higher", 27, "defender-b");

    await Promise.all([
        processDefenseMessage(higherDefense, pendingFor(root, higherDefense, 2)),
        processDefenseMessage(lowerDefense, pendingFor(root, lowerDefense, 1)),
    ]);

    const offenses = Array.from(harness.messages.values()).filter((message) => message.type === "attackRollMessage");
    assert.equal(offenses.length, 2, "the worse second defense does not recreate or overwrite the better successor");
    const childrenByParent = new Map();
    for (const offense of offenses) {
        const parentId = offense.flags[MODULE_ID]?.context?.recalculatedFrom;
        if (!parentId) continue;
        childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), offense]);
    }
    assert.ok([...childrenByParent.values()].every((children) => children.length === 1), "no attack card has competing successors");

    const chain = [];
    let current = root;
    while (current && !chain.includes(current)) {
        chain.push(current);
        current = harness.messages.get(current.flags[MODULE_ID]?.context?.supersededBy);
    }
    assert.equal(chain.length, offenses.length, "every recreated attack belongs to the one canonical chain");

    const leaf = chain.at(-1);
    const leafContext = leaf.flags[MODULE_ID].context;
    assert.equal(leafContext.supersededBy, null);
    assert.equal(leafContext.rootAttackMessageId, root.id);
    assert.equal(leafContext.defenseValue, 27);
    assert.deepEqual([...leafContext.defenseMessageIds].sort(), [lowerDefense.id, higherDefense.id].sort());
    assert.deepEqual([...leafContext.attemptedDefenseActorUuids].sort(), ["Actor.defender-a", "Actor.defender-b"].sort());
    assert.match(leaf.content, /<strong>27<\/strong>/u);
    assert.equal(lowerDefense.flags[MODULE_ID].context.resultingDefenseValue, 24);
    assert.equal(lowerDefense.flags[MODULE_ID].context.effectiveDefenseValue, 27);
    assert.equal(higherDefense.flags[MODULE_ID].context.resultingDefenseValue, 27);
});

test("a sequential duplicate defense exits before rewriting its persisted context", async () => {
    resetHarness();
    const root = createAttack("attack-duplicate");
    const defense = createDefense("defense-duplicate", 27, "defender-duplicate");
    const pending = pendingFor(root, defense, 1);

    await processDefenseMessage(defense, pending);
    const setFlagCallsAfterFirstPass = defense.setFlagCalls;
    const offensesAfterFirstPass = Array.from(harness.messages.values())
        .filter((message) => message.type === "attackRollMessage").length;
    harness.rejectSetFlag = ({ message, key }) => message.id === defense.id && key === "context";

    const duplicateResult = await processDefenseMessage(defense, pending);

    assert.ok(duplicateResult?.flags?.[MODULE_ID]?.context?.defenseMessageIds?.includes(defense.id));
    assert.equal(defense.setFlagCalls, setFlagCallsAfterFirstPass);
    assert.equal(
        Array.from(harness.messages.values()).filter((message) => message.type === "attackRollMessage").length,
        offensesAfterFirstPass
    );
});

test("an improved defense remains visible when the attack outcome does not change", async () => {
    resetHarness();
    const root = createAttack("attack-stable", attackReport({
        roll: { total: 22 },
        degreeOfSuccess: { fromRoll: 0, modification: 0 },
    }));
    const defense = createDefense("defense-visible", 21, "defender-visible");

    await processDefenseMessage(defense, pendingFor(root, defense, 1));

    const offenses = Array.from(harness.messages.values()).filter((message) => message.type === "attackRollMessage");
    assert.deepEqual(offenses.map((message) => message.id), [root.id]);
    assert.equal(root.flags[MODULE_ID].context.defenseValue, 21);
    assert.deepEqual(root.flags[MODULE_ID].context.defenseMessageIds, [defense.id]);
    assert.match(root.content, /sf-chat-recalculated/u);
    assert.match(root.content, /<strong>21<\/strong>/u);
});

test("a rejected supersededBy write removes the unlinked successor and rejects the defense workflow", async (t) => {
    resetHarness();
    t.mock.method(console, "error", () => {});
    const root = createAttack("attack-link-failure");
    const defense = createDefense("defense-link-failure", 27, "defender-link-failure");
    harness.rejectSetFlag = ({ message, key, value }) => Boolean(
        message.id === root.id && key === "context" && value?.supersededBy
    );

    await assert.rejects(
        processDefenseMessage(defense, pendingFor(root, defense, 1)),
        /Could not persist required context flag/u
    );

    assert.deepEqual(
        Array.from(harness.messages.values())
            .filter((message) => message.type === "attackRollMessage")
            .map((message) => message.id),
        [root.id],
        "the atomically-created successor is deleted when its required back-link cannot be persisted"
    );
    assert.equal(root.flags[MODULE_ID].context.supersededBy, undefined);
    assert.equal(activeDefenseState.attackProcessingQueues.size, 0);
});

test("dialog nonces isolate stale and cancelled active-defense workflows", async () => {
    resetHarness();
    const rolls = [];
    const makeActor = (id) => ({
        id,
        uuid: `Actor.${id}`,
        isOwner: true,
        activeDefenseDialog: async function () {
            const dialog = {
                actor: this,
                close() { return this; },
                rollDefense() {
                    this.actor.rollActiveDefense();
                    this.close();
                },
            };
            rolls.push(dialog);
            return dialog;
        },
        rollActiveDefense: () => new Promise(() => {}),
    });
    const actorA = makeActor("target-a");
    const actorB = makeActor("target-b");
    harness.tokens.set("Token.a", { uuid: "Token.a", name: "A", actor: actorA });
    harness.tokens.set("Token.b", { uuid: "Token.b", name: "B", actor: actorB });
    const attackA = createAttack("attack-a", attackReport(), { primaryTargetTokenUuid: "Token.a" });
    const attackB = createAttack("attack-b", attackReport(), { primaryTargetTokenUuid: "Token.b" });

    await beginActiveDefense(attackA);
    await beginActiveDefense(attackB);
    rolls[0].close();
    rolls[1].rollDefense();

    const rolledMessage = createDefense("defense-b", 23, actorB.id);
    const claimed = await claimPendingDefenseForMessage(rolledMessage);
    assert.equal(claimed.attackMessageId, attackB.id, "closing the stale dialog cannot clear or replace the newer workflow");
    assert.ok(claimed.pendingDefenseId);

    await beginActiveDefense(attackB);
    const cancelledNonce = activeDefenseState.pendingDefense.pendingDefenseId;
    rolls[2].close();
    const unrelatedMessage = createDefense("defense-unrelated", 24, actorB.id);
    assert.equal(await claimPendingDefenseForMessage(unrelatedMessage), null);
    assert.equal(activeDefenseState.pendingDefense, null);
    assert.notEqual(cancelledNonce, claimed.pendingDefenseId);
});

test("Ablenkend from the live attack or serialized weapon raises the active-defense difficulty", async () => {
    resetHarness();
    const rolledDifficulties = [];
    let dialog = null;
    const defense = {
        skill: {
            roll: async (options) => {
                rolledDifficulties.push(options.difficulty);
                return true;
            },
        },
        roll() {
            return this.skill.roll({ difficulty: 15, type: "defense" });
        },
    };
    const actor = {
        id: "target-distracting",
        uuid: "Actor.target-distracting",
        isOwner: true,
        activeDefenseDialog: async function () {
            dialog = {
                actor: this,
                close() { return this; },
                rollDefense() {
                    this.actor.rollActiveDefense("defense", defense);
                    this.close();
                },
            };
            return dialog;
        },
        rollActiveDefense: (_type, item) => item.roll(),
    };
    harness.tokens.set("Token.distracting-target", {
        uuid: "Token.distracting-target",
        name: "Ziel",
        actor,
    });
    const attack = createAttack("attack-distracting", attackReport(), {
        primaryTargetTokenUuid: "Token.distracting-target",
    });
    attack.system.attackReference = {
        get: () => ({
            featuresAsRef: {
                featureValue: (name) => name === "Ablenkend" ? 2 : 0,
            },
        }),
    };

    await beginActiveDefense(attack);
    dialog.rollDefense();
    await Promise.resolve();

    const serializedAttack = createAttack("attack-serialized-distracting", attackReport({
        weapon: { features: "Scharf 2, Ablenkend" },
    }), {
        primaryTargetTokenUuid: "Token.distracting-target",
    });
    await beginActiveDefense(serializedAttack);
    dialog.rollDefense();
    await Promise.resolve();

    assert.deepEqual(rolledDifficulties, [25, 20]);
});

test("Ablenkend is applied even when the defense is selected before the dialog render promise settles", async () => {
    resetHarness();
    globalThis.CONFIG.splittermond.check = { activeDefenseDifficulty: 15 };
    const rolledDifficulties = [];
    const defense = {
        skill: {
            roll: async (options) => {
                rolledDifficulties.push(options.difficulty);
                return true;
            },
        },
        roll() {
            return this.skill.roll({
                difficulty: globalThis.CONFIG.splittermond.check.activeDefenseDifficulty,
                type: "defense",
            });
        },
    };
    const actor = {
        id: "target-fast-defense",
        uuid: "Actor.target-fast-defense",
        isOwner: true,
        activeDefenseDialog: async function () {
            const dialog = {
                actor: this,
                rendered: true,
                close() {
                    this.rendered = false;
                    return this;
                },
                rollDefense() {
                    this.actor.rollActiveDefense("defense", defense);
                    this.close();
                },
            };
            dialog.rollDefense();
            await Promise.resolve();
            return dialog;
        },
        rollActiveDefense: (_type, item) => item.roll(),
    };
    harness.tokens.set("Token.fast-defense", {
        uuid: "Token.fast-defense",
        name: "Schnelles Ziel",
        actor,
    });
    const attack = createAttack("attack-fast-defense", attackReport({
        weapon: { features: "Ablenkend" },
    }), {
        primaryTargetTokenUuid: "Token.fast-defense",
    });

    await beginActiveDefense(attack);
    await Promise.resolve();

    assert.deepEqual(rolledDifficulties, [20]);
    assert.equal(globalThis.CONFIG.splittermond.check.activeDefenseDifficulty, 15);
    assert.equal(activeDefenseState.pendingDefenseCleanups.size, 0);
});
