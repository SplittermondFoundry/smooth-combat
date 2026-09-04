import { services } from "../../core/services.js";

import {
    healthCostTotal,
} from "../../combat-rules.js";

import {
    MODULE_ID,
    SOCKET,
} from "../../core/constants.js";

import {
    escapeHtml,
    localizeSystem,
    t,
} from "../../shared/values.js";

const damageApplicationLocks = new Set();
const defenseNumbingDamageLocks = new Set();
const remoteDefenseNumbingDamageRequests = new Map();
const remoteDamageApplicationRequests = new Map();
const remoteDamageFinalizationRequests = new Map();
const staleDamageApplicationTimers = new Map();
const DAMAGE_APPLICATION_STATES = new Set(["idle", "applying", "completed", "uncertain"]);
const DAMAGE_APPLICATION_STALE_AFTER_MS = 30_000;
const REMOTE_DAMAGE_APPLICATION_TIMEOUT_MS = 15_000;

function primaryTargetTokenUuid(context) {
    return context?.primaryTargetTokenUuid ?? context?.targetTokenUuid ?? null;
}

export async function withTrackedDamageApplication(message, callback, action = "applyDamageToUserTargets") {
    if (!isDamageApplicationAction(action)) return callback();
    if (damageApplicationLocks.has(message.id) || isDamageApplicationBlocked(message)) return;
    damageApplicationLocks.add(message.id);
    let application = null;
    let callbackResult;
    let callbackError = null;
    try {
        await setDamageApplicationState(message, "applying");
        application = {
            messageId: message.id,
            actorUuids: damageApplicationActorUuids(message, action),
            completionPromises: [],
        };
        services.addPendingDamageApplication(application);
        try {
            callbackResult = await callback();
        } catch (error) {
            callbackError = error;
        }

        const outcomes = await Promise.all(application.completionPromises);
        if (callbackError) {
            const failureState = damageFailureState(outcomes);
            try {
                await setDamageApplicationState(message, failureState);
            } finally {
                await requestContinuousActionInterruptions(message, outcomes);
            }
            throw callbackError;
        }
        if (!outcomes.length) {
            await setDamageApplicationState(message, "idle");
            return callbackResult;
        }
        if (outcomes.every((outcome) => outcome.status === "completed")) {
            try {
                await setDamageApplicationState(message, "completed");
            } catch (error) {
                await persistUncertainDamageState(message, error);
                await requestContinuousActionInterruptions(message, outcomes);
                throw error;
            }
            await requestContinuousActionInterruptions(message, outcomes);
            return callbackResult;
        }

        const failureState = damageFailureState(outcomes);
        try {
            await setDamageApplicationState(message, failureState);
        } finally {
            await requestContinuousActionInterruptions(message, outcomes);
        }
        throw outcomes.find((outcome) => outcome.error)?.error ?? new Error("Damage cost application failed");
    } finally {
        if (application) services.removePendingDamageApplication(application);
        damageApplicationLocks.delete(message.id);
    }
}

async function requestContinuousActionInterruptions(message, outcomes) {
    const damageByActor = new Map();
    for (const outcome of outcomes) {
        const actorUuid = outcome?.actorUuid;
        const damage = Number(outcome?.damage);
        if (!actorUuid || !Number.isFinite(damage) || damage <= 0) continue;
        const current = damageByActor.get(actorUuid) ?? { actorUuid, tokenUuid: outcome.tokenUuid ?? null, damage: 0 };
        current.damage += damage;
        current.tokenUuid ??= outcome.tokenUuid ?? null;
        damageByActor.set(actorUuid, current);
    }
    const linkedTarget = resolveDamageApplicationTarget(message);
    const results = await Promise.allSettled(Array.from(damageByActor.values(), (entry) => (
        services.requestContinuousActionInterruptionForDamage?.({
            ...entry,
            tokenUuid: linkedTarget?.actor?.uuid === entry.actorUuid ? linkedTarget.uuid : entry.tokenUuid,
            sourceMessageId: message.id,
        })
    )));
    for (const result of results) {
        if (result.status === "rejected") {
            console.error(`${MODULE_ID} | Could not request a continuous-action interruption`, result.reason);
        }
    }
}

function damageFailureState(outcomes) {
    if (!outcomes.length) return "idle";
    const safelyUnchanged = outcomes.every((outcome) => outcome.status === "failed" && !outcome.healthChanged);
    return safelyUnchanged ? "idle" : "uncertain";
}

async function persistUncertainDamageState(message, originalError) {
    try {
        await setDamageApplicationState(message, "uncertain");
    } catch (stateError) {
        console.error(`${MODULE_ID} | Could not persist uncertain damage state after a failed completion write`, {
            originalError,
            stateError,
        });
    }
}

function damageApplicationActorUuids(message, action) {
    const actorUuids = new Set();
    const normalized = String(action ?? "").trim().toLocaleLowerCase();
    if (normalized === "applydamagetoself") {
        const speakerActorUuid = services.resolveSpeakerActor(message)?.uuid;
        if (speakerActorUuid) actorUuids.add(speakerActorUuid);
        return actorUuids;
    }
    if (normalized === "applydamagetotargets") {
        for (const target of game.user?.targets ?? []) {
            const actorUuid = target?.document?.actor?.uuid ?? target?.actor?.uuid;
            if (actorUuid) actorUuids.add(actorUuid);
        }
    }
    const linkedTarget = resolveDamageApplicationTarget(message);
    if (linkedTarget?.actor?.uuid) actorUuids.add(linkedTarget.actor.uuid);
    return actorUuids;
}

export function isDamageApplicationAction(action) {
    return ["applydamagetotargets", "applydamagetousertargets", "applydamagetoself"].includes(
        String(action ?? "").trim().toLocaleLowerCase()
    );
}

export function getDamageApplicationState(message, now = Date.now()) {
    if (!message) return "idle";
    const record = message.getFlag?.(MODULE_ID, "damageApplication")
        ?? message.flags?.[MODULE_ID]?.damageApplication;
    if (DAMAGE_APPLICATION_STATES.has(record?.state)) {
        if (record.state !== "applying") return record.state;
        if (damageApplicationLocks.has(message.id)) return "applying";
        const startedAt = Number(record.startedAt);
        if (Number.isFinite(startedAt) && now - startedAt < DAMAGE_APPLICATION_STALE_AFTER_MS) {
            scheduleStaleDamageRender(message.id, DAMAGE_APPLICATION_STALE_AFTER_MS - (now - startedAt));
            return "applying";
        }
        return "uncertain";
    }
    if (
        services.hasCompletedDamageApplication(message.id)
        || message.getFlag?.(MODULE_ID, "damageApplicationCompleted")
        || message.flags?.[MODULE_ID]?.damageApplicationCompleted
    ) return "completed";
    if (hasLegacyDamageApplicationStarted(message)) return "uncertain";
    return "idle";
}

export async function setDamageApplicationState(message, state, metadata = {}) {
    if (!message || !DAMAGE_APPLICATION_STATES.has(state)) {
        throw new Error(`Invalid damage application state: ${state}`);
    }
    const previous = message.getFlag?.(MODULE_ID, "damageApplication")
        ?? message.flags?.[MODULE_ID]?.damageApplication
        ?? {};
    const now = Date.now();
    const record = {
        state,
        attemptId: state === "applying" ? createDamageAttemptId() : previous.attemptId ?? null,
        startedAt: state === "applying" ? now : previous.startedAt ?? null,
        updatedAt: now,
        initiatedBy: state === "applying" ? game.user?.id ?? null : previous.initiatedBy ?? null,
        ...metadata,
    };
    await services.setRequiredFlag(message, "damageApplication", record);
    if (state !== "applying") clearStaleDamageRender(message.id);
    if (state === "completed") services.recordCompletedDamageApplication(message.id);
    return record;
}

export function getNumbingDamageApplicationState(message, now = Date.now()) {
    if (defenseNumbingDamageLocks.has(message?.id)) return "applying";
    const context = services.getMessageContext(message) ?? {};
    const record = context.numbingDamageApplication;
    if (DAMAGE_APPLICATION_STATES.has(record?.state)) {
        if (record.state !== "applying") return record.state;
        if (defenseNumbingDamageLocks.has(message?.id)) return "applying";
        const startedAt = Number(record.startedAt);
        if (Number.isFinite(startedAt) && now - startedAt < DAMAGE_APPLICATION_STALE_AFTER_MS) {
            scheduleStaleDamageRender(`numbing:${message?.id}`, DAMAGE_APPLICATION_STALE_AFTER_MS - (now - startedAt));
            return "applying";
        }
        return "uncertain";
    }
    if (context.numbingDamageApplied) return "completed";
    if (context.numbingDamageApplicationStarted) return "uncertain";
    return "idle";
}

async function setNumbingDamageApplicationState(message, state, metadata = {}) {
    if (!message || !DAMAGE_APPLICATION_STATES.has(state)) {
        throw new Error(`Invalid defense stun-damage application state: ${state}`);
    }
    const context = services.getMessageContext(message) ?? {};
    const previous = context.numbingDamageApplication ?? {};
    const now = Date.now();
    await services.setRequiredFlag(message, "context", {
        ...context,
        numbingDamage: metadata.damage ?? context.numbingDamage ?? null,
        numbingDamageApplication: {
            state,
            attemptId: state === "applying" ? createDamageAttemptId() : previous.attemptId ?? null,
            startedAt: state === "applying" ? now : previous.startedAt ?? null,
            updatedAt: now,
            initiatedBy: state === "applying" ? game.user?.id ?? null : previous.initiatedBy ?? null,
        },
        numbingDamageApplicationStarted: state !== "idle",
        numbingDamageApplied: state === "completed",
    });
    if (state !== "applying") clearStaleDamageRender(`numbing:${message.id}`);
}

function createDamageAttemptId() {
    return globalThis.foundry?.utils?.randomID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function scheduleStaleDamageRender(key, delay) {
    if (!key || staleDamageApplicationTimers.has(key)) return;
    const timeoutId = setTimeout(() => {
        staleDamageApplicationTimers.delete(key);
        services.scheduleRender(0);
    }, Math.max(0, delay) + 25);
    timeoutId?.unref?.();
    staleDamageApplicationTimers.set(key, timeoutId);
}

function clearStaleDamageRender(key) {
    const timeoutId = staleDamageApplicationTimers.get(key);
    if (timeoutId) clearTimeout(timeoutId);
    staleDamageApplicationTimers.delete(key);
}

export async function applyDefenseNumbingDamage(message, fallbackDamage) {
    if (!game.user?.isGM) return requestRemoteDefenseNumbingDamage(message, fallbackDamage);
    return applyDefenseNumbingDamageForUser(message, fallbackDamage, game.user);
}

function requestRemoteDefenseNumbingDamage(message, fallbackDamage) {
    const actor = services.resolveSpeakerActor(message);
    const context = services.getMessageContext(message) ?? {};
    const damage = Math.max(0, Number.parseInt(context.numbingDamage ?? fallbackDamage, 10) || 0);
    if (!message?.id || !actor || !damage || !services.mayUserApplyDamageToActor(game.user, actor)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenseDamageNotAllowed"));
        return false;
    }
    if (defenseNumbingDamageLocks.has(message.id) || getNumbingDamageApplicationState(message) !== "idle") return false;
    const gm = services.getActivePrimaryGm();
    if (!gm) {
        ui.notifications.warn(localizeSystem("splittermond.chatCard.noGMConnected", "Kein GM verbunden."));
        return false;
    }

    const requestId = createDamageAttemptId();
    defenseNumbingDamageLocks.add(message.id);
    services.scheduleRender(0);
    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            remoteDefenseNumbingDamageRequests.delete(requestId);
            defenseNumbingDamageLocks.delete(message.id);
            ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
            services.scheduleRender(0);
            resolve(false);
        }, REMOTE_DAMAGE_APPLICATION_TIMEOUT_MS);
        timeoutId?.unref?.();
        remoteDefenseNumbingDamageRequests.set(requestId, {
            gmId: gm.id,
            messageId: message.id,
            resolve,
            timeoutId,
        });
        game.socket.emit(SOCKET, {
            type: "defense-numbing-damage-request",
            senderId: game.user.id,
            recipientId: gm.id,
            requestId,
            messageId: message.id,
            damage,
        });
    });
}

export async function applyRemoteDefenseNumbingDamage(message, fallbackDamage, user) {
    if (!game.user?.isGM || !message || !user) return { state: "idle", error: "invalid" };
    const actor = services.resolveSpeakerActor(message);
    if (!actor || !services.mayUserApplyDamageToActor(user, actor)) {
        return { state: getNumbingDamageApplicationState(message), error: "not-allowed" };
    }
    try {
        await applyDefenseNumbingDamageForUser(message, fallbackDamage, user);
        return { state: getNumbingDamageApplicationState(message), error: null };
    } catch (error) {
        console.error(`${MODULE_ID} | Remote defense stun damage failed`, error);
        return { state: getNumbingDamageApplicationState(message), error: "failed" };
    }
}

export function finishRemoteDefenseNumbingDamage(payload, sender) {
    const request = remoteDefenseNumbingDamageRequests.get(payload?.requestId);
    if (!request
        || sender?.id !== request.gmId
        || payload?.messageId !== request.messageId) return false;
    clearTimeout(request.timeoutId);
    remoteDefenseNumbingDamageRequests.delete(payload.requestId);
    defenseNumbingDamageLocks.delete(request.messageId);
    if (payload.error) ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
    services.scheduleRender(0);
    request.resolve(!payload.error && payload.state === "completed");
    return true;
}

async function applyDefenseNumbingDamageForUser(message, fallbackDamage, user) {
    if (defenseNumbingDamageLocks.has(message.id)) return;
    const actor = services.resolveSpeakerActor(message);
    if (!actor || !services.mayUserApplyDamageToActor(user, actor)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenseDamageNotAllowed"));
        return false;
    }
    const context = services.getMessageContext(message) ?? {};
    if (getNumbingDamageApplicationState(message) !== "idle") return false;
    const damage = Math.max(0, Number.parseInt(context.numbingDamage ?? fallbackDamage, 10) || 0);
    if (!damage) return false;

    defenseNumbingDamageLocks.add(message.id);
    const previousHealthCost = healthCostTotal(actor.system?.health);
    try {
        await setNumbingDamageApplicationState(message, "applying", { damage });
        try {
            await actor.consumeCost("health", String(damage), t("SMOOTHER_FIGHT.HUD.DefenseNumbingDamageSource"));
        } catch (error) {
            const healthChanged = healthCostTotal(actor.system?.health) !== previousHealthCost;
            await setNumbingDamageApplicationState(message, healthChanged ? "uncertain" : "idle", { damage });
            throw error;
        }
        try {
            await setNumbingDamageApplicationState(message, "completed", { damage });
        } catch (error) {
            try {
                await setNumbingDamageApplicationState(message, "uncertain", { damage });
            } catch (stateError) {
                console.error(`${MODULE_ID} | Could not persist uncertain defense stun-damage state`, stateError);
            }
            throw error;
        }
        ui.notifications.info(t("SMOOTHER_FIGHT.HUD.DefenseNumbingDamageApplied", { damage, name: actor.name }));
        services.scheduleRender(0);
        return true;
    } finally {
        defenseNumbingDamageLocks.delete(message.id);
    }
}

export async function applyDamageToLinkedTarget(message, actionData, target = resolveDamageApplicationTarget(message)) {
    const tokenObject = target?.object ?? globalThis.canvas?.tokens?.get(target?.id);
    if (!target || !tokenObject) return;
    await services.withTemporarySystemTargets([target], () =>
        message.system.handleGenericAction({ ...actionData, action: "applyDamageToTargets" })
    );
}

export async function applyOwnedSelfDamage(message, actionData, target) {
    if (!message?.id || !target?.actor || damageApplicationLocks.has(message.id) || isDamageApplicationBlocked(message)) return;
    const gm = services.getActivePrimaryGm();
    if (!gm) {
        ui.notifications.warn(localizeSystem("splittermond.chatCard.noGMConnected", "Kein GM verbunden."));
        return;
    }

    damageApplicationLocks.add(message.id);
    const application = {
        messageId: message.id,
        actorUuids: new Set([target.actor.uuid].filter(Boolean)),
        completionPromises: [],
    };
    services.addPendingDamageApplication(application);
    let callbackResult;
    let callbackError = null;
    try {
        try {
            callbackResult = await services.withTemporarySystemTargets([target], () =>
                message.system.handleGenericAction({ ...actionData, action: "applyDamageToTargets" })
            );
        } catch (error) {
            callbackError = error;
        }
        const outcomes = await Promise.all(application.completionPromises);
        if (!outcomes.length) {
            if (callbackError) throw callbackError;
            return callbackResult;
        }
        const state = callbackError
            ? damageFailureState(outcomes)
            : outcomes.every((outcome) => outcome.status === "completed") ? "completed" : damageFailureState(outcomes);
        let finalizationError = null;
        if (state !== "idle") {
            const result = await requestRemoteDamageFinalization(message, target, state, gm);
            if (result?.error || result?.state !== state) {
                finalizationError = callbackError ?? new Error("Damage application finalization failed");
            }
        }
        await requestContinuousActionInterruptions(message, outcomes);
        if (finalizationError) throw finalizationError;
        if (callbackError) throw callbackError;
        if (state === "idle") throw outcomes.find((outcome) => outcome.error)?.error ?? new Error("Damage cost application failed");
        return callbackResult;
    } finally {
        services.removePendingDamageApplication(application);
        damageApplicationLocks.delete(message.id);
    }
}

function requestRemoteDamageFinalization(message, target, state, gm) {
    const requestId = createDamageAttemptId();
    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            remoteDamageFinalizationRequests.delete(requestId);
            resolve({ state: "uncertain", error: "timeout" });
        }, REMOTE_DAMAGE_APPLICATION_TIMEOUT_MS);
        timeoutId?.unref?.();
        remoteDamageFinalizationRequests.set(requestId, { gmId: gm.id, messageId: message.id, resolve, timeoutId });
        game.socket.emit(SOCKET, {
            type: "damage-application-completed",
            senderId: game.user.id,
            recipientId: gm.id,
            requestId,
            messageId: message.id,
            actorUuid: target.actor.uuid ?? null,
            tokenUuid: target.uuid ?? null,
            state,
        });
    });
}

export async function finalizeRemoteDamageApplication(message, payload, user) {
    const state = payload?.state === "uncertain" ? "uncertain" : payload?.state === "completed" ? "completed" : null;
    const target = resolveDamageApplicationTarget(message);
    const submittedTarget = services.resolveToken(payload?.tokenUuid);
    const actor = submittedTarget?.actor ?? null;
    const exactTarget = Boolean(target?.actor && actor
        && target.uuid === submittedTarget.uuid
        && target.actor.uuid === actor.uuid
        && (!payload?.actorUuid || actor.uuid === payload.actorUuid));
    if (!state || !exactTarget || !services.mayUserApplyDamageToActor(user, actor)) {
        return { state: getDamageApplicationState(message), error: "not-allowed" };
    }
    try {
        await setDamageApplicationState(message, state, { initiatedBy: user.id });
        services.scheduleRender(0);
        return { state, error: null };
    } catch (error) {
        console.error(`${MODULE_ID} | Could not finalize client-owned damage application`, error);
        return { state: getDamageApplicationState(message), error: "failed" };
    }
}

export function validateLinkedDamageTarget(message, user, notify = false) {
    const target = resolveDamageApplicationTarget(message);
    const tokenObject = target?.object ?? globalThis.canvas?.tokens?.get(target?.id);
    if (!target || !tokenObject) {
        if (notify) ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DamageTargetMissing"));
        return null;
    }
    if (!services.mayUserApplyDamageToActor(user, target.actor)) {
        if (notify) ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DamageTargetNotOwned"));
        return null;
    }
    return target;
}

export function requestRemoteDamageApplication(message, actionData) {
    const gm = services.getActivePrimaryGm();
    if (!gm) {
        ui.notifications.warn(localizeSystem("splittermond.chatCard.noGMConnected", "Kein GM verbunden."));
        return;
    }
    const requestId = createDamageAttemptId();
    damageApplicationLocks.add(message.id);
    clearRemoteDamageApplicationRequest(message.id);
    const timeoutId = setTimeout(() => {
        const request = remoteDamageApplicationRequests.get(message.id);
        if (request?.requestId !== requestId) return;
        remoteDamageApplicationRequests.delete(message.id);
        damageApplicationLocks.delete(message.id);
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DamageApplicationNoResponse"));
        services.scheduleRender(0);
    }, REMOTE_DAMAGE_APPLICATION_TIMEOUT_MS);
    timeoutId?.unref?.();
    remoteDamageApplicationRequests.set(message.id, {
        gmId: gm.id,
        requestId,
        timeoutId,
    });
    game.socket.emit(SOCKET, {
        type: "damage-application-request",
        senderId: game.user.id,
        recipientId: gm.id,
        requestId,
        messageId: message.id,
        actionData,
    });
}

export async function applyRemoteDamageApplication(message, actionData, user) {
    const action = actionData?.action;
    if (!message || !user || !isDamageApplicationAction(action)) {
        return { state: "idle", error: "invalid" };
    }
    const normalized = String(action).trim().toLocaleLowerCase();
    const appliesToSelf = normalized === "applydamagetoself";
    const targets = appliesToSelf
        ? [resolveDamageApplicationTarget(message)].filter(Boolean)
        : normalized === "applydamagetotargets"
            ? services.getTargetSelectionForUser(user).targets
            : [resolveDamageApplicationTarget(message)].filter(Boolean);
    const targetActors = targets.map((target) => target?.actor).filter(Boolean);
    if (!targetActors.length || targetActors.length !== targets.length) {
        return { state: "idle", error: "missing-target" };
    }
    if (!targetActors.every((actor) => services.mayUserApplyDamageToActor(user, actor))) {
        return { state: "idle", error: "not-allowed" };
    }

    try {
        const appliedAction = normalized === "applydamagetotargets"
            ? actionData
            : { ...actionData, action: "applyDamageToTargets" };
        await services.withTemporarySystemTargets(targets, () =>
            withTrackedDamageApplication(message, () => message.system.handleGenericAction(appliedAction), appliedAction.action)
        );
        if (getDamageApplicationState(message) === "completed") await refreshDamageMessageContent(message);
        return { state: getDamageApplicationState(message), error: null };
    } catch (error) {
        console.error(`${MODULE_ID} | Remote damage application failed`, error);
        return { state: getDamageApplicationState(message), error: "failed" };
    }
}

async function refreshDamageMessageContent(message) {
    if (typeof globalThis.renderTemplate !== "function" || typeof message?.update !== "function") return;
    try {
        const content = await globalThis.renderTemplate(message.system.template, message.system.getData());
        await message.update({ content });
    } catch (error) {
        console.error(`${MODULE_ID} | Could not refresh a remotely applied damage card`, error);
    }
}

export function finishRemoteDamageApplication(messageId, result = {}) {
    const finalization = remoteDamageFinalizationRequests.get(result.requestId);
    if (finalization && finalization.messageId === messageId) {
        clearTimeout(finalization.timeoutId);
        remoteDamageFinalizationRequests.delete(result.requestId);
        finalization.resolve(result);
        services.scheduleRender(0);
        return;
    }
    const request = remoteDamageApplicationRequests.get(messageId);
    if (!request
        || result.requestId !== request.requestId
        || result.senderId !== request.gmId) return false;
    clearRemoteDamageApplicationRequest(messageId, result.requestId);
    damageApplicationLocks.delete(messageId);
    if (result.error === "missing-target") ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DamageTargetMissing"));
    else if (result.error === "not-allowed") ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DamageTargetNotOwned"));
    else if (result.error) ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
    services.scheduleRender(0);
    return true;
}

function clearRemoteDamageApplicationRequest(messageId, requestId = null) {
    const request = remoteDamageApplicationRequests.get(messageId);
    if (!request || (requestId && request.requestId !== requestId)) return false;
    if (request.timeoutId) clearTimeout(request.timeoutId);
    remoteDamageApplicationRequests.delete(messageId);
    return true;
}

export function resolveDamageApplicationTarget(message) {
    const directTargetUuid = primaryTargetTokenUuid(services.getMessageContext(message));
    if (directTargetUuid) {
        const directTarget = services.resolveToken(directTargetUuid);
        return directTarget && (game.user.isGM || !directTarget.hidden) ? directTarget : null;
    }

    const hudContext = services.getHudContext();
    if (!hudContext) return null;
    const group = services.collectCombatEventGroups(hudContext).find((candidate) =>
        candidate.damages.some((damage) => damage.id === message.id)
    );
    const attackTargetUuid = primaryTargetTokenUuid(services.getMessageContext(group?.primary));
    if (attackTargetUuid) {
        const attackTarget = services.resolveToken(attackTargetUuid);
        return attackTarget && (game.user.isGM || !attackTarget.hidden) ? attackTarget : null;
    }

    const speakerActor = services.resolveSpeakerActor(message);
    const sameActiveActor = speakerActor?.id && speakerActor.id === hudContext.actor?.id;
    return sameActiveActor ? hudContext.target : null;
}

export function isDamageApplicationCompleted(message) {
    return getDamageApplicationState(message) === "completed";
}

export function isDamageApplicationBlocked(message) {
    return Boolean(message && (damageApplicationLocks.has(message.id) || getDamageApplicationState(message) !== "idle"));
}

function hasLegacyDamageApplicationStarted(message) {
    return Boolean(
        message
        && (message.getFlag?.(MODULE_ID, "damageApplicationStarted")
            || message.flags?.[MODULE_ID]?.damageApplicationStarted)
    );
}

export function damageApplicationTitle(state) {
    if (state === "completed") return t("SMOOTHER_FIGHT.HUD.AlreadyApplied");
    if (state === "applying") return t("SMOOTHER_FIGHT.HUD.DamageApplying");
    if (state === "uncertain") return t("SMOOTHER_FIGHT.HUD.DamageApplicationUncertain");
    return "";
}

export function addDamageRecoveryActions(element, kind) {
    if (!game.user?.isGM || element.querySelector(`[data-sf-damage-recovery-for="${kind}"]`)) return;
    const actions = document.createElement("div");
    actions.className = "sf-damage-recovery-actions";
    actions.dataset.sfDamageRecoveryFor = kind;
    actions.innerHTML = `<span><i class="fa-solid fa-triangle-exclamation"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DamageApplicationUncertain"))}</span>`;
    for (const [decision, icon, label] of [
        ["retry", "fa-rotate-left", t("SMOOTHER_FIGHT.HUD.RetryDamageApplication")],
        ["complete", "fa-check", t("SMOOTHER_FIGHT.HUD.MarkDamageApplicationCompleted")],
    ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sf-damage-recovery-action";
        button.dataset.sfDamageRecovery = decision;
        button.dataset.sfDamageKind = kind;
        button.innerHTML = `<i class="fa-solid ${icon}"></i>${escapeHtml(label)}`;
        actions.append(button);
    }
    element.append(actions);
}

export async function recoverDamageApplication(message, decision, kind) {
    if (!game.user?.isGM || !["retry", "complete"].includes(decision)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.GmOnly"));
        return;
    }
    const state = decision === "complete" ? "completed" : "idle";
    if (kind === "numbing") await setNumbingDamageApplicationState(message, state);
    else await setDamageApplicationState(message, state, { recoveredBy: game.user.id });
    ui.notifications.info(t(decision === "complete"
        ? "SMOOTHER_FIGHT.HUD.DamageApplicationMarkedCompleted"
        : "SMOOTHER_FIGHT.HUD.DamageApplicationReset"));
    services.scheduleRender(0);
}
