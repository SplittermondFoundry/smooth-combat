import { MODULE_ID } from "../core/constants.js";

export const COMBAT_POSITION_IDS = Object.freeze([
    "standing",
    "kneeling",
    "prone",
    "flying",
]);

const POSITION_ALIASES = Object.freeze({
    kneeling: Object.freeze(["kniend", "knieend", "kneeling"]),
    prone: Object.freeze(["liegend", "prone"]),
    flying: Object.freeze(["fliegend", "flying"]),
});

const POSITION_BY_ALIAS = new Map(
    Object.entries(POSITION_ALIASES).flatMap(([position, aliases]) =>
        aliases.map((alias) => [normalizeName(alias), position])
    )
);

export function resolveCombatPosition(actor) {
    const markers = actorItems(actor)
        .map((item) => ({ item, position: combatPositionFromItem(item) }))
        .filter(({ item, position }) => position && Number(item.system?.level ?? 0) > 0);
    const positions = [...new Set(markers.map(({ position }) => position))];

    if (positions.length === 0) {
        return { id: "standing", ambiguous: false, markers: [], positions: [] };
    }
    if (positions.length === 1) {
        return {
            id: positions[0],
            ambiguous: false,
            markers: markers.map(({ item }) => item),
            positions,
        };
    }
    return {
        id: null,
        ambiguous: true,
        markers: markers.map(({ item }) => item),
        positions,
    };
}

export function combatPositionFromItem(item) {
    if (String(item?.type ?? "").toLocaleLowerCase() !== "statuseffect") return null;
    const flaggedPosition = normalizePosition(readPositionFlag(item));
    if (POSITION_ALIASES[flaggedPosition]) return flaggedPosition;
    return POSITION_BY_ALIAS.get(normalizeName(item?.name)) ?? null;
}

function readPositionFlag(item) {
    return item?.getFlag?.(MODULE_ID, "combatPosition")
        ?? item?.flags?.[MODULE_ID]?.combatPosition
        ?? null;
}

function normalizePosition(value) {
    return String(value ?? "").trim().toLocaleLowerCase();
}

function normalizeName(value) {
    return String(value ?? "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/gu, "")
        .trim()
        .toLocaleLowerCase();
}

function actorItems(actor) {
    if (Array.isArray(actor?.items?.contents)) return actor.items.contents;
    return Array.from(actor?.items ?? []);
}
