/** Feature-owned ephemeral state. */
export const activeDefenseState = {
    pendingDefense: null,
    pendingDefenseTimers: new Map(),
    pendingDefenseCleanups: new Map(),
    rollingDefenses: new Map(),
    publishedPendingDefenses: new Map(),
    claimedDefenses: new Map(),
    processingDefenseMessages: new Map(),
    attackProcessingQueues: new Map(),
    offenseFollowUpRequests: new Map(),
    splinterpointActorLocks: new Set(),
};
