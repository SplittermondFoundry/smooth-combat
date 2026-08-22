/** Feature-owned ephemeral state. */
export const activeDefenseState = {
    pendingDefense: null,
    pendingDefenseTimers: new Map(),
    rollingDefenses: new Map(),
    claimedDefenses: new Map(),
    processingDefenseMessages: new Set(),
    attackProcessingQueues: new Map(),
};
