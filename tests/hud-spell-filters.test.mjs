import test from "node:test";
import assert from "node:assert/strict";

import {
    SPELL_FILTER_THRESHOLD,
    bindSpellListFilters,
    captureSpellListViewState,
    isSpellListFilterable,
    restoreSpellListViewState,
    spellFilterOptions,
    spellSearchValue,
} from "../Modul/splittermond-smoother-fight/scripts/features/hud/spell-filters.js";

test("spell filters start above eight spells and expose system schools and levels", (context) => {
    installGame(context);
    assert.equal(SPELL_FILTER_THRESHOLD, 8);
    assert.equal(isSpellListFilterable(Array.from({ length: 8 })), false);
    assert.equal(isSpellListFilterable(Array.from({ length: 9 })), true);

    const spells = [
        spell("Flammensäule", "firemagic", "Feuermagie", 2, true, "K4", "8 T"),
        spell("Wasserlauf", "watermagic", "Wassermagie", 0, false, "2", "4 T"),
        spell("Funken", "firemagic", "Feuermagie", 0, true, "1", "2 T"),
    ];
    assert.deepEqual(spellFilterOptions(spells), {
        schools: [
            { id: "firemagic", label: "Feuermagie" },
            { id: "watermagic", label: "Wassermagie" },
        ],
        levels: ["0", "2"],
    });
    assert.match(spellSearchValue(spells[0]), /flammensaule/u);
    assert.match(spellSearchValue(spells[0]), /feuermagie/u);
    assert.match(spellSearchValue(spells[0]), /grad 2/u);
    assert.match(spellSearchValue(spells[0]), /k4 8 t/u);
});

test("spell search combines text, available focus, school, and level", (context) => {
    installGame(context);
    const fixture = spellFilterFixture();
    bindSpellListFilters({
        querySelectorAll: (selector) => selector === "[data-sf-spell-filterable]" ? [fixture.popover] : [],
    });

    fixture.input.value = "FLAMMENSÄULE";
    fixture.input.emit("input");
    assert.deepEqual(fixture.rows.map((row) => row.hidden), [false, true, true]);

    fixture.input.value = "";
    fixture.availability[1].emit("click");
    assert.deepEqual(fixture.rows.map((row) => row.hidden), [false, true, false]);
    assert.deepEqual(fixture.availability.map((button) => button.getAttribute("aria-pressed")), ["false", "true"]);

    fixture.school.value = "watermagic";
    fixture.school.emit("change");
    assert.deepEqual(fixture.rows.map((row) => row.hidden), [true, true, true]);
    assert.equal(fixture.empty.hidden, false);

    fixture.availability[0].emit("click");
    assert.deepEqual(fixture.rows.map((row) => row.hidden), [true, false, true]);
    fixture.level.value = "2";
    fixture.level.emit("change");
    assert.deepEqual(fixture.rows.map((row) => row.hidden), [true, false, true]);
    assert.equal(fixture.empty.hidden, true);
});

test("spell filter state survives a HUD rerender for the same actor", (context) => {
    installGame(context);
    const before = spellFilterFixture();
    before.menu.open = true;
    before.input.value = "wasser";
    before.availability[0].setAttribute("aria-pressed", "false");
    before.availability[1].setAttribute("aria-pressed", "true");
    before.school.value = "watermagic";
    before.level.value = "2";
    before.results.scrollTop = 63;
    assert.deepEqual(captureSpellListViewState(before.root), {
        open: true,
        query: "wasser",
        availability: "focus",
        school: "watermagic",
        level: "2",
        scrollTop: 63,
    });

    const after = spellFilterFixture();
    restoreSpellListViewState(after.root, captureSpellListViewState(before.root));
    assert.equal(after.menu.open, true);
    assert.equal(after.input.value, "wasser");
    assert.deepEqual(after.availability.map((button) => button.getAttribute("aria-pressed")), ["false", "true"]);
    assert.equal(after.school.value, "watermagic");
    assert.equal(after.level.value, "2");
    assert.equal(after.results.scrollTop, 63);
    assert.deepEqual(after.rows.map((row) => row.hidden), [true, true, true]);
    assert.equal(after.empty.hidden, false);
});

function spellFilterFixture() {
    const input = control("");
    const school = control("all", {}, ["all", "firemagic", "watermagic"]);
    const level = control("all", {}, ["all", "0", "2"]);
    const availability = [
        control("", { sfSpellAvailability: "all" }, [], { "aria-pressed": "true" }),
        control("", { sfSpellAvailability: "focus" }, [], { "aria-pressed": "false" }),
    ];
    const rows = [
        row("flammensaule feuermagie grad 2 k4 8 t", true, "firemagic", "2"),
        row("wasserlauf wassermagie grad 2 2 4 t", false, "watermagic", "2"),
        row("funken feuermagie grad 0 1 2 t", true, "firemagic", "0"),
    ];
    const empty = { hidden: true };
    const results = { scrollTop: 0, isConnected: true };
    const popover = {
        querySelector: (selector) => ({
            "[data-sf-spell-search]": input,
            "[data-sf-spell-school]": school,
            "[data-sf-spell-level]": level,
            "[data-sf-spell-filter-empty]": empty,
            "[data-sf-spell-results]": results,
        })[selector] ?? null,
        querySelectorAll: (selector) => ({
            "[data-sf-spell-availability]": availability,
            "[data-sf-spell-row]": rows,
        })[selector] ?? [],
    };
    const menu = {
        open: false,
        querySelector: (selector) => selector === "[data-sf-spell-filterable]" ? popover : null,
    };
    const root = {
        querySelector: (selector) => selector === 'details[data-sf-menu="spells"]' ? menu : null,
    };
    return { availability, empty, input, level, menu, popover, results, root, rows, school };
}

function control(value, dataset = {}, optionValues = [], attributes = {}) {
    const listeners = new Map();
    return {
        value,
        dataset,
        options: optionValues.map((optionValue) => ({ value: optionValue })),
        addEventListener: (event, listener) => listeners.set(event, listener),
        emit: (event) => listeners.get(event)?.(),
        getAttribute: (name) => attributes[name] ?? null,
        setAttribute: (name, newValue) => { attributes[name] = newValue; },
    };
}

function row(search, enoughFocus, school, level) {
    return {
        dataset: {
            sfSearch: search,
            sfEnoughFocus: String(enoughFocus),
            sfSpellSchool: school,
            sfSpellLevel: level,
        },
        hidden: false,
    };
}

function spell(name, schoolId, schoolLabel, level, enoughFocus, costs, castDuration) {
    return {
        name,
        skill: { id: schoolId, label: schoolLabel },
        system: { skill: schoolId, skillLevel: level, costs },
        costs,
        castDuration: { display: castDuration },
        enoughFocus,
    };
}

function installGame(context) {
    const previousGame = globalThis.game;
    globalThis.game = {
        i18n: {
            lang: "de",
            localize: (value) => value,
            format: (key, data) => key === "SMOOTHER_FIGHT.HUD.SpellLevelValue" ? `Grad ${data.level}` : key,
        },
    };
    context.after(() => {
        if (previousGame === undefined) delete globalThis.game;
        else globalThis.game = previousGame;
    });
}
