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
    "updateUser",
    "controlToken",
    "canvasTearDown",
    "canvasPan",
    "userConnected",
    "sightRefresh",
    "updateToken",
    "recordToken",
    "canvasReady",
    "preUpdateActor",
    "updateActor",
    "createActor",
    "deleteActor",
    "targetToken",
    "updateCombatant",
    "combatTurn",
    "combatStart",
    "deleteCombat",
    "deleteCombatant",
    "createChatMessage",
    "updateChatMessage",
    "deleteChatMessage",
    "diceSoNiceMessagePreProcess",
    "diceSoNiceMessageProcessed",
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
    advanceContinuousActions: (...args) => record("advanceContinuousActions", args),
    advancePendingMovements: (...args) => record("advancePendingMovements", args),
    cancelMovementPlanAfterManualMove: (...args) => record("cancelMovementPlanAfterManualMove", args),
    clearMovementRoutePreview: (...args) => record("clearMovementRoutePreview", args),
    clearTemporaryMovementRoutePreview: (...args) => record("clearTemporaryMovementRoutePreview", args),
    refreshMovementRoutePreviewScale: (...args) => record("refreshMovementRoutePreviewScale", args),
    syncDefaultMovementRoutePreviews: (...args) => record("syncDefaultMovementRoutePreviews", args),
    scheduleRenderAfterTokenMovement: (...args) => record("scheduleRenderAfterTokenMovement", args),
    resetCompletedMovementReversalApplication: (...args) => record("resetCompletedMovementReversalApplication", args),
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
    syncActiveCombatantTokenSelection: (...args) => {
        record("syncActiveCombatantTokenSelection", args);
        return behavior.syncActiveCombatantTokenSelection?.(...args);
    },
    setLastTurnCombatantId: (...args) => record("setLastTurnCombatantId", args),
    getActivePrimaryGm: (...args) => {
        record("getActivePrimaryGm", args);
        return behavior.getActivePrimaryGm(...args);
    },
    clearAttackPreparationsForCombat: async (...args) => record("clearAttackPreparationsForCombat", args),
    clearAttackPreparationForCombatant: async (...args) => record("clearAttackPreparationForCombatant", args),
    clearContinuousActionsForCombat: async (...args) => record("clearContinuousActionsForCombat", args),
    clearContinuousActionForCombatant: async (...args) => record("clearContinuousActionForCombatant", args),
    clearMovementPlansForCombat: async (...args) => record("clearMovementPlansForCombat", args),
    clearMovementPlanForCombatant: async (...args) => record("clearMovementPlanForCombatant", args),
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
    getMessageContext: (message) => message?.flags?.["splittermond-smoother-fight"]?.context ?? null,
    prepareRenderedChatMessage: (...args) => record("prepareRenderedChatMessage", args),
    prepareExistingRenderedChatMessages: (...args) => record("prepareExistingRenderedChatMessages", args),
    renderTokenOwnerControl: (...args) => record("renderTokenOwnerControl", args),
    renderTokenMovementControl: (...args) => record("renderTokenMovementControl", args),
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
    applyRemoteDamageApplication: async (...args) => {
        record("applyRemoteDamageApplication", args);
        return behavior.applyRemoteDamageApplication(...args);
    },
    finishRemoteDamageApplication: (...args) => record("finishRemoteDamageApplication", args),
    recordCompletedDamageApplication: (...args) => record("recordCompletedDamageApplication", args),
    setDamageApplicationState: async (...args) => record("setDamageApplicationState", args),
    canUserDeclineActiveDefense: (...args) => {
        record("canUserDeclineActiveDefense", args);
        return behavior.canUserDeclineActiveDefense(...args);
    },
    declineActiveDefenseForUser: async (...args) => record("declineActiveDefenseForUser", args),
    beginOffenseFollowUp: async (...args) => {
        record("beginOffenseFollowUp", args);
        return behavior.beginOffenseFollowUp(...args);
    },
    defenseAwaitsResponse: (...args) => {
        record("defenseAwaitsResponse", args);
        return behavior.defenseAwaitsResponse(...args);
    },
    finishOffenseFollowUpRequest: (...args) => record("finishOffenseFollowUpRequest", args),
    setRequiredFlag: async (...args) => {
        record("setRequiredFlag", args);
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
    applyDefenseSplinterpointForUser: async (...args) => record("applyDefenseSplinterpointForUser", args),
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
        getActivePrimaryGm: () => null,
        applyRemoteDamageApplication: async () => ({ state: "completed", error: null }),
        waitForChatMessage: () => null,
        normalizePendingDefense: (value) => value?.attackMessageId ? value : null,
        canUserSubmitDefense: () => false,
        canUserDeclineActiveDefense: () => false,
        beginOffenseFollowUp: async () => null,
        defenseAwaitsResponse: () => false,
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
        modules: new Map(),
        socket: {
            on: (channel, callback) => socketRegistrations.push({ channel, callback }),
            emit: (...args) => record("socketEmit", args),
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
    assert.deepEqual(callsOf("prepareExistingRenderedChatMessages"), [[]]);
    assert.equal(socketRegistrations.length, 1);
    assert.equal(socketRegistrations[0].channel, "module.splittermond-smoother-fight");
    const socketHandler = socketRegistrations[0].callback;

    await t.test("hook callbacks retain their routing and state transitions", async () => {
        resetHarness(gameStub);
        const progressedCombat = { id: "combat" };
        handlersFor(hookRegistrations, "combatRound")[0](progressedCombat);
        assert.deepEqual(callsOf("scheduleRender"), [[]]);
        assert.deepEqual(callsOf("advanceContinuousActions"), [[progressedCombat]]);
        assert.deepEqual(callsOf("advancePendingMovements"), [[progressedCombat]]);

        callLog.length = 0;
        handlersFor(hookRegistrations, "userConnected")[0]({ id: "player" }, true);
        assert.deepEqual(callsOf("scheduleRender"), [[0]]);
        assert.deepEqual(callsOf("advanceContinuousActions"), [[gameStub.combat]]);
        assert.deepEqual(callsOf("advancePendingMovements"), [[gameStub.combat]]);

        callLog.length = 0;
        handlersFor(hookRegistrations, "sightRefresh")[0]({});
        assert.deepEqual(callsOf("scheduleRender"), [[0]]);

        callLog.length = 0;
        const releasedToken = { id: "released-token" };
        handlersFor(hookRegistrations, "controlToken")[0](releasedToken, false);
        assert.deepEqual(callsOf("clearTemporaryMovementRoutePreview"), [[releasedToken]]);
        assert.deepEqual(callsOf("scheduleRender"), [[0]]);

        callLog.length = 0;
        handlersFor(hookRegistrations, "canvasTearDown")[0]();
        assert.deepEqual(callsOf("clearMovementRoutePreview"), [[]]);

        callLog.length = 0;
        handlersFor(hookRegistrations, "canvasPan")[0]();
        assert.deepEqual(callsOf("refreshMovementRoutePreviewScale"), [[]]);

        callLog.length = 0;
        const movedToken = { id: "token" };
        const movementOptions = { animate: true };
        handlersFor(hookRegistrations, "updateToken")[0](movedToken, { hidden: false, x: 120 }, movementOptions, "player");
        assert.deepEqual(callsOf("scheduleRender"), [[0]]);
        assert.deepEqual(callsOf("scheduleRenderAfterTokenMovement"), [[movedToken]]);
        assert.deepEqual(callsOf("resetCompletedMovementReversalApplication"), [[movedToken]]);
        assert.deepEqual(callsOf("cancelMovementPlanAfterManualMove"), [[movedToken, movementOptions, "player"]]);
        assert.deepEqual(callsOf("syncDefaultMovementRoutePreviews"), [[gameStub.combat]]);

        callLog.length = 0;
        handlersFor(hookRegistrations, "recordToken")[0](movedToken);
        assert.deepEqual(callsOf("scheduleRender"), [[0]]);

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
        const previousCombatant = { id: "previous-combatant" };
        const nextCombatant = { id: "next-combatant" };
        const tickCombat = { id: "tick-combat", combatant: previousCombatant };
        const updatedCombatant = { id: "updated-combatant", parent: tickCombat };
        const selectedCombatantIds = [];
        behavior.syncActiveCombatantTokenSelection = (currentCombat) => {
            selectedCombatantIds.push(currentCombat.combatant?.id);
        };
        handlersFor(hookRegistrations, "updateCombatant")[1](updatedCombatant);
        assert.deepEqual(callsOf("syncActiveCombatantTokenSelection"), []);
        assert.deepEqual(callsOf("announceTurnFeedback"), []);
        tickCombat.combatant = nextCombatant;
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.deepEqual(callsOf("syncActiveCombatantTokenSelection"), [[tickCombat]]);
        assert.deepEqual(callsOf("announceTurnFeedback"), [[tickCombat]]);
        assert.deepEqual(callsOf("advanceContinuousActions"), [[tickCombat]]);
        assert.deepEqual(callsOf("advancePendingMovements"), [[tickCombat]]);
        assert.deepEqual(selectedCombatantIds, [nextCombatant.id]);

        callLog.length = 0;
        delete behavior.syncActiveCombatantTokenSelection;
        const combat = { id: "new-combat" };
        for (const callback of handlersFor(hookRegistrations, "combatStart")) callback(combat);
        assert.deepEqual(callsOf("resetPersonalCombatantSelection"), [[]]);
        assert.deepEqual(callsOf("setLastTurnCombatantId"), [[null]]);
        assert.deepEqual(callsOf("syncActiveCombatantTokenSelection"), [[combat]]);
        assert.deepEqual(callsOf("announceTurnFeedback"), [[combat]]);
        assert.deepEqual(callsOf("scheduleRender"), [[]]);
        assert.deepEqual(callsOf("advanceContinuousActions"), [[combat]]);
        assert.deepEqual(callsOf("advancePendingMovements"), [[combat]]);

        callLog.length = 0;
        const primaryGm = { id: "primary-gm", isGM: true, active: true };
        gameStub.user = primaryGm;
        behavior.getActivePrimaryGm = () => primaryGm;
        const endedCombat = { id: "ended-combat" };
        for (const callback of handlersFor(hookRegistrations, "deleteCombat")) callback(endedCombat);
        assert.deepEqual(callsOf("clearAttackPreparationsForCombat"), [[endedCombat]]);
        assert.deepEqual(callsOf("clearContinuousActionsForCombat"), [[endedCombat]]);
        assert.deepEqual(callsOf("clearMovementPlansForCombat"), [[endedCombat]]);
        assert.deepEqual(callsOf("scheduleRender"), [[]]);

        callLog.length = 0;
        const removedCombatant = { id: "removed-combatant", parent: endedCombat };
        for (const callback of handlersFor(hookRegistrations, "deleteCombatant")) callback(removedCombatant);
        assert.deepEqual(callsOf("clearAttackPreparationForCombatant"), [[removedCombatant]]);
        assert.deepEqual(callsOf("clearContinuousActionForCombatant"), [[removedCombatant]]);
        assert.deepEqual(callsOf("clearMovementPlanForCombatant"), [[removedCombatant]]);
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

        const recalculatedMessage = {
            id: "recalculated",
            flags: {
                "splittermond-smoother-fight": {
                    context: { recalculatedFrom: "original" },
                },
            },
        };
        gameStub.messages.set(recalculatedMessage.id, recalculatedMessage);
        const currentInterception = { willTrigger3DRoll: true };
        handlersFor(hookRegistrations, "diceSoNiceMessagePreProcess")[0](recalculatedMessage.id, currentInterception);
        assert.equal(currentInterception.willTrigger3DRoll, false);

        gameStub.modules.set("dice-so-nice", { version: "6.2.9" });
        const currentProcessedInterception = { willTrigger3DRoll: true };
        handlersFor(hookRegistrations, "diceSoNiceMessageProcessed")[0](
            recalculatedMessage.id,
            currentProcessedInterception
        );
        assert.equal(currentProcessedInterception.willTrigger3DRoll, true);

        gameStub.modules.set("dice-so-nice", { version: "5.3.4" });
        const legacyInterception = { willTrigger3DRoll: true };
        handlersFor(hookRegistrations, "diceSoNiceMessageProcessed")[0](recalculatedMessage.id, legacyInterception);
        assert.equal(legacyInterception.willTrigger3DRoll, false);

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
        assert.deepEqual(callsOf("renderTokenMovementControl"), [[{ id: "hud" }, htmlElement]]);
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
            primaryTargetTokenUuid: "Scene.s.Token.b",
        });
        assert.deepEqual(callsOf("rememberTargetReferences"), [[
            player.id,
            ["Scene.s.Token.a", "Scene.s.Token.b"],
            "Scene.s.Token.b",
        ]]);

        await socketHandler({
            type: "target-update",
            senderId: gm.id,
            userId: "victim",
            tokenUuid: "Scene.s.Token.gm-selected",
        });
        assert.deepEqual(callsOf("rememberTargetReferences"), [
            [player.id, ["Scene.s.Token.a", "Scene.s.Token.b"], "Scene.s.Token.b"],
            ["victim", ["Scene.s.Token.gm-selected"], "Scene.s.Token.gm-selected"],
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
        await socketHandler({
            type: "set-target",
            senderId: gm.id,
            recipientId: gameStub.user.id,
            tokenUuid: token.uuid,
            targeted: true,
            targetTokenUuids: ["Scene.s.Token.a", token.uuid],
            primaryTargetTokenUuid: token.uuid,
        });
        assert.deepEqual(callsOf("setLocalTarget"), [[token, true, false]]);
        assert.deepEqual(callsOf("publishOwnTarget"), [[
            ["Scene.s.Token.a", token.uuid],
            token.uuid,
        ]]);

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
        assert.deepEqual(callsOf("setDamageApplicationState"), []);

        gameStub.user.isGM = true;
        behavior.mayUserApplyDamageToActor = () => false;
        await socketHandler(payload);
        assert.deepEqual(callsOf("setDamageApplicationState"), []);

        behavior.mayUserApplyDamageToActor = () => true;
        await socketHandler(payload);
        assert.deepEqual(callsOf("setDamageApplicationState"), [[message, "completed", { initiatedBy: sender.id }]]);
        assert.deepEqual(callsOf("scheduleRender"), [[0]]);
        assert.deepEqual(callsOf("mayUserApplyDamageToActor").at(-1), [sender, actor]);
    });

    await t.test("damage requests execute only on their recipient GM and return a correlated result", async () => {
        resetHarness(gameStub);
        const sender = { id: "sender", isGM: false };
        const gm = { id: "gm", isGM: true };
        const message = { id: "damage-request", type: "damageMessage" };
        gameStub.user = gm;
        gameStub.users.set(sender.id, sender);
        gameStub.users.set(gm.id, gm);
        gameStub.messages.set(message.id, message);
        const payload = {
            type: "damage-application-request",
            senderId: sender.id,
            recipientId: gm.id,
            messageId: message.id,
            actionData: { action: "applyDamageToSelf" },
        };

        await socketHandler({ ...payload, recipientId: "other-gm" });
        assert.deepEqual(callsOf("applyRemoteDamageApplication"), []);

        await socketHandler(payload);
        assert.deepEqual(callsOf("applyRemoteDamageApplication"), [[message, payload.actionData, sender]]);
        assert.deepEqual(callsOf("socketEmit"), [["module.splittermond-smoother-fight", {
            type: "damage-application-result",
            senderId: gm.id,
            recipientId: sender.id,
            messageId: message.id,
            state: "completed",
            error: null,
        }]]);

        callLog.length = 0;
        gameStub.user = sender;
        await socketHandler({
            type: "damage-application-result",
            senderId: "unknown",
            recipientId: sender.id,
            messageId: message.id,
        });
        assert.deepEqual(callsOf("finishRemoteDamageApplication"), []);

        await socketHandler({
            type: "damage-application-result",
            senderId: gm.id,
            recipientId: sender.id,
            messageId: message.id,
            state: "completed",
            error: null,
        });
        assert.deepEqual(callsOf("finishRemoteDamageApplication"), [[message.id, {
            type: "damage-application-result",
            senderId: gm.id,
            recipientId: sender.id,
            messageId: message.id,
            state: "completed",
            error: null,
        }]]);
    });

    await t.test("active-defense decline requests require the target owner's authorization", async () => {
        resetHarness(gameStub);
        gameStub.user.isGM = true;
        const sender = { id: "defender", isGM: false };
        const offense = { id: "offense-to-decline", type: "attackRollMessage" };
        gameStub.users.set(sender.id, sender);
        gameStub.messages.set(offense.id, offense);
        const payload = {
            type: "decline-active-defense",
            senderId: sender.id,
            recipientId: gameStub.user.id,
            messageId: offense.id,
        };

        await socketHandler(payload);
        assert.deepEqual(callsOf("declineActiveDefenseForUser"), []);

        behavior.canUserDeclineActiveDefense = () => true;
        await socketHandler(payload);
        assert.deepEqual(callsOf("declineActiveDefenseForUser"), [[offense, sender]]);
    });

    await t.test("offense follow-ups are serialized by the recipient GM and return their latest message", async () => {
        resetHarness(gameStub);
        const sender = { id: "attacker", isGM: false };
        const gm = { id: "gm", isGM: true };
        const offense = { id: "offense-follow-up", type: "attackRollMessage" };
        const successor = { id: "offense-successor", type: "attackRollMessage" };
        gameStub.user = gm;
        gameStub.users.set(sender.id, sender);
        gameStub.users.set(gm.id, gm);
        gameStub.messages.set(offense.id, offense);
        const payload = {
            type: "begin-offense-follow-up",
            senderId: sender.id,
            recipientId: gm.id,
            requestId: "request-follow-up",
            messageId: offense.id,
        };

        behavior.beginOffenseFollowUp = async () => successor;
        await socketHandler(payload);
        assert.deepEqual(callsOf("beginOffenseFollowUp"), [[offense, sender, { notify: false }]]);
        assert.deepEqual(callsOf("socketEmit"), [["module.splittermond-smoother-fight", {
            type: "begin-offense-follow-up-result",
            senderId: gm.id,
            recipientId: sender.id,
            requestId: payload.requestId,
            messageId: offense.id,
            allowed: true,
            latestMessageId: successor.id,
            reason: null,
        }]]);

        callLog.length = 0;
        gameStub.user = sender;
        await socketHandler({
            type: "begin-offense-follow-up-result",
            senderId: "unknown",
            recipientId: sender.id,
            requestId: payload.requestId,
            messageId: offense.id,
            allowed: true,
            latestMessageId: successor.id,
        });
        assert.deepEqual(callsOf("finishOffenseFollowUpRequest"), []);

        const result = {
            type: "begin-offense-follow-up-result",
            senderId: gm.id,
            recipientId: sender.id,
            requestId: payload.requestId,
            messageId: offense.id,
            allowed: true,
            latestMessageId: successor.id,
            reason: null,
        };
        await socketHandler(result);
        assert.deepEqual(callsOf("finishOffenseFollowUpRequest"), [[result, gm]]);
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

    await t.test("defense splinterpoints are routed only by their recipient GM", async () => {
        resetHarness(gameStub);
        const sender = { id: "splinter-sender", isGM: false };
        const message = { id: "splinter-attack", type: "attackRollMessage" };
        gameStub.users.set(sender.id, sender);
        gameStub.messages.set(message.id, message);
        const payload = {
            type: "apply-defense-splinterpoint",
            senderId: sender.id,
            recipientId: gameStub.user.id,
            messageId: message.id,
            spenderActorUuid: "Actor.resonator",
        };

        await socketHandler(payload);
        assert.deepEqual(callsOf("applyDefenseSplinterpointForUser"), []);

        gameStub.user.isGM = true;
        await socketHandler(payload);
        assert.deepEqual(callsOf("applyDefenseSplinterpointForUser"), [[
            message,
            payload.spenderActorUuid,
            sender,
        ]]);

        callLog.length = 0;
        await socketHandler({ ...payload, recipientId: "different-gm" });
        await socketHandler({ ...payload, senderId: "unknown" });
        assert.deepEqual(callsOf("applyDefenseSplinterpointForUser"), []);
    });
});
