import {
    services,
} from "../../core/services.js";

import {
    ASSET_ROOT,
    MODULE_ID,
} from "../../core/constants.js";

import {
    setRequiredDocumentFlag,
} from "../../shared/document-flags.js";

import {
    t,
} from "../../shared/values.js";

import {
    clearContinuousActionInterruptionRequests,
} from "./continuous-action-interruption-state.js";

export const CONTINUOUS_ACTION_FLAG = "continuousAction";
export const CONTINUOUS_ACTION_STATUS_ID = `${MODULE_ID}.continuous-action`;
export const MOVEMENT_ACTION_STATUS_ID = `${MODULE_ID}.movement-action`;
export const CONTINUOUS_MOVEMENT_ACTION_IDS = Object.freeze(["crawl", "walk", "sprint"]);

const CONTINUOUS_ACTION_VERSION = 2;
const LEGACY_CONTINUOUS_ACTION_VERSION = 1;
const CONTINUOUS_ACTION_ICON = `${ASSET_ROOT}/icons/continuous-action.svg`;
const MOVEMENT_ACTION_ICON = `${ASSET_ROOT}/icons/movement-action.svg`;
const ATTACK_COMPLETION_ACTIONS = new Set(["aim", "readyRangedAttack", "searchOpening"]);
const MOVEMENT_COMPLETION_ACTIONS = new Set(CONTINUOUS_MOVEMENT_ACTION_IDS);
const SPELL_COMPLETION_ACTIONS = new Set(["focusMagic"]);
const CONTINUOUS_ACTION_COMPLETION_TRIGGERS = new Set(["attack", "movement", "spell", "tick"]);
const STAND_UP_STARTING_POSITIONS = Object.freeze({
    standUpProne: "prone",
    standUpKneeling: "kneeling",
});
const continuousActionLocks = new Set();

export function registerContinuousActionStatusEffect() {
    const statusEffects = globalThis.CONFIG?.statusEffects;
    if (!statusEffects) return false;
    for (const definition of [continuousActionStatusDefinition(), movementActionStatusDefinition()]) {
        statusEffects[definition.id] = {
            ...definition,
            changes: [],
            hud: false,
            showIcon: globalThis.CONST?.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2,
        };
    }
    return true;
}

export function normalizeContinuousAction(value) {
    const version = Number(value?.version);
    if (!value || typeof value !== "object"
        || ![LEGACY_CONTINUOUS_ACTION_VERSION, CONTINUOUS_ACTION_VERSION].includes(version)) return null;
    const actionId = optionalString(value.actionId);
    const combatId = optionalString(value.combatId);
    const combatantId = optionalString(value.combatantId);
    const tokenUuid = optionalString(value.tokenUuid);
    const startTick = Number(value.startTick);
    const endTick = Number(value.endTick);
    if (!actionId || !combatId || !combatantId || !tokenUuid
        || !Number.isFinite(startTick) || !Number.isFinite(endTick) || endTick <= startTick) {
        return null;
    }
    const completionTrigger = CONTINUOUS_ACTION_COMPLETION_TRIGGERS.has(value.completionTrigger)
        ? value.completionTrigger
        : defaultContinuousActionCompletionTrigger(actionId);
    const startingCombatPosition = optionalString(value.startingCombatPosition);
    if (startingCombatPosition
        && startingCombatPosition !== requiredStandUpStartingPosition(actionId)) return null;
    const record = {
        version,
        id: optionalString(value.id),
        actionId,
        completionTrigger,
        combatId,
        combatantId,
        tokenUuid,
        startTick,
        endTick,
        createdAt: nullableNumber(value.createdAt),
        createdBy: optionalString(value.createdBy),
        updatedAt: nullableNumber(value.updatedAt),
    };
    if (startingCombatPosition) record.startingCombatPosition = startingCombatPosition;
    return record;
}

export function requiredStandUpStartingPosition(actionId) {
    return STAND_UP_STARTING_POSITIONS[actionId] ?? null;
}

export function getContinuousAction(tokenLike, combat = globalThis.game?.combat) {
    const token = tokenDocument(tokenLike);
    const action = readContinuousAction(token);
    if (!action || !combat || action.combatId !== optionalString(combat.id)) return null;
    if (action.tokenUuid !== optionalString(token?.uuid)) return null;
    const combatant = combatantById(combat, action.combatantId);
    if (!combatant) return null;
    const currentTick = combatTick(combat);
    const endTick = currentTick < action.endTick
        ? Math.max(action.endTick, finiteNumber(combatant.initiative, action.endTick))
        : action.endTick;
    if (continuousActionBecomesReadyAtOwnTurn(action)
        && continuousActionReachedCompletionTick({ ...action, endTick }, combat)) {
        return null;
    }
    return endTick === action.endTick ? action : { ...action, endTick };
}

export function isTokenInContinuousAction(tokenLike, combat = globalThis.game?.combat) {
    return Boolean(getContinuousAction(tokenLike, combat));
}

export async function beginContinuousAction(context, {
    actionId,
    completionTrigger = defaultContinuousActionCompletionTrigger(actionId),
    startingCombatPosition = null,
    startTick = combatantInitiative(context?.combatant, context?.combat),
    endTick = combatantInitiative(context?.combatant, context?.combat),
} = {}) {
    const token = tokenDocument(context?.token ?? context?.combatant?.token);
    const actor = token?.actor ?? context?.actor;
    const combat = context?.combat ?? globalThis.game?.combat;
    const combatant = context?.combatant;
    const normalizedStartTick = Number(startTick);
    const normalizedEndTick = Number(endTick);
    if (!token || !actor || !combat || !combatant || !optionalString(actionId)
        || !Number.isFinite(normalizedStartTick) || !Number.isFinite(normalizedEndTick)
        || normalizedEndTick <= normalizedStartTick) {
        return null;
    }

    const record = normalizeContinuousAction({
        version: CONTINUOUS_ACTION_VERSION,
        id: randomId(),
        actionId,
        completionTrigger,
        combatId: combat.id,
        combatantId: combatant.id,
        tokenUuid: token.uuid,
        startTick: normalizedStartTick,
        endTick: normalizedEndTick,
        createdAt: Date.now(),
        createdBy: globalThis.game?.user?.id ?? null,
        updatedAt: Date.now(),
        ...(startingCombatPosition ? { startingCombatPosition } : {}),
    });
    if (!record) return null;

    await withContinuousActionLock(token, async () => {
        if (continuousActionBecomesReadyAtOwnTurn(record)
            && continuousActionReachedCompletionTick(record, combat)) {
            const previous = readContinuousAction(token);
            if (previous) await setRequiredDocumentFlag(token, CONTINUOUS_ACTION_FLAG, null);
            await removeContinuousActionEffects(actor, previous ?? record);
            return;
        }
        await setRequiredDocumentFlag(token, CONTINUOUS_ACTION_FLAG, record);
        await ensureContinuousActionEffects(actor, record).catch((error) => {
            console.error(`${MODULE_ID} | Could not display the continuous-action status effect`, error);
        });
    });
    services.scheduleRender?.(0);
    return record;
}

export async function completeContinuousAction(context, {
    actionIds = null,
    expectedId = null,
    trigger = null,
} = {}) {
    const token = continuousActionToken(context);
    const action = readContinuousAction(token);
    if (!token || !action) return false;
    const combat = context?.combat ?? globalThis.game?.combat;
    if (combat?.id && action.combatId !== optionalString(combat.id)) return false;
    if (expectedId && action.id !== expectedId) return false;
    if (trigger && continuousActionCompletionTrigger(action) !== trigger) return false;
    if (actionIds && !new Set(actionIds).has(action.actionId)) return false;
    return clearContinuousAction(token, { expectedId: action.id });
}

export async function advanceContinuousActions(combat = globalThis.game?.combat) {
    if (!combat) return false;
    const primaryGm = services.getActivePrimaryGm?.() ?? null;
    if (primaryGm && primaryGm.id !== globalThis.game?.user?.id) return false;

    let changed = false;
    for (const combatant of combatantsOf(combat)) {
        const token = tokenDocument(combatant?.token);
        if (!token || (!primaryGm && !mayCurrentUserManage(combatant, token))) continue;
        changed = await syncContinuousAction(token, combatant, combat) || changed;
    }
    if (changed) services.scheduleRender?.(0);
    return changed;
}

export async function clearContinuousActionsForCombat(combat) {
    if (!combat) return false;
    let changed = false;
    for (const combatant of combatantsOf(combat)) {
        changed = await clearContinuousActionForCombatant(combatant, { combatId: combat.id }) || changed;
    }
    return changed;
}

export async function clearContinuousActionForCombatant(combatant, { combatId = null } = {}) {
    const token = tokenDocument(combatant?.token);
    const action = readContinuousAction(token);
    if (!token || !action) return false;
    if (combatId && action.combatId !== optionalString(combatId)) return false;
    if (action.combatantId !== optionalString(combatant?.id)) return false;
    return clearContinuousAction(token, { expectedId: action.id });
}

export async function clearContinuousAction(tokenLike, { expectedId = null } = {}) {
    const token = tokenDocument(tokenLike);
    const action = readContinuousAction(token);
    if (!token || !action || (expectedId && action.id !== expectedId)) return false;
    const cleared = await withContinuousActionLock(token, async () => {
        const current = readContinuousAction(token);
        if (!current || (expectedId && current.id !== expectedId)) return false;
        await setRequiredDocumentFlag(token, CONTINUOUS_ACTION_FLAG, null);
        await removeContinuousActionEffects(token.actor, current);
        return true;
    });
    if (cleared) await clearContinuousActionInterruptionRequests(token, {
        actionRecordId: action.id,
    });
    return cleared;
}

export async function restoreContinuousAction(tokenLike, actionLike, combat = globalThis.game?.combat) {
    const token = tokenDocument(tokenLike);
    const action = normalizeContinuousAction(actionLike);
    const combatant = combatantById(combat, action?.combatantId);
    if (!token || !action || !combatant
        || action.combatId !== optionalString(combat?.id)
        || action.tokenUuid !== optionalString(token.uuid)) {
        return null;
    }

    const restored = await withContinuousActionLock(token, async () => {
        const current = readContinuousAction(token);
        if (current) return current.id === action.id ? current : null;
        if (continuousActionBecomesReadyAtOwnTurn(action)
            && continuousActionReachedCompletionTick(action, combat)) return null;
        await setRequiredDocumentFlag(token, CONTINUOUS_ACTION_FLAG, action);
        await ensureContinuousActionEffects(token.actor, action).catch((error) => {
            console.error(`${MODULE_ID} | Could not restore the continuous-action status effect`, error);
        });
        return action;
    });
    if (restored) services.scheduleRender?.(0);
    return restored;
}

async function syncContinuousAction(token, combatant, combat) {
    return withContinuousActionLock(token, async () => {
        const action = readContinuousAction(token);
        if (!action) {
            return removeContinuousActionEffects(token.actor, {
                combatId: optionalString(combat.id),
                combatantId: optionalString(combatant.id),
                tokenUuid: optionalString(token.uuid),
            });
        }

        const matches = action.combatId === optionalString(combat.id)
            && action.combatantId === optionalString(combatant.id)
            && action.tokenUuid === optionalString(token.uuid);
        if (!matches) {
            await setRequiredDocumentFlag(token, CONTINUOUS_ACTION_FLAG, null);
            await removeContinuousActionEffects(token.actor, action);
            return true;
        }

        const initiative = finiteNumber(combatant.initiative, action.endTick);
        if (continuousActionBecomesReadyAtOwnTurn(action)
            && continuousActionReachedCompletionTick(action, combat)) {
            await applyContinuousActionCompletion(token.actor, action);
            await setRequiredDocumentFlag(token, CONTINUOUS_ACTION_FLAG, null);
            await removeContinuousActionEffects(token.actor, action);
            await clearContinuousActionInterruptionRequests(token, {
                actionRecordId: action.id,
            });
            return true;
        }

        if (initiative > action.endTick) {
            const extended = {
                ...action,
                endTick: initiative,
                updatedAt: Date.now(),
            };
            await setRequiredDocumentFlag(token, CONTINUOUS_ACTION_FLAG, extended);
            await ensureContinuousActionEffects(token.actor, extended);
            return true;
        }

        return ensureContinuousActionEffects(token.actor, action);
    });
}

async function applyContinuousActionCompletion(actor, action) {
    const requiredPosition = requiredStandUpStartingPosition(action?.actionId);
    if (!requiredPosition || action.startingCombatPosition !== requiredPosition) return false;
    if (typeof services.setCombatPosition !== "function") {
        throw new Error("The combat-position service is unavailable.");
    }
    await services.setCombatPosition(actor, "standing");
    return true;
}

async function ensureContinuousActionEffects(actor, action) {
    if (!actor) return false;
    const retainedEffects = new Set();
    let changed = false;

    for (const status of statusDefinitionsForAction(action)) {
        const effect = collectionValues(actor.effects).find((candidate) => (
            !retainedEffects.has(candidate)
            && effectBelongsToAction(candidate, action)
            && effectHasStatus(candidate, status.id)
        ));
        const data = continuousActionEffectData(action, status);
        if (effect) {
            retainedEffects.add(effect);
            if (effectMatchesAction(effect, action, status, data)) continue;
            await effect.update?.({
                name: data.name,
                description: data.description,
                img: data.img,
                disabled: false,
                showIcon: data.showIcon,
                statuses: data.statuses,
                [`flags.${MODULE_ID}.${CONTINUOUS_ACTION_FLAG}`]: action,
            });
            changed = true;
            continue;
        }

        if (typeof actor.createEmbeddedDocuments !== "function") continue;
        const created = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
        const createdEffect = collectionValues(created).find((candidate) => (
            effectBelongsToAction(candidate, action) && effectHasStatus(candidate, status.id)
        )) ?? collectionValues(actor.effects).find((candidate) => (
            !retainedEffects.has(candidate)
            && effectBelongsToAction(candidate, action)
            && effectHasStatus(candidate, status.id)
        ));
        if (createdEffect) retainedEffects.add(createdEffect);
        changed = true;
    }

    const staleIds = collectionValues(actor.effects)
        .filter((effect) => effectBelongsToAction(effect, action) && !retainedEffects.has(effect))
        .map((effect) => effect.id ?? effect._id)
        .filter(Boolean);
    if (staleIds.length && typeof actor.deleteEmbeddedDocuments === "function") {
        await actor.deleteEmbeddedDocuments("ActiveEffect", staleIds);
        changed = true;
    }
    return changed;
}

async function removeContinuousActionEffects(actor, action) {
    if (!actor) return false;
    const ids = collectionValues(actor.effects)
        .filter((effect) => effectBelongsToAction(effect, action))
        .map((effect) => effect.id ?? effect._id)
        .filter(Boolean);
    if (!ids.length || typeof actor.deleteEmbeddedDocuments !== "function") return false;
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    return true;
}

function continuousActionEffectData(action, status) {
    return {
        name: continuousActionEffectName(action, status),
        description: t(status.description),
        img: status.img,
        changes: [],
        disabled: false,
        showIcon: globalThis.CONST?.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2,
        statuses: [status.id],
        flags: {
            [MODULE_ID]: {
                [CONTINUOUS_ACTION_FLAG]: action,
            },
        },
    };
}

function effectBelongsToAction(effect, action) {
    if (!effectHasManagedActionStatus(effect)) return false;
    const stored = effectContinuousAction(effect);
    if (!stored) return true;
    return (!action?.combatId || stored.combatId === action.combatId)
        && (!action?.combatantId || stored.combatantId === action.combatantId)
        && (!action?.tokenUuid || stored.tokenUuid === action.tokenUuid);
}

function effectHasManagedActionStatus(effect) {
    return effectHasStatus(effect, CONTINUOUS_ACTION_STATUS_ID)
        || effectHasStatus(effect, MOVEMENT_ACTION_STATUS_ID);
}

function effectHasStatus(effect, statusId) {
    const statuses = effectStatuses(effect);
    return typeof statuses.has === "function"
        ? statuses.has(statusId)
        : Array.from(statuses).includes(statusId);
}

function effectStatuses(effect) {
    return effect?.statuses ?? effect?._source?.statuses ?? [];
}

function effectContinuousAction(effect) {
    return normalizeContinuousAction(
        effect?.getFlag?.(MODULE_ID, CONTINUOUS_ACTION_FLAG)
        ?? effect?.flags?.[MODULE_ID]?.[CONTINUOUS_ACTION_FLAG]
    );
}

function effectMatchesAction(effect, action, status, data) {
    const stored = effectContinuousAction(effect);
    return Boolean(stored
        && stored.id === action.id
        && stored.endTick === action.endTick
        && effectHasStatus(effect, status.id)
        && Array.from(effectStatuses(effect)).length === 1
        && effect.name === data.name
        && effect.disabled !== true
        && Number(effect.showIcon ?? effect._source?.showIcon) === (globalThis.CONST?.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2));
}

function continuousActionEffectName(action, status) {
    const actionName = t(`SMOOTHER_FIGHT.HUD.TickActions.${action.actionId}.Name`);
    const assignedName = status.id === MOVEMENT_ACTION_STATUS_ID
        ? "SMOOTHER_FIGHT.StatusEffects.MovementAction.AssignedName"
        : "SMOOTHER_FIGHT.StatusEffects.ContinuousAction.AssignedName";
    return t(assignedName, { action: actionName });
}

function statusDefinitionsForAction(action) {
    const statuses = [continuousActionStatusDefinition()];
    if (continuousActionCompletionTrigger(action) === "movement") {
        statuses.push(movementActionStatusDefinition());
    }
    return statuses;
}

function continuousActionStatusDefinition() {
    return {
        id: CONTINUOUS_ACTION_STATUS_ID,
        name: "SMOOTHER_FIGHT.StatusEffects.ContinuousAction.Name",
        description: "SMOOTHER_FIGHT.StatusEffects.ContinuousAction.Description",
        img: CONTINUOUS_ACTION_ICON,
    };
}

function movementActionStatusDefinition() {
    return {
        id: MOVEMENT_ACTION_STATUS_ID,
        name: "SMOOTHER_FIGHT.StatusEffects.MovementAction.Name",
        description: "SMOOTHER_FIGHT.StatusEffects.MovementAction.Description",
        img: MOVEMENT_ACTION_ICON,
    };
}

function readContinuousAction(token) {
    return normalizeContinuousAction(
        token?.getFlag?.(MODULE_ID, CONTINUOUS_ACTION_FLAG)
        ?? token?.flags?.[MODULE_ID]?.[CONTINUOUS_ACTION_FLAG]
    );
}

function continuousActionCompletionTrigger(action) {
    if (CONTINUOUS_ACTION_COMPLETION_TRIGGERS.has(action?.completionTrigger)) return action.completionTrigger;
    return defaultContinuousActionCompletionTrigger(action?.actionId ?? action);
}

function continuousActionBecomesReadyAtOwnTurn(action) {
    return continuousActionCompletionTrigger(action) !== "movement";
}

function defaultContinuousActionCompletionTrigger(action) {
    const actionId = optionalString(action?.actionId ?? action);
    if (ATTACK_COMPLETION_ACTIONS.has(actionId)) return "attack";
    if (MOVEMENT_COMPLETION_ACTIONS.has(actionId)) return "movement";
    if (SPELL_COMPLETION_ACTIONS.has(actionId)) return "spell";
    return "tick";
}

function continuousActionReachedCompletionTick(action, combat) {
    const activeCombatant = combat?.combatant ?? combat?.turns?.[0] ?? null;
    return optionalString(activeCombatant?.id) === action.combatantId
        && Math.round(finiteNumber(activeCombatant?.initiative, Number.NEGATIVE_INFINITY)) >= action.endTick;
}

function continuousActionToken(context) {
    const direct = tokenDocument(context?.token ?? context?.combatant?.token);
    if (direct) return direct;
    const actor = context?.actor;
    const combat = context?.combat ?? globalThis.game?.combat;
    return tokenDocument(combatantsOf(combat).find((combatant) => (
        combatant?.actor === actor
        || (actor?.id && combatant?.actorId === actor.id)
        || (actor?.id && combatant?.actor?.id === actor.id)
    ))?.token);
}

function mayCurrentUserManage(combatant, token) {
    const user = globalThis.game?.user;
    if (!user) return false;
    const controller = services.getRuntimeController?.(combatant ?? token);
    return Boolean(controller?.id === user.id && (user.isGM || token?.actor?.isOwner));
}

function combatantInitiative(combatant, combat) {
    const live = combatantById(combat ?? globalThis.game?.combat, combatant?.id) ?? combatant;
    return Number(live?.initiative);
}

function combatantById(combat, id) {
    if (!combat || !id) return null;
    return combat.combatants?.get?.(id)
        ?? combatantsOf(combat).find((combatant) => combatant?.id === id)
        ?? null;
}

function combatTick(combat) {
    for (const value of [combat?.currentTick, combat?.combatant?.initiative, combat?.round]) {
        const tick = Number(value);
        if (Number.isFinite(tick)) return tick;
    }
    return 0;
}

function combatantsOf(combat) {
    return Array.from(combat?.combatants?.values?.() ?? combat?.combatants ?? combat?.turns ?? []);
}

function tokenDocument(tokenLike) {
    return tokenLike?.document ?? tokenLike ?? null;
}

async function withContinuousActionLock(token, operation) {
    const key = token?.uuid ?? token?.id;
    if (!key || continuousActionLocks.has(key)) return false;
    continuousActionLocks.add(key);
    try {
        return await operation();
    } finally {
        continuousActionLocks.delete(key);
    }
}

function collectionValues(collection) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (Array.isArray(collection.contents)) return collection.contents;
    if (typeof collection.values === "function") return Array.from(collection.values());
    return Array.from(collection);
}

function optionalString(value) {
    const normalized = String(value ?? "").trim();
    return normalized || null;
}

function nullableNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function randomId() {
    return globalThis.foundry?.utils?.randomID?.()
        ?? globalThis.crypto?.randomUUID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
