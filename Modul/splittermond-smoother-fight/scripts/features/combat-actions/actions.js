import { combatActionState } from "./state.js";

import { services } from "../../core/services.js";

import {
    actionRequiresTarget,
    attackReadiness,
    COMBAT_TICK_ACTIONS,
    isTargetDependentDifficulty,
    toggleFavoriteSkillId,
    toggleFavoriteTickActionId,
    visibleCanvasCenterY,
} from "../../combat-rules.js";

import {
    COMBAT_PAUSE,
    MAX_FAVORITE_SKILLS,
    MODULE_ID,
} from "../../core/constants.js";

import {
    displayLabel,
    escapeHtml,
    localizeSystem,
    numericValue,
    t,
} from "../../shared/values.js";

import {
    clearPreparationApplication,
    prepareCombatAction,
    revertTokenMovementApplication,
} from "./applications.js";

import {
    clearAimPreparation,
    consumeAttackPreparation,
    getAttackPreparation,
    prepareAttackRollOptions,
    resolveAttackPreparationUse,
} from "./attack-preparation.js";

import {
    combatPositionAttackModifiers,
} from "./combat-position-modifier.js";

import {
    warnIfAttackOutOfRange,
    warnIfSpellOutOfRange,
} from "./range-warning.js";

import {
    completeContinuousAction,
} from "./continuous-action.js";

import {
    requireOpenCombatFlowForTicks,
} from "./flow-guard.js";

import {
    prepareSpellTargetRollOptions,
} from "./spell-target-modifier.js";

import { isRangedAttack } from "./attack-type.js";

import {
    markTargetModifiersPrepared,
} from "./system-roll-modifier-interceptor.js";

export async function performAttack(context, attackId, rollOptions = {}, rollAttack = null) {
    context = liveRuntimeActionContext(context);
    if (!context) return false;
    const attack = context.actor.attacks?.find((candidate) => candidate.id === attackId);
    if (!attack) return false;
    const ranged = isRangedAttack(attack);
    const preparedAttackId = context.actor.getFlag?.("splittermond", "preparedAttack");
    const readiness = attackReadiness(ranged, attack.id, preparedAttackId);
    if (actionRequiresTarget(readiness.ready) && !context.target) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.SelectTargetFirst"));
        return false;
    }
    if (readiness.ready) warnIfAttackOutOfRange(context, attack, ranged);
    const preparation = getAttackPreparation(
        context.actor,
        context.combat?.id ?? globalThis.game?.combat?.id
    );
    const preparationUse = readiness.ready
        ? resolveAttackPreparationUse(preparation, {
            attackId: attack.id,
            isRanged: ranged,
            target: context.target,
        })
        : { applies: false, consumeOnSuccess: false, mismatch: null };
    if (preparationUse.mismatch) {
        ui.notifications.warn(t(preparationUse.mismatch === "target"
            ? "SMOOTHER_FIGHT.HUD.AimTargetMismatch"
            : "SMOOTHER_FIGHT.HUD.AimAttackMismatch", {
            target: preparation?.targetName ?? "–",
        }));
    }
    const positionModifiers = combatPositionAttackModifiers({
        attacker: context.actor,
        target: context.target,
        attack,
        isRanged: ranged,
    });
    const preparedRoll = prepareAttackRollOptions(
        attack,
        rollOptions,
        preparationUse.applies ? preparation : null,
        {
            additionalModifiers: positionModifiers,
            includeAttackDefault: typeof rollAttack !== "function",
        }
    );
    let completed = false;
    if (readiness.ready) {
        const pendingNonce = setPendingOffenseKind(
            context.actor.id,
            ranged ? "ranged" : "attack",
            context
        );
        try {
            const success = await services.withTemporarySystemTargets(
                [context.target],
                () => typeof rollAttack === "function"
                    ? rollAttack(attack, preparedRoll.rollOptions)
                    : context.actor.rollAttack(
                        attackId,
                        markTargetModifiersPrepared(preparedRoll.rollOptions)
                    )
            );
            if (success) await completeContinuousAction(context, { trigger: "attack" }).catch(() => false);
            if (success && context.actor.getFlag?.("splittermond", "preparedSpell")) {
                await cancelPreparedSpell(context);
            }
            if (success && readiness.prepared) await clearPreparationApplication(context.actor, "attack");
            else if (success) await context.actor.setFlag("splittermond", "preparedAttack", null);
            if (success && preparationUse.consumeOnSuccess) {
                await consumeAttackPreparation(context.actor, preparation).catch(() => false);
            }
            completed = Boolean(success);
        } finally {
            preparedRoll.cleanup();
            clearPendingOffenseKind(context.actor.id, pendingNonce);
        }
    } else {
        completed = await prepareCombatAction(context, {
            kind: "attack",
            itemId: attackId,
            ticks: await getAttackSpeed(attack),
            label: `${localizeSystem("splittermond.attack", "Angriff")}: ${attack.name}`,
        });
        if (completed && ranged) await clearAimPreparation(context.actor).catch(() => false);
    }
    services.scheduleRender();
    return completed;
}

export async function cancelPreparedAttack(context) {
    await clearPreparationApplication(context.actor, "attack");
    await clearAimPreparation(context.actor).catch(() => false);
    await completeContinuousAction(context, {
        actionIds: ["aim", "readyRangedAttack"],
    }).catch(() => false);
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.AttackCancelled"));
    services.scheduleRender(0);
}

export async function toggleDefaultAttack(context, attackId) {
    const attack = context.actor.attacks?.find((candidate) => candidate.id === attackId);
    if (!attack) return;
    const current = context.actor.getFlag?.(MODULE_ID, "defaultAttackId");
    const next = current === attackId ? null : attackId;
    await context.actor.setFlag(MODULE_ID, "defaultAttackId", next);
    ui.notifications.info(t(next ? "SMOOTHER_FIGHT.HUD.DefaultAttackSet" : "SMOOTHER_FIGHT.HUD.DefaultAttackCleared", { attack: attack.name }));
    services.scheduleRender(0);
}

export async function toggleFavoriteSkill(context, skillId) {
    const skills = Object.values(context.actor.skills ?? {});
    const skill = skills.find((candidate) => candidate.id === skillId);
    if (!skill) return;
    const result = toggleFavoriteSkillId(
        context.actor.getFlag?.(MODULE_ID, "favoriteSkillIds"),
        skillId,
        skills.map((candidate) => candidate.id),
        MAX_FAVORITE_SKILLS
    );
    if (result.limitReached) {
        services.clearActionMenuExpansionRequest();
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.FavoriteSkillLimit", { max: MAX_FAVORITE_SKILLS }));
        return;
    }
    if (!result.changed) {
        services.clearActionMenuExpansionRequest();
        return;
    }
    await context.actor.setFlag(MODULE_ID, "favoriteSkillIds", result.ids);
    ui.notifications.info(t(result.added ? "SMOOTHER_FIGHT.HUD.FavoriteSkillSet" : "SMOOTHER_FIGHT.HUD.FavoriteSkillCleared", {
        skill: displayLabel(skill.label, skill.id),
    }));
    services.scheduleRender(0);
}

export async function toggleFavoriteTickAction(context, actionId) {
    const action = COMBAT_TICK_ACTIONS.find((candidate) => candidate.id === actionId);
    if (!action) return;
    const result = toggleFavoriteTickActionId(
        context.actor.getFlag?.(MODULE_ID, "favoriteTickActionIds"),
        actionId,
        COMBAT_TICK_ACTIONS.map((candidate) => candidate.id)
    );
    if (!result.changed) return;
    await context.actor.setFlag(MODULE_ID, "favoriteTickActionIds", result.ids);
    ui.notifications.info(t(result.added
        ? "SMOOTHER_FIGHT.HUD.FavoriteTickActionSet"
        : "SMOOTHER_FIGHT.HUD.FavoriteTickActionCleared", {
        action: t(`SMOOTHER_FIGHT.HUD.TickActions.${action.id}.Name`),
    }));
    services.scheduleRender(0);
}

export async function performSpell(context, spellId) {
    context = liveRuntimeActionContext(context);
    if (!context) return;
    const spell = context.actor.spells?.find((candidate) => candidate.id === spellId);
    if (!spell) return;
    const prepared = context.actor.getFlag("splittermond", "preparedSpell") === spellId;
    const targetDependent = isTargetDependentDifficulty(spell.difficulty ?? spell.system?.difficulty);
    if (actionRequiresTarget(prepared, targetDependent) && !context.target) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.SelectTargetFirst"));
        return;
    }
    if (prepared && context.target) warnIfSpellOutOfRange(context, spell);
    if (prepared) {
        const preparedRoll = prepareSpellTargetRollOptions(spell, context.target);
        const pendingNonce = setPendingOffenseKind(context.actor.id, "spell", context);
        try {
            const success = await services.withTemporarySystemTargets(
                [context.target],
                () => context.actor.rollSpell(
                    spellId,
                    markTargetModifiersPrepared(preparedRoll.rollOptions)
                )
            );
            if (success) {
                await completeContinuousAction(context, { trigger: "spell" }).catch(() => false);
                await clearPreparationApplication(context.actor, "spell");
            }
        } finally {
            preparedRoll.cleanup();
            clearPendingOffenseKind(context.actor.id, pendingNonce);
        }
    } else {
        combatActionState.preparingSpellId = spellId;
        services.scheduleRender(0);
        try {
            const ticks = typeof spell.castDuration?.inTicks === "function"
                ? await spell.castDuration.inTicks()
                : numericValue(spell.castDuration);
            await prepareCombatAction(context, {
                kind: "spell",
                itemId: spellId,
                ticks,
                label: `${localizeSystem("splittermond.castDuration", "Zauberdauer")}: ${spell.name}`,
            });
        } finally {
            combatActionState.preparingSpellId = null;
        }
    }
    services.scheduleRender();
}

export async function cancelPreparedSpell(context) {
    await clearPreparationApplication(context.actor, "spell");
    await completeContinuousAction(context, { actionIds: ["focusMagic"] }).catch(() => false);
    combatActionState.preparingSpellId = null;
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.SpellCancelled"));
    services.scheduleRender(0);
}

export function isPreparingSpell(spellId) {
    return combatActionState.preparingSpellId === spellId;
}

export function getPendingOffenseKind(actorId) {
    return combatActionState.pendingOffenseKinds.get(actorId);
}

export function claimPendingOffenseKind(actorId) {
    const pendingKind = combatActionState.pendingOffenseKinds.get(actorId);
    if (!pendingKind) return null;
    combatActionState.pendingOffenseKinds.delete(actorId);
    return pendingKind;
}

function clearPendingOffenseKind(actorId, nonce = undefined) {
    const pendingKind = combatActionState.pendingOffenseKinds.get(actorId);
    if (!pendingKind || (nonce !== undefined && pendingKind.nonce !== nonce)) return false;
    return combatActionState.pendingOffenseKinds.delete(actorId);
}

function setPendingOffenseKind(actorId, kind, context) {
    const nonce = Symbol("pendingOffense");
    combatActionState.pendingOffenseKinds.set(actorId, {
        kind,
        nonce,
        expiresAt: Date.now() + 60_000,
        ...snapshotTargetContext(context),
    });
    return nonce;
}

function snapshotTargetContext(context) {
    const targets = Array.from(context.targets ?? []);
    const primaryTarget = context.target ?? null;
    const primaryTargetTokenUuid = primaryTarget?.uuid ?? null;
    const primaryTargetActorUuid = primaryTarget?.actor?.uuid ?? null;
    const primaryTargetName = primaryTarget?.name ?? primaryTarget?.actor?.name ?? null;
    return {
        primaryTargetTokenUuid,
        primaryTargetActorUuid,
        primaryTargetName,
        targetTokenUuid: primaryTargetTokenUuid,
        targetActorUuid: primaryTargetActorUuid,
        targetName: primaryTargetName,
        targetTokenUuids: targets.map((target) => target.uuid).filter(Boolean),
        targetActorUuids: targets.map((target) => target.actor?.uuid).filter(Boolean),
        targetNames: targets.map((target) => target.name ?? target.actor?.name).filter(Boolean),
    };
}

function liveRuntimeActionContext(context) {
    const runtimeController = services.getRuntimeController(context.combatant ?? context.actor);
    if (!runtimeController) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.RuntimeControllerUnavailable"));
        return null;
    }
    return {
        ...context,
        runtimeController,
        ...services.getTargetSelectionForUser(runtimeController),
    };
}

export async function addCombatTicks(context, requestedTicks) {
    if (!requireOpenCombatFlowForTicks(context)) return null;
    if (Number(context.combatant.initiative) >= COMBAT_PAUSE.wait) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.ResumeFirst"));
        return null;
    }
    let advancedTicks;
    if (requestedTicks === "custom") {
        const previousInitiative = Math.round(Number(context.combatant.initiative) || 0);
        await context.actor.addTicks(3, t("SMOOTHER_FIGHT.HUD.CustomTicksPrompt", { name: context.actor.name }), true);
        const currentInitiative = Math.round(Number(context.combatant.initiative) || 0);
        advancedTicks = currentInitiative > previousInitiative ? currentInitiative - previousInitiative : null;
    } else {
        const ticks = Math.max(1, Number.parseInt(requestedTicks, 10) || 0);
        await context.combat.setInitiative(context.combatant.id, Math.round(Number(context.combatant.initiative) || 0) + ticks);
        advancedTicks = ticks;
    }
    services.scheduleRender(0);
    return advancedTicks;
}

export async function pauseCombatant(context, pauseType) {
    const value = COMBAT_PAUSE[pauseType];
    if (!value) return;
    await context.combat.setInitiative(context.combatant.id, value);
    services.scheduleRender(0);
}

export async function resumeCombatant(context) {
    const wasReady = Number(context.combatant.initiative) === COMBAT_PAUSE.keepReady;
    const tick = Number.parseInt(context.combat.round, 10) || Number.parseInt(context.combat.currentTick, 10) || 0;
    await context.combat.setInitiative(context.combatant.id, tick, wasReady);
    services.scheduleRender(0);
}

export async function revertTokenMovement(context) {
    return revertTokenMovementApplication(context);
}

export function focusCombatantToken(context) {
    return showTokenOnCanvas(context.token);
}

export function showTokenOnCanvas(token) {
    const sceneId = token?.parent?.id ?? token?.scene?.id;
    if (!canvas?.ready || (sceneId && sceneId !== canvas.scene?.id)) return;

    const object = token?.object ?? canvas?.tokens?.get(token?.id);
    if (!object?.visible || !object?.center) {
        ui.notifications.warn("COMBATANT.WarnNonVisibleToken", { localize: true });
        return;
    }

    const { x, y } = object.center;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const viewportCenter = viewportHeight / 2;
    const desiredScreenY = canvasFocusScreenY(viewportHeight);
    const currentScale = Math.max(Number(canvas.stage?.scale?.x) || 1, 0.1);
    const defaultScale = Math.max(Number(canvas.dimensions?.scale?.default) || 1, 0.1);
    const targetScale = Math.max(currentScale, defaultScale);
    const yOffset = (viewportCenter - desiredScreenY) / targetScale;
    const animation = canvas.animatePan({
        x,
        y: y + yOffset,
        scale: targetScale,
    });
    canvas.ping?.(object.center);
    return animation;
}

function canvasFocusScreenY(viewportHeight) {
    const tickBarRects = visibleElementRects("#tick-bar-hud, .tick-bar-hud", viewportHeight);
    const tickBarBottom = tickBarRects.length
        ? Math.max(...tickBarRects.map((bounds) => bounds.bottom))
        : null;
    const hudTop = visibleElementRects(`#${MODULE_ID}-hud:not(.is-hidden)`, viewportHeight)[0]?.top ?? null;
    return visibleCanvasCenterY(viewportHeight, tickBarBottom, hudTop);
}

function visibleElementRects(selector, viewportHeight) {
    return Array.from(document.querySelectorAll(selector)).flatMap((element) => {
        const style = window.getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        const visible = style.display !== "none"
            && style.visibility !== "hidden"
            && Number.parseFloat(style.opacity || "1") > 0
            && bounds.width > 0
            && bounds.height > 0
            && bounds.bottom > 0
            && bounds.top < viewportHeight;
        return visible ? [bounds] : [];
    });
}

export async function toggleCombatantVisibility(context) {
    const hidden = Boolean(context.combatant.hidden || context.token?.hidden);
    const nextHidden = !hidden;
    const updates = [context.combatant.update({ hidden: nextHidden })];
    if (context.token?.update) updates.push(context.token.update({ hidden: nextHidden }));
    await Promise.all(updates);
    services.scheduleRender(0);
}

export async function toggleTokenHidden(context) {
    if (!context.token?.update) return;
    await context.token.update({ hidden: !context.token.hidden });
    services.scheduleRender(0);
}

export async function toggleCombatantHidden(context) {
    await context.combatant.update({ hidden: !context.combatant.hidden });
    services.scheduleRender(0);
}

export async function requireGm(callback) {
    if (!game.user.isGM) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.GmOnly"));
        return;
    }
    return callback();
}

export async function removeCombatant(context) {
    const confirmed = await confirmAction(
        t("SMOOTHER_FIGHT.HUD.RemoveCombatant"),
        t("SMOOTHER_FIGHT.HUD.RemoveCombatantConfirm", { name: context.combatant.name })
    );
    if (confirmed) await context.combatant.delete();
}

async function confirmAction(title, content) {
    const DialogV2 = foundry?.applications?.api?.DialogV2;
    if (DialogV2?.confirm) return DialogV2.confirm({ window: { title }, content: `<p>${escapeHtml(content)}</p>` });
    if (globalThis.Dialog?.confirm) return Dialog.confirm({ title, content: `<p>${escapeHtml(content)}</p>` });
    return false;
}

export async function toggleEquipped(actor, itemId) {
    const item = actor.items?.get?.(itemId) ?? Array.from(actor.items ?? []).find((candidate) => candidate.id === itemId);
    if (!item || !("equipped" in (item.system ?? {}))) return;
    await item.update({ "system.equipped": !item.system.equipped });
}

export async function requireOwner(context, callback) {
    const runtimeController = services.getRuntimeController(context.combatant ?? context.actor);
    if (!runtimeController) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.RuntimeControllerUnavailable"));
        return;
    }
    if (!(game.user.isGM || (runtimeController.id === game.user.id && context.actor.isOwner))) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.NoOwner"));
        return;
    }
    return callback();
}

export async function getAttackSpeed(attack) {
    try {
        if (typeof attack?.weaponSpeedAsync === "function") {
            return numericValue(await attack.weaponSpeedAsync());
        }
    } catch (error) {
        console.debug(`${MODULE_ID} | Could not calculate weapon speed for ${attack?.name ?? attack?.id}`, error);
    }
    return numericValue(attack?.weaponSpeed);
}

export function isRangedAttackMessage(message) {
    const report = message?.system?.checkReport;
    return isRangedAttack(report?.itemData ?? report?.attack ?? message?.system?.itemData);
}

export { isRangedAttack };
