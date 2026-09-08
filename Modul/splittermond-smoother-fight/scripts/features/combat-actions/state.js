/** Feature-owned ephemeral state. */
export const combatActionState = {
    fearRollDialogs: new WeakMap(),
    fearRollElements: new WeakMap(),
    fearRollInputs: new WeakMap(),
    preparingSpellId: null,
    pendingOffenseKinds: new Map(),
    movementAborts: new Map(),
    movementControls: new Map(),
    movementControlFrame: null,
    movementControlScale: null,
};
