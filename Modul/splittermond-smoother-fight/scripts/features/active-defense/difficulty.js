import { services } from "../../core/services.js";

import {
    calculateActiveDefenseDifficulty,
    findDistractingFeatureValue,
} from "../../combat-rules.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

function offenseAttack(message) {
    try {
        const referencedAttack = message?.system?.attackReference?.get?.();
        if (referencedAttack) return referencedAttack;
    } catch (error) {
        console.debug(`${MODULE_ID} | Could not resolve the attack reference for active defense`, error);
    }

    const actor = services.resolveSpeakerActor(message);
    const report = message?.system?.checkReport;
    const checkData = message?.getFlag?.("splittermond", "check") ?? message?.flags?.splittermond?.check;
    const attackId = message?.system?.attackReference?.attack
        ?? report?.weapon?.id
        ?? report?.attack?.id
        ?? report?.itemData?.id
        ?? checkData?.weapon?.id
        ?? checkData?.attack?.id
        ?? checkData?.itemData?.id;
    if (attackId) return Array.from(actor?.attacks ?? []).find((attack) => attack.id === attackId) ?? null;

    const attackName = report?.weapon?.name
        ?? report?.attack?.name
        ?? report?.itemData?.name
        ?? checkData?.weapon?.name
        ?? checkData?.attack?.name
        ?? checkData?.itemData?.name;
    return attackName
        ? Array.from(actor?.attacks ?? []).find((attack) => attack.name === attackName) ?? null
        : null;
}

function distractingFeatureValueForOffense(message) {
    const report = message?.system?.checkReport;
    const checkData = message?.getFlag?.("splittermond", "check") ?? message?.flags?.splittermond?.check;
    const attack = offenseAttack(message);
    return findDistractingFeatureValue(
        attack?.featuresAsRef,
        attack?.features,
        attack?.featureList,
        attack?.item?.system?.features,
        report?.weapon,
        report?.attack,
        report?.itemData,
        message?.system?.weapon,
        message?.system?.attack,
        message?.system?.itemData,
        checkData?.weapon,
        checkData?.attack,
        checkData?.itemData
    );
}

export function activeDefenseDifficultyForOffense(message) {
    const baseDifficulty = Number(globalThis.CONFIG?.splittermond?.check?.activeDefenseDifficulty) || 15;
    const distractingFeatureValue = distractingFeatureValueForOffense(message);
    return {
        distractingFeatureValue,
        activeDefenseDifficulty: calculateActiveDefenseDifficulty(baseDifficulty, distractingFeatureValue),
    };
}

export function invokeActiveDefenseRoll(originalActorRoll, actor, rollArgs, difficulty) {
    const checkConfig = globalThis.CONFIG?.splittermond?.check;
    const configuredDifficulty = checkConfig?.activeDefenseDifficulty;
    let configAdjusted = false;
    try {
        if (checkConfig) {
            checkConfig.activeDefenseDifficulty = difficulty;
            configAdjusted = Number(checkConfig.activeDefenseDifficulty) === Number(difficulty);
        }
    } catch {
        configAdjusted = false;
    }

    const defense = rollArgs[1];
    const skill = defense?.skill;
    const originalSkillRoll = skill?.roll;
    try {
        if (typeof originalSkillRoll !== "function") return originalActorRoll.apply(actor, rollArgs);

        const hadOwnRoll = Object.hasOwn(skill, "roll");
        const interceptSkillRoll = function (options = {}, ...args) {
            const adjustedOptions = options && typeof options === "object"
                ? { ...options, difficulty }
                : { difficulty };
            return originalSkillRoll.call(this, adjustedOptions, ...args);
        };
        try {
            skill.roll = interceptSkillRoll;
            if (skill.roll !== interceptSkillRoll) return originalActorRoll.apply(actor, rollArgs);
        } catch {
            return originalActorRoll.apply(actor, rollArgs);
        }

        try {
            return originalActorRoll.apply(actor, rollArgs);
        } finally {
            if (skill.roll === interceptSkillRoll) {
                if (hadOwnRoll) skill.roll = originalSkillRoll;
                else delete skill.roll;
            }
        }
    } finally {
        if (configAdjusted) {
            try {
                checkConfig.activeDefenseDifficulty = configuredDifficulty;
            } catch {
                // The skill interceptor remains the primary compatibility path.
            }
        }
    }
}

export function launchDirectActiveDefense(actor, type, pending) {
    const originalActorRoll = actor?.rollActiveDefense;
    if (typeof originalActorRoll !== "function" || pending.distractingFeatureValue <= 0) {
        return actor.activeDefenseDialog(type || undefined);
    }

    const interceptActorRoll = function (...rollArgs) {
        return invokeActiveDefenseRoll(originalActorRoll, this, rollArgs, pending.activeDefenseDifficulty);
    };
    const hadOwnRoll = Object.hasOwn(actor, "rollActiveDefense");
    try {
        actor.rollActiveDefense = interceptActorRoll;
        if (actor.rollActiveDefense !== interceptActorRoll) return actor.activeDefenseDialog(type || undefined);
    } catch {
        return actor.activeDefenseDialog(type || undefined);
    }

    try {
        return actor.activeDefenseDialog(type || undefined);
    } finally {
        if (actor.rollActiveDefense === interceptActorRoll) {
            if (hadOwnRoll) actor.rollActiveDefense = originalActorRoll;
            else delete actor.rollActiveDefense;
        }
    }
}
