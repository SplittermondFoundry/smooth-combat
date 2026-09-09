import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import { registerSettings } from "../Modul/splittermond-smoother-fight/scripts/core/settings.js";
import {
    movementActionMilestones,
    movementDueMilestones,
    movementFractionAtPosition,
    movementInterruptionMilestone,
    movementPathThroughFractions,
    movementTrackerState,
} from "../Modul/splittermond-smoother-fight/scripts/domain/combat/movement.js";
import { revertTokenMovement } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/actions.js";
import {
    abortMovementPlan,
    advancePendingMovements,
    applyRemoteMovementPlanAbort,
    cancelMovementPlanAfterManualMove,
    clearMovementRoutePreview,
    clearTemporaryMovementRoutePreview,
    getAbortableControlledTokenMovement,
    getMovementAbortState,
    isMovementRoutePreviewPersistent,
    isMovementRoutePreviewVisible,
    performTrackedMovementAction,
    renderTokenMovementControl,
    syncDefaultMovementRoutePreviews,
    togglePersistentMovementRoutePreview,
    toggleMovementRoutePreview,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/movement.js";
import {
    clearMovementTokenControls,
    refreshMovementTokenControl,
    refreshMovementTokenControlScale,
    scheduleMovementTokenControls,
    syncMovementTokenControls,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/movement-controls.js";
import {
    finishRemoteMovementPlanAbort,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/movement-abort-requests.js";
import { advanceContinuousActions } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/continuous-action.js";
import {
    clearMovementPreviewRefresh, refreshMovementVisibility, scheduleDefaultMovementRoutePreviews,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/movement-refresh.js";
import {
    movementRoutePreviewModel,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/movement-preview.js";
import {
    buildMovementTracker,
    readTokenMovementDistance,
} from "../Modul/splittermond-smoother-fight/scripts/features/hud/movement.js";

const renderCalls = [];
const movementHarness = {};
configureServices({
    scheduleRender: (...args) => renderCalls.push(args),
    scheduleMovementTokenControls,
    addCombatTicks: (...args) => movementHarness.addCombatTicks(...args),
    createTickActionChatCard: (...args) => movementHarness.createTickActionChatCard(...args),
    getActivePrimaryGm: () => movementHarness.primaryGm,
    getControlledTokenDocument: () => movementHarness.controlledToken,
    getRuntimeController: () => movementHarness.runtimeController,
    isTokenPerceivableByUser: (...args) => movementHarness.isTokenPerceivableByUser?.(...args) ?? true,
    resolveToken: (...args) => movementHarness.resolveToken?.(...args) ?? null,
    highlightToken: (...args) => movementHarness.highlightToken?.(...args),
    clearHoveredToken: (...args) => movementHarness.clearHoveredToken?.(...args),
});

globalThis.game = {
    i18n: {
        lang: "de",
        localize: (key) => key,
        format: (key, data) => `${key}:${JSON.stringify(data)}`,
    },
};

test("movement thresholds offer the matching Splittermond action", () => {
    const cases = [
        { distance: 0, phase: "free", actionId: null, ticks: null, sections: [0, 0, 0] },
        { distance: 2, phase: "free", actionId: null, ticks: null, sections: [100, 0, 0] },
        { distance: 2.01, phase: "walk", actionId: "walk", ticks: 5, sections: [100, 0.125, 0] },
        { distance: 10, phase: "walk", actionId: "walk", ticks: 5, sections: [100, 100, 0] },
        { distance: 10.01, phase: "sprint", actionId: "sprint", ticks: 10, sections: [100, 100, 0.05] },
        { distance: 30, phase: "sprint", actionId: "sprint", ticks: 10, sections: [100, 100, 100] },
        { distance: 31.25, phase: "excess", actionId: "sprint", ticks: 10, sections: [100, 100, 100], excess: 1.25 },
    ];

    for (const expected of cases) {
        const state = movementTrackerState(expected.distance, 10);
        assert.equal(state.phase, expected.phase);
        assert.equal(state.actionId, expected.actionId);
        assert.equal(state.actionTicks, expected.ticks);
        const actualSections = [state.sectionProgress.free, state.sectionProgress.walk, state.sectionProgress.sprint];
        expected.sections.forEach((progress, index) => assert.ok(Math.abs(actualSections[index] - progress) < 0.0001));
        if (expected.excess !== undefined) assert.equal(state.excess, expected.excess);
    }
});

test("movement milestones and route slices follow the GRW timing and measured path", () => {
    assert.deepEqual(movementActionMilestones("crawl", 11), [
        { fraction: 1, tick: 16, tickOffset: 5 },
    ]);
    assert.deepEqual(movementActionMilestones("walk", 11), [
        { fraction: 0.5, tick: 14, tickOffset: 3 },
        { fraction: 1, tick: 16, tickOffset: 5 },
    ]);
    assert.deepEqual(movementActionMilestones("sprint", 11), [
        { fraction: 0.25, tick: 14, tickOffset: 3 },
        { fraction: 0.5, tick: 16, tickOffset: 5 },
        { fraction: 0.75, tick: 18, tickOffset: 7 },
        { fraction: 1, tick: 21, tickOffset: 10 },
    ]);

    const plan = {
        completedFraction: 0.25,
        milestones: movementActionMilestones("sprint", 11),
    };
    assert.deepEqual(
        movementDueMilestones(plan, 18).map(({ fraction }) => fraction),
        [0.5, 0.75],
    );

    const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const sliced = movementPathThroughFractions(route, [10, 30], 0, [0.25, 0.5, 0.75]);
    assert.deepEqual(sliced.map(({ x, y, checkpoint }) => ({ x, y, checkpoint })), [
        { x: 100, y: 0, checkpoint: true },
        { x: 100, y: 33, checkpoint: true },
        { x: 100, y: 67, checkpoint: true },
    ]);
    assert.deepEqual(
        movementPathThroughFractions(route, [10, 30], 0.75, [1]).map(({ x, y }) => ({ x, y })),
        [{ x: 100, y: 100 }],
    );

    const interruptionPlan = {
        startTick: 11,
        milestones: movementActionMilestones("sprint", 11),
    };
    assert.equal(movementInterruptionMilestone(interruptionPlan, 12).fraction, 0);
    assert.equal(movementInterruptionMilestone(interruptionPlan, 13).fraction, 0.25);
    assert.equal(movementInterruptionMilestone(interruptionPlan, 15).fraction, 0.5);
    assert.equal(movementInterruptionMilestone(interruptionPlan, 17).fraction, 0.75);
    assert.equal(movementInterruptionMilestone(interruptionPlan, 19).fraction, 0.75);
    assert.equal(movementInterruptionMilestone(interruptionPlan, 20).fraction, 1);

    assert.equal(movementFractionAtPosition(route, [10, 30], { x: 100, y: 60 }), 0.7);
    assert.equal(movementFractionAtPosition(route, [10, 30], { x: 140, y: 60 }), null);
});

test("movement tracker renders three sections, action buttons, excess, and undo", () => {
    let measuredDistance = 7;
    const movementHistory = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const tokenDocument = {
        movementHistory,
        measureMovementPath: (waypoints) => {
            assert.equal(waypoints, movementHistory);
            return { distance: measuredDistance };
        },
    };
    const context = {
        actor: { derivedValues: { speed: { value: 8 } } },
        token: { document: tokenDocument },
    };
    const walk = buildMovementTracker(context);

    assert.match(walk, /class="sf-movement-tracker is-walk"/u);
    assert.equal((walk.match(/class="sf-movement-section /gu) ?? []).length, 3);
    assert.match(walk, /sf-movement-section-free" style="--sf-movement-fill:100\.000%"/u);
    assert.match(walk, /<button type="button" class="sf-movement-section sf-movement-section-walk sf-movement-section-action" style="--sf-movement-fill:83\.333%"/u);
    assert.match(walk, /sf-movement-section-sprint" style="--sf-movement-fill:0\.000%"/u);
    assert.match(walk, /data-tick-action-id="walk"/u);
    assert.match(walk, /data-tick-action-advance="5"/u);
    assert.match(walk, /class="sf-movement-section-ticks"/u);
    assert.doesNotMatch(walk, /class="sf-movement-action"/u);
    assert.match(walk, /data-sf-action="revert-movement"/u);

    measuredDistance = 25;
    const excess = buildMovementTracker(context);
    assert.match(excess, /class="sf-movement-tracker is-excess"/u);
    assert.match(excess, /<button type="button" class="sf-movement-section sf-movement-section-walk sf-movement-section-action"/u);
    assert.match(excess, /<button type="button" class="sf-movement-section sf-movement-section-sprint sf-movement-section-action"/u);
    assert.equal((excess.match(/data-sf-action="share-tick-action"/gu) ?? []).length, 2);
    assert.match(excess, /data-tick-action-id="walk"[^>]*data-tick-action-advance="5"/u);
    assert.match(excess, /data-tick-action-id="sprint"/u);
    assert.match(excess, /data-tick-action-advance="10"/u);
    assert.match(excess, /SMOOTHER_FIGHT\.HUD\.MovementExcess/u);

    measuredDistance = 2;
    const free = buildMovementTracker(context);
    assert.doesNotMatch(free, /data-tick-action-id=/u);
    assert.match(free, /data-sf-action="revert-movement"/u);
});

test("Foundry v14 waypoint history is measured with the TokenDocument API", () => {
    const movementHistory = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
    const tokenDocument = {
        movementHistory,
        measureMovementPath: (waypoints) => {
            assert.equal(waypoints, movementHistory);
            return { distance: 9 };
        },
    };

    assert.equal(readTokenMovementDistance({ document: tokenDocument }), 9);
});

test("an active Foundry movement includes its already passed path", () => {
    const tokenDocument = {
        movementHistory: [],
        measureMovementPath: () => ({ distance: 0 }),
        movement: {
            recorded: false,
            state: "pending",
            history: { distance: 4 },
            passed: { distance: 3 },
            pending: { distance: 5 },
        },
    };

    assert.equal(readTokenMovementDistance(tokenDocument), 7);
});

test("a completed undo ignores stale passed movement after history was cleared", () => {
    const tokenDocument = {
        movementHistory: [],
        measureMovementPath: () => ({ distance: 0 }),
        movement: {
            method: "undo",
            recorded: false,
            state: "completed",
            history: { distance: 0 },
            passed: { distance: 4 },
            pending: { distance: 0 },
        },
    };

    assert.equal(readTokenMovementDistance(tokenDocument), 0);
});

test("undo delegates position and history reset to Foundry", async () => {
    const calls = [];
    const token = {
        revertRecordedMovement: async () => {
            calls.push("revert");
            return true;
        },
        clearMovementHistory: async () => calls.push("clear"),
    };
    renderCalls.length = 0;

    assert.equal(await revertTokenMovement({ token: { document: token } }), true);
    assert.deepEqual(calls, ["revert", "clear"]);
    assert.deepEqual(renderCalls, [[0]]);
});

test("a failed Foundry movement revert does not clear history", async () => {
    let cleared = false;
    const token = {
        revertRecordedMovement: async () => false,
        clearMovementHistory: async () => cleared = true,
    };
    renderCalls.length = 0;

    assert.equal(await revertTokenMovement({ token }), false);
    assert.equal(cleared, false);
    assert.deepEqual(renderCalls, []);
});

test("walking stores the selected route, returns to the start, and advances at ticks 3 and 5", async () => {
    const fixture = scheduledMovementFixture("walk");

    assert.equal(await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 }), true);
    assert.equal(fixture.token.x, 0);
    assert.equal(fixture.combatant.initiative, 6);
    assert.equal(fixture.token.getFlag("splittermond-smoother-fight", "continuousAction").completionTrigger, "movement");
    assert.deepEqual(fixture.plan().milestones.map(({ tick, fraction }) => ({ tick, fraction })), [
        { tick: 4, fraction: 0.5 },
        { tick: 6, fraction: 1 },
    ]);
    assert.equal(fixture.chatCards[0].options.movementDistance, 10);

    fixture.combat.currentTick = 4;
    assert.equal(await advancePendingMovements(fixture.combat), true);
    assert.equal(fixture.token.x, 50);
    assert.equal(fixture.plan().completedFraction, 0.5);
    assert.equal(fixture.token.getFlag("splittermond-smoother-fight", "continuousAction").actionId, "walk");

    fixture.combat.currentTick = 6;
    assert.equal(await advancePendingMovements(fixture.combat), true);
    assert.equal(fixture.token.x, 100);
    assert.equal(fixture.plan(), null);
    assert.equal(fixture.token.getFlag("splittermond-smoother-fight", "continuousAction"), null);
    assert.deepEqual(fixture.moveCalls.map((call) => call.waypoints.at(-1).x), [50, 100]);
});

test("crawling remains continuous until its route target at tick 5", async () => {
    const fixture = scheduledMovementFixture("crawl");

    assert.equal(await performTrackedMovementAction(fixture.context, { id: "crawl", ticks: 5 }), true);
    assert.deepEqual(fixture.plan().milestones, [
        { fraction: 1, tick: 6, tickOffset: 5 },
    ]);
    assert.equal(fixture.chatCards[0].options.movementDistance, 1);
    assert.equal(fixture.token.getFlag("splittermond-smoother-fight", "continuousAction").completionTrigger, "movement");

    fixture.combat.currentTick = 5;
    assert.equal(await advancePendingMovements(fixture.combat), false);
    assert.equal(fixture.token.x, 0);
    assert.notEqual(fixture.plan(), null);

    fixture.combat.currentTick = 6;
    assert.equal(await advancePendingMovements(fixture.combat), true);
    assert.equal(fixture.token.x, 100);
    assert.equal(fixture.plan(), null);
    assert.equal(fixture.token.getFlag("splittermond-smoother-fight", "continuousAction"), null);
});

test("an overlong crawl route is rejected before moving, storing a plan, or charging ticks", async () => {
    for (const distance of [1.01, 3, 10]) {
        const fixture = scheduledMovementFixture("crawl", { movementDistance: distance });
        const warnings = [];
        ui.notifications.warn = (message) => warnings.push(message);
        const history = structuredClone(fixture.token.movementHistory);
        assert.equal(await performTrackedMovementAction(fixture.context, { id: "crawl", ticks: 5 }), false);
        assert.equal(fixture.combatant.initiative, 1);
        assert.equal(fixture.token.x, 100);
        assert.deepEqual(fixture.token.movementHistory, history);
        assert.equal(fixture.plan(), null);
        assert.equal(fixture.chatCards.length, 0);
        assert.equal(fixture.moveCalls.length, 0);
        assert.match(warnings[0], /MovementCrawlTooFar/u);
    }
});

test("a prone actor cannot book a normal walking or sprint route from a stale action menu", async () => {
    for (const id of ["walk", "sprint"]) {
        const fixture = scheduledMovementFixture(id);
        fixture.token.actor.items = [{ type: "statuseffect", name: "Liegend", system: { level: 1 } }];
        assert.equal(await performTrackedMovementAction(fixture.context, { id, ticks: 5 }), false);
        assert.equal(fixture.combatant.initiative, 1);
        assert.equal(fixture.token.x, 100);
        assert.equal(fixture.plan(), null);
        assert.equal(fixture.chatCards.length, 0);
    }
});

test("a sprint tick jump visibly traverses every crossed quarter milestone", async () => {
    const fixture = scheduledMovementFixture("sprint");
    await performTrackedMovementAction(fixture.context, { id: "sprint", ticks: 10 });

    fixture.combat.currentTick = 8;
    assert.equal(await advancePendingMovements(fixture.combat), true);
    assert.deepEqual(
        fixture.moveCalls[0].waypoints.map(({ x, checkpoint }) => ({ x, checkpoint })),
        [
            { x: 25, checkpoint: true },
            { x: 50, checkpoint: true },
            { x: 75, checkpoint: true },
        ],
    );
    assert.equal(fixture.plan().completedFraction, 0.75);

    assert.equal(await cancelMovementPlanAfterManualMove(fixture.token, {}, fixture.primaryGm.id), true);
    assert.equal(fixture.plan(), null);
});

test("the selected token HUD aborts movement at the nearest segment and resolves ties upward", async () => {
    const fixture = scheduledMovementFixture("sprint");
    await performTrackedMovementAction(fixture.context, { id: "sprint", ticks: 10 });
    fixture.combat.currentTick = 5;
    fixture.token.actor = { isOwner: true };
    movementHarness.runtimeController = fixture.primaryGm;

    const originalHTMLElement = globalThis.HTMLElement;
    const originalDocument = globalThis.document;
    const originalUser = globalThis.game.user;
    class FakeElement {
        constructor() {
            this.attributes = new Map();
            this.children = [];
            this.dataset = {};
            this.listeners = new Map();
            this.removed = false;
        }

        querySelector(selector) {
            if (selector === ".col.right") return this.column ?? null;
            return null;
        }

        append(child) {
            this.children.push(child);
        }

        addEventListener(name, listener) {
            this.listeners.set(name, listener);
        }

        setAttribute(name, value) {
            this.attributes.set(name, value);
        }

        getAttribute(name) {
            return this.attributes.get(name) ?? null;
        }

        removeAttribute(name) {
            this.attributes.delete(name);
        }

        remove() {
            this.removed = true;
        }
    }

    try {
        globalThis.game.user = fixture.primaryGm;
        globalThis.HTMLElement = FakeElement;
        globalThis.document = { createElement: () => new FakeElement() };
        const root = new FakeElement();
        root.column = new FakeElement();
        renderTokenMovementControl({ object: fixture.token }, root);
        const control = root.column.children[0];
        assert.equal(control.dataset.tooltip, "SMOOTHER_FIGHT.HUD.AbortMovement");

        await control.listeners.get("click")({ preventDefault() {}, stopPropagation() {} });
        assert.equal(control.removed, true);
        assert.deepEqual(
            fixture.moveCalls[0].waypoints.map(({ x, checkpoint }) => ({ x, checkpoint })),
            [
                { x: 25, checkpoint: true },
                { x: 50, checkpoint: true },
            ],
        );
        assert.equal(fixture.token.x, 50);
        assert.equal(fixture.plan(), null);
        assert.equal(fixture.combatant.initiative, 11);
    } finally {
        globalThis.game.user = originalUser;
        globalThis.HTMLElement = originalHTMLElement;
        globalThis.document = originalDocument;
        movementHarness.runtimeController = null;
    }
});

test("a controlled token with a current movement plan is exposed to the combat HUD", async () => {
    const fixture = scheduledMovementFixture("walk");
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });
    movementHarness.controlledToken = fixture.token;

    try {
        assert.equal(getAbortableControlledTokenMovement(fixture.combat), fixture.token);
        assert.equal(await abortMovementPlan(fixture.token, fixture.combat), true);
        assert.equal(getAbortableControlledTokenMovement(fixture.combat), null);
    } finally {
        movementHarness.controlledToken = null;
    }
});

test("the saved route preview includes every movement milestone and toggles cleanly", async (t) => {
    const fixture = scheduledMovementFixture("sprint");
    await performTrackedMovementAction(fixture.context, { id: "sprint", ticks: 10 });
    fixture.token.width = 1;
    fixture.token.height = 1;
    const model = movementRoutePreviewModel(fixture.token, fixture.plan(), 100);

    assert.deepEqual(model.points, [{ x: 50, y: 50 }, { x: 150, y: 50 }]);
    assert.equal(model.tokenName, "Arrou");
    assert.deepEqual(model.milestones.map(({ fractionLabel, point, tick, tickOffset }) => ({ fractionLabel, point, tick, tickOffset })), [
        { fractionLabel: "¼", point: { x: 75, y: 50 }, tick: 4, tickOffset: 3 },
        { fractionLabel: "½", point: { x: 100, y: 50 }, tick: 6, tickOffset: 5 },
        { fractionLabel: "¾", point: { x: 125, y: 50 }, tick: 8, tickOffset: 7 },
        { fractionLabel: "SMOOTHER_FIGHT.HUD.MovementRouteDestination", point: { x: 150, y: 50 }, tick: 11, tickOffset: 10 },
    ]);

    const originalCanvas = globalThis.canvas;
    const originalPixi = globalThis.PIXI;
    const canvasInterface = new FakePixiContainer();
    globalThis.canvas = { grid: { size: 100 }, interface: canvasInterface, stage: { scale: { x: 0.5 } } };
    globalThis.PIXI = {
        Container: FakePixiContainer,
        Graphics: FakePixiGraphics,
        Text: FakePixiText,
    };
    t.after(() => {
        clearMovementRoutePreview();
        globalThis.canvas = originalCanvas;
        globalThis.PIXI = originalPixi;
    });

    assert.equal(toggleMovementRoutePreview(fixture.token, fixture.combat), true);
    assert.equal(isMovementRoutePreviewVisible(fixture.token), true);
    assert.equal(canvasInterface.children.length, 1);
    const preview = canvasInterface.children[0];
    const markers = preview.children.filter((child) => (
        child instanceof FakePixiContainer && !(child instanceof FakePixiGraphics)
    ));
    assert.equal(markers.length, 5);
    assert.ok(markers.every((marker) => marker.scale.value === 2), "labels retain their screen size at 50% zoom");
    assert.ok(markers.every((marker) => marker.children.some((child) => (
        child.children?.some((nested) => nested instanceof FakePixiGraphics
            && nested.operations.includes("drawRoundedRect"))
    ))), "each label receives a high-contrast background");
    assert.ok(markers.every((marker) => marker.children.some((child) => (
        child.children?.some((nested) => nested instanceof FakePixiText
            && nested.style.fontSize === 15)
    ))), "route labels use the reduced base font size");
    assert.ok(markers.every((marker) => marker.children.some((child) => (
        child.name?.endsWith("movement-route-label") && child.scale.value === 0.72
    ))), "route labels stay compact until hovered");
    assert.equal(markers.flatMap((marker) => marker.children)
        .filter((child) => child.name?.endsWith("movement-route-label") && child.visible).length, 1,
    "only the next pending checkpoint is labelled while compact");

    await fixture.token.setFlag("splittermond-smoother-fight", "movementPlan", {
        ...fixture.plan(),
        completedFraction: 0.25,
    });
    assert.equal(syncDefaultMovementRoutePreviews(fixture.combat), true);
    const progressedVisibleLabels = canvasInterface.children[0].children
        .flatMap((child) => child.children ?? [])
        .filter((child) => child.name?.endsWith("movement-route-label") && child.visible)
        .flatMap((child) => child.children)
        .filter((child) => child instanceof FakePixiText)
        .map((child) => child.text);
    assert.equal(progressedVisibleLabels.length, 1);
    assert.ok(progressedVisibleLabels[0].includes('"fraction":"½"'), "the label advances to the next pending checkpoint");

    assert.equal(toggleMovementRoutePreview(fixture.token, fixture.combat), false);
    assert.equal(isMovementRoutePreviewVisible(fixture.token), false);
    assert.equal(canvasInterface.children.length, 0);

    assert.equal(togglePersistentMovementRoutePreview(fixture.token, fixture.combat), true);
    assert.equal(isMovementRoutePreviewPersistent(fixture.token), true);
    assert.equal(clearTemporaryMovementRoutePreview(fixture.token), false, "deselection preserves a pinned preview");
    assert.equal(isMovementRoutePreviewVisible(fixture.token), true);
    assert.equal(togglePersistentMovementRoutePreview(fixture.token, fixture.combat), false);
    assert.equal(isMovementRoutePreviewVisible(fixture.token), false);
});

test("route labels round floating-point ticks to whole numbers", async () => {
    const fixture = scheduledMovementFixture("sprint");
    await performTrackedMovementAction(fixture.context, { id: "sprint", ticks: 10 });
    const plan = fixture.plan();
    plan.startTick = 76.02000000000001;
    plan.milestones[0].tick = 79.02000000000001;
    plan.milestones[0].tickOffset = 3.000000000000001;

    const model = movementRoutePreviewModel(fixture.token, plan, 100);
    assert.equal(model.start.tick, 76);
    assert.equal(model.milestones[0].tick, 79);
    assert.equal(model.milestones[0].tickOffset, 3);
});

test("planned routes are public by default and the world option restricts them to the responsible player and GM", async (t) => {
    const fixture = scheduledMovementFixture("walk");
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });

    const originalCanvas = globalThis.canvas;
    const originalPixi = globalThis.PIXI;
    const originalSettings = globalThis.game.settings;
    const originalUser = globalThis.game.user;
    const canvasInterface = new FakePixiContainer();
    const player = { id: "player", isGM: false };
    let privateMovementRoutes = false;
    globalThis.canvas = { grid: { size: 100 }, interface: canvasInterface, stage: { scale: { x: 1 } } };
    globalThis.PIXI = {
        Container: FakePixiContainer,
        Graphics: FakePixiGraphics,
        Text: FakePixiText,
    };
    globalThis.game.settings = {
        get: (_moduleId, key) => {
            if (key === "showMovementRoutesByDefault") return true;
            if (key === "privateMovementRoutes") return privateMovementRoutes;
            return false;
        },
    };
    globalThis.game.user = player;
    fixture.token.actor = { isOwner: false };
    movementHarness.runtimeController = { id: "another-player", isGM: false };
    movementHarness.isTokenPerceivableByUser = () => true;
    t.after(() => {
        clearMovementRoutePreview();
        globalThis.canvas = originalCanvas;
        globalThis.PIXI = originalPixi;
        globalThis.game.settings = originalSettings;
        globalThis.game.user = originalUser;
        movementHarness.runtimeController = null;
        movementHarness.isTokenPerceivableByUser = null;
    });

    assert.equal(syncDefaultMovementRoutePreviews(fixture.combat, { reconsider: true }), true);
    assert.equal(isMovementRoutePreviewVisible(fixture.token), true, "an unrelated player sees the route by default");

    movementHarness.isTokenPerceivableByUser = () => false;
    assert.equal(syncDefaultMovementRoutePreviews(fixture.combat, { reconsider: true }), true);
    assert.equal(isMovementRoutePreviewVisible(fixture.token), false, "a route does not reveal an imperceptible token");
    movementHarness.isTokenPerceivableByUser = () => true;
    assert.equal(syncDefaultMovementRoutePreviews(fixture.combat, { reconsider: true }), true);

    privateMovementRoutes = true;
    assert.equal(syncDefaultMovementRoutePreviews(fixture.combat, { reconsider: true }), true);
    assert.equal(isMovementRoutePreviewVisible(fixture.token), false, "the private world option removes a foreign route");

    fixture.token.actor.isOwner = true;
    movementHarness.runtimeController = player;
    assert.equal(syncDefaultMovementRoutePreviews(fixture.combat, { reconsider: true }), true);
    assert.equal(isMovementRoutePreviewVisible(fixture.token), true, "the responsible player retains the private route");

    clearMovementRoutePreview(fixture.token);
    fixture.token.actor.isOwner = false;
    globalThis.game.user = fixture.primaryGm;
    assert.equal(syncDefaultMovementRoutePreviews(fixture.combat, { reconsider: true }), true);
    assert.equal(isMovementRoutePreviewVisible(fixture.token), true, "the GM retains the private route");
});

test("multiple default route previews coexist, identify their tokens, and highlight on hover", async (t) => {
    const first = scheduledMovementFixture("walk", {
        combatId: "combat-multi",
        combatantId: "combatant-1",
        tokenId: "token-1",
        tokenName: "Arrou",
    });
    await performTrackedMovementAction(first.context, { id: "walk", ticks: 5 });
    const second = scheduledMovementFixture("sprint", {
        combatId: "combat-multi",
        combatantId: "combatant-2",
        tokenId: "token-2",
        tokenName: "Grabbeißer",
    });
    await performTrackedMovementAction(second.context, { id: "sprint", ticks: 10 });
    const combat = {
        id: "combat-multi",
        combatants: [first.combatant, second.combatant],
    };

    const originalCanvas = globalThis.canvas;
    const originalPixi = globalThis.PIXI;
    const originalSettings = globalThis.game.settings;
    const canvasInterface = new FakePixiContainer();
    const highlighted = [];
    let clearedHighlights = 0;
    globalThis.canvas = { grid: { size: 100 }, interface: canvasInterface, stage: { scale: { x: 1 } } };
    globalThis.PIXI = {
        Container: FakePixiContainer,
        Graphics: FakePixiGraphics,
        Text: FakePixiText,
    };
    globalThis.game.settings = { get: (_moduleId, key) => key === "showMovementRoutesByDefault" };
    movementHarness.highlightToken = (reference) => highlighted.push(reference);
    movementHarness.clearHoveredToken = () => clearedHighlights += 1;
    t.after(() => {
        clearMovementRoutePreview();
        globalThis.canvas = originalCanvas;
        globalThis.PIXI = originalPixi;
        globalThis.game.settings = originalSettings;
        movementHarness.highlightToken = null;
        movementHarness.clearHoveredToken = null;
    });

    assert.equal(syncDefaultMovementRoutePreviews(combat, { reconsider: true }), true);
    assert.equal(canvasInterface.children.length, 2);
    assert.equal(isMovementRoutePreviewPersistent(first.token), true);
    assert.equal(isMovementRoutePreviewPersistent(second.token), true);

    const startLabels = canvasInterface.children.map((preview) => (
        preview.children
            .flatMap((child) => child.children ?? [])
            .flatMap((child) => child.children ?? [])
            .find((child) => child instanceof FakePixiText)?.text
    ));
    assert.ok(startLabels.some((label) => label?.includes('"token":"Arrou"')));
    assert.ok(startLabels.some((label) => label?.includes('"token":"Grabbeißer"')));

    const firstPreview = canvasInterface.children[0];
    const firstHighlight = firstPreview.children[2];
    const firstHitArea = firstPreview.children[3];
    firstHitArea.listeners.get("pointerenter")();
    assert.equal(firstHighlight.visible, true);
    assert.equal(firstPreview.zIndex, 2000);
    assert.deepEqual(highlighted, [first.token.uuid]);
    assert.ok(firstPreview.children
        .flatMap((child) => child.children ?? [])
        .filter((child) => child.name?.endsWith("movement-route-label"))
        .every((label) => label.scale.value === 1));
    assert.ok(firstPreview.children
        .flatMap((child) => child.children ?? [])
        .filter((child) => child.name?.endsWith("movement-route-label"))
        .every((label) => label.visible));
    firstHitArea.listeners.get("pointerleave")();
    assert.equal(firstHighlight.visible, false);
    assert.equal(firstPreview.zIndex, 1000);
    assert.equal(clearedHighlights, 1);
    assert.ok(firstPreview.children
        .flatMap((child) => child.children ?? [])
        .filter((child) => child.name?.endsWith("movement-route-label"))
        .every((label) => label.scale.value === 0.72));
    assert.equal(firstPreview.children
        .flatMap((child) => child.children ?? [])
        .filter((child) => child.name?.endsWith("movement-route-label") && child.visible).length, 1);

    assert.equal(togglePersistentMovementRoutePreview(first.token, combat), false);
    assert.equal(canvasInterface.children.length, 1);
    assert.equal(syncDefaultMovementRoutePreviews(combat), false, "a manually hidden route stays hidden for this plan");
    assert.equal(canvasInterface.children.length, 1);

    clearMovementRoutePreview();
    assert.equal(syncDefaultMovementRoutePreviews(combat), true, "canvas recreation restores only routes that were not hidden");
    assert.equal(canvasInterface.children.length, 1);
    assert.equal(isMovementRoutePreviewVisible(first.token), false);
    assert.equal(isMovementRoutePreviewVisible(second.token), true);

    await second.token.unsetFlag("splittermond-smoother-fight", "movementPlan");
    assert.equal(syncDefaultMovementRoutePreviews(combat), true, "a completed plan removes its route");
    assert.equal(canvasInterface.children.length, 0);
});

test("movement timing rounds both initiative ordering directions, including saved abort checkpoints", () => {
    for (const offset of [-0.02, 0.02]) {
        assert.deepEqual(movementActionMilestones("walk", 1 + offset).map(({ tick }) => tick), [4, 6]);
        const plan = {
            startTick: 1 + offset,
            completedFraction: 0.5,
            milestones: [
                { tick: 4 + offset, tickOffset: 3, fraction: 0.5 },
                { tick: 6 + offset, tickOffset: 5, fraction: 1 },
            ],
        };
        assert.equal(movementDueMilestones(plan, 5).length, 0);
        assert.deepEqual(movementDueMilestones(plan, 6).map(({ fraction }) => fraction), [1]);
        assert.deepEqual(movementInterruptionMilestone(plan, 5), { tick: 6, tickOffset: 5, fraction: 1 });
    }
});

test("same-tick initiative ordering does not delay movement checkpoints or completion", async () => {
    for (const [actionId, ticks] of [["crawl", 5], ["walk", 5], ["sprint", 10]]) {
        const fixture = scheduledMovementFixture(actionId);
        fixture.combatant.initiative = 1.01;
        await performTrackedMovementAction(fixture.context, { id: actionId, ticks });

        for (const milestone of movementActionMilestones(actionId, 1)) {
            fixture.combat.currentTick = milestone.tick;
            assert.equal(await advancePendingMovements(fixture.combat), true, `${actionId} at tick ${milestone.tick}`);
            assert.equal(fixture.token.x, 100 * milestone.fraction);
        }
        assert.equal(fixture.plan(), null);
        assert.equal(fixture.token.getFlag("splittermond-smoother-fight", "continuousAction"), null);
    }
});

test("saved movement plans with fractional initiatives finish together on the displayed final tick", async () => {
    const first = scheduledMovementFixture("walk", { tokenId: "first", combatantId: "first" });
    await performTrackedMovementAction(first.context, { id: "walk", ticks: 5 });
    const second = scheduledMovementFixture("walk", { tokenId: "second", combatantId: "second" });
    await performTrackedMovementAction(second.context, { id: "walk", ticks: 5 });
    const stored = second.plan();
    stored.startTick += 0.01;
    stored.milestones = stored.milestones.map((milestone) => ({ ...milestone, tick: milestone.tick + 0.01 }));
    await second.token.setFlag("splittermond-smoother-fight", "movementPlan", stored);
    first.combat.combatants.push(second.combatant);
    first.combat.currentTick = 6;

    assert.equal(await advancePendingMovements(first.combat), true);
    for (const fixture of [first, second]) {
        assert.equal(fixture.token.x, 100, fixture.token.id);
        assert.equal(fixture.plan(), null);
        assert.equal(fixture.token.getFlag("splittermond-smoother-fight", "continuousAction"), null);
    }
});

test("movement completion waits for a concurrent continuous-action status update", async () => {
    const fixture = scheduledMovementFixture("walk");
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });
    const entered = Promise.withResolvers();
    const gate = Promise.withResolvers();
    fixture.token.actor.createEmbeddedDocuments = async () => {
        entered.resolve();
        await gate.promise;
        return [];
    };
    const synchronization = advanceContinuousActions(fixture.combat);
    await entered.promise;
    fixture.combat.currentTick = 6;
    const movement = advancePendingMovements(fixture.combat);
    // Let the animation and its completion reach the occupied status lock.
    await new Promise((resolve) => setImmediate(resolve));
    gate.resolve();
    await Promise.all([synchronization, movement]);

    assert.equal(fixture.token.x, 100);
    assert.equal(fixture.plan(), null);
    assert.equal(fixture.token.getFlag("splittermond-smoother-fight", "continuousAction"), null);
});

test("a failing token does not prevent another token from reaching its final movement position", async () => {
    const first = scheduledMovementFixture("walk", { tokenId: "first", combatantId: "first" });
    await performTrackedMovementAction(first.context, { id: "walk", ticks: 5 });
    const second = scheduledMovementFixture("walk", { tokenId: "second", combatantId: "second" });
    await performTrackedMovementAction(second.context, { id: "walk", ticks: 5 });
    first.combat.combatants.push(second.combatant);
    first.combat.currentTick = 6;
    first.token.rejectContinuousActionClear = true;

    await assert.rejects(advancePendingMovements(first.combat), /Could not persist required continuousAction/u);
    assert.equal(second.token.x, 100);
    assert.equal(second.plan(), null);
    assert.notEqual(first.plan(), null, "the failed token keeps its retry state");
    first.token.rejectContinuousActionClear = false;
    assert.equal(await advancePendingMovements(first.combat), true);
    assert.equal(first.plan(), null);
    assert.equal(second.moveCalls.length, 1, "the completed token is not moved twice");
});

test("movement progression rechecks ticks crossed during an active animation", async () => {
    let releaseFirstMove;
    let markFirstMoveStarted;
    let moveIndex = 0;
    const firstMoveStarted = new Promise((resolve) => markFirstMoveStarted = resolve);
    const firstMoveGate = new Promise((resolve) => releaseFirstMove = resolve);
    const fixture = scheduledMovementFixture("sprint", {
        beforeMove: async () => {
            moveIndex += 1;
            if (moveIndex !== 1) return;
            markFirstMoveStarted();
            await firstMoveGate;
        },
    });
    await performTrackedMovementAction(fixture.context, { id: "sprint", ticks: 10 });

    fixture.combat.currentTick = 4;
    const firstProgress = advancePendingMovements(fixture.combat);
    await firstMoveStarted;
    fixture.combat.currentTick = 11;
    const finalProgress = advancePendingMovements(fixture.combat);
    releaseFirstMove();

    assert.deepEqual(await Promise.all([firstProgress, finalProgress]), [true, true]);
    assert.equal(fixture.token.x, 100);
    assert.equal(fixture.plan(), null);
    assert.deepEqual(fixture.moveCalls.map((call) => call.waypoints.map(({ x }) => x)), [
        [25],
        [50, 75, 100],
    ]);
});

test("unmarked internal updates from a multi-waypoint Foundry move do not cancel its movement plan", async () => {
    let fixture;
    let internalCancellation;
    fixture = scheduledMovementFixture("sprint", {
        beforeMove: async (waypoints) => {
            assert.deepEqual(waypoints.map(({ x }) => x), [25, 50, 75]);
            internalCancellation = cancelMovementPlanAfterManualMove(
                fixture.token,
                {},
                fixture.primaryGm.id,
            );
            assert.equal(await internalCancellation, false);
        },
    });
    await performTrackedMovementAction(fixture.context, { id: "sprint", ticks: 10 });

    fixture.combat.currentTick = 8;
    assert.equal(await advancePendingMovements(fixture.combat), true);
    assert.equal(await internalCancellation, false);
    assert.equal(fixture.token.x, 75);
    assert.equal(fixture.plan().completedFraction, 0.75);
    assert.equal(
        fixture.token.getFlag("splittermond-smoother-fight", "continuousAction").actionId,
        "sprint",
    );
});

test("a stopped final movement remains pending until the token actually reaches its destination", async () => {
    const fixture = scheduledMovementFixture("walk", {
        moveResults: [true, false, true],
    });
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });

    fixture.combat.currentTick = 4;
    assert.equal(await advancePendingMovements(fixture.combat), true);
    assert.equal(fixture.token.x, 50);
    assert.equal(fixture.plan().completedFraction, 0.5);

    fixture.combat.currentTick = 6;
    assert.equal(await advancePendingMovements(fixture.combat), false);
    assert.equal(fixture.token.x, 50);
    assert.equal(fixture.plan().completedFraction, 0.5);
    assert.equal(
        fixture.token.getFlag("splittermond-smoother-fight", "continuousAction").actionId,
        "walk",
        "the action must not complete before the destination is reached"
    );

    assert.equal(await advancePendingMovements(fixture.combat), true);
    assert.equal(fixture.token.x, 100);
    assert.equal(fixture.plan(), null);
    assert.equal(fixture.token.getFlag("splittermond-smoother-fight", "continuousAction"), null);
});

test("the destination position completes movement even when Foundry reports a stopped move", async () => {
    const fixture = scheduledMovementFixture("walk", {
        moveResults: [true, { completed: false, reachesDestination: true }],
    });
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });

    fixture.combat.currentTick = 4;
    assert.equal(await advancePendingMovements(fixture.combat), true);
    assert.equal(fixture.token.x, 50);

    fixture.combat.currentTick = 6;
    assert.equal(await advancePendingMovements(fixture.combat), true);
    assert.equal(fixture.token.x, 100);
    assert.equal(fixture.plan(), null);
    assert.equal(fixture.token.getFlag("splittermond-smoother-fight", "continuousAction"), null);
});

test("Foundry-confirmed movement accepts a grid-adjusted milestone outside the route projection tolerance", async () => {
    const fixture = scheduledMovementFixture("walk", {
        moveResults: [{ completed: true, position: { x: 50, y: 2, elevation: 0 } }],
    });
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });

    fixture.combat.currentTick = 4;
    assert.equal(await advancePendingMovements(fixture.combat), true);
    assert.equal(fixture.token.x, 50);
    assert.equal(fixture.token.y, 2);
    assert.equal(fixture.plan().completedFraction, 0.5);
    assert.equal(
        fixture.token.getFlag("splittermond-smoother-fight", "continuousAction").actionId,
        "walk",
    );
});

test("a partially stopped movement resumes from its actual route position without backtracking", async () => {
    const fixture = scheduledMovementFixture("sprint", {
        moveResults: [{ completed: false, position: { x: 50, y: 0, elevation: 0 } }, true],
    });
    await performTrackedMovementAction(fixture.context, { id: "sprint", ticks: 10 });

    fixture.combat.currentTick = 8;
    assert.equal(await advancePendingMovements(fixture.combat), true);
    assert.equal(fixture.token.x, 50);
    assert.equal(fixture.plan().completedFraction, 0.5);

    assert.equal(await advancePendingMovements(fixture.combat), true);
    assert.equal(fixture.token.x, 75);
    assert.equal(fixture.plan().completedFraction, 0.75);
    assert.deepEqual(fixture.moveCalls.map(({ waypoints }) => waypoints.map(({ x }) => x)), [
        [25, 50, 75],
        [75],
    ]);
});

test("aborting uses the reached route position even when Foundry reports a stopped move", async () => {
    const fixture = scheduledMovementFixture("walk", {
        moveResults: [{ completed: false, reachesDestination: true }],
    });
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });
    fixture.combat.currentTick = 4;

    assert.equal(await abortMovementPlan(fixture.token, fixture.combat), true);
    assert.equal(fixture.token.x, 50);
    assert.equal(fixture.plan(), null);
    assert.equal(fixture.token.getFlag("splittermond-smoother-fight", "continuousAction"), null);
});

test("a player-owned abort is serialized through the primary GM", async () => {
    const fixture = scheduledMovementFixture("walk");
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });
    fixture.combat.currentTick = 4;
    const player = { id: "player", isGM: false };
    fixture.token.actor.isOwner = true;
    fixture.token.actor.testUserPermission = (user, permission) => (
        user.id === player.id && permission === "OWNER"
    );
    movementHarness.runtimeController = player;
    movementHarness.resolveToken = (reference) => reference === fixture.token.uuid ? fixture.token : null;
    let requestPayload;
    fixture.combat.currentTick = 4;
    globalThis.game.socket = { emit: (_channel, payload) => requestPayload = payload };

    try {
        globalThis.game.user = player;
        const requested = abortMovementPlan(fixture.token, fixture.combat);
        assert.equal(requestPayload.type, "movement-plan-abort-request");
        assert.notEqual(fixture.plan(), null, "the player does not mutate the plan directly");

        globalThis.game.user = fixture.primaryGm;
        const result = await applyRemoteMovementPlanAbort(requestPayload, player);
        assert.equal(result.applied, true);
        assert.equal(fixture.plan(), null);

        globalThis.game.user = player;
        assert.equal(finishRemoteMovementPlanAbort({
            ...requestPayload,
            type: "movement-plan-abort-result",
            ...result,
        }, fixture.primaryGm), true);
        assert.equal(await requested, true);
    } finally {
        globalThis.game.user = fixture.primaryGm;
        delete globalThis.game.socket;
        movementHarness.runtimeController = null;
        movementHarness.resolveToken = null;
    }
});

test("a rejected continuous-action clear retains the plan for a safe completion retry", async () => {
    const fixture = scheduledMovementFixture("walk");
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });
    fixture.combat.currentTick = 4;
    await advancePendingMovements(fixture.combat);

    fixture.token.rejectContinuousActionClear = true;
    fixture.combat.currentTick = 6;
    await assert.rejects(advancePendingMovements(fixture.combat), /Could not persist required continuousAction/u);
    assert.equal(fixture.token.x, 100);
    assert.notEqual(fixture.plan(), null, "the plan remains as the durable retry marker");
    assert.notEqual(fixture.token.getFlag("splittermond-smoother-fight", "continuousAction"), null);

    fixture.token.rejectContinuousActionClear = false;
    assert.equal(await advancePendingMovements(fixture.combat), true);
    assert.equal(fixture.plan(), null);
    assert.equal(fixture.token.getFlag("splittermond-smoother-fight", "continuousAction"), null);
    assert.equal(fixture.moveCalls.length, 2, "retrying at the destination does not move the token again");
});

test("a missing movement chat card does not report the already committed action as failed", async () => {
    const fixture = scheduledMovementFixture("walk", { chatCardResult: false });

    assert.equal(await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 }), true);
    assert.equal(fixture.combatant.initiative, 6);
    assert.notEqual(fixture.plan(), null);
});

test("manual movement cancellation waits for an authoritative milestone update", async () => {
    let releaseMove;
    let markMoveStarted;
    const moveStarted = new Promise((resolve) => markMoveStarted = resolve);
    const moveGate = new Promise((resolve) => releaseMove = resolve);
    const fixture = scheduledMovementFixture("walk", {
        beforeMove: async () => {
            markMoveStarted();
            await moveGate;
        },
    });
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });
    fixture.combat.currentTick = 4;

    const progress = advancePendingMovements(fixture.combat);
    await moveStarted;
    const cancellation = cancelMovementPlanAfterManualMove(fixture.token, {}, "player");
    releaseMove();

    assert.equal(await progress, true);
    assert.equal(await cancellation, true);
    assert.equal(fixture.plan(), null);
    assert.equal(fixture.token.getFlag("splittermond-smoother-fight", "continuousAction"), null);
});

test("aborting at every movement tick uses the nearest segment and preserves the regular turn", async () => {
    for (const [actionId, positions] of [
        ["walk", [0, 0, 50, 50, 100, 100]],
        ["sprint", [0, 0, 25, 25, 50, 50, 75, 75, 75, 100, 100]],
    ]) {
        for (const [elapsed, position] of positions.entries()) {
            const fixture = scheduledMovementFixture(actionId);
            const duration = actionId === "walk" ? 5 : 10;
            await performTrackedMovementAction(fixture.context, { id: actionId, ticks: duration });
            fixture.combatant.initiative += 3.002; // Paid reaction and same-tick ordering must survive.
            fixture.combat.currentTick = 1 + elapsed;
            const nextTurn = fixture.combatant.initiative;
            const activeCombatant = fixture.combat.combatant;
            const state = getMovementAbortState(fixture.token, fixture.combat);
            assert.equal(state.stop.x, position, `${actionId} +${elapsed}: preview`);
            assert.equal(await abortMovementPlan(fixture.token, fixture.combat, state.id), true);
            assert.equal(fixture.token.x, position, `${actionId} +${elapsed}: position`);
            assert.equal(fixture.combatant.initiative, nextTurn);
            assert.equal(fixture.combat.combatant, activeCombatant);
            assert.equal(fixture.combat.currentTick, 1 + elapsed);
            assert.equal(fixture.plan(), null);
            assert.equal(fixture.token.getFlag("splittermond-smoother-fight", "continuousAction"), null);
            fixture.combat.currentTick = Math.round(nextTurn);
            await advancePendingMovements(fixture.combat);
            assert.equal(fixture.token.x, position, "aborted movement never resumes on its scheduled tick");
        }
    }
});

test("route-less movement is abortable without inventing a position or changing initiative", async () => {
    const fixture = scheduledMovementFixture("sprint");
    await performTrackedMovementAction(fixture.context, { id: "sprint", ticks: 10 });
    await fixture.token.setFlag("splittermond-smoother-fight", "movementPlan", null);
    fixture.token.x = 17;
    fixture.combat.currentTick = 5;
    const state = getMovementAbortState(fixture.token, fixture.combat);
    assert.equal(state.hasRoute, false);
    assert.equal(state.stop, null);
    assert.match(state.id, /^action:/u);
    assert.equal(await abortMovementPlan(fixture.token, fixture.combat, state.id), true);
    assert.equal(fixture.token.x, 17);
    assert.equal(fixture.combatant.initiative, 11);
    assert.equal(getMovementAbortState(fixture.token, fixture.combat), null);
});

test("remote aborts authorize a second GM and reject other players and stale action identities", async () => {
    for (const routeLess of [false, true]) {
        const fixture = scheduledMovementFixture("walk");
        await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });
        if (routeLess) await fixture.token.setFlag("splittermond-smoother-fight", "movementPlan", null);
        const owner = { id: "owner", isGM: false };
        movementHarness.runtimeController = owner;
        fixture.token.actor.isOwner = true;
        fixture.token.actor.testUserPermission = (user) => user.id === owner.id;
        movementHarness.resolveToken = () => fixture.token;
        const payload = {
            combatId: fixture.combat.id, tokenUuid: fixture.token.uuid,
            planId: getMovementAbortState(fixture.token, fixture.combat).id,
        };
        try {
            assert.equal((await applyRemoteMovementPlanAbort(payload, { id: "stranger" })).applied, false);
            assert.equal((await applyRemoteMovementPlanAbort({ ...payload, planId: "stale" }, owner)).applied, false);
            assert.equal((await applyRemoteMovementPlanAbort(payload, { id: "second-gm", isGM: true })).applied, true);
            assert.equal(fixture.combatant.initiative, 6);
        } finally {
            movementHarness.runtimeController = null;
            movementHarness.resolveToken = null;
        }
    }
});

test("an abort waits for its animation, blocks duplicate clicks and suppresses later scheduled movement", async () => {
    let release;
    let entered;
    const moving = new Promise((resolve) => entered = resolve);
    const blocked = new Promise((resolve) => release = resolve);
    let calls = 0;
    const fixture = scheduledMovementFixture("sprint", { beforeMove: async () => {
        if (++calls === 1) { entered(); await blocked; }
    } });
    await performTrackedMovementAction(fixture.context, { id: "sprint", ticks: 10 });
    fixture.combat.currentTick = 4;
    const advance = advancePendingMovements(fixture.combat);
    await moving;
    fixture.combat.currentTick = 5;
    const abort = abortMovementPlan(fixture.token, fixture.combat);
    assert.equal(await abortMovementPlan(fixture.token, fixture.combat), false);
    fixture.combat.currentTick = 8;
    assert.equal(await advancePendingMovements(fixture.combat), false);
    release();
    await advance;
    assert.equal(await abort, true);
    assert.equal(fixture.token.x, 50, "uses the abort tick captured before waiting");
    assert.equal(fixture.combatant.initiative, 11);
    assert.equal(fixture.plan(), null);
});

test("a stale abort never removes a replacement movement plan", async () => {
    let release;
    let entered;
    const moving = new Promise((resolve) => entered = resolve);
    const blocked = new Promise((resolve) => release = resolve);
    const fixture = scheduledMovementFixture("sprint", { beforeMove: async () => { entered(); await blocked; } });
    await performTrackedMovementAction(fixture.context, { id: "sprint", ticks: 10 });
    fixture.combat.currentTick = 4;
    const advance = advancePendingMovements(fixture.combat);
    await moving;
    const abort = abortMovementPlan(fixture.token, fixture.combat);
    await fixture.token.setFlag("splittermond-smoother-fight", "movementPlan", { ...fixture.plan(), id: "replacement" });
    release();
    await advance;
    assert.equal(await abort, false);
    assert.equal(fixture.plan().id, "replacement");
});

test("the canvas displays stop buttons for all GM tokens but only visible, assigned player tokens", async (t) => {
    const first = scheduledMovementFixture("walk");
    await performTrackedMovementAction(first.context, { id: "walk", ticks: 5 });
    const second = scheduledMovementFixture("sprint", { tokenId: "second", combatantId: "second" });
    await performTrackedMovementAction(second.context, { id: "sprint", ticks: 10 });
    second.token.hidden = true;
    second.combat.combatants.push(first.combatant);
    installMovementCanvas(t, [first.token, second.token]);
    syncMovementTokenControls();
    assert.equal(canvasButtons().length, 2, "all tokens, including hidden NPCs, without selection");
    const player = { id: "player", isGM: false };
    globalThis.game.user = player;
    movementHarness.runtimeController = player;
    first.token.actor.isOwner = true;
    second.token.actor.isOwner = true;
    syncMovementTokenControls();
    assert.equal(canvasButtons().filter((button) => button.visible).length, 1);
    assert.equal(canvasButtons().find((button) => button.visible).parent.document.uuid, first.token.uuid);
    movementHarness.runtimeController = { id: "other-player" };
    syncMovementTokenControls();
    assert.equal(canvasButtons().length, 0, "ownership alone does not bypass the assigned controller");
    globalThis.game.user = { id: "second-gm", isGM: true };
    syncMovementTokenControls();
    assert.equal(canvasButtons().length, 2, "every GM can access the buttons");
    movementHarness.runtimeController = null;
});

test("changing the assigned player removes the previous player's button without a token movement", async (t) => {
    const fixture = scheduledMovementFixture("walk");
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });
    const frames = installMovementCanvas(t, [fixture.token]);
    const player = { id: "player", isGM: false };
    game.user = player;
    fixture.token.actor.isOwner = true;
    movementHarness.runtimeController = player;
    syncMovementTokenControls();
    assert.equal(canvasButtons().length, 1);
    const previousSettings = game.settings;
    const settings = new Map();
    game.settings = { register: (_scope, key, config) => settings.set(key, config) };
    t.after(() => { game.settings = previousSettings; });
    registerSettings();
    movementHarness.runtimeController = { id: "new-owner" };
    settings.get("userTokenLinks").onChange({});
    assert.equal(frames.size, 1);
    const frame = [...frames.values()][0];
    frames.clear();
    frame();
    assert.equal(canvasButtons().length, 0);
    assert.notEqual(fixture.plan(), null, "changing the controller does not interrupt the action");
});

test("native controls follow nested canvas transforms and token animation without rule updates", async (t) => {
    const fixture = scheduledMovementFixture("sprint");
    await performTrackedMovementAction(fixture.context, { id: "sprint", ticks: 10 });
    fixture.combat.currentTick = 5;
    installMovementCanvas(t, [fixture.token]);
    syncMovementTokenControls();
    const button = canvasButtons()[0];
    const object = button.parent;
    assert.equal(object, fixture.token.object, "button is attached to the rendered token");
    assert.equal(canvas.interface.children.length, 0, "no route marker until hovering");
    button.listeners.get("pointerenter")();
    const marker = canvas.interface.children[0];
    assert.equal(marker.position.value.x, 100, "half route (50) plus token center (50)");
    fixture.combat.currentTick = 8;
    syncMovementTokenControls();
    assert.equal(marker.position.value.x, 125, "hover preview updates with combat ticks");

    // Foundry nests tokens below the stage; moving either parent must carry the button.
    const initial = button.toGlobal({ x: 0, y: 0 });
    canvas.stage.position.set(300, 200);
    canvas.tokens.position.set(25, 15);
    assert.deepEqual(button.toGlobal({ x: 0, y: 0 }), { x: initial.x + 325, y: initial.y + 215 });
    object.position.set(45, 60); // An in-flight animation, before token.document is updated.
    assert.deepEqual(button.toGlobal({ x: 0, y: 0 }), { x: 456, y: 289 });
    canvas.stage.scale.set(2);
    refreshMovementTokenControlScale();
    assert.equal(button.scale.value, 0.5);
    assert.equal(marker.scale.value, 0.5);
    assert.deepEqual(button.toGlobal({ x: 0, y: 0 }), { x: 626, y: 364 });
    assert.equal(marker.position.value.x, 125, "marker remains at the scene waypoint");
    button.listeners.get("pointerleave")();
    assert.equal(canvas.interface.children.length, 0);
    assert.equal(marker.destroyed, true);
    button.listeners.get("mouseover")(); // PIXI accessibility keyboard focus.
    assert.equal(canvas.interface.children.length, 1);
    button.listeners.get("mouseout")();
    assert.equal(canvas.interface.children.length, 0);
});

test("non-rectangular and very small token hit areas keep the control reachable", async (t) => {
    const fixture = scheduledMovementFixture("walk");
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });
    installMovementCanvas(t, [fixture.token]);
    fixture.token.object.hitArea = { contains: (x, y) => (x - 50) ** 2 + (y - 50) ** 2 <= 50 ** 2 };
    syncMovementTokenControls();
    const button = canvasButtons()[0];
    assert.equal(button.position.value.x, 50, "round/hex shapes fall back to the upper center");
    canvas.stage.scale.set(0.1);
    refreshMovementTokenControlScale();
    assert.ok(button.position.value.x >= 13 * button.scale.value);
    assert.ok(button.position.value.y >= 13 * button.scale.value);
});

test("the canvas button rechecks permission and ignores duplicate or stale clicks", async (t) => {
    const fixture = scheduledMovementFixture("walk");
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });
    fixture.combat.currentTick = 4;
    installMovementCanvas(t, [fixture.token]);
    syncMovementTokenControls();
    const staleButton = canvasButtons()[0];
    globalThis.game.user = { id: "other-player", isGM: false };
    const event = { button: 0, stopPropagation() {} };
    await staleButton.listeners.get("pointertap")(event);
    assert.notEqual(fixture.plan(), null);
    assert.equal(canvasButtons().length, 0);
    globalThis.game.user = fixture.primaryGm;
    syncMovementTokenControls();
    const button = canvasButtons()[0];
    const previousDocument = globalThis.document;
    let blurred = false;
    globalThis.document = { activeElement: { displayObject: button, blur() {
        assert.equal(button.parent, fixture.token.object, "PIXI focusout requires the connected display tree");
        blurred = true;
        button.listeners.get("mouseout")();
    } } };
    t.after(() => { globalThis.document = previousDocument; });
    await button.listeners.get("pointertap")({ ...event, button: 2 });
    assert.notEqual(fixture.plan(), null, "secondary click does not abort");
    const clicked = button.listeners.get("pointertap")(event);
    assert.equal(button.alpha, 0.5);
    await button.listeners.get("pointertap")(event);
    await clicked;
    await staleButton.listeners.get("pointertap")(event);
    assert.equal(fixture.plan(), null);
    assert.equal(fixture.token.x, 50);
    assert.equal(fixture.combatant.initiative, 6);
    assert.equal(canvasButtons().length, 0);
    assert.equal(button.destroyed, true);
    assert.equal(blurred, true);
});

test("panning offscreen never clamps a detached button onto the viewport", async (t) => {
    const fixture = scheduledMovementFixture("walk");
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });
    fixture.token.x = -500;
    installMovementCanvas(t, [fixture.token]);
    syncMovementTokenControls();
    const button = canvasButtons()[0];
    assert.ok(button.toGlobal({ x: 0, y: 0 }).x < 0);
    canvas.stage.position.set(600, 0);
    refreshMovementTokenControlScale();
    assert.equal(button.toGlobal({ x: 0, y: 0 }).x, 186);
});

test("animation refreshes and camera pans do not read movement plans; document hooks coalesce", async (t) => {
    const fixture = scheduledMovementFixture("walk");
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });
    const scenery = Array.from({ length: 99 }, (_, i) => ({
        id: "scenery-" + i, uuid: "scenery-" + i, getFlag: () => null,
    }));
    const frames = installMovementCanvas(t, [fixture.token, ...scenery]);
    let reads = 0;
    for (const token of [fixture.token, ...scenery]) {
        const getFlag = token.getFlag.bind(token);
        token.getFlag = (...args) => { reads++; return getFlag(...args); };
    }
    syncMovementTokenControls();
    const singleSyncReads = reads;
    assert.ok(singleSyncReads >= 100);
    reads = 0;
    for (let frame = 0; frame < 60; frame++) {
        for (const object of canvas.tokens.placeables) refreshMovementTokenControl(object);
        refreshMovementTokenControlScale();
    }
    assert.equal(reads, 0, "6,000 refresh events cause zero plan/continuous-action reads");
    for (let i = 0; i < 100; i++) scheduleMovementTokenControls();
    assert.equal(frames.size, 1);
    const frame = [...frames.values()][0];
    frames.clear();
    frame();
    assert.equal(reads, singleSyncReads, "100 simultaneous hooks result in one reconciliation");

    const button = canvasButtons()[0];
    button.listeners.get("pointerenter")();
    scheduleMovementTokenControls();
    clearMovementTokenControls();
    assert.equal(frames.size, 0, "scene teardown cancels queued work");
    assert.equal(canvasButtons().length, 0);
    assert.equal(canvas.interface.children.length, 0, "scene teardown removes preview graphics");
    assert.equal(button.destroyed, true);
});

test("redrawing a token replaces its destroyed button and cleans the old preview", async (t) => {
    const fixture = scheduledMovementFixture("walk");
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });
    installMovementCanvas(t, [fixture.token]);
    syncMovementTokenControls();
    const button = canvasButtons()[0];
    button.listeners.get("pointerenter")();
    button.parent.removeChild(button);
    button.destroy({ children: true });
    syncMovementTokenControls();
    assert.notEqual(canvasButtons()[0], button);
    assert.equal(canvasButtons().length, 1);
    assert.equal(canvas.interface.children.length, 0);
});

test("sight animation reuses movement controls and batches route document updates", async (t) => {
    const fixture = scheduledMovementFixture("walk");
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });
    const scenery = Array.from({ length: 99 }, (_, i) => ({ id: `scenery-${i}`, uuid: `scenery-${i}`, getFlag: () => null }));
    fixture.combat.combatants.push(...scenery.map((token) => ({ id: token.id, token })));
    const frames = installMovementCanvas(t, [fixture.token, ...scenery]);
    clearMovementPreviewRefresh();
    t.after(clearMovementPreviewRefresh);
    const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((fn) => fn()); };
    syncMovementTokenControls();
    refreshMovementVisibility();
    flush();
    let reads = 0;
    for (const token of [fixture.token, ...scenery]) {
        const original = token.getFlag.bind(token);
        token.getFlag = (...args) => { reads++; return original(...args); };
    }
    const button = canvasButtons()[0];
    for (let i = 0; i < 60; i++) { refreshMovementVisibility(); flush(); }
    assert.equal(reads, 0, "stable sight across frames reads no movement flags");
    assert.equal(canvasButtons()[0], button);
    for (let i = 0; i < 100; i++) scheduleDefaultMovementRoutePreviews(fixture.combat);
    assert.equal(reads, 0, "document updates no longer scan all routes synchronously");
    assert.equal(frames.size, 1);
    flush();
    assert.equal(reads, 100, "100 document updates perform one scan of 100 combatants");
    scheduleDefaultMovementRoutePreviews(fixture.combat);
    clearMovementPreviewRefresh();
    assert.equal(frames.size, 0);
});

test("sight changes hide route and button immediately and restore the same eligible button", async (t) => {
    const fixture = scheduledMovementFixture("walk");
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });
    const frames = installMovementCanvas(t, [fixture.token]);
    clearMovementRoutePreview();
    t.after(() => clearMovementRoutePreview());
    clearMovementPreviewRefresh();
    t.after(clearMovementPreviewRefresh);
    let perceivable = true;
    const player = { id: "player", isGM: false };
    globalThis.game.user = player;
    movementHarness.runtimeController = player;
    movementHarness.isTokenPerceivableByUser = () => perceivable;
    fixture.token.actor.isOwner = true;
    t.after(() => { movementHarness.isTokenPerceivableByUser = null; });
    syncMovementTokenControls();
    syncDefaultMovementRoutePreviews(fixture.combat);
    const button = canvasButtons()[0];
    const route = canvas.interface.children[0];
    perceivable = false;
    refreshMovementVisibility();
    assert.equal(button.visible, false);
    assert.equal(route.visible, false, "a separate PIXI route must not leak a now invisible token");
    perceivable = true;
    refreshMovementVisibility();
    assert.equal(button.visible, true);
    assert.equal(canvasButtons()[0], button);
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((fn) => fn());
    assert.equal(isMovementRoutePreviewVisible(fixture.token), true);
});

test("hidden-token abort messages remain private to GMs even with a player assigned", async (t) => {
    const fixture = scheduledMovementFixture("walk");
    await performTrackedMovementAction(fixture.context, { id: "walk", ticks: 5 });
    fixture.token.hidden = true;
    const previousChat = globalThis.ChatMessage;
    const previousUsers = globalThis.game.users;
    const messages = [];
    globalThis.ChatMessage = { create: async (message) => messages.push(message) };
    globalThis.game.users = new Map([
        ["gm", fixture.primaryGm], ["second-gm", { id: "second-gm", isGM: true }],
        ["player", { id: "player", isGM: false }],
    ]);
    movementHarness.runtimeController = { id: "player", isGM: false };
    t.after(() => { globalThis.ChatMessage = previousChat; globalThis.game.users = previousUsers; });
    installMovementCanvas(t, [fixture.token]);
    syncMovementTokenControls();
    await canvasButtons()[0].listeners.get("pointertap")({ preventDefault() {}, stopPropagation() {} });
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].whisper, ["gm", "second-gm"]);
});

function installMovementCanvas(t, tokens) {
    const previous = { canvas: globalThis.canvas, PIXI: globalThis.PIXI,
        requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
    clearMovementTokenControls();
    const frames = new Map();
    let nextFrame = 0;
    globalThis.requestAnimationFrame = (callback) => { frames.set(++nextFrame, callback); return nextFrame; };
    globalThis.cancelAnimationFrame = (id) => frames.delete(id);
    globalThis.PIXI = { Container: FakePixiContainer, Graphics: FakePixiGraphics, Text: FakePixiText,
        Rectangle: class { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } } };
    const stage = new FakePixiContainer();
    const layer = new FakePixiContainer();
    const overlay = new FakePixiContainer();
    stage.addChild(layer, overlay);
    layer.placeables = tokens.map((token) => {
        const object = new FakePixiContainer();
        Object.assign(object, { document: token, w: 100, h: 100 });
        object.position.set(token.x ?? 0, token.y ?? 0);
        token.object = object;
        layer.addChild(object);
        return object;
    });
    globalThis.canvas = { stage, interface: overlay, grid: { size: 100 }, tokens: layer };
    t.after(() => {
        clearMovementTokenControls();
        Object.assign(globalThis, previous);
        movementHarness.runtimeController = null;
    });
    return frames;
}

function canvasButtons() {
    return canvas.tokens.placeables.flatMap((object) => object.children)
        .filter((element) => element.name === "sf-movement-token-stop" && !element.destroyed);
}

class FakePixiContainer {
    constructor() {
        this.children = [];
        this.destroyed = false;
        this.listeners = new Map();
        this.parent = null;
        this.position = { set: (x, y) => this.position.value = { x, y }, value: { x: 0, y: 0 } };
        this.scale = { set: (value) => { this.scale.value = value; this.scale.x = value; }, value: 1, x: 1 };
    }

    toGlobal(point) {
        const result = {
            x: point.x * this.scale.value + this.position.value.x,
            y: point.y * this.scale.value + this.position.value.y,
        };
        return this.parent ? this.parent.toGlobal(result) : result;
    }

    addChild(...children) {
        children.forEach((child) => {
            child.parent = this;
            this.children.push(child);
        });
        return children.at(-1);
    }

    removeChild(child) {
        this.children = this.children.filter((candidate) => candidate !== child);
        child.parent = null;
    }

    on(eventName, listener) {
        this.listeners.set(eventName, listener);
        return this;
    }

    destroy({ children = false } = {}) {
        this.destroyed = true;
        if (children) this.children.forEach((child) => child.destroy?.({ children: true }));
        this.children = [];
    }
}

class FakePixiGraphics extends FakePixiContainer {
    constructor() {
        super();
        this.operations = [];
    }

    operation(name) { this.operations.push(name); return this; }
    lineStyle() { return this.operation("lineStyle"); }
    moveTo() { return this.operation("moveTo"); }
    lineTo() { return this.operation("lineTo"); }
    beginFill() { return this.operation("beginFill"); }
    drawCircle() { return this.operation("drawCircle"); }
    drawRoundedRect() { return this.operation("drawRoundedRect"); }
    endFill() { return this.operation("endFill"); }
}

class FakePixiText extends FakePixiContainer {
    constructor(text, style) {
        super();
        this.style = style;
        this.text = text;
        this.height = 20;
        this.width = String(text).length * 9;
        this.anchor = { set() {} };
        this.position = { set() {} };
    }
}

function scheduledMovementFixture(actionId, {
    beforeMove = null,
    chatCardResult = true,
    combatId = "combat-1",
    combatantId = "combatant-1",
    tokenId = "token-1",
    tokenName = "Arrou",
    moveResults = null,
    movementDistance = actionId === "crawl" ? 1 : 10,
} = {}) {
    const moduleId = "splittermond-smoother-fight";
    const primaryGm = { id: "gm", isGM: true, active: true };
    const flags = { [moduleId]: {} };
    const moveCalls = [];
    const chatCards = [];
    const token = {
        id: tokenId,
        uuid: `Scene.scene-1.Token.${tokenId}`,
        name: tokenName,
        x: 100,
        y: 0,
        elevation: 0,
        flags,
        movementHistory: [{ x: 0, y: 0, elevation: 0 }, { x: 100, y: 0, elevation: 0 }],
        measureMovementPath: (waypoints) => ({
            distance: movementDistance,
            segments: waypoints.slice(1).map(() => ({ distance: movementDistance })),
        }),
        getFlag(scope, key) {
            return this.flags[scope]?.[key] ?? null;
        },
        async setFlag(scope, key, value) {
            if (key === "continuousAction" && value === null && this.rejectContinuousActionClear) {
                throw new Error("continuous action clear rejected");
            }
            this.flags[scope] ??= {};
            this.flags[scope][key] = structuredClone(value);
            return this;
        },
        async unsetFlag(scope, key) {
            delete this.flags[scope]?.[key];
            return this;
        },
        async revertRecordedMovement() {
            const origin = this.movementHistory[0];
            this.x = origin.x;
            this.y = origin.y;
            this.elevation = origin.elevation;
            return true;
        },
        async clearMovementHistory() {
            this.movementHistory = [];
        },
        async move(waypoints, options) {
            moveCalls.push({ waypoints: structuredClone(waypoints), options });
            await beforeMove?.(waypoints, options);
            const outcome = moveResults?.length ? moveResults.shift() : true;
            const completed = typeof outcome === "object" ? outcome.completed : outcome;
            const reachesDestination = typeof outcome === "object"
                ? outcome.reachesDestination !== false
                : Boolean(completed);
            const destination = typeof outcome === "object" && outcome.position
                ? outcome.position
                : waypoints.at(-1);
            if (reachesDestination || (typeof outcome === "object" && outcome.position)) {
                this.x = destination.x;
                this.y = destination.y;
                this.elevation = destination.elevation ?? this.elevation;
            }
            return completed;
        },
    };
    const actor = { id: `actor-${tokenId}`, name: tokenName };
    token.actor = actor;
    const combatant = { id: combatantId, initiative: 1, token };
    const combat = {
        id: combatId,
        currentTick: 1,
        combatant,
        combatants: [combatant],
        async setInitiative(_id, initiative) {
            combatant.initiative = initiative;
        },
    };
    const context = { actionId, actor, combat, combatant, token };
    globalThis.game.user = primaryGm;
    globalThis.game.combat = combat;
    globalThis.ui = { notifications: { info: () => {}, warn: () => {} } };
    movementHarness.primaryGm = primaryGm;
    movementHarness.addCombatTicks = async (currentContext, ticks) => {
        currentContext.combatant.initiative += Number(ticks);
        return Number(ticks);
    };
    movementHarness.createTickActionChatCard = async (_context, id, ticks, options) => {
        chatCards.push({ id, ticks, options });
        return chatCardResult ? { id: `card-${chatCards.length}` } : null;
    };
    return {
        chatCards,
        combat,
        combatant,
        context,
        moveCalls,
        plan: () => token.getFlag(moduleId, "movementPlan"),
        primaryGm,
        token,
    };
}
