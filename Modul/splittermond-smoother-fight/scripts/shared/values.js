import {
    MODULE_ID,
} from "../core/constants.js";

export function getDerivedValue(actor, key) {
    return displayValue(actor?.derivedValues?.[key]?.value ?? actor?.system?.derivedValues?.[key]?.value, 0);
}

export function numericValue(value, fallback = 0) {
    const displayed = displayValue(value, "");
    const numeric = typeof displayed === "number"
        ? displayed
        : Number.parseFloat(String(displayed).trim().replace(",", "."));
    return Number.isFinite(numeric) ? numeric : fallback;
}

export function displayValue(value, fallback = 0, seen = new Set()) {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "string" || typeof value === "number") return value;
    if (typeof value !== "object" || seen.has(value)) return fallback;
    seen.add(value);

    for (const key of ["display", "calculationValue", "value", "total"]) {
        const candidate = value[key];
        if (candidate !== undefined && candidate !== null && candidate !== value) {
            const displayed = displayValue(candidate, "", seen);
            if (displayed !== "") return displayed;
        }
    }
    if (typeof value.calculateSync === "function") {
        try {
            return displayValue(value.calculateSync(), fallback, seen);
        } catch {
            return fallback;
        }
    }
    return fallback;
}

export function displayLabel(value, fallback = "", seen = new Set()) {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "string") {
        const localized = game.i18n.localize(value);
        return localized === value ? value : localized;
    }
    if (typeof value === "number") return String(value);
    if (typeof value !== "object" || seen.has(value)) return fallback;
    seen.add(value);

    for (const key of ["long", "full", "name", "label", "short", "display", "value"]) {
        const candidate = value[key];
        if (candidate !== undefined && candidate !== null && candidate !== value) {
            const displayed = displayLabel(candidate, "", seen);
            if (displayed) return displayed;
        }
    }
    const stringified = value.toString?.();
    return stringified && stringified !== "[object Object]" ? stringified : fallback;
}

export function getSetting(key, fallback) {
    try {
        return game.settings.get(MODULE_ID, key);
    } catch {
        return fallback;
    }
}

export function t(key, data) {
    return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

export function localizeSystem(key, fallback) {
    const localized = game.i18n.localize(key);
    return localized === key ? fallback : localized;
}

export function sortByName(a, b) {
    return String(a?.name ?? "").localeCompare(String(b?.name ?? ""), game.i18n.lang);
}

export function cloneData(value) {
    if (foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
    return structuredClone(value);
}

export function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function escapeAttr(value) {
    return escapeHtml(value);
}

export function asElement(html) {
    if (html instanceof HTMLElement) return html;
    return html?.[0] instanceof HTMLElement ? html[0] : null;
}
