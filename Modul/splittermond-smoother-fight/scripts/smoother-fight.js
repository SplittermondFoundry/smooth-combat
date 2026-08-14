import {
    calculateActiveDefenseValue,
    combatMessageKind,
    findDefensiveFeatureValue,
    fullyConsumedCost,
    linkMatchesCombatant,
    normalizeUserTokenLinks,
    parseStatusEffectLabel,
    recalculateAttackReport,
    totalDegreesOfSuccess,
} from "./combat-rules.js";

const MODULE_ID = "splittermond-smoother-fight";
const SOCKET = `module.${MODULE_ID}`;
const SYSTEM_SOCKET = "system.splittermond";
const COMBAT_PAUSE = Object.freeze({ wait: 10000, keepReady: 20000 });

const runtime = {
    hud: null,
    renderTimer: null,
    targetByUser: new Map(),
    pendingDefense: null,
    preparingSpellId: null,
    hoveredToken: null,
    cardsCollapsed: false,
    startedAt: Date.now(),
};

Hooks.once("init", () => {
    registerSettings();
    registerSettingsMenu();
});

Hooks.once("ready", async () => {
    runtime.hud = new SmootherFightHud();
    runtime.hud.mount();
    registerHooks();
    registerSocket();
    publishOwnTarget();
    await runtime.hud.render();
});

function registerSettings() {
    const rerender = () => scheduleRender();
    game.settings.register(MODULE_ID, "enabled", {
        name: "SMOOTHER_FIGHT.Settings.EnabledName",
        hint: "SMOOTHER_FIGHT.Settings.EnabledHint",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "hideSystemBar", {
        name: "SMOOTHER_FIGHT.Settings.HideSystemBarName",
        hint: "SMOOTHER_FIGHT.Settings.HideSystemBarHint",
        scope: "client",
        config: true,
        type: Boolean,
        default: false,
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "showCards", {
        name: "SMOOTHER_FIGHT.Settings.ShowCardsName",
        hint: "SMOOTHER_FIGHT.Settings.ShowCardsHint",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "minimized", {
        scope: "client",
        config: false,
        type: Boolean,
        default: false,
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "maxCards", {
        name: "SMOOTHER_FIGHT.Settings.MaxCardsName",
        hint: "SMOOTHER_FIGHT.Settings.MaxCardsHint",
        scope: "client",
        config: true,
        type: Number,
        range: { min: 1, max: 5, step: 1 },
        default: 3,
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "defenseRecalculation", {
        name: "SMOOTHER_FIGHT.Settings.DefenseRecalculationName",
        hint: "SMOOTHER_FIGHT.Settings.DefenseRecalculationHint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID, "userTokenLinks", {
        scope: "world",
        config: false,
        type: Object,
        default: {},
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "primaryGmId", {
        scope: "world",
        config: false,
        type: String,
        default: "",
        onChange: rerender,
    });
}

function registerSettingsMenu() {
    const Base = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2);

    class UserTokenLinksApplication extends Base {
        static DEFAULT_OPTIONS = {
            id: "smoother-fight-user-token-links",
            classes: ["smoother-fight", "sf-settings"],
            tag: "div",
            position: { width: 620, height: 720 },
            window: {
                title: "SMOOTHER_FIGHT.Settings.LinksTitle",
                icon: "fa-solid fa-link",
                minimizable: true,
                resizable: false,
            },
        };

        static PARTS = {
            form: {
                template: `modules/${MODULE_ID}/templates/user-token-links.hbs`,
            },
        };

        async _prepareContext(options) {
            const context = await super._prepareContext(options);
            const primaryGmId = getSetting("primaryGmId", "");
            const links = normalizeUserTokenLinks(getSetting("userTokenLinks", {}), primaryGmId);
            const tokens = getSceneTokens().map((token) => ({
                uuid: token.uuid,
                actorUuid: token.actor?.uuid ?? null,
                actorId: token.actor?.id ?? null,
                label: `${token.name} — ${token.actor?.name ?? "–"}`,
            }));
            const allUsers = Array.from(game.users ?? []);
            const orderedUserIds = allUsers
                .map((user) => user.id)
                .sort((leftId, rightId) => leftId === primaryGmId ? 1 : rightId === primaryGmId ? -1 : 0);
            const ownerByToken = new Map(tokens.map((token) => {
                const ownerId = orderedUserIds.find((userId) =>
                    (links[userId] ?? []).some((link) => settingsLinkMatchesToken(link, token, tokens))
                );
                return [token.uuid, ownerId ?? null];
            }));
            const users = allUsers.map((user) => {
                return {
                    id: user.id,
                    name: user.name,
                    active: user.active,
                    isGM: user.isGM,
                    tokens: tokens.map((token) => ({
                        ...token,
                        selected: ownerByToken.get(token.uuid) === user.id || (!ownerByToken.get(token.uuid) && primaryGmId === user.id),
                        automatic: !ownerByToken.get(token.uuid) && primaryGmId === user.id,
                    })),
                };
            });
            const gms = allUsers.filter((user) => user.isGM).map((user) => ({
                id: user.id,
                name: user.name,
                selected: user.id === primaryGmId,
            }));
            return { ...context, users, gms, hasTokens: tokens.length > 0 };
        }

        async _onRender(context, options) {
            await super._onRender(context, options);
            const primaryGmSelect = this.element.querySelector('[data-role="primary-gm"]');
            const assignmentInputs = () => Array.from(this.element.querySelectorAll('input[type="checkbox"][data-user-id][data-token-uuid]'));
            const refreshAutomaticAssignments = () => {
                for (const input of assignmentInputs()) {
                    if (input.dataset.automatic !== "true") continue;
                    input.checked = false;
                    delete input.dataset.automatic;
                }
                const primaryGmId = primaryGmSelect?.value ?? "";
                if (!primaryGmId) return;
                const tokenUuids = new Set(assignmentInputs().map((input) => input.dataset.tokenUuid));
                for (const tokenUuid of tokenUuids) {
                    const inputs = assignmentInputs().filter((input) => input.dataset.tokenUuid === tokenUuid);
                    if (inputs.some((input) => input.checked)) continue;
                    const fallback = inputs.find((input) => input.dataset.userId === primaryGmId);
                    if (!fallback) continue;
                    fallback.checked = true;
                    fallback.dataset.automatic = "true";
                }
            };
            for (const checkbox of assignmentInputs()) {
                checkbox.addEventListener("change", () => {
                    if (checkbox.checked) {
                        for (const other of assignmentInputs()) {
                            if (other !== checkbox && other.dataset.tokenUuid === checkbox.dataset.tokenUuid) other.checked = false;
                        }
                    }
                    refreshAutomaticAssignments();
                });
            }
            primaryGmSelect?.addEventListener("change", refreshAutomaticAssignments);
            this.element.querySelector('[data-action="save-links"]')?.addEventListener("click", async () => {
                const links = {};
                for (const user of game.users ?? []) links[user.id] = [];
                const primaryGmId = primaryGmSelect?.value ?? "";
                const claimed = new Set();
                const checked = assignmentInputs()
                    .filter((checkbox) => checkbox.checked && checkbox.dataset.automatic !== "true")
                    .sort((left, right) => left.dataset.userId === primaryGmId ? 1 : right.dataset.userId === primaryGmId ? -1 : 0);
                for (const checkbox of checked) {
                    if (claimed.has(checkbox.dataset.tokenUuid)) continue;
                    const token = resolveToken(checkbox.value);
                    if (!token) continue;
                    claimed.add(checkbox.dataset.tokenUuid);
                    links[checkbox.dataset.userId] ??= [];
                    links[checkbox.dataset.userId].push({
                        tokenUuid: checkbox.value,
                        actorUuid: token?.actor?.uuid ?? null,
                        actorId: token?.actor?.id ?? null,
                        label: token?.name ?? checkbox.value,
                    });
                }
                await game.settings.set(MODULE_ID, "primaryGmId", primaryGmId);
                await game.settings.set(MODULE_ID, "userTokenLinks", links);
                ui.notifications.info(t("SMOOTHER_FIGHT.Settings.Saved"));
                this.close();
            });
        }
    }

    game.settings.registerMenu(MODULE_ID, "userTokenLinksMenu", {
        name: "SMOOTHER_FIGHT.Settings.LinksMenuName",
        label: "SMOOTHER_FIGHT.Settings.LinksMenuLabel",
        hint: "SMOOTHER_FIGHT.Settings.LinksMenuHint",
        icon: "fa-solid fa-link",
        type: UserTokenLinksApplication,
        restricted: true,
    });
}

function registerHooks() {
    const rerenderHooks = [
        "combatStart",
        "combatRound",
        "combatTurn",
        "updateCombat",
        "createCombat",
        "deleteCombat",
        "createCombatant",
        "updateCombatant",
        "deleteCombatant",
        "canvasReady",
        "updateActor",
        "createItem",
        "updateItem",
        "deleteItem",
    ];
    rerenderHooks.forEach((hook) => Hooks.on(hook, scheduleRender));

    Hooks.on("targetToken", (user, token, targeted) => {
        const changedUuid = tokenUuid(token);
        const remaining = Array.from(user.targets ?? []).filter((candidate) => tokenUuid(candidate) !== changedUuid);
        const target = targeted ? token : remaining.at(-1) ?? null;
        const uuid = tokenUuid(target);
        runtime.targetByUser.set(user.id, uuid);
        if (user.id === game.user.id) publishOwnTarget(uuid);
        scheduleRender();
    });

    Hooks.on("createChatMessage", (message) => {
        void onCreateChatMessage(message);
        scheduleRender();
    });
    Hooks.on("updateChatMessage", scheduleRender);
    Hooks.on("deleteChatMessage", scheduleRender);

    Hooks.on("renderChatMessageHTML", (message, html) => prepareRenderedChatMessage(message, html));
    Hooks.on("renderChatMessage", (message, html) => prepareRenderedChatMessage(message, asElement(html)));
}

function registerSocket() {
    game.socket.on(SOCKET, async (payload) => {
        if (!payload || typeof payload !== "object") return;

        if (payload.type === "target-update" && typeof payload.userId === "string") {
            const sender = game.users.get(payload.senderId);
            if (payload.senderId !== payload.userId && !sender?.isGM) return;
            runtime.targetByUser.set(payload.userId, payload.tokenUuid || null);
            scheduleRender();
            return;
        }

        if (payload.type === "set-target" && payload.recipientId === game.user.id) {
            const sender = game.users.get(payload.senderId);
            if (!sender?.isGM) return;
            const target = resolveToken(payload.tokenUuid);
            if (!target) return;
            setLocalTarget(target);
            publishOwnTarget(target.uuid);
            return;
        }

        if (payload.type === "recalculate-defense" && payload.recipientId === game.user.id && game.user.isGM) {
            const sender = game.users.get(payload.senderId);
            const message = game.messages.get(payload.defenseMessageId);
            const authorId = message?.author?.id ?? message?.user?.id ?? message?.user;
            if (!sender || !message || (!sender.isGM && authorId !== sender.id)) return;

            const pending = normalizePendingDefense(payload.pending);
            const attack = game.messages.get(pending?.attackMessageId);
            const target = resolveToken(pending?.targetTokenUuid);
            if (!pending || !attack || !isAttackMessage(attack)) return;
            if (!sender.isGM && !target?.actor?.testUserPermission?.(sender, "OWNER")) return;

            await processDefenseMessage(message, pending, { allowForeign: true });
        }
    });
}

class SmootherFightHud {
    constructor() {
        this.element = null;
        this.renderGeneration = 0;
    }

    mount() {
        document.querySelector(`#${MODULE_ID}-hud`)?.remove();
        this.element = document.createElement("section");
        this.element.id = `${MODULE_ID}-hud`;
        this.element.className = "sf-hud is-hidden";
        this.element.setAttribute("aria-live", "polite");
        document.body.append(this.element);
        this.element.addEventListener("click", (event) => void this.onClick(event));
    }

    async render() {
        if (!this.element) return;
        const generation = ++this.renderGeneration;
        const context = getHudContext();
        const visible = Boolean(getSetting("enabled", true) && context);
        this.element.classList.toggle("is-hidden", !visible);
        syncSystemActionBar(visible);
        if (!visible) {
            clearHoveredToken();
            this.element.replaceChildren();
            return;
        }

        const html = await buildHud(context);
        if (generation !== this.renderGeneration) return;
        clearHoveredToken();
        this.element.innerHTML = html;
        enforceChatPermissions(this.element, context);
        enforceFumbleActionState(this.element);
        bindQuickTargetHover(this.element);
    }

    async onClick(event) {
        const target = event.target.closest("[data-sf-action], .sf-chat-message .splittermond-chat-action, .sf-chat-message button, .sf-chat-message [role=button]");
        if (!target || !this.element.contains(target)) return;

        const action = target.dataset.sfAction;
        if (!action && target.closest(".sf-chat-message")) {
            await handleChatCardAction(event, target);
            return;
        }

        const context = getHudContext();
        if (!context) return;

        try {
            switch (action) {
                case "open-sheet":
                    context.actor.sheet.render({ force: true });
                    break;
                case "skill":
                    await requireOwner(context, () => context.actor.rollSkill(target.dataset.skillId));
                    break;
                case "attack":
                    await requireOwner(context, () => performAttack(context, target.dataset.attackId));
                    break;
                case "spell":
                    await requireOwner(context, () => performSpell(context, target.dataset.spellId));
                    break;
                case "cast-prepared-spell":
                    await requireOwner(context, () => performSpell(context, target.dataset.spellId));
                    break;
                case "cancel-prepared-spell":
                    await requireOwner(context, () => cancelPreparedSpell(context));
                    break;
                case "add-ticks":
                    await requireOwner(context, () => addCombatTicks(context, target.dataset.ticks));
                    break;
                case "pause-combatant":
                    await requireOwner(context, () => pauseCombatant(context, target.dataset.pauseType));
                    break;
                case "resume-combatant":
                    await requireOwner(context, () => resumeCombatant(context));
                    break;
                case "focus-combatant":
                    focusCombatantToken(context);
                    break;
                case "toggle-combatant-hidden":
                    await requireGm(() => context.combatant.update({ hidden: !context.combatant.hidden }));
                    break;
                case "toggle-combatant-defeated":
                    await requireGm(() => context.combatant.update({ defeated: !context.combatant.isDefeated }));
                    break;
                case "remove-combatant":
                    await requireGm(() => removeCombatant(context));
                    break;
                case "defense":
                    await requireOwner(context, () => context.actor.activeDefenseDialog(target.dataset.defenseType));
                    break;
                case "toggle-equipped":
                    await requireOwner(context, () => toggleEquipped(context.actor, target.dataset.itemId));
                    break;
                case "set-target":
                    await setTargetFromQuickMenu(context, target.dataset.tokenUuid);
                    break;
                case "toggle-cards":
                    runtime.cardsCollapsed = !runtime.cardsCollapsed;
                    scheduleRender(0);
                    break;
                case "toggle-hud":
                    await game.settings.set(MODULE_ID, "minimized", !getSetting("minimized", false));
                    break;
            }
        } catch (error) {
            console.error(`${MODULE_ID} | HUD action failed`, error);
            ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
        }
    }
}

async function buildHud(context) {
    const { combat, combatant, actor, token, linkedUser, target } = context;
    const canAct = Boolean(game.user.isGM || actor.isOwner);
    const tick = combat.currentTick ?? Math.round(Number(combatant.initiative) || 0);
    const userName = linkedUser?.name ?? t("SMOOTHER_FIGHT.HUD.AutomaticOwner");
    const targetLine = target
        ? t("SMOOTHER_FIGHT.HUD.PlayerTargetName", { user: userName, target: target.name })
        : t("SMOOTHER_FIGHT.HUD.NoTargetDetail");
    const minimized = getSetting("minimized", false);
    const hudToggle = buildHudToggle(minimized);

    if (minimized) {
        return `
            <div class="sf-shell is-minimized">
                <main class="sf-center">
                    <header class="sf-turnline">
                        <span class="sf-live-dot"></span>
                        <strong>${escapeHtml(actor.name)}</strong>
                        <span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.CurrentTick", { tick }))}</span>
                        <span class="sf-turn-target"><i class="fa-solid fa-crosshairs"></i> ${escapeHtml(targetLine)}</span>
                        ${hudToggle}
                    </header>
                </main>
            </div>
        `;
    }

    return `
        <div class="sf-shell">
            ${portraitPanel({ side: "actor", token, actor, eyebrow: t("SMOOTHER_FIGHT.HUD.Active"), action: "open-sheet" })}
            <main class="sf-center">
                <header class="sf-turnline">
                    <span class="sf-live-dot"></span>
                    <strong>${escapeHtml(actor.name)}</strong>
                    <span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.CurrentTick", { tick }))}</span>
                    <span class="sf-turn-target"><i class="fa-solid fa-crosshairs"></i> ${escapeHtml(targetLine)}</span>
                    ${hudToggle}
                </header>
                ${canAct ? buildCombatControls(context) : ""}
                ${canAct ? await buildActionBar(context) : `<p class="sf-owner-note"><i class="fa-solid fa-lock"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoOwner"))}</p>`}
                ${getSetting("showCards", true) ? buildCombatEvents(context) : ""}
            </main>
            ${target ? portraitPanel({ side: "target", token: target, actor: target.actor, eyebrow: t("SMOOTHER_FIGHT.HUD.Target") }) : noTargetPanel()}
        </div>
        ${canChooseTarget(context) ? buildQuickTargets(context) : ""}
    `;
}

function buildHudToggle(minimized) {
    const label = t(minimized ? "SMOOTHER_FIGHT.HUD.ExpandHud" : "SMOOTHER_FIGHT.HUD.MinimizeHud");
    const icon = minimized ? "fa-window-maximize" : "fa-window-minimize";
    return `<button type="button" class="sf-hud-toggle" data-sf-action="toggle-hud" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"><i class="fa-solid ${icon}"></i></button>`;
}

function portraitPanel({ side, token, actor, eyebrow, action = "" }) {
    const image = token?.texture?.src ?? actor?.img ?? "icons/svg/mystery-man.svg";
    const clickable = action ? `data-sf-action="${action}" role="button" tabindex="0"` : "";
    const defense = getDerivedValue(actor, "defense");
    const body = getDerivedValue(actor, "bodyresist");
    const mind = getDerivedValue(actor, "mindresist");
    return `
        <aside class="sf-portrait sf-${side}" ${clickable}>
            <div class="sf-portrait-image" style="--sf-token-image:url('${escapeCssUrl(image)}')">
                <span class="sf-eyebrow">${escapeHtml(eyebrow)}</span>
            </div>
            <div class="sf-portrait-name">${escapeHtml(token?.name ?? actor?.name ?? "–")}</div>
            <div class="sf-defense-row" aria-label="VTD, KW, GW">
                <span><small>VTD</small>${escapeHtml(defense)}</span>
                <span><small>KW</small>${escapeHtml(body)}</span>
                <span><small>GW</small>${escapeHtml(mind)}</span>
            </div>
            ${resourceBars(actor)}
        </aside>
    `;
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

function resourceBars(actor) {
    const health = actor?.system?.healthBar;
    const focus = actor?.system?.focusBar;
    if (!health && !focus) return "";
    return `<div class="sf-resources">
        ${resourceBar("health", t("SMOOTHER_FIGHT.HUD.Health"), health)}
        ${resourceBar("focus", t("SMOOTHER_FIGHT.HUD.Focus"), focus)}
    </div>`;
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
    const preparedSpellId = context.actor.getFlag?.("splittermond", "preparedSpell");
    const preparedSpell = context.actor.spells?.find((spell) => spell.id === preparedSpellId) ?? null;
    const tickButtons = [1, 2, 3, 5, 10].map((ticks) => `
        <button type="button" data-sf-action="add-ticks" data-ticks="${ticks}" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.AddTicks", { ticks }))}">+${ticks} T</button>
    `).join("");
    const pauseButtons = paused
        ? `<button type="button" data-sf-action="resume-combatant" class="is-resume" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.Resume"))}"><i class="fa-solid fa-play-circle"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Resume"))}</span></button>`
        : `<button type="button" data-sf-action="pause-combatant" data-pause-type="wait" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.Wait"))}"><i class="fa-solid fa-hourglass-half"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Wait"))}</span></button>
           <button type="button" data-sf-action="pause-combatant" data-pause-type="keepReady" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.KeepReady"))}"><i class="fa-solid fa-hand"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.KeepReady"))}</span></button>`;
    const prepared = preparedSpell ? `
        <div class="sf-prepared-spell">
            <img src="${escapeAttr(preparedSpell.img ?? "icons/svg/daze.svg")}" alt="">
            <span><small>${escapeHtml(t("SMOOTHER_FIGHT.HUD.PreparedSpell"))}</small><strong>${escapeHtml(preparedSpell.name)}</strong></span>
            <button type="button" data-sf-action="cast-prepared-spell" data-spell-id="${escapeAttr(preparedSpell.id)}" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.Cast"))}"><i class="fa-solid fa-wand-sparkles"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Cast"))}</button>
            <button type="button" data-sf-action="cancel-prepared-spell" class="is-cancel" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.CancelSpell"))}"><i class="fa-solid fa-xmark"></i></button>
        </div>` : "";
    const gmControls = game.user.isGM ? `
        <button type="button" data-sf-action="toggle-combatant-hidden" class="sf-icon-button ${context.combatant.hidden ? "is-active" : ""}" title="${escapeAttr(t(context.combatant.hidden ? "SMOOTHER_FIGHT.HUD.ShowCombatant" : "SMOOTHER_FIGHT.HUD.HideCombatant"))}"><i class="fa-solid ${context.combatant.hidden ? "fa-eye" : "fa-eye-slash"}"></i></button>
        <button type="button" data-sf-action="toggle-combatant-defeated" class="sf-icon-button ${context.combatant.isDefeated ? "is-active" : ""}" title="${escapeAttr(t(context.combatant.isDefeated ? "SMOOTHER_FIGHT.HUD.RestoreCombatant" : "SMOOTHER_FIGHT.HUD.MarkDefeated"))}"><i class="fa-solid fa-skull"></i></button>
        <button type="button" data-sf-action="remove-combatant" class="sf-icon-button is-danger" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.RemoveCombatant"))}"><i class="fa-solid fa-circle-minus"></i></button>
    ` : "";

    return `<section class="sf-combat-controls" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.HUD.CombatControls"))}">
        <div class="sf-tick-buttons"><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Advance"))}</span>${tickButtons}<button type="button" data-sf-action="add-ticks" data-ticks="custom" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.CustomTicks"))}">+X</button></div>
        <div class="sf-pause-buttons">${pauseButtons}</div>
        ${prepared}
        <div class="sf-tracker-buttons">
            <button type="button" data-sf-action="focus-combatant" class="sf-icon-button" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.FocusCombatant"))}"><i class="fa-solid fa-bullseye"></i></button>
            ${gmControls}
        </div>
    </section>`;
}

async function buildActionBar(context) {
    const actor = context.actor;
    const preparedSpell = actor.getFlag?.("splittermond", "preparedSpell");
    const skills = Object.values(actor.skills ?? {})
        .filter((skill) => numericValue(skill.points) > 0 || ["acrobatics", "athletics", "determination", "stealth", "perception", "endurance"].includes(skill.id))
        .sort((a, b) => displayLabel(a.label).localeCompare(displayLabel(b.label), game.i18n.lang));
    const spells = [...(actor.spells ?? [])].sort((a, b) =>
        Number(b.id === preparedSpell) - Number(a.id === preparedSpell) || sortByName(a, b)
    );
    const attacks = [...(actor.attacks ?? [])].sort(sortByName);
    const attackSpeeds = new Map(await Promise.all(attacks.map(async (attack) => [attack.id, await getAttackSpeed(attack)])));
    const equipment = Array.from(actor.items ?? []).filter((item) => ["weapon", "shield"].includes(item.type)).sort(sortByName);

    return `<nav class="sf-actions" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.Title"))}">
        ${actionMenu("fa-solid fa-dice-d20", t("SMOOTHER_FIGHT.HUD.Skills"), skills.map((skill) => `
            <button type="button" data-sf-action="skill" data-skill-id="${escapeAttr(skill.id)}">
                <span>${escapeHtml(displayLabel(skill.label, skill.id))}</span><b>${escapeHtml(displayValue(skill.value))}</b>
            </button>`).join(""))}
        ${actionMenu("fa-solid fa-wand-sparkles", t("SMOOTHER_FIGHT.HUD.Spells"), spells.map((spell) => {
            const preparing = runtime.preparingSpellId === spell.id;
            const prepared = !runtime.preparingSpellId && preparedSpell === spell.id;
            const skillLabel = displayLabel(spell.skill?.label);
            const skillValue = displayValue(spell.skill?.value, "");
            const status = preparing
                ? t("SMOOTHER_FIGHT.HUD.Preparing")
                : prepared
                    ? `${t("SMOOTHER_FIGHT.HUD.Prepared")} · ${t("SMOOTHER_FIGHT.HUD.Cast")}`
                    : displayValue(spell.castDuration, "–");
            return `<button type="button" data-sf-action="spell" data-spell-id="${escapeAttr(spell.id)}" class="${prepared ? "is-prepared" : ""} ${preparing ? "is-preparing" : ""}" ${spell.enoughFocus === false || preparing ? "disabled" : ""}>
                <img src="${escapeAttr(spell.img)}" alt=""><span>${escapeHtml(spell.name)}<small>${escapeHtml([skillLabel, skillValue].filter((value) => value !== "").join(" "))}</small></span>
                <b>${escapeHtml(status)}</b>
            </button>`;
        }).join("") || emptyMenuText() )}
        ${actionMenu("fa-solid fa-hand-fist", t("SMOOTHER_FIGHT.HUD.Attacks"), `
            ${attacks.map((attack) => `<button type="button" data-sf-action="attack" data-attack-id="${escapeAttr(attack.id)}" class="${attack.isPrepared ? "is-prepared" : ""}">
                <img src="${escapeAttr(attack.img)}" alt=""><span>${escapeHtml(attack.name)}<small>${escapeHtml([displayLabel(attack.skill?.label), displayValue(attack.skill?.value, "")].filter((value) => value !== "").join(" "))}</small></span>
                <b>${escapeHtml(attack.isPrepared ? (displayValue(attack.damage, "–")) : `${attackSpeeds.get(attack.id) ?? "–"} T`)}</b>
            </button>`).join("") || emptyMenuText()}
            ${equipment.length ? `<h4>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Equip"))}</h4>${equipment.map((item) => `<button type="button" data-sf-action="toggle-equipped" data-item-id="${escapeAttr(item.id)}" class="${item.system?.equipped ? "is-equipped" : "is-unequipped"}">
                <img src="${escapeAttr(item.img)}" alt=""><span>${escapeHtml(item.name)}</span><i class="fa-solid ${item.system?.equipped ? "fa-toggle-on" : "fa-toggle-off"}"></i>
            </button>`).join("")}` : ""}
        `)}
        ${actionMenu("fa-solid fa-shield-halved", t("SMOOTHER_FIGHT.HUD.Defense"), [
            defenseButton(actor, "defense", "VTD"),
            defenseButton(actor, "bodyresist", "KW"),
            defenseButton(actor, "mindresist", "GW"),
        ].join(""))}
        <div class="sf-defense-pills" aria-hidden="true">
            <span>VTD <b>${escapeHtml(getDerivedValue(actor, "defense"))}</b></span>
            <span>KW <b>${escapeHtml(getDerivedValue(actor, "bodyresist"))}</b></span>
            <span>GW <b>${escapeHtml(getDerivedValue(actor, "mindresist"))}</b></span>
        </div>
    </nav>`;
}

function actionMenu(icon, label, body) {
    return `<details class="sf-action-menu">
        <summary><i class="${icon}"></i><span>${escapeHtml(label)}</span><i class="fa-solid fa-chevron-up sf-chevron"></i></summary>
        <div class="sf-action-popover">${body}</div>
    </details>`;
}

function defenseButton(actor, type, abbreviation) {
    const options = actor.activeDefense?.[type] ?? [];
    const suffix = options.length > 1 ? `<small>${options.length} ${escapeHtml(t("SMOOTHER_FIGHT.HUD.Defense"))}</small>` : "";
    return `<button type="button" data-sf-action="defense" data-defense-type="${type}">
        <span>${abbreviation}${suffix}</span><b>${escapeHtml(getDerivedValue(actor, type))}</b>
    </button>`;
}

function emptyMenuText() {
    return `<p class="sf-menu-empty">–</p>`;
}

function buildCombatEvents(context) {
    const groups = collectCombatEventGroups(context);
    const title = runtime.cardsCollapsed ? t("SMOOTHER_FIGHT.HUD.ExpandCards") : t("SMOOTHER_FIGHT.HUD.CollapseCards");
    const body = !groups.length
        ? `<p class="sf-events-empty">${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoEvents"))}</p>`
        : groups.map((group, index) => buildEventGroup(group, index === groups.length - 1)).join("");
    return `<section class="sf-events ${runtime.cardsCollapsed ? "is-collapsed" : ""}">
        <button type="button" class="sf-events-heading" data-sf-action="toggle-cards" title="${escapeAttr(title)}">
            <span><i class="fa-solid fa-message"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.CombatEvents"))}</span>
            <i class="fa-solid fa-chevron-${runtime.cardsCollapsed ? "up" : "down"}"></i>
        </button>
        <div class="sf-event-scroller">${body}</div>
    </section>`;
}

function buildEventGroup(group, isLatest) {
    const primary = group.primary;
    const context = getMessageContext(primary);
    const recalculated = context?.recalculatedFrom;
    const superseded = context?.supersededBy;
    const badge = group.kind === "spell"
        ? `<span class="sf-event-badge is-spell"><i class="fa-solid fa-wand-sparkles"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Spells"))}</span>`
        : recalculated
        ? `<span class="sf-event-badge is-defense"><i class="fa-solid fa-shield-halved"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenseResult"))}</span>`
        : superseded
            ? `<span class="sf-event-badge is-muted">${escapeHtml(t("SMOOTHER_FIGHT.HUD.OriginalAttack"))}</span>`
            : "";
    return `<details class="sf-event-group" ${isLatest && !runtime.cardsCollapsed ? "open" : ""}>
        <summary><span>${escapeHtml(primary.speaker?.alias ?? primary.author?.name ?? t(group.kind === "spell" ? "SMOOTHER_FIGHT.HUD.Spells" : "SMOOTHER_FIGHT.HUD.Attacks"))}</span>${badge}<i class="fa-solid fa-chevron-down"></i></summary>
        <div class="sf-event-body">
            ${chatMessageHtml(primary)}
            ${group.defenses.map((message) => `<div class="sf-associated-card"><h4><i class="fa-solid fa-shield"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenseResult"))}</h4>${chatMessageHtml(message)}</div>`).join("")}
            ${group.damages.map((message) => `<div class="sf-associated-card"><h4><i class="fa-solid fa-droplet"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Damage"))}</h4>${chatMessageHtml(message)}</div>`).join("")}
            ${group.fumbles.map((message) => `<div class="sf-associated-card is-fumble"><h4><i class="fa-solid fa-burst"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.MagicFumble"))}</h4>${chatMessageHtml(message)}</div>`).join("")}
        </div>
    </details>`;
}

function chatMessageHtml(message) {
    let content = message.content ?? "";
    if (isMagicFumbleMessage(message)) {
        const fumble = getFumbleData(message) ?? createMagicFumbleData(message, content);
        if (fumble) content = decorateMagicFumbleCard(content, fumble);
    }
    content = promoteChatCardActions(content);
    content = scopeChatCardIds(content, message.id);
    return `<article class="sf-chat-message message" data-message-id="${escapeAttr(message.id)}"><div class="message-content">${content}</div></article>`;
}

function promoteChatCardActions(content) {
    const template = document.createElement("template");
    template.innerHTML = content ?? "";
    for (const actions of template.content.querySelectorAll(".actions.splittermond-chat-action-container")) {
        actions.classList.add("sf-promoted-actions");
        actions.parentElement?.prepend(actions);
    }
    const wrapper = document.createElement("div");
    wrapper.append(template.content.cloneNode(true));
    return wrapper.innerHTML;
}

function scopeChatCardIds(content, messageId) {
    const template = document.createElement("template");
    template.innerHTML = content ?? "";
    const idMap = new Map();
    for (const element of template.content.querySelectorAll("[id]")) {
        const originalId = element.id;
        const scopedId = `${MODULE_ID}-${messageId}-${originalId}`;
        idMap.set(originalId, scopedId);
        element.id = scopedId;
    }
    for (const label of template.content.querySelectorAll("label[for]")) {
        const scopedId = idMap.get(label.htmlFor);
        if (scopedId) label.htmlFor = scopedId;
    }
    const wrapper = document.createElement("div");
    wrapper.append(template.content.cloneNode(true));
    return wrapper.innerHTML;
}

function buildQuickTargets(context) {
    const candidates = getCombatSceneTokens(context.combat).filter((token) => token.id !== context.token?.id);
    const body = candidates.length
        ? candidates.map((token) => `<button type="button" data-sf-action="set-target" data-token-uuid="${escapeAttr(token.uuid)}" class="${context.target?.uuid === token.uuid ? "is-current" : ""}">
            <img src="${escapeAttr(token.texture?.src ?? token.actor?.img ?? "icons/svg/mystery-man.svg")}" alt=""><span>${escapeHtml(token.name)}</span>
            ${context.target?.uuid === token.uuid ? '<i class="fa-solid fa-crosshairs"></i>' : ""}
        </button>`).join("")
        : `<p>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoCombatants"))}</p>`;
    return `<details class="sf-quick-targets">
        <summary><i class="fa-solid fa-crosshairs"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.QuickTarget"))}<i class="fa-solid fa-chevron-up"></i></summary>
        <div>${body}</div>
    </details>`;
}

function getHudContext() {
    const combat = game.combat;
    if (!combat?.started) return null;
    const combatant = combat.combatant ?? combat.turns?.[0] ?? null;
    const actor = combatant?.actor ?? null;
    if (!combatant || !actor) return null;
    const token = combatant.token ?? resolveCombatantToken(combatant);
    const linkedUser = getLinkedUser(combatant, actor);
    const target = getTargetForUser(linkedUser);
    return { combat, combatant, actor, token, linkedUser, target };
}

function getLinkedUser(combatant, actor) {
    const primaryGmId = getSetting("primaryGmId", "");
    const links = normalizeUserTokenLinks(getSetting("userTokenLinks", {}), primaryGmId);
    const assignments = Object.entries(links).sort(([leftId], [rightId]) =>
        leftId === primaryGmId ? 1 : rightId === primaryGmId ? -1 : 0
    );
    const exact = assignments.find(([, userLinks]) => userLinks.some((link) => linkMatchesCombatant(link, combatant)));
    const explicitlyLinkedUser = exact ? game.users.get(exact[0]) : null;
    if (explicitlyLinkedUser) return explicitlyLinkedUser;

    const primaryGm = game.users.get(primaryGmId);
    if (primaryGm?.isGM) return primaryGm;

    const users = Array.from(game.users ?? []);
    const owners = users.filter((user) => !user.isGM && actor.testUserPermission?.(user, "OWNER"));
    return owners.find((user) => user.active) ?? owners[0] ?? (game.user.isGM ? game.user : null);
}

function settingsLinkMatchesToken(link, token, sceneTokens) {
    if (link.tokenUuid === token.uuid) return true;
    const linkedTokenStillExists = sceneTokens.some((candidate) => candidate.uuid === link.tokenUuid);
    if (linkedTokenStillExists) return false;
    if (link.actorUuid && token.actorUuid) return link.actorUuid === token.actorUuid;
    return Boolean(link.actorId && token.actorId && link.actorId === token.actorId);
}

function getTargetForUser(user) {
    if (!user) return null;
    let uuid = runtime.targetByUser.get(user.id);
    if (user.id === game.user.id) {
        const localTarget = Array.from(user.targets ?? []).at(-1);
        uuid = tokenUuid(localTarget);
        runtime.targetByUser.set(user.id, uuid || null);
    }
    return uuid ? resolveToken(uuid) : null;
}

function getSceneTokens() {
    const scene = canvas?.scene;
    if (!scene) return [];
    return Array.from(scene.tokens ?? []).filter((token) => game.user.isGM || !token.hidden);
}

function getCombatSceneTokens(combat) {
    const sceneId = canvas?.scene?.id;
    return Array.from(combat.combatants ?? [])
        .map((combatant) => combatant.token ?? resolveCombatantToken(combatant))
        .filter((token) => token && (!sceneId || token.parent?.id === sceneId) && (game.user.isGM || !token.hidden));
}

function resolveCombatantToken(combatant) {
    return combatant?.tokenId ? canvas?.scene?.tokens?.get(combatant.tokenId) ?? null : null;
}

function resolveToken(uuid) {
    if (!uuid) return null;
    const resolved = globalThis.fromUuidSync?.(uuid);
    if (resolved?.documentName === "Token" || resolved?.constructor?.name?.includes("TokenDocument")) return resolved;
    return getSceneTokens().find((token) => token.uuid === uuid || token.id === uuid) ?? null;
}

function tokenUuid(tokenOrObject) {
    return tokenOrObject?.document?.uuid ?? tokenOrObject?.uuid ?? null;
}

function collectCombatEventGroups(context) {
    const messages = Array.from(game.messages?.contents ?? game.messages ?? []);
    const combatActorIds = new Set(Array.from(context.combat.combatants ?? []).map((c) => c.actorId).filter(Boolean));
    const primaryMessages = messages.filter((message) => {
        if (!isAttackMessage(message) && !isSpellMessage(message)) return false;
        const cardContext = getMessageContext(message);
        if (cardContext) return cardContext.combatId === context.combat.id;
        return Number(message.timestamp) >= runtime.startedAt && combatActorIds.has(message.speaker?.actor);
    });

    const groups = primaryMessages.map((primary) => ({
        primary,
        kind: isSpellMessage(primary) ? "spell" : "attack",
        damages: [],
        defenses: [],
        fumbles: [],
    }));
    for (const message of messages) {
        if (!isDamageMessage(message) && !isDefenseMessage(message) && !isMagicFumbleMessage(message)) continue;
        const fumble = getFumbleData(message);
        const cardContext = getMessageContext(message);
        let group = fumble?.sourceMessageId
            ? groups.find((candidate) => candidate.primary.id === fumble.sourceMessageId)
            : cardContext?.attackMessageId
            ? groups.find((candidate) => candidate.primary.id === cardContext.attackMessageId)
            : null;
        if (!group) {
            group = [...groups].reverse().find((candidate) =>
                message.timestamp >= candidate.primary.timestamp &&
                (isMagicFumbleMessage(message)
                    ? candidate.kind === "spell" && message.speaker?.actor === candidate.primary.speaker?.actor
                    : isDefenseMessage(message)
                    ? candidate.kind === "attack"
                    : message.speaker?.actor === candidate.primary.speaker?.actor)
            );
        }
        if (!group) continue;
        if (isMagicFumbleMessage(message)) group.fumbles.push(message);
        else (isDamageMessage(message) ? group.damages : group.defenses).push(message);
    }

    const max = Number(getSetting("maxCards", 3)) || 3;
    return groups.slice(-max);
}

async function performAttack(context, attackId) {
    if (!context.target) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.SelectTargetFirst"));
        return;
    }
    const attack = context.actor.attacks?.find((candidate) => candidate.id === attackId);
    if (!attack) return;
    if (attack.isPrepared) {
        const success = await context.actor.rollAttack(attackId);
        if (success) await context.actor.setFlag("splittermond", "preparedAttack", null);
    } else {
        await context.actor.addTicks(await getAttackSpeed(attack), `${localizeSystem("splittermond.attack", "Angriff")}: ${attack.name}`);
        await context.actor.setFlag("splittermond", "preparedAttack", attackId);
    }
    scheduleRender();
}

async function performSpell(context, spellId) {
    const spell = context.actor.spells?.find((candidate) => candidate.id === spellId);
    if (!spell) return;
    const prepared = context.actor.getFlag("splittermond", "preparedSpell") === spellId;
    if (prepared) {
        const success = await context.actor.rollSpell(spellId);
        if (success) await context.actor.setFlag("splittermond", "preparedSpell", null);
    } else {
        runtime.preparingSpellId = spellId;
        scheduleRender(0);
        try {
            const ticks = typeof spell.castDuration?.inTicks === "function"
                ? await spell.castDuration.inTicks()
                : numericValue(spell.castDuration);
            await context.actor.addTicks(
                ticks,
                `${localizeSystem("splittermond.castDuration", "Zauberdauer")}: ${spell.name}`
            );
            await context.actor.setFlag("splittermond", "preparedSpell", spellId);
        } finally {
            runtime.preparingSpellId = null;
        }
    }
    scheduleRender();
}

async function cancelPreparedSpell(context) {
    await context.actor.setFlag("splittermond", "preparedSpell", null);
    runtime.preparingSpellId = null;
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.SpellCancelled"));
    scheduleRender(0);
}

async function addCombatTicks(context, requestedTicks) {
    if (Number(context.combatant.initiative) >= COMBAT_PAUSE.wait) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.ResumeFirst"));
        return;
    }
    if (requestedTicks === "custom") {
        await context.actor.addTicks(3, t("SMOOTHER_FIGHT.HUD.CustomTicksPrompt", { name: context.actor.name }), true);
    } else {
        const ticks = Math.max(1, Number.parseInt(requestedTicks, 10) || 0);
        await context.combat.setInitiative(context.combatant.id, Math.round(Number(context.combatant.initiative) || 0) + ticks);
    }
    scheduleRender(0);
}

async function pauseCombatant(context, pauseType) {
    const value = COMBAT_PAUSE[pauseType];
    if (!value) return;
    await context.combat.setInitiative(context.combatant.id, value);
    scheduleRender(0);
}

async function resumeCombatant(context) {
    const wasReady = Number(context.combatant.initiative) === COMBAT_PAUSE.keepReady;
    const tick = Number.parseInt(context.combat.round, 10) || Number.parseInt(context.combat.currentTick, 10) || 0;
    await context.combat.setInitiative(context.combatant.id, tick, wasReady);
    scheduleRender(0);
}

function focusCombatantToken(context) {
    const object = context.token?.object ?? canvas?.tokens?.get(context.token?.id);
    if (!object?.center) return;
    canvas?.animatePan?.({ x: object.center.x, y: object.center.y });
    canvas?.ping?.(object.center);
}

async function requireGm(callback) {
    if (!game.user.isGM) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.GmOnly"));
        return;
    }
    return callback();
}

async function removeCombatant(context) {
    const confirmed = await confirmAction(
        t("SMOOTHER_FIGHT.HUD.RemoveCombatant"),
        t("SMOOTHER_FIGHT.HUD.RemoveCombatantConfirm", { name: context.combatant.name })
    );
    if (confirmed) await context.combatant.delete();
}

async function confirmAction(title, content) {
    const DialogV2 = foundry?.applications?.api?.DialogV2;
    if (DialogV2?.confirm) return DialogV2.confirm({ window: { title }, content: `<p>${escapeHtml(content)}</p>` });
    if (globalThis.Dialog?.confirm) return Dialog.confirm({ title, content: `<p>${escapeHtml(content)}</p>` });
    return false;
}

async function toggleEquipped(actor, itemId) {
    const item = actor.items?.get?.(itemId) ?? Array.from(actor.items ?? []).find((candidate) => candidate.id === itemId);
    if (!item || !("equipped" in (item.system ?? {}))) return;
    await item.update({ "system.equipped": !item.system.equipped });
}

async function requireOwner(context, callback) {
    if (!(game.user.isGM || context.actor.isOwner)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.NoOwner"));
        return;
    }
    return callback();
}

async function setTargetFromQuickMenu(context, uuid) {
    if (!canChooseTarget(context)) return;
    const token = resolveToken(uuid);
    if (!token) return;
    const recipient = game.user.isGM ? (context.linkedUser ?? game.user) : game.user;
    runtime.targetByUser.set(recipient.id, token.uuid);

    if (recipient.id === game.user.id) {
        setLocalTarget(token);
        publishOwnTarget(token.uuid);
    } else {
        game.socket.emit(SOCKET, {
            type: "set-target",
            senderId: game.user.id,
            recipientId: recipient.id,
            tokenUuid: token.uuid,
        });
        game.socket.emit(SOCKET, {
            type: "target-update",
            senderId: game.user.id,
            userId: recipient.id,
            tokenUuid: token.uuid,
        });
    }
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.TargetChanged", { target: token.name }));
    scheduleRender();
}

function setLocalTarget(tokenDocument) {
    const tokenObject = tokenDocument.object ?? canvas?.tokens?.get(tokenDocument.id);
    tokenObject?.setTarget(true, { user: game.user, releaseOthers: true, groupSelection: false });
}

function canChooseTarget(context) {
    return Boolean(
        game.user.isGM ||
        context.linkedUser?.id === game.user.id ||
        (!context.linkedUser && context.actor?.isOwner)
    );
}

function bindQuickTargetHover(root) {
    for (const button of root.querySelectorAll('.sf-quick-targets [data-sf-action="set-target"]')) {
        const highlight = () => highlightToken(button.dataset.tokenUuid);
        button.addEventListener("pointerenter", highlight);
        button.addEventListener("focus", highlight);
        button.addEventListener("pointerleave", clearHoveredToken);
        button.addEventListener("blur", clearHoveredToken);
    }
}

function highlightToken(uuid) {
    const tokenDocument = resolveToken(uuid);
    const tokenObject = tokenDocument?.object ?? canvas?.tokens?.get(tokenDocument?.id);
    if (!tokenObject || runtime.hoveredToken?.object === tokenObject) return;
    clearHoveredToken();
    runtime.hoveredToken = { object: tokenObject, wasHovered: Boolean(tokenObject.hover) };
    tokenObject.hover = true;
    refreshTokenHover(tokenObject);
}

function clearHoveredToken() {
    const state = runtime.hoveredToken;
    if (!state) return;
    runtime.hoveredToken = null;
    state.object.hover = state.wasHovered;
    refreshTokenHover(state.object);
}

function refreshTokenHover(tokenObject) {
    try {
        tokenObject.renderFlags?.set?.({ refreshState: true });
        tokenObject.refresh?.();
    } catch (error) {
        console.debug(`${MODULE_ID} | Could not refresh token hover state`, error);
    }
}

function publishOwnTarget(explicitUuid) {
    if (!game.user) return;
    const selected = Array.from(game.user.targets ?? []).at(-1);
    const uuid = explicitUuid === undefined ? tokenUuid(selected) : explicitUuid;
    runtime.targetByUser.set(game.user.id, uuid || null);
    game.socket?.emit(SOCKET, {
        type: "target-update",
        senderId: game.user.id,
        userId: game.user.id,
        tokenUuid: uuid || null,
    });
}

async function onCreateChatMessage(message) {
    try {
        if (isAttackMessage(message) || isSpellMessage(message)) await attachCombatContext(message);
        if (isMagicFumbleMessage(message)) await attachMagicFumbleActions(message);
        if (isDefenseMessage(message)) await processDefenseMessage(message);
    } catch (error) {
        console.error(`${MODULE_ID} | Failed to process chat message`, error);
    }
}

async function attachCombatContext(message) {
    if (getMessageContext(message) || !isOwnMessage(message)) return;
    const combat = game.combat;
    const speakerCombatant = Array.from(combat?.combatants ?? []).find((combatant) =>
        (message.speaker?.token && combatant.tokenId === message.speaker.token) ||
        (message.speaker?.actor && combatant.actorId === message.speaker.actor)
    );
    const actor = speakerCombatant?.actor ?? (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null);
    const linkedUser = speakerCombatant && actor ? getLinkedUser(speakerCombatant, actor) : game.user;
    const target = getTargetForUser(linkedUser);
    const context = {
        combatId: combat?.id ?? null,
        combatantId: speakerCombatant?.id ?? null,
        attackerTokenUuid: speakerCombatant?.token?.uuid ?? speakerTokenUuid(message),
        attackerActorUuid: actor?.uuid ?? null,
        targetTokenUuid: target?.uuid ?? null,
        targetActorUuid: target?.actor?.uuid ?? null,
        linkedUserId: linkedUser?.id ?? game.user.id,
        createdAt: Date.now(),
    };
    await safeSetFlag(message, "context", context);
}

function captureSystemActiveDefense(message, html) {
    if (!html || !isAttackMessage(message)) return;
    for (const button of html.querySelectorAll('[data-localaction="activeDefense" i], [data-local-action="activeDefense" i]')) {
        if (button.dataset.smootherFightCaptured) continue;
        button.dataset.smootherFightCaptured = "true";
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            void beginActiveDefense(message).catch((error) => {
                console.error(`${MODULE_ID} | Active defense failed`, error);
                ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
            });
        }, { capture: true });
    }
}

function prepareRenderedChatMessage(message, html) {
    if (!html) return;
    if (isMagicFumbleMessage(message) && !getFumbleData(message)) void attachMagicFumbleActions(message, html);
    captureSystemActiveDefense(message, html);
    bindMagicFumbleActions(message, html);
}

async function attachMagicFumbleActions(message, renderedRoot = null) {
    if (!(game.user.isGM || isOwnMessage(message)) || getFumbleData(message)) return;
    const renderedContent = renderedRoot
        ? (renderedRoot.matches?.(".message-content") ? renderedRoot : renderedRoot.querySelector?.(".message-content"))
        : null;
    const fumble = createMagicFumbleData(message, renderedContent ?? message.content);
    if (!fumble) return;
    const content = decorateMagicFumbleCard(renderedContent?.innerHTML ?? message.content, fumble);
    if (renderedContent) renderedContent.innerHTML = content;
    await message.update({ content, [`flags.${MODULE_ID}.fumble`]: fumble });
}

function createMagicFumbleData(message, contentOrRoot = message.content) {
    const extracted = extractMagicFumbleEffects(contentOrRoot);
    if (!extracted.damage && !extracted.conditions.length) return null;
    const actor = resolveSpeakerActor(message);
    const sourceMessage = [...Array.from(game.messages?.contents ?? [])].reverse().find((candidate) =>
        candidate.id !== message.id &&
        isSpellMessage(candidate) &&
        candidate.speaker?.actor === message.speaker?.actor &&
        Number(candidate.timestamp) <= Number(message.timestamp)
    );
    return {
        actorUuid: actor?.uuid ?? null,
        actorName: actor?.name ?? message.speaker?.alias ?? "",
        sourceMessageId: sourceMessage?.id ?? null,
        damage: extracted.damage,
        conditions: extracted.conditions,
        conditionMode: extracted.conditionMode,
        damageApplied: false,
        conditionsApplied: false,
    };
}

function extractMagicFumbleEffects(contentOrRoot) {
    let root = contentOrRoot;
    if (typeof contentOrRoot === "string") {
        const template = document.createElement("template");
        template.innerHTML = contentOrRoot;
        root = template.content;
    }
    const active = root?.querySelector?.(".fumble-table-result-item-active");
    if (!active) return { damage: 0, conditions: [], conditionMode: "all" };
    const inlineRoll = active.querySelector(".inline-roll, [data-roll]");
    const damageMatch = inlineRoll?.textContent?.trim().match(/-?\d+/u);
    const damage = Math.max(0, Number.parseInt(damageMatch?.[0] ?? "0", 10) || 0);
    const conditions = [];
    for (const link of active.querySelectorAll("a[data-uuid], a[data-pack], a.content-link")) {
        const pack = link.dataset.pack ?? "";
        const uuid = link.dataset.uuid ?? (pack && link.dataset.id ? `Compendium.${pack}.Item.${link.dataset.id}` : "");
        if (!uuid.includes("splittermond.statuseffects") && !pack.includes("splittermond.statuseffects")) continue;
        const parsed = parseStatusEffectLabel(link.textContent);
        if (!parsed.name) continue;
        conditions.push({ uuid: uuid || null, name: parsed.name, level: parsed.level });
    }
    const conditionMode = /\b(?:oder|or)\b/iu.test(active.textContent ?? "") ? "choose" : "all";
    return { damage, conditions, conditionMode };
}

function decorateMagicFumbleCard(content, fumble) {
    if (String(content).includes("sf-fumble-actions")) return content;
    const template = document.createElement("template");
    template.innerHTML = content ?? "";
    const table = template.content.querySelector(".fumble-table-result");
    if (!table) return content;
    const conditionNames = fumble.conditions.map((condition) => `${condition.name} ${condition.level}`).join(", ");
    const conditionActions = fumble.conditionMode === "choose"
        ? fumble.conditions.map((condition, index) => `<button type="button" data-sf-fumble-action="condition:${index}"><i class="fa-solid fa-person-burst"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumbleCondition", { condition: `${condition.name} ${condition.level}` }))}</button>`).join("")
        : fumble.conditions.length
            ? `<button type="button" data-sf-fumble-action="conditions" title="${escapeAttr(conditionNames)}"><i class="fa-solid fa-person-burst"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumbleConditions", { count: fumble.conditions.length }))}</button>`
            : "";
    const actions = `<div class="sf-fumble-actions">
        <strong><i class="fa-solid fa-burst"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumble"))}</strong>
        ${fumble.damage ? `<button type="button" data-sf-fumble-action="damage"><i class="fa-solid fa-heart-crack"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumbleDamage", { damage: fumble.damage }))}</button>` : ""}
        ${conditionActions}
    </div>`;
    table.insertAdjacentHTML("afterend", actions);
    const wrapper = document.createElement("div");
    wrapper.append(template.content.cloneNode(true));
    return wrapper.innerHTML;
}

function bindMagicFumbleActions(message, html) {
    applyFumbleActionState(message, html);
    for (const button of html.querySelectorAll("[data-sf-fumble-action]")) {
        if (button.dataset.smootherFightBound) continue;
        button.dataset.smootherFightBound = "true";
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await handleMagicFumbleAction(message, button.dataset.sfFumbleAction);
        });
    }
}

function enforceFumbleActionState(root) {
    for (const element of root.querySelectorAll(".sf-chat-message")) {
        const message = game.messages.get(element.dataset.messageId);
        if (message) applyFumbleActionState(message, element);
    }
}

function applyFumbleActionState(message, root) {
    const fumble = getFumbleData(message) ?? createMagicFumbleData(message);
    if (!fumble) return;
    const actor = resolveFumbleActor(message, fumble);
    const allowed = Boolean(game.user.isGM || actor?.isOwner);
    for (const button of root.querySelectorAll("[data-sf-fumble-action]")) {
        const applied = button.dataset.sfFumbleAction === "damage" ? fumble.damageApplied : fumble.conditionsApplied;
        button.disabled = applied || !allowed;
        button.classList.toggle("is-applied", Boolean(applied));
        if (applied) button.title = t("SMOOTHER_FIGHT.HUD.AlreadyApplied");
    }
}

async function handleMagicFumbleAction(message, action) {
    const fumble = getFumbleData(message) ?? createMagicFumbleData(message);
    if (!fumble) return;
    const actor = resolveFumbleActor(message, fumble);
    if (!actor || !(game.user.isGM || actor.isOwner)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.FumbleNotAllowed"));
        return;
    }
    const updated = { ...fumble };
    if (action === "damage" && !updated.damageApplied && updated.damage > 0) {
        await actor.consumeCost("health", fullyConsumedCost(updated.damage), t("SMOOTHER_FIGHT.HUD.MagicFumble"));
        updated.damageApplied = true;
        ui.notifications.info(t("SMOOTHER_FIGHT.HUD.FumbleDamageApplied", { damage: updated.damage, name: actor.name }));
    }
    if ((action === "conditions" || action.startsWith("condition:")) && !updated.conditionsApplied && updated.conditions.length) {
        const selectedConditions = action.startsWith("condition:")
            ? [updated.conditions[Number.parseInt(action.split(":")[1], 10)]].filter(Boolean)
            : updated.conditions;
        await applyFumbleConditions(actor, selectedConditions);
        updated.conditionsApplied = true;
        ui.notifications.info(t("SMOOTHER_FIGHT.HUD.FumbleConditionsApplied", { name: actor.name }));
    }
    await safeSetFlag(message, "fumble", updated);
    scheduleRender(0);
}

async function applyFumbleConditions(actor, conditions) {
    for (const condition of conditions) {
        const existing = Array.from(actor.items ?? []).find((item) =>
            item.type === "statuseffect" && item.name.localeCompare(condition.name, game.i18n.lang, { sensitivity: "base" }) === 0
        );
        if (existing) {
            const current = Math.max(0, numericValue(existing.system?.level));
            await existing.update({ "system.level": current + condition.level });
            continue;
        }
        const sourceItem = await resolveStatusEffectSource(condition);
        if (!sourceItem) throw new Error(`Status effect not found: ${condition.name}`);
        const source = cloneData(sourceItem.toObject());
        delete source._id;
        source.system ??= {};
        source.system.level = condition.level;
        await actor.createEmbeddedDocuments("Item", [source]);
    }
}

async function resolveStatusEffectSource(condition) {
    if (condition.uuid) {
        let item = null;
        try {
            item = globalThis.fromUuidSync?.(condition.uuid) ?? await globalThis.fromUuid?.(condition.uuid);
        } catch (error) {
            console.debug(`${MODULE_ID} | Could not resolve ${condition.uuid} synchronously`, error);
            item = await globalThis.fromUuid?.(condition.uuid);
        }
        if (item) return item;
    }
    const pack = game.packs.get("splittermond.statuseffects");
    if (!pack) return null;
    const index = await pack.getIndex({ fields: ["name"] });
    const entry = index.find((candidate) => candidate.name.localeCompare(condition.name, game.i18n.lang, { sensitivity: "base" }) === 0);
    return entry ? pack.getDocument(entry._id) : null;
}

function resolveSpeakerActor(message) {
    const scene = message.speaker?.scene ? game.scenes.get(message.speaker.scene) : null;
    const tokenActor = message.speaker?.token ? scene?.tokens?.get(message.speaker.token)?.actor : null;
    return tokenActor ?? (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null);
}

function resolveFumbleActor(message, fumble) {
    if (fumble.actorUuid) {
        try {
            const actor = globalThis.fromUuidSync?.(fumble.actorUuid);
            if (actor) return actor;
        } catch (error) {
            console.debug(`${MODULE_ID} | Could not resolve fumble actor ${fumble.actorUuid}`, error);
        }
    }
    return resolveSpeakerActor(message);
}

function getFumbleData(message) {
    return message?.getFlag?.(MODULE_ID, "fumble") ?? message?.flags?.[MODULE_ID]?.fumble ?? null;
}

function isMagicFumbleMessage(message) {
    const content = String(message?.content ?? "");
    if (!content.includes("fumble-table-result")) return false;
    const formula = String(message?.rolls?.[0]?.formula ?? "");
    const labels = [
        localizeSystem("splittermond.magicFumbleSorcerer", "Zauberpatzer (Zauberer)"),
        localizeSystem("splittermond.magicFumblePriest", "Zauberpatzer (Priester)"),
        localizeSystem("splittermond.focusCosts", "Fokuskosten"),
    ];
    return labels.some((label) => content.includes(label) || formula.includes(label));
}

function rememberPendingDefense(message, targetOverride = null) {
    const context = getMessageContext(message);
    const target = targetOverride
        ?? resolveToken(context?.targetTokenUuid)
        ?? getControlledTokenDocument()
        ?? getHudContext()?.target;
    runtime.pendingDefense = {
        attackMessageId: message.id,
        targetTokenUuid: target?.uuid ?? null,
        targetActorUuid: target?.actor?.uuid ?? null,
        expiresAt: Date.now() + 10 * 60 * 1000,
    };
    return target;
}

function getControlledTokenDocument() {
    const controlled = Array.from(canvas?.tokens?.controlled ?? []);
    return controlled.at(-1)?.document ?? null;
}

function normalizePendingDefense(value) {
    if (!value || typeof value !== "object" || typeof value.attackMessageId !== "string") return null;
    return {
        attackMessageId: value.attackMessageId,
        targetTokenUuid: typeof value.targetTokenUuid === "string" ? value.targetTokenUuid : null,
        targetActorUuid: typeof value.targetActorUuid === "string" ? value.targetActorUuid : null,
        expiresAt: Number(value.expiresAt) || Date.now() + 60 * 1000,
    };
}

function getActiveGm() {
    return Array.from(game.users ?? []).find((user) => user.isGM && user.active) ?? null;
}

async function processDefenseMessage(message, pendingOverride = null, { allowForeign = false } = {}) {
    if ((!allowForeign && !isOwnMessage(message)) || !getSetting("defenseRecalculation", true)) return;
    const check = getDefenseCheck(message);
    if (!check?.succeeded) return;

    let pending = normalizePendingDefense(pendingOverride) ?? runtime.pendingDefense;
    if (!pending || pending.expiresAt < Date.now()) pending = findPendingAttackForDefense(message);
    if (!pending?.attackMessageId) return;
    const alreadyRecalculated = Array.from(game.messages?.contents ?? []).some((candidate) =>
        getMessageContext(candidate)?.recalculatedFrom === pending.attackMessageId
    );
    if (alreadyRecalculated) {
        runtime.pendingDefense = null;
        return;
    }

    const target = resolveToken(pending.targetTokenUuid);
    if (target?.actor && message.speaker?.actor && target.actor.id !== message.speaker.actor) return;

    await safeSetFlag(message, "context", {
        attackMessageId: pending.attackMessageId,
        targetTokenUuid: pending.targetTokenUuid,
        targetActorUuid: pending.targetActorUuid,
    });

    if (!game.user.isGM) {
        const gm = getActiveGm();
        runtime.pendingDefense = null;
        if (!gm) {
            ui.notifications.warn(localizeSystem("splittermond.chatCard.noGMConnected", "Kein GM verbunden."));
            return;
        }
        game.socket.emit(SOCKET, {
            type: "recalculate-defense",
            senderId: game.user.id,
            recipientId: gm.id,
            defenseMessageId: message.id,
            pending,
        });
        return;
    }

    const newAttack = await recreateAttackAfterDefense(pending.attackMessageId, message, check);
    runtime.pendingDefense = null;
    if (newAttack) scheduleRender(0);
}

function findPendingAttackForDefense(message) {
    const messages = Array.from(game.messages?.contents ?? []).filter(isAttackMessage).reverse();
    const defenseActorId = message.speaker?.actor;
    const attack = messages.find((candidate) => {
        const context = getMessageContext(candidate);
        if (!context?.targetActorUuid) return false;
        const actor = globalThis.fromUuidSync?.(context.targetActorUuid);
        return actor?.id === defenseActorId && !context.supersededBy;
    });
    if (!attack) return null;
    const context = getMessageContext(attack);
    return {
        attackMessageId: attack.id,
        targetTokenUuid: context.targetTokenUuid,
        targetActorUuid: context.targetActorUuid,
        expiresAt: Date.now() + 1000,
    };
}

async function recreateAttackAfterDefense(attackMessageId, defenseMessage, defenseCheck) {
    const original = game.messages.get(attackMessageId);
    if (!original || !isAttackMessage(original)) return null;

    const featureValue = findDefensiveFeatureValue(defenseCheck.itemData);
    const newDefense = calculateActiveDefenseValue(defenseCheck, featureValue);
    const systemSource = cloneData(original.system?.toObject?.() ?? original.toObject().system);
    const config = globalThis.CONFIG?.splittermond ?? {};
    systemSource.checkReport = recalculateAttackReport(systemSource.checkReport, newDefense, {
        triumphBonus: config.check?.degreeOfSuccess?.triumphBonus ?? 3,
        fumblePenalty: config.check?.degreeOfSuccess?.fumblePenalty ?? -3,
        grazingHitBasePenalty: config.grazingHitBasePenalty ?? 2,
    });
    systemSource.checkReport.degreeOfSuccessMessage = checkResultMessage(systemSource.checkReport);
    systemSource.openDegreesOfSuccess = Math.max(
        0,
        totalDegreesOfSuccess(systemSource.checkReport) - (systemSource.checkReport.maneuvers?.length ?? 0)
    );
    resetAttackHandlers(systemSource);

    const source = cloneData(original.toObject());
    delete source._id;
    delete source._stats;
    delete source.timestamp;
    source.user = game.user.id;
    source.sound = null;
    source.system = systemSource;
    source.content = original.content;
    source.flags ??= {};
    source.flags[MODULE_ID] = {
        context: {
            ...getMessageContext(original),
            recalculatedFrom: original.id,
            defenseMessageId: defenseMessage.id,
            defenseValue: newDefense,
            defenseType: defenseCheck.defenseType,
            createdAt: Date.now(),
        },
    };
    if (source.flags.splittermond?.chatCard) source.flags.splittermond.chatCard.messageId = null;

    const created = await ChatMessage.create(source);
    if (!created) return null;
    const rendered = await renderTemplate(created.system.template, created.system.getData());
    const defenseLabel = localizeSystem(`splittermond.derivedAttribute.${defenseCheck.defenseType}.short`, String(defenseCheck.defenseType).toUpperCase());
    const banner = `<div class="sf-chat-recalculated"><i class="fa-solid fa-shield-halved"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Recalculated", { defense: defenseLabel, value: newDefense }))}</div>`;
    const decorated = decorateRecalculatedCard(rendered, banner);
    await created.update({ content: decorated });
    await safeSetFlag(original, "context", { ...getMessageContext(original), supersededBy: created.id });
    return created;
}

function resetAttackHandlers(systemSource) {
    if (systemSource.damageHandler) {
        systemSource.damageHandler.damageUsed = false;
        systemSource.damageHandler.penaltyUsed = false;
        systemSource.damageHandler.damageAddition = 0;
        systemSource.damageHandler.consumedGrazingHitCost = false;
        systemSource.damageHandler.convertedToNumbingDamage = false;
    }
    resetCheckedOptions(systemSource.damageHandler?.options);
    resetCheckedOptions(systemSource.noActionOptionsHandler);
}

function resetCheckedOptions(value, visited = new Set()) {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Object.hasOwn(value, "checked") && typeof value.checked === "boolean") value.checked = false;
    for (const nested of Object.values(value)) resetCheckedOptions(nested, visited);
}

function decorateRecalculatedCard(content, banner) {
    const template = document.createElement("template");
    template.innerHTML = content;
    template.content.querySelectorAll('[data-localaction="activeDefense" i], [data-local-action="activeDefense" i]').forEach((button) => button.remove());
    const wrapper = document.createElement("div");
    wrapper.append(template.content.cloneNode(true));
    return `${banner}${wrapper.innerHTML}`;
}

async function handleChatCardAction(event, button) {
    const messageElement = button.closest(".sf-chat-message");
    const message = game.messages.get(messageElement?.dataset.messageId);
    if (!message || button.disabled) return;
    const fumbleAction = button.dataset.sfFumbleAction;
    if (fumbleAction) {
        event.preventDefault();
        await handleMagicFumbleAction(message, fumbleAction);
        return;
    }
    const localAction = button.dataset.localaction ?? button.dataset.localAction;
    const remoteAction = button.dataset.action;
    if (!localAction && !remoteAction) return;
    event.preventDefault();

    try {
        if (String(localAction).toLocaleLowerCase() === "activedefense") {
            await beginActiveDefense(message);
            return;
        }

        const action = localAction || remoteAction;
        const actionData = { ...button.dataset, action };
        if (localAction) {
            await message.system.handleGenericAction(actionData);
        } else if (!game.user.isGM) {
            const activeGm = Array.from(game.users ?? []).some((user) => user.isGM && user.active);
            if (!activeGm) {
                ui.notifications.warn(localizeSystem("splittermond.chatCard.noGMConnected", "Kein GM verbunden."));
                return;
            }
            game.socket.emit(SYSTEM_SOCKET, {
                type: "chatAction",
                ...actionData,
                messageId: message.id,
                userId: game.user.id,
            });
        } else {
            await message.system.handleGenericAction(actionData);
            const content = await renderTemplate(message.system.template, message.system.getData());
            await message.update({ content });
        }
        scheduleRender();
    } catch (error) {
        console.error(`${MODULE_ID} | Chat card action failed`, error);
        ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
    }
}

async function beginActiveDefense(message) {
    const target = rememberPendingDefense(message);
    if (!target?.actor || !(game.user.isGM || target.actor.isOwner)) {
        runtime.pendingDefense = null;
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenseNotAllowed"));
        return;
    }
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.WaitingForDefense", { target: target.name }));
    const type = message.system?.checkReport?.defenseType ?? "defense";
    await target.actor.activeDefenseDialog(type || undefined);
}

function enforceChatPermissions(root, hudContext) {
    for (const element of root.querySelectorAll(".sf-chat-message")) {
        const message = game.messages.get(element.dataset.messageId);
        if (!message) continue;
        const speakerActor = resolveSpeakerActor(message);
        const mayChange = game.user.isGM || speakerActor?.isOwner || message.author?.id === game.user.id;
        if (!mayChange) {
            element.querySelectorAll("[data-action]:not([data-localaction]):not([data-local-action])").forEach((button) => button.remove());
        }

        const context = getMessageContext(message);
        const defenseTarget = resolveToken(context?.targetTokenUuid) ?? getControlledTokenDocument() ?? hudContext.target;
        const mayDefend = game.user.isGM || defenseTarget?.actor?.isOwner;
        if (!mayDefend || context?.supersededBy || context?.recalculatedFrom) {
            element.querySelectorAll('[data-localaction="activeDefense" i], [data-local-action="activeDefense" i]').forEach((button) => {
                button.disabled = true;
                if (context?.supersededBy || context?.recalculatedFrom) button.remove();
            });
        }
        element.querySelectorAll(".splittermond-chat-action-container:not(:has(.splittermond-chat-action))").forEach((container) => container.remove());
    }
}

function getMessageContext(message) {
    return message?.getFlag?.(MODULE_ID, "context") ?? message?.flags?.[MODULE_ID]?.context ?? null;
}

function getDefenseCheck(message) {
    return message?.getFlag?.("splittermond", "check") ?? message?.flags?.splittermond?.check ?? null;
}

function isAttackMessage(message) {
    return combatMessageKind(message) === "attack";
}

function isSpellMessage(message) {
    return combatMessageKind(message) === "spell";
}

function isDamageMessage(message) {
    return combatMessageKind(message) === "damage";
}

function isDefenseMessage(message) {
    return getDefenseCheck(message)?.type === "defense";
}

function isOwnMessage(message) {
    const authorId = message.author?.id ?? message.user?.id ?? message.user;
    return authorId === game.user.id;
}

function speakerTokenUuid(message) {
    const scene = game.scenes?.get(message.speaker?.scene);
    return scene?.tokens?.get(message.speaker?.token)?.uuid ?? null;
}

async function safeSetFlag(message, key, value) {
    try {
        return await message.setFlag(MODULE_ID, key, value);
    } catch (error) {
        console.debug(`${MODULE_ID} | Could not set ${key} flag on ${message.id}`, error);
        return null;
    }
}

function checkResultMessage(report) {
    if (report.isCrit) return localizeSystem("splittermond.critical", "Kritischer Erfolg");
    if (report.isFumble) return localizeSystem("splittermond.fumble", "Patzer");
    const amount = Math.min(Math.abs(totalDegreesOfSuccess(report)), 5);
    const state = report.succeeded ? "successMessage" : "failMessage";
    return localizeSystem(`splittermond.${state}.${amount}`, report.succeeded ? "Erfolg" : "Fehlschlag");
}

function scheduleRender(delay = 40) {
    clearTimeout(runtime.renderTimer);
    runtime.renderTimer = setTimeout(() => void runtime.hud?.render(), delay);
}

function syncSystemActionBar(hudVisible) {
    const bar = document.querySelector("#token-action-bar");
    if (!bar) return;
    const shouldHide = hudVisible && getSetting("hideSystemBar", false);
    bar.classList.toggle("sf-system-bar-hidden", shouldHide);
}

function getDerivedValue(actor, key) {
    return displayValue(actor?.derivedValues?.[key]?.value ?? actor?.system?.derivedValues?.[key]?.value, 0);
}

async function getAttackSpeed(attack) {
    try {
        if (typeof attack?.weaponSpeedAsync === "function") {
            return numericValue(await attack.weaponSpeedAsync());
        }
    } catch (error) {
        console.debug(`${MODULE_ID} | Could not calculate weapon speed for ${attack?.name ?? attack?.id}`, error);
    }
    return numericValue(attack?.weaponSpeed);
}

function numericValue(value, fallback = 0) {
    const displayed = displayValue(value, "");
    const numeric = typeof displayed === "number"
        ? displayed
        : Number.parseFloat(String(displayed).trim().replace(",", "."));
    return Number.isFinite(numeric) ? numeric : fallback;
}

function displayValue(value, fallback = 0, seen = new Set()) {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "string" || typeof value === "number") return value;
    if (typeof value !== "object" || seen.has(value)) return fallback;
    seen.add(value);

    for (const key of ["display", "calculationValue", "value", "total"]) {
        const candidate = value[key];
        if (candidate !== undefined && candidate !== null && candidate !== value) {
            const displayed = displayValue(candidate, "", seen);
            if (displayed !== "") return displayed;
        }
    }
    if (typeof value.calculateSync === "function") {
        try {
            return displayValue(value.calculateSync(), fallback, seen);
        } catch {
            return fallback;
        }
    }
    return fallback;
}

function displayLabel(value, fallback = "", seen = new Set()) {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "string") {
        const localized = game.i18n.localize(value);
        return localized === value ? value : localized;
    }
    if (typeof value === "number") return String(value);
    if (typeof value !== "object" || seen.has(value)) return fallback;
    seen.add(value);

    for (const key of ["long", "full", "name", "label", "short", "display", "value"]) {
        const candidate = value[key];
        if (candidate !== undefined && candidate !== null && candidate !== value) {
            const displayed = displayLabel(candidate, "", seen);
            if (displayed) return displayed;
        }
    }
    const stringified = value.toString?.();
    return stringified && stringified !== "[object Object]" ? stringified : fallback;
}

function getSetting(key, fallback) {
    try {
        return game.settings.get(MODULE_ID, key);
    } catch {
        return fallback;
    }
}

function t(key, data) {
    return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

function localizeSystem(key, fallback) {
    const localized = game.i18n.localize(key);
    return localized === key ? fallback : localized;
}

function sortByName(a, b) {
    return String(a?.name ?? "").localeCompare(String(b?.name ?? ""), game.i18n.lang);
}

function cloneData(value) {
    if (foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
    return structuredClone(value);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
    return escapeHtml(value);
}

function escapeCssUrl(value) {
    return String(value ?? "").replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\n", "");
}

function asElement(html) {
    if (html instanceof HTMLElement) return html;
    return html?.[0] instanceof HTMLElement ? html[0] : null;
}
