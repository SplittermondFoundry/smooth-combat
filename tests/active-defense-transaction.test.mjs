import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    beginActiveDefense,
    claimPendingDefenseForMessage,
    processDefenseMessage,
} from "../Modul/splittermond-smoother-fight/scripts/features/active-defense/active-defense.js";
import {
    applyDefenseSplinterpointForUser,
    getDefenseSplinterpointActions,
} from "../Modul/splittermond-smoother-fight/scripts/features/active-defense/splinterpoints.js";
import { activeDefenseState } from "../Modul/splittermond-smoother-fight/scripts/features/active-defense/state.js";
import { setRequiredFlag } from "../Modul/splittermond-smoother-fight/scripts/features/chat/messages.js";

const MODULE_ID = "splittermond-smoother-fight";
const harness = {
    checks: new Map(),
    actors: new Map(),
    messages: new Map(),
    splinterpointCards: [],
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
        if (Object.hasOwn(changes, "flags.splittermond.check.itemData")) {
            this.flags.splittermond ??= {};
            this.flags.splittermond.check ??= {};
            this.flags.splittermond.check.itemData = clone(changes["flags.splittermond.check.itemData"]);
        }
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

    querySelector(selector) {
        if (selector !== ".degree-of-success-description") return null;
        const match = this.html.match(/<div class="degree-of-success-description">([\s\S]*?)<\/div>/u);
        return match ? new FakeFragment(match[1]) : null;
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
    createDefenseSplinterpointChatCard: async (data) => {
        harness.splinterpointCards.push(data);
        return { id: `splinterpoint-card-${harness.splinterpointCards.length}` };
    },
    getDefenseCheck: (message) => harness.checks.get(message.id) ?? null,
    getDefenseSplinterpointActions,
    getAssignedUser: (combatant) => combatant?.assignedUser ?? null,
    getHudContext: () => null,
    getMessageContext: (message) => message?.flags?.[MODULE_ID]?.context ?? null,
    getRuntimeController: (combatant) => combatant.runtimeController ?? null,
    isOwnMessage: (message) => (message.author?.id ?? message.user) === game.user.id,
    messageBelongsToCombatant: () => false,
    messageOffersActiveDefense: (message) => /data-localaction=["']activeDefense["']/iu.test(message?.content ?? ""),
    resolveActorUuid: (uuid) => harness.actors.get(uuid) ?? null,
    resolveCombatantToken: (combatant) => combatant.token ?? null,
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
    activeDefenseState.splinterpointActorLocks.clear();
    harness.actors.clear();
    harness.checks.clear();
    harness.messages.clear();
    harness.splinterpointCards.length = 0;
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
    const check = {
        type: "defense",
        defenseType: "defense",
        baseDefense: 20,
        succeeded: true,
        degreeOfSuccess: { fromRoll: value - 21, modification: 0 },
        itemData: { id: `defense-${actorId}`, itemFeatures: [] },
    };
    harness.checks.set(id, check);
    message.flags.splittermond = { check: clone(check) };
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

function createSplinterpointActor(id, { heroLevel = 2, points = 2, owners = [] } = {}) {
    const actor = {
        id,
        uuid: `Actor.${id}`,
        isOwner: true,
        splinterpoints: { value: points, max: 3 },
        system: {
            experience: { heroLevel },
            splinterpoints: { value: points, max: 3 },
        },
        derivedValues: {
            defense: { value: { calculate: async () => 20 } },
        },
        testUserPermission: (user) => user?.isGM || owners.includes(user?.id),
        async update(changes) {
            const next = Number(changes["system.splinterpoints.value"]);
            this.system.splinterpoints.value = next;
            this.splinterpoints.value = next;
            return this;
        },
    };
    harness.actors.set(actor.uuid, actor);
    return actor;
}

function latestOffense(root) {
    let latest = root;
    while (latest.flags[MODULE_ID]?.context?.supersededBy) {
        latest = harness.messages.get(latest.flags[MODULE_ID].context.supersededBy);
    }
    return latest;
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

test("a splinterpoint improvement reprocesses the same active defense with Defensiv", async () => {
    resetHarness();
    const root = createAttack("attack-splinterpoint", attackReport({
        roll: { total: 35 },
        degreeOfSuccess: { fromRoll: 5, modification: 0 },
    }));
    const defense = createDefense("defense-splinterpoint", 24, "defender-splinterpoint");
    const check = harness.checks.get(defense.id);
    check.degreeOfSuccess.fromRoll = 1;
    check.itemData.itemFeatures = {
        internalFeatureList: [{ name: "Defensiv", value: 2 }],
    };
    const pending = pendingFor(root, defense, 1);

    await processDefenseMessage(defense, pending);

    defense.content = "VTD: 25";
    check.degreeOfSuccess.fromRoll = 2;
    await processDefenseMessage(defense, pending);

    const offenses = Array.from(harness.messages.values()).filter((message) => message.type === "attackRollMessage");
    let latest = root;
    while (latest.flags[MODULE_ID]?.context?.supersededBy) {
        latest = harness.messages.get(latest.flags[MODULE_ID].context.supersededBy);
    }

    assert.equal(offenses.length, 2, "the unchanged attack outcome updates the existing successor");
    assert.equal(latest.flags[MODULE_ID].context.defenseValue, 25);
    assert.deepEqual(latest.flags[MODULE_ID].context.defenseMessageIds, [defense.id]);
    assert.match(latest.content, /<strong>25<\/strong>/u);
    assert.equal(defense.flags[MODULE_ID].context.resultingDefenseValue, 25);
    assert.equal(defense.flags[MODULE_ID].context.effectiveDefenseValue, 25);
    assert.equal(defense.flags[MODULE_ID].context.defensiveFeatureValue, 2);
});

test("the rendered defense value retains Defensiv when serialized item data is empty", async () => {
    resetHarness();
    const root = createAttack("attack-rendered-defense", attackReport({
        difficulty: 24,
        roll: { total: 33 },
        degreeOfSuccess: { fromRoll: 3, modification: 0 },
    }));
    const defense = createDefense("defense-rendered-value", 30, "defender-rendered-value");
    const check = harness.checks.get(defense.id);
    check.baseDefense = 24;
    check.degreeOfSuccess.fromRoll = 5;
    check.itemData = {};
    defense.content = `
        <article class="splittermond check success">
            <header>Dornenhandschuh, freihändig (Angepasst)</header>
            <div class="roll-total">32</div>
            <div class="degree-of-success">5 EG Herausragend gelungen</div>
            <div class="degree-of-success-description"><p><strong>VTD: 32</strong></p></div>
        </article>
    `;

    await processDefenseMessage(defense, pendingFor(root, defense, 1));

    let latest = root;
    while (latest.flags[MODULE_ID]?.context?.supersededBy) {
        latest = harness.messages.get(latest.flags[MODULE_ID].context.supersededBy);
    }

    assert.equal(latest.system.checkReport.difficulty, 32);
    assert.equal(latest.flags[MODULE_ID].context.defenseValue, 32);
    assert.match(latest.content, /<strong>32<\/strong>/u);
    assert.doesNotMatch(latest.content, /<strong>30<\/strong>/u);
    assert.equal(defense.flags[MODULE_ID].context.resultingDefenseValue, 32);
    assert.equal(defense.flags[MODULE_ID].context.defensiveFeatureValue, 2);
    assert.deepEqual(defense.flags.splittermond.check.itemData.itemFeatures.internalFeatureList, [
        { name: "Defensiv", value: 2 },
    ]);
});

test("a broken splinterpoint rerender retains Defensiv and recalculates the attack again", async () => {
    resetHarness();
    const root = createAttack("attack-splinterpoint-rerender", attackReport({
        difficulty: 24,
        roll: { total: 30 },
        degreeOfSuccess: { fromRoll: 2, modification: 0 },
    }));
    const defense = createDefense("defense-splinterpoint-rerender", 28, "defender-splinterpoint-rerender");
    const check = harness.checks.get(defense.id);
    check.baseDefense = 24;
    check.degreeOfSuccess.fromRoll = 3;
    check.itemData = {};
    defense.content = '<div class="degree-of-success-description"><strong>VTD: 30</strong></div>';
    const pending = pendingFor(root, defense, 1);

    await processDefenseMessage(defense, pending);
    const firstSuccessor = harness.messages.get(root.flags[MODULE_ID].context.supersededBy);
    assert.equal(firstSuccessor.system.checkReport.difficulty, 30);
    assert.equal(defense.flags[MODULE_ID].context.defensiveFeatureValue, 2);

    check.degreeOfSuccess.fromRoll = 4;
    defense.content = '<div class="degree-of-success-description"><strong>VTD: 29</strong></div>';
    await processDefenseMessage(defense, pending);

    let latest = root;
    while (latest.flags[MODULE_ID]?.context?.supersededBy) {
        latest = harness.messages.get(latest.flags[MODULE_ID].context.supersededBy);
    }
    const offenses = Array.from(harness.messages.values()).filter((message) => message.type === "attackRollMessage");

    assert.equal(offenses.length, 3, "the VTD increase from 30 to 31 creates another successor");
    assert.notEqual(latest.id, firstSuccessor.id);
    assert.equal(latest.system.checkReport.difficulty, 31);
    assert.equal(latest.system.checkReport.succeeded, false);
    assert.equal(latest.flags[MODULE_ID].context.defenseValue, 31);
    assert.match(latest.content, /<strong>31<\/strong>/u);
    assert.equal(defense.flags[MODULE_ID].context.resultingDefenseValue, 31);
    assert.equal(defense.flags[MODULE_ID].context.defensiveFeatureValue, 2);
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

test("VTD splinterpoints, resonance, and active defense remain additive in every requested order", async () => {
    const orders = [
        ["defense", "defense-splinterpoint", "vtd", "resonance"],
        ["defense", "vtd", "defense-splinterpoint", "resonance"],
        ["vtd", "defense", "defense-splinterpoint", "resonance"],
    ];

    for (const [index, order] of orders.entries()) {
        resetHarness();
        const target = createSplinterpointActor(`target-${index}`, { points: 2 });
        const resonator = createSplinterpointActor(`resonator-${index}`, { heroLevel: 3, points: 2 });
        const targetTokenUuid = `Token.target-${index}`;
        harness.tokens.set(targetTokenUuid, { uuid: targetTokenUuid, name: `Target ${index}`, actor: target });
        game.combat = {
            combatants: [{
                actor: resonator,
                token: { uuid: `Token.resonator-${index}`, actor: resonator },
                runtimeController: game.user,
            }],
        };
        const root = createAttack(`attack-order-${index}`, attackReport({
            roll: { total: 21 },
            degreeOfSuccess: { fromRoll: 0, modification: 0 },
        }), { primaryTargetTokenUuid: targetTokenUuid });
        root.content = '<article class="splittermond check attack"><button data-localaction="activeDefense">Abwehr</button></article>';
        const defense = createDefense(`defense-order-${index}`, 24, `defender-${index}`);
        const pending = pendingFor(root, defense, index);

        for (const step of order) {
            if (step === "defense") await processDefenseMessage(defense, pending);
            if (step === "defense-splinterpoint") {
                defense.content = "VTD: 25";
                harness.checks.get(defense.id).degreeOfSuccess.fromRoll = 4;
                await processDefenseMessage(defense, pending);
            }
            if (step === "vtd") {
                await applyDefenseSplinterpointForUser(latestOffense(root), target.uuid, game.user);
            }
            if (step === "resonance") {
                await applyDefenseSplinterpointForUser(latestOffense(root), resonator.uuid, game.user);
            }
        }

        const latest = latestOffense(root);
        const context = latest.flags[MODULE_ID].context;
        assert.equal(context.baseDefenseValue, 20, `order ${index + 1} retains the base VTD`);
        assert.equal(context.activeDefenseValue, 25, `order ${index + 1} retains the improved active defense`);
        assert.equal(context.vtdSplinterpointBonus, 5, `order ${index + 1} adds +3 and +2`);
        assert.equal(context.defenseValue, 30, `order ${index + 1} uses the full effective VTD`);
        assert.deepEqual(context.vtdSplinterpointResonanceActorUuids, [resonator.uuid]);
        assert.equal(latest.system.checkReport.difficulty, 30);
        assert.equal(latest.system.checkReport.succeeded, false);
        assert.equal(target.splinterpoints.value, 1);
        assert.equal(resonator.splinterpoints.value, 1);
        assert.deepEqual(harness.splinterpointCards.map(({ kind, defenseValue, targetName }) => ({
            kind,
            defenseValue,
            targetName,
        })), [
            { kind: "primary", defenseValue: [28, 27, 23][index], targetName: `Target ${index}` },
            { kind: "resonance", defenseValue: 30, targetName: `Target ${index}` },
        ]);
    }
});

test("resonance is offered only to another owned hero-level-three combatant", () => {
    resetHarness();
    const targetOwner = { id: "target-owner", isGM: false };
    const resonanceOwner = { id: "resonance-owner", isGM: false };
    const target = createSplinterpointActor("target-actions", { owners: [targetOwner.id] });
    const eligible = createSplinterpointActor("eligible-actions", { heroLevel: 3, owners: [resonanceOwner.id] });
    const tooLow = createSplinterpointActor("low-actions", { heroLevel: 2, owners: [resonanceOwner.id] });
    const samePlayer = createSplinterpointActor("same-player-actions", { heroLevel: 3, owners: [targetOwner.id] });
    harness.tokens.set("Token.target-actions", { uuid: "Token.target-actions", name: "XYZ", actor: target });
    game.combat = {
        combatants: [
            { actor: target, token: { uuid: "Token.target-actions", actor: target }, assignedUser: targetOwner, runtimeController: targetOwner },
            { actor: samePlayer, token: { actor: samePlayer }, assignedUser: targetOwner, runtimeController: targetOwner },
            { actor: eligible, token: { actor: eligible }, assignedUser: resonanceOwner, runtimeController: resonanceOwner },
            { actor: tooLow, token: { actor: tooLow }, assignedUser: resonanceOwner, runtimeController: resonanceOwner },
        ],
    };
    const attack = createAttack("attack-actions", attackReport(), {
        primaryTargetTokenUuid: "Token.target-actions",
    });
    attack.content = '<button data-localaction="activeDefense">Abwehr</button>';

    assert.deepEqual(getDefenseSplinterpointActions(attack, targetOwner), [
        { kind: "primary", actorUuid: target.uuid },
    ]);

    attack.flags[MODULE_ID].context = {
        ...attack.flags[MODULE_ID].context,
        vtdSplinterpointActorUuid: target.uuid,
        vtdSplinterpointBonus: 3,
    };
    assert.deepEqual(getDefenseSplinterpointActions(attack, resonanceOwner), [
        { kind: "resonance", actorUuid: eligible.uuid },
    ]);
    assert.deepEqual(getDefenseSplinterpointActions(attack, targetOwner), []);
});

test("a failed attack-card transaction refunds the spent VTD splinterpoint", async (t) => {
    resetHarness();
    t.mock.method(console, "error", () => {});
    const target = createSplinterpointActor("target-refund", { points: 2 });
    harness.tokens.set("Token.target-refund", { uuid: "Token.target-refund", name: "Target", actor: target });
    game.combat = { combatants: [] };
    const root = createAttack("attack-refund", attackReport(), {
        primaryTargetTokenUuid: "Token.target-refund",
    });
    root.content = '<button data-localaction="activeDefense">Abwehr</button>';
    harness.rejectSetFlag = ({ message, key, value }) => Boolean(
        message.id === root.id && key === "context" && value?.supersededBy
    );

    await assert.rejects(
        applyDefenseSplinterpointForUser(root, target.uuid, game.user),
        /Could not persist required context flag/u
    );

    assert.equal(target.splinterpoints.value, 2);
    assert.equal(harness.splinterpointCards.length, 0);
    assert.equal(root.flags[MODULE_ID].context.vtdSplinterpointActorUuid, undefined);
    assert.deepEqual(
        Array.from(harness.messages.values())
            .filter((message) => message.type === "attackRollMessage")
            .map((message) => message.id),
        [root.id]
    );
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
