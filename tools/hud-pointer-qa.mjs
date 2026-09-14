import assert from "node:assert/strict";
import path from "node:path";

export async function verifyHudPointerAreas(page, output, url) {
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
        await page.setViewportSize(viewport);
        for (const gm of [true, false]) for (const personal of [true, false]) {
            await page.goto(`${url}?gm=${Number(gm)}`);
            await page.waitForFunction(() => window.ready);
            await page.evaluate(async personal => {
                fixture.settings.characterFocusHud = personal;
                if (game.user.isGM) {
                    if (personal) await focus.setHudFocusTarget(focus.getHudFocusContexts(services.getHudContext()).action, fixture.ownToken.uuid, { additive: true });
                    else fixture.nativeTargets.get(game.user.id).targets.push(fixture.ownToken);
                }
                await hud.render();
                window.mapInputs = [];
                for (const type of ['click', 'contextmenu', 'wheel', 'pointerdown', 'pointermove', 'pointerup']) {
                    document.querySelector('.map').addEventListener(type, event => {
                        mapInputs.push({ type, buttons: event.buttons });
                        if (type === 'contextmenu' || type === 'wheel') event.preventDefault();
                    }, { passive: false });
                }
            }, personal);
            // Reproduce a tall combat event, including across scheduled HUD refreshes.
            await page.addStyleTag({ content: '#splittermond-smoother-fight-hud .sf-center { min-height: 560px; }' });
            const points = await page.evaluate(() => {
                const box = selector => document.querySelector(selector).getBoundingClientRect();
                const shell = box('.sf-shell'), center = box('.sf-center');
                const left = box('.sf-focus-actor-column, .sf-shell > .sf-actor'), right = box('.sf-target-column');
                const points = [
                    { name: 'above actor', x: left.x + left.width / 2, y: left.y - 25 },
                    { name: 'above targets', x: right.x + right.width / 2, y: right.y - 25 },
                    { name: 'left gap', x: (left.right + center.x) / 2, y: center.bottom - 40 },
                    { name: 'right gap', x: (center.right + right.x) / 2, y: center.bottom - 40 },
                ];
                for (const column of document.querySelectorAll('.sf-focus-actor-column, .sf-target-column')) {
                    const children = [...column.children].map(el => el.getBoundingClientRect()).filter(rect => rect.height);
                    children.slice(1).forEach((rect, i) => {
                        if (rect.y > children[i].bottom) points.push({ name: 'stack gap', x: rect.x + rect.width / 2, y: (children[i].bottom + rect.y) / 2 });
                    });
                }
                return points.map(point => ({ ...point, inShell: point.y > shell.y && point.y < shell.bottom }));
            });
            for (const point of points) {
                assert.ok(point.inShell, `${viewport.width}px gm=${gm} personal=${personal}: ${point.name} must reproduce a gap within the HUD bounds`);
                const hit = await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.map')), point);
                assert.ok(hit, `${viewport.width}px gm=${gm} personal=${personal}: ${point.name} blocks the map`);
                await page.evaluate(() => { mapInputs.length = 0; });
                await page.mouse.move(point.x, point.y);
                await page.mouse.click(point.x, point.y);
                await page.mouse.click(point.x, point.y, { button: 'right' });
                await page.mouse.wheel(0, 100);
                await page.waitForFunction(() => mapInputs.some(event => event.type === 'wheel'));
                await page.mouse.down();
                await page.mouse.move(point.x, point.y - 2, { steps: 2 });
                await page.mouse.up();
                const events = await page.evaluate(() => mapInputs);
                for (const type of ['click', 'contextmenu', 'wheel', 'pointerdown', 'pointerup']) assert.ok(events.some(event => event.type === type), `${point.name}: ${type}`);
                assert.ok(events.some(event => event.type === 'pointermove' && event.buttons === 1), `${point.name}: drag`);
            }
            // Painted surfaces must still intercept input; no clicks through visible panels.
            if (gm) assert.equal(await page.locator('.sf-secondary-targets').count(), 1);
            for (const selector of ['.sf-center', '.sf-portrait', '.sf-quick-targets', '.sf-secondary-targets', '.sf-secondary-target button']) {
                for (const locator of await page.locator(selector).all()) {
                    if (!await locator.isVisible()) continue;
                    assert.ok(await locator.evaluate(el => {
                        const rect = el.getBoundingClientRect();
                        return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
                    }), `${selector} must still receive pointer input`);
                }
            }
            // A menu outside its portrait remains clickable, while neighboring map space stays free.
            if (personal) {
                await page.locator('.sf-focus-picker > summary').click();
                const option = page.locator('.sf-focus-picker [data-focus-reference]').first();
                assert.ok(await option.isVisible());
                await option.click({ timeout: 1500 });
                assert.equal(await page.locator('.sf-focus-picker').evaluate(el => el.open), false);
            }
            await page.screenshot({ path: path.join(output, `pointer-areas-${viewport.width}-${gm ? 'gm' : 'player'}-${personal ? 'focus' : 'classic'}.png`) });
        }
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
}
