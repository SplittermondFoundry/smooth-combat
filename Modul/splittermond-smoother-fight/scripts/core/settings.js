import { services } from "./services.js";

import {
    AUDIO_FEEDBACK_EVENTS,
    AUDIO_SOUND_PROFILES,
    MODULE_ID,
} from "./constants.js";

import {
    DEFAULT_MELEE_RANGE,
} from "../domain/combat/range.js";

export function registerSettings() {
    const rerender = () => services.scheduleRender();
    game.settings.register(MODULE_ID, "enabled", {
        name: "SMOOTHER_FIGHT.Settings.EnabledName",
        hint: "SMOOTHER_FIGHT.Settings.EnabledHint",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "hideSystemBar", {
        name: "SMOOTHER_FIGHT.Settings.HideSystemBarName",
        hint: "SMOOTHER_FIGHT.Settings.HideSystemBarHint",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "showCards", {
        name: "SMOOTHER_FIGHT.Settings.ShowCardsName",
        hint: "SMOOTHER_FIGHT.Settings.ShowCardsHint",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "movementTracking", {
        name: "SMOOTHER_FIGHT.Settings.MovementTrackingName",
        hint: "SMOOTHER_FIGHT.Settings.MovementTrackingHint",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: true,
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "showMovementRoutesByDefault", {
        name: "SMOOTHER_FIGHT.Settings.ShowMovementRoutesByDefaultName",
        hint: "SMOOTHER_FIGHT.Settings.ShowMovementRoutesByDefaultHint",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: (enabled) => {
            if (enabled) services.syncDefaultMovementRoutePreviews(game.combat, { reconsider: true });
            rerender();
        },
    });
    game.settings.register(MODULE_ID, "meleeRange", {
        name: "SMOOTHER_FIGHT.Settings.MeleeRangeName",
        hint: "SMOOTHER_FIGHT.Settings.MeleeRangeHint",
        scope: "world",
        config: true,
        restricted: true,
        type: Number,
        range: { min: 0.5, max: 10, step: 0.5 },
        default: DEFAULT_MELEE_RANGE,
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "minimized", {
        scope: "client",
        config: false,
        type: Boolean,
        default: false,
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "maxCards", {
        name: "SMOOTHER_FIGHT.Settings.MaxCardsName",
        hint: "SMOOTHER_FIGHT.Settings.MaxCardsHint",
        scope: "client",
        config: true,
        type: Number,
        range: { min: 1, max: 5, step: 1 },
        default: 3,
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "defenseRecalculation", {
        name: "SMOOTHER_FIGHT.Settings.DefenseRecalculationName",
        hint: "SMOOTHER_FIGHT.Settings.DefenseRecalculationHint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID, "revealTargetDefenses", {
        name: "SMOOTHER_FIGHT.Settings.RevealTargetDefensesName",
        hint: "SMOOTHER_FIGHT.Settings.RevealTargetDefensesHint",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: false,
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "revealTargetResources", {
        name: "SMOOTHER_FIGHT.Settings.RevealTargetResourcesName",
        hint: "SMOOTHER_FIGHT.Settings.RevealTargetResourcesHint",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: false,
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "audioFeedback", {
        scope: "client",
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID, "audioFeedbackMigrated", {
        scope: "client",
        config: false,
        type: Boolean,
        default: false,
    });
    const soundChoices = Object.fromEntries(Object.entries(AUDIO_SOUND_PROFILES).map(([id, profile]) => [id, profile.label]));
    for (const config of Object.values(AUDIO_FEEDBACK_EVENTS)) {
        game.settings.register(MODULE_ID, config.enabled, {
            name: `SMOOTHER_FIGHT.Settings.${config.name}EnabledName`,
            hint: "SMOOTHER_FIGHT.Settings.AudioEventEnabledHint",
            scope: "client",
            config: false,
            type: Boolean,
            default: true,
        });
        game.settings.register(MODULE_ID, config.sound, {
            name: `SMOOTHER_FIGHT.Settings.${config.name}SoundName`,
            hint: "SMOOTHER_FIGHT.Settings.AudioEventSoundHint",
            scope: "client",
            config: false,
            type: String,
            choices: soundChoices,
            default: config.defaultSound,
        });
    }
    game.settings.register(MODULE_ID, "theme", {
        scope: "client",
        config: false,
        type: String,
        default: "dark",
        onChange: rerender,
    });
    for (const key of ["hudBackgroundDark", "hudBackgroundLight", "hudIconDirectory"]) {
        game.settings.register(MODULE_ID, key, {
            scope: "client",
            config: false,
            type: String,
            default: "",
            onChange: rerender,
        });
    }
    game.settings.register(MODULE_ID, "hudMotion", {
        scope: "client",
        config: false,
        type: String,
        default: "system",
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "userTokenLinks", {
        scope: "world",
        config: false,
        type: Object,
        default: {},
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "actorUserLinks", {
        scope: "world",
        config: false,
        type: Object,
        default: {},
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "primaryGmId", {
        scope: "world",
        config: false,
        type: String,
        default: "",
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "assignmentSetupHintSeen", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
    });
}
