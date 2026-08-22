import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleRoot = path.join(projectRoot, "Modul", "splittermond-smoother-fight");

test("Foundry manifest entry points remain stable", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(moduleRoot, "module.json"), "utf8"));
    assert.equal(manifest.id, "splittermond-smoother-fight");
    assert.deepEqual(manifest.esmodules, ["scripts/smoother-fight.js"]);
    assert.deepEqual(manifest.styles, ["styles/smoother-fight-0.3.56.css"]);
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
        "c2019635bb5fb6785b24b65aebb520b4436c79bd0588a2c5322a1aaaffee05b7",
    );
});

test("published DOM integration attributes remain available", () => {
    const assignmentTemplate = fs.readFileSync(path.join(moduleRoot, "templates", "user-token-links.hbs"), "utf8");
    assert.match(assignmentTemplate, /data-overview-actor-select/u);
    assert.match(assignmentTemplate, /data-overview-token-select/u);

    const hudView = fs.readFileSync(path.join(moduleRoot, "scripts", "features", "hud", "view.js"), "utf8");
    const combatEventView = fs.readFileSync(path.join(moduleRoot, "scripts", "features", "combat-events", "view.js"), "utf8");
    assert.match(hudView, /data-sf-context-actor-id/u);
    assert.match(combatEventView, /data-subevent-actor-id/u);
});

test("the local HUD demo loads the manifest stylesheet entry", () => {
    const demo = fs.readFileSync(path.join(projectRoot, "demo", "index.html"), "utf8");
    assert.match(demo, /href="\.\.\/Modul\/splittermond-smoother-fight\/styles\/smoother-fight-0\.3\.56\.css"/u);
});

test("the legacy stylesheet URL remains a compatible entry point", () => {
    const compatibilityWrapper = fs.readFileSync(path.join(moduleRoot, "styles", "smoother-fight.css"), "utf8");
    assert.equal(compatibilityWrapper, '@import url("./smoother-fight-0.3.56.css?module=0.3.56");\n');
});

test("split styles flatten in the verified cascade order", () => {
    const wrapperPath = path.join(moduleRoot, "styles", "smoother-fight-0.3.56.css");
    const wrapper = fs.readFileSync(wrapperPath, "utf8");
    const imports = [...wrapper.matchAll(/@import\s+url\("\.\/([^"?]+)\?module=0\.3\.56"\);/gu)]
        .map((match) => match[1]);
    assert.deepEqual(imports, ["hud.css", "combat-events.css", "settings.css", "responsive.css"]);
    const flattened = Buffer.concat(imports.map((file) => fs.readFileSync(path.join(moduleRoot, "styles", file))));
    assert.equal(
        crypto.createHash("sha256").update(flattened).digest("hex"),
        "25ee6cd83a94c3ffaad337aa53120ae3587200583163eaf757350d8f1b69a854",
    );
});
