import { numericValue } from "../../shared/values.js";

const MAX_DAMAGE_LEVEL = 3;
const MAX_FUMBLE_DAMAGE_LEVEL = 2;

export async function increaseFumbleWeaponDamage(item) {
    const previousLevel = getWeaponDamageLevel(item);
    const nextLevel = Math.min(MAX_FUMBLE_DAMAGE_LEVEL, previousLevel + 1);
    if (nextLevel === previousLevel) return { previousLevel, nextLevel };
    await setWeaponDamageLevel(item, nextLevel);
    return { previousLevel, nextLevel };
}

export async function setWeaponDamageLevel(item, requestedLevel) {
    if (!item || typeof item.update !== "function") throw new Error("Weapon cannot be updated");
    const durability = getWeaponDurability(item);
    if (durability < 1) throw new Error(`Weapon has no usable durability: ${item.name ?? item.id ?? "unknown"}`);
    const level = clampInteger(requestedLevel, 0, MAX_DAMAGE_LEVEL);
    await item.update({ "system.sufferedDamage": sufferedDamageForLevel(durability, level) });
    return level;
}

export function getWeaponDamageLevel(item) {
    const durability = getWeaponDurability(item);
    const sufferedDamage = Math.max(0, numericValue(item?.system?.sufferedDamage));
    if (durability < 1) return sufferedDamage > 0 ? MAX_DAMAGE_LEVEL : 0;
    if (sufferedDamage >= 3 * durability) return MAX_DAMAGE_LEVEL;
    return clampInteger(Math.floor((sufferedDamage - 1) / durability), 0, MAX_DAMAGE_LEVEL);
}

export function getWeaponDamageSnapshot(item) {
    return [
        Math.max(0, numericValue(item?.system?.sufferedDamage)),
        getWeaponDamageLevel(item),
    ];
}

function getWeaponDurability(item) {
    const prepared = Math.max(0, numericValue(item?.system?.durability));
    if (prepared > 0) return prepared;
    return Math.max(0, numericValue(item?.system?.weight))
        + Math.max(0, numericValue(item?.system?.hardness));
}

function sufferedDamageForLevel(durability, level) {
    if (level === 0) return 0;
    if (level === MAX_DAMAGE_LEVEL) return 3 * durability;
    return level * durability + 1;
}

function clampInteger(value, minimum, maximum) {
    const number = Number(value);
    const integer = Number.isFinite(number) ? Math.floor(number) : minimum;
    return Math.max(minimum, Math.min(maximum, integer));
}
