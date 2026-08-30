import { MODULE_ID } from "../../core/constants.js";

import {
    prepareAttackRollOptions,
} from "./attack-preparation.js";

import {
    combatPositionAttackModifiers,
} from "./combat-position-modifier.js";

import {
    prepareSpellTargetRollOptions,
} from "./spell-target-modifier.js";

import { isRangedAttack } from "./attack-type.js";

const PATCH_MARKER = Symbol.for(`${MODULE_ID}.systemRollModifierInterceptor`);
const TARGET_MODIFIERS_PREPARED = `${MODULE_ID}.targetModifiersPrepared`;

export function installSystemRollModifierInterceptor() {
    const prototype = globalThis.CONFIG?.Actor?.documentClass?.prototype;
    if (!prototype) return false;
    const attackInstalled = installMethodInterceptor(prototype, "rollAttack", prepareAttackModifiers);
    const spellInstalled = installMethodInterceptor(prototype, "rollSpell", prepareSpellModifiers);
    return attackInstalled || spellInstalled;
}

export function markTargetModifiersPrepared(rollOptions = {}) {
    const markedOptions = { ...(rollOptions ?? {}) };
    Object.defineProperty(markedOptions, TARGET_MODIFIERS_PREPARED, {
        configurable: true,
        value: true,
    });
    return markedOptions;
}

function installMethodInterceptor(prototype, methodName, prepareModifiers) {
    const original = prototype?.[methodName];
    if (typeof original !== "function") return false;
    if (original[PATCH_MARKER] === methodName) return true;

    const intercepted = async function smootherFightSystemRollModifierInterceptor(...args) {
        const [itemId, rawOptions, ...remainingArgs] = args;
        const { alreadyPrepared, rollOptions } = consumePreparedMarker(rawOptions);
        if (alreadyPrepared) return original.call(this, itemId, rollOptions, ...remainingArgs);

        let preparedRoll;
        try {
            preparedRoll = prepareModifiers(this, itemId, rollOptions);
        } catch (error) {
            console.error(`${MODULE_ID} | Could not prepare modifiers for ${methodName}`, error);
            return original.call(this, itemId, rollOptions, ...remainingArgs);
        }

        try {
            return await original.call(this, itemId, preparedRoll.rollOptions, ...remainingArgs);
        } finally {
            preparedRoll.cleanup();
        }
    };
    Object.defineProperty(intercepted, PATCH_MARKER, { value: methodName });
    try {
        prototype[methodName] = intercepted;
    } catch (_error) {
        return false;
    }
    return prototype[methodName] === intercepted;
}

function prepareAttackModifiers(actor, attackId, rollOptions) {
    const attack = actor?.attacks?.find?.((candidate) => candidate.id === attackId);
    if (!attack) return emptyPreparedRoll(rollOptions);
    const isRanged = isRangedAttack(attack);
    const positionModifiers = combatPositionAttackModifiers({
        attacker: actor,
        target: currentSystemTarget(),
        attack,
        isRanged,
    });
    return prepareAttackRollOptions(attack, rollOptions, null, {
        additionalModifiers: positionModifiers,
        includeAttackDefault: true,
    });
}

function prepareSpellModifiers(actor, spellId, rollOptions) {
    const spell = actor?.spells?.find?.((candidate) => candidate.id === spellId);
    if (!spell) return emptyPreparedRoll(rollOptions);
    return prepareSpellTargetRollOptions(spell, currentSystemTarget(), rollOptions);
}

function currentSystemTarget() {
    const target = Array.from(globalThis.game?.user?.targets ?? [])[0] ?? null;
    return target?.document ?? target;
}

function consumePreparedMarker(rawOptions) {
    const alreadyPrepared = rawOptions?.[TARGET_MODIFIERS_PREPARED] === true;
    const rollOptions = rawOptions && typeof rawOptions === "object"
        ? { ...rawOptions }
        : {};
    delete rollOptions[TARGET_MODIFIERS_PREPARED];
    return { alreadyPrepared, rollOptions };
}

function emptyPreparedRoll(rollOptions) {
    return {
        cleanup: () => {},
        rollOptions,
    };
}
