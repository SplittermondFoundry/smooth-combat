/** Feature-owned ephemeral state. */
export const combatEventState = {
    cardsCollapsed: false,
    eventExpansionRequest: null,
    pendingDamageRolls: new Map(),
    pendingDamageApplications: [],
    completedDamageApplicationMessageIds: new Set(),
    pendingLegacyTickMessages: new Set(),
    combatEventDeletionPending: false,
    startedAt: Date.now(),
};
