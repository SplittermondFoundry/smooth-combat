import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleRoot = path.join(projectRoot, "Modul", "splittermond-smoother-fight");

test("Foundry manifest entry points remain stable", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(moduleRoot, "module.json"), "utf8"));
    assert.equal(manifest.id, "splittermond-smoother-fight");
    assert.equal(manifest.version, "0.3.57");
    assert.deepEqual(manifest.esmodules, ["scripts/smoother-fight.js"]);
    assert.deepEqual(manifest.styles, ["styles/smoother-fight-0.3.57.css"]);
    assert.equal(manifest.socket, true);
    assert.deepEqual(manifest.languages.map(({ lang, path: languagePath }) => [lang, languagePath]), [
        ["de", "lang/de.json"],
        ["en", "lang/en.json"],
    ]);

    const translationKeys = manifest.languages.map(({ path: languagePath }) => {
        const language = JSON.parse(fs.readFileSync(path.join(moduleRoot, languagePath), "utf8"));
        const flatten = (value, prefix = "") => Object.entries(value).flatMap(([key, entry]) => {
            const qualified = prefix ? `${prefix}.${key}` : key;
            return entry && typeof entry === "object" && !Array.isArray(entry)
                ? flatten(entry, qualified)
                : [qualified];
        });
        return flatten(language).sort();
    });
    assert.deepEqual(translationKeys[0], translationKeys[1]);
    assert.equal(
        crypto.createHash("sha256").update(translationKeys[0].join("\n")).digest("hex"),
        "e6e186546597279be161461f08104e0e3284a4fb361690454403e5afd9c30c6a",
    );
});

test("published DOM integration attributes remain available", () => {
    const assignmentTemplate = fs.readFileSync(path.join(moduleRoot, "templates", "user-token-links.hbs"), "utf8");
    assert.match(assignmentTemplate, /data-overview-actor-select/u);
    assert.match(assignmentTemplate, /data-overview-token-select/u);

    const hudView = fs.readFileSync(path.join(moduleRoot, "scripts", "features", "hud", "view.js"), "utf8");
    const hudController = fs.readFileSync(path.join(moduleRoot, "scripts", "features", "hud", "controller.js"), "utf8");
    const combatEventView = fs.readFileSync(path.join(moduleRoot, "scripts", "features", "combat-events", "view.js"), "utf8");
    assert.match(hudView, /data-sf-context-actor-id/u);
    assert.match(hudView, /sf-is-primary-target/u);
    assert.match(hudView, /data-sf-action="remove-target"/u);
    assert.match(hudView, /SMOOTHER_FIGHT\.HUD\.PrimaryTarget/u);
    assert.match(hudView, /\$\{buildSecondaryTargets\(context\)\}<div class="sf-primary-target-panel">/u);
    assert.match(hudView, /<details class="sf-visibility-menu/u);
    assert.match(hudView, /SMOOTHER_FIGHT\.HUD\.Visibility/u);
    assert.match(hudView, /<details class="sf-tick-action-reference">/u);
    assert.match(hudView, /<summary title="\$\{escapeAttr\(triggerLabel\)\}"/u);
    assert.match(hudView, /class="sf-tick-action-popover" role="region"/u);
    assert.doesNotMatch(hudView, /sf-tick-action-tooltip/u);
    assert.doesNotMatch(hudView, /role="tooltip"[^`]*data-sf-action="share-tick-action"/u);
    assert.match(hudView, /data-sf-action="share-tick-action"/u);
    assert.match(hudView, /class="sf-tick-action-source"/u);
    assert.match(hudView, /<button type="button" class="sf-portrait-open"/u);
    assert.match(hudView, /<button type="button" class="sf-portrait-focus" data-sf-action="show-token"/u);
    assert.match(hudView, /data-token-uuid="\$\{escapeAttr\(token\.uuid\)\}"/u);
    assert.match(hudView, /class="sf-visually-hidden"/u);
    assert.match(hudView, /<summary title="\$\{escapeAttr\(label\)\}" aria-label="\$\{escapeAttr\(label\)\}"/u);
    assert.doesNotMatch(hudView, /role="button" tabindex="0"/u);
    assert.match(hudController, /closest\("\.sf-portrait\[data-sf-token-uuid\]"\)/u);
    assert.match(hudController, /case "show-token":\s*services\.showTokenOnCanvas\(services\.resolveToken\(target\.dataset\.tokenUuid\)\)/u);
    assert.equal((hudView.match(/data-sf-action="toggle-token-hidden"/gu) ?? []).length, 1);
    assert.equal((hudView.match(/data-sf-action="toggle-combatant-hidden"/gu) ?? []).length, 1);
    assert.equal((hudView.match(/data-sf-action="toggle-combatant-visibility"/gu) ?? []).length, 1);
    assert.doesNotMatch(hudView, /sf-defense-pills" aria-hidden="true"/u);
    assert.match(combatEventView, /data-subevent-actor-id/u);
});

test("the local HUD demo loads the manifest stylesheet entry", () => {
    const demo = fs.readFileSync(path.join(projectRoot, "demo", "index.html"), "utf8");
    assert.match(demo, /href="\.\.\/Modul\/splittermond-smoother-fight\/styles\/smoother-fight-0\.3\.57\.css"/u);
});

test("the compact HUD retains mechanical status and summarizes secondary targets", () => {
    const hudView = fs.readFileSync(path.join(moduleRoot, "scripts", "features", "hud", "view.js"), "utf8");
    const responsive = fs.readFileSync(path.join(moduleRoot, "styles", "responsive.css"), "utf8");
    assert.match(hudView, /<b>\+\$\{secondaryTargets\.length\}<\/b>/u);
    assert.doesNotMatch(responsive, /\.sf-actor \.sf-defense-row,\s*#splittermond-smoother-fight-hud \.sf-resources,\s*#splittermond-smoother-fight-hud \.sf-turn-target\s*\{\s*display:\s*none/u);
    assert.match(responsive, /\.sf-turn-target\s*\{[^}]*font-size:\s*var\(--sf-font-small\)/su);
    assert.match(responsive, /\.sf-resources\s*\{[^}]*grid-template-columns:\s*1fr/su);
});

test("the legacy stylesheet URL remains a compatible entry point", () => {
    const compatibilityWrapper = fs.readFileSync(path.join(moduleRoot, "styles", "smoother-fight.css"), "utf8");
    assert.equal(compatibilityWrapper, '@import url("./smoother-fight-0.3.57.css?module=0.3.57");\n');
});

test("split styles flatten in the verified cascade order", () => {
    const wrapperPath = path.join(moduleRoot, "styles", "smoother-fight-0.3.57.css");
    const wrapper = fs.readFileSync(wrapperPath, "utf8");
    const imports = [...wrapper.matchAll(/@import\s+url\("\.\/([^"?]+)\?module=0\.3\.57"\);/gu)]
        .map((match) => match[1]);
    assert.deepEqual(imports, ["themes/default.css", "hud.css", "combat-events.css", "settings.css", "responsive.css"]);
    const flattened = Buffer.concat(imports.map((file) => fs.readFileSync(path.join(moduleRoot, "styles", file))));
    const flattenedCss = flattened.toString("utf8");
    assert.match(flattenedCss, /--sf-font-meta:\s*10px/u);
    assert.match(flattenedCss, /--sf-font-control:\s*12px/u);
    assert.match(flattenedCss, /\.sf-portrait-open/u);
    assert.match(flattenedCss, /\.sf-portrait-focus/u);
    assert.match(flattenedCss, /--sf-side-panel-width:\s*172px/u);
    assert.match(flattenedCss, /--sf-portrait-height:\s*212px/u);
    assert.doesNotMatch(flattenedCss, /font-size:\s*[78]px/u);
    assert.equal(
        crypto.createHash("sha256").update(flattened).digest("hex"),
        "15b57ed58492d8bc4804a67264bf24c6809cc7b0b50ffd7baf63f486a6c69e08",
    );
});

test("customizable media assets remain recognizable files", () => {
    const expectedAssets = {
        backgrounds: ["hud-dark.jpg", "hud-light.jpg"],
        audio: ["arcane.wav", "blocked.wav", "impact.wav", "shield.wav", "shot.wav", "turn.wav"],
        icons: ["active-defense.svg", "damage-blocked.svg", "damage.svg", "ranged.svg", "spell.svg", "turn.svg"],
    };
    for (const [directory, names] of Object.entries(expectedAssets)) {
        assert.deepEqual(fs.readdirSync(path.join(moduleRoot, "assets", directory)).filter((name) => name !== "README.md").sort(), names);
    }
    for (const name of expectedAssets.backgrounds) {
        const image = fs.readFileSync(path.join(moduleRoot, "assets", "backgrounds", name));
        assert.deepEqual([...image.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    }
    for (const name of expectedAssets.audio) {
        const audio = fs.readFileSync(path.join(moduleRoot, "assets", "audio", name));
        assert.equal(audio.toString("ascii", 0, 4), "RIFF");
        assert.equal(audio.toString("ascii", 8, 12), "WAVE");
    }
    for (const name of expectedAssets.icons) {
        assert.match(fs.readFileSync(path.join(moduleRoot, "assets", "icons", name), "utf8"), /^<svg\b/u);
    }
});

test("runtime defaults reference every bundled media file", async () => {
    const constantsUrl = pathToFileURL(path.join(moduleRoot, "scripts", "core", "constants.js"));
    const { AUDIO_SOUND_PROFILES, DEFAULT_ASSETS } = await import(`${constantsUrl.href}?asset-contract`);
    assert.deepEqual(Object.values(DEFAULT_ASSETS.backgrounds), [
        "modules/splittermond-smoother-fight/assets/backgrounds/hud-dark.jpg",
        "modules/splittermond-smoother-fight/assets/backgrounds/hud-light.jpg",
    ]);
    assert.deepEqual(Object.values(DEFAULT_ASSETS.icons), [
        "modules/splittermond-smoother-fight/assets/icons/active-defense.svg",
        "modules/splittermond-smoother-fight/assets/icons/damage.svg",
        "modules/splittermond-smoother-fight/assets/icons/damage-blocked.svg",
        "modules/splittermond-smoother-fight/assets/icons/spell.svg",
        "modules/splittermond-smoother-fight/assets/icons/ranged.svg",
        "modules/splittermond-smoother-fight/assets/icons/turn.svg",
    ]);
    assert.deepEqual(Object.values(AUDIO_SOUND_PROFILES).map(({ src }) => src), [
        "modules/splittermond-smoother-fight/assets/audio/shield.wav",
        "modules/splittermond-smoother-fight/assets/audio/impact.wav",
        "modules/splittermond-smoother-fight/assets/audio/blocked.wav",
        "modules/splittermond-smoother-fight/assets/audio/arcane.wav",
        "modules/splittermond-smoother-fight/assets/audio/shot.wav",
        "modules/splittermond-smoother-fight/assets/audio/turn.wav",
    ]);
    const theme = fs.readFileSync(path.join(moduleRoot, "styles", "themes", "default.css"), "utf8");
    for (const relativePath of [
        "backgrounds/hud-dark.jpg",
        "backgrounds/hud-light.jpg",
        "icons/active-defense.svg",
        "icons/damage.svg",
        "icons/damage-blocked.svg",
        "icons/spell.svg",
        "icons/ranged.svg",
        "icons/turn.svg",
    ]) {
        assert.ok(theme.includes(`url("../assets/${relativePath}")`));
    }
});
