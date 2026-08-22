import {
    isUnmodifiedKeyAvailable,
    requestCombatEventExpansion,
    toggleHudMinimizedFromKeybinding,
    toggleHudVisibilityFromKeybinding,
} from "./visibility.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

export function registerKeybindings() {
    game.keybindings.register(MODULE_ID, "toggleHud", {
        name: "SMOOTHER_FIGHT.Keybindings.ToggleHudName",
        hint: "SMOOTHER_FIGHT.Keybindings.ToggleHudHint",
        editable: [{ key: "KeyV" }],
        onDown: toggleHudMinimizedFromKeybinding,
        repeat: false,
    });
    game.keybindings.register(MODULE_ID, "toggleHudVisibility", {
        name: "SMOOTHER_FIGHT.Keybindings.ToggleHudVisibilityName",
        hint: "SMOOTHER_FIGHT.Keybindings.ToggleHudVisibilityHint",
        editable: isUnmodifiedKeyAvailable("KeyB") ? [{ key: "KeyB" }] : [],
        onDown: toggleHudVisibilityFromKeybinding,
        repeat: false,
    });
    game.keybindings.register(MODULE_ID, "collapseCombatActions", {
        name: "SMOOTHER_FIGHT.Keybindings.CollapseCombatActionsName",
        hint: "SMOOTHER_FIGHT.Keybindings.CollapseCombatActionsHint",
        editable: [{ key: "KeyX" }],
        onDown: () => requestCombatEventExpansion("collapse"),
        repeat: false,
    });
    game.keybindings.register(MODULE_ID, "openLatestCombatAction", {
        name: "SMOOTHER_FIGHT.Keybindings.OpenLatestCombatActionName",
        hint: "SMOOTHER_FIGHT.Keybindings.OpenLatestCombatActionHint",
        editable: [{ key: "KeyY" }, { key: "KeyZ" }],
        onDown: () => requestCombatEventExpansion("latest"),
        repeat: false,
    });
}
