import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";

// Uses real, locally supplied Foundry CSS and Splittermond release templates.
// It renders DialogV2's form wrapper, without starting a world or rolling dice.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = process.env.FOUNDRY_APP_ROOT;
assert.ok(appRoot, "Set FOUNDRY_APP_ROOT to the local Foundry resources/app directory");
const systemRoots = process.argv.slice(2).map(value => path.resolve(value));
assert.ok(systemRoots.length, "Pass one or more extracted/installed Splittermond directories");
const runtimeRoot = path.resolve(process.env.HUD_MODULE_ROOT ?? path.join(root, "Modul/splittermond-smoother-fight"));
const manifest = JSON.parse(await fs.readFile(path.join(runtimeRoot, "module.json"), "utf8"));
const { default: handlebars } = await import(pathToFileURL(path.join(appRoot, "node_modules/handlebars/lib/index.js")));
handlebars.registerHelper("localize", key => ({
    "splittermond.modifier": "Modifikator", "splittermond.difficulty": "Schwierigkeit",
    "splittermond.messageMode": "Wurfmodus", "splittermond.maneuvers": "Manöver",
}[key] ?? key));
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const playwright = await import(modulePath ? pathToFileURL(path.join(modulePath, "index.mjs")) : "playwright");
const browserName = process.env.HUD_BROWSER ?? "chromium";
const output = path.join(root, "tmp/check-dialog-qa", browserName);
await fs.mkdir(output, { recursive: true });
const templates = await Promise.all(systemRoots.map(async directory => ({
    version: JSON.parse(await fs.readFile(path.join(directory, "system.json"), "utf8")).version,
    render: handlebars.compile(await fs.readFile(path.join(directory, "templates/apps/dialog/check-dialog.hbs"), "utf8")),
})));
function dialogPage(index, count) {
    const content = templates[index].render({
        baseId: "scroll-qa", skill: { label: "Handgemenge", actor: { name: "Geistervarg", img: "" }, maneuvers: [] },
        skillTooltip: "BEW 2 + KON 3 + FP 15 − Wundabzug 1 = FW 19",
        modifier: 0, difficulty: "18", rollModes: { publicroll: { label: "Öffentlich", selected: true } },
        emphasis: Array.from({ length: count }, (_, i) => ({
            name: `modifier-${i}`, label: `${["Überzahl +1", "Lichtverhältnisse Stufe 3 −6", "Taktischer Vorteil +3"][i % 3]} (${i + 1})`,
            value: String(i + 1), active: false,
        })),
    });
    const footer = '<footer class="form-footer">' + ["risk", "standard", "safety"].map((action, i) =>
        `<button type="submit" data-action="${action}">${["Risikowurf", "Standardwurf", "Sicherheitswurf"][i]}</button>`).join("") + "</footer>";
    return `<!doctype html><html lang="de"><meta charset="utf-8">
      <link rel="stylesheet" href="/foundry/css/foundry2.css">
      <link rel="stylesheet" href="/system/${index}/splittermond.css">
      <body class="game system-splittermond theme-dark">
      <dialog open class="application themed theme-light splittermond dialog dialog-check" style="left:36px;top:24px;width:450px">
        <header class="window-header"><h1 class="window-title">Handgemenge · ${templates[index].version}</h1></header>
        <section class="window-content"></section>
      </dialog><script>
        const form=document.createElement('form');form.className='dialog-form standard-form';
        form.innerHTML=${JSON.stringify('<div class="dialog-content standard-form">' + content + '</div>' + footer)};
        document.querySelector('.window-content').append(form);
        window.submissions=[];form.addEventListener('submit',e=>{e.preventDefault();submissions.push({action:e.submitter.dataset.action,values:[...new FormData(form)]});});
      </script></body></html>`;
}
const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname === "/") {
            res.setHeader("content-type", "text/html");
            res.end(dialogPage(Number(url.searchParams.get("system")), Number(url.searchParams.get("count") ?? 48))); return;
        }
        // System styles also use absolute Foundry asset URLs, e.g. /ui/parchment.jpg.
        const assetPath = /^\/(?:ui|fonts|icons)\//.test(url.pathname) ? '/foundry' + url.pathname : url.pathname;
        const match = assetPath.match(/^\/(foundry|system\/(\d+)|module)\/(.*)$/);
        if (!match) { res.writeHead(404).end(); return; }
        const base = match[1] === "foundry" ? path.join(appRoot, "public") : match[1] === "module" ? runtimeRoot : systemRoots[Number(match[2])];
        const file = path.resolve(base, decodeURIComponent(match[3]));
        if (!file.startsWith(path.resolve(base) + path.sep)) { res.writeHead(403).end(); return; }
        const types = { ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".ttf": "font/ttf", ".woff2": "font/woff2" };
        res.setHeader("content-type", types[path.extname(file)] ?? "application/octet-stream");
        res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await playwright[browserName].launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const page = await browser.newPage();
const errors = []; page.on("pageerror", error => errors.push(error.message));
const measurements = [];
async function scrollToRolls() {
    const scroller = page.locator('.window-content');
    const bounds = await scroller.boundingBox();
    await page.mouse.move(bounds.x + 24, bounds.y + bounds.height / 2);
    let reachedEnd = false;
    // Firefox can cap a single wheel event to less than the requested delta.
    for (let attempt = 0; attempt < 32 && !reachedEnd; attempt++) {
        await page.mouse.wheel(0, 800);
        await page.waitForTimeout(100);
        reachedEnd = await scroller.evaluate(el => el.scrollTop >= el.scrollHeight - el.clientHeight - 2);
    }
    assert.ok(reachedEnd, `Wheel scrolling must reach the end: ${JSON.stringify(await scroller.evaluate(el => ({
        top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight, overflow: getComputedStyle(el).overflowY,
    })))}`);
    await page.waitForFunction(() => {
        const el = document.querySelector('.window-content');
        return el.scrollTop >= el.scrollHeight - el.clientHeight - 2;
    });
    const bottom = await page.locator('[data-action="safety"]').boundingBox();
    assert.ok(bottom.y + bottom.height <= bounds.y + bounds.height, 'Roll buttons must be visible after wheel scrolling');
}
try {
    for (const [index, { version }] of templates.entries()) {
        for (const [width, height] of [[1920, 1080], [1280, 720], [800, 600]]) {
            await page.setViewportSize({ width, height });
            await page.goto(`http://127.0.0.1:${server.address().port}/?system=${index}`);
            await page.evaluate(() => document.fonts.ready);
            // ApplicationV2 clamps the positioned window to the viewport after rendering.
            await page.locator('dialog').evaluate(el => {
                const bounds = el.getBoundingClientRect();
                el.style.top = `${Math.max(0, Math.min(bounds.top, innerHeight - bounds.height))}px`;
            });
            const scroller = page.locator('.window-content');
            const baseline = await scroller.evaluate(el => ({ overflow: getComputedStyle(el).overflowY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
            assert.equal(baseline.overflow, 'hidden', 'Fixture must reproduce the native clipping bug');
            assert.ok(baseline.scrollHeight > baseline.clientHeight + 100);
            await page.addStyleTag({ url: `/module/${manifest.styles[0]}` });
            await page.waitForFunction(() => getComputedStyle(document.querySelector('.window-content')).overflowY === 'auto');
            const top = await page.locator('dialog').boundingBox();
            assert.ok(top.y + top.height <= height, `Dialog must remain within the viewport: ${JSON.stringify({top,height,css:await page.locator('dialog').evaluate(el=>({maxHeight:getComputedStyle(el).maxHeight,hotbar:getComputedStyle(el).getPropertyValue('--hotbar-height')}))})}`);
            await page.screenshot({ path: path.join(output, `${version}-${width}-top.png`) });
            await scrollToRolls();
            const last = page.locator('input[name="emphasis"]').last();
            await last.locator('..').locator('label').click();
            await scrollToRolls();
            for (const action of ['risk', 'standard', 'safety']) {
                const button = await page.locator(`[data-action="${action}"]`).boundingBox();
                await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
            }
            assert.deepEqual(await page.evaluate(() => submissions.map(entry => entry.action)), ['risk', 'standard', 'safety']);
            assert.ok(await page.evaluate(() => submissions.every(entry => entry.values.some(([key, value]) => key === 'emphasis' && value === '48'))));
            await page.screenshot({ path: path.join(output, `${version}-${width}-bottom.png`) });
            // A manual resize still permits scrolling all the way to the same native buttons.
            await page.locator('dialog').evaluate(el => { el.style.height = '300px'; });
            await scroller.evaluate(el => { el.scrollTop = 0; });
            await scrollToRolls();
            measurements.push({ version, width, height, baseline, fixed: await scroller.evaluate(el => ({ overflow: getComputedStyle(el).overflowY, scrollTop: el.scrollTop })) });
        }
        // Short dialogs keep their natural height; unrelated system dialogs are untouched.
        await page.goto(`http://127.0.0.1:${server.address().port}/?system=${index}&count=1`);
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.addStyleTag({ url: `/module/${manifest.styles[0]}` });
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.window-content')).overflowY === 'auto');
        assert.ok(await page.locator('.window-content').evaluate(el => el.scrollHeight <= el.clientHeight + 1));
        await page.locator('dialog').evaluate(el => el.classList.remove('dialog-check'));
        assert.equal(await page.locator('.window-content').evaluate(el => getComputedStyle(el).overflowY), 'hidden');
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(measurements, null, 2));
    console.log(JSON.stringify({ browserName, versions: templates.map(item => item.version), scenarios: measurements.length, output }));
} finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
}
