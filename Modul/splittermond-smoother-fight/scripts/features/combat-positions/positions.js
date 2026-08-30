import { MODULE_ID } from "../../core/constants.js";
import { t } from "../../shared/values.js";

import {
    combatPositionFromItem,
    COMBAT_POSITION_IDS,
    resolveCombatPosition,
} from "../../shared/combat-position-state.js";

export {
    combatPositionFromItem,
    COMBAT_POSITION_IDS,
    resolveCombatPosition,
} from "../../shared/combat-position-state.js";

export const COMBAT_POSITION_ICONS = Object.freeze({
    standing: null,
    kneeling: "icons/svg/leg.svg",
    prone: "icons/svg/falling.svg",
    flying: "icons/svg/wing.svg",
});

const POSITION_DEFINITIONS = Object.freeze({
    kneeling: Object.freeze({
        img: COMBAT_POSITION_ICONS.kneeling,
    }),
    prone: Object.freeze({
        img: COMBAT_POSITION_ICONS.prone,
    }),
    flying: Object.freeze({
        img: COMBAT_POSITION_ICONS.flying,
    }),
});

const POSITION_ID_SET = new Set(COMBAT_POSITION_IDS);
const CREATION_COMPATIBILITY_INTERVAL = 1;

export function getCombatPositionStatusData(requestedPosition) {
    const position = normalizePosition(requestedPosition);
    const definition = POSITION_DEFINITIONS[position];
    if (!definition) return null;
    const translationRoot = `SMOOTHER_FIGHT.StatusEffects.CombatPositions.${position}`;

    return {
        name: t(`${translationRoot}.Name`),
        type: "statuseffect",
        img: definition.img,
        system: {
            description: `<p>${t(`${translationRoot}.Description`)}</p>`,
            source: t(`${translationRoot}.Source`),
            modifier: "",
            level: 1,
            combatEvent: {
                startTick: null,
                interval: null,
                repeats: null,
                macroRef: { name: null, uuid: null },
                postDescription: true,
            },
        },
        effects: [],
        flags: {
            [MODULE_ID]: { combatPosition: position },
        },
    };
}

export async function setCombatPosition(actor, requestedPosition) {
    if (!actor) throw new Error("A combat position requires an actor.");
    const position = normalizePosition(requestedPosition);
    if (!POSITION_ID_SET.has(position)) {
        throw new Error(`Unknown combat position: ${requestedPosition}`);
    }

    const markers = actorItems(actor)
        .map((item) => ({ item, position: combatPositionFromItem(item) }))
        .filter(({ position: markerPosition }) => Boolean(markerPosition));

    if (position === "standing") {
        await deleteMarkerItems(actor, markers.map(({ item }) => item));
        return resolveCombatPosition(actor);
    }

    let keptMarker = markers.find(({ position: markerPosition, item }) =>
        markerPosition === position && Number(item.system?.level ?? 0) > 0
    )?.item ?? markers.find(({ position: markerPosition }) => markerPosition === position)?.item ?? null;
    let createdMarker = null;

    if (!keptMarker) {
        const creationData = getCombatPositionStatusData(position);
        creationData.system.combatEvent.interval = CREATION_COMPATIBILITY_INTERVAL;
        creationData.system.combatEvent.repeats = 1;
        creationData.system.combatEvent.postDescription = false;
        const created = await actor.createEmbeddedDocuments("Item", [creationData]);
        createdMarker = Array.from(created ?? [])[0] ?? null;
        keptMarker = createdMarker;
        try {
            await actor.updateEmbeddedDocuments("Item", [{
                _id: documentId(createdMarker),
                "system.combatEvent.startTick": null,
                "system.combatEvent.interval": null,
                "system.combatEvent.repeats": null,
                "system.combatEvent.postDescription": true,
            }]);
        } catch (error) {
            try {
                await deleteMarkerItems(actor, [createdMarker]);
            } catch {
                // Best effort: preserve the original normalization error.
            }
            throw error;
        }
    } else if (Number(keptMarker.system?.level ?? 0) <= 0) {
        await actor.updateEmbeddedDocuments("Item", [{ _id: documentId(keptMarker), "system.level": 1 }]);
    }

    const obsoleteMarkers = markers
        .map(({ item }) => item)
        .filter((item) => item !== keptMarker && documentId(item) !== documentId(keptMarker));

    try {
        await deleteMarkerItems(actor, obsoleteMarkers);
    } catch (error) {
        if (createdMarker) {
            try {
                await deleteMarkerItems(actor, [createdMarker]);
            } catch {
                // Best effort: preserve the original error from the position change.
            }
        }
        throw error;
    }

    return resolveCombatPosition(actor);
}

function normalizePosition(value) {
    return String(value ?? "").trim().toLocaleLowerCase();
}

function actorItems(actor) {
    if (Array.isArray(actor?.items?.contents)) return actor.items.contents;
    return Array.from(actor?.items ?? []);
}

function documentId(document) {
    return document?.id ?? document?._id ?? null;
}

async function deleteMarkerItems(actor, items) {
    const ids = [...new Set(items.map(documentId).filter(Boolean))];
    if (ids.length > 0) await actor.deleteEmbeddedDocuments("Item", ids);
}
