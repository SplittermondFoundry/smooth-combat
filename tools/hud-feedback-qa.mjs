import assert from "node:assert/strict";
import path from "node:path";

export async function verifyHudFeedback(page, output) {
    await page.evaluate(async () => {
        window.feedbackModule = await import('/Modul/splittermond-smoother-fight/scripts/features/feedback/feedback.js');
        window.feedbackState = (await import('/Modul/splittermond-smoother-fight/scripts/features/feedback/state.js')).feedbackState;
        globalThis.foundry ??= { utils: { randomID: () => crypto.randomUUID() } };
        Object.assign(services, { feedbackMarkup: feedbackModule.feedbackMarkup, synchronizeFeedbackAnimations: feedbackModule.synchronizeFeedbackAnimations });
        fixture.settings.audioFeedback = false;
        fixture.settings.hudMotion = 'full';
        fixture.settings.characterFocusHud = true;
        focus.selectHudFocus(services.getHudContext(), 'active');
        await hud.render();
    });
    const filenames = { defense: 'active-defense', damage: 'damage', damageBlocked: 'damage-blocked', spell: 'spell', ranged: 'ranged', turn: 'turn' };
    async function checkIcon() {
        const url = await page.locator('.sf-action-feedback .sf-media-icon').evaluate(el => getComputedStyle(el).maskImage.match(/url\("?([^"\)]+)"?\)/)?.[1]);
        assert.ok(url, 'Feedback icon must have a resolved mask URL');
        const response = await page.request.get(url);
        assert.equal(response.status(), 200, url);
        assert.match(await response.text(), /<svg/);
        assert.ok(await page.evaluate(url => new Promise(resolve => {
            const img = new Image(); img.onload = () => resolve(img.naturalWidth > 0); img.onerror = () => resolve(false); img.src = url;
        }), url));
        return url;
    }
    for (const [kind, filename] of Object.entries(filenames)) {
        await page.evaluate(async kind => {
            feedbackModule.receivePublishedFeedback(kind, { tokenUuid: fixture.targetToken.uuid, actorUuid: fixture.merc.uuid });
            await hud.render();
        }, kind);
        assert.equal(await page.locator('.sf-action-feedback').count(), 1);
        assert.ok((await checkIcon()).endsWith(`/assets/icons/${filename}.svg`));
        await page.locator('.sf-action-feedback').evaluate(el => { const animation = el.getAnimations()[0]; animation.pause(); animation.currentTime = 400; });
        await page.locator('.sf-focus-target-scope').screenshot({ path: path.join(output, `feedback-${kind}.png`) });
    }
    // CSS defaults must also work outside the HUD's per-client appearance overrides.
    await page.evaluate(() => hud.element.style.removeProperty('--sf-icon-turn'));
    await checkIcon();
    await page.evaluate(async () => {
        feedbackModule.receivePublishedFeedback('defense', { tokenUuid: fixture.targetToken.uuid, actorUuid: fixture.merc.uuid });
        await hud.render();
    });
    const id = await page.locator('.sf-action-feedback').getAttribute('data-sf-feedback-id');
    for (const partial of [false, true, false]) {
        await page.waitForTimeout(180);
        const timing = await page.evaluate(async partial => {
            if (partial) {
                const { refreshHudVisibilityParts } = await import('/Modul/splittermond-smoother-fight/scripts/features/hud/canvas-parts.js');
                refreshHudVisibilityParts(hud.element, services.getHudContext());
            } else await hud.render();
            const element = document.querySelector('.sf-action-feedback');
            return { id: element.dataset.sfFeedbackId, animation: element.getAnimations()[0].currentTime, elapsed: Date.now() - feedbackState.feedback.startedAt };
        }, partial);
        assert.equal(timing.id, id);
        assert.ok(timing.animation >= 150 && Math.abs(timing.animation - timing.elapsed) < 80, JSON.stringify(timing));
    }
    await page.waitForFunction(() => !document.querySelector('.sf-action-feedback'), null, { timeout: 1800 });
    await page.evaluate(async () => { await hud.render(); });
    assert.equal(await page.locator('.sf-action-feedback').count(), 0);
    await page.evaluate(async () => {
        feedbackModule.receivePublishedFeedback('defense', { tokenUuid: fixture.targetToken.uuid, actorUuid: fixture.merc.uuid });
        await hud.render();
    });
    assert.notEqual(await page.locator('.sf-action-feedback').getAttribute('data-sf-feedback-id'), id);
}
