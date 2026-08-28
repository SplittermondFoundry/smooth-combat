import { services } from "../../core/services.js";

import {
    attackControlState,
    COMBAT_TICK_ACTIONS,
} from "../../combat-rules.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    displayLabel,
    displayValue,
    escapeAttr,
    escapeHtml,
    numericValue,
    t,
} from "../../shared/values.js";

import {
    setAttackPreparation,
} from "./attack-preparation.js";

import {
    performTrackedMovementAction,
} from "./movement.js";

const SELECTABLE_DURATION_ACTIONS = new Set(["aim", "searchOpening"]);
const SHIELD_BASH_MANEUVERS = Object.freeze([]);
const WRONG_HAND_TICK_PENALTY = 2;
const STRONG_SHIELD_ARM_KEYS = new Set(["starkerschildarmi", "starkerschildarm1", "strongshieldarmi"]);
const TWO_WEAPON_FIGHTING_KEYS = new Set(["kampfmitzweiwaffen", "twoweaponfighting"]);

export async function performTickAction(context, actionId, requestedTicks = "custom") {
    const action = COMBAT_TICK_ACTIONS.find((candidate) => candidate.id === actionId);
    if (!action || action.actionable === false) return false;
    context = liveTickActionContext(context);
    if (!context) return false;

    if (SELECTABLE_DURATION_ACTIONS.has(action.id)) return performTimedPreparation(context, action);
    switch (action.id) {
        case "walk":
        case "sprint": {
            const tracked = await performTrackedMovementAction(context, action);
            return tracked === null ? performReferenceAction(context, action, requestedTicks) : tracked;
        }
        case "disengage":
            return performDisengage(context, action);
        case "shieldBash":
            return performShieldBash(context, action);
        case "evasiveLeap":
            return performEvasiveLeap(context, action);
        case "escapeGrapple":
            return performEscapeGrapple(context, action);
        case "coordinate":
            return performCoordinate(context, action);
        default:
            return performReferenceAction(context, action, requestedTicks);
    }
}

function liveTickActionContext(context) {
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

async function performTimedPreparation(context, action) {
    const preparedAttack = action.id === "aim" ? preparedRangedAttack(context.actor) : null;
    if (action.id === "aim" && !preparedAttack) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.AimRequiresPreparedAttack"));
        return false;
    }
    if (action.id === "aim" && !requireTarget(context)) return false;
    const choice = await chooseTickActionDuration({
        id: `${MODULE_ID}-${action.id}-duration`,
        title: actionName(action),
        label: t("SMOOTHER_FIGHT.HUD.TickActionChooseDuration"),
        options: action.ticks.map((ticks) => ({
            value: String(ticks),
            label: t("SMOOTHER_FIGHT.HUD.TickActionDuration", { ticks }),
        })),
    });
    if (!choice) return false;
    const ticks = Number(choice.value);
    const bonus = Math.floor(ticks / 2);
    const actualTicks = await services.addCombatTicks(context, ticks);
    if (actualTicks === null) return false;
    await setAttackPreparation(context, action.id, actualTicks, { attack: preparedAttack });
    return Boolean(await services.createTickActionChatCard(context, action.id, actualTicks, {
        bonus,
        description: t(`SMOOTHER_FIGHT.HUD.TickActions.${action.id}.ChatDescription`, {
            ticks: actualTicks,
            target: targetName(context),
        }),
        special: t(`SMOOTHER_FIGHT.HUD.TickActions.${action.id}.ChatSpecial`, { bonus }),
        targetActorUuid: action.id === "aim" ? context.target?.actor?.uuid ?? null : null,
        targetName: action.id === "aim" ? targetName(context) : null,
        targetTokenUuid: action.id === "aim" ? context.target?.uuid ?? null : null,
    }));
}

function preparedRangedAttack(actor) {
    const preparedAttackId = actor?.getFlag?.("splittermond", "preparedAttack")
        ?? actor?.flags?.splittermond?.preparedAttack;
    return Array.from(actor?.attacks ?? []).find((attack) => (
        attack?.id === preparedAttackId
        && (services.isRangedAttack?.(attack) ?? Boolean(attack?.isRanged))
    )) ?? null;
}

async function performDisengage(context, action) {
    if (!requireTarget(context)) return false;
    const choices = disengageSkillChoices(context.actor);
    const choice = choices.length > 1
        ? await chooseTickActionOption({
            id: `${MODULE_ID}-disengage-skill`,
            title: actionName(action),
            label: t("SMOOTHER_FIGHT.HUD.TickActionChooseSkill"),
            options: choices,
        })
        : choices[0];
    if (!choice) return false;
    const rollMessage = await rollSkill(context, choice.value, {
        difficulty: "GW",
        title: actionName(action),
        subtitle: t("SMOOTHER_FIGHT.HUD.TickActionAgainstTarget", { target: targetName(context) }),
    }, context.target, choice.roll);
    if (!rollMessage) return false;
    return createCardThenAdvance(context, action.id, action.ticks, {
        special: t("SMOOTHER_FIGHT.HUD.TickActionDisengageChat", {
            skill: choice.label,
            target: targetName(context),
        }),
    });
}

async function performShieldBash(context, action) {
    if (!requireTarget(context)) return false;
    const shieldAttacks = Array.from(context.actor.attacks ?? []).filter((attack) => (
        attack?.item?.type === "shield" && attack.item.system?.equipped !== false
    ));
    if (!shieldAttacks.length) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.TickActionShieldRequired"));
        return false;
    }
    const options = shieldAttacks.map((attack) => ({ value: attack.id, label: attack.name }));
    const choice = options.length > 1
        ? await chooseTickActionOption({
            id: `${MODULE_ID}-shield-bash-shield`,
            title: actionName(action),
            label: t("SMOOTHER_FIGHT.HUD.TickActionChooseShield"),
            options,
        })
        : options[0];
    if (!choice) return false;
    const attack = shieldAttacks.find((candidate) => candidate.id === choice.value);
    return services.performAttack(
        context,
        attack.id,
        { title: actionName(action) },
        (systemAttack, rollOptions) => rollShieldBashAttack(context.actor, systemAttack, rollOptions),
    );
}

async function rollShieldBashAttack(actor, attack, rollOptions) {
    // Skill is a system DataModel in current Splittermond releases. Its methods use
    // private state and therefore must keep the original instance as their receiver.
    const restoreManeuvers = temporarilyOverrideOwnValue(
        attack.skill,
        "maneuvers",
        SHIELD_BASH_MANEUVERS,
    );
    try {
        return await createShieldBashAttackView(actor, attack).roll(rollOptions);
    } finally {
        restoreManeuvers();
    }
}

function createShieldBashAttackView(actor, attack) {
    const wrongHandPenalty = shieldBashWrongHandPenalty(actor, attack.skill?.id);
    const derivedAttack = Object.create(attack);
    Object.defineProperties(derivedAttack, {
        weaponSpeed: {
            configurable: false,
            enumerable: true,
            value: shieldBashWeaponSpeedView(attack, wrongHandPenalty),
            writable: false,
        },
        weaponSpeedAsync: {
            configurable: false,
            enumerable: false,
            value: () => calculateShieldBashWeaponSpeed(attack, wrongHandPenalty),
            writable: false,
        },
    });
    return derivedAttack;
}

function shieldBashWeaponSpeedView(attack, penalty) {
    const systemSpeed = attack.weaponSpeed;
    const displayedSpeed = numericValue(systemSpeed) + penalty;
    if (typeof systemSpeed !== "object" || systemSpeed === null) return displayedSpeed;
    return Object.freeze({
        calculationValue: displayedSpeed,
        calculate: () => calculateShieldBashWeaponSpeed(attack, penalty),
        calculateSync: () => calculateShieldBashWeaponSpeedSync(systemSpeed, penalty),
        display: displayedSpeed,
        value: displayedSpeed,
    });
}

async function calculateShieldBashWeaponSpeed(attack, penalty) {
    const systemSpeed = typeof attack.weaponSpeedAsync === "function"
        ? await attack.weaponSpeedAsync()
        : typeof attack.weaponSpeed?.calculate === "function"
            ? await attack.weaponSpeed.calculate()
            : attack.weaponSpeed;
    return numericValue(systemSpeed) + penalty;
}

function calculateShieldBashWeaponSpeedSync(systemSpeed, penalty) {
    if (typeof systemSpeed.calculateSync !== "function") return numericValue(systemSpeed) + penalty;
    try {
        return numericValue(systemSpeed.calculateSync()) + penalty;
    } catch {
        return numericValue(systemSpeed) + penalty;
    }
}

function temporarilyOverrideOwnValue(object, key, value) {
    const ownDescriptor = Object.getOwnPropertyDescriptor(object, key);
    Object.defineProperty(object, key, {
        configurable: true,
        enumerable: ownDescriptor?.enumerable ?? false,
        value,
        writable: false,
    });
    return () => {
        if (ownDescriptor) Object.defineProperty(object, key, ownDescriptor);
        else delete object[key];
    };
}

function shieldBashWrongHandPenalty(actor, skillId) {
    const normalizedSkillId = String(skillId ?? "").trim().toLocaleLowerCase("de-DE");
    const avoidsPenalty = Array.from(actor.items ?? []).some((item) => {
        if (item?.type !== "mastery") return false;
        if (matchesRule(item, STRONG_SHIELD_ARM_KEYS)) return true;
        if (!matchesRule(item, TWO_WEAPON_FIGHTING_KEYS)) return false;
        const rawSkill = item.system?.skill;
        const masterySkillId = typeof rawSkill === "string" ? rawSkill : rawSkill?.id;
        return String(masterySkillId ?? "").trim().toLocaleLowerCase("de-DE") === normalizedSkillId;
    });
    return avoidsPenalty ? 0 : WRONG_HAND_TICK_PENALTY;
}

function matchesRule(item, keys) {
    return [item.system?.id, item.name].some((value) => keys.has(ruleKey(value)));
}

function ruleKey(value) {
    return String(value ?? "")
        .normalize("NFKD")
        .replace(/\p{Mark}/gu, "")
        .replace(/\s*\([^)]*\)\s*$/u, "")
        .toLocaleLowerCase("de-DE")
        .replace(/ß/gu, "ss")
        .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

async function performEvasiveLeap(context, action) {
    const skill = actorSkill(context.actor, "acrobatics");
    if (!skill) return false;
    const rollMessage = await rollSkill(context, skill.id, {
        difficulty: 15,
        title: actionName(action),
    });
    if (!rollMessage) return false;
    const outcome = skillCheckOutcome(rollMessage);
    const special = outcome.succeeded
        ? t("SMOOTHER_FIGHT.HUD.TickActionEvasiveLeapSuccess", { reduction: outcome.reduction })
        : t("SMOOTHER_FIGHT.HUD.TickActionEvasiveLeapFailure");
    return createCardThenAdvance(context, action.id, action.ticks, { special });
}

async function performEscapeGrapple(context, action) {
    const options = ["acrobatics", "athletics"].flatMap((skillId) => {
        const skill = actorSkill(context.actor, skillId);
        return skill ? [{
            value: skill.id,
            label: skillLabel(context.actor, skill.id),
            skillValue: displayValue(skill.value, "–"),
        }] : [];
    });
    const choice = await chooseEscapeGrappleSkill({
        id: `${MODULE_ID}-escape-grapple-skill`,
        title: actionName(action),
        options,
    });
    if (!choice) return false;
    const rollMessage = await rollSkill(context, choice.value, {
        difficulty: choice.difficulty,
        title: actionName(action),
        subtitle: t("SMOOTHER_FIGHT.HUD.TickActionComparativeCheck"),
    });
    if (!rollMessage) return false;
    return createCardThenAdvance(context, action.id, action.ticks, {
        special: t("SMOOTHER_FIGHT.HUD.TickActionEscapeGrappleChat", {
            difficulty: choice.difficulty,
            skill: choice.label,
        }),
    });
}

async function performCoordinate(context, action) {
    const skill = actorSkill(context.actor, "leadership");
    if (!skill) return false;
    const rollMessage = await rollSkill(context, skill.id, {
        difficulty: 21,
        preSelectedModifier: [actionName(action)],
        title: actionName(action),
    });
    if (!rollMessage) return false;
    return createCardThenAdvance(context, action.id, action.ticks);
}

async function performReferenceAction(context, action, requestedTicks) {
    const shouldAdvance = requestedTicks !== "0" && requestedTicks !== "none";
    const actualTicks = shouldAdvance
        ? await services.addCombatTicks(context, requestedTicks)
        : "custom";
    if (shouldAdvance && actualTicks === null) return false;
    return Boolean(await services.createTickActionChatCard(context, action.id, actualTicks));
}

async function createCardThenAdvance(context, actionId, ticks, options) {
    const card = await services.createTickActionChatCard(context, actionId, ticks, options);
    if (!card) return false;
    return await services.addCombatTicks(context, ticks) !== null;
}

async function rollSkill(context, skillId, options, target = null, roll = null) {
    const operation = typeof roll === "function"
        ? () => roll(options)
        : () => context.actor.rollSkill(skillId, options);
    const message = await (target
        ? services.withTemporarySystemTargets([target], operation)
        : operation());
    if (message) await services.waitForDiceSoNice(message);
    return message;
}

function requireTarget(context) {
    if (context.target) return true;
    ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.SelectTargetFirst"));
    return false;
}

function actionName(action) {
    return t(`SMOOTHER_FIGHT.HUD.TickActions.${action.id}.Name`);
}

function targetName(context) {
    return context.target?.name ?? context.target?.actor?.name ?? "–";
}

function actorSkill(actor, skillId) {
    return actor.skills?.[skillId]
        ?? Object.values(actor.skills ?? {}).find((skill) => skill.id === skillId)
        ?? null;
}

function skillLabel(actor, skillId) {
    const skill = actorSkill(actor, skillId);
    return displayLabel(skill?.label, skill?.id ?? skillId);
}

function disengageSkillChoices(actor) {
    const acrobatics = actorSkill(actor, "acrobatics");
    const choices = acrobatics
        ? [{
            value: acrobatics.id,
            label: skillLabel(actor, acrobatics.id),
            roll: (options) => actor.rollSkill(acrobatics.id, options),
        }]
        : [];
    const fightingSkills = new Set(globalThis.CONFIG?.splittermond?.skillGroups?.fighting ?? [
        "melee", "slashing", "chains", "blades", "staffs",
    ]);
    const masterySkills = Array.from(actor.items ?? []).flatMap((item) => {
        const id = String(item.system?.id ?? "").toLocaleLowerCase("de-DE");
        const name = String(item.name ?? "").normalize("NFKC");
        const rawSkill = item.system?.skill;
        const skillId = typeof rawSkill === "string" ? rawSkill : rawSkill?.id;
        const matches = item.type === "mastery"
            && (id === "rueckzugsgefecht" || /^rückzugsgefecht(?:\s*\([^)]*\))?$/iu.test(name));
        return matches && fightingSkills.has(skillId) ? [skillId] : [];
    });
    const attacks = Array.from(actor.attacks ?? []);
    const selectedAttackId = attackControlState(
        attacks.map((attack) => attack?.id),
        actor.getFlag?.(MODULE_ID, "defaultAttackId"),
    ).directAttackId;
    const selectedAttack = attacks.find((attack) => attack?.id === selectedAttackId);
    const selectedWeaponSkill = selectedAttack?.item?.type === "weapon"
        && selectedAttack.item.system?.equipped !== false
        && typeof selectedAttack.skill?.roll === "function"
        ? selectedAttack.skill
        : null;
    if (selectedWeaponSkill && new Set(masterySkills).has(selectedWeaponSkill.id)) {
        choices.push({
            value: selectedWeaponSkill.id,
            label: displayLabel(selectedWeaponSkill.label, selectedWeaponSkill.id),
            roll: (options) => selectedWeaponSkill.roll(options),
        });
    }
    return choices;
}

function skillCheckData(message) {
    return message?.flags?.splittermond?.check
        ?? message?.getFlag?.("splittermond", "check")
        ?? message?.system?.checkReport
        ?? null;
}

function skillCheckOutcome(message) {
    const check = skillCheckData(message) ?? {};
    const degree = typeof check.degreeOfSuccess === "object"
        ? numericValue(check.degreeOfSuccess.fromRoll) + numericValue(check.degreeOfSuccess.modification)
        : numericValue(check.degreeOfSuccess);
    const succeeded = Boolean(check.succeeded);
    return {
        succeeded,
        reduction: succeeded ? 1 + Math.max(0, degree) : 0,
    };
}

async function chooseTickActionDuration({ id, title, label, options }) {
    if (!options.length) return null;
    const icons = [
        "fa-solid fa-hourglass-start",
        "fa-solid fa-hourglass-half",
        "fa-solid fa-hourglass-end",
    ];
    const result = await globalThis.foundry?.applications?.api?.DialogV2?.wait?.({
        id,
        window: { title },
        position: { width: 420 },
        content: `<p class="sf-tick-action-duration-prompt">${escapeHtml(label)}</p>`,
        buttons: options.map((option, index) => ({
            action: `ticks-${option.value}`,
            label: option.label,
            icon: icons[index] ?? "fa-solid fa-clock",
            callback: () => option.value,
            default: index === 0,
        })),
        close: () => null,
        modal: true,
    });
    return options.find((option) => option.value === result) ?? null;
}

async function chooseTickActionOption({ id, title, label, options }) {
    if (!options.length) return null;
    if (options.length === 1) return options[0];
    const result = await globalThis.foundry?.applications?.api?.DialogV2?.wait?.({
        id,
        window: { title },
        position: { width: Math.min(720, Math.max(420, 160 + (options.length * 120))) },
        content: `<p class="sf-tick-action-duration-prompt">${escapeHtml(label)}</p>`,
        buttons: [
            ...options.map((option, index) => ({
                action: `choice-${option.value}`,
                label: option.label,
                icon: "fa-solid fa-dice-d20",
                callback: () => option.value,
                default: index === 0,
            })),
            {
                action: "cancel",
                label: t("SMOOTHER_FIGHT.Settings.Cancel"),
                icon: "fa-solid fa-xmark",
                callback: () => null,
            },
        ],
        close: () => null,
        modal: true,
    });
    return options.find((option) => option.value === result) ?? null;
}

async function chooseEscapeGrappleSkill({ id, title, options }) {
    if (!options.length) return null;
    const difficultyId = `${id}-difficulty`;
    const icons = {
        acrobatics: "fa-solid fa-person-running",
        athletics: "fa-solid fa-dumbbell",
    };
    const result = await globalThis.foundry?.applications?.api?.DialogV2?.wait?.({
        id,
        window: { title },
        position: { width: 460 },
        content: `<div class="sf-tick-action-dialog">
            <div class="form-group stacked">
                <label for="${escapeAttr(difficultyId)}">${escapeHtml(t("SMOOTHER_FIGHT.HUD.TickActionOpponentSkillDifficulty"))}</label>
                <input id="${escapeAttr(difficultyId)}" name="difficulty" type="number" min="0" step="1" inputmode="numeric" autocomplete="off" required autofocus>
            </div>
        </div>`,
        buttons: options.map((option, index) => ({
            action: `skill-${option.value}`,
            label: t("SMOOTHER_FIGHT.HUD.TickActionSkillWithValue", {
                skill: option.label,
                value: option.skillValue,
            }),
            icon: icons[option.value] ?? "fa-solid fa-dice-d20",
            callback: (_event, button) => escapeGrappleSelection(button, option.value),
            default: index === 0,
        })),
        render: (_event, dialog) => installEscapeGrappleDifficultyGuard(dialog?.element),
        close: () => null,
        modal: true,
    });
    const option = options.find((candidate) => candidate.value === result?.skillId);
    return option ? { ...option, difficulty: result.difficulty } : null;
}

function escapeGrappleSelection(button, skillId) {
    const input = button?.form?.elements?.difficulty;
    const difficulty = escapeGrappleDifficulty(input);
    if (difficulty === null) return null;
    return { skillId, difficulty };
}

function installEscapeGrappleDifficultyGuard(root) {
    if (!root?.addEventListener) return;
    root.addEventListener("click", (event) => {
        const button = event.target?.closest?.('button[data-action^="skill-"]');
        if (!button || (root.contains && !root.contains(button))) return;
        const input = root.querySelector?.('[name="difficulty"]');
        if (escapeGrappleDifficulty(input) !== null) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.TickActionDifficultyRequiredWarning"));
        input?.focus?.();
        input?.reportValidity?.();
    }, { capture: true });
}

function escapeGrappleDifficulty(input) {
    const raw = String(input?.value ?? "").trim();
    const difficulty = Number(input?.valueAsNumber ?? raw);
    return raw && Number.isFinite(difficulty) && difficulty >= 0 ? difficulty : null;
}
