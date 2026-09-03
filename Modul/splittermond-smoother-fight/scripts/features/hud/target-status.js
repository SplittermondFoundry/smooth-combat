import { services } from "../../core/services.js";
import {
    escapeAttr,
    escapeHtml,
    t,
} from "../../shared/values.js";
import {
    findCombatantForToken,
    isActorAtZeroHealth,
} from "./context.js";

export function isTargetDefeated(context) {
    return Boolean(findCombatantForToken(context.combat, context.target)?.isDefeated);
}

export function buildDefeatedTargetStatus(targetName) {
    const label = `${t("SMOOTHER_FIGHT.HUD.Defeated")}: ${targetName}`;
    return `<span class="sf-primary-target-defeated-status" role="status" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"><i class="fa-solid fa-skull" aria-hidden="true"></i><span class="sf-visually-hidden">${escapeHtml(label)}</span></span>`;
}

export function buildTargetHeaderActions(context) {
    const target = context.target;
    if (!target) return "";
    const defeatControl = buildTargetDefeatControl(context);
    if (!services.canChooseTarget(context)) return defeatControl;
    const targetName = target.name ?? target.actor?.name ?? "–";
    const removeLabel = t("SMOOTHER_FIGHT.HUD.RemoveTarget", { target: targetName });
    const removeControl = `<button type="button" class="sf-primary-target-remove" data-sf-action="remove-target" data-token-uuid="${escapeAttr(target.uuid)}" title="${escapeAttr(removeLabel)}" aria-label="${escapeAttr(removeLabel)}"><i class="fa-solid fa-xmark"></i></button>`;
    return `${defeatControl}${removeControl}`;
}

function buildTargetDefeatControl(context) {
    const target = context.target;
    if (!game.user?.isGM || !isActorAtZeroHealth(target?.actor)) return "";
    const combatant = findCombatantForToken(context.combat, target);
    const tokenReference = services.tokenUuid(target) ?? target?.id ?? null;
    if (!combatant || combatant.isDefeated || !tokenReference) return "";
    const targetName = target.name ?? target.actor?.name ?? "–";
    const label = `${t("SMOOTHER_FIGHT.HUD.MarkDefeated")}: ${targetName}`;
    return `<button type="button" class="sf-primary-target-defeat" data-sf-action="mark-target-defeated" data-token-uuid="${escapeAttr(tokenReference)}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"><i class="fa-solid fa-skull"></i></button>`;
}
