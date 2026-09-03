import { configureServices, services } from "./core/services.js";
import { getApplicableCombat, installCombatantSortCompatibility } from "./core/combat-compatibility.js";
import { registerHooks, registerSocket } from "./core/lifecycle.js";
import { registerSettings } from "./core/settings.js";
import * as activeDefenseApi from "./features/active-defense/api.js";
import * as assignmentsApi from "./features/assignments/api.js";
import { registerSettingsMenu } from "./features/assignments/settings-app.js";
import * as chatApi from "./features/chat/api.js";
import * as combatActionsApi from "./features/combat-actions/api.js";
import { registerContinuousActionStatusEffect } from "./features/combat-actions/continuous-action.js";
import { installSystemRollModifierInterceptor } from "./features/combat-actions/system-roll-modifier-interceptor.js";
import * as combatEventsApi from "./features/combat-events/api.js";
import * as combatPositionsApi from "./features/combat-positions/api.js";
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
import * as gmCheatApi from "./features/gm-cheat/api.js";
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
    combatPositionsApi,
    feedbackApi,
    fumblesApi,
    gmCheatApi,
    hudApi,
    targetingApi,
);

Hooks.once("init", () => {
    installCombatantSortCompatibility();
    registerContinuousActionStatusEffect();
    registerSettings();
    registerSettingsMenu();
    registerAudioSettingsMenu();
    registerAppearanceSettingsMenu();
    registerKeybindings();
});

Hooks.once("ready", async () => {
    await migrateAudioFeedbackSettings();
    services.installGmCheatRollInterceptor();
    services.installSystemActionBarActiveDefenseInterceptor();
    installHealthCostFeedbackInterceptor();
    installSystemRollModifierInterceptor();
    mountHud();
    seedHealthFeedbackState();
    registerHooks();
    registerSocket();
    const combat = getApplicableCombat();
    void services.refreshAllCombatPositionOverlays();
    void combatActionsApi.advanceContinuousActions(combat);
    void combatActionsApi.advancePendingMovements(combat);
    combatActionsApi.syncDefaultMovementRoutePreviews(combat);
    publishOwnTarget();
    hudApi.reconcileControlledCombatTokenSelection(combat);
    setLastTurnCombatantId(combat?.combatant?.id ?? null);
    window.addEventListener("pointerdown", unlockFeedbackAudio, { once: true, capture: true });
    await renderHud();
});
