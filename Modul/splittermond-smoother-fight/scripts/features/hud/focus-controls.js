import { focusEnabled, selectHudFocus } from "./focus-context.js";
import { services } from "../../core/services.js";

export function handleHudFocusAction(root, active, target) {
    if (!focusEnabled()) return false;
    const action = target.dataset.sfAction;
    if (action === "open-token-sheet") {
        const token = services.resolveToken(target.dataset.sfTokenUuid);
        if (services.isTokenPerceivableByUser(token, game.user)) token?.actor?.sheet?.render?.({ force: true });
        return true;
    }
    if (["switch-hud-focus", "choose-hud-character"].includes(action)) {
        for (const menu of root.querySelectorAll("details")) if (!menu.closest(".sf-events")) menu.open = false;
        selectHudFocus(active, action === "choose-hud-character" ? "personal" : target.dataset.focusMode, target.dataset.focusReference);
        return true;
    }
    return false;
}
