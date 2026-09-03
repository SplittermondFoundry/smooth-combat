import { services } from "../../core/services.js";

import {
    movementActionMilestones,
    movementDueMilestones,
    movementFractionAtPosition,
    movementInterruptionMilestone,
    movementPathThroughFractions,
} from "../../domain/combat/movement.js";

import { MODULE_ID } from "../../core/constants.js";

import {
    setRequiredDocumentFlag,
} from "../../shared/document-flags.js";

import {
    beginContinuousAction,
    completeContinuousAction,
    CONTINUOUS_MOVEMENT_ACTION_IDS,
} from "./continuous-action.js";

import {
    readTokenMovementDistance,
} from "../../shared/movement.js";

import {
    asElement,
    getSetting,
    t,
} from "../../shared/values.js";

import {
    revertTokenMovementApplication,
} from "./applications.js";

import {
    clearMovementRoutePreviewCanvas,
    isMovementRoutePreviewCanvasPersistent,
    isMovementRoutePreviewCanvasVisible,
    refreshMovementRoutePreviewCanvas,
    refreshMovementRoutePreviewCanvasScale,
    toggleMovementRoutePreviewCanvas,
} from "./movement-preview.js";

import {
    requestRemoteMovementPlanAbort,
} from "./movement-abort-requests.js";

const MOVEMENT_PLAN_FLAG = "movementPlan";
const MOVEMENT_PLAN_VERSION = 1;
const SCHEDULED_MOVEMENT_OPTION = "splittermondSmootherFightMovement";
const MOVEMENT_FRACTION_EPSILON = 0.000_001;
const movementLocks = new Set();
const movementAdvanceRequests = new Set();
const movementAdvanceTasks = new Map();
const movementPlanningLocks = new Set();
const defaultPreviewPlanKeys = new Map();

export async function performTrackedMovementAction(context, action) {
    if (!getSetting("movementTracking", true)) return null;
    const token = tokenDocument(context?.token);
    const route = captureMovementRoute(token);
    if (!token || !route) return null;
    const lockKey = token.uuid ?? token.id;
    if (!lockKey || movementPlanningLocks.has(lockKey)) return false;
    if (readMovementPlan(token)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.MovementAlreadyPlanned"));
        return false;
    }
    movementPlanningLocks.add(lockKey);

    try {
        const distance = readTokenMovementDistance(token);
        let plan = movementPlan(context, action, route);
        const reverted = await revertTokenMovementApplication(context);
        if (!reverted || !tokenReachedWaypoint(token, route.waypoints[0])) {
            ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.MovementPlanRevertFailed"));
            return false;
        }

        try {
            await writeMovementPlan(token, plan);
        } catch (error) {
            await restoreSelectedRoute(token, route).catch(() => false);
            throw error;
        }

        try {
            const continuousAction = await beginContinuousAction(context, {
                actionId: action.id,
                completionTrigger: "movement",
                startTick: plan.startTick,
                endTick: plan.milestones.at(-1)?.tick,
            });
            if (!continuousAction?.id) throw new Error("Could not start the tracked movement action");
            const linkedPlan = { ...plan, continuousActionId: continuousAction.id };
            if (!await writeMovementPlanIfCurrent(token, plan, linkedPlan)) {
                throw new Error("The movement plan changed while its continuous action was starting");
            }
            plan = linkedPlan;
        } catch (error) {
            await rollbackMovementPlan(token, route, plan, context.combat);
            throw error;
        }

        let actualTicks;
        try {
            actualTicks = await services.addCombatTicks(context, action.ticks);
        } catch (error) {
            await rollbackMovementPlan(token, route, plan, context.combat);
            throw error;
        }
        if (actualTicks === null) {
            await rollbackMovementPlan(token, route, plan, context.combat);
            return false;
        }

        try {
            const card = await services.createTickActionChatCard(context, action.id, actualTicks, {
                movementDistance: distance,
            });
            if (!card) ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.MovementCardFailed"));
        } catch (error) {
            console.error(`${MODULE_ID} | Could not create the chat card for committed movement`, error);
            ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.MovementCardFailed"));
        }
        syncDefaultMovementRoutePreviews(context.combat);
        services.scheduleRender(0);
        return true;
    } finally {
        movementPlanningLocks.delete(lockKey);
    }
}

export async function advancePendingMovements(combat = globalThis.game?.combat) {
    if (!combat || !isCurrentUserMovementAuthority()) return false;
    const currentTick = combatTick(combat);
    let changed = false;
    for (const combatant of combatantsOf(combat)) {
        const token = tokenDocument(combatant?.token);
        const plan = readMovementPlan(token);
        if (!plan || plan.combatId !== combat.id || plan.combatantId !== combatant.id) continue;
        const due = movementDueMilestones(plan, currentTick);
        if (!due.length) continue;
        changed = await queueTokenMovementAdvance(token, combat) || changed;
    }
    if (changed) services.scheduleRender(0);
    return changed;
}

export async function abortMovementPlan(tokenLike, combat = globalThis.game?.combat) {
    const token = tokenDocument(tokenLike);
    if (!token || !combat || !mayCurrentUserManageMovementPlan(token)) return false;
    if (!isCurrentUserMovementAuthority()) {
        return requestRemoteMovementPlanAbort(token, combat, movementPlanIdentity(readMovementPlan(token)));
    }
    return abortMovementPlanAuthoritatively(token, combat);
}

export async function applyRemoteMovementPlanAbort(payload, sender) {
    if (!globalThis.game?.user?.isGM || !isCurrentUserMovementAuthority() || !sender) {
        return { applied: false, error: "unauthorized" };
    }
    const combat = resolveCombat(payload?.combatId);
    const token = services.resolveToken?.(payload?.tokenUuid);
    const plan = readMovementPlan(token);
    if (!combat || !token || !plan || plan.combatId !== combat.id
        || movementPlanIdentity(plan) !== String(payload?.planId ?? "")
        || !mayUserManageMovementPlan(token, sender)) {
        return { applied: false, error: "invalid" };
    }
    try {
        return { applied: await abortMovementPlanAuthoritatively(token, combat) };
    } catch (error) {
        console.error(`${MODULE_ID} | Could not process remote movement abort`, error);
        return { applied: false, error: "failed" };
    }
}

async function abortMovementPlanAuthoritatively(token, combat) {
    const interruptionTick = combatTick(combat);
    const lockKey = token.uuid ?? token.id;
    if (!lockKey) return false;

    await movementAdvanceTasks.get(lockKey);
    const plan = readMovementPlan(token);
    if (!plan || plan.combatId !== combat.id) return false;
    const milestone = movementInterruptionMilestone(plan, interruptionTick);
    const completedFraction = movementPlanPositionFraction(token, plan)
        ?? normalizedFraction(plan.completedFraction);
    let reachedMilestone = true;
    if (milestone.fraction > completedFraction + MOVEMENT_FRACTION_EPSILON) {
        const fractions = plan.milestones
            .map(({ fraction }) => normalizedFraction(fraction))
            .filter((fraction) => fraction > completedFraction && fraction <= milestone.fraction)
            .sort((left, right) => left - right);
        const waypoints = movementPathThroughFractions(
            plan.route,
            plan.segmentLengths,
            completedFraction,
            fractions,
        );
        const completedByFoundry = waypoints.length
            ? await moveTokenAlongRoute(token, waypoints) === true
            : false;
        await clearScheduledMovementHistory(token);
        const actualFraction = movementPlanPositionFraction(token, plan);
        reachedMilestone = completedByFoundry || (actualFraction !== null
            && actualFraction + MOVEMENT_FRACTION_EPSILON >= milestone.fraction);
    }

    if (!await finishMovementPlan(token, plan, combat)) return false;
    if (reachedMilestone) ui.notifications.info(t("SMOOTHER_FIGHT.HUD.MovementPlanAborted"));
    else ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.MovementPlanStopped"));
    services.scheduleRender(0);
    return true;
}

export async function restoreInterruptedMovementPlan(tokenLike, planLike, combat = globalThis.game?.combat) {
    const token = tokenDocument(tokenLike);
    const plan = normalizeMovementPlan(planLike);
    if (!token || !plan || !combat
        || plan.combatId !== combat.id
        || plan.tokenUuid !== token.uuid
        || readMovementPlan(token)) return false;
    const combatant = combatantsOf(combat).find((candidate) => candidate?.id === plan.combatantId);
    if (!combatant) return false;

    const actualFraction = movementPlanPositionFraction(token, plan);
    if (actualFraction === null) return false;
    const completedFraction = Math.max(normalizedFraction(plan.completedFraction), actualFraction);
    if (completedFraction >= 1) return false;
    await writeMovementPlan(token, { ...plan, completedFraction });
    syncDefaultMovementRoutePreviews(combat);
    services.scheduleRender?.(0);
    return true;
}

export function getAbortableControlledTokenMovement(combat = globalThis.game?.combat) {
    const token = tokenDocument(services.getControlledTokenDocument?.());
    if (!token || !combat || !mayCurrentUserManageMovementPlan(token)) return null;
    const plan = readMovementPlan(token);
    if (!plan || plan.combatId !== combat.id) return null;
    return token;
}

export function toggleMovementRoutePreview(tokenLike, combat = globalThis.game?.combat) {
    const token = tokenDocument(tokenLike);
    if (!token || !combat || !mayCurrentUserManageMovementPlan(token)) return null;
    const plan = readMovementPlan(token);
    if (!plan || plan.combatId !== combat.id) return null;
    const result = toggleMovementRoutePreviewCanvas(token, plan);
    rememberManualMovementRoutePreviewChoice(token, plan, result);
    return result;
}

export function togglePersistentMovementRoutePreview(tokenLike, combat = globalThis.game?.combat) {
    const token = tokenDocument(tokenLike);
    if (!token || !combat || !mayCurrentUserManageMovementPlan(token)) return null;
    const plan = readMovementPlan(token);
    if (!plan || plan.combatId !== combat.id) return null;
    const result = toggleMovementRoutePreviewCanvas(token, plan, { persistent: true });
    rememberManualMovementRoutePreviewChoice(token, plan, result);
    return result;
}

export function clearMovementRoutePreview(tokenLike = null) {
    return clearMovementRoutePreviewCanvas(tokenDocument(tokenLike));
}

export function clearTemporaryMovementRoutePreview(tokenLike = null) {
    return clearMovementRoutePreviewCanvas(tokenDocument(tokenLike), { temporaryOnly: true });
}

export function isMovementRoutePreviewVisible(tokenLike) {
    return isMovementRoutePreviewCanvasVisible(tokenDocument(tokenLike));
}

export function isMovementRoutePreviewPersistent(tokenLike) {
    return isMovementRoutePreviewCanvasPersistent(tokenDocument(tokenLike));
}

export function refreshMovementRoutePreviewScale() {
    return refreshMovementRoutePreviewCanvasScale();
}

export function syncDefaultMovementRoutePreviews(combat = globalThis.game?.combat, { reconsider = false } = {}) {
    if (!combat || !globalThis.canvas?.interface) return false;
    if (reconsider) defaultPreviewPlanKeys.clear();
    const activeReferences = new Set();
    const showByDefault = getSetting("showMovementRoutesByDefault", true);
    let changed = false;
    for (const combatant of combatantsOf(combat)) {
        const token = tokenDocument(combatant?.token);
        const plan = readMovementPlan(token);
        if (!token) continue;
        if (!plan || plan.combatId !== combat.id) {
            changed = clearMovementRoutePreviewCanvas(token) || changed;
            defaultPreviewPlanKeys.delete(token.uuid ?? token.id);
            continue;
        }
        const reference = token.uuid ?? token.id;
        if (!reference) continue;
        if (!mayCurrentUserViewMovementPlan(token)) {
            changed = clearMovementRoutePreviewCanvas(token) || changed;
            defaultPreviewPlanKeys.delete(reference);
            continue;
        }
        activeReferences.add(reference);
        if (isMovementRoutePreviewCanvasVisible(token)) {
            changed = refreshMovementRoutePreviewCanvas(token, plan) || changed;
        }
        if (!showByDefault) continue;
        const planKey = movementPlanPreviewKey(plan);
        const decision = defaultPreviewPlanKeys.get(reference);
        if (decision?.planKey === planKey) {
            if (!decision.dismissed && !isMovementRoutePreviewCanvasVisible(token)) {
                changed = toggleMovementRoutePreviewCanvas(token, plan, { persistent: true }) === true || changed;
            }
            continue;
        }
        defaultPreviewPlanKeys.set(reference, { dismissed: false, planKey });
        if (!isMovementRoutePreviewCanvasVisible(token)) {
            changed = toggleMovementRoutePreviewCanvas(token, plan, { persistent: true }) === true || changed;
        }
    }
    for (const reference of defaultPreviewPlanKeys.keys()) {
        if (!activeReferences.has(reference)) {
            changed = clearMovementRoutePreviewCanvas({ uuid: reference }) || changed;
            defaultPreviewPlanKeys.delete(reference);
        }
    }
    if (changed) services.scheduleRender(0);
    return changed;
}

export function renderTokenMovementControl(app, html) {
    const root = asElement(html);
    const tokenObject = app?.object ?? app?.token ?? null;
    const token = tokenDocument(tokenObject);
    if (!root || !token) return;

    root.querySelector(".sf-token-movement-control")?.remove();
    const plan = readMovementPlan(token);
    if (!plan || plan.combatId !== globalThis.game?.combat?.id || !mayCurrentUserManageMovementPlan(token)) return;
    const column = root.querySelector(".col.right") ?? root.querySelector(".right") ?? root;
    const control = document.createElement("div");
    control.className = "control-icon sf-token-movement-control active";
    control.dataset.action = "smoother-fight-abort-movement";
    control.dataset.tooltip = t("SMOOTHER_FIGHT.HUD.AbortMovement");
    control.setAttribute("aria-label", control.dataset.tooltip);
    control.innerHTML = '<i class="fa-solid fa-person-circle-xmark"></i>';
    control.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (control.getAttribute("aria-disabled") === "true") return;
        control.setAttribute("aria-disabled", "true");
        try {
            if (await abortMovementPlan(token, globalThis.game?.combat)) control.remove();
            else control.removeAttribute("aria-disabled");
        } catch (error) {
            control.removeAttribute("aria-disabled");
            console.error(`${MODULE_ID} | Could not abort scheduled movement`, error);
        }
    });
    column.append(control);
}

export async function cancelMovementPlanAfterManualMove(tokenLike, options = {}, userId = null) {
    const token = tokenDocument(tokenLike);
    if (!token || options?.[SCHEDULED_MOVEMENT_OPTION]) return false;
    if (!isCurrentUserManualMovementAuthority(token, userId)) return false;
    const lockKey = token.uuid ?? token.id;
    if (lockKey && movementLocks.has(lockKey) && userId === globalThis.game?.user?.id) {
        return false;
    }
    if (lockKey) await movementAdvanceTasks.get(lockKey);
    const plan = readMovementPlan(token);
    if (!plan) {
        const completed = await completeContinuousAction({ token, combat: globalThis.game?.combat }, {
            actionIds: CONTINUOUS_MOVEMENT_ACTION_IDS,
            trigger: "movement",
        });
        if (completed) services.scheduleRender(0);
        return completed;
    }
    if (!await finishMovementPlan(token, plan)) return false;
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.MovementPlanCancelled"));
    services.scheduleRender(0);
    return true;
}

export async function clearMovementPlansForCombat(combat) {
    if (!combat || !isCurrentUserMovementAuthority()) return false;
    const tokens = combatantsOf(combat).map((combatant) => tokenDocument(combatant?.token)).filter(Boolean);
    let changed = false;
    for (const token of tokens) {
        const plan = readMovementPlan(token);
        if (!plan || plan.combatId !== combat.id) continue;
        await clearMovementPlan(token, plan);
        changed = true;
    }
    return changed;
}

export async function clearMovementPlanForCombatant(combatant) {
    if (!combatant || !isCurrentUserMovementAuthority()) return false;
    const token = tokenDocument(combatant.token);
    const plan = readMovementPlan(token);
    if (!plan || plan.combatantId !== combatant.id) return false;
    await clearMovementPlan(token, plan);
    return true;
}

function movementPlan(context, action, route) {
    const startTick = combatantTick(context?.combatant, context?.combat);
    const id = globalThis.foundry?.utils?.randomID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return {
        version: MOVEMENT_PLAN_VERSION,
        id,
        actionId: action.id,
        combatId: context.combat?.id ?? null,
        combatantId: context.combatant?.id ?? null,
        completedFraction: 0,
        createdBy: globalThis.game?.user?.id ?? null,
        milestones: movementActionMilestones(action.id, startTick),
        route: route.waypoints,
        segmentLengths: route.segmentLengths,
        startTick,
        tokenUuid: tokenDocument(context.token)?.uuid ?? null,
        previewId: id,
    };
}

function movementPlanPreviewKey(plan) {
    return String(plan.previewId ?? [
        plan.combatId,
        plan.combatantId,
        plan.actionId,
        plan.startTick,
        plan.createdBy,
    ].join(":"));
}

function rememberManualMovementRoutePreviewChoice(token, plan, result) {
    if (result === null) return;
    const reference = token?.uuid ?? token?.id;
    if (!reference) return;
    defaultPreviewPlanKeys.set(reference, {
        dismissed: result === false,
        planKey: movementPlanPreviewKey(plan),
    });
}

function captureMovementRoute(token) {
    if (!token) return null;
    const history = Array.from(token.movementHistory ?? []).map(serializeWaypoint).filter(Boolean);
    if (!history.length) return null;
    const current = serializeWaypoint(token);
    if (current && !samePosition(history.at(-1), current)) history.push(current);
    const waypoints = distinctConsecutiveWaypoints(history);
    if (waypoints.length < 2 || samePosition(waypoints[0], waypoints.at(-1))) return null;

    let measurement = null;
    try {
        measurement = token.measureMovementPath?.(waypoints) ?? null;
    } catch {
        // Pixel lengths below retain the route if Foundry cannot remeasure it.
    }
    const segmentLengths = waypoints.slice(1).map((point, index) => {
        const measured = Number(measurement?.segments?.[index]?.distance);
        if (Number.isFinite(measured) && measured > 0) return measured;
        const previous = waypoints[index];
        return Math.hypot(point.x - previous.x, point.y - previous.y);
    });
    return segmentLengths.some((length) => length > 0) ? { segmentLengths, waypoints } : null;
}

function queueTokenMovementAdvance(token, combat) {
    const lockKey = token.uuid ?? token.id;
    if (!lockKey) return Promise.resolve(false);
    movementAdvanceRequests.add(lockKey);
    const activeTask = movementAdvanceTasks.get(lockKey);
    if (activeTask) return activeTask;
    const task = drainTokenMovementAdvances(token, combat, lockKey)
        .finally(() => movementAdvanceTasks.delete(lockKey));
    movementAdvanceTasks.set(lockKey, task);
    return task;
}

async function drainTokenMovementAdvances(token, combat, lockKey) {
    movementLocks.add(lockKey);
    let changed = false;
    try {
        while (movementAdvanceRequests.delete(lockKey)) {
            const plan = readMovementPlan(token);
            if (!plan || plan.combatId !== combat?.id) break;
            const due = movementDueMilestones(plan, combatTick(combat));
            if (!due.length) continue;
            changed = await advanceTokenMovementPlan(token, plan, due, combat) || changed;
        }
        return changed;
    } finally {
        movementLocks.delete(lockKey);
        movementAdvanceRequests.delete(lockKey);
    }
}

async function advanceTokenMovementPlan(token, plan, due, combat) {
    if (!movementPlanIsCurrent(token, plan)) return false;
    const previousFraction = normalizedFraction(plan.completedFraction);
    const targetFraction = Math.max(...due.map(({ fraction }) => normalizedFraction(fraction)));
    const observedBefore = movementPlanPositionFraction(token, plan);
    const startingFraction = Math.max(previousFraction, observedBefore ?? previousFraction);
    let completedByFoundry = false;
    if (startingFraction + MOVEMENT_FRACTION_EPSILON < targetFraction) {
        const fractions = due
            .map((milestone) => normalizedFraction(milestone.fraction))
            .filter((fraction) => fraction > startingFraction + MOVEMENT_FRACTION_EPSILON);
        const waypoints = movementPathThroughFractions(
            plan.route,
            plan.segmentLengths,
            startingFraction,
            fractions,
        );
        if (!waypoints.length) {
            ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.MovementPlanStillPending"));
            return false;
        }
        completedByFoundry = await moveTokenAlongRoute(token, waypoints) === true;
        await clearScheduledMovementHistory(token);
    }

    const observedAfter = movementPlanPositionFraction(token, plan);
    const reachedFraction = Math.max(previousFraction, observedAfter ?? previousFraction);
    const completedFraction = Math.min(targetFraction, reachedFraction);
    const progressed = completedFraction > previousFraction + MOVEMENT_FRACTION_EPSILON;
    const reachedTarget = completedByFoundry
        || completedFraction + MOVEMENT_FRACTION_EPSILON >= targetFraction;
    if (!reachedTarget) {
        if (progressed) await writeMovementProgressIfCurrent(token, plan, completedFraction);
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.MovementPlanStillPending"));
        return progressed;
    }

    if (targetFraction >= 1 - MOVEMENT_FRACTION_EPSILON) {
        return finishMovementPlan(token, plan, combat);
    }
    return writeMovementProgressIfCurrent(token, plan, targetFraction);
}

async function rollbackMovementPlan(token, route, plan, combat) {
    await finishMovementPlan(token, plan, combat).catch(() => false);
    await restoreSelectedRoute(token, route).catch(() => false);
}

function completeTrackedMovement(token, plan, combat = globalThis.game?.combat) {
    return completeContinuousAction({ token, combat }, {
        actionIds: [plan?.actionId],
        expectedId: plan?.continuousActionId ?? null,
        trigger: "movement",
    });
}

async function finishMovementPlan(token, plan, combat = globalThis.game?.combat) {
    const current = readMovementPlan(token);
    if (current && !sameMovementPlan(current, plan)) return false;
    await completeTrackedMovement(token, current ?? plan, combat);
    const remaining = readMovementPlan(token);
    if (!remaining) return true;
    if (!sameMovementPlan(remaining, plan)) return false;
    await clearMovementPlan(token, remaining);
    return true;
}

async function writeMovementProgressIfCurrent(token, plan, completedFraction) {
    const current = readMovementPlan(token);
    if (!sameMovementPlan(current, plan)) return false;
    await writeMovementPlan(token, {
        ...current,
        completedFraction: normalizedFraction(completedFraction),
    });
    return true;
}

async function writeMovementPlanIfCurrent(token, expected, replacement) {
    if (!sameMovementPlan(readMovementPlan(token), expected)) return false;
    await writeMovementPlan(token, replacement);
    return true;
}

async function restoreSelectedRoute(token, route) {
    const waypoints = route.waypoints.slice(1).map((point, index, points) => ({
        ...point,
        checkpoint: index === points.length - 1,
    }));
    if (!waypoints.length) return false;
    return moveTokenAlongRoute(token, waypoints);
}

async function moveTokenAlongRoute(token, waypoints) {
    if (typeof token.move === "function") {
        return token.move(waypoints, {
            animate: true,
            method: "api",
            showRuler: true,
            [SCHEDULED_MOVEMENT_OPTION]: true,
        });
    }
    const destination = waypoints.at(-1);
    if (!destination || typeof token.update !== "function") return false;
    const changes = { x: destination.x, y: destination.y };
    if (destination.elevation !== undefined) changes.elevation = destination.elevation;
    await token.update(changes, {
        animate: true,
        [SCHEDULED_MOVEMENT_OPTION]: true,
    });
    return true;
}

function readMovementPlan(tokenLike) {
    const token = tokenDocument(tokenLike);
    return normalizeMovementPlan(token?.getFlag?.(MODULE_ID, MOVEMENT_PLAN_FLAG)
        ?? token?.flags?.[MODULE_ID]?.[MOVEMENT_PLAN_FLAG]
        ?? null);
}

function normalizeMovementPlan(plan) {
    if (!plan || plan.version !== MOVEMENT_PLAN_VERSION || !Array.isArray(plan.route)
        || !Array.isArray(plan.milestones)) return null;
    return plan;
}

function writeMovementPlan(token, plan) {
    return setRequiredDocumentFlag(token, MOVEMENT_PLAN_FLAG, plan);
}

function clearMovementPlan(token, expectedPlan = null) {
    if (expectedPlan && !sameMovementPlan(readMovementPlan(token), expectedPlan)) {
        return Promise.resolve(false);
    }
    clearMovementRoutePreviewCanvas(token);
    return setRequiredDocumentFlag(token, MOVEMENT_PLAN_FLAG, null);
}

function serializeWaypoint(point) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const result = { x, y };
    for (const key of ["action", "depth", "elevation", "height", "level", "shape", "width"]) {
        if (point[key] !== undefined && point[key] !== null) result[key] = point[key];
    }
    result.checkpoint = Boolean(point.checkpoint);
    result.explicit = Boolean(point.explicit);
    result.snapped = Boolean(point.snapped);
    return result;
}

function distinctConsecutiveWaypoints(waypoints) {
    return waypoints.filter((point, index) => index === 0 || !samePosition(point, waypoints[index - 1]));
}

function samePosition(left, right) {
    return left?.x === right?.x && left?.y === right?.y
        && Number(left?.elevation ?? 0) === Number(right?.elevation ?? 0);
}

function tokenReachedWaypoint(token, waypoint) {
    if (!token || !waypoint || Number(token.x) !== Number(waypoint.x)
        || Number(token.y) !== Number(waypoint.y)) return false;
    return waypoint.elevation === undefined
        || Number(token.elevation ?? 0) === Number(waypoint.elevation);
}

function movementPlanPositionFraction(token, plan) {
    return movementFractionAtPosition(plan?.route, plan?.segmentLengths, token, {
        minimumFraction: normalizedFraction(plan?.completedFraction),
    });
}

function movementPlanIdentity(plan) {
    if (!plan) return "";
    return String(plan.id ?? plan.previewId ?? [
        plan.combatId,
        plan.combatantId,
        plan.tokenUuid,
        plan.actionId,
        plan.startTick,
        plan.createdBy,
    ].join(":"));
}

function sameMovementPlan(left, right) {
    const leftIdentity = movementPlanIdentity(left);
    return Boolean(leftIdentity && leftIdentity === movementPlanIdentity(right));
}

function movementPlanIsCurrent(token, plan) {
    return sameMovementPlan(readMovementPlan(token), plan);
}

async function clearScheduledMovementHistory(token) {
    try {
        await token.clearMovementHistory?.();
        return true;
    } catch (error) {
        console.error(`${MODULE_ID} | Could not clear scheduled movement history`, error);
        return false;
    }
}

function resolveCombat(combatId) {
    if (!combatId) return null;
    return globalThis.game?.combats?.get?.(combatId)
        ?? (globalThis.game?.combat?.id === combatId ? globalThis.game.combat : null);
}

function combatantTick(combatant, combat) {
    const initiative = Number(combatant?.initiative);
    if (Number.isFinite(initiative)) return initiative;
    return combatTick(combat);
}

function combatTick(combat) {
    for (const value of [combat?.currentTick, combat?.combatant?.initiative, combat?.round]) {
        const tick = Number(value);
        if (Number.isFinite(tick)) return tick;
    }
    return 0;
}

function combatantsOf(combat) {
    const combatants = combat?.combatants ?? combat?.turns ?? [];
    return Array.from(combatants?.values?.() ?? combatants);
}

function tokenDocument(tokenLike) {
    return tokenLike?.document ?? tokenLike ?? null;
}

function normalizedFraction(value) {
    const fraction = Number(value);
    return Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
}

function mayCurrentUserManageMovementPlan(token) {
    const user = globalThis.game?.user;
    if (!user) return false;
    if (user.isGM) return true;
    const runtimeController = services.getRuntimeController?.(token);
    return Boolean(token?.actor?.isOwner && runtimeController?.id === user.id);
}

function mayUserManageMovementPlan(token, user) {
    if (!token || !user) return false;
    if (user.isGM) return true;
    const ownsActor = typeof token.actor?.testUserPermission === "function"
        ? token.actor.testUserPermission(user, "OWNER")
        : Boolean(user.id === globalThis.game?.user?.id && token.actor?.isOwner);
    const runtimeController = services.getRuntimeController?.(token);
    return Boolean(ownsActor && runtimeController?.id === user.id);
}

function mayCurrentUserViewMovementPlan(token) {
    const user = globalThis.game?.user;
    if (!user) return false;
    if (user.isGM) return true;
    if (services.isTokenPerceivableByUser?.(token, user) === false) return false;
    if (!getSetting("privateMovementRoutes", false)) return true;
    return mayCurrentUserManageMovementPlan(token);
}

function isCurrentUserMovementAuthority() {
    return services.getActivePrimaryGm?.()?.id === globalThis.game?.user?.id;
}

function isCurrentUserManualMovementAuthority(token, userId) {
    const primaryGm = services.getActivePrimaryGm?.();
    const user = globalThis.game?.user;
    if (!user) return false;
    if (primaryGm) return primaryGm.id === user.id;
    if (userId && userId !== user.id) return false;
    return mayCurrentUserManageMovementPlan(token);
}
