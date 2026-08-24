import assert from "node:assert/strict";
import test from "node:test";

import {
    syncMinimizedHudPosition,
    syncSystemActionBar,
} from "../Modul/splittermond-smoother-fight/scripts/features/hud/visibility.js";

test("the Splittermond action bar stays visible while the combat HUD is minimized", () => {
    const toggles = [];
    const bar = {
        classList: {
            toggle: (className, enabled) => toggles.push([className, enabled]),
        },
    };
    globalThis.document = { querySelector: (selector) => selector === "#token-action-bar" ? bar : null };
    globalThis.game = { settings: { get: () => true } };

    syncSystemActionBar(true, false);
    syncSystemActionBar(true, true);

    assert.deepEqual(toggles, [
        ["sf-system-bar-hidden", true],
        ["sf-system-bar-hidden", false],
    ]);
});

test("the minimized HUD stays aligned above the central hotbar when the Splittermond action bar is visible", () => {
    const classes = new Set();
    const properties = new Map();
    const hud = {
        classList: {
            add: (className) => classes.add(className),
            remove: (className) => classes.delete(className),
            toggle: (className, enabled) => enabled ? classes.add(className) : classes.delete(className),
        },
        style: {
            removeProperty: (property) => properties.delete(property),
            setProperty: (property, value) => properties.set(property, value),
        },
    };
    const systemActionBar = {
        getBoundingClientRect: () => ({ left: 10, top: 700, width: 600, height: 180 }),
    };
    const hotbar = {
        getBoundingClientRect: () => ({ left: 650, top: 820, width: 700, height: 60 }),
    };
    globalThis.document = {
        documentElement: { clientWidth: 2000 },
        querySelector: (selector) => ({
            "#token-action-bar:not(.sf-system-bar-hidden) .token-action-bar": systemActionBar,
            "#hotbar": hotbar,
        })[selector] ?? null,
    };
    globalThis.window = {
        getComputedStyle: () => ({ display: "block" }),
        innerWidth: 2000,
    };

    syncMinimizedHudPosition(hud, true);

    assert.equal(classes.has("is-minimized"), true);
    assert.equal(classes.has("is-action-bar-aligned"), true);
    assert.equal(properties.get("--sf-minimized-center"), "1000px");
    assert.equal(properties.get("--sf-minimized-top"), "814px");
});
