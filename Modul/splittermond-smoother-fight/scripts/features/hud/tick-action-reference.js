import {
    combatTickActionsFor,
    normalizeFavoriteTickActionIds,
} from "../../combat-rules.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    escapeAttr,
    escapeHtml,
    t,
} from "../../shared/values.js";

export function buildTickActionReference(actor, { blocked = false, blockedLabel = "" } = {}) {
    const availableActions = combatTickActionsFor("custom");
    const favoriteIds = normalizeFavoriteTickActionIds(
        actor.getFlag?.(MODULE_ID, "favoriteTickActionIds"),
        availableActions.map((action) => action.id)
    );
    const actionsById = new Map(availableActions.map((action) => [action.id, action]));
    const favoriteIdSet = new Set(favoriteIds);
    const actions = [
        ...favoriteIds.flatMap((id) => actionsById.has(id)
            ? [{ ...actionsById.get(id), displayCategory: "favorites" }]
            : []),
        ...availableActions.filter((action) => !favoriteIdSet.has(action.id))
            .map((action) => ({ ...action, displayCategory: action.category })),
    ];
    const columnCount = 5;
    const heading = t("SMOOTHER_FIGHT.HUD.TickActionReferenceAll");
    const triggerLabel = t("SMOOTHER_FIGHT.HUD.TickActionReferenceOpen");
    let currentCategory = null;
    const rows = actions.map((action) => {
        const categoryLabel = t(`SMOOTHER_FIGHT.HUD.TickActionCategories.${action.displayCategory}`);
        const originalCategoryLabel = t(`SMOOTHER_FIGHT.HUD.TickActionCategories.${action.category}`);
        const category = action.displayCategory === currentCategory ? "" : `
            <tr class="sf-tick-action-category ${action.displayCategory === "favorites" ? "is-favorites" : ""}" data-sf-tick-action-category="${escapeAttr(action.displayCategory)}"><th colspan="${columnCount}">${escapeHtml(categoryLabel)}</th></tr>`;
        currentCategory = action.displayCategory;
        const durationLabel = tickActionDuration(action);
        const special = action.special
            ? t(`SMOOTHER_FIGHT.HUD.TickActions.${action.id}.Special`)
            : t("SMOOTHER_FIGHT.HUD.TickActionDash");
        const kindLabel = t(`SMOOTHER_FIGHT.HUD.TickActionKinds.${action.kind}`);
        const actionName = t(`SMOOTHER_FIGHT.HUD.TickActions.${action.id}.Name`);
        const shareLabel = t("SMOOTHER_FIGHT.HUD.TickActionShare", { action: actionName });
        const isFavorite = favoriteIdSet.has(action.id);
        const favoriteLabel = t(isFavorite
            ? "SMOOTHER_FIGHT.HUD.ClearFavoriteTickAction"
            : "SMOOTHER_FIGHT.HUD.SetFavoriteTickAction", { action: actionName });
        const advanceTicks = tickActionAdvanceValue(action, "custom");
        const actionControl = action.actionable === false
            ? `<span class="sf-tick-action-name">${escapeHtml(actionName)}</span>`
            : `<button type="button" class="sf-tick-action-link" data-sf-action="share-tick-action" data-tick-action-id="${escapeAttr(action.id)}" data-tick-action-ticks="custom" data-tick-action-advance="${escapeAttr(advanceTicks)}" title="${escapeAttr(blocked ? blockedLabel : shareLabel)}" aria-label="${escapeAttr(shareLabel)}" ${blocked ? "disabled" : ""}>${escapeHtml(actionName)}</button>`;
        const sourceLabel = action.source ? t("SMOOTHER_FIGHT.HUD.TickActionSource", action.source) : "";
        const source = sourceLabel ? `<small class="sf-tick-action-source">${escapeHtml(sourceLabel)}</small>` : "";
        const searchValue = [actionName, categoryLabel, originalCategoryLabel, kindLabel, durationLabel, special, sourceLabel].join(" ");
        return `${category}<tr data-sf-tick-action-row data-sf-tick-action-category="${escapeAttr(action.displayCategory)}" data-sf-search="${escapeAttr(searchValue)}" class="${isFavorite ? "is-favorite" : ""}">
            <td>${actionControl}${source}</td>
            <td>${escapeHtml(kindLabel)}</td>
            <td>${escapeHtml(durationLabel)}</td>
            <td>${escapeHtml(special)}</td>
            <td class="sf-tick-action-favorite-cell"><button type="button" class="sf-favorite-tick-action-toggle ${isFavorite ? "is-favorite" : ""}" data-sf-action="toggle-favorite-tick-action" data-tick-action-id="${escapeAttr(action.id)}" title="${escapeAttr(favoriteLabel)}" aria-label="${escapeAttr(favoriteLabel)}" aria-pressed="${isFavorite}"><i class="${isFavorite ? "fa-solid" : "fa-regular"} fa-star" aria-hidden="true"></i></button></td>
        </tr>`;
    }).join("");
    const body = rows || `<tr><td colspan="${columnCount}" class="sf-tick-action-empty">${escapeHtml(t("SMOOTHER_FIGHT.HUD.TickActionEmpty", { ticks: "–" }))}</td></tr>`;
    return `<details class="sf-tick-action-reference">
        <summary title="${escapeAttr(triggerLabel)}" aria-label="${escapeAttr(triggerLabel)}"><i class="fa-solid fa-book-open" aria-hidden="true"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.TickActionReferenceButton"))}</span><i class="fa-solid fa-chevron-down sf-chevron" aria-hidden="true"></i></summary>
        <div class="sf-tick-action-popover" role="region" aria-label="${escapeAttr(heading)}">
            <strong>${escapeHtml(heading)}</strong>
            <label class="sf-tick-action-filter"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input type="search" data-sf-tick-action-filter autocomplete="off" spellcheck="false" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.HUD.TickActionFilter"))}" placeholder="${escapeAttr(t("SMOOTHER_FIGHT.HUD.TickActionFilterPlaceholder"))}"></label>
            <table>
                <thead><tr>
                    <th>${escapeHtml(t("SMOOTHER_FIGHT.HUD.TickActionName"))}</th>
                    <th>${escapeHtml(t("SMOOTHER_FIGHT.HUD.TickActionType"))}</th>
                    <th>${escapeHtml(t("SMOOTHER_FIGHT.HUD.TickActionDurationHeading"))}</th>
                    <th>${escapeHtml(t("SMOOTHER_FIGHT.HUD.TickActionSpecial"))}</th>
                    <th class="sf-tick-action-favorite-heading"><span class="sf-visually-hidden">${escapeHtml(t("SMOOTHER_FIGHT.HUD.FavoriteTickActions"))}</span><i class="fa-solid fa-star" aria-hidden="true"></i></th>
                </tr></thead>
                <tbody>${body}<tr data-sf-tick-action-filter-empty hidden><td colspan="${columnCount}" class="sf-tick-action-empty" aria-live="polite">${escapeHtml(t("SMOOTHER_FIGHT.HUD.TickActionFilterEmpty"))}</td></tr></tbody>
            </table>
        </div>
    </details>`;
}

function tickActionAdvanceValue(action, selectedTicks) {
    if (selectedTicks !== "custom") return selectedTicks;
    if (Number.isFinite(Number(action.ticks))) return action.ticks;
    return action.ticks === "unavailable" ? "none" : "custom";
}

function tickActionDuration(action) {
    if (Array.isArray(action.ticks)) {
        return t("SMOOTHER_FIGHT.HUD.TickActionDurationRange", {
            first: action.ticks[0],
            last: action.ticks.at(-1),
        });
    }
    if (Number.isFinite(Number(action.ticks))) return t("SMOOTHER_FIGHT.HUD.TickActionDuration", { ticks: action.ticks });
    const suffix = action.ticks === "wgs" ? "Wgs" : action.ticks === "spell" ? "Spell" : "Unavailable";
    return t(`SMOOTHER_FIGHT.HUD.TickActionDuration${suffix}`);
}
