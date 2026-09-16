import { MODULE_ID } from "./constants.js";

export const DEFAULT_MODULE_LANGUAGE = "de";
export const MODULE_LANGUAGES = Object.freeze(["de", "en"]);

const MODULE_TRANSLATION_NAMESPACE = "SMOOTHER_FIGHT";
const translationCache = new Map();
let activeModuleLanguage = DEFAULT_MODULE_LANGUAGE;
let applicationSequence = 0;

export function normalizeModuleLanguage(language) {
    return MODULE_LANGUAGES.includes(language) ? language : DEFAULT_MODULE_LANGUAGE;
}

export function getActiveModuleLanguage() {
    return activeModuleLanguage;
}

export async function initializeModuleLocalization() {
    let language = DEFAULT_MODULE_LANGUAGE;
    try {
        language = game.settings.get(MODULE_ID, "language");
    } catch {
        // The registered default remains authoritative if client storage is unavailable.
    }
    return applyModuleLanguage(language);
}

export async function applyModuleLanguage(language, options = {}) {
    const normalizedLanguage = normalizeModuleLanguage(language);
    const sequence = ++applicationSequence;
    const namespace = await loadTranslationNamespace(normalizedLanguage, options.fetchImplementation);

    // A slower request must not replace a newer language selection.
    if (sequence !== applicationSequence) return activeModuleLanguage;

    const translations = globalThis.game?.i18n?.translations;
    if (!translations || typeof translations !== "object") {
        throw new Error("Foundry localization is not available.");
    }
    translations[MODULE_TRANSLATION_NAMESPACE] = namespace;
    activeModuleLanguage = normalizedLanguage;
    return activeModuleLanguage;
}

async function loadTranslationNamespace(language, fetchImplementation = globalThis.fetch) {
    if (translationCache.has(language)) return translationCache.get(language);
    if (typeof fetchImplementation !== "function") throw new Error("No translation loader is available.");

    const moduleVersion = globalThis.game?.modules?.get?.(MODULE_ID)?.version;
    const versionQuery = moduleVersion ? `?module=${encodeURIComponent(moduleVersion)}` : "";
    const response = await fetchImplementation(`modules/${MODULE_ID}/lang/${language}.json${versionQuery}`);
    if (!response?.ok) {
        throw new Error(`Could not load ${language} translations (${response?.status ?? "unknown status"}).`);
    }
    const dictionary = await response.json();
    const namespace = dictionary?.[MODULE_TRANSLATION_NAMESPACE];
    if (!namespace || typeof namespace !== "object" || Array.isArray(namespace)) {
        throw new Error(`The ${language} translation file has no ${MODULE_TRANSLATION_NAMESPACE} namespace.`);
    }
    translationCache.set(language, namespace);
    return namespace;
}
