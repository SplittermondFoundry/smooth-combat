import assert from "node:assert/strict";
import test from "node:test";

import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import { collectCombatEventGroups } from "../Modul/splittermond-smoother-fight/scripts/features/combat-events/service.js";
import { prepareRenderedChatMessage, prepareExistingRenderedChatMessages, isDiceAnimationPending } from "../Modul/splittermond-smoother-fight/scripts/features/chat/lifecycle.js";
import { getAssociatedDamageMessages } from "../Modul/splittermond-smoother-fight/scripts/features/chat/completed-offense-controls.js";
import { getMessageContext, isDamageMessage, isDefenseMessage, isSpellMessage } from "../Modul/splittermond-smoother-fight/scripts/features/chat/messages.js";

const MODULE_ID = "splittermond-smoother-fight";

function fixture(t, type = "attackRollMessage") {
    const previousGame = Object.getOwnPropertyDescriptor(globalThis, "game");
    const previousServices = { ...services };
    t.after(() => {
        if (previousGame) Object.defineProperty(globalThis, "game", previousGame);
        else delete globalThis.game;
        for (const key of Object.keys(services)) delete services[key];
        Object.assign(services, previousServices);
    });
    const combat = { id: "combat", scene: "scene", active: true, combatants: [] };
    const offense = {
        id: "offense", type, timestamp: 1, speaker: { actor: "attacker" },
        flags: { [MODULE_ID]: { context: { combatId: combat.id } } },
    };
    const messages = [offense];
    let completedRenders = 0;
    Object.assign(services, {
        collectCombatEventGroups, getMessageContext, isDamageMessage, isDefenseMessage,
        isSpellMessage, isDiceAnimationPending,
        isFumbleTableMessage: () => false,
        getFumbleData: () => null,
        defenseAllowsModification: () => true,
        defenseAwaitsResponse: () => false,
        bindFumbleActions: () => { completedRenders++; },
    });
    globalThis.game = {
        combat: null,
        combats: [],
        currentScene: { id: "scene" },
        user: { id: "gm", isGM: true },
        messages: { contents: messages, get: (id) => messages.find((message) => message.id === id) },
        settings: { get: () => 3 },
    };
    const damageControl = {
        dataset: { action: "rollDamage" }, closest: () => null,
        removed: false, remove() { this.removed = true; },
    };
    const degreeControl = {
        closest: () => null,
        removed: false, remove() { this.removed = true; },
    };
    const html = {
        closest: () => null,
        querySelector: () => null,
        querySelectorAll: (selector) => {
            if (selector === ".splittermond-chat-action") return [damageControl];
            if (selector === 'input[type="checkbox"].splittermond-chat-action[data-action]') return [degreeControl];
            return [];
        },
    };
    return { combat, offense, messages, html, damageControl, degreeControl,
        get completedRenders() { return completedRenders; } };
}

for (const type of ["attackRollMessage", "spellRollMessage"]) {
    test(`${type} finishes rendering without a combat and keeps unused controls`, (t) => {
        const f = fixture(t, type);
        prepareRenderedChatMessage(f.offense, f.html);
        assert.equal(f.completedRenders, 1);
        assert.equal(f.damageControl.removed, false);
        assert.equal(f.degreeControl.removed, false);
    });
}

test("startup initializes existing attack and spell cards without a combat", (t) => {
    const f = fixture(t);
    const spell = { ...f.offense, id: "spell", type: "spellRollMessage" };
    f.messages.push(spell);
    const cards = [f.offense, spell].map((message) => ({
        ...f.html, dataset: { messageId: message.id },
    }));
    const root = {
        querySelectorAll: (selector) => {
            assert.equal(selector, '.message[data-message-id]');
            return cards;
        },
    };

    prepareExistingRenderedChatMessages(root);

    assert.equal(f.completedRenders, 2, "initialization must finish both cards instead of aborting on the first");
    assert.equal(f.damageControl.removed, false);
    assert.equal(f.degreeControl.removed, false);
});

for (const association of ["linked", "rendered"]) {
    test(`${association} damage still suppresses completed offense controls without a combat`, (t) => {
        const f = fixture(t);
        const damage = { id: "damage", type: "damageMessage", timestamp: 2 };
        f.messages.push(damage);
        if (association === "linked") {
            damage.flags = { [MODULE_ID]: { context: { attackMessageId: f.offense.id } } };
        } else {
            f.html.closest = () => ({ querySelectorAll: () => [{ dataset: { messageId: damage.id } }] });
        }
        prepareRenderedChatMessage(f.offense, f.html);
        assert.equal(f.completedRenders, 1);
        assert.equal(f.damageControl.removed, true);
        assert.equal(f.degreeControl.removed, true);
        assert.deepEqual(getAssociatedDamageMessages(f.html, f.offense), [damage]);
    });
}

test("chat rendering finds scene-combat damage even when game.combat is null", (t) => {
    const f = fixture(t);
    const damage = { id: "legacy-damage", type: "damageMessage", timestamp: 2, speaker: f.offense.speaker };
    f.messages.push(damage);
    game.combats = new Map([[f.combat.id, f.combat]]);
    prepareRenderedChatMessage(f.offense, f.html);
    assert.equal(f.completedRenders, 1);
    assert.equal(f.damageControl.removed, true);
    assert.equal(f.degreeControl.removed, true);
    assert.deepEqual(getAssociatedDamageMessages(f.html, f.offense), [damage]);
});

test("a combat disappearing between successive card renders does not break rendering", (t) => {
    const f = fixture(t);
    game.combat = f.combat;
    prepareRenderedChatMessage(f.offense, f.html);
    game.combat = null;
    prepareRenderedChatMessage(f.offense, f.html);
    assert.equal(f.completedRenders, 2);
    assert.equal(f.damageControl.removed, false);
});
