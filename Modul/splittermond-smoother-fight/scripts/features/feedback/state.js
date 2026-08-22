/** Feature-owned ephemeral state. */
export const feedbackState = {
    feedback: null,
    feedbackTimer: null,
    audioContext: null,
    lastTurnCombatantId: null,
    heardMessageIds: new Set(),
    healthCostsByActor: new Map(),
};
