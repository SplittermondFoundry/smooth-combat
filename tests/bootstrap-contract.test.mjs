import test from "node:test";
import assert from "node:assert/strict";

test("bootstrap preserves settings, menus, and keybinding contracts", async () => {
    const onceCallbacks = new Map();
    const hookCallbacks = [];
    const settings = [];
    const menus = [];
    const keybindings = [];
    const appendedElements = [];

    globalThis.Hooks = {
        once: (name, callback) => onceCallbacks.set(name, callback),
        on: (name, callback) => hookCallbacks.push({ name, callback }),
    };
    globalThis.game = {
        settings: {
            get: (moduleId, key) => {
                if (moduleId === "core" && key === "keybindings") {
                    throw new Error("core.keybindings is not registered during module init");
                }
                return {};
            },
            set: async () => true,
            register: (moduleId, key, options) => settings.push({ moduleId, key, options }),
            registerMenu: (moduleId, key, options) => menus.push({ moduleId, key, options }),
        },
        keybindings: {
            register: (moduleId, key, options) => keybindings.push({ moduleId, key, options }),
        },
        socket: {
            on: () => {},
        },
    };
    class TestDie {
        randomFace() {
            return 1;
        }
    }
    class ApplicationV2 {}
    globalThis.foundry = {
        applications: {
            api: {
                ApplicationV2,
                HandlebarsApplicationMixin: (Base) => class extends Base {},
            },
        },
    };
    globalThis.CONFIG = {
        Actor: { documentClass: class {} },
        Dice: { terms: { d: TestDie } },
    };
    globalThis.canvas = { scene: null };
    globalThis.window = { addEventListener: () => {} };
    globalThis.document = {
        body: { append: (element) => appendedElements.push(element) },
        createElement: () => ({
            addEventListener: () => {},
            classList: {
                add: () => {},
                remove: () => {},
                toggle: () => {},
            },
            dataset: {},
            remove: () => {},
            replaceChildren: () => {},
            setAttribute: () => {},
            style: {
                removeProperty: () => {},
                setProperty: () => {},
            },
        }),
        querySelector: () => null,
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
        "movementTracking",
        "showMovementRoutesByDefault",
        "privateMovementRoutes",
        "meleeRange",
        "minimized",
        "maxCards",
        "defenseRecalculation",
        "revealTargetDefenses",
        "revealTargetResources",
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
        "hudBackgroundDark",
        "hudBackgroundLight",
        "hudIconDirectory",
        "hudMotion",
        "userTokenLinks",
        "actorUserLinks",
        "primaryGmId",
        "assignmentSetupHintSeen",
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
    assert.deepEqual(
        [settingByKey.movementTracking.scope, settingByKey.movementTracking.config, settingByKey.movementTracking.restricted, settingByKey.movementTracking.type, settingByKey.movementTracking.default],
        ["world", true, true, Boolean, true],
    );
    assert.deepEqual(
        [settingByKey.showMovementRoutesByDefault.scope, settingByKey.showMovementRoutesByDefault.config, settingByKey.showMovementRoutesByDefault.type, settingByKey.showMovementRoutesByDefault.default],
        ["client", true, Boolean, true],
    );
    assert.deepEqual(
        [settingByKey.privateMovementRoutes.scope, settingByKey.privateMovementRoutes.config, settingByKey.privateMovementRoutes.restricted, settingByKey.privateMovementRoutes.type, settingByKey.privateMovementRoutes.default],
        ["world", true, true, Boolean, false],
    );
    assert.deepEqual(
        [settingByKey.meleeRange.scope, settingByKey.meleeRange.config, settingByKey.meleeRange.restricted, settingByKey.meleeRange.type, settingByKey.meleeRange.default],
        ["world", true, true, Number, 2],
    );
    assert.deepEqual(settingByKey.meleeRange.range, { min: 0.5, max: 10, step: 0.5 });
    assert.deepEqual(settingByKey.maxCards.range, { min: 1, max: 5, step: 1 });
    assert.equal(settingByKey.maxCards.default, 3);
    assert.equal(settingByKey.defenseRecalculation.scope, "world");
    assert.equal(settingByKey.defenseRecalculation.default, true);
    assert.equal(settingByKey.revealTargetDefenses.scope, "world");
    assert.equal(settingByKey.revealTargetDefenses.default, false);
    assert.equal(settingByKey.revealTargetResources.scope, "world");
    assert.equal(settingByKey.revealTargetResources.default, false);
    for (const key of ["hudBackgroundDark", "hudBackgroundLight", "hudIconDirectory"]) {
        assert.deepEqual(
            [settingByKey[key].scope, settingByKey[key].config, settingByKey[key].type, settingByKey[key].default],
            ["client", false, String, ""],
        );
    }
    assert.deepEqual(
        [settingByKey.hudMotion.scope, settingByKey.hudMotion.config, settingByKey.hudMotion.type, settingByKey.hudMotion.default],
        ["client", false, String, "system"],
    );
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
    assert.deepEqual(
        [
            settingByKey.assignmentSetupHintSeen.scope,
            settingByKey.assignmentSetupHintSeen.config,
            settingByKey.assignmentSetupHintSeen.type,
            settingByKey.assignmentSetupHintSeen.default,
        ],
        ["world", false, Boolean, false],
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
        ["appearanceMenu", false, "modules/splittermond-smoother-fight/templates/appearance-settings.hbs"],
    ]);
    assert.deepEqual(keybindings.map(({ key, options }) => [key, options.editable]), [
        ["toggleHud", [{ key: "KeyV" }]],
        ["toggleHudVisibility", [{ key: "KeyB" }]],
        ["collapseCombatActions", [{ key: "KeyX" }]],
        ["openLatestCombatAction", [{ key: "KeyY" }, { key: "KeyZ" }]],
    ]);

    await assert.doesNotReject(() => onceCallbacks.get("ready")());
    assert.equal(appendedElements.length, 1, "the ready hook must mount the HUD without a runtime error");
    assert.equal(appendedElements[0].id, "splittermond-smoother-fight-hud");
    assert.ok(hookCallbacks.length > 0, "the ready hook must register runtime hooks");
});
