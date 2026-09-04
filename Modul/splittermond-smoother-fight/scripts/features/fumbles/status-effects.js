import { MODULE_ID } from "../../core/constants.js";
import { cloneData, numericValue } from "../../shared/values.js";
import { statusEffectTimingData } from "../../shared/status-effect-compatibility.js";
import { getBundledFumbleStatusEffectData } from "./status-effect-templates.js";

const STATUS_EFFECT_ITEM_TYPE = "statuseffect";
const STATUS_EFFECT_PACK = "splittermond.statuseffects";

export async function applyFumbleConditions(actor, conditions) {
    for (const condition of conditions) {
        const existing = collectionValues(actor.items).find((item) =>
            isStatusEffect(item) && sameName(item.name, condition.name)
        );
        if (existing) {
            const current = Math.max(0, numericValue(existing.system?.level));
            await existing.update({ "system.level": current + conditionLevel(condition) });
            continue;
        }
        const source = await resolveFumbleStatusEffectCreateData(condition);
        await actor.createEmbeddedDocuments("Item", [source]);
    }
}

export async function resolveFumbleStatusEffectCreateData(condition) {
    const template = findWorldStatusEffectTemplate(condition.name)
        ?? await findUuidStatusEffectTemplate(condition)
        ?? await findCompendiumStatusEffectTemplate(condition.name)
        ?? getBundledFumbleStatusEffectData(condition.name)
        ?? genericStatusEffectData(condition.name);
    return normalizeEmbeddedStatusEffectData(template, condition);
}

function findWorldStatusEffectTemplate(name) {
    return collectionValues(globalThis.game?.items).find((item) =>
        isStatusEffect(item) && sameName(item.name, name)
    ) ?? null;
}

async function findUuidStatusEffectTemplate(condition) {
    if (!condition.uuid || typeof globalThis.fromUuid !== "function") return null;
    try {
        const item = await globalThis.fromUuid(condition.uuid);
        return isStatusEffect(item) ? item : null;
    } catch (error) {
        console.debug(`${MODULE_ID} | Could not resolve status effect ${condition.uuid}`, error);
        return null;
    }
}

async function findCompendiumStatusEffectTemplate(name) {
    for (const pack of statusEffectPacks()) {
        if (!isItemPack(pack)) continue;
        try {
            const index = typeof pack.getIndex === "function"
                ? await pack.getIndex({ fields: ["name", "type"] })
                : pack.index;
            const entry = collectionValues(index).find((candidate) =>
                sameName(candidate?.name, name)
                && (!candidate?.type || candidate.type === STATUS_EFFECT_ITEM_TYPE)
            );
            const id = entry?._id ?? entry?.id;
            if (!id || typeof pack.getDocument !== "function") continue;
            const item = await pack.getDocument(id);
            if (isStatusEffect(item)) return item;
        } catch (error) {
            console.debug(`${MODULE_ID} | Could not inspect status effect pack ${pack.collection ?? pack.metadata?.name ?? "unknown"}`, error);
        }
    }
    return null;
}

function statusEffectPacks() {
    const packs = globalThis.game?.packs;
    const preferred = packs?.get?.(STATUS_EFFECT_PACK) ?? null;
    return [preferred, ...collectionValues(packs)].filter((pack, index, all) =>
        pack && all.indexOf(pack) === index
    );
}

function isItemPack(pack) {
    return pack?.collection === STATUS_EFFECT_PACK
        || pack?.documentName === "Item"
        || pack?.metadata?.type === "Item"
        || pack?.metadata?.entity === "Item";
}

function normalizeEmbeddedStatusEffectData(template, condition) {
    const source = documentCreateData(template);
    delete source._id;
    delete source.id;
    delete source.folder;
    delete source.ownership;
    delete source.sort;
    delete source._stats;
    source.name ||= String(condition.name ?? "").trim();
    source.type = STATUS_EFFECT_ITEM_TYPE;
    source.img ||= "icons/svg/mystery-man.svg";
    source.system ??= {};
    source.system.description ??= "";
    source.system.source ??= "";
    source.system.modifier ??= "";
    source.system.level = conditionLevel(condition);
    const timing = statusEffectTimingData(normalizedCombatEvent(source.system, condition.durationTicks));
    delete source.system.combatEvent;
    delete source.system.startTick;
    delete source.system.interval;
    delete source.system.times;
    Object.assign(source.system, timing);
    source.effects = Array.isArray(source.effects) ? source.effects : [];
    source.flags ??= {};
    return source;
}

function normalizedCombatEvent(system, durationTicks) {
    const existing = system.combatEvent ?? {};
    const legacy = {
        startTick: system.startTick,
        interval: system.interval,
        repeats: system.times,
    };
    const duration = positiveInteger(durationTicks, null);
    return {
        ...existing,
        startTick: duration ? null : nullableNumber(existing.startTick ?? legacy.startTick),
        interval: duration ?? nullablePositiveNumber(existing.interval ?? legacy.interval),
        repeats: duration ? 1 : nullableNumber(existing.repeats ?? legacy.repeats),
        macroRef: {
            name: existing.macroRef?.name ?? null,
            uuid: existing.macroRef?.uuid ?? null,
        },
        postDescription: existing.postDescription ?? true,
    };
}

function documentCreateData(document) {
    if (typeof document?.toObject === "function") return cloneData(document.toObject());
    if (typeof document?.toJSON === "function") return cloneData(document.toJSON());
    return cloneData(document);
}

function genericStatusEffectData(name) {
    return {
        name: String(name ?? "").trim(),
        type: STATUS_EFFECT_ITEM_TYPE,
        img: "icons/svg/mystery-man.svg",
        system: {
            description: "",
            source: "",
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
        flags: {},
    };
}

function collectionValues(collection) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (Array.isArray(collection.contents)) return collection.contents;
    if (typeof collection.values === "function") return Array.from(collection.values());
    return Array.from(collection);
}

function isStatusEffect(item) {
    return item?.type === STATUS_EFFECT_ITEM_TYPE;
}

function sameName(left, right) {
    return String(left ?? "").localeCompare(String(right ?? ""), globalThis.game?.i18n?.lang, { sensitivity: "base" }) === 0;
}

function conditionLevel(condition) {
    return positiveInteger(condition?.level, 1);
}

function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function nullableNumber(value) {
    const number = Number(value);
    return value !== null && value !== "" && Number.isFinite(number) ? number : null;
}

function nullablePositiveNumber(value) {
    const number = nullableNumber(value);
    return number && number > 0 ? number : null;
}
