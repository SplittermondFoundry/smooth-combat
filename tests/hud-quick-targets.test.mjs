import test from "node:test";
import assert from "node:assert/strict";

import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";

import {
    QUICK_TARGET_STRUCTURE_THRESHOLD,
    bindQuickTargetSearch,
    buildQuickTargets,
    orderQuickTargetCandidates,
    quickTargetActorKind,
    quickTargetLabels,
    quickTargetSearchValue,
} from "../Modul/splittermond-smoother-fight/scripts/features/hud/quick-targets.js";

test("quick targets stay flat through eight candidates and gain structure above the threshold", (context) => {
    const previousGame = globalThis.game;
    globalThis.game = {
        i18n: {
            format: (key, data) => `${key}:${data?.target ?? ""}`,
            localize: (key) => key,
        },
    };
    context.after(() => {
        if (previousGame === undefined) delete globalThis.game;
        else globalThis.game = previousGame;
    });

    const candidates = Array.from({ length: QUICK_TARGET_STRUCTURE_THRESHOLD + 1 }, (_, index) => token(index));
    services.getTargetSceneTokens = () => candidates;
    services.resolveCombatantToken = (combatant) => combatant.token;
    services.tokenUuid = (candidate) => candidate?.uuid ?? null;

    const baseContext = {
        combat: { combatants: [{ token: candidates[0] }, { token: candidates[1] }] },
        target: candidates[4],
        targets: [candidates[7], candidates[4]],
        token: { uuid: "Token.active" },
    };
    const structured = buildQuickTargets(baseContext);
    assert.match(structured, /class="sf-quick-targets is-structured"/u);
    assert.match(structured, /data-sf-quick-target-search/u);
    assert.match(structured, /data-sf-quick-target-filter="character"/u);
    assert.match(structured, /data-sf-quick-target-filter="npc"/u);
    assert.match(structured, /data-sf-quick-target-actor-group="character"/u);
    assert.match(structured, /data-sf-quick-target-actor-group="npc"/u);
    assert.match(structured, /SMOOTHER_FIGHT\.HUD\.TargetsInCombat/u);
    assert.match(structured, /SMOOTHER_FIGHT\.HUD\.OtherSceneTargets/u);
    assert.ok(structured.indexOf("Token 5") < structured.indexOf("Token 8"), "primary target precedes other selected targets");

    services.getTargetSceneTokens = () => candidates.slice(0, QUICK_TARGET_STRUCTURE_THRESHOLD);
    const flat = buildQuickTargets({ ...baseContext, targets: [], target: null });
    assert.match(flat, /class="sf-quick-targets"/u);
    assert.doesNotMatch(flat, /is-structured|data-sf-quick-target-search|data-sf-quick-target-group/u);
});

test("quick target search filters case-insensitively and hides empty groups", () => {
    const rows = [
        { dataset: { sfSearch: "wolf moon beast", sfActorKind: "character" }, hidden: false },
        { dataset: { sfSearch: "rattling plünderer", sfActorKind: "npc" }, hidden: false },
    ];
    const actorGroups = rows.map((row) => ({
        hidden: false,
        querySelectorAll: () => [row],
    }));
    const groups = [{
        hidden: false,
        querySelectorAll: () => rows,
    }];
    const filters = ["all", "character", "npc"].map((kind) => ({
        dataset: { sfQuickTargetFilter: kind },
        pressed: null,
        addEventListener: (_event, listener) => { filters.find((entry) => entry.dataset.sfQuickTargetFilter === kind).click = listener; },
        setAttribute: (_name, value) => { filters.find((entry) => entry.dataset.sfQuickTargetFilter === kind).pressed = value; },
    }));
    const empty = { hidden: true };
    const popover = {
        querySelectorAll: (selector) => ({
            "[data-sf-quick-target-row]": rows,
            "[data-sf-quick-target-actor-group]": actorGroups,
            "[data-sf-quick-target-group]": groups,
            "[data-sf-quick-target-filter]": filters,
        })[selector] ?? [],
        querySelector: () => empty,
    };
    let onInput = null;
    const input = {
        value: "",
        closest: () => popover,
        addEventListener: (_event, listener) => { onInput = listener; },
    };
    bindQuickTargetSearch({ querySelectorAll: () => [input] });

    input.value = "MOON BEAST";
    onInput();
    assert.deepEqual(rows.map((row) => row.hidden), [false, true]);
    assert.deepEqual(actorGroups.map((group) => group.hidden), [false, true]);
    assert.equal(groups[0].hidden, false);
    assert.equal(empty.hidden, true);

    input.value = "";
    filters[2].click();
    assert.deepEqual(rows.map((row) => row.hidden), [true, false]);
    assert.deepEqual(filters.map((filter) => filter.pressed), ["false", "false", "true"]);

    input.value = "dragon";
    onInput();
    assert.equal(groups[0].hidden, true);
    assert.equal(empty.hidden, false);
});

test("quick target helpers prioritize selections, number duplicate token names, and search actor names", () => {
    const candidates = [
        token(0, "Rattling", "Raider"),
        token(1, "Wolf", "Moon Beast"),
        token(2, "rattling", "Scout"),
        token(3, "Rattling", "Warrior"),
    ];
    assert.deepEqual(orderQuickTargetCandidates(candidates, new Set([candidates[1].uuid, candidates[3].uuid]), candidates[3].uuid), [
        candidates[3], candidates[1], candidates[0], candidates[2],
    ]);
    assert.deepEqual([...quickTargetLabels(candidates).values()], [
        "Rattling · 1/3", "Wolf", "rattling · 2/3", "Rattling · 3/3",
    ]);
    assert.equal(quickTargetSearchValue(candidates[1]), "wolf moon beast");
    assert.ok(quickTargetSearchValue(candidates[1]).includes("moon beast"));
    assert.equal(quickTargetActorKind(candidates[0]), "character");
    assert.equal(quickTargetActorKind(candidates[1]), "npc");
    assert.equal(quickTargetActorKind({ actor: { type: "unknown" } }), "npc");
});

function token(index, name = `Token ${index + 1}`, actorName = `Actor ${index + 1}`) {
    return {
        uuid: `Token.${index + 1}`,
        name,
        texture: { src: `token-${index + 1}.webp` },
        actor: { name: actorName, img: `actor-${index + 1}.webp`, type: index % 2 === 0 ? "character" : "npc" },
    };
}
