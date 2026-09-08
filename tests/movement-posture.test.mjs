import assert from "node:assert/strict";
import test from "node:test";
import { movementTrackerState } from "../Modul/splittermond-smoother-fight/scripts/domain/combat/movement.js";
import { buildMovementTracker } from "../Modul/splittermond-smoother-fight/scripts/features/hud/movement.js";
import { readMovementSpeed } from "../Modul/splittermond-smoother-fight/scripts/shared/movement.js";

globalThis.game = {
    i18n: { lang: "de", localize: (key) => key, format: (key, data) => `${key}:${JSON.stringify(data)}` },
};

test("prone movement has a one-metre crawl budget independent of GSW and no automatic free budget", () => {
    for (const speed of [null, 0, 8, 15]) {
        for (const distance of [0, 0.5, 1, 1.0000001]) {
            const state = movementTrackerState(distance, speed, "prone");
            assert.equal(state.phase, "crawl");
            assert.equal(state.available, true);
            assert.equal(state.actionTicks, 5);
            assert.equal(state.freeLimit, null);
            assert.equal(state.walkLimit, 1);
            assert.equal(state.sectionProgress.free, 0);
            assert.equal(state.sectionProgress.sprint, 0);
        }
        const excess = movementTrackerState(3, speed, "prone");
        assert.equal(excess.phase, "excess");
        assert.equal(excess.excess, 2);
        assert.equal(excess.sectionProgress.walk, 100);
    }
});

test("movement uses calculated GSW with modifiers and distinguishes missing values from zero", () => {
    const cases = [
        [8, 8], ["7,5", 7.5], [0, 0], [null, null], [undefined, null], ["", null],
        ["8 - 3", null], ["(8 - 3)", null], ["nicht verfügbar", null],
        [{ display: "(8 - 3)", calculateSync: () => 5 }, 5],
        [{ display: "8 - 8", calculateSync: () => 0 }, 0],
        [{ display: "8", calculateSync: () => { throw new Error("unavailable"); } }, null],
        [{ display: "8 - 3", calculationValue: 5 }, 5],
        [{ value: { total: 6 } }, 6],
    ];
    for (const [value, expected] of cases) {
        assert.equal(readMovementSpeed({ derivedValues: { speed: { value } } }), expected);
    }
    assert.equal(readMovementSpeed({ system: { derivedAttributes: { speed: { value: 4 } } } }), 4);
    const broken = { display: "(8 - ?)" };
    assert.equal(readMovementSpeed({ derivedValues: { speed: { value: broken } },
        system: { derivedAttributes: { speed: { value: 8 } } } }), null, "do not substitute an unmodified base speed");
    const context = movementContext("standing", 3);
    context.actor.derivedValues = { speed: { value: { display: "(8 - 3)", calculateSync: () => 5 } } };
    assert.match(buildMovementTracker(context), /is-walk/u);
    context.actor.derivedValues.speed.value = 0;
    assert.match(buildMovementTracker(context), /MovementSpeedZero/u);
    delete context.actor.derivedValues;
    assert.match(buildMovementTracker(context), /MovementSpeedUnavailable/u);
});

test("prone HUD replaces walking and sprinting with crawl and stand up, including with missing GSW", () => {
    for (const distance of [0, 0.5, 1, 3]) {
        const html = buildMovementTracker(movementContext("prone", distance));
        assert.equal((html.match(/class="sf-movement-section /gu) ?? []).length, 3);
        assert.match(html, /MovementFreeGmDecision/u);
        assert.doesNotMatch(html, /data-tick-action-id="(?:walk|sprint)"|MovementSpeedUnavailable/u);
        const crawl = html.match(/<button[^>]*data-tick-action-id="crawl"[^>]*>[\s\S]*?<\/button>/u)?.[0];
        const standUp = html.match(/<button[^>]*data-tick-action-id="standUpProne"[^>]*>/u)?.[0];
        assert.match(crawl, /data-tick-action-advance="5"/u);
        assert.match(crawl, /MovementMeters.*distance.*1/u);
        assert.match(standUp, /data-tick-action-advance="6"/u);
        assert.equal(crawl.includes('aria-disabled="true"'), distance > 1);
        assert.equal(standUp.includes('aria-disabled="true"'), distance > 0);
        assert.equal(html.includes('data-sf-action="revert-movement"'), distance > 0);
    }
});

test("kneeling offers three-tick stand up and GM guidance without treating the actor as prone", () => {
    const context = movementContext("kneeling", 4);
    context.actor.derivedValues = { speed: { value: 8 } };
    const html = buildMovementTracker(context);
    assert.match(html, /data-tick-action-id="walk"/u);
    assert.match(html, /data-tick-action-id="standUpKneeling"[^>]*data-tick-action-advance="3"/u);
    assert.match(html, /MovementKneelingHint/u);
    assert.doesNotMatch(html, /data-tick-action-id="crawl"|MovementFreeGmDecision/u);
    const standing = buildMovementTracker(movementContext("standing", 0));
    assert.doesNotMatch(standing, /data-tick-action-id="standUp|MovementKneelingHint/u);
});

function movementContext(position, distance) {
    return {
        actor: { items: position === "standing" ? [] : [{ type: "statuseffect", name: position, system: { level: 1 } }] },
        token: { movementHistory: { distance } },
    };
}
