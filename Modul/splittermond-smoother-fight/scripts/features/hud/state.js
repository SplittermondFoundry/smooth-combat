/** Feature-owned ephemeral state. */
export const hudState = {
    hud: null,
    renderTimer: null,
    canvasFrame: null,
    canvasGeneration: 0,
    canvasSignature: null,
    canvasValues: new Map(),
    movementDistanceCache: new WeakMap(),
    actionTooltip: null,
    actionTooltipRequest: null,
    hiddenByShortcut: false,
    actionMenuExpansionRequest: null,
    personalCombatId: null,
    personalCombatantId: null,
};
