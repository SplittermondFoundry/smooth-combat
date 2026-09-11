import assert from "node:assert/strict";
import test from "node:test";

import {
    shouldRestoreCombatSubevents,
    toggleCombatEventDisclosure,
} from "../Modul/splittermond-smoother-fight/scripts/features/hud/view-state.js";

test("a completed automatic combat focus cannot reopen its old attack card", () => {
    assert.equal(shouldRestoreCombatSubevents("attack", "attack", null), false);
    assert.equal(shouldRestoreCombatSubevents("attack", "attack", "next-attack"), false);
});

test("summary activation opens the chosen card and closes siblings synchronously", () => {
    const firstGroup = { open: true }, firstCard = { open: true };
    const card = { open: false };
    const group = {
        open: false,
        matches: selector => selector.includes(".sf-event-group"),
        querySelectorAll: () => [card],
    };
    card.matches = selector => selector.includes(".sf-event-card");
    card.closest = () => group;
    card.setAttribute = () => { card.open = true; };
    const summary = { parentElement: group };
    const root = {
        contains: node => node === summary || node === group || node === card,
        querySelectorAll: selector => selector.includes(".sf-event-card") ? [firstCard, card] : [firstGroup, group],
    };
    let prevented = 0;
    const event = { target: { closest: () => summary }, preventDefault: () => prevented++ };
    assert.equal(toggleCombatEventDisclosure(root, event), true);
    assert.equal(group.open, true);
    assert.equal(card.open, true);
    assert.equal(firstGroup.open, false);
    assert.equal(firstCard.open, false, "hidden sibling cards are closed without waiting for a toggle event");
    // Activating the nested card uses the same synchronous accordion path.
    card.open = false;
    summary.parentElement = card;
    assert.equal(toggleCombatEventDisclosure(root, event), true);
    assert.equal(card.open, true);
    assert.equal(firstCard.open, false);
    assert.equal(prevented, 2);
    assert.equal(toggleCombatEventDisclosure(root, event), true);
    assert.equal(card.open, false);
});

test("other menus and already-handled summary clicks retain their native behavior", () => {
    const root = { contains: () => true };
    const preventDefault = () => assert.fail("unrelated click must not be handled");
    assert.equal(toggleCombatEventDisclosure(root, { target: { closest: () => null }, preventDefault }), false);
    assert.equal(toggleCombatEventDisclosure(root, {
        target: { closest: () => ({ parentElement: { matches: () => false } }) }, preventDefault,
    }), false);
    assert.equal(toggleCombatEventDisclosure(root, { defaultPrevented: true, preventDefault }), false);
});

test("an unchanged focus and manually opened history retain their subevent state", () => {
    assert.equal(shouldRestoreCombatSubevents("attack", "attack", "attack"), true);
    assert.equal(shouldRestoreCombatSubevents("history", null, null), true);
    assert.equal(shouldRestoreCombatSubevents("history", "attack", null), true);
});
