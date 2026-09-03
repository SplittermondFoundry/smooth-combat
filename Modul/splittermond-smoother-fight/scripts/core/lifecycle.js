import { services } from "./services.js";

import { getApplicableCombat } from "./combat-compatibility.js";

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
    const combatProgressHooks = new Set(["combatStart", "combatRound", "combatTurn", "updateCombat"]);
    const combatPositionItemHooks = new Set(["createItem", "updateItem", "deleteItem"]);
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
    rerenderHooks.forEach((hook) => Hooks.on(hook, (document) => {
        services.scheduleRender();
        if (combatPositionItemHooks.has(hook)) {
            void services.refreshCombatPositionOverlaysForActor(document?.parent ?? document?.actor);
        }
        if (combatProgressHooks.has(hook)) {
            void services.advanceContinuousActions(document);
            void services.advancePendingMovements(document);
        }
    }));
    Hooks.on("controlToken", (token, controlled) => {
        services.installSystemActionBarActiveDefenseInterceptor?.();
        if (!controlled) services.clearTemporaryMovementRoutePreview(token);
        services.scheduleRender(0);
    });
    Hooks.on("canvasTearDown", () => services.clearMovementRoutePreview());
    Hooks.on("canvasPan", () => services.refreshMovementRoutePreviewScale());
    Hooks.on("userConnected", () => {
        const combat = getApplicableCombat();
        services.scheduleRender(0);
        void services.advanceContinuousActions(combat);
        void services.advancePendingMovements(combat);
    });
    Hooks.on("sightRefresh", () => services.scheduleRender(0));
    Hooks.on("updateToken", (token, changes, options, userId) => {
        if (Object.hasOwn(changes ?? {}, "hidden")) services.scheduleRender(0);
        if (hasTokenPositionUpdate(changes)) {
            runAuthoritativeCleanup(() => services.resetCompletedMovementReversalApplication(token));
            void services.cancelMovementPlanAfterManualMove(token, options, userId);
            services.scheduleRenderAfterTokenMovement(token);
        }
        services.syncDefaultMovementRoutePreviews(getApplicableCombat());
        void services.refreshCombatPositionOverlay(token);
    });
    Hooks.on("drawToken", (token) => void services.refreshCombatPositionOverlay(token));
    Hooks.on("recordToken", () => {
        if (getSetting("movementTracking", true)) services.scheduleRender(0);
    });

    Hooks.on("canvasReady", (...args) => {
        const combat = getApplicableCombat();
        services.seedHealthFeedbackState(...args);
        services.reconcileControlledCombatTokenSelection(combat);
        void services.advanceContinuousActions(combat);
        void services.advancePendingMovements(combat);
        services.syncDefaultMovementRoutePreviews(combat);
        void services.refreshAllCombatPositionOverlays();
    });
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
        const combat = combatant?.parent ?? getApplicableCombat();
        setTimeout(() => {
            services.syncActiveCombatantTokenSelection(combat);
            services.announceTurnFeedback(combat);
            void services.advanceContinuousActions(combat);
            void services.advancePendingMovements(combat);
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
        runAuthoritativeCleanup(() => Promise.all([
            services.clearAttackPreparationsForCombat(combat),
            services.clearContinuousActionsForCombat(combat),
            services.clearMovementPlansForCombat(combat),
        ]));
    });
    Hooks.on("deleteCombatant", (combatant) => {
        const combat = combatant?.parent ?? getApplicableCombat();
        setTimeout(() => {
            services.reconcileControlledCombatTokenSelection(combat);
            services.announceTurnFeedback(combat);
            void services.advanceContinuousActions(combat);
            void services.advancePendingMovements(combat);
        }, 0);
        runAuthoritativeCleanup(() => Promise.all([
            services.clearAttackPreparationForCombatant(combatant),
            services.clearContinuousActionForCombatant(combatant),
            services.clearMovementPlanForCombatant(combatant),
        ]));
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
        runAuthoritativeCleanup(() => services.clearContinuousActionInterruptionForDeletedCard(message));
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
    Hooks.on("renderTokenHUD", (app, html) => {
        services.renderTokenOwnerControl(app, html);
        services.renderTokenMovementControl(app, html);
        services.renderTokenCombatPositionControl(app, html);
    });
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

function runAuthoritativeCleanup(operation) {
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

        if (payload.type === "active-defense-pending" && payload.senderId !== game.user.id) {
            const sender = game.users.get(payload.senderId);
            const pending = payload.pending;
            if (!sender || !pending || typeof pending !== "object") return;
            if (payload.active !== false) {
                const offense = game.messages.get(pending.attackMessageId);
                const context = services.getMessageContext(offense);
                const expectedTargetUuid = context?.primaryTargetTokenUuid ?? context?.targetTokenUuid;
                const publishedTargetUuid = pending.primaryTargetTokenUuid ?? pending.targetTokenUuid;
                const target = services.resolveToken(publishedTargetUuid);
                const defender = services.resolveToken(pending.defenderTokenUuid);
                const ownsParticipant = sender.isGM || [target, defender].some((token) =>
                    token?.actor?.testUserPermission?.(sender, "OWNER")
                );
                if (!offense
                    || !isOffensiveCombatMessage(offense)
                    || !expectedTargetUuid
                    || expectedTargetUuid !== publishedTargetUuid
                    || !ownsParticipant) return;
            }
            services.receivePublishedPendingDefense(pending, sender.id, payload.active !== false);
            return;
        }

        if (payload.type === "movement-plan-abort-request"
            && payload.recipientId === game.user.id && game.user.isGM) {
            const sender = game.users.get(payload.senderId);
            const result = sender
                ? await services.applyRemoteMovementPlanAbort(payload, sender)
                : { applied: false, error: "invalid" };
            game.socket.emit(SOCKET, {
                type: "movement-plan-abort-result",
                senderId: game.user.id,
                recipientId: payload.senderId,
                requestId: payload.requestId,
                tokenUuid: payload.tokenUuid,
                planId: payload.planId,
                ...result,
            });
            return;
        }

        if (payload.type === "movement-plan-abort-result" && payload.recipientId === game.user.id) {
            const sender = game.users.get(payload.senderId);
            if (!sender?.isGM) return;
            services.finishRemoteMovementPlanAbort(payload, sender);
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

        if (payload.type === "defense-numbing-damage-request" && payload.recipientId === game.user.id && game.user.isGM) {
            const sender = game.users.get(payload.senderId);
            const message = game.messages.get(payload.messageId);
            let result = { state: "idle", error: "invalid" };
            if (sender && message && services.isDefenseMessage(message)) {
                result = await services.applyRemoteDefenseNumbingDamage(message, payload.damage, sender);
            }
            game.socket.emit(SOCKET, {
                type: "defense-numbing-damage-result",
                senderId: game.user.id,
                recipientId: payload.senderId,
                requestId: payload.requestId,
                messageId: payload.messageId,
                ...result,
            });
            return;
        }

        if (payload.type === "defense-numbing-damage-result" && payload.recipientId === game.user.id) {
            const sender = game.users.get(payload.senderId);
            if (!sender?.isGM) return;
            services.finishRemoteDefenseNumbingDamage(payload, sender);
            return;
        }

        if (payload.type === "damage-application-completed" && payload.recipientId === game.user.id && game.user.isGM) {
            const sender = game.users.get(payload.senderId);
            const message = game.messages.get(payload.messageId);
            let result = { state: "idle", error: "invalid" };
            if (sender && message && services.isDamageMessage(message)) {
                result = await services.finalizeRemoteDamageApplication(message, payload, sender);
            }
            game.socket.emit(SOCKET, {
                type: "damage-application-result",
                senderId: game.user.id,
                recipientId: payload.senderId,
                requestId: payload.requestId,
                messageId: payload.messageId,
                ...result,
            });
            return;
        }

        if (payload.type === "legacy-tick-advance-request" && payload.recipientId === game.user.id && game.user.isGM) {
            const sender = game.users.get(payload.senderId);
            const message = game.messages.get(payload.messageId);
            let result = { applied: false, error: "invalid" };
            if (sender && message) {
                result = await services.applyRemoteLegacyTickAdvance(message, {
                    offeredTicks: payload.offeredTicks,
                    ticks: payload.ticks,
                }, sender);
            }
            game.socket.emit(SOCKET, {
                type: "legacy-tick-advance-result",
                senderId: game.user.id,
                recipientId: payload.senderId,
                requestId: payload.requestId,
                messageId: payload.messageId,
                ...result,
            });
            return;
        }

        if (payload.type === "legacy-tick-advance-result" && payload.recipientId === game.user.id) {
            const sender = game.users.get(payload.senderId);
            if (!sender?.isGM) return;
            services.finishRemoteLegacyTickAdvance(payload, sender);
            return;
        }

        if (payload.type === "fumble-action-request" && payload.recipientId === game.user.id && game.user.isGM) {
            const sender = game.users.get(payload.senderId);
            const message = game.messages.get(payload.messageId);
            let result = { applied: false, error: "invalid" };
            if (sender && message && services.getFumbleData(message)) {
                result = await services.applyRemoteFumbleAction(message, payload.action, sender);
            }
            game.socket.emit(SOCKET, {
                type: "fumble-action-result",
                senderId: game.user.id,
                recipientId: payload.senderId,
                requestId: payload.requestId,
                messageId: payload.messageId,
                action: payload.action,
                ...result,
            });
            return;
        }

        if (payload.type === "fumble-action-result" && payload.recipientId === game.user.id) {
            const sender = game.users.get(payload.senderId);
            if (!sender?.isGM) return;
            services.finishRemoteFumbleAction(payload, sender);
            return;
        }

        if (payload.type === "decline-active-defense" && payload.recipientId === game.user.id && game.user.isGM) {
            const sender = game.users.get(payload.senderId);
            const offense = game.messages.get(payload.messageId);
            if (!sender || !offense || !isOffensiveCombatMessage(offense)) return;
            if (!services.canUserDeclineActiveDefense(sender, offense, payload.defenderTokenUuid)) return;
            await services.declineActiveDefenseForUser(offense, sender, payload.defenderTokenUuid);
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
