import test from "node:test";
import assert from "node:assert/strict";

test("bootstrap preserves settings, menus, and keybinding contracts", async () => {
    const onceCallbacks = new Map();
    const settings = [];
    const menus = [];
    const keybindings = [];

    globalThis.Hooks = {
        once: (name, callback) => onceCallbacks.set(name, callback),
    };
    globalThis.game = {
        settings: {
            get: () => ({}),
            register: (moduleId, key, options) => settings.push({ moduleId, key, options }),
            registerMenu: (moduleId, key, options) => menus.push({ moduleId, key, options }),
        },
        keybindings: {
            register: (moduleId, key, options) => keybindings.push({ moduleId, key, options }),
        },
    };
    class ApplicationV2 {}
    globalThis.foundry = {
        applications: {
            api: {
                ApplicationV2,
                HandlebarsApplicationMixin: (Base) => class extends Base {},
            },
        },
    };

    await import("../Modul/splittermond-smoother-fight/scripts/smoother-fight.js?bootstrap-contract");
    assert.deepEqual([...onceCallbacks.keys()], ["init", "ready"]);
    onceCallbacks.get("init")();

    const moduleId = "splittermond-smoother-fight";
    assert.ok(settings.every((entry) => entry.moduleId === moduleId));
    assert.ok(menus.every((entry) => entry.moduleId === moduleId));
    assert.ok(keybindings.every((entry) => entry.moduleId === moduleId));
    assert.deepEqual(settings.map(({ key }) => key), [
        "enabled",
        "hideSystemBar",
        "showCards",
        "minimized",
        "maxCards",
        "defenseRecalculation",
        "revealTargetDefenses",
        "audioFeedback",
        "audioFeedbackMigrated",
        "audioDefenseEnabled",
        "audioDefenseSound",
        "audioDamageEnabled",
        "audioDamageSound",
        "audioDamageBlockedEnabled",
        "audioDamageBlockedSound",
        "audioSpellEnabled",
        "audioSpellSound",
        "audioRangedEnabled",
        "audioRangedSound",
        "audioTurnEnabled",
        "audioTurnSound",
        "theme",
        "userTokenLinks",
        "actorUserLinks",
        "primaryGmId",
    ]);

    const settingByKey = Object.fromEntries(settings.map(({ key, options }) => [key, options]));
    assert.deepEqual(
        Object.fromEntries(["enabled", "hideSystemBar", "showCards"].map((key) => [key, {
            scope: settingByKey[key].scope,
            config: settingByKey[key].config,
            type: settingByKey[key].type,
            default: settingByKey[key].default,
        }])),
        Object.fromEntries(["enabled", "hideSystemBar", "showCards"].map((key) => [key, {
            scope: "client",
            config: true,
            type: Boolean,
            default: true,
        }])),
    );
    assert.deepEqual(settingByKey.maxCards.range, { min: 1, max: 5, step: 1 });
    assert.equal(settingByKey.maxCards.default, 3);
    assert.equal(settingByKey.defenseRecalculation.scope, "world");
    assert.equal(settingByKey.defenseRecalculation.default, true);
    assert.equal(settingByKey.revealTargetDefenses.scope, "world");
    assert.equal(settingByKey.revealTargetDefenses.default, false);
    assert.deepEqual(
        ["userTokenLinks", "actorUserLinks"].map((key) => [key, settingByKey[key].scope, settingByKey[key].config, settingByKey[key].type, settingByKey[key].default]),
        [
            ["userTokenLinks", "world", false, Object, {}],
            ["actorUserLinks", "world", false, Object, {}],
        ],
    );
    assert.deepEqual(
        [settingByKey.primaryGmId.scope, settingByKey.primaryGmId.config, settingByKey.primaryGmId.type, settingByKey.primaryGmId.default],
        ["world", false, String, ""],
    );

    const audioDefaults = {
        Defense: "shield",
        Damage: "impact",
        DamageBlocked: "blocked",
        Spell: "arcane",
        Ranged: "shot",
        Turn: "turn",
    };
    for (const [event, sound] of Object.entries(audioDefaults)) {
        const enabled = settingByKey[`audio${event}Enabled`];
        const selection = settingByKey[`audio${event}Sound`];
        assert.deepEqual([enabled.scope, enabled.config, enabled.type, enabled.default], ["client", false, Boolean, true]);
        assert.deepEqual([selection.scope, selection.config, selection.type, selection.default], ["client", false, String, sound]);
        assert.deepEqual(Object.keys(selection.choices), ["shield", "impact", "blocked", "arcane", "shot", "turn"]);
    }

    assert.deepEqual(menus.map(({ key, options }) => [key, options.restricted, options.type.PARTS.form.template]), [
        ["userTokenLinksMenu", true, "modules/splittermond-smoother-fight/templates/user-token-links.hbs"],
        ["audioFeedbackMenu", false, "modules/splittermond-smoother-fight/templates/audio-feedback-settings.hbs"],
    ]);
    assert.deepEqual(keybindings.map(({ key, options }) => [key, options.editable]), [
        ["toggleHud", [{ key: "KeyV" }]],
        ["toggleHudVisibility", [{ key: "KeyB" }]],
        ["collapseCombatActions", [{ key: "KeyX" }]],
        ["openLatestCombatAction", [{ key: "KeyY" }, { key: "KeyZ" }]],
    ]);
});
