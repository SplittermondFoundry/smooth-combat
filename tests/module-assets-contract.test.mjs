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
        "8d880e7ed232ece3f4dde3fe0f473c9895ab20fce82d03a41bebd2cd369f22f3",
    );
});

test("published DOM integration attributes remain available", () => {
    const assignmentTemplate = fs.readFileSync(path.join(moduleRoot, "templates", "user-token-links.hbs"), "utf8");
    assert.match(assignmentTemplate, /data-overview-actor-select/u);
    assert.match(assignmentTemplate, /data-overview-token-select/u);

    const hudView = fs.readFileSync(path.join(moduleRoot, "scripts", "features", "hud", "view.js"), "utf8");
    const combatEventView = fs.readFileSync(path.join(moduleRoot, "scripts", "features", "combat-events", "view.js"), "utf8");
    assert.match(hudView, /data-sf-context-actor-id/u);
    assert.match(hudView, /sf-is-primary-target/u);
    assert.match(hudView, /data-sf-action="remove-target"/u);
    assert.match(hudView, /SMOOTHER_FIGHT\.HUD\.PrimaryTarget/u);
    assert.match(hudView, /\$\{buildSecondaryTargets\(context\)\}<div class="sf-primary-target-panel">/u);
    assert.match(combatEventView, /data-subevent-actor-id/u);
});

test("the local HUD demo loads the manifest stylesheet entry", () => {
    const demo = fs.readFileSync(path.join(projectRoot, "demo", "index.html"), "utf8");
    assert.match(demo, /href="\.\.\/Modul\/splittermond-smoother-fight\/styles\/smoother-fight-0\.3\.57\.css"/u);
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
    assert.equal(
        crypto.createHash("sha256").update(flattened).digest("hex"),
        "7c7c11c349da80fe592b7101d61e361ff0338a25397594cd79a16a9358c89d6b",
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
