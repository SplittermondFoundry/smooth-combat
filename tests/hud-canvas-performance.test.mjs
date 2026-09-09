import assert from "node:assert/strict";
import test from "node:test";
import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import { hudState } from "../Modul/splittermond-smoother-fight/scripts/features/hud/state.js";
import { mountHud } from "../Modul/splittermond-smoother-fight/scripts/features/hud/controller.js";
import { getHudContext } from "../Modul/splittermond-smoother-fight/scripts/features/hud/context.js";
import { rememberHudCanvas, refreshHudCanvas } from "../Modul/splittermond-smoother-fight/scripts/features/hud/canvas-updates.js";
import {
    clearHudCanvasRefresh, scheduleHudCanvasRefresh, scheduleRender, scheduleRenderAfterTokenMovement,
} from "../Modul/splittermond-smoother-fight/scripts/features/hud/visibility.js";
import { readTokenMovementDistance } from "../Modul/splittermond-smoother-fight/scripts/shared/movement.js";

function deferred() {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function fixture(t) {
    const originals = new Map(["game", "canvas", "document", "setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"]
        .map((key) => [key, globalThis[key]]));
    const originalServices = { ...services };
    const originalHud = hudState.hud;
    const timers = new Map(), frames = new Map();
    let sequence = 0, builds = 0, invalidations = 0, measurements = 0;
    globalThis.setTimeout = (fn) => { timers.set(++sequence, fn); return sequence; };
    globalThis.clearTimeout = (id) => timers.delete(id);
    globalThis.requestAnimationFrame = (fn) => { frames.set(++sequence, fn); return sequence; };
    globalThis.cancelAnimationFrame = (id) => frames.delete(id);
    const root = {
        hidden: false, dataset: {}, classList: { contains: () => false },
        querySelector: () => null, querySelectorAll: () => [],
        addEventListener() {}, setAttribute() {},
        set innerHTML(_value) { throw new Error("canvas updates must retain the HUD's DOM"); },
    };
    const actor = { id: "actor", name: "Actor", isOwner: true, attacks: [], spells: [],
        derivedValues: { speed: { value: 8 } } };
    const token = { id: "active", uuid: "Scene.test.Token.active", actor, x: 0, y: 0, width: 1, height: 1,
        movementHistory: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        measureMovementPath() { measurements++; return { distance: 5 }; } };
    const target = { id: "target", uuid: "Scene.test.Token.target", name: "Target", actor: {},
        x: 100, y: 0, width: 1, height: 1, visible: true };
    const user = { id: "user", isGM: true, name: "User" };
    const combatant = { id: "combatant", token, actor, initiative: 0 };
    const combat = { id: "combat", started: true, combatant, combatants: [combatant] };
    Object.assign(services, {
        getAssignedUser: () => user, getRuntimeController: () => user,
        getTargetSelectionForUser: () => ({ target: target.visible ? target : null, targets: target.visible ? [target] : [] }),
        canChooseTarget: () => true, getTargetSceneTokens: () => target.visible ? [token, target] : [token],
        clearHoveredToken() {}, isRangedAttack: () => false,
    });
    globalThis.game = { user, combat, i18n: {
        lang: "en", localize: (key) => key, format: (key, values) => `${key}:${JSON.stringify(values)}`,
    }, settings: { get: (_scope, key) => ({ minimized: false, meleeRange: 2 })[key] } };
    globalThis.canvas = { scene: { id: "test" }, grid: { size: 100, distance: 5, units: "m", type: 1 } };
    globalThis.document = { querySelector: () => null, createElement: () => root, body: { append() {} } };
    hudState.hud = { element: root, render: () => { builds++; }, invalidate: () => { invalidations++; } };
    rememberHudCanvas(getHudContext());
    const flush = (queue) => { const work = [...queue.values()]; queue.clear(); for (const fn of work) fn(); };
    t.after(() => {
        clearHudCanvasRefresh();
        hudState.hud = originalHud;
        for (const [key, value] of originals) globalThis[key] = value;
        for (const key of Object.keys(services)) delete services[key];
        Object.assign(services, originalServices);
    });
    return { root, actor, token, target, frames, timers, flush,
        counts: () => ({ builds, invalidations, measurements }) };
}

test("60 animation frames retain HUD nodes and measure unchanged movement history once", (t) => {
    const f = fixture(t);
    const header = {};
    let trackerWrites = 0;
    const tracker = { set outerHTML(value) { assert.match(value, /sf-movement-tracker/u); trackerWrites++; } };
    f.root.querySelector = (selector) => ({ ".sf-turn-target": header, ".sf-movement-tracker": tracker })[selector] ?? null;
    for (let frame = 0; frame < 60; frame++) {
        f.target.x += 100;
        scheduleHudCanvasRefresh();
        f.flush(f.frames);
        f.flush(f.timers);
    }
    assert.deepEqual(f.counts(), { builds: 0, invalidations: 0, measurements: 1 });
    assert.equal(trackerWrites, 1);
    assert.match(header.innerHTML, /305 m/u, "distance follows the final animated position");
});

test("losing sight hides old target content immediately and requests only one rebuild", (t) => {
    const f = fixture(t);
    let tooltipRemoved = false;
    hudState.actionTooltip = { element: { remove() { tooltipRemoved = true; } } };
    f.target.visible = false;
    scheduleHudCanvasRefresh();
    assert.equal(f.root.hidden, true);
    assert.equal(tooltipRemoved, true);
    for (let frame = 0; frame < 60; frame++) {
        scheduleHudCanvasRefresh();
        f.flush(f.frames);
        f.flush(f.timers);
    }
    assert.equal(f.counts().builds, 1);
    assert.equal(f.counts().invalidations, 1);
    f.target.visible = true;
    scheduleHudCanvasRefresh();
    f.flush(f.timers);
    assert.equal(f.counts().builds, 2, "regaining visibility restores the target via a fresh build");
});

test("scene teardown cancels queued work and ignores completions from old token animations", async (t) => {
    const f = fixture(t);
    const movement = deferred();
    f.token.object = { movementAnimationPromise: movement.promise };
    scheduleRenderAfterTokenMovement(f.token);
    await Promise.resolve();
    scheduleHudCanvasRefresh();
    scheduleRender(0);
    clearHudCanvasRefresh();
    assert.equal(f.frames.size, 0);
    assert.equal(f.timers.size, 0);
    movement.resolve();
    await Promise.resolve();
    assert.equal(f.frames.size, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.root.hidden, true);
});

test("observers also rebuild when a token referenced by historical cards loses visibility", (t) => {
    const f = fixture(t);
    let visible = true;
    const historical = { uuid: "Scene.test.Token.historical" };
    services.canChooseTarget = () => false;
    services.getTargetSceneTokens = () => [f.token, f.target, ...(visible ? [historical] : [])];
    rememberHudCanvas(getHudContext());
    visible = false;
    scheduleHudCanvasRefresh();
    assert.equal(f.root.hidden, true, "card target names must not outlive their visibility");
    f.flush(f.timers);
    assert.equal(f.counts().builds, 1);
});

test("completion without sight animation and rejected animation promises still refresh distances", async (t) => {
    const f = fixture(t);
    const header = {};
    f.root.querySelector = (selector) => selector === ".sf-turn-target" ? header : null;
    for (const promise of [Promise.resolve(), Promise.reject(new Error("stopped"))]) {
        f.token.object = { movementAnimationPromise: promise };
        f.target.x += 100;
        scheduleRenderAfterTokenMovement(f.token);
        await Promise.resolve();
        await Promise.resolve();
        f.flush(f.frames);
    }
    assert.match(header.innerHTML, /15 m/u);
    assert.equal(f.counts().builds, 0);
});

test("slow HUD builds serialize and a burst of newer requests produces one follow-up", async (t) => {
    fixture(t);
    mountHud();
    const hud = hudState.hud;
    const first = deferred(), second = deferred();
    let builds = 0, active = 0, maximum = 0;
    hud.renderOnce = async () => {
        const task = ++builds === 1 ? first : second;
        maximum = Math.max(maximum, ++active);
        await task.promise;
        active--;
    };
    const completion = hud.render();
    await Promise.resolve();
    for (let i = 0; i < 60; i++) assert.equal(hud.render(), completion);
    assert.equal(builds, 1);
    first.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(builds, 2);
    second.resolve();
    await completion;
    assert.equal(maximum, 1);
    assert.equal(hud.renderTask, null);
});

test("a failed build releases the render queue for later updates", async (t) => {
    fixture(t);
    mountHud();
    const hud = hudState.hud;
    hud.renderOnce = async () => { throw new Error("failed build"); };
    await assert.rejects(hud.render(), /failed build/u);
    let recovered = false;
    hud.renderOnce = async () => { recovered = true; };
    await hud.render();
    assert.equal(recovered, true);
});

test("scene teardown cancels a queued rebuild while another build is still pending", async (t) => {
    fixture(t);
    mountHud();
    const hud = hudState.hud;
    const pending = deferred();
    let builds = 0;
    hud.renderOnce = async () => { builds++; await pending.promise; };
    const task = hud.render();
    await Promise.resolve();
    hud.render();
    clearHudCanvasRefresh();
    pending.resolve();
    await task;
    assert.equal(builds, 1);
    const cancelled = hud.render();
    clearHudCanvasRefresh();
    await cancelled;
    assert.equal(builds, 1, "a render cancelled before its first microtask never starts");
});

test("HUD distance reuse detects edits, updates live movement and never caches action validation", (t) => {
    const f = fixture(t);
    const cache = new WeakMap();
    for (let i = 0; i < 60; i++) assert.equal(readTokenMovementDistance(f.token, { cache }), 5);
    assert.equal(f.counts().measurements, 1);
    f.token.movement = { state: "pending", recorded: false, history: { distance: 5 }, passed: { distance: 3 } };
    assert.equal(readTokenMovementDistance(f.token, { cache }), 8);
    assert.equal(f.counts().measurements, 1);
    f.token.movementHistory[1].x = 200;
    readTokenMovementDistance(f.token, { cache });
    assert.equal(f.counts().measurements, 2);
    canvas.grid.distance = 10;
    readTokenMovementDistance(f.token, { cache });
    assert.equal(f.counts().measurements, 3);
    readTokenMovementDistance(f.token);
    readTokenMovementDistance(f.token);
    assert.equal(f.counts().measurements, 5, "mechanical actions always measure fresh");
    const previousCache = hudState.movementDistanceCache;
    rememberHudCanvas(getHudContext());
    assert.notEqual(hudState.movementDistanceCache, previousCache, "document renders discard HUD measurements");
    refreshHudCanvas(f.root);
});
