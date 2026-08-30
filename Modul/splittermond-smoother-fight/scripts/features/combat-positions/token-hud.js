import { MODULE_ID } from "../../core/constants.js";
import { asElement, t } from "../../shared/values.js";
import { refreshCombatPositionOverlay } from "./overlay.js";
import {
    COMBAT_POSITION_ICONS,
    COMBAT_POSITION_IDS,
    resolveCombatPosition,
    setCombatPosition,
} from "./positions.js";

const COMBAT_POSITION_PALETTE = "smootherFightCombatPositions";

export function renderTokenCombatPositionControl(app, html) {
    const root = asElement(html);
    const tokenObject = app?.object ?? app?.token ?? null;
    const token = tokenObject?.document ?? tokenObject;
    const actor = token?.actor ?? tokenObject?.actor;
    if (!root || !actor || (!globalThis.game?.user?.isGM && !actor.isOwner)) return;

    for (const previous of root.querySelectorAll(".sf-token-position-control")) previous.remove();
    for (const previous of root.querySelectorAll(".sf-combat-position-palette")) previous.remove();
    const column = root.querySelector(".col.right") ?? root.querySelector(".right") ?? root;
    const current = resolveCombatPosition(actor);

    const control = document.createElement("button");
    control.type = "button";
    control.className = "control-icon sf-token-position-control";
    control.dataset.action = "togglePalette";
    control.dataset.palette = COMBAT_POSITION_PALETTE;
    control.dataset.tooltip = "";
    control.setAttribute("aria-label", t("SMOOTHER_FIGHT.HUD.CombatPosition"));
    updatePositionControl(control, current);

    const palette = document.createElement("div");
    palette.className = "palette status-effects sf-combat-position-palette";
    palette.dataset.palette = COMBAT_POSITION_PALETTE;
    palette.setAttribute("aria-label", t("SMOOTHER_FIGHT.HUD.CombatPosition"));
    palette.style.setProperty("--effect-columns", String(COMBAT_POSITION_IDS.length));
    palette.style.height = "auto";
    palette.style.overflow = "visible";

    const choices = COMBAT_POSITION_IDS.map((position) => {
        const label = t(`SMOOTHER_FIGHT.HUD.CombatPositions.${position}`);
        const actionLabel = t("SMOOTHER_FIGHT.HUD.SetCombatPosition", { position: label });
        const choice = document.createElement("button");
        choice.type = "button";
        choice.className = `effect-control sf-combat-position-choice${!current.ambiguous && current.id === position ? " active" : ""}`;
        choice.dataset.combatPosition = position;
        choice.dataset.tooltipText = actionLabel;
        choice.setAttribute("aria-label", actionLabel);
        choice.innerHTML = positionControlIcon(position);
        const activate = async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (choice.disabled) return;
            for (const candidate of choices) candidate.disabled = true;
            try {
                await setCombatPosition(actor, position);
                await refreshCombatPositionOverlay(tokenObject);
                for (const candidate of choices) {
                    candidate.classList.toggle("active", candidate.dataset.combatPosition === position);
                    candidate.disabled = false;
                }
                updatePositionControl(control, resolveCombatPosition(actor));
                app?.togglePalette?.(COMBAT_POSITION_PALETTE, false);
            } catch (error) {
                for (const candidate of choices) candidate.disabled = false;
                console.error(`${MODULE_ID} | Could not set combat position from Token HUD`, error);
                globalThis.ui?.notifications?.error?.(t("SMOOTHER_FIGHT.HUD.CombatPositionChangeFailed"));
            }
        };
        choice.addEventListener("click", activate);
        return choice;
    });
    palette.append(...choices);
    column.append(control, palette);
}

function updatePositionControl(control, position) {
    control.innerHTML = position.ambiguous
        ? '<i class="fa-solid fa-triangle-exclamation"></i>'
        : positionControlIcon(position.id);
}

function positionControlIcon(position) {
    const icon = COMBAT_POSITION_ICONS[position];
    return icon
        ? `<img src="${icon}" alt="">`
        : '<i class="fa-solid fa-person"></i>';
}
