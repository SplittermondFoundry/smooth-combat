import { services } from "../../core/services.js";
import { escapeAttr, escapeHtml, getSetting, t } from "../../shared/values.js";
import { mayStartTurnAction } from "../../shared/turn-start.js";
import { getHudFocusCandidates, getHudFocusContexts, sameHudToken, resolveHudFocusElement } from "./focus-context.js";
import { portraitPanel, noTargetPanel, canViewDefenseValues, buildSecondaryTargets, resourceBars } from "./portraits.js";
import { buildTargetHeaderActions, isTargetDefeated } from "./target-status.js";
import { isPlayersTurn } from "../../combat-rules.js";
import { buildQuickTargets, buildStructuredTokenChoices, quickTargetLabels, quickTargetActorKind, quickTargetSearchValue } from "./quick-targets.js";
import { buildMovementTracker, buildSelectedMovementControl } from "./movement.js";
import { targetDistancePresentation, targetLinePresentation } from "./range.js";
import { buildCombatPositionMenu } from "./combat-position-menu.js";

const label = (key, data) => t(`SMOOTHER_FIGHT.HUD.CharacterFocus.${key}`, data);
const nameOf = c => c?.token?.name ?? c?.actor?.name ?? "–";
function isCurrentUsersTurn(active) {
    return isPlayersTurn({ isGm: game.user.isGM, userId: game.user.id, controllerUserId: active.runtimeController?.id, ownsActor: active.actor?.isOwner });
}
export function focusScope(context) {
    return context ? `data-sf-focus-reference="${escapeAttr(context.focusReference)}" data-sf-context-combatant-id="${escapeAttr(context.combatant?.id ?? "")}" data-sf-context-actor-id="${escapeAttr(context.actor.id)}"` : "";
}
function picker(active, personal) {
    const candidates = getHudFocusCandidates(active);
    if (!candidates.length || (candidates.length === 1 && personal)) return "";
    const tokens = candidates.map(c => c.token);
    const content = buildStructuredTokenChoices(active, tokens, {
        labels: quickTargetLabels(tokens), selected: new Set([personal?.focusReference].filter(Boolean)),
        searchLabel: label("SearchCharacter"), filterLabel: label("TypeFilter"), emptyLabel: label("NoMatches"),
        renderRow: (token, { labels, selected }) => {
            const chosen = selected.has(token.uuid), name = labels.get(token.uuid);
            return `<div class="sf-quick-target-row ${chosen ? "is-selected" : ""}" data-sf-quick-target-row data-sf-actor-kind="${quickTargetActorKind(token)}" data-sf-search="${escapeAttr(quickTargetSearchValue(token))}"><button type="button" data-sf-action="choose-hud-character" data-focus-reference="${escapeAttr(token.uuid)}" class="${chosen ? "is-current" : ""}" aria-pressed="${chosen}" title="${escapeAttr(name)}"><img src="${escapeAttr(token.texture?.src || token.actor?.img || "icons/svg/mystery-man.svg")}" alt=""><span><b>${escapeHtml(name)}</b></span>${chosen ? '<i class="fa-solid fa-check"></i>' : ""}</button></div>`;
        },
    });
    return `<details class="sf-focus-picker is-structured" data-sf-menu="focus-character"><summary title="${escapeAttr(label("ChooseCharacter"))}" aria-label="${escapeAttr(label("ChooseCharacter"))}"><i class="fa-solid fa-chevron-down"></i></summary><div class="sf-quick-target-popover">${content}</div></details>`;
}
function compactIdentity(actor, name, hint = "") {
    const bars = resourceBars(actor, { compact: true });
    return `<span class="sf-focus-mini-info"><span class="sf-focus-mini-name">${escapeHtml(name)}</span>${bars || (hint ? `<small>${escapeHtml(hint)}</small>` : "")}</span>`;
}
function actorCard(context, { role, compact, mode, chooser = "", selected, attention = false }) {
    if (!context?.actor) return `<aside class="sf-portrait sf-focus-empty ${compact ? "is-compact" : ""}"><span>${escapeHtml(role)}</span>${chooser}</aside>`;
    const hint = `${attention ? `${t("SMOOTHER_FIGHT.HUD.YourTurn")} · ` : ""}${label("Inspect")}: ${nameOf(context)}`;
    const switchButton = `<button type="button" data-sf-action="switch-hud-focus" data-focus-mode="${mode}" class="sf-focus-label" aria-pressed="${selected}" title="${escapeAttr(hint)}">${attention ? '<i class="fa-solid fa-bolt" aria-hidden="true"></i> ' : ""}${escapeHtml(role)}</button>`;
    if (compact) return `<aside class="sf-portrait sf-focus-actor ${attention ? "is-turn-attention " : ""}is-compact" data-sf-token-uuid="${escapeAttr(context.token?.uuid ?? "")}"><div class="sf-portrait-header">${switchButton}${chooser}</div><button type="button" class="sf-focus-mini" data-sf-action="switch-hud-focus" data-focus-mode="${mode}" title="${escapeAttr(hint)}" aria-label="${escapeAttr(hint)}"><img src="${escapeAttr(context.actor.img || context.token?.texture?.src || "icons/svg/mystery-man.svg")}" alt="">${compactIdentity(context.actor, nameOf(context), label("Inspect"))}</button></aside>`;
    let html = portraitPanel({ side: "actor", token: context.token, actor: context.actor, eyebrow: role,
        action: context.token ? "open-token-sheet" : "open-sheet", showDefenses: canViewDefenseValues(context.actor) });
    html = html.replace('class="sf-portrait sf-actor ', 'class="sf-portrait sf-actor sf-focus-actor is-selected ')
        .replace('<span class="sf-eyebrow">' + escapeHtml(role) + '</span>', switchButton + chooser);
    return `<div class="sf-focus-card-scope" ${focusScope(context)}>${html}</div>`;
}
export function buildFocusedActorColumn(active) {
    const { mode, personal, action } = getHudFocusContexts(active), chooser = picker(active, personal);
    const ownRole = game.user.isGM && (!personal || personal.actor.id !== game.user.character?.id) ? label("GmActor") : label("YourActor");
    const merged = sameHudToken(active.token, personal?.token);
    const attention = Boolean(active.combat?.started && !active.concealed && !active.combatant?.isDefeated
        && mode === "personal" && action?.token && active.token && !merged && isCurrentUsersTurn(active));
    const activeRole = active.concealed ? label("HiddenActive") : t("SMOOTHER_FIGHT.HUD.Active");
    const html = merged
        ? actorCard(personal, { role: `${activeRole} + ${ownRole}`, compact: false, mode: "personal", chooser, selected: true })
        : (personal || chooser ? actorCard(personal, { role: ownRole, compact: mode !== "personal", mode: "personal", chooser, selected: mode === "personal" }) : "")
        + actorCard(active.concealed ? null : { ...active, focusReference: active.token?.uuid ?? active.actor?.uuid }, { role: activeRole, compact: mode !== "active", mode: "active", selected: mode === "active", attention });
    return `<div class="sf-focus-actor-column" data-sf-inspection="${escapeAttr(action?.focusReference ?? "")}">${html}</div>`;
}
function targetHeading(role, source, distance = "") {
    const caption = `${role}${distance ? ` · ${distance}` : ""}`;
    return `<span class="sf-eyebrow sf-focus-target-heading" title="${escapeAttr([caption, source].filter(Boolean).join(" · "))}"><span class="sf-focus-target-caption">${escapeHtml(caption)}</span>${source ? `<small class="sf-focus-target-source">${escapeHtml(source)}</small>` : ""}</span>`;
}
function targetCard(context, role, compact, primary, interactive = false, owners = [context]) {
    const target = context?.target;
    const names = owners.filter(owner => owner?.actor && !owner.concealed).map(nameOf);
    const source = names.length ? label("TargetFor", { name: names.join(" / ") }) : "";
    if (!target) return `<div class="sf-portrait sf-focus-target ${compact ? "is-compact" : ""}"><span class="sf-focus-target-role">${targetHeading(role, source)}</span>${noTargetPanel()}</div>`;
    if (compact) return `<aside class="sf-portrait sf-focus-target is-compact" data-sf-token-uuid="${escapeAttr(target.uuid)}"><div class="sf-portrait-header">${targetHeading(role, source)}</div><button type="button" class="sf-focus-mini" data-sf-action="open-token-sheet" data-sf-token-uuid="${escapeAttr(target.uuid)}"><img src="${escapeAttr(target.actor?.img || target.texture?.src || "icons/svg/mystery-man.svg")}" alt="">${compactIdentity(target.actor, target.name ?? target.actor?.name)}</button></aside>`;
    const distance = targetDistancePresentation(context).text;
    const eyebrow = [role, source, distance].filter(Boolean).join(" · ");
    const card = portraitPanel({ side: "target", token: target, actor: target.actor, eyebrow,
        headerActions: interactive ? buildTargetHeaderActions(context) : "", defeated: isTargetDefeated(context),
        highlighted: services.isCurrentUserTarget(target), action: "open-token-sheet", primary, showDefenses: canViewDefenseValues(target.actor) })
        .replace(`<span class="sf-eyebrow">${escapeHtml(eyebrow)}</span>`, targetHeading(role, source, distance));
    return `<div class="sf-focus-target-scope" data-focus-target-role="${escapeAttr(role)}" ${interactive ? focusScope(context) : ""}>${interactive ? buildSecondaryTargets(context) : ""}${card}</div>`;
}
export function buildFocusedTargetColumn(active) {
    const { mode, personal, action } = getHudFocusContexts(active);
    const primaryRole = t("SMOOTHER_FIGHT.HUD.PrimaryTarget");
    const ownRole = label("YourTarget");
    const primaryContext = mode === "active" && action ? action : active;
    const merged = sameHudToken(primaryContext.target, personal?.target);
    const mergedOwners = sameHudToken(primaryContext.token, personal?.token) ? [primaryContext] : [primaryContext, personal];
    const column = merged ? targetCard(mode === "personal" ? personal : primaryContext, `${primaryRole} + ${ownRole}`, false, true, Boolean(action), mergedOwners)
        : (personal ? targetCard(personal, ownRole, mode !== "personal", false, mode === "personal") : "")
        + targetCard(primaryContext, primaryRole, Boolean(personal && mode !== "active"), true, mode === "active" && Boolean(action));
    return `<div class="sf-target-column sf-focus-target-column">${action ? `<div ${focusScope(action)}>${buildQuickTargets(action)}</div>` : ""}${column}</div>`;
}
export function refreshFocusedTargetDistances(root, active) {
    for (const scope of root.querySelectorAll("[data-focus-target-role]")) {
        const context = scope.dataset.sfFocusReference ? resolveHudFocusElement(active, scope) : active;
        if (!context?.target) continue;
        const distance = targetDistancePresentation(context).text;
        const text = `${scope.dataset.focusTargetRole}${distance ? ` · ${distance}` : ""}`;
        const card = scope.querySelector(".sf-portrait"), eyebrow = card?.querySelector(".sf-eyebrow");
        const caption = eyebrow?.querySelector(".sf-focus-target-caption") ?? eyebrow;
        const source = eyebrow?.querySelector(".sf-focus-target-source")?.textContent;
        if (caption) caption.textContent = text;
        const description = [text, source].filter(Boolean).join(" · ");
        eyebrow?.setAttribute("title", description);
        card?.setAttribute("aria-label", `${description}: ${context.target.name ?? context.target.actor?.name ?? "–"}`);
    }
}
export async function buildFocusedHud(active, options, renderers) {
    const { action, personal, mode } = getHudFocusContexts(active);
    const currentPlayersTurn = isCurrentUsersTurn(active);
    const turnNotice = currentPlayersTurn ? `<span class="sf-your-turn"><i class="fa-solid fa-bolt"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.YourTurn"))}</span>` : "";
    const turnName = active.concealed ? label("HiddenActive") : nameOf(active);
    const targetLine = active.concealed ? "" : targetLinePresentation(active, targetDistancePresentation(active).text);
    const header = `<header class="sf-turnline"><span class="sf-live-dot"></span><strong>${escapeHtml(turnName)}</strong><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.CurrentTick", { tick: active.combat.currentTick ?? 0 }))}</span>${turnNotice}${action ? `<span class="sf-focus-context-label">${escapeHtml(label("Operating", { name: nameOf(action) }))}</span>` : ""}<span class="sf-turn-target">${escapeHtml(targetLine)}</span>${renderers.buildGmCheatToggle()}${renderers.buildThemeToggle()}${renderers.buildHudToggle(false)}</header>`;
    const controls = action?.combatant ? renderers.buildCombatControls(action) : action
        ? `<div class="sf-combat-controls"><span class="sf-owner-note">${escapeHtml(label(action.token ? "NotInCombat" : "WithoutToken"))}</span>${buildCombatPositionMenu(action.actor)}</div>` : "";
    const movement = action?.token && action?.combatant && getSetting("movementTracking", true) ? buildMovementTracker(action, { cache: options.movementDistanceCache }) : "";
    const actions = action ? decorateFocusActions(await renderers.buildActionBar(action, targetDistancePresentation(action).measurement), action) : `<p class="sf-owner-note">${escapeHtml(label(personal ? "ReadOnly" : "ChooseCharacter"))}</p>`;
    const events = getSetting("showCards", true) ? services.buildCombatEvents(active) : "";
    return `<div class="sf-shell sf-focus-shell ${currentPlayersTurn ? "is-current-user-turn" : ""}" data-sf-focus-mode="${mode}">${buildFocusedActorColumn(active)}<main class="sf-center">${header}${buildSelectedMovementControl(active.combat)}<div class="sf-focus-controls" ${focusScope(action)}>${controls}${movement}${actions}</div>${events}</main>${buildFocusedTargetColumn(active)}</div>`;
}
export function decorateFocusActions(html, context) {
    if (mayStartTurnAction(context)) return html;
    return html.replace(/<button\b([^>]*data-sf-action="(spell|cast-prepared-spell|attack)"[^>]*)>([\s\S]*?)<\/button>/g, (all, attrs, action, body) => {
        const kind = action === "attack" ? "attack" : "spell";
        const id = attrs.match(/data-(?:spell|attack)-id="([^"]+)"/)?.[1];
        const item = Array.from(context.actor[kind === "spell" ? "spells" : "attacks"] ?? []).find(c => escapeAttr(c.id) === id);
        if (!item || (kind === "attack" && !services.isRangedAttack(item))) return all;
        const filters = attrs.match(/\sdata-sf-(?:spell-row|search|enough-focus|spell-school|spell-level)(?:="[^"]*")?/g)?.join("") ?? "";
        const clean = attrs.replace(/\sdata-sf-(?:spell-row|search|enough-focus|spell-school|spell-level)(?:="[^"]*")?/g, "").replace(/\saria-disabled="[^"]*"/g, "");
        const reason = escapeAttr(label("StartOwnTurn"));
        if (action === "cast-prepared-spell" || attrs.includes("sf-prepared-attack-release")) {
            const locked = body.replace(/<b>[\s\S]*?<\/b>/, `<b role="img" aria-label="${reason}"><i class="fa-solid fa-lock" aria-hidden="true"></i></b>`);
            return `<button ${clean} aria-disabled="true" data-sf-start-blocked title="${reason}">${locked}</button>`;
        }
        // Native disabled suppresses contextmenu events in some browsers; onClick guards aria-disabled.
        return `<div class="sf-focus-locked-option" data-sf-start-blocked title="${reason}"${filters}><button ${clean} aria-disabled="true" data-sf-start-blocked>${body}</button><span class="sf-focus-lock" data-${kind}-id="${escapeAttr(item.id)}" role="img" aria-label="${reason}"><i class="fa-solid fa-lock" aria-hidden="true"></i></span></div>`;
    });
}
