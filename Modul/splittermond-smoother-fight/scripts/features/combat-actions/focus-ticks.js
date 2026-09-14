import { services } from "../../core/services.js";
import { t } from "../../shared/values.js";

// Actor.addTicks may resolve a different combatant for linked Actor tokens.
// The focus HUD already has an explicit token/combatant, so retain that identity.
export async function addFocusedCombatTicks(context, ticks, { prompt = false, label = "" } = {}) {
    if (prompt) {
        ticks = await foundry.applications.api.DialogV2.wait({
            window: { title: label || t("SMOOTHER_FIGHT.HUD.CustomTicks") },
            content: '<label>Ticks <input name="ticks" type="number" step="1" min="1" value="3" autofocus></label>',
            buttons: [{ action: "advance", label: t("SMOOTHER_FIGHT.HUD.Advance"), default: true,
                callback: (_event, button, dialog) => Number((button.form ?? dialog.element)?.querySelector('[name="ticks"]')?.value) }],
            rejectClose: false,
        });
    }
    if (ticks === null || ticks === undefined || !Number.isInteger(Number(ticks)) || Number(ticks) < (prompt ? 1 : 0)) return null;
    const live = services.resolveHudFocusActionContext(context);
    if (!live?.combatant || !live.combat?.setInitiative) return null;
    await live.combat.setInitiative(live.combatant.id, Math.round(Number(live.combatant.initiative) || 0) + Number(ticks));
    return Number(ticks);
}
