/** Feature-owned ephemeral state. */
export const combatActionState = {
    preparingSpellId: null,
    pendingOffenseKinds: new Map(),
    movementAborts: new Map(),
    movementControls: new Map(),
    movementControlFrame: null,
    movementControlScale: null,
};
