import assert from "node:assert/strict";
import path from "node:path";

export async function verifyPreparedTurnLocks(page, output, url) {
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
        await page.setViewportSize(viewport);
        for (const gm of [false, true]) {
            await page.goto(`${url}?gm=${Number(gm)}`);
            await page.waitForFunction(() => window.ready);
            await page.evaluate(async () => {
                fixture.ghost.isOwner = true;
                fixture.combat.combatants[0].runtimeController = fixture.player;
                fixture.combat.combatants[0].assignedUser = fixture.player;
                fixture.own.system.preparedAction = { attack: 'bow', spell: 'spell0' };
                fixture.own.rollAttack = () => { fixture.calls.rolls.push('attack'); return false; };
                fixture.own.rollSpell = () => { fixture.calls.rolls.push('spell'); return false; };
                services.withTemporarySystemTargets = (_targets, operation) => operation();
                focus.selectHudFocus(services.getHudContext(), 'personal', fixture.ownToken.uuid);
                await hud.render();
            });
            const buttons = [page.locator('.sf-prepared-attack-release'), page.locator('[data-sf-action="cast-prepared-spell"]')];
            for (const [index, button] of buttons.entries()) {
                assert.equal(await button.getAttribute('aria-disabled'), 'true');
                assert.equal(await button.getAttribute('disabled'), null);
                await button.hover();
                await page.waitForFunction(() => document.querySelector('.sf-action-tooltip.is-visible .sf-focus-lock-notice'));
                assert.match(await page.locator('.sf-focus-lock-notice').innerText(), /vorbereitet oder ausgelöst/);
                const rect = await button.boundingBox();
                await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
                assert.deepEqual(await page.evaluate(() => fixture.calls.rolls), []);
                const count = await page.evaluate(() => fixture.calls.sheets.length);
                await page.evaluate(() => document.addEventListener('contextmenu', event => { window.preparedContextMenu = event; }, { capture: true, once: true }));
                await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2, { button: 'right' });
                assert.deepEqual(await page.evaluate(count => fixture.calls.sheets.slice(count), count), [index ? 'spell0' : 'bow']);
                assert.equal(await page.evaluate(() => window.preparedContextMenu.defaultPrevented), true);
            }
            assert.deepEqual(await page.evaluate(() => fixture.own.system.preparedAction), { attack: 'bow', spell: 'spell0' });
            assert.deepEqual(await page.evaluate(() => fixture.calls.ticks), []);
            for (const cancel of await page.locator('.sf-prepared-spell-cancel').all()) {
                assert.equal(await cancel.getAttribute('aria-disabled'), null);
                assert.ok(await cancel.evaluate(el => {
                    const rect = el.getBoundingClientRect();
                    return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
                }));
            }
            await page.screenshot({ path: path.join(output, `prepared-locked-${viewport.width}-${gm ? 'gm' : 'player'}.png`) });
            await page.evaluate(async () => { fixture.combat.combatant = fixture.combat.combatants[1]; await hud.render(); });
            for (const button of buttons) {
                assert.equal(await button.getAttribute('aria-disabled'), null);
                await button.click();
            }
            assert.deepEqual(await page.evaluate(() => fixture.calls.rolls), ['attack', 'spell']);
            await page.evaluate(async () => { fixture.combat.combatant = fixture.combat.combatants[2]; await hud.render(); });
            for (const button of buttons) assert.equal(await button.getAttribute('aria-disabled'), 'true');
        }
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
}
