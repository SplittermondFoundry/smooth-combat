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
    t,
} from "../../shared/values.js";

import {
    installTemporarySelectableModifier,
} from "../../shared/temporary-selectable-modifier.js";

import {
    completeContinuousAction,
} from "./continuous-action.js";

const ATTACK_PREPARATION_FLAG = "attackPreparation";
const ATTACK_PREPARATION_ACTIONS = new Set(["aim", "searchOpening"]);
const ATTACK_PREPARATION_TICKS = new Set([2, 4, 6]);

export function getAttackPreparation(actor, combatId = undefined) {
    const raw = actor?.getFlag?.(MODULE_ID, ATTACK_PREPARATION_FLAG)
        ?? actor?.flags?.[MODULE_ID]?.[ATTACK_PREPARATION_FLAG]
        ?? null;
    const preparation = normalizeAttackPreparation(raw);
    if (!preparation) return null;
    if (combatId !== undefined && preparation.combatId && preparation.combatId !== combatId) return null;
    return preparation;
}

export function normalizeAttackPreparation(value) {
    if (!value || typeof value !== "object") return null;
    const actionId = String(value.actionId ?? "");
    const id = String(value.id ?? "");
    const ticks = Number(value.ticks);
    const bonus = Number(value.bonus);
    if (!ATTACK_PREPARATION_ACTIONS.has(actionId)
        || !id
        || !ATTACK_PREPARATION_TICKS.has(ticks)
        || !Number.isInteger(bonus)
        || bonus !== ticks / 2) {
        return null;
    }

    const preparation = {
        id,
        actionId,
        attackKind: actionId === "aim" ? "ranged" : "melee",
        ticks,
        bonus,
        combatId: optionalString(value.combatId),
        combatantId: optionalString(value.combatantId),
        createdAt: Number.isFinite(Number(value.createdAt)) ? Number(value.createdAt) : null,
    };
    if (actionId === "aim") {
        preparation.attackId = optionalString(value.attackId);
        preparation.targetTokenUuid = optionalString(value.targetTokenUuid);
        preparation.targetActorUuid = optionalString(value.targetActorUuid);
        preparation.targetName = optionalString(value.targetName);
        if (!preparation.attackId || (!preparation.targetTokenUuid && !preparation.targetActorUuid)) return null;
    }
    return preparation;
}

export async function setAttackPreparation(context, actionId, ticks, { attack = null } = {}) {
    const actor = context?.actor;
    const normalizedTicks = Number(ticks);
    if (!actor || !ATTACK_PREPARATION_ACTIONS.has(actionId) || !ATTACK_PREPARATION_TICKS.has(normalizedTicks)) {
        throw new Error(`Invalid attack preparation: ${actionId} (${ticks})`);
    }

    const preparation = {
        id: preparationId(),
        actionId,
        attackKind: actionId === "aim" ? "ranged" : "melee",
        ticks: normalizedTicks,
        bonus: normalizedTicks / 2,
        combatId: optionalString(context.combat?.id ?? globalThis.game?.combat?.id),
        combatantId: optionalString(context.combatant?.id),
        createdAt: Date.now(),
    };
    if (actionId === "aim") {
        preparation.attackId = optionalString(attack?.id);
        preparation.targetTokenUuid = optionalString(context.target?.uuid ?? context.primaryTargetTokenUuid);
        preparation.targetActorUuid = optionalString(context.target?.actor?.uuid ?? context.primaryTargetActorUuid);
        preparation.targetName = optionalString(context.target?.name ?? context.target?.actor?.name);
    }
    const normalized = normalizeAttackPreparation(preparation);
    if (!normalized) throw new Error(`Incomplete attack preparation: ${actionId}`);

    await setRequiredDocumentFlag(actor, ATTACK_PREPARATION_FLAG, preparation);
    services.scheduleRender?.(0);
    return preparation;
}

export function resolveAttackPreparationUse(preparation, { attackId, isRanged, target } = {}) {
    if (!preparation) return { applies: false, consumeOnSuccess: false, mismatch: null };
    if (preparation.actionId === "searchOpening") {
        const applies = !isRanged;
        return { applies, consumeOnSuccess: applies, mismatch: null };
    }
    // Any submitted attack ends Splittermond's readied ranged-attack state. Aim
    // must end with it even when the character chooses a melee attack instead.
    if (!isRanged) return { applies: false, consumeOnSuccess: true, mismatch: null };

    const attackMatches = preparation.attackId === attackId;
    const targetMatches = attackPreparationTargetMatches(preparation, target);
    return {
        applies: attackMatches && targetMatches,
        consumeOnSuccess: true,
        mismatch: !attackMatches ? "attack" : !targetMatches ? "target" : null,
    };
}

export function applyAttackPreparationModifier(rollOptions, preparation) {
    const existingModifier = Number(rollOptions?.modifier);
    return {
        ...(rollOptions ?? {}),
        modifier: (Number.isFinite(existingModifier) ? existingModifier : 0) + preparation.bonus,
    };
}

export function prepareAttackPreparationRollOptions(
    attack,
    rollOptions,
    preparation,
    { includeAttackDefault = false } = {}
) {
    const name = t(`SMOOTHER_FIGHT.HUD.TickActions.${preparation.actionId}.Name`);
    const cleanup = installTemporarySelectableModifier({
        skill: attack?.skill,
        modifierManager: attack?.actor?.modifier,
        groupId: `skill.${attack?.id ?? ""}`,
        recordId: `attack-preparation:${preparation.id}`,
        name,
        amount: preparation.bonus,
    });
    if (!cleanup) {
        return {
            cleanup: () => {},
            rollOptions: applyAttackPreparationModifier(rollOptions, preparation),
            usesNamedModifier: false,
        };
    }

    const selected = Array.isArray(rollOptions?.preSelectedModifier)
        ? rollOptions.preSelectedModifier
        : includeAttackDefault ? [attack?.item?.name] : [];
    return {
        cleanup,
        rollOptions: {
            ...(rollOptions ?? {}),
            preSelectedModifier: uniqueModifierNames([...selected, name]),
        },
        usesNamedModifier: true,
    };
}

export async function consumeAttackPreparation(actor, preparation) {
    return clearAttackPreparation(actor, { expectedId: preparation?.id });
}

export async function clearAimPreparation(actor) {
    const preparation = getAttackPreparation(actor);
    if (preparation?.actionId !== "aim") return false;
    return clearAttackPreparation(actor, { expectedId: preparation.id });
}

export async function dismissAttackPreparation(context) {
    const preparation = getAttackPreparation(context?.actor);
    const cleared = await clearAttackPreparation(context?.actor);
    if (!cleared) return false;
    await completeContinuousAction(context, {
        actionIds: preparation ? [preparation.actionId] : [],
    }).catch(() => false);
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.AttackPreparationCleared"));
    return true;
}

export async function clearAttackPreparation(actor, { expectedId = null } = {}) {
    const preparation = getAttackPreparation(actor);
    if (!preparation || (expectedId && preparation.id !== expectedId)) return false;
    await setRequiredDocumentFlag(actor, ATTACK_PREPARATION_FLAG, null);
    services.scheduleRender?.(0);
    return true;
}

export async function clearAttackPreparationsForCombat(combat) {
    const combatId = optionalString(combat?.id);
    if (!combatId) return 0;

    const combatants = combat?.combatants ?? combat?.turns ?? [];
    const actors = new Set(Array.from(combatants.values?.() ?? combatants)
        .map((combatant) => combatant?.actor ?? globalThis.game?.actors?.get?.(combatant?.actorId))
        .filter(Boolean));
    const results = await Promise.allSettled(Array.from(actors, async (actor) => {
        const preparation = getAttackPreparation(actor);
        if (preparation?.combatId !== combatId) return false;
        return clearAttackPreparation(actor, { expectedId: preparation.id });
    }));
    return results.filter((result) => result.status === "fulfilled" && result.value).length;
}

export async function clearAttackPreparationForCombatant(combatant) {
    const actor = combatant?.actor ?? globalThis.game?.actors?.get?.(combatant?.actorId);
    const combatId = optionalString(combatant?.parent?.id ?? combatant?.combat?.id);
    const combatantId = optionalString(combatant?.id);
    const preparation = getAttackPreparation(actor);
    if (!actor
        || !combatId
        || !combatantId
        || preparation?.combatId !== combatId
        || (preparation.combatantId && preparation.combatantId !== combatantId)) {
        return false;
    }
    return clearAttackPreparation(actor, { expectedId: preparation.id });
}

function attackPreparationTargetMatches(preparation, target) {
    if (preparation.targetTokenUuid) return preparation.targetTokenUuid === target?.uuid;
    return Boolean(preparation.targetActorUuid && preparation.targetActorUuid === target?.actor?.uuid);
}

function uniqueModifierNames(names) {
    const seen = new Set();
    return names.filter((name) => {
        const normalized = String(name ?? "").trim();
        const key = normalized.toLocaleLowerCase();
        if (!normalized || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function optionalString(value) {
    const normalized = String(value ?? "").trim();
    return normalized || null;
}

function preparationId() {
    return globalThis.foundry?.utils?.randomID?.()
        ?? globalThis.crypto?.randomUUID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
