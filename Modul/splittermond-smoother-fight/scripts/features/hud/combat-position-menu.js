import { services } from "../../core/services.js";
import { escapeAttr, escapeHtml, t } from "../../shared/values.js";

export function buildCombatPositionMenu(actor) {
    const positions = [
        { id: "standing", icon: "fa-person" },
        { id: "kneeling", icon: "fa-person-praying" },
        { id: "prone", icon: "fa-person-falling" },
        { id: "flying", icon: "fa-dove" },
    ];
    const current = typeof services.resolveCombatPosition === "function"
        ? services.resolveCombatPosition(actor)
        : { id: "standing", ambiguous: false };
    const currentPosition = positions.find(({ id }) => id === current.id);
    const menuLabel = t("SMOOTHER_FIGHT.HUD.CombatPosition");
    const currentLabel = current.ambiguous
        ? t("SMOOTHER_FIGHT.HUD.CombatPositionConflict")
        : t(`SMOOTHER_FIGHT.HUD.CombatPositions.${current.id}`);
    const currentIcon = current.ambiguous ? "fa-triangle-exclamation" : currentPosition?.icon ?? "fa-person";
    const summaryLabel = `${menuLabel}: ${currentLabel}`;
    const choices = positions.map(({ id, icon }) => {
        const label = t(`SMOOTHER_FIGHT.HUD.CombatPositions.${id}`);
        const selected = current.id === id && !current.ambiguous;
        return `<button type="button" data-sf-action="set-combat-position" data-combat-position="${escapeAttr(id)}" class="${selected ? "is-active" : ""}" aria-pressed="${selected}" title="${escapeAttr(label)}"><i class="fa-solid ${icon}"></i><span>${escapeHtml(label)}</span></button>`;
    }).join("");

    return `<details class="sf-visibility-menu sf-combat-position-menu ${current.ambiguous ? "is-conflict" : current.id !== "standing" ? "is-active" : ""}"><summary class="sf-icon-button" title="${escapeAttr(summaryLabel)}" aria-label="${escapeAttr(summaryLabel)}"><i class="fa-solid ${currentIcon}"></i><span class="sf-control-label">${escapeHtml(currentLabel)}</span><i class="fa-solid fa-chevron-down sf-chevron"></i></summary>
        <div class="sf-visibility-popover sf-combat-position-popover" aria-label="${escapeAttr(menuLabel)}">${choices}</div></details>`;
}
