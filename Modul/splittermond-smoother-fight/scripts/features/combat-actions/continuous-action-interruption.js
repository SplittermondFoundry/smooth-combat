import {
    services,
} from "../../core/services.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    setRequiredDocumentFlag,
} from "../../shared/document-flags.js";

import {
    escapeAttr,
    escapeHtml,
    t,
} from "../../shared/values.js";

import {
    clearPreparationApplication,
} from "./applications.js";

import {
    clearAttackPreparation,
} from "./attack-preparation.js";

import {
    clearContinuousAction,
    getContinuousAction,
    normalizeContinuousAction,
    restoreContinuousAction,
} from "./continuous-action.js";

import {
    restoreInterruptedMovementPlan,
} from "./movement.js";

import {
    rollSkillWithDialogCancellation,
} from "./roll-dialog-outcome.js";

import {
    INTERRUPTION_FLAG,
    INTERRUPTION_VERSION,
    normalizeContinuousActionInterruption,
    readInterruptionRequests,
    withInterruptionLock,
} from "./continuous-action-interruption-state.js";

const INTERRUPTION_CARD_FLAG = "continuousActionInterruptionCard";
const INTERRUPTION_ROLL_FLAG = "continuousActionInterruptionRoll";
const INTERRUPTION_RECOVERY_CARD_FLAG = "continuousActionInterruptionRecoveryCard";
const interruptionRolls = new Set();
const interruptionRecoveries = new Set();

export { normalizeContinuousActionInterruption };

export function getPendingContinuousActionInterruption(contextOrToken, combat = globalThis.game?.combat) {
    const token = resolveTokenDocument(contextOrToken);
    const action = getContinuousAction(token, combat);
    if (!token || !action) return null;
    return readInterruptionRequests(token).find((request) => (
        requestMatchesAction(request, action) && interruptionCardExists(request)
    )) ?? null;
}

export function getPendingContinuousActionInterruptionsForCurrentUser(combat = globalThis.game?.combat) {
    return combatantsOf(combat).flatMap((combatant) => {
        const token = resolveTokenDocument(combatant?.token);
        const action = getContinuousAction(token, combat);
        if (!token || !action) return [];
        return readInterruptionRequests(token)
            .filter((request) => requestMatchesAction(request, action)
                && interruptionCardExists(request)
                && mayCurrentUserRoll(token, request, combat))
            .map((request) => ({ request, token }));
    });
}

export async function requestContinuousActionInterruptionForDamage({
    actorUuid = null,
    tokenUuid = null,
    damage = 0,
    sourceMessageId = null,
} = {}) {
    const actualDamage = Number(damage);
    if (!Number.isFinite(actualDamage) || actualDamage <= 0) return null;
    const combat = globalThis.game?.combat;
    const token = findContinuousActionToken({ actorUuid, tokenUuid }, combat);
    const action = getContinuousAction(token, combat);
    const actor = token?.actor;
    if (!token || !actor?.uuid || !action) return null;

    return withInterruptionLock(token, async () => {
        const liveAction = getContinuousAction(token, combat);
        if (!liveAction || liveAction.id !== action.id) return null;
        const retained = readInterruptionRequests(token).filter((request) => requestMatchesAction(request, liveAction));
        const duplicate = sourceMessageId && retained.find((request) => request.sourceMessageId === sourceMessageId);
        if (duplicate) return duplicate;

        const disturbingAttackLevels = disturbingAttackLevelsForDamage(sourceMessageId);
        const request = normalizeContinuousActionInterruption({
            version: INTERRUPTION_VERSION,
            id: randomId(),
            actionRecordId: liveAction.id,
            actionId: liveAction.actionId,
            combatId: liveAction.combatId,
            combatantId: liveAction.combatantId,
            tokenUuid: token.uuid,
            actorUuid: actor.uuid,
            damage: actualDamage,
            disturbingAttackLevels,
            difficulty: 10 + actualDamage + (3 * disturbingAttackLevels),
            sourceMessageId,
            createdAt: Date.now(),
            createdBy: globalThis.game?.user?.id ?? null,
        });
        if (!request) return null;

        await setRequiredDocumentFlag(token, INTERRUPTION_FLAG, [...retained, request]);
        try {
            await createInterruptionChatCard(token, request);
        } catch (error) {
            console.error(`${MODULE_ID} | Could not create the continuous-action interruption card`, error);
            globalThis.ui?.notifications?.error?.(t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptionCardFailed"));
        }
        services.scheduleRender?.(0);
        return request;
    });
}

export async function clearContinuousActionInterruptionForDeletedCard(message) {
    const card = readInterruptionCard(message);
    if (!card) return false;
    const token = resolveTokenDocument(card.tokenUuid);
    if (!token) return false;
    return removeInterruptionRequest(token, card.requestId);
}

export async function rollContinuousActionInterruption(contextOrToken, requestId = null) {
    const combat = contextOrToken?.combat ?? globalThis.game?.combat;
    const token = resolveTokenDocument(contextOrToken)
        ?? resolveTokenDocument(readInterruptionCard(contextOrToken)?.tokenUuid);
    const request = findLiveRequest(token, requestId ?? readInterruptionCard(contextOrToken)?.requestId, combat);
    const actor = token?.actor;
    if (!token || !actor || !request) {
        globalThis.ui?.notifications?.warn?.(t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptionNoLongerPending"));
        return { status: "unavailable" };
    }
    if (!mayCurrentUserRoll(token, request, combat)) {
        globalThis.ui?.notifications?.warn?.(t("SMOOTHER_FIGHT.HUD.NoOwner"));
        return { status: "forbidden" };
    }

    const rollKey = `${token.uuid}:${request.id}`;
    if (interruptionRolls.has(rollKey)) return { status: "rolling" };
    interruptionRolls.add(rollKey);
    try {
        return await performInterruptionRoll(token, actor, request, combat);
    } finally {
        interruptionRolls.delete(rollKey);
    }
}

export async function reconcileContinuousActionInterruptionRoll(message) {
    const recovery = readInterruptionRecovery(message);
    if (!recovery || recovery.status !== "interrupted" || rollSucceeded(message) !== true) return false;
    return restoreInterruptionRecovery(message, recovery);
}

export async function restoreContinuousActionFromInterruptionCard(message) {
    if (!globalThis.game?.user?.isGM) {
        globalThis.ui?.notifications?.warn?.(t("SMOOTHER_FIGHT.HUD.GmOnly"));
        return false;
    }
    const recovery = readInterruptionRecovery(message);
    if (!recovery || recovery.status !== "interrupted") {
        globalThis.ui?.notifications?.warn?.(t("SMOOTHER_FIGHT.HUD.ContinuousActionRecoveryUnavailable"));
        return false;
    }
    return restoreInterruptionRecovery(message, recovery);
}

async function restoreInterruptionRecovery(message, recovery) {
    const recoveryKey = recovery.id ?? message?.id ?? `${recovery.tokenUuid}:${recovery.action.id}`;
    if (interruptionRecoveries.has(recoveryKey)) return false;
    interruptionRecoveries.add(recoveryKey);
    try {
        const liveRecovery = readInterruptionRecovery(message);
        if (!liveRecovery || liveRecovery.status !== "interrupted") return false;
        await markInterruptionRecovery(message, liveRecovery, "restoring");
        const combat = globalThis.game?.combat;
        const token = resolveTokenDocument(liveRecovery.tokenUuid);
        if (!token || combat?.id !== liveRecovery.action.combatId) {
            await markInterruptionRecovery(message, liveRecovery, "expired");
            return false;
        }

        const current = getContinuousAction(token, combat);
        if (current && current.id !== liveRecovery.action.id) {
            await markInterruptionRecovery(message, liveRecovery, "superseded");
            return false;
        }
        const restoredAction = current
            ?? await restoreContinuousAction(token, liveRecovery.action, combat);
        if (!restoredAction) {
            await markInterruptionRecovery(message, liveRecovery, "expired");
            return false;
        }

        const resourcesRestored = await restoreInterruptedActionResources(token, liveRecovery, combat);
        if (!resourcesRestored) {
            if (!current) await clearContinuousAction(token, { expectedId: restoredAction.id });
            await markInterruptionRecovery(message, liveRecovery, "expired");
            return false;
        }
        await markInterruptionRecovery(message, liveRecovery, "restored");
        globalThis.ui?.notifications?.info?.(t("SMOOTHER_FIGHT.HUD.ContinuousActionContinues", {
            action: actionName(liveRecovery.action.actionId),
        }));
        services.scheduleRender?.(0);
        return true;
    } catch (error) {
        const liveRecovery = readInterruptionRecovery(message) ?? recovery;
        await markInterruptionRecovery(message, liveRecovery, "interrupted").catch(() => false);
        throw error;
    } finally {
        interruptionRecoveries.delete(recoveryKey);
    }
}

async function performInterruptionRoll(token, actor, request, combat) {
    const rollMessage = await rollSkillWithDialogCancellation(actor, "determination", {
        difficulty: request.difficulty,
        title: t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptionRollTitle", {
            action: actionName(request.actionId),
        }),
    }, { token });
    if (!rollMessage) return { status: "cancelled" };
    await services.waitForDiceSoNice?.(rollMessage);
    const succeeded = rollSucceeded(rollMessage);
    if (succeeded === null) {
        globalThis.ui?.notifications?.warn?.(t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptionResultUnknown"));
        return { status: "unknown", message: rollMessage };
    }

    if (succeeded) {
        await removeInterruptionRequest(token, request.id);
        globalThis.ui?.notifications?.info?.(t("SMOOTHER_FIGHT.HUD.ContinuousActionContinues", {
            action: actionName(request.actionId),
        }));
    } else {
        const recovery = captureInterruptionRecovery(token, request, combat, "failedDetermination");
        await setRequiredDocumentFlag(
            rollMessage,
            INTERRUPTION_ROLL_FLAG,
            recovery,
        );
        const interrupted = await interruptContinuousAction(token, request, combat);
        if (interrupted) {
            const recoveryCard = await createInterruptionRecoveryChatCardSafely(token, {
                ...recovery,
                sourceRollMessageId: rollMessage.id,
            });
            if (recoveryCard?.id) {
                await rollMessage.setFlag?.(MODULE_ID, INTERRUPTION_ROLL_FLAG, {
                    ...recovery,
                    recoveryMessageId: recoveryCard.id,
                }).catch((error) => {
                    console.error(`${MODULE_ID} | Could not link the interruption roll to its recovery card`, error);
                });
            }
        }
        globalThis.ui?.notifications?.warn?.(t("SMOOTHER_FIGHT.HUD.ContinuousActionInterrupted", {
            action: actionName(request.actionId),
        }));
    }
    services.scheduleRender?.(0);
    return { status: succeeded ? "succeeded" : "failed", message: rollMessage };
}

export async function confirmContinuousActionInterruptionForActiveDefense(tokenLike, { skillId = null } = {}) {
    const token = resolveTokenDocument(tokenLike);
    const action = getContinuousAction(token, globalThis.game?.combat);
    if (!action || activeDefensePreservesContinuousAction(token?.actor, skillId)) return true;
    const content = `<p>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ActiveDefenseInterruptsContinuousAction", {
        action: actionName(action.actionId),
    }))}</p><p>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ActiveDefenseInterruptionException"))}</p>`;
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (DialogV2?.wait) {
        return Boolean(await DialogV2.wait({
            window: { title: t("SMOOTHER_FIGHT.HUD.ActiveDefenseInterruptionTitle") },
            content,
            buttons: [
                {
                    action: "confirm",
                    label: t("SMOOTHER_FIGHT.HUD.ActiveDefenseInterruptionConfirm"),
                    icon: "fa-solid fa-check",
                    callback: () => true,
                    default: true,
                },
                {
                    action: "decline",
                    label: t("SMOOTHER_FIGHT.HUD.ActiveDefenseInterruptionDecline"),
                    icon: "fa-solid fa-xmark",
                    callback: () => false,
                },
            ],
            close: () => false,
            modal: true,
        }));
    }
    if (globalThis.Dialog?.confirm) {
        return Boolean(await globalThis.Dialog.confirm({
            title: t("SMOOTHER_FIGHT.HUD.ActiveDefenseInterruptionTitle"),
            content,
        }));
    }
    return Boolean(globalThis.window?.confirm?.(content.replace(/<[^>]+>/gu, " ")));
}

export async function interruptContinuousActionForActiveDefense(tokenLike, { skillId = null } = {}) {
    const token = resolveTokenDocument(tokenLike);
    const combat = globalThis.game?.combat;
    const action = getContinuousAction(token, combat);
    if (!token || !action || activeDefensePreservesContinuousAction(token.actor, skillId)) return false;
    const recovery = captureInterruptionRecovery(token, null, combat, "activeDefense");
    const interrupted = await interruptContinuousAction(token, null, combat);
    if (!interrupted) return false;
    await createInterruptionRecoveryChatCardSafely(token, recovery);
    globalThis.ui?.notifications?.warn?.(t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptedByActiveDefense", {
        action: actionName(action.actionId),
    }));
    return true;
}

export function bindContinuousActionInterruptionCard(message, html) {
    const card = readInterruptionCard(message);
    if (!html?.querySelectorAll) return;
    if (card) {
        for (const button of html.querySelectorAll('[data-sf-action="roll-continuous-action-interruption"]')) {
            if (button.dataset.smootherFightCaptured) continue;
            const token = resolveTokenDocument(card.tokenUuid);
            const request = findLiveRequest(token, card.requestId, globalThis.game?.combat);
            button.disabled = !request || !mayCurrentUserRoll(token, request, globalThis.game?.combat);
            button.dataset.smootherFightCaptured = "true";
            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                button.disabled = true;
                void rollContinuousActionInterruption(message, card.requestId).then((result) => {
                    if (["cancelled", "unknown"].includes(result.status) && button.isConnected) button.disabled = false;
                }).catch((error) => {
                    console.error(`${MODULE_ID} | Continuous-action interruption roll failed`, error);
                    globalThis.ui?.notifications?.error?.(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
                    if (button.isConnected) button.disabled = false;
                });
            }, { capture: true });
        }
    }

    const recovery = readInterruptionRecovery(message);
    for (const button of html.querySelectorAll('[data-sf-action="restore-continuous-action"]')) {
        const isGm = Boolean(globalThis.game?.user?.isGM);
        button.hidden = !isGm;
        button.disabled = !isGm || recovery?.status !== "interrupted";
        if (button.dataset.smootherFightCaptured) continue;
        button.dataset.smootherFightCaptured = "true";
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            button.disabled = true;
            void restoreContinuousActionFromInterruptionCard(message).then((restored) => {
                if (!restored && button.isConnected
                    && readInterruptionRecovery(message)?.status === "interrupted") button.disabled = false;
            }).catch((error) => {
                console.error(`${MODULE_ID} | Restoring an interrupted continuous action failed`, error);
                globalThis.ui?.notifications?.error?.(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
                if (button.isConnected) button.disabled = false;
            });
        }, { capture: true });
    }
}

async function interruptContinuousAction(token, request, combat) {
    const action = getContinuousAction(token, combat);
    if (!action || (request && !requestMatchesAction(request, action))) {
        if (request) await removeInterruptionRequest(token, request.id);
        return false;
    }
    if (action.completionTrigger === "movement") {
        try {
            await services.abortMovementPlan?.(token, combat);
        } catch (error) {
            console.error(`${MODULE_ID} | Could not stop interrupted movement on its route`, error);
        }
    }
    await clearInterruptedPreparation(token.actor, action.actionId);
    await clearContinuousAction(token, { expectedId: action.id });
    return true;
}

async function clearInterruptedPreparation(actor, actionId) {
    if (!actor) return;
    if (actionId === "readyRangedAttack") await clearPreparationApplication(actor, "attack");
    else if (actionId === "focusMagic") await clearPreparationApplication(actor, "spell");
    else if (["aim", "searchOpening"].includes(actionId)) await clearAttackPreparation(actor);
}

function captureInterruptionRecovery(token, request, combat, reason) {
    const action = getContinuousAction(token, combat);
    const actor = token?.actor;
    const recovery = {
        version: 1,
        id: randomId(),
        status: "interrupted",
        tokenUuid: token?.uuid ?? request?.tokenUuid,
        actorUuid: actor?.uuid ?? request?.actorUuid,
        action,
        reason,
        interruptedAt: Date.now(),
    };
    if (action?.actionId === "readyRangedAttack" || action?.actionId === "focusMagic") {
        const preparedFlag = action.actionId === "readyRangedAttack" ? "preparedAttack" : "preparedSpell";
        recovery.preparedItemId = documentFlag(actor, "splittermond", preparedFlag);
        recovery.preparationApplication = documentFlag(actor, MODULE_ID, "preparationApplication");
    } else if (["aim", "searchOpening"].includes(action?.actionId)) {
        recovery.attackPreparation = documentFlag(actor, MODULE_ID, "attackPreparation");
    } else if (action?.completionTrigger === "movement") {
        recovery.movementPlan = documentFlag(token, MODULE_ID, "movementPlan");
    }
    return recovery;
}

async function restoreInterruptedActionResources(token, recovery, combat) {
    const actor = token?.actor;
    const actionId = recovery.action.actionId;
    if (actionId === "readyRangedAttack" || actionId === "focusMagic") {
        if (!actor || !recovery.preparedItemId) return false;
        const preparedFlag = actionId === "readyRangedAttack" ? "preparedAttack" : "preparedSpell";
        await actor.setFlag("splittermond", preparedFlag, recovery.preparedItemId);
        if (recovery.preparationApplication && typeof recovery.preparationApplication === "object") {
            await setRequiredDocumentFlag(actor, "preparationApplication", recovery.preparationApplication);
        }
    } else if (["aim", "searchOpening"].includes(actionId)) {
        if (!actor || !recovery.attackPreparation || typeof recovery.attackPreparation !== "object") return false;
        await setRequiredDocumentFlag(actor, "attackPreparation", recovery.attackPreparation);
    } else if (recovery.action.completionTrigger === "movement") {
        if (!recovery.movementPlan || typeof recovery.movementPlan !== "object") return false;
        return restoreInterruptedMovementPlan(token, recovery.movementPlan, combat);
    }
    return true;
}

function readInterruptionRecovery(message) {
    const raw = documentFlag(message, MODULE_ID, INTERRUPTION_RECOVERY_CARD_FLAG)
        ?? documentFlag(message, MODULE_ID, INTERRUPTION_ROLL_FLAG);
    const action = normalizeContinuousAction(raw?.action);
    const status = ["interrupted", "restoring", "restored", "expired", "superseded"].includes(raw?.status)
        ? raw.status
        : null;
    const tokenUuid = optionalString(raw?.tokenUuid);
    if (Number(raw?.version) !== 1 || !status || !tokenUuid || !action
        || tokenUuid !== action.tokenUuid) return null;
    return { ...raw, version: 1, status, tokenUuid, action };
}

async function markInterruptionRecovery(message, recovery, status) {
    const value = {
        ...recovery,
        status,
        resolvedAt: Date.now(),
        resolvedBy: globalThis.game?.user?.id ?? null,
    };
    await setRequiredDocumentFlag(message, interruptionRecoveryFlag(message), value);
    const relatedIds = [recovery.sourceRollMessageId, recovery.recoveryMessageId]
        .map(optionalString)
        .filter((id) => id && id !== message?.id);
    for (const id of relatedIds) {
        const related = globalThis.game?.messages?.get?.(id);
        const relatedRecovery = readInterruptionRecovery(related);
        if (!relatedRecovery || (recovery.id && relatedRecovery.id !== recovery.id)) continue;
        await setRequiredDocumentFlag(related, interruptionRecoveryFlag(related), {
            ...relatedRecovery,
            status,
            resolvedAt: value.resolvedAt,
            resolvedBy: value.resolvedBy,
        });
    }
    return message;
}

function interruptionRecoveryFlag(message) {
    return documentFlag(message, MODULE_ID, INTERRUPTION_RECOVERY_CARD_FLAG)
        ? INTERRUPTION_RECOVERY_CARD_FLAG
        : INTERRUPTION_ROLL_FLAG;
}

function documentFlag(document, namespace, key) {
    return document?.getFlag?.(namespace, key)
        ?? document?.flags?.[namespace]?.[key]
        ?? null;
}

async function createInterruptionRecoveryChatCardSafely(token, recovery) {
    try {
        return await createInterruptionRecoveryChatCard(token, recovery);
    } catch (error) {
        console.error(`${MODULE_ID} | Could not create the continuous-action recovery card`, error);
        globalThis.ui?.notifications?.error?.(t("SMOOTHER_FIGHT.HUD.ContinuousActionRecoveryCardFailed"));
        return null;
    }
}

function createInterruptionRecoveryChatCard(token, recovery) {
    const action = actionName(recovery.action.actionId);
    const reason = recovery.reason === "activeDefense"
        ? t("SMOOTHER_FIGHT.HUD.ContinuousActionRecoveryReasonActiveDefense")
        : t("SMOOTHER_FIGHT.HUD.ContinuousActionRecoveryReasonDetermination");
    const content = `<section class="sf-tick-action-chat-card sf-continuous-action-recovery-card">
        <header><i class="fa-solid fa-link-slash" aria-hidden="true"></i><div><small>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ContinuousActionRecoveryEyebrow"))}</small><h2>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ContinuousActionRecoveryTitle"))}</h2></div></header>
        <dl>
            ${cardField(t("SMOOTHER_FIGHT.HUD.TickActionToken"), token.name ?? token.actor?.name ?? "–")}
            ${cardField(t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptionAction"), action)}
            ${cardField(t("SMOOTHER_FIGHT.HUD.ContinuousActionRecoveryReason"), reason)}
        </dl>
        <section class="sf-continuous-action-interruption-actions"><button type="button" class="splittermond-chat-action" data-sf-action="restore-continuous-action"><i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.RestoreContinuousAction"))}</button></section>
    </section>`;
    return globalThis.ChatMessage.create({
        speaker: globalThis.ChatMessage.getSpeaker({ actor: token.actor, token }),
        content,
        flags: {
            [MODULE_ID]: {
                [INTERRUPTION_RECOVERY_CARD_FLAG]: recovery,
            },
        },
    });
}

async function createInterruptionChatCard(token, request) {
    const action = actionName(request.actionId);
    const modifier = request.disturbingAttackLevels > 0
        ? t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptionDisturbingAttack", {
            levels: request.disturbingAttackLevels,
            modifier: request.disturbingAttackLevels * 3,
        })
        : t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptionNoModifier");
    const content = `<section class="sf-tick-action-chat-card sf-continuous-action-interruption-card">
        <header><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><div><small>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptionEyebrow"))}</small><h2>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptionTitle"))}</h2></div></header>
        <dl>
            ${cardField(t("SMOOTHER_FIGHT.HUD.TickActionToken"), token.name ?? token.actor?.name ?? "–")}
            ${cardField(t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptionAction"), action)}
            ${cardField(t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptionDamage"), request.damage)}
            ${cardField(t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptionDifficulty"), request.difficulty)}
        </dl>
        <section><p>${escapeHtml(modifier)}</p></section>
        <section class="sf-continuous-action-interruption-actions"><button type="button" class="splittermond-chat-action" data-sf-action="roll-continuous-action-interruption" data-request-id="${escapeAttr(request.id)}"><i class="fa-solid fa-dice-d20" aria-hidden="true"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.RollDetermination"))}</button></section>
    </section>`;
    return globalThis.ChatMessage.create({
        speaker: globalThis.ChatMessage.getSpeaker({ actor: token.actor, token }),
        content,
        flags: {
            [MODULE_ID]: {
                [INTERRUPTION_CARD_FLAG]: {
                    requestId: request.id,
                    tokenUuid: token.uuid,
                },
            },
        },
    });
}

function findContinuousActionToken({ actorUuid, tokenUuid }, combat) {
    const direct = resolveTokenDocument(tokenUuid);
    if (getContinuousAction(direct, combat)) return direct;
    return combatantsOf(combat).map((combatant) => resolveTokenDocument(combatant?.token))
        .find((token) => actorMatches(token?.actor, actorUuid) && getContinuousAction(token, combat)) ?? null;
}

function findLiveRequest(token, requestId, combat) {
    const action = getContinuousAction(token, combat);
    if (!token || !action) return null;
    return readInterruptionRequests(token).find((request) => (
        (!requestId || request.id === requestId) && requestMatchesAction(request, action)
    )) ?? null;
}

function requestMatchesAction(request, action) {
    return request.actionRecordId === action.id
        && request.actionId === action.actionId
        && request.combatId === action.combatId
        && request.combatantId === action.combatantId
        && request.tokenUuid === action.tokenUuid;
}

async function removeInterruptionRequest(token, requestId) {
    return withInterruptionLock(token, async () => {
        const requests = readInterruptionRequests(token);
        const retained = requests.filter((request) => request.id !== requestId);
        if (retained.length === requests.length) return false;
        await setRequiredDocumentFlag(token, INTERRUPTION_FLAG, retained);
        services.scheduleRender?.(0);
        return true;
    });
}

function readInterruptionCard(message) {
    const raw = message?.getFlag?.(MODULE_ID, INTERRUPTION_CARD_FLAG)
        ?? message?.flags?.[MODULE_ID]?.[INTERRUPTION_CARD_FLAG];
    const requestId = optionalString(raw?.requestId);
    const tokenUuid = optionalString(raw?.tokenUuid);
    return requestId && tokenUuid ? { requestId, tokenUuid } : null;
}

function interruptionCardExists(request) {
    const messages = globalThis.game?.messages;
    if (!messages) return true;
    const values = typeof messages.values === "function" ? messages.values() : messages;
    return Array.from(values ?? []).some((message) => {
        const card = readInterruptionCard(message);
        return card?.requestId === request.id && card.tokenUuid === request.tokenUuid;
    });
}

function rollSucceeded(message) {
    const report = message?.system?.checkReport
        ?? message?.getFlag?.("splittermond", "check")
        ?? message?.flags?.splittermond?.check;
    return typeof report?.succeeded === "boolean" ? report.succeeded : null;
}

function mayCurrentUserRoll(token, request, combat) {
    const user = globalThis.game?.user;
    if (!user || !token?.actor || !request) return false;
    if (user.isGM) return true;
    const combatant = combatantsOf(combat).find((candidate) => candidate?.id === request.combatantId);
    const controller = services.getRuntimeController?.(combatant ?? token.actor);
    return Boolean(token.actor.isOwner && controller?.id === user.id);
}

function activeDefensePreservesContinuousAction(actor, skillId) {
    if (String(skillId ?? "").toLocaleLowerCase() !== "acrobatics") return false;
    return Array.from(actor?.items ?? []).some((item) => {
        if (item?.type !== "mastery") return false;
        const identity = normalizeIdentity(`${item.system?.id ?? ""} ${item.name ?? ""}`);
        return identity.includes("koordiniertesausweichen")
            || identity.includes("coordinateddodge")
            || identity.includes("coordinatedevasion");
    });
}

function disturbingAttackLevelsForDamage(sourceMessageId) {
    const source = globalThis.game?.messages?.get?.(sourceMessageId);
    const offense = offenseMessageForDamage(source);
    const interruptingAttackLevels = Array.from(
        offense?.system?.noActionOptionsHandler?.interruptingAttack?.options?.multiplicities ?? []
    ).reduce((sum, option) => {
        if (!option?.checked) return sum;
        const multiplicity = Number(option.multiplicity);
        return sum + (Number.isFinite(multiplicity) && multiplicity > 0 ? Math.floor(multiplicity) : 0);
    }, 0);
    if (interruptingAttackLevels > 0) return interruptingAttackLevels;

    const maneuvers = offense?.system?.checkReport?.maneuvers
        ?? offense?.getFlag?.("splittermond", "check")?.maneuvers
        ?? offense?.flags?.splittermond?.check?.maneuvers
        ?? [];
    return Array.from(maneuvers).reduce((sum, maneuver) => {
        const identity = normalizeIdentity([
            maneuver?.id,
            maneuver?.name,
            maneuver?.label,
            maneuver?.mastery?.name,
        ].filter(Boolean).join(" "));
        if (!identity.includes("stoerenderangriff")
            && !identity.includes("storenderangriff")
            && !identity.includes("disruptiveattack")) return sum;
        const levels = Number(maneuver?.degrees ?? maneuver?.count ?? maneuver?.level ?? 1);
        return sum + (Number.isFinite(levels) && levels > 0 ? Math.floor(levels) : 1);
    }, 0);
}

function offenseMessageForDamage(source) {
    if (!source) return null;
    const context = services.getMessageContext?.(source);
    const linkedOffense = globalThis.game?.messages?.get?.(context?.attackMessageId);
    if (linkedOffense) return linkedOffense;

    const combat = globalThis.game?.combat;
    const hudContext = services.getHudContext?.() ?? (combat ? { combat } : null);
    const group = hudContext?.combat
        ? services.collectCombatEventGroups?.(hudContext)?.find((candidate) =>
            Array.from(candidate?.damages ?? []).some((damage) => damage?.id === source.id)
        )
        : null;
    return group?.primary ?? source;
}

function resolveTokenDocument(value) {
    if (typeof value === "string") return services.resolveToken?.(value)?.document ?? services.resolveToken?.(value) ?? null;
    const candidate = value?.token?.document ?? value?.token ?? value?.document ?? value ?? null;
    return candidate?.actor && (candidate.uuid || candidate.id) ? candidate : null;
}

function actorMatches(actor, actorUuid) {
    if (!actor || !actorUuid) return false;
    return actor.uuid === actorUuid || actor.id === actorUuid || `Actor.${actor.id}` === actorUuid;
}

function combatantsOf(combat) {
    return Array.from(combat?.combatants?.values?.() ?? combat?.combatants ?? combat?.turns ?? []);
}

function actionName(actionId) {
    return t(`SMOOTHER_FIGHT.HUD.TickActions.${actionId}.Name`);
}

function cardField(label, value) {
    return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function normalizeIdentity(value) {
    return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
        .toLocaleLowerCase("de-DE").replace(/[^a-z0-9]+/gu, "");
}

function optionalString(value) {
    const normalized = String(value ?? "").trim();
    return normalized || null;
}

function randomId() {
    return globalThis.foundry?.utils?.randomID?.()
        ?? globalThis.crypto?.randomUUID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
