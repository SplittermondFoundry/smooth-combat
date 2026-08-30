import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleRoot = path.join(projectRoot, "Modul", "splittermond-smoother-fight");
const stylesRoot = path.join(moduleRoot, "styles");

function readManifest() {
    return JSON.parse(fs.readFileSync(path.join(moduleRoot, "module.json"), "utf8"));
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

test("Foundry manifest entry points remain stable", () => {
    const manifest = readManifest();
    assert.equal(manifest.id, "splittermond-smoother-fight");
    assert.equal(manifest.version, "0.5.0");
    assert.deepEqual(manifest.esmodules, ["scripts/smoother-fight.js"]);
    assert.deepEqual(manifest.styles, [`styles/smoother-fight-${manifest.version}.css`]);
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
        "2d69cac3fa55c58aaae851adb08a39dbd29b5ec2502e7787832a50c7cfda6364",
    );
    const german = JSON.parse(fs.readFileSync(path.join(moduleRoot, "lang", "de.json"), "utf8"));
    assert.equal(german.SMOOTHER_FIGHT.HUD.DefenseSplinterpoint, "Splitterpunkt (+ 3 VTD)");
    assert.equal(
        german.SMOOTHER_FIGHT.HUD.DefenseSplinterpointResonance,
        "Splitterpunkt (Resonanz: weitere VTD +2 für {target})",
    );
    assert.equal(german.SMOOTHER_FIGHT.HUD.DefenseSplinterpointChatPrimaryReason, "Splitterpunkt: +3 VTD");
    assert.equal(german.SMOOTHER_FIGHT.HUD.ActiveDefenseInterruptionConfirm, "Ja");
    assert.equal(german.SMOOTHER_FIGHT.HUD.ActiveDefenseInterruptionDecline, "Nein");
    assert.equal(
        german.SMOOTHER_FIGHT.HUD.RestoreContinuousAction,
        "Kontinuierliche Handlung wiederherstellen",
    );
    assert.equal(
        german.SMOOTHER_FIGHT.HUD.DefenseSplinterpointChatResonanceReason,
        "Splitterpunkt-Resonanz: weitere +2 VTD",
    );
});

test("published DOM integration attributes remain available", () => {
    const assignmentTemplate = fs.readFileSync(path.join(moduleRoot, "templates", "user-token-links.hbs"), "utf8");
    assert.match(assignmentTemplate, /data-overview-actor-select/u);
    assert.match(assignmentTemplate, /data-overview-token-select/u);
    assert.match(assignmentTemplate, /data-role="player-assignment-status"/u);
    assert.match(assignmentTemplate, /<details class="sf-assignment-help">/u);
    const priorityRows = [...assignmentTemplate.matchAll(/<div class="sf-assignment-priority"[\s\S]*?<\/div>/gu)]
        .map((match) => match[0]);
    assert.equal(priorityRows.length, 2);
    assert.match(priorityRows[0], /PersistentAssignmentLabel[\s\S]*is-direct[\s\S]*is-sheet[\s\S]*is-owner/u);
    assert.doesNotMatch(priorityRows[0], /is-primary-gm/u);
    assert.match(priorityRows[1], /RuntimeControlLabel[\s\S]*is-assigned-user[\s\S]*is-primary-gm[\s\S]*is-active-gm/u);
    assert.match(assignmentTemplate, /data-role="assignment-warnings"[^>]*open/u);
    assert.match(assignmentTemplate, /\{\{#unless hasWarnings\}\}hidden\{\{\/unless\}\}/u);
    assert.match(assignmentTemplate, /data-role="warning-list"/u);
    assert.match(assignmentTemplate, /data-owner-permission-warning/u);
    assert.match(assignmentTemplate, /\{\{#if showSetupHint\}\}/u);

    const hudView = ["view.js", "combat-position-menu.js", "response-controls.js", "tick-action-reference.js"]
        .map((file) => fs.readFileSync(path.join(moduleRoot, "scripts", "features", "hud", file), "utf8"))
        .join("\n");
    const hudController = fs.readFileSync(path.join(moduleRoot, "scripts", "features", "hud", "controller.js"), "utf8");
    const combatEventView = fs.readFileSync(path.join(moduleRoot, "scripts", "features", "combat-events", "view.js"), "utf8");
    const chatActions = fs.readFileSync(path.join(moduleRoot, "scripts", "features", "chat", "actions.js"), "utf8");
    assert.match(hudView, /data-sf-context-actor-id/u);
    assert.match(hudView, /sf-is-primary-target/u);
    assert.match(hudView, /data-sf-action="remove-target"/u);
    assert.match(hudView, /data-sf-action="mark-target-defeated"/u);
    assert.match(hudView, /SMOOTHER_FIGHT\.HUD\.PrimaryTarget/u);
    assert.match(hudView, /\$\{buildSecondaryTargets\(context\)\}<div class="sf-primary-target-panel">/u);
    assert.match(hudView, /<details class="sf-visibility-menu/u);
    assert.match(hudView, /SMOOTHER_FIGHT\.HUD\.Visibility/u);
    assert.match(hudView, /data-sf-action="set-combat-position"/u);
    assert.match(hudView, /data-combat-position=/u);
    assert.match(hudView, /services\.resolveCombatPosition/u);
    assert.match(hudView, /<details class="sf-tick-action-reference">/u);
    assert.match(hudView, /<summary title="\$\{escapeAttr\(triggerLabel\)\}"/u);
    assert.match(hudView, /class="sf-tick-action-popover" role="region"/u);
    assert.match(hudView, /data-sf-tick-action-filter/u);
    assert.match(hudView, /data-sf-tick-action-row/u);
    assert.match(hudView, /data-sf-spell-search/u);
    assert.match(hudView, /data-sf-spell-availability/u);
    assert.match(hudView, /data-sf-spell-school/u);
    assert.match(hudView, /data-sf-spell-level/u);
    assert.match(hudView, /data-sf-action="toggle-favorite-tick-action"/u);
    assert.match(hudView, /data-sf-action="clear-attack-preparation"/u);
    assert.match(hudView, /data-sf-action="respond-active-defense"/u);
    assert.match(hudView, /data-sf-action="decline-active-defense"/u);
    assert.match(hudView, /data-sf-action="roll-continuous-action-interruption"/u);
    assert.match(hudView, /data-sf-tick-action-category="\$\{escapeAttr\(action\.displayCategory\)\}"/u);
    assert.match(hudController, /bindTickActionReferenceFilters/u);
    assert.match(hudController, /bindSpellListFilters/u);
    assert.match(hudController, /case "toggle-favorite-tick-action"/u);
    assert.match(hudController, /case "clear-attack-preparation"/u);
    assert.match(hudController, /case "mark-target-defeated"/u);
    assert.match(hudController, /case "toggle-combatant-defeated":\s*await services\.requireGm\(\(\) => setCombatantDefeatedWithOverlay\(/u);
    assert.match(hudController, /case "set-combat-position"/u);
    assert.match(hudController, /services\.setCombatPosition\(context\.actor, target\.dataset\.combatPosition\)/u);
    assert.match(hudController, /action === "respond-active-defense"/u);
    assert.match(hudController, /action === "decline-active-defense"/u);
    assert.match(hudController, /case "roll-continuous-action-interruption"/u);
    assert.doesNotMatch(hudView, /sf-tick-action-tooltip/u);
    assert.doesNotMatch(hudView, /role="tooltip"[^`]*data-sf-action="share-tick-action"/u);
    assert.match(hudView, /data-sf-action="share-tick-action"/u);
    assert.match(hudView, /class="sf-tick-action-source"/u);
    assert.match(hudView, /<button type="button" class="sf-portrait-open"/u);
    assert.match(hudView, /<button type="button" class="sf-portrait-focus" data-sf-action="show-token"/u);
    assert.match(hudView, /const image = actor\?\.img \|\| token\?\.texture\?\.src \|\| "icons\/svg\/mystery-man\.svg";/u);
    assert.match(hudView, /<img class="sf-portrait-art" src="\$\{escapeAttr\(image\)\}" alt="" aria-hidden="true">/u);
    assert.doesNotMatch(hudView, /--sf-token-image:url/u);
    assert.match(hudView, /data-token-uuid="\$\{escapeAttr\(token\.uuid\)\}"/u);
    assert.match(hudView, /class="sf-visually-hidden"/u);
    assert.match(hudView, /<summary title="\$\{escapeAttr\(label\)\}" aria-label="\$\{escapeAttr\(label\)\}"/u);
    assert.doesNotMatch(hudView, /role="button" tabindex="0"/u);
    assert.match(hudController, /closest\("\.sf-portrait\[data-sf-token-uuid\]"\)/u);
    assert.match(hudController, /case "show-token":\s*services\.showTokenOnCanvas\(services\.resolveToken\(target\.dataset\.tokenUuid\)\)/u);
    assert.equal((hudView.match(/data-sf-action="toggle-token-hidden"/gu) ?? []).length, 1);
    assert.equal((hudView.match(/data-sf-action="toggle-combatant-hidden"/gu) ?? []).length, 1);
    assert.equal((hudView.match(/data-sf-action="toggle-combatant-visibility"/gu) ?? []).length, 1);
    assert.match(combatEventView, /data-subevent-actor-id/u);
    assert.match(hudView, /buildAttackControlMarkup\(context\.actor, \{\s*meleeOnly: true,\s*rangeMeasurement: targetDistance\.measurement,\s*\}\)/u);
    assert.match(hudView, /filter\(\(attack\) => !meleeOnly \|\| !services\.isRangedAttack\(attack\)\)/u);
    assert.match(chatActions, /if \(!mayRollFumble\) removeCombatFumbleRollControls\(element\)/u);
    assert.match(chatActions, /isMessageSpeakerAssignedToCurrentUser\(message\)/u);
    assert.match(chatActions, /dataset\.sfAction = "use-defense-splinterpoint"/u);
    assert.match(chatActions, /sf-splinterpoint-resonance-action/u);
    assert.match(chatActions, /className = "sf-chat-defense-response"/u);
    assert.match(chatActions, /className = "sf-chat-decline-defense"/u);
    assert.match(chatActions, /SMOOTHER_FIGHT\.HUD\.DefenseDecisionPendingHint/u);
});

test("the local HUD demo loads the manifest stylesheet entry", () => {
    const manifest = readManifest();
    const demo = fs.readFileSync(path.join(projectRoot, "demo", "index.html"), "utf8");
    assert.ok(demo.includes(`href="../Modul/splittermond-smoother-fight/${manifest.styles[0]}"`));
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
    const manifest = readManifest();
    const versionedWrapper = path.posix.basename(manifest.styles[0]);
    const compatibilityWrapper = fs.readFileSync(path.join(stylesRoot, "smoother-fight.css"), "utf8");
    assert.equal(compatibilityWrapper, `@import url("./${versionedWrapper}?module=${manifest.version}");\n`);
});

test("only the current versioned stylesheet wrapper is shipped", () => {
    const manifest = readManifest();
    const expectedWrapper = path.posix.basename(manifest.styles[0]);
    const versionedWrappers = fs.readdirSync(stylesRoot)
        .filter((name) => /^smoother-fight-\d+\.\d+\.\d+\.css$/u.test(name))
        .sort();
    assert.equal(expectedWrapper, `smoother-fight-${manifest.version}.css`);
    assert.deepEqual(versionedWrappers, [expectedWrapper]);
});

test("split styles flatten in the verified cascade order", () => {
    const manifest = readManifest();
    const wrapperPath = path.join(moduleRoot, ...manifest.styles[0].split("/"));
    const wrapper = fs.readFileSync(wrapperPath, "utf8");
    const importPattern = new RegExp(
        `@import\\s+url\\("\\.\\/([^"?]+)\\?module=${escapeRegExp(manifest.version)}"\\);`,
        "gu",
    );
    const imports = [...wrapper.matchAll(importPattern)]
        .map((match) => match[1]);
    assert.deepEqual(imports, ["themes/default.css", "hud.css", "combat-events.css", "settings.css", "responsive.css"]);
    const flattened = Buffer.concat(imports.map((file) => fs.readFileSync(path.join(moduleRoot, "styles", file))));
    const flattenedCss = flattened.toString("utf8");
    assert.match(flattenedCss, /--sf-font-meta:\s*10px/u);
    assert.match(flattenedCss, /--sf-font-control:\s*12px/u);
    assert.match(flattenedCss, /\.sf-portrait-open/u);
    assert.match(flattenedCss, /\.sf-portrait-focus/u);
    assert.match(flattenedCss, /\.sf-portrait-art\s*\{[^}]*object-fit:\s*cover/su);
    assert.match(flattenedCss, /\.sf-portrait-image::after\s*\{[^}]*linear-gradient/su);
    assert.match(flattenedCss, /--sf-side-panel-width:\s*172px/u);
    assert.match(flattenedCss, /--sf-portrait-height:\s*246px/u);
    assert.match(flattenedCss, /--sf-portrait-header-height:\s*34px/u);
    assert.match(flattenedCss, /\.sf-portrait-header\s*\{[^}]*height:\s*var\(--sf-portrait-header-height\)/su);
    assert.match(
        flattenedCss,
        /\.sf-movement-sections\s*\{[^}]*grid-template-columns:\s*max-content minmax\(max-content, 1fr\) minmax\(max-content, 3fr\)/su,
    );
    assert.match(flattenedCss, /\.sf-movement-section::before\s*\{[^}]*width:\s*var\(--sf-movement-fill, 0%\)/su);
    assert.match(flattenedCss, /\.sf-prepared-spell-menu\s*\{[^}]*container-name:\s*sf-prepared-action/su);
    assert.match(flattenedCss, /@container sf-prepared-action \(max-width:\s*260px\)[^{]*\{[^}]*\.sf-prepared-spell-cast b span[^}]*display:\s*none/su);
    assert.doesNotMatch(flattenedCss, /font-size:\s*[78]px/u);
    assert.match(flattenedCss, /\.sf-splinterpoint-resonance-action/u);
    assert.equal(
        crypto.createHash("sha256").update(flattened).digest("hex"),
        "414eb602dcea67ab94ed73328309112e39eaabf93b9d726ac392d842d9944a4e",
    );
});

test("customizable media assets remain recognizable files", () => {
    const expectedAssets = {
        backgrounds: ["hud-dark.jpg", "hud-light.jpg"],
        audio: ["arcane.wav", "blocked.wav", "impact.wav", "shield.wav", "shot.wav", "turn.wav"],
        icons: ["active-defense.svg", "continuous-action.svg", "damage-blocked.svg", "damage.svg", "movement-action.svg", "ranged.svg", "spell.svg", "turn.svg"],
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
