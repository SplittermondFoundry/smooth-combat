import { services } from "../../core/services.js";

import {
    SYSTEM_SOCKET,
} from "../../core/constants.js";

import {
    localizeSystem,
    t,
} from "../../shared/values.js";

export async function handleLegacySplinterpointAction(event, button, message, mayManageRoll) {
    event.preventDefault();
    event.stopPropagation();
    if (!mayManageRoll) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.NoOwner"));
        return;
    }
    const actor = services.resolveSpeakerActor(message);
    if (!actor?.useSplinterpointBonus) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.NoOwner"));
        return;
    }
    if (!game.user.isGM) {
        const activeGm = Array.from(game.users ?? []).some((user) => user.isGM && user.active);
        if (!activeGm) {
            ui.notifications.warn(localizeSystem("splittermond.chatCard.noGMConnected", "Kein GM verbunden."));
            return;
        }
        game.socket.emit(SYSTEM_SOCKET, {
            type: "chatAction",
            action: "useSplinterpoint",
            messageId: message.id,
            userId: game.user.id,
        });
        return;
    }
    button.disabled = true;
    try {
        await actor.useSplinterpointBonus(message);
        services.scheduleRender(0);
    } catch (error) {
        console.error("splittermond-smoother-fight | Legacy splinterpoint action failed", error);
        ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
    } finally {
        if (button.isConnected) button.disabled = false;
    }
}
