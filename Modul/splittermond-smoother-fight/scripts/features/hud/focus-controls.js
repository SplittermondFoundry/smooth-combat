import { focusEnabled, selectHudFocus, resolveHudFocusElement } from "./focus-context.js";
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
    if (action !== "inspect-hud-item") return false;
    const context = resolveHudFocusElement(active, target);
    if (!context) return true;
    const collection = target.dataset.itemKind === "spell" ? context.actor.spells : context.actor.attacks;
    const item = Array.from(collection ?? []).find(item => item.id === target.dataset.itemId);
    const document = context.actor.items?.get?.(item?.id) ?? item;
    if (document?.sheet) document.sheet.render({ force: true });
    else context.actor.sheet?.render?.({ force: true });
    return true;
}
