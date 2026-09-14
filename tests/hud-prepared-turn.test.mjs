import assert from "node:assert/strict";
import test from "node:test";
import { focusFixture } from "./fixtures/hud-focus-fixture.mjs";
import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import { getHudFocusContexts, selectHudFocus } from "../Modul/splittermond-smoother-fight/scripts/features/hud/focus-context.js";
import { performAttack, performSpell } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/actions.js";
import { preparedActionId } from "../Modul/splittermond-smoother-fight/scripts/shared/prepared-action-compatibility.js";
import { buildHud } from "../Modul/splittermond-smoother-fight/scripts/features/hud/view.js";

for (const gm of [false, true]) for (const legacy of [false, true]) {
    test(`prepared releases require the exact token turn (GM=${gm}, legacy=${legacy})`, async () => {
        const f = focusFixture({ gm });
        // Two different characters controlled by the same player, then two tokens of one actor.
        f.ghost.isOwner = true;
        f.combat.combatants[0].runtimeController = f.player;
        f.combat.combatants[0].assignedUser = f.player;
        if (legacy) {
            delete f.own.system.preparedAction;
            f.own.flags.splittermond = { preparedAttack: 'bow', preparedSpell: 'spell0' };
        } else f.own.system.preparedAction = { attack: 'bow', spell: 'spell0' };
        const rolls = [];
        services.withTemporarySystemTargets = (_targets, operation) => operation();
        f.own.rollAttack = () => { rolls.push('attack'); return false; };
        f.own.rollSpell = () => { rolls.push('spell'); return false; };
        selectHudFocus(services.getHudContext(), 'personal', f.ownToken.uuid);
        const context = getHudFocusContexts(services.getHudContext()).action;
        for (const active of [f.combat.combatants[0], f.combat.combatants[2]]) {
            f.combat.combatant = active;
            assert.equal(await performAttack(context, 'bow'), false);
            assert.equal(await performSpell(context, 'spell0'), false);
            assert.deepEqual(rolls, []);
            assert.deepEqual(f.calls.flags, []);
            assert.deepEqual(f.calls.ticks, []);
            assert.equal(preparedActionId(f.own, 'attack'), 'bow');
            assert.equal(preparedActionId(f.own, 'spell'), 'spell0');
        }
        assert.equal(f.calls.warnings.length, 4);
        // The same previously captured context must use the current turn at execution time.
        f.combat.combatant = f.combat.combatants[1];
        await performAttack(context, 'bow');
        await performSpell(context, 'spell0');
        assert.deepEqual(rolls, ['attack', 'spell']);
        // Cancelling the native roll dialog retains both preparations.
        assert.equal(preparedActionId(f.own, 'attack'), 'bow');
        assert.equal(preparedActionId(f.own, 'spell'), 'spell0');
    });
}

test('prepared HUD buttons lock off turn, preserve cancellation, and unlock on the token turn', async () => {
    const f = focusFixture({ gm: true });
    f.own.system.preparedAction = { attack: 'bow', spell: 'spell0' };
    selectHudFocus(services.getHudContext(), 'personal', f.ownToken.uuid);
    const html = await buildHud(services.getHudContext());
    for (const action of ['attack', 'cast-prepared-spell']) {
        assert.match(html, new RegExp(`<button\\b[^>]*data-sf-action="${action}"[^>]*aria-disabled="true"[^>]*data-sf-start-blocked`));
    }
    for (const action of ['cancel-prepared-attack', 'cancel-prepared-spell']) {
        const button = html.match(new RegExp(`<button\\b[^>]*data-sf-action="${action}"[^>]*>`))?.[0];
        assert.ok(button);
        assert.doesNotMatch(button, /disabled|data-sf-start-blocked/);
    }
    f.combat.combatant = f.combat.combatants[1];
    assert.doesNotMatch(await buildHud(services.getHudContext()), /data-sf-start-blocked/);
});
