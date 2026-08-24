import { configureServices } from "./core/services.js";
import { registerHooks, registerSocket } from "./core/lifecycle.js";
import { registerSettings } from "./core/settings.js";
import * as activeDefenseApi from "./features/active-defense/api.js";
import * as assignmentsApi from "./features/assignments/api.js";
import { registerSettingsMenu } from "./features/assignments/settings-app.js";
import * as chatApi from "./features/chat/api.js";
import * as combatActionsApi from "./features/combat-actions/api.js";
import * as combatEventsApi from "./features/combat-events/api.js";
import * as feedbackApi from "./features/feedback/api.js";
import {
    installHealthCostFeedbackInterceptor,
    migrateAudioFeedbackSettings,
    seedHealthFeedbackState,
    setLastTurnCombatantId,
    unlockFeedbackAudio,
} from "./features/feedback/feedback.js";
import { registerAudioSettingsMenu } from "./features/feedback/settings-app.js";
import * as fumblesApi from "./features/fumbles/api.js";
import * as hudApi from "./features/hud/api.js";
import { registerAppearanceSettingsMenu } from "./features/hud/appearance.js";
import { mountHud, renderHud } from "./features/hud/controller.js";
import { registerKeybindings } from "./features/hud/keybindings.js";
import * as targetingApi from "./features/targeting/api.js";
import { publishOwnTarget } from "./features/targeting/targeting.js";

configureServices(
    activeDefenseApi,
    assignmentsApi,
    chatApi,
    combatActionsApi,
    combatEventsApi,
    feedbackApi,
    fumblesApi,
    hudApi,
    targetingApi,
);

Hooks.once("init", () => {
    registerSettings();
    registerSettingsMenu();
    registerAudioSettingsMenu();
    registerAppearanceSettingsMenu();
    registerKeybindings();
});

Hooks.once("ready", async () => {
    await migrateAudioFeedbackSettings();
    installHealthCostFeedbackInterceptor();
    mountHud();
    seedHealthFeedbackState();
    registerHooks();
    registerSocket();
    publishOwnTarget();
    hudApi.syncActiveCombatantTokenSelection(game.combat);
    setLastTurnCombatantId(game.combat?.combatant?.id ?? null);
    window.addEventListener("pointerdown", unlockFeedbackAudio, { once: true, capture: true });
    await renderHud();
});
