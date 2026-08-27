import { activeDefenseOptionSummaries } from "./defense-options.js";
import { services } from "../../core/services.js";

import {
    spellFocusCosts,
} from "./action-tooltips.js";

import {
    getPersonalHudCandidates,
    getPersonalHudContext,
} from "./context.js";

import {
    buildQuickTargets,
} from "./quick-targets.js";

import {
    isSpellListFilterable,
    spellFilterDetails,
    spellFilterOptions,
    spellSearchValue,
} from "./spell-filters.js";

import {
    buildMovementTracker,
} from "./movement.js";

import {
    attackRangePresentation,
    rangeStatusMarkup,
    spellRangePresentation,
    targetDistancePresentation,
} from "./range.js";

import {
    buildTickActionReference,
} from "./tick-action-reference.js";

import {
    attackControlSelection,
    attackControlState,
    attackReadiness,
    isTargetDependentDifficulty,
    isPlayersTurn,
    mayViewTargetDefenses,
    mayViewTargetResources,
    normalizeFavoriteSkillIds,
} from "../../combat-rules.js";

import {
    COMBAT_PAUSE,
    MAX_FAVORITE_SKILLS,
    MODULE_ID,
} from "../../core/constants.js";

import {
    displayLabel,
    displayValue,
    escapeAttr,
    escapeHtml,
    getDerivedValue,
    getSetting,
    numericValue,
    sortByName,
    t,
} from "../../shared/values.js";

export async function buildHud(context) {
    if (context.concealed) return buildConcealedHud(context);
    const { combat, combatant, actor, token, assignedUser, runtimeController, target, targets } = context;
    const canAct = Boolean(game.user.isGM || (runtimeController?.id === game.user?.id && actor.isOwner));
    const tick = combat.currentTick ?? Math.round(Number(combatant.initiative) || 0);
    const userName = runtimeController?.name ?? t("SMOOTHER_FIGHT.HUD.NoRuntimeController");
    const targetName = target?.name ?? target?.actor?.name ?? "–";
    const additionalTargetCount = Math.max(0, targets.length - 1);
    const targetDistance = targetDistancePresentation(context);
    const targetDistanceSuffix = targetDistance.text ? ` · ${targetDistance.text}` : "";
    const targetLine = target
        ? `${t("SMOOTHER_FIGHT.HUD.PlayerPrimaryTargetName", { user: userName, target: targetName })}${targetDistanceSuffix}${additionalTargetCount ? ` (+${additionalTargetCount})` : ""}`
        : t("SMOOTHER_FIGHT.HUD.NoTargetDetail");
    const minimized = getSetting("minimized", false);
    const hudToggle = buildHudToggle(minimized);
    const personalTarget = targets.some((candidate) => services.isCurrentUserTarget(candidate));
    const currentPlayersTurn = isPlayersTurn({
        isGm: game.user?.isGM,
        userId: game.user?.id,
        controllerUserId: runtimeController?.id,
        ownsActor: actor.isOwner,
    });
    const turnNotice = currentPlayersTurn
        ? `<span class="sf-your-turn"><i class="fa-solid fa-bolt"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.YourTurn"))}</span>`
        : "";
    const controllerNotice = assignedUser && runtimeController?.id !== assignedUser.id
        ? `<span class="sf-runtime-controller"><i class="fa-solid fa-user-shield"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.RuntimeControllerFor", {
            controller: runtimeController?.name ?? t("SMOOTHER_FIGHT.HUD.NoRuntimeController"),
            assigned: assignedUser.name,
        }))}</span>`
        : "";
    const shellClass = currentPlayersTurn ? "sf-shell is-current-user-turn" : "sf-shell";

    if (minimized) {
        return `
            <div class="${shellClass} is-minimized">
                <main class="sf-center">
                    <header class="sf-turnline">
                        <span class="sf-live-dot"></span>
                        <strong>${escapeHtml(actor.name)}</strong>
                        <span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.CurrentTick", { tick }))}</span>
                        ${turnNotice}
                        ${controllerNotice}
                        <span class="sf-turn-target ${personalTarget ? "is-user-target" : ""}"><i class="fa-solid fa-crosshairs"></i> ${escapeHtml(targetLine)}</span>
                        ${buildGmCheatToggle()}
                        ${buildThemeToggle()}
                        ${hudToggle}
                    </header>
                </main>
            </div>
        `;
    }

    return `
        <div class="${shellClass}">
            ${portraitPanel({
                side: "actor", token, actor, eyebrow: t("SMOOTHER_FIGHT.HUD.Active"), action: "open-sheet",
                showDefenses: canViewDefenseValues(actor),
            })}
            <main class="sf-center">
                <header class="sf-turnline">
                    <span class="sf-live-dot"></span>
                    <strong>${escapeHtml(actor.name)}</strong>
                    <span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.CurrentTick", { tick }))}</span>
                    ${turnNotice}
                    ${controllerNotice}
                    <span class="sf-turn-target ${personalTarget ? "is-user-target" : ""}"><i class="fa-solid fa-crosshairs"></i> ${escapeHtml(targetLine)}</span>
                    ${buildGmCheatToggle()}
                    ${buildThemeToggle()}
                    ${hudToggle}
                </header>
                ${canAct ? buildCombatControls(context) : await buildPersonalControls(context)}
                ${canAct && getSetting("movementTracking", true) ? buildMovementTracker(context) : ""}
                ${canAct ? await buildActionBar(context, targetDistance.measurement) : ""}
                ${getSetting("showCards", true) ? services.buildCombatEvents(context) : ""}
            </main>
            <div class="sf-target-column">
                ${services.canChooseTarget(context) ? buildQuickTargets(context) : ""}
                ${target ? `<div class="sf-target-list">${buildSecondaryTargets(context)}<div class="sf-primary-target-panel">${portraitPanel({
                    side: "target",
                    token: target,
                    actor: target.actor,
                    eyebrow: `${t("SMOOTHER_FIGHT.HUD.PrimaryTarget")}${targetDistanceSuffix}`,
                    action: "open-token-sheet",
                    highlighted: services.isCurrentUserTarget(target),
                    primary: true,
                    showDefenses: canViewDefenseValues(target.actor),
                })}${services.canChooseTarget(context) ? `<button type="button" class="sf-primary-target-remove" data-sf-action="remove-target" data-token-uuid="${escapeAttr(target.uuid)}" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.RemoveTarget", { target: targetName }))}" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.HUD.RemoveTarget", { target: targetName }))}"><i class="fa-solid fa-xmark"></i></button>` : ""}</div></div>` : noTargetPanel()}
            </div>
        </div>
    `;
}

async function buildConcealedHud(context) {
    const minimized = getSetting("minimized", false);
    const label = t("SMOOTHER_FIGHT.HUD.UnknownActive");
    const hudToggle = buildHudToggle(minimized);
    const header = `
        <header class="sf-turnline">
            <span class="sf-live-dot"></span>
            <strong class="sf-concealed-name" title="${escapeAttr(label)}"><i class="fa-solid fa-circle-question"></i><span aria-hidden="true">?</span></strong>
            ${buildGmCheatToggle()}
            ${buildThemeToggle()}
            ${hudToggle}
        </header>`;

    if (minimized) {
        return `<div class="sf-shell is-minimized is-concealed-turn"><main class="sf-center">${header}</main></div>`;
    }

    const personalControls = await buildPersonalControls(context);
    const events = getSetting("showCards", true) ? services.buildCombatEvents(context) : "";
    return `
        <div class="sf-shell is-concealed-turn">
            ${concealedActorPanel(label)}
            <main class="sf-center">${header}${personalControls}${events}</main>
            <div class="sf-target-column sf-concealed-target-column" aria-hidden="true"></div>
        </div>`;
}

function concealedActorPanel(label) {
    return `
        <aside class="sf-portrait sf-actor sf-concealed-actor" aria-label="${escapeAttr(label)}">
            <div class="sf-portrait-image">
                <span class="sf-eyebrow">${escapeHtml(t("SMOOTHER_FIGHT.HUD.Active"))}</span>
                <span class="sf-concealed-symbol" aria-hidden="true"><i class="fa-solid fa-circle-question"></i></span>
            </div>
            <div class="sf-portrait-name" aria-hidden="true">?</div>
        </aside>`;
}

function buildHudToggle(minimized) {
    const label = t(minimized ? "SMOOTHER_FIGHT.HUD.ExpandHud" : "SMOOTHER_FIGHT.HUD.MinimizeHud");
    const icon = minimized ? "fa-window-maximize" : "fa-window-minimize";
    return `<button type="button" class="sf-hud-toggle" data-sf-action="toggle-hud" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"><i class="fa-solid ${icon}"></i></button>`;
}

function buildThemeToggle() {
    const light = getSetting("theme", "dark") === "light";
    const label = t(light ? "SMOOTHER_FIGHT.HUD.UseDarkMode" : "SMOOTHER_FIGHT.HUD.UseLightMode");
    return `<button type="button" class="sf-hud-toggle sf-theme-toggle" data-sf-action="toggle-theme" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"><i class="fa-solid ${light ? "fa-moon" : "fa-sun"}"></i></button>`;
}

function buildGmCheatToggle() {
    if (!game.user?.isGM) return "";
    const preset = services.getGmCheatRollPreset();
    const active = Boolean(preset);
    const label = active
        ? t("SMOOTHER_FIGHT.HUD.CheatRollCancel")
        : t("SMOOTHER_FIGHT.HUD.CheatRoll");
    return `<button type="button" class="sf-hud-toggle sf-cheat-roll-toggle ${active ? "is-active" : ""}" data-sf-action="toggle-cheat-roll" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}" aria-pressed="${active}"><i class="fa-solid fa-dice"></i></button>`;
}

function portraitPanel({ side, token, actor, eyebrow, action = "", highlighted = false, primary = false, showDefenses = true }) {
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
        <aside class="sf-portrait sf-${side} ${highlighted ? "sf-is-user-target" : ""} ${primary ? "sf-is-primary-target" : ""}" ${tokenReference} aria-label="${escapeAttr(`${eyebrow}: ${name}`)}">
            ${focusButton}
            <div class="sf-portrait-image">
                <img class="sf-portrait-art" src="${escapeAttr(image)}" alt="" aria-hidden="true">
                <span class="sf-eyebrow">${escapeHtml(eyebrow)}</span>
                ${highlighted ? `<span class="sf-target-alert"><i class="fa-solid fa-bullseye"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.YouAreTarget"))}</span></span>` : ""}
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

function canViewDefenseValues(actor) {
    const observer = Boolean(actor?.testUserPermission?.(game.user, "OBSERVER"));
    return mayViewTargetDefenses(getSetting("revealTargetDefenses", false), game.user?.isGM, observer);
}

function noTargetPanel() {
    return `
        <aside class="sf-portrait sf-target sf-no-target">
            <div class="sf-target-rings"><i class="fa-solid fa-crosshairs"></i></div>
            <strong>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoTarget"))}</strong>
            <small>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoTargetDetail"))}</small>
        </aside>
    `;
}

function buildSecondaryTargets(context) {
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

function buildCombatControls(context) {
    const initiative = Number(context.combatant.initiative);
    const paused = Number.isFinite(initiative) && initiative >= COMBAT_PAUSE.wait;
    const pauseButtons = paused
        ? `<button type="button" data-sf-action="resume-combatant" class="is-resume" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.Resume"))}"><i class="fa-solid fa-play-circle"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Resume"))}</span></button>`
        : `<button type="button" data-sf-action="pause-combatant" data-pause-type="wait" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.Wait"))}"><i class="fa-solid fa-hourglass-half"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Wait"))}</span></button>
           <button type="button" data-sf-action="pause-combatant" data-pause-type="keepReady" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.KeepReady"))}"><i class="fa-solid fa-hand"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.KeepReady"))}</span></button>`;
    const focusLabel = t("SMOOTHER_FIGHT.HUD.FocusCombatant");
    const tokenHidden = Boolean(context.token?.hidden);
    const combatantHidden = Boolean(context.combatant.hidden);
    const visibilityHidden = tokenHidden || combatantHidden;
    const visibilityLabel = t("SMOOTHER_FIGHT.HUD.Visibility");
    const tokenVisibilityLabel = t(tokenHidden ? "SMOOTHER_FIGHT.HUD.ShowToken" : "SMOOTHER_FIGHT.HUD.HideToken");
    const combatantVisibilityLabel = t(combatantHidden ? "SMOOTHER_FIGHT.HUD.ShowCombatant" : "SMOOTHER_FIGHT.HUD.HideCombatant");
    const combinedVisibilityLabel = t(visibilityHidden ? "SMOOTHER_FIGHT.HUD.ShowTokenAndCombatant" : "SMOOTHER_FIGHT.HUD.HideTokenAndCombatant");
    const defeatedLabel = t(context.combatant.isDefeated ? "SMOOTHER_FIGHT.HUD.RestoreCombatant" : "SMOOTHER_FIGHT.HUD.MarkDefeated");
    const removeLabel = t("SMOOTHER_FIGHT.HUD.RemoveCombatant");
    const gmControls = game.user.isGM ? `
        <details class="sf-visibility-menu ${visibilityHidden ? "is-active" : ""}"><summary class="sf-icon-button" title="${escapeAttr(visibilityLabel)}" aria-label="${escapeAttr(visibilityLabel)}"><i class="fa-solid ${visibilityHidden ? "fa-eye-slash" : "fa-eye"}"></i><span class="sf-control-label">${escapeHtml(visibilityLabel)}</span><i class="fa-solid fa-chevron-down sf-chevron"></i></summary>
            <div class="sf-visibility-popover" aria-label="${escapeAttr(visibilityLabel)}"><button type="button" data-sf-action="toggle-token-hidden" class="${tokenHidden ? "is-active" : ""}" aria-pressed="${tokenHidden}" title="${escapeAttr(tokenVisibilityLabel)}"><i class="fa-solid ${tokenHidden ? "fa-eye" : "fa-eye-slash"}"></i><span>${escapeHtml(tokenVisibilityLabel)}</span></button><button type="button" data-sf-action="toggle-combatant-hidden" class="${combatantHidden ? "is-active" : ""}" aria-pressed="${combatantHidden}" title="${escapeAttr(combatantVisibilityLabel)}"><i class="fa-solid ${combatantHidden ? "fa-list" : "fa-list-check"}"></i><span>${escapeHtml(combatantVisibilityLabel)}</span></button><button type="button" data-sf-action="toggle-combatant-visibility" class="${visibilityHidden ? "is-active" : ""}" aria-pressed="${visibilityHidden}" title="${escapeAttr(combinedVisibilityLabel)}"><i class="fa-solid ${visibilityHidden ? "fa-eye" : "fa-eye-slash"}"></i><span>${escapeHtml(combinedVisibilityLabel)}</span></button></div></details>
        <button type="button" data-sf-action="toggle-combatant-defeated" class="sf-icon-button ${context.combatant.isDefeated ? "is-active" : ""}" title="${escapeAttr(defeatedLabel)}" aria-label="${escapeAttr(defeatedLabel)}"><i class="fa-solid fa-skull"></i><span class="sf-control-label">${escapeHtml(defeatedLabel)}</span></button>
        <button type="button" data-sf-action="remove-combatant" class="sf-icon-button is-danger" title="${escapeAttr(removeLabel)}" aria-label="${escapeAttr(removeLabel)}"><i class="fa-solid fa-circle-minus"></i><span class="sf-control-label">${escapeHtml(removeLabel)}</span></button>
    ` : "";

    return `<section class="sf-combat-controls" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.HUD.CombatControls"))}">
        ${buildAdvanceButtons(context)}
        <div class="sf-pause-buttons">${pauseButtons}</div>
        <div class="sf-tracker-buttons">
            <button type="button" data-sf-action="focus-combatant" class="sf-icon-button" title="${escapeAttr(focusLabel)}" aria-label="${escapeAttr(focusLabel)}"><i class="fa-solid fa-bullseye"></i><span class="sf-control-label">${escapeHtml(focusLabel)}</span></button>
            ${gmControls}
        </div>
    </section>`;
}

function buildAdvanceButtons(context, includeActorName = false) {
    const tickButtons = [1, 2, 3, 4, 5, 6, 7, 8, 10].map((ticks) => buildAdvanceButton(ticks)).join("");
    const label = includeActorName
        ? `${t("SMOOTHER_FIGHT.HUD.Advance")} · ${context.actor.name}`
        : t("SMOOTHER_FIGHT.HUD.Advance");
    return `<div class="sf-tick-buttons"><span class="sf-tick-label">${escapeHtml(label)}</span>${tickButtons}${buildAdvanceButton("custom")}${buildTickActionReference(context.actor)}</div>`;
}

function buildAdvanceButton(ticks) {
    const custom = ticks === "custom";
    const label = custom
        ? t("SMOOTHER_FIGHT.HUD.CustomTicks")
        : t("SMOOTHER_FIGHT.HUD.AddTicks", { ticks });
    return `<button type="button" data-sf-action="add-ticks" data-ticks="${escapeAttr(ticks)}" aria-label="${escapeAttr(label)}">${custom ? "+X" : `+${escapeHtml(ticks)} T`}</button>`;
}
async function buildPersonalControls(activeContext) {
    const candidates = getPersonalHudCandidates(activeContext);
    const context = getPersonalHudContext(activeContext);
    const picker = candidates.length > 1 ? buildPersonalCombatantPicker(candidates, context) : "";
    const defenseRequest = services.getPendingActiveDefense(activeContext);
    const defenseControl = defenseRequest ? activeDefenseResponseControl(defenseRequest) : "";
    if (!context) {
        const note = activeContext.runtimeController
            ? t("SMOOTHER_FIGHT.HUD.SelectOwnedToken")
            : t("SMOOTHER_FIGHT.HUD.RuntimeControllerUnavailable");
        return `<div class="sf-personal-controls sf-personal-selection-required">
            ${picker ? `<nav class="sf-actions sf-personal-skill-actions" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.HUD.ChooseOwnCombatant"))}">${picker}</nav>` : ""}
            <p class="sf-owner-note"><i class="fa-solid fa-arrow-pointer"></i>${escapeHtml(note)}</p>
        </div>`;
    }
    const attributes = `data-sf-context-combatant-id="${escapeAttr(context.combatant.id)}" data-sf-context-actor-id="${escapeAttr(context.actor.id)}"`;
    const targetDistance = targetDistancePresentation(context);
    const meleeAttackControl = await buildAttackControlMarkup(context.actor, {
        meleeOnly: true,
        rangeMeasurement: targetDistance.measurement,
    });
    return `<div class="sf-personal-controls" ${attributes}>
        <section class="sf-combat-controls sf-personal-combat-controls" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.HUD.CombatControls"))}">
            ${buildAdvanceButtons(context, true)}
        </section>
        ${buildPersonalActionBar(context.actor, `${defenseControl}${picker}`, meleeAttackControl)}
    </div>`;
}

function buildPersonalCombatantPicker(candidates, context) {
    const selectedId = context?.combatant?.id ?? null;
    const current = candidates.find((candidate) => candidate.combatant.id === selectedId) ?? null;
    const label = current?.token?.name ?? current?.actor?.name ?? t("SMOOTHER_FIGHT.HUD.ChooseOwnCombatant");
    const body = [...candidates]
        .sort((left, right) => String(left.token?.name ?? left.actor?.name ?? "").localeCompare(
            String(right.token?.name ?? right.actor?.name ?? ""),
            game.i18n.lang
        ))
        .map((candidate) => {
            const name = candidate.token?.name ?? candidate.actor.name;
            const actorName = candidate.token?.name && candidate.token.name !== candidate.actor.name ? candidate.actor.name : "";
            const tokenReference = candidate.tokenUuid ? ` data-token-uuid="${escapeAttr(candidate.tokenUuid)}"` : "";
            const selected = candidate.combatant.id === selectedId;
            const tick = Math.round(Number(candidate.combatant.initiative) || 0);
            return `<button type="button" data-sf-action="select-personal-combatant" data-combatant-id="${escapeAttr(candidate.combatant.id)}"${tokenReference} class="${selected ? "is-current" : ""}" aria-pressed="${selected}">
                <img src="${escapeAttr(candidate.token?.texture?.src ?? candidate.actor.img ?? "icons/svg/mystery-man.svg")}" alt="">
                <span>${escapeHtml(name)}${actorName ? `<small>${escapeHtml(actorName)}</small>` : ""}</span>
                <b>${escapeHtml(t("SMOOTHER_FIGHT.HUD.CurrentTick", { tick }))}</b>
            </button>`;
        }).join("");
    const title = t("SMOOTHER_FIGHT.HUD.ChooseOwnCombatant");
    return `<details class="sf-action-menu sf-personal-combatant-picker">
        <summary title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}"><i class="fa-solid fa-users"></i><span>${escapeHtml(label)}</span><i class="fa-solid fa-chevron-down sf-chevron"></i></summary>
        <div class="sf-action-popover">${body}</div>
    </details>`;
}

function getSkillActionData(actor) {
    const skills = Object.values(actor.skills ?? {})
        .filter((skill) => numericValue(skill.points) > 0 || ["acrobatics", "athletics", "determination", "stealth", "perception", "endurance"].includes(skill.id))
        .sort((a, b) => displayLabel(a.label).localeCompare(displayLabel(b.label), game.i18n.lang));
    const favoriteSkillIds = normalizeFavoriteSkillIds(
        actor.getFlag?.(MODULE_ID, "favoriteSkillIds"),
        skills.map((skill) => skill.id),
        MAX_FAVORITE_SKILLS
    );
    const favoriteSkillIdSet = new Set(favoriteSkillIds);
    const favoriteSkills = favoriteSkillIds
        .map((id) => skills.find((skill) => skill.id === id))
        .filter(Boolean);
    const skillMenuBody = buildSkillMenuBody(skills, favoriteSkillIdSet);
    const skillControlMarkup = favoriteSkills.length === 1
        ? directSkillControl(favoriteSkills[0], skillMenuBody)
        : actionMenu("fa-solid fa-dice-d20", t("SMOOTHER_FIGHT.HUD.Skills"), skillMenuBody, "", "skills");
    return { favoriteSkills, skillControlMarkup };
}

function buildPersonalActionBar(actor, leadingControl = "", meleeAttackControl = "") {
    const { favoriteSkills, skillControlMarkup } = getSkillActionData(actor);
    return `<nav class="sf-actions sf-personal-skill-actions" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.Title"))}">
        ${attackPreparationMarkup(actor)}
        ${leadingControl}
        ${skillControlMarkup}
        ${meleeAttackControl}
        ${favoriteSkills.length > 1 ? buildFavoriteSkillBar(favoriteSkills) : ""}
    </nav>`;
}

async function buildActionBar(context, rangeMeasurement = null) {
    const actor = context.actor;
    const defenseRequest = services.getPendingActiveDefense(context);
    const preparationStatus = services.getPreparationApplicationStatus?.(actor) ?? { state: "idle", record: null };
    const preparedSpellId = actor.getFlag?.("splittermond", "preparedSpell");
    const { favoriteSkills, skillControlMarkup } = getSkillActionData(actor);
    const spells = [...(actor.spells ?? [])].sort((a, b) =>
        Number(b.id === preparedSpellId) - Number(a.id === preparedSpellId) || sortByName(a, b)
    );
    const preparedSpell = spells.find((spell) => spell.id === preparedSpellId) ?? null;
    const availableSpells = spells.filter((spell) => spell.enoughFocus !== false).length;
    const spellLabel = `${t("SMOOTHER_FIGHT.HUD.Spells")} (${availableSpells})`;
    const preparedSpellRange = preparedSpell && isTargetDependentDifficulty(preparedSpell.difficulty ?? preparedSpell.system?.difficulty)
        ? spellRangePresentation(preparedSpell, rangeMeasurement)
        : null;
    const spellControlMarkup = preparedSpell
        ? preparedSpellMenu(preparedSpell, availableSpells, preparedSpellRange)
        : buildSpellMenu(spellLabel, spells, availableSpells, rangeMeasurement);
    const attackControlMarkup = await buildAttackControlMarkup(actor, { rangeMeasurement });
    return `<nav class="sf-actions" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.Title"))}">
        ${attackPreparationMarkup(actor)}
        ${preparationApplicationMarkup(preparationStatus)}
        ${skillControlMarkup}
        ${attackControlMarkup}
        ${spellControlMarkup}
        ${defenseRequest ? activeDefenseResponseControl(defenseRequest) : actionMenu("fa-solid fa-shield-halved", t("SMOOTHER_FIGHT.HUD.Defense"), [
            defenseButton(actor, "defense", "VTD"),
            defenseButton(actor, "bodyresist", "KW"),
            defenseButton(actor, "mindresist", "GW"),
        ].join(""), "sf-defense-menu")}
        ${favoriteSkills.length > 1 ? buildFavoriteSkillBar(favoriteSkills) : ""}
    </nav>`;
}

function attackPreparationMarkup(actor) {
    const preparation = services.getAttackPreparation?.(actor, globalThis.game?.combat?.id);
    if (!preparation) return "";
    const action = t(`SMOOTHER_FIGHT.HUD.TickActions.${preparation.actionId}.Name`);
    const status = t("SMOOTHER_FIGHT.HUD.AttackPreparationStatus", {
        action,
        bonus: preparation.bonus,
    });
    const target = preparation.actionId === "aim" && preparation.targetName
        ? `<small>${escapeHtml(t("SMOOTHER_FIGHT.HUD.AttackPreparationTarget", { target: preparation.targetName }))}</small>`
        : "";
    const clear = t("SMOOTHER_FIGHT.HUD.ClearAttackPreparation");
    return `<div class="sf-attack-preparation-status" data-sf-attack-preparation-id="${escapeAttr(preparation.id)}" role="status">
        <span><i class="fa-solid ${preparation.actionId === "aim" ? "fa-crosshairs" : "fa-magnifying-glass"}" aria-hidden="true"></i><strong>${escapeHtml(status)}</strong>${target}</span>
        <button type="button" data-sf-action="clear-attack-preparation" title="${escapeAttr(clear)}" aria-label="${escapeAttr(clear)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    </div>`;
}

function buildSpellMenu(label, spells, availableSpells, rangeMeasurement = null) {
    const filterable = isSpellListFilterable(spells);
    const rows = spells.map((spell) => {
        const preparing = services.isPreparingSpell(spell.id);
        const skillLabel = displayLabel(spell.skill?.label);
        const skillValue = displayValue(spell.skill?.value, "");
        const skill = [skillLabel, skillValue].filter((value) => value !== "").join(" ");
        const focus = t("SMOOTHER_FIGHT.HUD.FocusCosts", { costs: spellFocusCosts(spell) });
        const status = preparing
            ? t("SMOOTHER_FIGHT.HUD.Preparing")
            : displayValue(spell.castDuration, "–");
        const range = isTargetDependentDifficulty(spell.difficulty ?? spell.system?.difficulty)
            ? spellRangePresentation(spell, rangeMeasurement)
            : null;
        const { schoolId, level } = spellFilterDetails(spell);
        const filterAttributes = filterable
            ? ` data-sf-spell-row data-sf-search="${escapeAttr(spellSearchValue(spell))}" data-sf-enough-focus="${spell.enoughFocus !== false}" data-sf-spell-school="${escapeAttr(schoolId)}" data-sf-spell-level="${escapeAttr(level)}"`
            : "";
        return `<button type="button" data-sf-action="spell" data-spell-id="${escapeAttr(spell.id)}" class="sf-spell-action ${preparing ? "is-preparing" : ""} ${range?.buttonClass ?? ""}"${filterAttributes} ${spell.enoughFocus === false || preparing ? 'aria-disabled="true"' : ""}>
            <img src="${escapeAttr(spell.img)}" alt=""><span>${escapeHtml(spell.name)}<small>${escapeHtml([skill, focus].filter(Boolean).join(" · "))}</small>${rangeStatusMarkup(range)}</span>
            <b>${escapeHtml(status)}</b>
        </button>`;
    }).join("") || emptyMenuText();
    return spellActionMenu(label, filterable ? buildSpellFilterBody(spells, rows, availableSpells) : rows, filterable);
}

function buildSpellFilterBody(spells, rows, availableSpells) {
    const { schools, levels } = spellFilterOptions(spells);
    const schoolFilter = schools.length > 1 ? `<label><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.SpellSchool"))}</span><select data-sf-spell-school>
        <option value="all">${escapeHtml(t("SMOOTHER_FIGHT.HUD.AllSpellSchools"))}</option>
        ${schools.map(({ id, label }) => `<option value="${escapeAttr(id)}">${escapeHtml(label)}</option>`).join("")}
    </select></label>` : "";
    const levelFilter = levels.length > 1 ? `<label><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.SpellLevel"))}</span><select data-sf-spell-level>
        <option value="all">${escapeHtml(t("SMOOTHER_FIGHT.HUD.AllSpellLevels"))}</option>
        ${levels.map((level) => `<option value="${escapeAttr(level)}">${escapeHtml(t("SMOOTHER_FIGHT.HUD.SpellLevelValue", { level }))}</option>`).join("")}
    </select></label>` : "";
    return `<label class="sf-spell-search">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input type="search" data-sf-spell-search autocomplete="off" spellcheck="false" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.HUD.SpellSearch"))}" placeholder="${escapeAttr(t("SMOOTHER_FIGHT.HUD.SpellSearchPlaceholder"))}">
    </label>
    <div class="sf-spell-availability-filters" role="group" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.HUD.SpellAvailabilityFilter"))}">
        <button type="button" data-sf-spell-availability="all" aria-pressed="true"><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.AllSpells"))}</span><b>${spells.length}</b></button>
        <button type="button" data-sf-spell-availability="focus" aria-pressed="false"${availableSpells ? "" : " disabled"}><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.AffordableSpells"))}</span><b>${availableSpells}</b></button>
    </div>
    ${schoolFilter || levelFilter ? `<div class="sf-spell-secondary-filters">${schoolFilter}${levelFilter}</div>` : ""}
    <div class="sf-spell-results" data-sf-spell-results>
        ${rows}
        <p class="sf-spell-filter-empty" data-sf-spell-filter-empty hidden>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoMatchingSpells"))}</p>
    </div>`;
}

function spellActionMenu(label, body, filterable) {
    const popoverClass = filterable ? "sf-action-popover sf-spell-popover" : "sf-action-popover";
    const filterAttribute = filterable ? " data-sf-spell-filterable" : "";
    return `<details class="sf-action-menu" data-sf-menu="spells">
        <summary title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"><i class="fa-solid fa-wand-sparkles" aria-hidden="true"></i><span>${escapeHtml(label)}</span><i class="fa-solid fa-chevron-down sf-chevron" aria-hidden="true"></i></summary>
        <div class="${popoverClass}"${filterAttribute}>${body}</div>
    </details>`;
}

function preparationApplicationMarkup({ state, record }) {
    if (!record || !["applying", "uncertain"].includes(state)) return "";
    const text = t(state === "applying"
        ? "SMOOTHER_FIGHT.HUD.OperationApplying"
        : "SMOOTHER_FIGHT.HUD.OperationUncertain");
    const recovery = state === "uncertain" && game.user?.isGM
        ? `<button type="button" data-sf-action="recover-preparation" data-decision="retry"><i class="fa-solid fa-rotate-left"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.RetryOperation"))}</button>
            <button type="button" data-sf-action="recover-preparation" data-decision="complete"><i class="fa-solid fa-check"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.MarkOperationCompleted"))}</button>`
        : "";
    return `<div class="sf-operation-recovery-actions sf-preparation-application is-${escapeAttr(state)}">
        <span><i class="fa-solid ${state === "applying" ? "fa-spinner fa-spin" : "fa-triangle-exclamation"}"></i>${escapeHtml(text)}</span>${recovery}
    </div>`;
}

async function buildAttackControlMarkup(actor, { meleeOnly = false, rangeMeasurement = null } = {}) {
    const preparedAttackId = actor.getFlag?.("splittermond", "preparedAttack");
    const storedDefaultAttackId = actor.getFlag?.(MODULE_ID, "defaultAttackId");
    const availableAttacks = [...(actor.attacks ?? [])]
        .filter((attack) => !meleeOnly || !services.isRangedAttack(attack));
    const equipment = meleeOnly
        ? []
        : Array.from(actor.items ?? []).filter((item) => ["weapon", "shield"].includes(item.type)).sort(sortByName);
    const attackControl = attackControlState(availableAttacks.map((attack) => attack.id), storedDefaultAttackId, equipment.length);
    const attackStates = new Map(availableAttacks.map((attack) => [
        attack.id,
        attackReadiness(services.isRangedAttack(attack), attack.id, preparedAttackId),
    ]));
    const attackRanges = new Map(availableAttacks.map((attack) => [
        attack.id,
        attackRangePresentation(attack, services.isRangedAttack(attack), rangeMeasurement),
    ]));
    const attacks = availableAttacks.sort((a, b) =>
        Number(attackStates.get(b.id)?.prepared) - Number(attackStates.get(a.id)?.prepared) || sortByName(a, b)
    );
    const preparedAttack = attacks.find((attack) => attackStates.get(attack.id)?.prepared) ?? null;
    const directAttack = attacks.find((attack) => attack.id === attackControl.directAttackId) ?? null;
    const attackSpeeds = new Map(await Promise.all(attacks.map(async (attack) => [attack.id, await services.getAttackSpeed(attack)])));
    const attackMenuBody = buildAttackMenuBody(
        attacks,
        equipment,
        attackStates,
        attackSpeeds,
        attackRanges,
        attackControl.defaultAttackId,
        attackControl.automaticDefaultAttackId
    );
    const attackSelection = attackControlSelection(preparedAttack?.id, directAttack?.id);
    const label = meleeOnly
        ? t("SMOOTHER_FIGHT.HUD.TickActions.meleeAttack.Name")
        : t("SMOOTHER_FIGHT.HUD.Attacks");
    return attackSelection.mode === "prepared"
        ? preparedAttackMenu(preparedAttack, attackRanges.get(preparedAttack.id))
        : attackSelection.mode === "default"
            ? directAttackControl(directAttack, {
                menuBody: attackMenuBody,
                showMenu: attackControl.showMenu,
                isDefault: directAttack.id === attackControl.defaultAttackId,
                readiness: attackStates.get(directAttack.id),
                speed: attackSpeeds.get(directAttack.id),
                range: attackRanges.get(directAttack.id),
                label: meleeOnly ? label : null,
            })
            : actionMenu("fa-solid fa-hand-fist", label, attackMenuBody, "", "attacks");
}

function buildSkillMenuBody(skills, favoriteSkillIds) {
    return skills.map((skill) => {
        const label = displayLabel(skill.label, skill.id);
        const isFavorite = favoriteSkillIds.has(skill.id);
        const toggleLabel = t(isFavorite ? "SMOOTHER_FIGHT.HUD.ClearFavoriteSkill" : "SMOOTHER_FIGHT.HUD.SetFavoriteSkill");
        return `<div class="sf-skill-option ${isFavorite ? "is-favorite" : ""}">
            <button type="button" class="sf-skill-option-roll" data-sf-action="skill" data-skill-id="${escapeAttr(skill.id)}">
                <span>${escapeHtml(label)}</span><b>${escapeHtml(displayValue(skill.value))}</b>
            </button>
            <button type="button" class="sf-favorite-skill-toggle ${isFavorite ? "is-favorite" : ""}" data-sf-action="toggle-favorite-skill" data-skill-id="${escapeAttr(skill.id)}" title="${escapeAttr(toggleLabel)}" aria-label="${escapeAttr(toggleLabel)}" aria-pressed="${isFavorite}"><i class="${isFavorite ? "fa-solid" : "fa-regular"} fa-star"></i></button>
        </div>`;
    }).join("") || emptyMenuText();
}

function buildFavoriteSkillBar(skills) {
    return `<div class="sf-skill-favorites" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.HUD.FavoriteSkills"))}">
        ${skills.map((skill) => {
            const label = displayLabel(skill.label, skill.id);
            const dragLabel = t("SMOOTHER_FIGHT.HUD.ReorderFavoriteSkill", { skill: label });
            return `<button type="button" draggable="true" aria-grabbed="false" data-sf-action="skill" data-skill-id="${escapeAttr(skill.id)}" data-favorite-skill-id="${escapeAttr(skill.id)}" title="${escapeAttr(dragLabel)}"><i class="fa-solid fa-grip-vertical"></i><span>${escapeHtml(label)}</span><b>${escapeHtml(displayValue(skill.value))}</b></button>`;
        }).join("")}
    </div>`;
}

function directSkillControl(skill, menuBody) {
    const label = displayLabel(skill.label, skill.id);
    const menuLabel = t("SMOOTHER_FIGHT.HUD.OpenSkillMenu");
    return `<div class="sf-action-menu sf-direct-attack-control sf-direct-skill-control has-menu">
        <button type="button" class="sf-direct-attack sf-direct-skill" data-sf-action="skill" data-skill-id="${escapeAttr(skill.id)}" aria-label="${escapeAttr(label)}">
            <i class="fa-solid fa-star"></i>
            <span><small>${escapeHtml(t("SMOOTHER_FIGHT.HUD.FavoriteSkill"))}</small><strong>${escapeHtml(label)}</strong></span>
            <b>${escapeHtml(displayValue(skill.value))}</b>
        </button>
        <details class="sf-direct-attack-picker sf-direct-skill-picker" data-sf-menu="skills"><summary title="${escapeAttr(menuLabel)}" aria-label="${escapeAttr(menuLabel)}"><i class="fa-solid fa-chevron-down sf-chevron"></i></summary><div class="sf-action-popover">${menuBody}</div></details>
    </div>`;
}

function buildAttackMenuBody(attacks, equipment, attackStates, attackSpeeds, attackRanges, defaultAttackId, automaticDefaultAttackId) {
    const attackOptions = attacks.map((attack) => {
        const isDefault = attack.id === defaultAttackId;
        const isAutomatic = attack.id === automaticDefaultAttackId;
        const toggleLabel = t(isAutomatic
            ? "SMOOTHER_FIGHT.HUD.AutomaticDefaultAttack"
            : isDefault
                ? "SMOOTHER_FIGHT.HUD.ClearDefaultAttack"
                : "SMOOTHER_FIGHT.HUD.SetDefaultAttack");
        const range = attackRanges.get(attack.id);
        return `<div class="sf-attack-option ${isDefault ? "is-default" : ""}">
            <button type="button" class="sf-attack-option-roll ${attackStates.get(attack.id)?.prepared ? "is-prepared" : ""} ${range?.buttonClass ?? ""}" data-sf-action="attack" data-attack-id="${escapeAttr(attack.id)}">
                <img src="${escapeAttr(attack.img)}" alt=""><span>${escapeHtml(attack.name)}<small>${escapeHtml([displayLabel(attack.skill?.label), displayValue(attack.skill?.value, "")].filter((value) => value !== "").join(" "))}</small>${rangeStatusMarkup(range)}</span>
                <b>${escapeHtml(attackStates.get(attack.id)?.prepared ? displayValue(attack.damage, "–") : `${attackSpeeds.get(attack.id) ?? "–"} T`)}</b>
            </button>
            <button type="button" class="sf-default-attack-toggle ${isDefault ? "is-default" : ""} ${isAutomatic ? "is-automatic" : ""}" ${isAutomatic ? "disabled" : 'data-sf-action="toggle-default-attack"'} data-attack-id="${escapeAttr(attack.id)}" title="${escapeAttr(toggleLabel)}" aria-label="${escapeAttr(toggleLabel)}" aria-pressed="${isDefault}"><i class="${isDefault ? "fa-solid" : "fa-regular"} fa-star"></i></button>
        </div>`;
    }).join("") || emptyMenuText();
    const equipmentOptions = equipment.length
        ? `<h4>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Equip"))}</h4>${equipment.map((item) => `<button type="button" data-sf-action="toggle-equipped" data-item-id="${escapeAttr(item.id)}" class="${item.system?.equipped ? "is-equipped" : "is-unequipped"}">
            <img src="${escapeAttr(item.img)}" alt=""><span>${escapeHtml(item.name)}</span><i class="fa-solid ${item.system?.equipped ? "fa-toggle-on" : "fa-toggle-off"}"></i>
        </button>`).join("")}`
        : "";
    return attackOptions + equipmentOptions;
}

function directAttackControl(attack, { menuBody, showMenu, isDefault, readiness, speed, range, label: explicitLabel = null }) {
    const label = explicitLabel ?? t(isDefault ? "SMOOTHER_FIGHT.HUD.DefaultAttack" : "SMOOTHER_FIGHT.HUD.Attacks");
    const status = readiness?.ready ? displayValue(attack.damage, "–") : `${speed ?? "–"} T`;
    const menuLabel = t("SMOOTHER_FIGHT.HUD.OpenAttackMenu");
    return `<div class="sf-action-menu sf-direct-attack-control ${showMenu ? "has-menu" : ""}">
        <button type="button" class="sf-direct-attack ${range?.buttonClass ?? ""}" data-sf-action="attack" data-attack-id="${escapeAttr(attack.id)}" aria-label="${escapeAttr(attack.name)}">
            <img src="${escapeAttr(attack.img ?? "icons/svg/sword.svg")}" alt="">
            <span><small>${escapeHtml(label)}</small><strong>${escapeHtml(attack.name)}</strong>${rangeStatusMarkup(range)}</span>
            <b>${escapeHtml(status)}</b>
        </button>
        ${showMenu ? `<details class="sf-direct-attack-picker" data-sf-menu="attacks"><summary title="${escapeAttr(menuLabel)}" aria-label="${escapeAttr(menuLabel)}"><i class="fa-solid fa-chevron-down sf-chevron"></i></summary><div class="sf-action-popover">${menuBody}</div></details>` : ""}
    </div>`;
}

function actionMenu(icon, label, body, className = "", menuId = "") {
    const menuAttribute = menuId ? ` data-sf-menu="${escapeAttr(menuId)}"` : "";
    return `<details class="sf-action-menu ${escapeAttr(className)}"${menuAttribute}>
        <summary title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"><i class="${icon}" aria-hidden="true"></i><span>${escapeHtml(label)}</span><i class="fa-solid fa-chevron-down sf-chevron" aria-hidden="true"></i></summary>
        <div class="sf-action-popover">${body}</div>
    </details>`;
}

function activeDefenseResponseControl({ message, target }) {
    const label = t("SMOOTHER_FIGHT.HUD.Defense");
    const decline = t("SMOOTHER_FIGHT.HUD.DeclineActiveDefense");
    const targetName = target?.name ?? target?.actor?.name ?? "–";
    return `<div class="sf-action-menu sf-defense-response-control is-defense-alert">
        <button type="button" class="sf-defense-response" data-sf-action="respond-active-defense" data-message-id="${escapeAttr(message.id)}" aria-label="${escapeAttr(label)}">
            <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
            <span><small>${escapeHtml(targetName)}</small><strong>${escapeHtml(label)}</strong></span>
        </button>
        <button type="button" class="sf-decline-defense" data-sf-action="decline-active-defense" data-message-id="${escapeAttr(message.id)}" title="${escapeAttr(decline)}" aria-label="${escapeAttr(decline)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    </div>`;
}

function preparedSpellMenu(spell, availableSpells, range = null) {
    const cast = t("SMOOTHER_FIGHT.HUD.Cast");
    const cancel = t("SMOOTHER_FIGHT.HUD.CancelSpell");
    return `<div class="sf-action-menu sf-prepared-spell-menu">
        <button type="button" class="sf-prepared-spell-cast sf-spell-action ${range?.buttonClass ?? ""}" data-sf-action="cast-prepared-spell" data-spell-id="${escapeAttr(spell.id)}" aria-label="${escapeAttr(`${spell.name}: ${cast}`)}">
            <img src="${escapeAttr(spell.img ?? "icons/svg/daze.svg")}" alt="">
            <span><small>${escapeHtml(`${t("SMOOTHER_FIGHT.HUD.Spells")} (${availableSpells}) · ${t("SMOOTHER_FIGHT.HUD.PreparedSpell")}`)}</small><strong>${escapeHtml(spell.name)}</strong>${rangeStatusMarkup(range)}</span>
            <b><i class="fa-solid fa-wand-sparkles"></i><span>${escapeHtml(cast)}</span></b>
        </button>
        <button type="button" class="sf-prepared-spell-cancel" data-sf-action="cancel-prepared-spell" title="${escapeAttr(cancel)}" aria-label="${escapeAttr(cancel)}"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
}

function preparedAttackMenu(attack, range = null) {
    const release = t("SMOOTHER_FIGHT.HUD.ReleaseAttack");
    const cancel = t("SMOOTHER_FIGHT.HUD.CancelAttack");
    return `<div class="sf-action-menu sf-prepared-spell-menu sf-prepared-attack-menu">
        <button type="button" class="sf-prepared-spell-cast sf-prepared-attack-release ${range?.buttonClass ?? ""}" data-sf-action="attack" data-attack-id="${escapeAttr(attack.id)}" aria-label="${escapeAttr(`${attack.name}: ${release}`)}">
            <img src="${escapeAttr(attack.img ?? "icons/svg/sword.svg")}" alt="">
            <span><small>${escapeHtml(t("SMOOTHER_FIGHT.HUD.PreparedAttack"))}</small><strong>${escapeHtml(attack.name)}</strong>${rangeStatusMarkup(range)}</span>
            <b><i class="fa-solid fa-crosshairs"></i><span>${escapeHtml(release)}</span></b>
        </button>
        <button type="button" class="sf-prepared-spell-cancel" data-sf-action="cancel-prepared-attack" title="${escapeAttr(cancel)}" aria-label="${escapeAttr(cancel)}"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
}

function defenseButton(actor, type, abbreviation) {
    const options = activeDefenseOptionSummaries(actor.activeDefense?.[type]);
    const optionList = options.length ? `<span class="sf-defense-option-list">${options.map(({ label, value }) => `<small>${escapeHtml(label)}${value !== "" ? ` <b>${escapeHtml(value)}</b>` : ""}</small>`).join("")}</span>` : "";
    return `<button type="button" class="sf-defense-option" data-sf-action="defense" data-defense-type="${type}">
        <span class="sf-defense-option-heading"><strong>${abbreviation}</strong><b>${escapeHtml(getDerivedValue(actor, type))}</b></span>${optionList}
    </button>`;
}

function emptyMenuText() {
    return `<p class="sf-menu-empty">–</p>`;
}
