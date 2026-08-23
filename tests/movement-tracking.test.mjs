import assert from "node:assert/strict";
import test from "node:test";

import { configureServices } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import { movementTrackerState } from "../Modul/splittermond-smoother-fight/scripts/domain/combat/movement.js";
import { revertTokenMovement } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/actions.js";
import {
    buildMovementTracker,
    readTokenMovementDistance,
} from "../Modul/splittermond-smoother-fight/scripts/features/hud/movement.js";

const renderCalls = [];
configureServices({
    scheduleRender: (...args) => renderCalls.push(args),
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
