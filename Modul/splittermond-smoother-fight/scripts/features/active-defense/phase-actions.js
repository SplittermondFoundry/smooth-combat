import { services } from "../../core/services.js";

import {
    isOffensiveCombatMessage,
} from "../../combat-rules.js";

import {
    SOCKET,
} from "../../core/constants.js";

import {
    localizeSystem,
    t,
} from "../../shared/values.js";

import {
    DEFENSE_PHASE,
    defensePhaseForOffense,
} from "./phase.js";

import {
    queueAttackOperation,
    resolveLatestOffenseMessage,
} from "./recalculation.js";

import {
    activeDefenseState,
} from "./state.js";

const OFFENSE_FOLLOW_UP_TIMEOUT_MS = 10_000;

function primaryTargetTokenUuid(context) {
    return context?.primaryTargetTokenUuid ?? context?.targetTokenUuid ?? null;
}

function userOwnsActor(user, actor) {
    return Boolean(user?.isGM || actor?.testUserPermission?.(user, "OWNER") || (user === game.user && actor?.isOwner));
}

export function canUserDeclineActiveDefense(user, message) {
    const latest = resolveLatestOffenseMessage(message);
    if (!user || !latest || !isOffensiveCombatMessage(latest)) return false;
    const target = services.resolveToken(primaryTargetTokenUuid(services.getMessageContext(latest)));
    return Boolean(target?.actor && userOwnsActor(user, target.actor));
}

export async function declineActiveDefenseForUser(message, user) {
    if (!game.user?.isGM || !canUserDeclineActiveDefense(user, message)) return null;
    const result = await queueAttackOperation(message.id, async (_root, latest) => {
        if (!latest || !canUserDeclineActiveDefense(user, latest)) return null;
        const phase = defensePhaseForOffense(latest);
        if (phase === DEFENSE_PHASE.DECLINED) return latest;
        if (phase !== DEFENSE_PHASE.OPEN) return null;
        await services.setRequiredFlag(latest, "context", {
            ...(services.getMessageContext(latest) ?? {}),
            defensePhase: DEFENSE_PHASE.DECLINED,
            defenseDeclinedAt: Date.now(),
            defenseDeclinedBy: user.id,
        });
        return latest;
    });
    if (result) services.scheduleRender(0);
    return result;
}

export async function requestActiveDefenseDecline(message) {
    message = resolveLatestOffenseMessage(message);
    if (!message || !canUserDeclineActiveDefense(game.user, message)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenseNotAllowed"));
        return false;
    }
    if (game.user.isGM) return Boolean(await declineActiveDefenseForUser(message, game.user));

    const gm = services.getActivePrimaryGm();
    if (!gm) {
        ui.notifications.warn(localizeSystem("splittermond.chatCard.noGMConnected", "Kein GM verbunden."));
        return false;
    }
    game.socket.emit(SOCKET, {
        type: "decline-active-defense",
        senderId: game.user.id,
        recipientId: gm.id,
        messageId: message.id,
    });
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.DefenseDeclinePending"));
    return true;
}

function canUserStartOffenseFollowUp(user, message) {
    if (!user || !message) return false;
    if (user.isGM) return true;
    const actor = services.resolveSpeakerActor(message);
    const authorId = message.author?.id ?? message.user?.id ?? message.user;
    return Boolean(userOwnsActor(user, actor) || authorId === user.id);
}

export function beginOffenseFollowUp(message, user = game.user, { notify = true } = {}) {
    if (!message || !canUserStartOffenseFollowUp(user, message)) return null;
    return queueAttackOperation(message.id, async (_root, latest) => {
        if (!latest || !canUserStartOffenseFollowUp(user, latest)) return null;
        const phase = defensePhaseForOffense(latest);
        if (phase === DEFENSE_PHASE.OPEN) {
            if (notify) notifyDefenseAwaitingResponse(latest);
            return null;
        }
        if (phase === DEFENSE_PHASE.RESOLVED || phase === DEFENSE_PHASE.DECLINED) {
            await services.setRequiredFlag(latest, "context", {
                ...(services.getMessageContext(latest) ?? {}),
                defensePhase: DEFENSE_PHASE.CLOSED,
                defenseClosedAt: Date.now(),
                defenseClosedBy: user.id,
                defenseCloseReason: "follow-up",
            });
        }
        return latest;
    });
}

export function requestOffenseFollowUp(message) {
    message = resolveLatestOffenseMessage(message);
    if (!message || !canUserStartOffenseFollowUp(game.user, message)) return null;
    if (game.user.isGM) return beginOffenseFollowUp(message, game.user);

    const gm = services.getActivePrimaryGm();
    if (!gm) {
        ui.notifications.warn(localizeSystem("splittermond.chatCard.noGMConnected", "Kein GM verbunden."));
        return null;
    }
    const requestId = foundry.utils.randomID();
    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            activeDefenseState.offenseFollowUpRequests.delete(requestId);
            ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
            resolve(null);
        }, OFFENSE_FOLLOW_UP_TIMEOUT_MS);
        timeoutId?.unref?.();
        activeDefenseState.offenseFollowUpRequests.set(requestId, {
            gmId: gm.id,
            messageId: message.id,
            resolve,
            timeoutId,
        });
        game.socket.emit(SOCKET, {
            type: "begin-offense-follow-up",
            senderId: game.user.id,
            recipientId: gm.id,
            requestId,
            messageId: message.id,
        });
    });
}

export async function finishOffenseFollowUpRequest(payload, sender) {
    const request = activeDefenseState.offenseFollowUpRequests.get(payload?.requestId);
    if (!request || sender?.id !== request.gmId || payload.messageId !== request.messageId) return false;
    clearTimeout(request.timeoutId);
    activeDefenseState.offenseFollowUpRequests.delete(payload.requestId);
    const latest = payload.allowed
        ? game.messages.get(payload.latestMessageId) ?? await services.waitForChatMessage(payload.latestMessageId)
        : null;
    if (!latest && payload.reason === "awaiting-defense") {
        notifyDefenseAwaitingResponse(game.messages.get(request.messageId));
    } else if (!latest && (payload.allowed || payload.reason === "failed")) {
        ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
    }
    request.resolve(latest ?? null);
    return true;
}

function notifyDefenseAwaitingResponse(message) {
    const target = services.resolveToken(primaryTargetTokenUuid(services.getMessageContext(message)));
    ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenseAwaitingResponse", {
        target: target?.name ?? target?.actor?.name ?? "–",
    }));
}
