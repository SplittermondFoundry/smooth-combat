import { services } from "../../core/services.js";
import { escapeAttr, escapeHtml, getDerivedValue, getSetting, numericValue, t } from "../../shared/values.js";
import { mayViewTargetDefenses, mayViewTargetResources } from "../../combat-rules.js";
import { buildDefeatedTargetStatus } from "./target-status.js";

export function portraitPanel({ side, token, actor, eyebrow, headerActions = "", action = "", highlighted = false, primary = false, defeated = false, showDefenses = true }) {
    const image = actor?.img || token?.texture?.src || "icons/svg/mystery-man.svg";
    const tokenReference = token?.uuid ? `data-sf-token-uuid="${escapeAttr(token.uuid)}"` : "";
    const name = token?.name ?? actor?.name ?? "–";
    const focusLabel = `${t("SMOOTHER_FIGHT.HUD.FocusCombatant")}: ${name}`;
    const focusButton = token?.uuid ? `<button type="button" class="sf-portrait-focus" data-sf-action="show-token" data-token-uuid="${escapeAttr(token.uuid)}" title="${escapeAttr(focusLabel)}"><span class="sf-visually-hidden">${escapeHtml(focusLabel)}</span></button>` : "";
    const openSheetLabel = `${t("SMOOTHER_FIGHT.HUD.OpenSheet")}: ${name}`;
    const sheetButton = action ? `<button type="button" class="sf-portrait-open" data-sf-action="${action}" ${tokenReference} title="${escapeAttr(openSheetLabel)}"><i class="fa-solid fa-address-card" aria-hidden="true"></i><span class="sf-visually-hidden">${escapeHtml(openSheetLabel)}</span></button>` : "";
    const defense = getDerivedValue(actor, "defense");
    const body = getDerivedValue(actor, "bodyresist");
    const mind = getDerivedValue(actor, "mindresist");
    return `
        <aside class="sf-portrait sf-${side} ${highlighted ? "sf-is-user-target" : ""} ${primary ? "sf-is-primary-target" : ""} ${defeated ? "sf-is-defeated" : ""}" ${tokenReference} aria-label="${escapeAttr(`${eyebrow}: ${name}`)}">
            ${focusButton}
            <div class="sf-portrait-header">
                <span class="sf-eyebrow">${escapeHtml(eyebrow)}</span>
                ${headerActions ? `<div class="sf-portrait-header-actions">${headerActions}</div>` : ""}
            </div>
            <div class="sf-portrait-image">
                <img class="sf-portrait-art" src="${escapeAttr(image)}" alt="" aria-hidden="true">
                ${highlighted ? `<span class="sf-target-alert"><i class="fa-solid fa-bullseye"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.YouAreTarget"))}</span></span>` : ""}
                ${defeated ? buildDefeatedTargetStatus(name) : ""}
                ${services.feedbackMarkup(token, actor)}
            </div>
            <div class="sf-portrait-identity"><div class="sf-portrait-name">${escapeHtml(name)}</div>${sheetButton}</div>
            ${showDefenses ? `<div class="sf-defense-row" aria-label="VTD, KW, GW">
                <span><small>VTD</small>${escapeHtml(defense)}</span>
                <span><small>KW</small>${escapeHtml(body)}</span>
                <span><small>GW</small>${escapeHtml(mind)}</span>
            </div>` : `<div class="sf-defense-row is-concealed"><i class="fa-solid fa-eye-slash"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefensesHidden"))}</span></div>`}
            ${canViewResources(actor) ? resourceBars(actor) : ""}
        </aside>
    `;
}

export function canViewDefenseValues(actor) {
    const observer = Boolean(actor?.testUserPermission?.(game.user, "OBSERVER"));
    return mayViewTargetDefenses(getSetting("revealTargetDefenses", false), game.user?.isGM, observer);
}

export function noTargetPanel() {
    return `
        <aside class="sf-portrait sf-target sf-no-target">
            <div class="sf-target-rings"><i class="fa-solid fa-crosshairs"></i></div>
            <strong>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoTarget"))}</strong>
            <small>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoTargetDetail"))}</small>
        </aside>
    `;
}

function resourceBars(actor) {
    const health = actor?.system?.healthBar;
    const focus = actor?.system?.focusBar;
    if (!health && !focus) return "";
    return `<div class="sf-resources">
        ${resourceBar("health", t("SMOOTHER_FIGHT.HUD.Health"), health)}
        ${resourceBar("focus", t("SMOOTHER_FIGHT.HUD.Focus"), focus)}
    </div>`;
}

function canViewResources(actor) {
    const observer = Boolean(actor?.testUserPermission?.(game.user, "OBSERVER"));
    return mayViewTargetResources(getSetting("revealTargetResources", false), game.user?.isGM, observer);
}

function resourceBar(type, label, resource) {
    if (!resource) return "";
    const value = numericValue(resource.value);
    const max = Math.max(0, numericValue(resource.max));
    const percent = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return `<div class="sf-resource sf-resource-${type}" title="${escapeAttr(`${label}: ${value}/${max}`)}">
        <span style="width:${percent}%"></span><small><span>${escapeHtml(label)}</span><b>${value}/${max}</b></small>
    </div>`;
}

export function buildSecondaryTargets(context) {
    const secondaryTargets = context.targets.filter((candidate) => candidate.uuid !== context.target?.uuid);
    if (!secondaryTargets.length) return "";
    const canChoose = services.canChooseTarget(context);
    return `<div class="sf-secondary-targets" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.HUD.AdditionalTargets"))}">
        <div class="sf-secondary-targets-heading"><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.AdditionalTargets"))}</span><b>+${secondaryTargets.length}</b></div>
        ${secondaryTargets.map((candidate) => {
            const name = candidate.name ?? candidate.actor?.name ?? "–";
            const image = candidate.texture?.src ?? candidate.actor?.img ?? "icons/svg/mystery-man.svg";
            const action = canChoose ? "set-target" : "open-token-sheet";
            const uuidAttribute = canChoose ? `data-token-uuid="${escapeAttr(candidate.uuid)}"` : `data-sf-token-uuid="${escapeAttr(candidate.uuid)}"`;
            return `<div class="sf-secondary-target">
                <button type="button" data-sf-action="${action}" ${uuidAttribute} title="${escapeAttr(canChoose ? t("SMOOTHER_FIGHT.HUD.MakePrimaryTarget", { target: name }) : name)}">
                    <img src="${escapeAttr(image)}" alt=""><span>${escapeHtml(name)}</span><i class="fa-solid fa-crosshairs"></i>
                </button>
                ${canChoose ? `<button type="button" class="sf-secondary-target-remove" data-sf-action="remove-target" data-token-uuid="${escapeAttr(candidate.uuid)}" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.RemoveTarget", { target: name }))}" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.HUD.RemoveTarget", { target: name }))}"><i class="fa-solid fa-xmark"></i></button>` : ""}
            </div>`;
        }).join("")}
    </div>`;
}
