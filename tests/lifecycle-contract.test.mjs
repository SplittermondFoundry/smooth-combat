import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import { registerHooks, registerSocket } from "../Modul/splittermond-smoother-fight/scripts/core/lifecycle.js";

const EXPECTED_HOOKS = [
    "combatStart",
    "combatRound",
    "combatTurn",
    "updateCombat",
    "createCombat",
    "deleteCombat",
    "createCombatant",
    "updateCombatant",
    "deleteCombatant",
    "canvasReady",
    "updateActor",
    "createItem",
    "updateItem",
    "deleteItem",
    "controlToken",
    "updateToken",
    "canvasReady",
    "preUpdateActor",
    "updateActor",
    "createActor",
    "deleteActor",
    "targetToken",
    "combatTurn",
    "combatStart",
    "createChatMessage",
    "updateChatMessage",
    "deleteChatMessage",
    "diceSoNiceRollComplete",
    "renderChatMessageHTML",
    "renderChatMessage",
    "renderTokenHUD",
];

const callLog = [];
const behavior = {};

function record(name, args) {
    callLog.push({ name, args });
}

function callsOf(name) {
    return callLog.filter((entry) => entry.name === name).map((entry) => entry.args);
}

const serviceStubs = {
    scheduleRender: (...args) => record("scheduleRender", args),
    scheduleRenderAfterTokenMovement: (...args) => record("scheduleRenderAfterTokenMovement", args),
    seedHealthFeedbackState: (...args) => record("seedHealthFeedbackState", args),
    rememberActorHealthCost: (...args) => record("rememberActorHealthCost", args),
    announceAppliedDamageFeedback: (...args) => record("announceAppliedDamageFeedback", args),
    forgetActorHealthCost: (...args) => record("forgetActorHealthCost", args),
    tokenUuid: (...args) => {
        record("tokenUuid", args);
        return behavior.tokenUuid(...args);
    },
    rememberTargetReferences: (...args) => record("rememberTargetReferences", args),
    publishOwnTarget: (...args) => record("publishOwnTarget", args),
    announceTurnFeedback: (...args) => record("announceTurnFeedback", args),
    resetPersonalCombatantSelection: (...args) => record("resetPersonalCombatantSelection", args),
    setLastTurnCombatantId: (...args) => record("setLastTurnCombatantId", args),
    onCreateChatMessage: (...args) => {
        record("onCreateChatMessage", args);
        return behavior.onCreateChatMessage(...args);
    },
    onUpdateChatMessage: (...args) => {
        record("onUpdateChatMessage", args);
        return behavior.onUpdateChatMessage(...args);
    },
    isCombatEventMessage: (...args) => {
        record("isCombatEventMessage", args);
        return behavior.isCombatEventMessage(...args);
    },
    markCombatEventDeletionPending: (...args) => record("markCombatEventDeletionPending", args),
    clearCombatEventExpansionRequest: (...args) => record("clearCombatEventExpansionRequest", args),
    prepareRenderedChatMessage: (...args) => record("prepareRenderedChatMessage", args),
    renderTokenOwnerControl: (...args) => record("renderTokenOwnerControl", args),
    resolveToken: (...args) => {
        record("resolveToken", args);
        return behavior.resolveToken(...args);
    },
    setLocalTarget: (...args) => record("setLocalTarget", args),
    receivePublishedFeedback: (...args) => record("receivePublishedFeedback", args),
    resolveActorUuid: (...args) => {
        record("resolveActorUuid", args);
        return behavior.resolveActorUuid(...args);
    },
    isDamageMessage: (...args) => {
        record("isDamageMessage", args);
        return behavior.isDamageMessage(...args);
    },
    mayUserApplyDamageToActor: (...args) => {
        record("mayUserApplyDamageToActor", args);
        return behavior.mayUserApplyDamageToActor(...args);
    },
    recordCompletedDamageApplication: (...args) => record("recordCompletedDamageApplication", args),
    safeSetFlag: async (...args) => {
        record("safeSetFlag", args);
        return true;
    },
    waitForChatMessage: async (...args) => {
        record("waitForChatMessage", args);
        return behavior.waitForChatMessage(...args);
    },
    normalizePendingDefense: (...args) => {
        record("normalizePendingDefense", args);
        return behavior.normalizePendingDefense(...args);
    },
    canUserSubmitDefense: (...args) => {
        record("canUserSubmitDefense", args);
        return behavior.canUserSubmitDefense(...args);
    },
    waitForDefenseProcessing: async (...args) => record("waitForDefenseProcessing", args),
    processDefenseMessage: async (...args) => record("processDefenseMessage", args),
};

function resetHarness(gameStub) {
    callLog.length = 0;
    for (const key of Object.keys(behavior)) delete behavior[key];
    Object.assign(behavior, {
        tokenUuid: (token) => token?.uuid ?? null,
        onCreateChatMessage: async () => undefined,
        onUpdateChatMessage: async () => undefined,
        isCombatEventMessage: () => false,
        resolveToken: () => null,
        resolveActorUuid: () => null,
        isDamageMessage: (message) => message?.type === "damageMessage",
        mayUserApplyDamageToActor: () => false,
        waitForChatMessage: () => null,
        normalizePendingDefense: (value) => value?.attackMessageId ? value : null,
        canUserSubmitDefense: () => false,
    });

    gameStub.user = { id: "current-user", isGM: false };
    gameStub.users.clear();
    gameStub.messages.clear();
}

function handlersFor(registrations, name) {
    return registrations.filter((entry) => entry.name === name).map((entry) => entry.callback);
}

function replaceGlobal(name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    return () => {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
    };
}

test("lifecycle hooks and socket routing preserve their Foundry contracts", async (t) => {
    const hookRegistrations = [];
    const socketRegistrations = [];
    const gameStub = {
        user: { id: "current-user", isGM: false },
        users: new Map(),
        messages: new Map(),
        socket: {
            on: (channel, callback) => socketRegistrations.push({ channel, callback }),
        },
    };
    class FakeHTMLElement {}

    const restoreHooks = replaceGlobal("Hooks", {
        on: (name, callback) => hookRegistrations.push({ name, callback }),
    });
    const restoreGame = replaceGlobal("game", gameStub);
    const restoreHTMLElement = replaceGlobal("HTMLElement", FakeHTMLElement);
    t.after(() => {
        restoreHTMLElement();
        restoreGame();
        restoreHooks();
    });

    configureServices(serviceStubs);
    registerHooks();
    registerSocket();

    assert.deepEqual(hookRegistrations.map(({ name }) => name), EXPECTED_HOOKS);
    assert.equal(socketRegistrations.length, 1);
    assert.equal(socketRegistrations[0].channel, "module.splittermond-smoother-fight");
    const socketHandler = socketRegistrations[0].callback;

    await t.test("hook callbacks retain their routing and state transitions", async () => {
        resetHarness(gameStub);
        handlersFor(hookRegistrations, "combatRound")[0]({ id: "combat" });
        assert.deepEqual(callsOf("scheduleRender"), [[]]);

        callLog.length = 0;
        const movedToken = { id: "token" };
        handlersFor(hookRegistrations, "updateToken")[0](movedToken, { hidden: false, x: 120 });
        assert.deepEqual(callsOf("scheduleRender"), [[0]]);
        assert.deepEqual(callsOf("scheduleRenderAfterTokenMovement"), [[movedToken]]);

        callLog.length = 0;
        const currentUser = {
            id: "current-user",
            targets: new Set(["Scene.scene.Token.old"]),
        };
        gameStub.user = currentUser;
        handlersFor(hookRegistrations, "targetToken")[0](currentUser, { uuid: "Scene.scene.Token.new" }, true);
        assert.deepEqual(callsOf("rememberTargetReferences"), [[currentUser.id, [
            "Scene.scene.Token.old",
            "Scene.scene.Token.new",
        ]]]);
        assert.deepEqual(callsOf("publishOwnTarget"), [[[
            "Scene.scene.Token.old",
            "Scene.scene.Token.new",
        ]]]);
        assert.deepEqual(callsOf("scheduleRender"), [[]]);

        callLog.length = 0;
        const combat = { id: "new-combat" };
        for (const callback of handlersFor(hookRegistrations, "combatStart")) callback(combat);
        assert.deepEqual(callsOf("resetPersonalCombatantSelection"), [[]]);
        assert.deepEqual(callsOf("setLastTurnCombatantId"), [[null]]);
        assert.deepEqual(callsOf("announceTurnFeedback"), [[combat]]);
        assert.deepEqual(callsOf("scheduleRender"), [[]]);

        callLog.length = 0;
        behavior.isCombatEventMessage = () => true;
        const deletedMessage = { id: "deleted" };
        handlersFor(hookRegistrations, "deleteChatMessage")[0](deletedMessage);
        assert.deepEqual(callsOf("markCombatEventDeletionPending"), [[]]);
        assert.deepEqual(callsOf("clearCombatEventExpansionRequest"), [[]]);
        assert.deepEqual(callsOf("scheduleRender"), [[0]]);

        callLog.length = 0;
        const createdMessage = { id: "created" };
        handlersFor(hookRegistrations, "createChatMessage")[0](createdMessage);
        await Promise.resolve();
        await Promise.resolve();
        assert.deepEqual(callsOf("onCreateChatMessage"), [[createdMessage]]);
        assert.deepEqual(callsOf("scheduleRender"), [[], [0]]);

        callLog.length = 0;
        const htmlElement = new FakeHTMLElement();
        handlersFor(hookRegistrations, "renderChatMessageHTML")[0](createdMessage, htmlElement);
        handlersFor(hookRegistrations, "renderChatMessage")[0](createdMessage, [htmlElement]);
        handlersFor(hookRegistrations, "renderTokenHUD")[0]({ id: "hud" }, htmlElement);
        assert.deepEqual(callsOf("prepareRenderedChatMessage"), [
            [createdMessage, htmlElement],
            [createdMessage, htmlElement],
        ]);
        assert.deepEqual(callsOf("renderTokenOwnerControl"), [[{ id: "hud" }, htmlElement]]);
    });

    await t.test("target updates reject foreign players and accept self or GM updates", async () => {
        resetHarness(gameStub);
        const player = { id: "player", isGM: false };
        const gm = { id: "gm", isGM: true };
        gameStub.users.set(player.id, player);
        gameStub.users.set(gm.id, gm);

        await socketHandler({
            type: "target-update",
            senderId: player.id,
            userId: "victim",
            targetUuids: ["Scene.s.Token.forbidden"],
        });
        assert.deepEqual(callsOf("rememberTargetReferences"), []);
        assert.deepEqual(callsOf("scheduleRender"), []);

        await socketHandler({
            type: "target-update",
            senderId: player.id,
            userId: player.id,
            targetUuids: ["Scene.s.Token.a", "Scene.s.Token.a", "Scene.s.Token.b"],
        });
        assert.deepEqual(callsOf("rememberTargetReferences"), [[
            player.id,
            ["Scene.s.Token.a", "Scene.s.Token.b"],
        ]]);

        await socketHandler({
            type: "target-update",
            senderId: gm.id,
            userId: "victim",
            tokenUuid: "Scene.s.Token.gm-selected",
        });
        assert.deepEqual(callsOf("rememberTargetReferences"), [
            [player.id, ["Scene.s.Token.a", "Scene.s.Token.b"]],
            ["victim", ["Scene.s.Token.gm-selected"]],
        ]);
        assert.deepEqual(callsOf("scheduleRender"), [[], []]);
    });

    await t.test("set-target and combat-feedback enforce sender and recipient gates", async () => {
        resetHarness(gameStub);
        const player = { id: "player", isGM: false };
        const gm = { id: "gm", isGM: true };
        gameStub.users.set(player.id, player);
        gameStub.users.set(gm.id, gm);
        const token = { uuid: "Scene.s.Token.target" };
        behavior.resolveToken = (uuid) => uuid === token.uuid ? token : null;

        await socketHandler({
            type: "set-target",
            senderId: player.id,
            recipientId: gameStub.user.id,
            tokenUuid: token.uuid,
        });
        await socketHandler({
            type: "set-target",
            senderId: gm.id,
            recipientId: "someone-else",
            tokenUuid: token.uuid,
        });
        assert.deepEqual(callsOf("setLocalTarget"), []);

        await socketHandler({
            type: "set-target",
            senderId: gm.id,
            recipientId: gameStub.user.id,
            tokenUuid: token.uuid,
            targeted: false,
            releaseOthers: true,
        });
        assert.deepEqual(callsOf("setLocalTarget"), [[token, false, true]]);
        assert.deepEqual(callsOf("publishOwnTarget"), [[]]);

        callLog.length = 0;
        await socketHandler({ type: "combat-feedback", senderId: gameStub.user.id, kind: "damageBlocked" });
        await socketHandler({ type: "combat-feedback", senderId: "unknown", kind: "damageBlocked" });
        await socketHandler({ type: "combat-feedback", senderId: player.id, kind: "damage" });
        assert.deepEqual(callsOf("receivePublishedFeedback"), []);

        await socketHandler({
            type: "combat-feedback",
            senderId: player.id,
            kind: "damageBlocked",
            tokenUuid: token.uuid,
            actorUuid: "Actor.target",
        });
        assert.deepEqual(callsOf("receivePublishedFeedback"), [["damageBlocked", {
            tokenUuid: token.uuid,
            actorUuid: "Actor.target",
        }]]);
    });

    await t.test("damage completion requires a recipient GM, valid damage message, and authorized sender", async () => {
        resetHarness(gameStub);
        const sender = { id: "sender", isGM: false };
        const message = { id: "damage-message", type: "damageMessage" };
        const actor = { id: "actor" };
        gameStub.users.set(sender.id, sender);
        gameStub.messages.set(message.id, message);
        behavior.resolveActorUuid = () => actor;
        behavior.isDamageMessage = () => true;
        behavior.mayUserApplyDamageToActor = () => true;
        const payload = {
            type: "damage-application-completed",
            senderId: sender.id,
            recipientId: gameStub.user.id,
            messageId: message.id,
            actorUuid: "Actor.actor",
        };

        await socketHandler(payload);
        assert.deepEqual(callsOf("safeSetFlag"), []);

        gameStub.user.isGM = true;
        behavior.mayUserApplyDamageToActor = () => false;
        await socketHandler(payload);
        assert.deepEqual(callsOf("safeSetFlag"), []);
        assert.deepEqual(callsOf("recordCompletedDamageApplication"), []);

        behavior.mayUserApplyDamageToActor = () => true;
        await socketHandler(payload);
        assert.deepEqual(callsOf("recordCompletedDamageApplication"), [[message.id]]);
        assert.deepEqual(callsOf("safeSetFlag"), [[message, "damageApplicationCompleted", true]]);
        assert.deepEqual(callsOf("scheduleRender"), [[0]]);
        assert.deepEqual(callsOf("mayUserApplyDamageToActor").at(-1), [sender, actor]);
    });

    await t.test("defense recalculation validates receiver, author, offense, and submit permission", async () => {
        resetHarness(gameStub);
        gameStub.user.isGM = true;
        const sender = { id: "sender", isGM: false };
        const defenseMessage = { id: "defense", author: { id: sender.id } };
        const offense = { id: "offense", type: "attackRollMessage" };
        const pending = { attackMessageId: offense.id };
        gameStub.users.set(sender.id, sender);
        gameStub.messages.set(offense.id, offense);
        behavior.waitForChatMessage = () => defenseMessage;
        behavior.normalizePendingDefense = () => pending;
        const payload = {
            type: "recalculate-defense",
            senderId: sender.id,
            recipientId: gameStub.user.id,
            defenseMessageId: defenseMessage.id,
            pending,
        };

        behavior.canUserSubmitDefense = () => false;
        await socketHandler(payload);
        assert.deepEqual(callsOf("processDefenseMessage"), []);
        assert.deepEqual(callsOf("canUserSubmitDefense"), [[sender, pending, defenseMessage]]);

        callLog.length = 0;
        behavior.canUserSubmitDefense = () => true;
        await socketHandler(payload);
        assert.deepEqual(callLog.map(({ name }) => name), [
            "waitForChatMessage",
            "normalizePendingDefense",
            "canUserSubmitDefense",
            "waitForDefenseProcessing",
            "processDefenseMessage",
        ]);
        assert.deepEqual(callsOf("waitForDefenseProcessing"), [[defenseMessage.id]]);
        assert.deepEqual(callsOf("processDefenseMessage"), [[defenseMessage, pending, { allowForeign: true }]]);

        callLog.length = 0;
        defenseMessage.author.id = "different-author";
        await socketHandler(payload);
        assert.deepEqual(callsOf("normalizePendingDefense"), []);
        assert.deepEqual(callsOf("processDefenseMessage"), []);

        callLog.length = 0;
        sender.isGM = true;
        await socketHandler(payload);
        assert.deepEqual(callsOf("canUserSubmitDefense"), []);
        assert.deepEqual(callsOf("processDefenseMessage"), [[defenseMessage, pending, { allowForeign: true }]]);
    });
});
