import assert from "node:assert/strict";
import test from "node:test";

import {
    formatTokenDistance,
    isMeterUnit,
    measureTokenDistance,
    sceneDistanceUnit,
    tokenDistanceMeasurement,
} from "../Modul/splittermond-smoother-fight/scripts/shared/token-distance.js";

test("token distance uses Foundry's grid path measurement between token centers", () => {
    const source = { x: 0, y: 100, width: 1, height: 2, elevation: 1 };
    const target = { x: 300, y: 400, width: 2, height: 1, elevation: 4 };
    const canvasContext = {
        grid: {
            size: 100,
            units: "m",
            measurePath: (points) => {
                assert.deepEqual(points, [
                    { x: 50, y: 200, elevation: 1 },
                    { x: 400, y: 450, elevation: 4 },
                ]);
                return { distance: 7.4 };
            },
        },
    };

    assert.deepEqual(tokenDistanceMeasurement(source, target, canvasContext), {
        distance: 7.4,
        unit: "m",
        metric: true,
        available: true,
    });
});

test("token distance falls back to a three-dimensional straight line", () => {
    const canvasContext = { grid: { size: 100, distance: 5, units: "ft" } };
    const distance = measureTokenDistance(
        { x: 0, y: 0, width: 1, height: 1, elevation: 0 },
        { x: 300, y: 0, width: 1, height: 1, elevation: 8 },
        canvasContext
    );

    assert.equal(distance, 17);
    assert.deepEqual(tokenDistanceMeasurement(
        { object: { center: { x: 0, y: 0 } } },
        { object: { center: { x: 100, y: 0 } } },
        canvasContext
    ), {
        distance: 5,
        unit: "ft",
        metric: false,
        available: true,
    });
    assert.equal(measureTokenDistance({}, {}, canvasContext), Number.POSITIVE_INFINITY);
});

test("scene units and localized distance labels remain explicit", () => {
    globalThis.game = { i18n: { lang: "en" } };
    assert.equal(sceneDistanceUnit({ scene: { grid: { units: "Meter" } } }), "Meter");
    assert.equal(sceneDistanceUnit({}), "");
    assert.equal(isMeterUnit("Metres."), true);
    assert.equal(isMeterUnit("ft"), false);
    assert.equal(formatTokenDistance({ available: true, distance: 7.4, unit: "m" }), "7.4 m");
    assert.equal(formatTokenDistance({ available: false, distance: Infinity, unit: "m" }), "");
});
