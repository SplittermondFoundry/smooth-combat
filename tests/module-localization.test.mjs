import test from "node:test";
import assert from "node:assert/strict";

import {
    applyModuleLanguage,
    DEFAULT_MODULE_LANGUAGE,
    getActiveModuleLanguage,
    normalizeModuleLanguage,
} from "../Modul/splittermond-smoother-fight/scripts/core/localization.js";

test("module language defaults to German independently of Foundry's language", async (context) => {
    const previousGame = globalThis.game;
    context.after(() => { globalThis.game = previousGame; });
    globalThis.game = {
        i18n: { lang: "fr", translations: { CORE: { Yes: "Oui" } } },
        modules: new Map([["splittermond-smoother-fight", { version: "0.7.1" }]]),
    };
    const requests = [];
    const fetchImplementation = async (url) => {
        requests.push(url);
        return {
            ok: true,
            json: async () => ({ SMOOTHER_FIGHT: { Title: "Smoother Fight", HUD: { Wait: "Abwarten" } } }),
        };
    };

    assert.equal(normalizeModuleLanguage(undefined), DEFAULT_MODULE_LANGUAGE);
    assert.equal(normalizeModuleLanguage("fr"), DEFAULT_MODULE_LANGUAGE);
    assert.equal(await applyModuleLanguage("fr", { fetchImplementation }), "de");
    assert.equal(getActiveModuleLanguage(), "de");
    assert.equal(game.i18n.translations.SMOOTHER_FIGHT.HUD.Wait, "Abwarten");
    assert.equal(game.i18n.translations.CORE.Yes, "Oui", "system translations stay untouched");
    assert.deepEqual(requests, ["modules/splittermond-smoother-fight/lang/de.json?module=0.7.1"]);
});

test("English can replace only the module translation namespace", async (context) => {
    const previousGame = globalThis.game;
    context.after(() => { globalThis.game = previousGame; });
    globalThis.game = {
        i18n: {
            lang: "de",
            translations: {
                SMOOTHER_FIGHT: { HUD: { Wait: "Abwarten" } },
                splittermond: { wait: "Abwarten" },
            },
        },
        modules: new Map(),
    };

    const language = await applyModuleLanguage("en", {
        fetchImplementation: async (url) => ({
            ok: url.endsWith("/en.json"),
            json: async () => ({ SMOOTHER_FIGHT: { HUD: { Wait: "Waiting" } } }),
        }),
    });

    assert.equal(language, "en");
    assert.equal(game.i18n.translations.SMOOTHER_FIGHT.HUD.Wait, "Waiting");
    assert.equal(game.i18n.translations.splittermond.wait, "Abwarten", "system localization is not replaced");
});
