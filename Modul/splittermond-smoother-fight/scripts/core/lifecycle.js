import { services } from "./services.js";

import {
    hasTokenPositionUpdate,
    isOffensiveCombatMessage,
    normalizeTargetReferences,
} from "../combat-rules.js";

import {
    MODULE_ID,
    SOCKET,
} from "./constants.js";

import {
    asElement,
    getSetting,
} from "../shared/values.js";

export function registerHooks() {
    const rerenderHooks = [
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
    ];
    rerenderHooks.forEach((hook) => Hooks.on(hook, () => services.scheduleRender()));
    Hooks.on("controlToken", () => services.scheduleRender(0));
    Hooks.on("userConnected", () => services.scheduleRender(0));
    Hooks.on("sightRefresh", () => services.scheduleRender(0));
    Hooks.on("updateToken", (token, changes) => {
        if (Object.hasOwn(changes ?? {}, "hidden")) services.scheduleRender(0);
        if (hasTokenPositionUpdate(changes)) {
            void services.resetCompletedMovementReversalApplication(token);
            services.scheduleRenderAfterTokenMovement(token);
        }
    });
    Hooks.on("recordToken", () => {
        if (getSetting("movementTracking", true)) services.scheduleRender(0);
    });

    Hooks.on("canvasReady", services.seedHealthFeedbackState);
    Hooks.on("preUpdateActor", services.rememberActorHealthCost);
    Hooks.on("updateActor", services.announceAppliedDamageFeedback);
    Hooks.on("createActor", services.rememberActorHealthCost);
    Hooks.on("deleteActor", services.forgetActorHealthCost);

    Hooks.on("targetToken", (user, token, targeted) => {
        const targets = new Set(normalizeTargetReferences(user.targets));
        const changedUuid = services.tokenUuid(token);
        if (changedUuid) {
            if (targeted) targets.add(changedUuid);
            else targets.delete(changedUuid);
        }
        const references = Array.from(targets);
        services.rememberTargetReferences(user.id, references);
        if (user.id === game.user.id) services.publishOwnTarget(references);
        services.scheduleRender();
    });

    Hooks.on("updateCombatant", (combatant) => {
        const combat = combatant?.parent ?? game.combat;
        setTimeout(() => {
            services.syncActiveCombatantTokenSelection(combat);
            services.announceTurnFeedback(combat);
        }, 0);
    });

    Hooks.on("combatTurn", (combat) => {
        services.syncActiveCombatantTokenSelection(combat);
        services.announceTurnFeedback(combat);
        services.scheduleRender();
    });
    Hooks.on("combatStart", (combat) => {
        services.resetPersonalCombatantSelection();
        services.setLastTurnCombatantId(null);
        services.syncActiveCombatantTokenSelection(combat);
        services.announceTurnFeedback(combat);
    });
    Hooks.on("deleteCombat", (combat) => {
        runAuthoritativeAttackPreparationCleanup(() => services.clearAttackPreparationsForCombat(combat));
    });
    Hooks.on("deleteCombatant", (combatant) => {
        runAuthoritativeAttackPreparationCleanup(() => services.clearAttackPreparationForCombatant(combatant));
    });

    Hooks.on("createChatMessage", (message) => {
        void services.onCreateChatMessage(message).finally(() => services.scheduleRender(0));
        services.scheduleRender();
    });
    Hooks.on("updateChatMessage", (message, changes) => {
        void services.onUpdateChatMessage(message, changes).finally(() => services.scheduleRender(0));
        services.scheduleRender();
    });
    Hooks.on("deleteChatMessage", (message) => {
        if (services.isCombatEventMessage(message)) services.markCombatEventDeletionPending();
        services.clearCombatEventExpansionRequest();
        services.scheduleRender(0);
    });
    Hooks.on("diceSoNiceMessagePreProcess", suppressRecalculatedOffenseDice);
    Hooks.on("diceSoNiceMessageProcessed", suppressRecalculatedOffenseDiceLegacy);
    Hooks.on("diceSoNiceRollComplete", (messageId) => {
        if (game.messages?.get?.(messageId)) services.scheduleRender(0);
    });

    Hooks.on("renderChatMessageHTML", (message, html) => services.prepareRenderedChatMessage(message, html));
    Hooks.on("renderChatMessage", (message, html) => services.prepareRenderedChatMessage(message, asElement(html)));
    Hooks.on("renderTokenHUD", (app, html) => services.renderTokenOwnerControl(app, html));
    services.prepareExistingRenderedChatMessages();
}

export function suppressRecalculatedOffenseDice(messageId, interception) {
    if (!interception || typeof interception !== "object") return;
    const message = game.messages?.get?.(messageId);
    if (!services.getMessageContext?.(message)?.recalculatedFrom) return;
    interception.willTrigger3DRoll = false;
}

function suppressRecalculatedOffenseDiceLegacy(messageId, interception) {
    const version = String(game.modules?.get?.("dice-so-nice")?.version ?? "");
    const majorVersion = Number.parseInt(version, 10);
    if (Number.isFinite(majorVersion) && majorVersion >= 6) return;
    suppressRecalculatedOffenseDice(messageId, interception);
}

function runAuthoritativeAttackPreparationCleanup(operation) {
    if (services.getActivePrimaryGm?.()?.id !== globalThis.game?.user?.id) return;
    void operation().catch(() => false);
}

export function registerSocket() {
    game.socket.on(SOCKET, async (payload) => {
        if (!payload || typeof payload !== "object") return;

        if (payload.type === "target-update" && typeof payload.userId === "string") {
            const sender = game.users.get(payload.senderId);
            if (payload.senderId !== payload.userId && !sender?.isGM) return;
            const targetUuids = normalizeTargetReferences(payload.targetTokenUuids ?? payload.targetUuids ?? [payload.tokenUuid]);
            const primaryTargetTokenUuid = payload.primaryTargetTokenUuid ?? payload.targetTokenUuid ?? payload.tokenUuid ?? null;
            services.rememberTargetReferences(payload.userId, targetUuids, primaryTargetTokenUuid);
            services.scheduleRender();
            return;
        }

        if (payload.type === "set-target" && payload.recipientId === game.user.id) {
            const sender = game.users.get(payload.senderId);
            if (!sender?.isGM) return;
            const target = services.resolveToken(payload.tokenUuid);
            if (!target) return;
            services.setLocalTarget(target, payload.targeted !== false, Boolean(payload.releaseOthers));
            const targetUuids = payload.targetTokenUuids ?? payload.targetUuids;
            const primaryTargetTokenUuid = payload.primaryTargetTokenUuid
                ?? (payload.targeted === false ? undefined : payload.tokenUuid);
            if (targetUuids === undefined && primaryTargetTokenUuid === undefined) services.publishOwnTarget();
            else services.publishOwnTarget(targetUuids, primaryTargetTokenUuid);
            return;
        }

        if (payload.type === "combat-feedback" && payload.senderId !== game.user.id) {
            const sender = game.users.get(payload.senderId);
            if (!sender || payload.kind !== "damageBlocked") return;
            services.receivePublishedFeedback(payload.kind, {
                tokenUuid: payload.tokenUuid,
                actorUuid: payload.actorUuid,
            });
            return;
        }

        if (payload.type === "damage-application-request" && payload.recipientId === game.user.id && game.user.isGM) {
            const sender = game.users.get(payload.senderId);
            const message = game.messages.get(payload.messageId);
            let result = { state: "idle", error: "invalid" };
            if (sender && message && services.isDamageMessage(message)) {
                try {
                    result = await services.applyRemoteDamageApplication(message, payload.actionData, sender);
                } catch (error) {
                    console.error(`${MODULE_ID} | Could not process remote damage application`, error);
                    result = { state: "uncertain", error: "failed" };
                }
            }
            game.socket.emit(SOCKET, {
                type: "damage-application-result",
                senderId: game.user.id,
                recipientId: payload.senderId,
                messageId: payload.messageId,
                ...result,
            });
            return;
        }

        if (payload.type === "damage-application-result" && payload.recipientId === game.user.id) {
            const sender = game.users.get(payload.senderId);
            if (!sender?.isGM) return;
            services.finishRemoteDamageApplication(payload.messageId, payload);
            return;
        }

        if (payload.type === "damage-application-completed" && payload.recipientId === game.user.id && game.user.isGM) {
            const sender = game.users.get(payload.senderId);
            const message = game.messages.get(payload.messageId);
            const actor = services.resolveActorUuid(payload.actorUuid) ?? services.resolveToken(payload.tokenUuid)?.actor ?? null;
            if (!sender || !message || !services.isDamageMessage(message) || !services.mayUserApplyDamageToActor(sender, actor)) return;
            await services.setDamageApplicationState(message, "completed", { initiatedBy: sender.id });
            services.scheduleRender(0);
            return;
        }

        if (payload.type === "decline-active-defense" && payload.recipientId === game.user.id && game.user.isGM) {
            const sender = game.users.get(payload.senderId);
            const offense = game.messages.get(payload.messageId);
            if (!sender || !offense || !isOffensiveCombatMessage(offense)) return;
            if (!services.canUserDeclineActiveDefense(sender, offense)) return;
            await services.declineActiveDefenseForUser(offense, sender);
            return;
        }

        if (payload.type === "begin-offense-follow-up" && payload.recipientId === game.user.id && game.user.isGM) {
            const sender = game.users.get(payload.senderId);
            const offense = game.messages.get(payload.messageId);
            let latest = null;
            let reason = "not-allowed";
            if (sender && offense && isOffensiveCombatMessage(offense)) {
                try {
                    latest = await services.beginOffenseFollowUp(offense, sender, { notify: false });
                    if (latest) reason = null;
                    else if (services.defenseAwaitsResponse(offense)) reason = "awaiting-defense";
                } catch (error) {
                    console.error(`${MODULE_ID} | Could not begin remote offense follow-up`, error);
                    reason = "failed";
                }
            }
            game.socket.emit(SOCKET, {
                type: "begin-offense-follow-up-result",
                senderId: game.user.id,
                recipientId: payload.senderId,
                requestId: payload.requestId,
                messageId: payload.messageId,
                allowed: Boolean(latest),
                latestMessageId: latest?.id ?? null,
                reason,
            });
            return;
        }

        if (payload.type === "begin-offense-follow-up-result" && payload.recipientId === game.user.id) {
            const sender = game.users.get(payload.senderId);
            if (!sender?.isGM) return;
            await services.finishOffenseFollowUpRequest(payload, sender);
            return;
        }

        if (payload.type === "recalculate-defense" && payload.recipientId === game.user.id && game.user.isGM) {
            const sender = game.users.get(payload.senderId);
            const message = await services.waitForChatMessage(payload.defenseMessageId);
            const authorId = message?.author?.id ?? message?.user?.id ?? message?.user;
            if (!sender || !message || (!sender.isGM && authorId !== sender.id)) return;

            const pending = services.normalizePendingDefense(payload.pending);
            const offense = game.messages.get(pending?.attackMessageId);
            if (!pending || !offense || !isOffensiveCombatMessage(offense)) return;
            if (!sender.isGM && !services.canUserSubmitDefense(sender, pending, message)) return;

            await services.waitForDefenseProcessing(message.id);
            await services.processDefenseMessage(message, pending, { allowForeign: true });
            return;
        }

        if (payload.type === "apply-defense-splinterpoint" && payload.recipientId === game.user.id && game.user.isGM) {
            const sender = game.users.get(payload.senderId);
            const message = game.messages.get(payload.messageId);
            if (!sender || !message || typeof payload.spenderActorUuid !== "string") return;
            await services.applyDefenseSplinterpointForUser(message, payload.spenderActorUuid, sender);
        }
    });
}
