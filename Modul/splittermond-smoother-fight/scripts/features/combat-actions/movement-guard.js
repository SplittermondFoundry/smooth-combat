import { movementTrackerState } from "../../domain/combat/movement.js";
import { resolveCombatPosition } from "../../shared/combat-position-state.js";
import { readTokenMovementDistance } from "../../shared/movement.js";
import { t } from "../../shared/values.js";
import { CONTINUOUS_MOVEMENT_ACTION_IDS, getContinuousAction, requiredStandUpStartingPosition } from "./continuous-action.js";

const movementActionLocks = new Set();

export async function withMovementActionLock(context, actionId, operation) {
    const token = context?.token?.document ?? context?.token;
    const key = token?.uuid ?? token?.id;
    if (!key || (!CONTINUOUS_MOVEMENT_ACTION_IDS.includes(actionId) && !requiredStandUpStartingPosition(actionId))) {
        return operation();
    }
    if (movementActionLocks.has(key)) return false;
    movementActionLocks.add(key);
    try {
        return await operation();
    } finally {
        movementActionLocks.delete(key);
    }
}

export function requireMovementAction(context, action) {
    const token = context?.token?.document ?? context?.token;
    const position = resolveCombatPosition(token?.actor ?? context?.actor);
    const standUp = Boolean(requiredStandUpStartingPosition(action.id));
    const pending = getContinuousAction(token, context?.combat);
    let warning = null;
    if (pending && (standUp || requiredStandUpStartingPosition(pending.actionId))) {
        warning = "MovementFinishContinuousAction";
    } else if (!standUp && position.ambiguous) {
        warning = "CombatPositionConflict";
    } else if (position.id === "prone" && ["walk", "sprint"].includes(action.id)) {
        warning = "MovementProneRequiresCrawl";
    } else if (action.id === "crawl"
        && movementTrackerState(readTokenMovementDistance(token), null, "prone").phase === "excess") {
        warning = "MovementCrawlTooFar";
    } else if (standUp && readTokenMovementDistance(token) > 0) {
        warning = "MovementStandUpUndoFirst";
    }
    if (!warning) return true;
    ui.notifications.warn(t(`SMOOTHER_FIGHT.HUD.${warning}`));
    return false;
}
