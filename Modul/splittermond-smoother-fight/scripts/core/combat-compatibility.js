import { MODULE_ID } from "./constants.js";

const PATCH_MARKER = Symbol.for(`${MODULE_ID}.combatantSortCompatibility`);

export function getApplicableCombat() {
    const viewedCombat = globalThis.game?.combat ?? null;
    const combats = Array.from(globalThis.game?.combats?.values?.() ?? globalThis.game?.combats ?? []);
    if (!combats.length) return viewedCombat;

    const scene = globalThis.game?.currentScene
        ?? globalThis.canvas?.scene
        ?? globalThis.game?.scenes?.current
        ?? null;
    const sceneId = documentReference(scene) ?? globalThis.game?.user?.viewedScene ?? null;
    const applicable = combats.filter((combat) => {
        const combatScene = combat?.scene ?? combat?.sceneId ?? null;
        const combatSceneId = documentReference(combatScene);
        return combatSceneId === null || sceneId === null || combatScene === scene || combatSceneId === sceneId;
    });
    return applicable.find((combat) => combat?.isActive === true || combat?.active === true)
        ?? applicable[0]
        ?? null;
}

/**
 * Splittermond 14.3.0-alpha4 dereferences both actors while sorting same-tick
 * combatants. Foundry can prepare combats before token actors are available,
 * so one transient null actor otherwise aborts preparation of the whole combat.
 */
export function installCombatantSortCompatibility() {
    if (globalThis.game?.system?.id && globalThis.game.system.id !== "splittermond") return false;

    const prototype = globalThis.CONFIG?.Combat?.documentClass?.prototype;
    const original = prototype?._sortCombatants;
    if (typeof original !== "function") return false;
    if (original[PATCH_MARKER]) return true;

    function smootherFightSortCombatants(left, right) {
        const leftPreparedSystem = preparedCombatantActorSystem(left);
        const rightPreparedSystem = preparedCombatantActorSystem(right);
        if (leftPreparedSystem && rightPreparedSystem) return original.call(this, left, right);

        const leftSystem = leftPreparedSystem ?? fallbackActorSystem(left);
        const rightSystem = rightPreparedSystem ?? fallbackActorSystem(right);

        const initiativeResult = compareDescendingPriority(
            combatantSortInitiative(left),
            combatantSortInitiative(right),
        );
        if (initiativeResult !== 0) return initiativeResult;

        const intuitionResult = compareHigherFirst(
            actorValue(leftSystem, "attributes", "intuition"),
            actorValue(rightSystem, "attributes", "intuition"),
        );
        if (intuitionResult !== 0) return intuitionResult;

        return compareHigherFirst(
            actorValue(leftSystem, "derivedValues", "initiative"),
            actorValue(rightSystem, "derivedValues", "initiative"),
        );
    }

    Object.defineProperty(smootherFightSortCombatants, PATCH_MARKER, { value: true });
    prototype._sortCombatants = smootherFightSortCombatants;
    return prototype._sortCombatants === smootherFightSortCombatants;
}

function preparedCombatantActorSystem(combatant) {
    try {
        return combatant?.actor?.system ?? null;
    } catch {
        return null;
    }
}

function fallbackActorSystem(combatant) {
    try {
        return globalThis.game?.actors?.get?.(combatant?.actorId)?.system ?? null;
    } catch {
        return null;
    }
}

function parseInitiative(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function combatantSortInitiative(combatant) {
    const initiative = parseInitiative(combatant?.initiative);
    if (initiative === null) return null;
    return initiative + (combatant?.isDefeated ? 1000 : 0);
}

function actorValue(system, group, property) {
    const value = Number(system?.[group]?.[property]?.value);
    return Number.isFinite(value) ? value : null;
}

function compareDescendingPriority(left, right) {
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
}

function compareHigherFirst(left, right) {
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left;
}

function documentReference(documentOrId) {
    if (documentOrId === null || documentOrId === undefined || documentOrId === "") return null;
    return documentOrId?.id ?? documentOrId?._id ?? documentOrId;
}
