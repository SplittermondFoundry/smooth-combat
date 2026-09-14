import { getApplicableCombat } from "../core/combat-compatibility.js";
import { getSetting, t } from "./values.js";

export function mayStartTurnAction(context) {
    if (!context?.hudFocus && !getSetting("characterFocusHud", true)) return true;
    const combat = getApplicableCombat() ?? context?.combat;
    if (!combat?.started) return true;
    if (context?.combat?.id !== combat.id) return false;
    const active = combat.combatant ?? combat.turns?.[0];
    const token = context?.token?.document ?? context?.token;
    const activeToken = active?.token?.document ?? active?.token;
    return Boolean(token?.uuid && token.uuid === activeToken?.uuid);
}
export function requireTurnActionStart(context) {
    if (mayStartTurnAction(context)) return true;
    globalThis.ui?.notifications?.warn(t("SMOOTHER_FIGHT.HUD.CharacterFocus.StartOwnTurn"));
    return false;
}
