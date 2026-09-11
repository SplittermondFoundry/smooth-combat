// Standalone operation-count diagnostic. Uses synthetic documents and controlled
// event-loop turns, not a live Foundry world, CPU profile, or DOM/GPU benchmark.
// Run with: node tools/diagnose-token-movement.mjs
import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import { registerHooks } from "../Modul/splittermond-smoother-fight/scripts/core/lifecycle.js";
import { hudState } from "../Modul/splittermond-smoother-fight/scripts/features/hud/state.js";
import { scheduleRender, scheduleHudCanvasRefresh } from "../Modul/splittermond-smoother-fight/scripts/features/hud/visibility.js";
import { rememberHudCanvas } from "../Modul/splittermond-smoother-fight/scripts/features/hud/canvas-updates.js";
import { getHudContext } from "../Modul/splittermond-smoother-fight/scripts/features/hud/context.js";
import {
    refreshMovementTokenControl,
    scheduleMovementTokenControls,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/movement-controls.js";
import { syncDefaultMovementRoutePreviews } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/movement.js";
import { refreshMovementVisibility, scheduleDefaultMovementRoutePreviews } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/movement-refresh.js";
import { collectCombatEventPresentation } from "../Modul/splittermond-smoother-fight/scripts/features/combat-events/service.js";
import { readTokenMovementDistance } from "../Modul/splittermond-smoother-fight/scripts/shared/movement.js";

const hooks = new Map();
const timers = new Map();
const frames = new Map();
let nextId = 0;
globalThis.Hooks = { on(name, callback) {
    if (!hooks.has(name)) hooks.set(name, []);
    hooks.get(name).push(callback);
} };
globalThis.setTimeout = (callback) => { timers.set(++nextId, callback); return nextId; };
globalThis.clearTimeout = (id) => timers.delete(id);
globalThis.requestAnimationFrame = (callback) => { frames.set(++nextId, callback); return nextId; };
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
function flush(queue) {
    const callbacks = [...queue.values()];
    queue.clear();
    for (const callback of callbacks) callback();
}
function emit(name, ...args) {
    for (const callback of hooks.get(name) ?? []) callback(...args);
}

let flagReads = 0;
const tokens = Array.from({ length: 100 }, (_, i) => ({
    id: `token-${i}`, uuid: `Scene.synthetic.Token.${i}`,
    getFlag() { flagReads++; return null; },
}));
const combat = {
    id: "synthetic-combat", currentTick: 0, started: true,
    combatants: tokens.map((token, i) => ({ id: `combatant-${i}`, actorId: "attacker", token })),
};
const actor = { id: "attacker", attacks: [], spells: [] };
combat.combatant = combat.combatants[0];
combat.combatant.actor = actor;
tokens[0].actor = actor;
globalThis.game = {
    i18n: { lang: "en", localize: (key) => key, format: (key) => key },
    user: { id: "gm", isGM: true }, combat,
    settings: { get: (_module, key) => key === "maxCards" ? 3 : true },
};
globalThis.canvas = {
    ready: true, stage: {}, interface: {},
    tokens: { placeables: tokens.map((document) => ({ document, addChild() {} })) },
};
globalThis.PIXI = { Graphics() {} };
Object.assign(services, {
    scheduleRender, scheduleMovementTokenControls, refreshMovementTokenControl,
    syncDefaultMovementRoutePreviews, scheduleDefaultMovementRoutePreviews,
    scheduleHudCanvasRefresh, refreshMovementVisibility,
    getAssignedUser: () => game.user, getRuntimeController: () => game.user,
    getTargetSelectionForUser: () => ({ target: null, targets: [] }),
    canChooseTarget: () => false,
    getTargetSceneTokens: () => tokens,
    isFearRollCompatibilityRequired: () => false,
    refreshCombatPositionOverlay() {},
    prepareExistingRenderedChatMessages() {},
});
registerHooks();

let renderCalls = 0;
hudState.hud = {
    element: { hidden: false, classList: { contains: () => false }, querySelector: () => null, querySelectorAll: () => [] },
    render() { renderCalls++; },
};
rememberHudCanvas(getHudContext());
refreshMovementVisibility();
flush(frames);
flagReads = 0;

// Establish initial visibility first, then measure 60 unchanged sight frames.
for (let frame = 0; frame < 60; frame++) {
    emit("sightRefresh");
    flush(timers);
    flush(frames);
}
const sightRefresh = {
    syntheticFrames: 60, tokens: tokens.length, hudRenderCalls: renderCalls,
    tokenFlagReads: flagReads,
};

flagReads = 0;
renderCalls = 0;
for (let frame = 0; frame < 60; frame++) {
    for (const object of canvas.tokens.placeables) emit("refreshToken", object);
    flush(timers);
    flush(frames);
}
const tokenRefresh = { events: 6000, tokenFlagReads: flagReads, hudRenderCalls: renderCalls };

renderCalls = 0;
for (let i = 0; i < 60; i++) {
    emit("recordToken", tokens[0]);
    flush(frames);
    flush(timers);
}
const recordedMovement = { events: 60, hudRenderCalls: renderCalls };
for (const token of tokens.slice(1)) emit("recordToken", token);
recordedMovement.unrelatedTokens = tokens.length - 1;
recordedMovement.unrelatedScheduledFrames = frames.size;

flagReads = 0;
for (let i = 0; i < 100; i++) emit("updateToken", tokens[0], { rotation: i }, {}, "gm");
const tokenUpdates = {
    events: 100, combatants: combat.combatants.length,
    synchronousRouteFlagReads: flagReads, pendingReconciliations: frames.size,
};
flush(frames);
tokenUpdates.deferredTokenFlagReads = flagReads;

let messageContextReads = 0;
Object.assign(services, {
    getMessageContext: (message) => { messageContextReads++; return message?.context ?? null; },
    isDiceAnimationPending: () => false,
    isSpellMessage: () => false,
    isDamageMessage: () => false,
    isDefenseMessage: (message) => message?.type === "defenseMessage",
    isFumbleTableMessage: () => false,
    getFumbleData: () => null,
    hasPendingFumbleActions: () => false,
    defenseAwaitsResponse: () => false,
    getDamageApplicationState: () => "completed",
    getRunningActiveDefense: () => null,
    isContinuousActionInterruptionPending: () => false,
});
game.messages = { contents: Array.from({ length: 200 }, (_, i) => [
    { id: `attack-${i}`, timestamp: i * 2, type: "attackRollMessage", speaker: { actor: "attacker" },
        context: { combatId: combat.id, defenseMessageIds: [`defense-${i}`] } },
    { id: `defense-${i}`, timestamp: i * 2 + 1, type: "defenseMessage",
        context: { attackMessageId: `attack-${i}` } },
]).flat() };
for (let i = 0; i < 60; i++) collectCombatEventPresentation({ combat });
const chatCollections = { collections: 60, messages: 400, maxCards: 3, messageContextReads };

let pathMeasurements = 0;
const stationaryToken = {
    movementHistory: Array.from({ length: 101 }, (_, i) => ({ x: i * 100, y: 0, distance: i * 5 })),
    measureMovementPath() { pathMeasurements++; return { distance: 500 }; },
};
const cache = new WeakMap();
for (let i = 0; i < 60; i++) readTokenMovementDistance(stationaryToken, { cache });
const distanceReads = { reads: 60, unchangedWaypoints: 101, pathMeasurements };

console.log(JSON.stringify({
    note: "Synthetic operation counts only; mock renderer and measurement API; no live CPU/GPU/FPS data.",
    sightRefresh, tokenRefresh, recordedMovement, tokenUpdates, chatCollections, distanceReads,
}, null, 2));
