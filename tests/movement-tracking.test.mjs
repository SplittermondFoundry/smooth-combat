import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    movementActionMilestones,
    movementDueMilestones,
    movementInterruptionMilestone,
    movementPathThroughFractions,
    movementTrackerState,
} from "../Modul/splittermond-smoother-fight/scripts/domain/combat/movement.js";
import { revertTokenMovement } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/actions.js";
import {
    abortMovementPlan,
    advancePendingMovements,
    cancelMovementPlanAfterManualMove,
    clearMovementRoutePreview,
    clearTemporaryMovementRoutePreview,
    getAbortableControlledTokenMovement,
    isMovementRoutePreviewPersistent,
    isMovementRoutePreviewVisible,
    performTrackedMovementAction,
    renderTokenMovementControl,
    syncDefaultMovementRoutePreviews,
    togglePersistentMovementRoutePreview,
    toggleMovementRoutePreview,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/movement.js";
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
    addCombatTicks: (...args) => movementHarness.addCombatTicks(...args),
    createTickActionChatCard: (...args) => movementHarness.createTickActionChatCard(...args),
    getActivePrimaryGm: () => movementHarness.primaryGm,
    getControlledTokenDocument: () => movementHarness.controlledToken,
    getRuntimeController: () => movementHarness.runtimeController,
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
    const player = { id: "player", isGM: false };
    fixture.token.actor = { isOwner: true };
    movementHarness.runtimeController = player;

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
        globalThis.game.user = player;
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

class FakePixiContainer {
    constructor() {
        this.children = [];
        this.destroyed = false;
        this.listeners = new Map();
        this.parent = null;
        this.position = { set: (x, y) => this.position.value = { x, y } };
        this.scale = { set: (value) => this.scale.value = value, value: 1 };
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
    combatId = "combat-1",
    combatantId = "combatant-1",
    tokenId = "token-1",
    tokenName = "Arrou",
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
            distance: 10,
            segments: waypoints.slice(1).map(() => ({ distance: 10 })),
        }),
        getFlag(scope, key) {
            return this.flags[scope]?.[key] ?? null;
        },
        async setFlag(scope, key, value) {
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
            const destination = waypoints.at(-1);
            this.x = destination.x;
            this.y = destination.y;
            this.elevation = destination.elevation ?? this.elevation;
            return true;
        },
    };
    const actor = { id: `actor-${tokenId}`, name: tokenName };
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
        return { id: `card-${chatCards.length}` };
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
