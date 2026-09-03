import assert from "node:assert/strict";
import test from "node:test";

import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    handleRenderedOffenseFollowUp,
} from "../Modul/splittermond-smoother-fight/scripts/features/chat/actions.js";
import {
    suppressCompletedOffenseControls,
} from "../Modul/splittermond-smoother-fight/scripts/features/chat/completed-offense-controls.js";

function installFixture() {
    const offense = { id: "offense", type: "attackRollMessage" };
    const damage = { id: "damage", type: "damageMessage" };
    const group = { primary: offense, damages: [damage] };
    let followUpRequests = 0;
    globalThis.game = {
        combat: { id: "combat" },
        i18n: { localize: (key) => key },
        messages: new Map([[offense.id, offense], [damage.id, damage]]),
    };
    globalThis.ui = { notifications: { warn() {} } };
    services.collectCombatEventGroups = () => [group];
    services.getMessageContext = () => ({});
    services.isDamageMessage = (message) => message?.id === damage.id;
    services.requestOffenseFollowUp = () => {
        followUpRequests += 1;
        return offense;
    };
    services.scheduleRender = () => {};
    return { offense, damage, get followUpRequests() { return followUpRequests; } };
}

test("an existing damage card removes stale damage and degree controls", () => {
    const fixture = installFixture();
    let damageRemoved = false;
    let degreesRemoved = false;
    const damageControl = {
        dataset: { action: "rollDamage" },
        closest: () => null,
        remove: () => { damageRemoved = true; },
    };
    const degreeContainer = { remove: () => { degreesRemoved = true; } };
    const degreeControl = {
        dataset: { action: "selectDegree" },
        closest: (selector) => selector.includes("chat-card-segment") ? degreeContainer : null,
        matches: () => true,
    };
    const element = {
        closest: () => null,
        querySelectorAll: (selector) => {
            if (selector === ".splittermond-chat-action") return [damageControl, degreeControl];
            if (selector.startsWith('input[type="checkbox"]')) return [degreeControl];
            return [];
        },
    };

    assert.equal(suppressCompletedOffenseControls(element, fixture.offense), true);
    assert.equal(damageRemoved, true);
    assert.equal(degreesRemoved, true);
});

test("a stale damage button cannot create a second damage follow-up", async () => {
    const fixture = installFixture();
    let prevented = false;
    const button = {
        dataset: { action: "rollDamage" },
        disabled: false,
        closest: () => null,
        matches: () => false,
    };

    await handleRenderedOffenseFollowUp({
        preventDefault: () => { prevented = true; },
    }, button, fixture.offense);

    assert.equal(prevented, true);
    assert.equal(fixture.followUpRequests, 0);
});
