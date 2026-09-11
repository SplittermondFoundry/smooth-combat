import { services } from '../Modul/splittermond-smoother-fight/scripts/core/services.js';
import { registerHooks } from '../Modul/splittermond-smoother-fight/scripts/core/lifecycle.js';
import { syncActiveCombatantTokenSelection } from '../Modul/splittermond-smoother-fight/scripts/features/hud/context.js';
import { scheduleRenderAfterTokenMovement } from '../Modul/splittermond-smoother-fight/scripts/features/hud/visibility.js';
import {
    advancePendingMovements, cancelMovementPlanAfterManualMove, clearMovementRoutePreview,
    clearTemporaryMovementRoutePreview, getAbortableControlledTokenMovement,
    isMovementRoutePreviewPersistent, isMovementRoutePreviewVisible,
    performTrackedMovementAction, syncDefaultMovementRoutePreviews,
} from '../Modul/splittermond-smoother-fight/scripts/features/combat-actions/movement.js';
import { advanceContinuousActions } from '../Modul/splittermond-smoother-fight/scripts/features/combat-actions/continuous-action.js';
import { resetCompletedMovementReversalApplication } from '../Modul/splittermond-smoother-fight/scripts/features/combat-actions/applications.js';
import {
    clearMovementPreviewRefresh, refreshMovementVisibility, scheduleDefaultMovementRoutePreviews,
} from '../Modul/splittermond-smoother-fight/scripts/features/combat-actions/movement-refresh.js';

// Real lifecycle, movement, renderer and DOM; Foundry's document persistence and
// PIXI drawing are replaced by deterministic adapters, with asynchronous motion.
export async function runTurnMovementRegression({ actor, token, target, combat, combatant, user,
    hud, check, frame, turn, counts, holdBuild }) {
    const savedServices = { ...services };
    const savedCanvas = { ...canvas };
    const savedToken = { ...token };
    const savedTick = combat.currentTick, savedInitiative = combatant.initiative;
    const savedHooks = globalThis.Hooks;
    const savedPixi = globalThis.PIXI;
    const originalTargetVisible = target.visible;
    const moduleId = 'splittermond-smoother-fight';
    const hookMap = new Map(), work = new Set();
    globalThis.Hooks = { on(name, fn) { if (!hookMap.has(name)) hookMap.set(name, []); hookMap.get(name).push(fn); } };
    const emit = (name, ...args) => { for (const fn of hookMap.get(name) ?? []) fn(...args); };
    const track = (fn) => (...args) => { const task = fn(...args); work.add(task); task.finally(() => work.delete(task)); return task; };
    const settle = async () => {
        for (let i = 0; i < 4; i++) { await turn(); await Promise.all([...work]); await frame(); await hud.renderTask; }
    };
    let controlled = token, releaseMovement, startedMovement;
    const nextActor = { ...actor, id: 'next-actor', name: 'Next actor' };
    const nextToken = { ...target, id: 'next', uuid: 'Scene.test.Token.next', actor: nextActor, name: 'Next token', movementHistory: [] };
    const nextCombatant = { id: 'next-combatant', actor: nextActor, token: nextToken, initiative: 3 };
    combat.combatants.push(nextCombatant);
    combat.currentTick = 0;
    token.flags = {};
    Object.assign(token, {
        getFlag(scope, key) { return this.flags[scope]?.[key] ?? null; },
        async setFlag(scope, key, value) {
            this.flags[scope] ??= {}; this.flags[scope][key] = structuredClone(value);
            emit('updateToken', this, { flags: { [scope]: { [key]: value } } }, {}, user.id);
            return this;
        },
        async clearMovementHistory() { this.movementHistory = []; emit('recordToken', this); },
        async revertRecordedMovement() { Object.assign(this, this.movementHistory[0]); return true; },
        async move(waypoints, options) {
            const destination = waypoints.at(-1);
            const motion = new Promise(resolve => { releaseMovement = resolve; });
            this.object.movementAnimationPromise = motion;
            emit('updateToken', this, destination, options, user.id);
            startedMovement?.();
            await motion;
            Object.assign(this, destination);
            this.movementHistory = waypoints;
            emit('recordToken', this);
            emit('sightRefresh');
            return true;
        },
    });
    const tokenObjects = [token, nextToken].map(document => ({ document, w: 100, h: 100, children: [],
        control() {
            if (controlled?.object) emit('controlToken', controlled.object, false);
            controlled = document; canvas.tokens.controlled = [this]; emit('controlToken', this, true);
        },
    }));
    tokenObjects.forEach(object => { object.document.object = object; });
    canvas.tokens = { controlled: [token.object], placeables: tokenObjects, get: id => tokenObjects.find(o => o.document.id === id) };
    canvas.interface = new FakeDrawing();
    canvas.stage = { scale: { x: 1 } };
    globalThis.PIXI = { Container: FakeDrawing, Graphics: FakeDrawing, Text: FakeDrawing };
    Object.assign(services, {
        scheduleRenderAfterTokenMovement, syncActiveCombatantTokenSelection,
        advancePendingMovements: track(advancePendingMovements), advanceContinuousActions: track(advanceContinuousActions),
        cancelMovementPlanAfterManualMove, clearTemporaryMovementRoutePreview,
        scheduleDefaultMovementRoutePreviews, refreshMovementVisibility,
        getAbortableControlledTokenMovement, isMovementRoutePreviewVisible, isMovementRoutePreviewPersistent,
        getActivePrimaryGm: () => user, getControlledTokenDocument: () => controlled,
        isTokenPerceivableByUser: () => true,
        scheduleMovementTokenControls() {}, refreshCombatPositionOverlay: async () => {},
        resetCompletedMovementReversalApplication: track(resetCompletedMovementReversalApplication), announceTurnFeedback() {},
        addCombatTicks: async (context, ticks) => { context.combatant.initiative += ticks; return ticks; },
        createTickActionChatCard: async () => ({ id: 'movement-card' }),
    });
    registerHooks();
    try {
        for (const version of ['14.2.7', '14.3.0-beta3']) {
            game.system = { id: 'splittermond', version };
            const label = version + ': automatic turn movement ';
            combat.combatant = combatant; combat.currentTick = combatant.initiative = 0; controlled = token;
            canvas.tokens.controlled = [token.object];
            token.x = 800; token.movementHistory = [{ x: 0, y: 0 }, { x: 800, y: 0 }];
            target.visible = true;
            check(await performTrackedMovementAction({ actor, token, combat, combatant }, { id: 'walk', ticks: 5 }), label + 'plan recorded');
            await token.setFlag(moduleId, 'continuousActionInterruptions', [{
                version: 1, id: 'movement-interruption', actionId: 'walk',
                actionRecordId: token.getFlag(moduleId, 'continuousAction').id,
                combatId: combat.id, combatantId: combatant.id, tokenUuid: token.uuid,
                actorUuid: 'Actor.actor', damage: 3, difficulty: 18,
            }]);
            await settle();
            check(isMovementRoutePreviewVisible(token) && hud.element.querySelector('.sf-selected-movement-control'), label + 'route and abort toolbar shown');
            const before = counts();
            const oldShell = hud.element.querySelector('.sf-shell');
            let releaseBuild;
            holdBuild(new Promise(resolve => { releaseBuild = resolve; }));
            const entered = new Promise(resolve => { startedMovement = resolve; });
            combat.combatant = nextCombatant; combat.currentTick = 3;
            emit('combatTurn', combat);
            await entered;
            // sightRefresh accelerates the scheduled turn build, just as real
            // Foundry does while the automatic route starts animating.
            emit('sightRefresh'); await new Promise(resolve => setTimeout(resolve, 60));
            for (let i = 0; i < 4; i++) { emit('sightRefresh'); await frame(); }
            check(!hud.element.hidden && hud.element.inert && hud.element.querySelector('.sf-shell') === oldShell,
                label + 'pending character handoff stays visible and inert');
            check(counts().fullBuilds === before.fullBuilds + 1, label + 'one character build starts despite animation frames ' + JSON.stringify({ before, current: counts() }));
            const pendingBuild = hud.renderTask;
            target.visible = false; emit('sightRefresh');
            releaseBuild(); await pendingBuild;
            const nextShell = hud.element.querySelector('.sf-shell');
            check(hud.element.dataset.activeActorId === nextActor.id && !hud.element.hidden && !hud.element.inert,
                label + 'new actor mounts atomically and becomes interactive');
            check(!hud.element.querySelector('.sf-primary-target-panel'), label + 'visibility changes during handoff are applied before paint');
            const nextQuick = hud.element.querySelector('.sf-quick-targets'); nextQuick.open = true;
            releaseMovement(); await settle();
            check(token.x === 400 && token.getFlag(moduleId, 'movementPlan').completedFraction === 0.5,
                label + 'first milestone completed');
            check(counts().fullBuilds === before.fullBuilds + 1 && hud.element.querySelector('.sf-shell') === nextShell && nextQuick.open,
                label + 'milestone, history and route progress retain new HUD and open menu');

            // Finish while this character remains active (e.g. a tick jump).
            // Completion must remove the selected plan even after history/sight
            // hooks have fired and after the asynchronous HUD build has started.
            controlled = token; canvas.tokens.controlled = [token.object];
            services.scheduleHudCanvasRefresh(); await frame();
            check(Boolean(hud.element.querySelector('.sf-selected-movement-control')), label + 'selected moving token toolbar appears without rebuilding');
            const finishingEntered = new Promise(resolve => { startedMovement = resolve; });
            combat.currentTick = 5;
            const finishing = advancePendingMovements(combat); await finishingEntered;
            const finishBefore = counts();
            releaseMovement(); await finishing; await settle();
            check(token.x === 800 && token.getFlag(moduleId, 'movementPlan') === null
                && token.getFlag(moduleId, 'continuousAction') === null && token.movementHistory.length === 0
                && token.getFlag(moduleId, 'continuousActionInterruptions').length === 0,
                label + 'final position, action and history complete correctly');
            check(!hud.element.querySelector('.sf-selected-movement-control') && !isMovementRoutePreviewVisible(token),
                label + 'completed movement removes toolbar and route');
            check(counts().fullBuilds === finishBefore.fullBuilds && counts().speedCalls === finishBefore.speedCalls
                && hud.element.querySelector('.sf-shell') === nextShell,
                label + 'completion does not rebuild HUD or recalculate attack speed');
        }
    } finally {
        clearMovementPreviewRefresh(); clearMovementRoutePreview();
        Object.assign(services, savedServices); Object.assign(canvas, savedCanvas);
        for (const key of Object.keys(canvas)) if (!Object.hasOwn(savedCanvas, key)) delete canvas[key];
        for (const key of Object.keys(token)) if (!Object.hasOwn(savedToken, key)) delete token[key];
        Object.assign(token, savedToken);
        globalThis.PIXI = savedPixi;
        globalThis.Hooks = savedHooks;
        combat.combatants.splice(combat.combatants.indexOf(nextCombatant), 1);
        combat.combatant = combatant; target.visible = originalTargetVisible;
        combat.currentTick = savedTick; combatant.initiative = savedInitiative;
    }
}

class FakeDrawing {
    constructor(text) {
        this.text = text; this.children = []; this.width = 80; this.height = 16;
        this.scale = this.position = this.anchor = { set() {} };
    }
    addChild(...children) { children.forEach(child => { child.parent = this; this.children.push(child); }); return children.at(-1); }
    removeChild(child) { this.children = this.children.filter(node => node !== child); child.parent = null; }
    destroy() { this.destroyed = true; }
    on() { return this; }
    lineStyle() { return this; } moveTo() { return this; } lineTo() { return this; }
    beginFill() { return this; } drawCircle() { return this; } drawRoundedRect() { return this; } endFill() { return this; }
}
