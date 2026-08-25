import {
    displayLabel,
    displayValue,
    t,
} from "../../shared/values.js";

import {
    spellFocusCosts,
} from "./action-tooltips.js";

export const SPELL_FILTER_THRESHOLD = 8;

export function isSpellListFilterable(spells) {
    return (spells?.length ?? 0) > SPELL_FILTER_THRESHOLD;
}

export function spellFilterDetails(spell) {
    const schoolId = String(spell?.system?.skill ?? spell?.skill?.id ?? "").trim();
    const schoolLabel = displayLabel(spell?.skill?.label, schoolId);
    const rawLevel = spell?.system?.skillLevel ?? spell?.skillLevel;
    const level = rawLevel === null || rawLevel === undefined || rawLevel === "" || !Number.isFinite(Number(rawLevel))
        ? ""
        : String(Number(rawLevel));
    return { schoolId, schoolLabel, level };
}

export function spellFilterOptions(spells) {
    const schools = new Map();
    const levels = new Set();
    for (const spell of spells ?? []) {
        const { schoolId, schoolLabel, level } = spellFilterDetails(spell);
        if (schoolId && schoolLabel) schools.set(schoolId, schoolLabel);
        if (level !== "") levels.add(level);
    }
    return {
        schools: [...schools].map(([id, label]) => ({ id, label }))
            .sort((left, right) => left.label.localeCompare(right.label, game.i18n.lang)),
        levels: [...levels].sort((left, right) => Number(left) - Number(right)),
    };
}

export function spellSearchValue(spell) {
    const { schoolId, schoolLabel, level } = spellFilterDetails(spell);
    const levelLabel = level === "" ? "" : t("SMOOTHER_FIGHT.HUD.SpellLevelValue", { level });
    return normalizeSpellSearchText([
        spell?.name,
        schoolId,
        schoolLabel,
        levelLabel,
        spellFocusCosts(spell),
        displayValue(spell?.castDuration, ""),
    ].filter((value) => value !== "").join(" "));
}

export function bindSpellListFilters(root) {
    for (const popover of root.querySelectorAll("[data-sf-spell-filterable]")) {
        const applyFilters = () => applySpellListFilters(popover);
        popover.querySelector("[data-sf-spell-search]")?.addEventListener("input", applyFilters);
        popover.querySelector("[data-sf-spell-school]")?.addEventListener("change", applyFilters);
        popover.querySelector("[data-sf-spell-level]")?.addEventListener("change", applyFilters);
        for (const button of popover.querySelectorAll("[data-sf-spell-availability]")) {
            button.addEventListener("click", () => {
                for (const candidate of popover.querySelectorAll("[data-sf-spell-availability]")) {
                    candidate.setAttribute("aria-pressed", String(candidate === button));
                }
                applyFilters();
            });
        }
    }
}

export function captureSpellListViewState(root) {
    const menu = root?.querySelector?.('details[data-sf-menu="spells"]');
    const popover = menu?.querySelector?.("[data-sf-spell-filterable]");
    if (!popover) return null;
    return {
        open: Boolean(menu.open),
        query: popover.querySelector("[data-sf-spell-search]")?.value ?? "",
        availability: selectedAvailability(popover),
        school: popover.querySelector("[data-sf-spell-school]")?.value ?? "all",
        level: popover.querySelector("[data-sf-spell-level]")?.value ?? "all",
        scrollTop: popover.querySelector("[data-sf-spell-results]")?.scrollTop ?? 0,
    };
}

export function restoreSpellListViewState(root, state) {
    if (!state) return;
    const menu = root?.querySelector?.('details[data-sf-menu="spells"]');
    const popover = menu?.querySelector?.("[data-sf-spell-filterable]");
    if (!popover) return;
    menu.open = Boolean(state.open);

    const input = popover.querySelector("[data-sf-spell-search]");
    const school = popover.querySelector("[data-sf-spell-school]");
    const level = popover.querySelector("[data-sf-spell-level]");
    if (input) input.value = state.query ?? "";
    if (school) school.value = selectValue(school, state.school);
    if (level) level.value = selectValue(level, state.level);
    for (const button of popover.querySelectorAll("[data-sf-spell-availability]")) {
        button.setAttribute("aria-pressed", String(button.dataset.sfSpellAvailability === state.availability));
    }
    applySpellListFilters(popover);

    const results = popover.querySelector("[data-sf-spell-results]");
    const restoreScroll = () => {
        if (results?.isConnected !== false) results.scrollTop = state.scrollTop ?? 0;
    };
    restoreScroll();
    globalThis.requestAnimationFrame?.(restoreScroll);
}

function applySpellListFilters(popover) {
    const input = popover.querySelector("[data-sf-spell-search]");
    const school = popover.querySelector("[data-sf-spell-school]")?.value ?? "all";
    const level = popover.querySelector("[data-sf-spell-level]")?.value ?? "all";
    const availability = selectedAvailability(popover);
    const terms = normalizeSpellSearchText(input?.value).split(/\s+/u).filter(Boolean);
    let visibleCount = 0;
    for (const row of popover.querySelectorAll("[data-sf-spell-row]")) {
        const visible = terms.every((term) => String(row.dataset.sfSearch ?? "").includes(term))
            && (availability === "all" || row.dataset.sfEnoughFocus === "true")
            && (school === "all" || row.dataset.sfSpellSchool === school)
            && (level === "all" || row.dataset.sfSpellLevel === level);
        row.hidden = !visible;
        if (visible) visibleCount += 1;
    }
    const empty = popover.querySelector("[data-sf-spell-filter-empty]");
    if (empty) empty.hidden = visibleCount > 0;
}

function selectedAvailability(popover) {
    return Array.from(popover.querySelectorAll("[data-sf-spell-availability]"))
        .find((button) => button.getAttribute?.("aria-pressed") === "true")
        ?.dataset.sfSpellAvailability ?? "all";
}

function selectValue(select, requested) {
    const value = requested ?? "all";
    return Array.from(select.options ?? []).some((option) => option.value === value) ? value : "all";
}

function normalizeSpellSearchText(value) {
    return String(value ?? "")
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .trim()
        .toLocaleLowerCase()
        .replaceAll("ß", "ss");
}
