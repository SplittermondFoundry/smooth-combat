import { services } from "../../core/services.js";
import { t } from "../../shared/values.js";

export function requireOpenCombatFlowForTicks(context) {
    if (game.user?.isGM) return true;
    const blocker = services.getBlockingCombatWorkflow?.(context?.combat);
    if (!blocker) return true;
    ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.CombatFlow.TickBlocked"));
    services.scheduleRender?.(0);
    return false;
}
