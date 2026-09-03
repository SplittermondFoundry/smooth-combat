import {
    escapeAttr,
    escapeHtml,
    t,
} from "../../shared/values.js";

export function activeDefenseResponseControl({ message, target, defender = null, role = "target" }) {
    const isDefender = role === "defender" && defender?.uuid;
    const label = isDefender
        ? t("SMOOTHER_FIGHT.HUD.DefenderAction", { target: target?.name ?? target?.actor?.name ?? "–" })
        : t("SMOOTHER_FIGHT.HUD.Defense");
    const decline = t("SMOOTHER_FIGHT.HUD.DeclineActiveDefense");
    const participantName = isDefender
        ? defender.name ?? defender.actor?.name ?? "–"
        : target?.name ?? target?.actor?.name ?? "–";
    const defenderAttribute = isDefender
        ? ` data-defender-token-uuid="${escapeAttr(defender.uuid)}"`
        : "";
    return `<div class="sf-action-menu sf-defense-response-control is-defense-alert">
        <button type="button" class="sf-defense-response" data-sf-action="${isDefender ? "respond-defender-defense" : "respond-active-defense"}" data-message-id="${escapeAttr(message.id)}"${defenderAttribute} aria-label="${escapeAttr(label)}">
            <i class="fa-solid ${isDefender ? "fa-shield-heart" : "fa-shield-halved"}" aria-hidden="true"></i>
            <span><small>${escapeHtml(participantName)}</small><strong>${escapeHtml(label)}</strong></span>
        </button>
        <button type="button" class="sf-decline-defense" data-sf-action="decline-active-defense" data-message-id="${escapeAttr(message.id)}"${defenderAttribute} title="${escapeAttr(decline)}" aria-label="${escapeAttr(decline)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    </div>`;
}

export function continuousActionInterruptionControl(request, token = null) {
    const label = t("SMOOTHER_FIGHT.HUD.RollDetermination");
    const action = t(`SMOOTHER_FIGHT.HUD.TickActions.${request.actionId}.Name`);
    const difficulty = t("SMOOTHER_FIGHT.HUD.ContinuousActionInterruptionHudDifficulty", {
        difficulty: request.difficulty,
    });
    const tokenName = token?.name ?? token?.actor?.name ?? "";
    const detail = [tokenName, action, difficulty].filter(Boolean).join(" · ");
    return `<div class="sf-action-menu sf-defense-response-control sf-continuous-interruption-control is-defense-alert">
        <button type="button" class="sf-defense-response" data-sf-action="roll-continuous-action-interruption" data-request-id="${escapeAttr(request.id)}" data-sf-token-uuid="${escapeAttr(request.tokenUuid ?? token?.uuid ?? "")}" aria-label="${escapeAttr(label)}">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            <span><small>${escapeHtml(detail)}</small><strong>${escapeHtml(label)}</strong></span>
        </button>
    </div>`;
}
