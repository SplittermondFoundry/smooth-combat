import assert from "node:assert/strict";
import test from "node:test";

import {
    resynchronizeCapturedTickControl,
} from "../Modul/splittermond-smoother-fight/scripts/features/chat/lifecycle.js";
import {
    ensureSpellReleaseTickControl,
    spellReleaseTickCost,
} from "../Modul/splittermond-smoother-fight/scripts/features/chat/tick-flow.js";

const MODULE_ID = "splittermond-smoother-fight";

test("a completed defense tick payment remains disabled after its click handler settles", (context) => {
    const gameDescriptor = Object.getOwnPropertyDescriptor(globalThis, "game");
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    context.after(() => {
        if (gameDescriptor) Object.defineProperty(globalThis, "game", gameDescriptor);
        else delete globalThis.game;
        if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
        else delete globalThis.document;
    });
    globalThis.game = {
        i18n: {
            localize: (key) => key,
        },
        user: { isGM: false },
    };

    const hud = renderedTickMessage("defense", true);
    const chat = renderedTickMessage("defense");
    hud.button.closest = () => hud.element;
    globalThis.document = {
        querySelectorAll: () => [hud.element, chat.element],
    };
    const message = {
        id: "defense",
        flags: {
            [MODULE_ID]: {
                legacyTickAdvance: { state: "completed" },
            },
        },
    };

    assert.equal(resynchronizeCapturedTickControl(hud.button, message), true);
    assert.equal(hud.button.disabled, true);
    assert.equal(chat.button.disabled, true, "the separate chat copy is synchronized with the HUD copy");
    assert.equal(hud.toggledClasses.get("is-applied"), true);
    assert.equal(chat.toggledClasses.get("is-applied"), true);
});

test("an idle tick control is released again when no tick payment completed", () => {
    const button = {
        isConnected: true,
        disabled: true,
        classList: { toggle: () => {} },
        closest: () => element,
    };
    const element = {
        querySelectorAll: () => [],
    };

    assert.equal(resynchronizeCapturedTickControl(button, { flags: {} }), true);
    assert.equal(button.disabled, false);
});

test("a prepared spell without the system tick option receives the missing release action", (context) => {
    const gameDescriptor = Object.getOwnPropertyDescriptor(globalThis, "game");
    context.after(() => {
        if (gameDescriptor) Object.defineProperty(globalThis, "game", gameDescriptor);
        else delete globalThis.game;
    });
    globalThis.game = {
        i18n: {
            format: (_key, data) => `${data.ticks} Ticks`,
            localize: (key) => key,
        },
    };
    const message = preparedSpellMessage();
    const actions = {
        children: [],
        append(control) {
            this.children.push(control);
        },
    };
    const element = {
        ownerDocument: {
            createElement: () => ({ dataset: {} }),
        },
        querySelector: () => actions,
        querySelectorAll: () => actions.children,
    };

    assert.equal(spellReleaseTickCost(message), 3);
    assert.equal(ensureSpellReleaseTickControl(element, message), true);
    assert.equal(actions.children.length, 1);
    assert.match(actions.children[0].className, /\badd-tick\b/u);
    assert.equal(actions.children[0].dataset.ticks, "3");
    assert.equal(actions.children[0].dataset.sfSpellReleaseTicks, "true");
    assert.match(actions.children[0].innerHTML, /3 Ticks/u);
});

test("the fallback is not offered on a superseded or already system-supported spell card", () => {
    const supported = preparedSpellMessage();
    supported.system.tickCostHandler.isOption = true;
    assert.equal(spellReleaseTickCost(supported), null);

    const superseded = preparedSpellMessage();
    superseded.flags[MODULE_ID].context.supersededBy = "recalculated-spell";
    assert.equal(spellReleaseTickCost(superseded), null);
});

function renderedTickMessage(messageId, disabled = false) {
    const toggledClasses = new Map();
    const button = {
        isConnected: true,
        disabled,
        dataset: { ticks: "3" },
        classList: {
            toggle: (name, enabled) => toggledClasses.set(name, enabled),
        },
    };
    const element = {
        dataset: { messageId },
        querySelectorAll: (selector) => {
            if (selector === ".sf-legacy-tick-recovery-actions") return [];
            if (selector === ".add-tick[data-ticks]") return [button];
            return [];
        },
    };
    return { button, element, toggledClasses };
}

function preparedSpellMessage() {
    return {
        id: "spell",
        type: "spellRollMessage",
        flags: {
            [MODULE_ID]: {
                context: {
                    actionKind: "spell",
                    combatId: "combat",
                    combatantId: "caster",
                },
            },
        },
        system: {
            tickCostHandler: {
                baseTickCost: 3,
                isOption: false,
                used: false,
            },
        },
    };
}
