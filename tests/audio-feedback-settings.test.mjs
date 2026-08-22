import test from "node:test";
import assert from "node:assert/strict";

test("an empty custom sound focuses the custom picker", async () => {
    let menuType;
    let save;
    let pickerFocuses = 0;
    let nestedInputFocuses = 0;
    let savedFlags = 0;

    class ApplicationV2 {
        async _onRender() {}
    }
    globalThis.foundry = {
        applications: {
            api: {
                ApplicationV2,
                HandlebarsApplicationMixin: (Base) => class extends Base {},
            },
        },
    };
    globalThis.game = {
        i18n: { localize: (key) => key },
        settings: {
            registerMenu: (_moduleId, _key, options) => {
                menuType = options.type;
            },
        },
        user: {
            setFlag: async () => {
                savedFlags += 1;
            },
        },
    };
    globalThis.ui = { notifications: { warn: () => {} } };

    const customPicker = {
        value: "",
        input: { focus: () => { nestedInputFocuses += 1; } },
        focus: () => { pickerFocuses += 1; },
        addEventListener: () => {},
    };
    const controls = {
        '[data-role="audio-enabled"]': { checked: true, addEventListener: () => {} },
        '[data-role="audio-sound"]': { value: "custom", addEventListener: () => {} },
        '[data-role="audio-custom"]': customPicker,
        '[data-role="audio-custom-source"]': { toggleAttribute: () => {} },
        '[data-action="preview-audio"]': { addEventListener: () => {} },
    };
    const row = {
        dataset: { audioEvent: "defense", defaultSound: "shield" },
        classList: { toggle: () => {} },
        querySelector: (selector) => controls[selector] ?? null,
    };
    const saveButton = {
        addEventListener: (_event, listener) => {
            save = listener;
        },
    };
    const element = {
        querySelectorAll: () => [row],
        querySelector: (selector) => selector === '[data-action="save-audio"]' ? saveButton : null,
    };

    const { registerAudioSettingsMenu } = await import(
        "../Modul/splittermond-smoother-fight/scripts/features/feedback/settings-app.js?focus-regression"
    );
    registerAudioSettingsMenu();
    const app = new menuType();
    app.element = element;
    await app._onRender({}, {});
    await save();

    assert.equal(pickerFocuses, 1);
    assert.equal(nestedInputFocuses, 0);
    assert.equal(savedFlags, 0);
});
