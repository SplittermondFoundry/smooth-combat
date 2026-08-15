import {
    actorLinkUuid,
    bestActiveDefenseValue,
    calculateActiveDefenseValue,
    combatMessageKind,
    findDefensiveFeatureValue,
    fullyConsumedCost,
    hasSplittermondCheckUpdate,
    isDefenderMasteryName,
    isTargetDependentDifficulty,
    isOffensiveCombatMessage,
    linkMatchesCombatant,
    mayUseRemoteChatActions,
    mayViewActorResources,
    mayViewTargetDifficulty,
    normalizeActorUserLinks,
    normalizeSearchText,
    normalizeUserTokenLinks,
    parseStatusEffectLabel,
    recalculateAttackReport,
    resolveCombatEventOpenIds,
    totalDegreesOfSuccess,
    uniqueTokensByReference,
    withTemporarySetValues,
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
    processingDefenseMessages: new Set(),
    preparingSpellId: null,
    hoveredToken: null,
    spellTooltip: null,
    cardsCollapsed: false,
    hiddenByShortcut: false,
    eventExpansionRequest: null,
    startedAt: Date.now(),
};

Hooks.once("init", () => {
    registerSettings();
    registerSettingsMenu();
    registerKeybindings();
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
        default: true,
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
    game.settings.register(MODULE_ID, "actorUserLinks", {
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

function registerKeybindings() {
    game.keybindings.register(MODULE_ID, "toggleHud", {
        name: "SMOOTHER_FIGHT.Keybindings.ToggleHudName",
        hint: "SMOOTHER_FIGHT.Keybindings.ToggleHudHint",
        editable: [{ key: "KeyV" }],
        onDown: toggleHudMinimizedFromKeybinding,
        repeat: false,
    });
    game.keybindings.register(MODULE_ID, "toggleHudVisibility", {
        name: "SMOOTHER_FIGHT.Keybindings.ToggleHudVisibilityName",
        hint: "SMOOTHER_FIGHT.Keybindings.ToggleHudVisibilityHint",
        editable: isUnmodifiedKeyAvailable("KeyB") ? [{ key: "KeyB" }] : [],
        onDown: toggleHudVisibilityFromKeybinding,
        repeat: false,
    });
    game.keybindings.register(MODULE_ID, "collapseCombatActions", {
        name: "SMOOTHER_FIGHT.Keybindings.CollapseCombatActionsName",
        hint: "SMOOTHER_FIGHT.Keybindings.CollapseCombatActionsHint",
        editable: [{ key: "KeyX" }],
        onDown: () => requestCombatEventExpansion("collapse"),
        repeat: false,
    });
    game.keybindings.register(MODULE_ID, "openLatestCombatAction", {
        name: "SMOOTHER_FIGHT.Keybindings.OpenLatestCombatActionName",
        hint: "SMOOTHER_FIGHT.Keybindings.OpenLatestCombatActionHint",
        editable: [{ key: "KeyY" }, { key: "KeyZ" }],
        onDown: () => requestCombatEventExpansion("latest"),
        repeat: false,
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
            const actorLinks = normalizeActorUserLinks(getSetting("actorUserLinks", {}));
            const tokens = getSceneTokens().map((token) => ({
                uuid: token.uuid,
                actorUuid: actorAssignmentUuid(token.actor, token.actorId),
                actorId: token.actorId ?? token.actor?.id ?? null,
                label: `${token.name} — ${token.actor?.name ?? "–"}`,
            }));
            const allUsers = Array.from(game.users ?? []);
            const validUserIds = new Set(allUsers.map((user) => user.id));
            const orderedUserIds = allUsers
                .map((user) => user.id)
                .sort((leftId, rightId) => leftId === primaryGmId ? 1 : rightId === primaryGmId ? -1 : 0);
            const explicitOwnerByToken = new Map(tokens.map((token) => {
                const ownerId = orderedUserIds.find((userId) =>
                    (links[userId] ?? []).some((link) => link.tokenUuid === token.uuid)
                ) ?? orderedUserIds.find((userId) =>
                    (links[userId] ?? []).some((link) => !link.tokenUuid && settingsLinkMatchesToken(link, token))
                );
                return [token.uuid, ownerId ?? null];
            }));
            const users = allUsers.map((user) => {
                return {
                    id: user.id,
                    name: user.name,
                    active: user.active,
                    isGM: user.isGM,
                    tokens: tokens.map((token) => {
                        const explicitOwnerId = explicitOwnerByToken.get(token.uuid);
                        const actorOwnerId = validUserIds.has(actorLinks[token.actorUuid]) ? actorLinks[token.actorUuid] : null;
                        const inherited = !explicitOwnerId && actorOwnerId === user.id;
                        const automatic = !explicitOwnerId && !actorOwnerId && primaryGmId === user.id;
                        return {
                            ...token,
                            selected: explicitOwnerId === user.id || inherited || automatic,
                            inherited,
                            automatic,
                        };
                    }),
                };
            });
            const gms = allUsers.filter((user) => user.isGM).map((user) => ({
                id: user.id,
                name: user.name,
                selected: user.id === primaryGmId,
            }));
            const actors = Array.from(game.actors ?? [])
                .filter((actor) => ["character", "npc"].includes(actor.type))
                .sort(sortByName)
                .map((actor) => ({
                    uuid: actor.uuid,
                    name: actor.name,
                    img: actor.img ?? "icons/svg/mystery-man.svg",
                    type: actor.type,
                    typeLabel: actor.type === "npc"
                        ? t("SMOOTHER_FIGHT.Settings.NpcSheet")
                        : t("SMOOTHER_FIGHT.Settings.CharacterSheet"),
                    users: allUsers.map((user) => ({
                        id: user.id,
                        name: user.name,
                        isGM: user.isGM,
                        selected: actorLinks[actor.uuid] === user.id,
                    })),
                }));
            const actorGroups = [
                {
                    id: "character",
                    label: t("SMOOTHER_FIGHT.Settings.PlayerCharacters"),
                    icon: "fa-solid fa-user-shield",
                    open: true,
                    actors: actors.filter((actor) => actor.type === "character"),
                },
                {
                    id: "npc",
                    label: t("SMOOTHER_FIGHT.Settings.Npcs"),
                    icon: "fa-solid fa-dragon",
                    open: false,
                    actors: actors.filter((actor) => actor.type === "npc"),
                },
            ].map((group) => ({ ...group, count: group.actors.length }));
            return {
                ...context,
                users,
                gms,
                actorGroups,
                hasActors: actors.length > 0,
                hasTokens: tokens.length > 0,
            };
        }

        async _onRender(context, options) {
            await super._onRender(context, options);
            const primaryGmSelect = this.element.querySelector('[data-role="primary-gm"]');
            const actorAssignmentSelects = () => Array.from(this.element.querySelectorAll('select[data-actor-uuid]'));
            const assignmentInputs = () => Array.from(this.element.querySelectorAll('input[type="checkbox"][data-user-id][data-token-uuid]'));
            const actorSearchInput = this.element.querySelector('[data-role="actor-search"]');
            const actorGroups = Array.from(this.element.querySelectorAll('[data-actor-group]'));
            const noSearchResults = this.element.querySelector('[data-role="no-actor-search-results"]');
            const openBeforeSearch = new Map();
            let searchActive = false;
            const refreshActorSearch = () => {
                const query = normalizeSearchText(actorSearchInput?.value);
                if (query && !searchActive) {
                    for (const group of actorGroups) openBeforeSearch.set(group.dataset.actorGroup, group.open);
                }
                let totalMatches = 0;
                for (const group of actorGroups) {
                    const rows = Array.from(group.querySelectorAll('[data-actor-row]'));
                    let visibleCount = 0;
                    for (const row of rows) {
                        const visible = !query || normalizeSearchText(row.dataset.search).includes(query);
                        row.hidden = !visible;
                        if (visible) visibleCount += 1;
                    }
                    totalMatches += visibleCount;
                    const count = group.querySelector('[data-role="actor-group-count"]');
                    if (count) count.textContent = query ? `${visibleCount}/${rows.length}` : String(rows.length);
                    group.hidden = Boolean(query && visibleCount === 0);
                    if (query && visibleCount > 0) group.open = true;
                    if (!query && searchActive) group.open = openBeforeSearch.get(group.dataset.actorGroup) ?? group.open;
                }
                if (noSearchResults) noSearchResults.hidden = !query || totalMatches > 0;
                searchActive = Boolean(query);
                if (!query) openBeforeSearch.clear();
            };
            actorSearchInput?.addEventListener("input", refreshActorSearch);
            const refreshFallbackAssignments = () => {
                for (const input of assignmentInputs()) {
                    if (input.dataset.automatic !== "true" && input.dataset.inherited !== "true") continue;
                    input.checked = false;
                    delete input.dataset.automatic;
                    delete input.dataset.inherited;
                }
                const primaryGmId = primaryGmSelect?.value ?? "";
                const tokenUuids = new Set(assignmentInputs().map((input) => input.dataset.tokenUuid));
                for (const tokenUuid of tokenUuids) {
                    const inputs = assignmentInputs().filter((input) => input.dataset.tokenUuid === tokenUuid);
                    if (inputs.some((input) => input.checked)) continue;
                    const actorUuid = inputs[0]?.dataset.actorUuid ?? "";
                    const actorOwnerId = actorAssignmentSelects()
                        .find((select) => select.dataset.actorUuid === actorUuid)?.value ?? "";
                    const fallbackUserId = actorOwnerId || primaryGmId;
                    if (!fallbackUserId) continue;
                    const fallback = inputs.find((input) => input.dataset.userId === fallbackUserId);
                    if (!fallback) continue;
                    fallback.checked = true;
                    fallback.dataset[actorOwnerId ? "inherited" : "automatic"] = "true";
                }
            };
            for (const checkbox of assignmentInputs()) {
                checkbox.addEventListener("change", () => {
                    if (checkbox.checked) {
                        for (const other of assignmentInputs()) {
                            if (other !== checkbox && other.dataset.tokenUuid === checkbox.dataset.tokenUuid) other.checked = false;
                        }
                    }
                    refreshFallbackAssignments();
                });
            }
            for (const select of actorAssignmentSelects()) select.addEventListener("change", refreshFallbackAssignments);
            primaryGmSelect?.addEventListener("change", refreshFallbackAssignments);
            this.element.querySelector('[data-action="save-links"]')?.addEventListener("click", async () => {
                const links = {};
                for (const user of game.users ?? []) links[user.id] = [];
                const primaryGmId = primaryGmSelect?.value ?? "";
                const actorLinks = Object.fromEntries(actorAssignmentSelects()
                    .filter((select) => select.value)
                    .map((select) => [select.dataset.actorUuid, select.value]));
                const claimed = new Set();
                const checked = assignmentInputs()
                    .filter((checkbox) =>
                        checkbox.checked
                        && checkbox.dataset.automatic !== "true"
                        && checkbox.dataset.inherited !== "true"
                    )
                    .sort((left, right) => left.dataset.userId === primaryGmId ? 1 : right.dataset.userId === primaryGmId ? -1 : 0);
                for (const checkbox of checked) {
                    if (claimed.has(checkbox.dataset.tokenUuid)) continue;
                    const token = resolveToken(checkbox.value);
                    if (!token) continue;
                    claimed.add(checkbox.dataset.tokenUuid);
                    links[checkbox.dataset.userId] ??= [];
                    links[checkbox.dataset.userId].push({
                        tokenUuid: checkbox.value,
                        actorUuid: actorAssignmentUuid(token?.actor, token?.actorId),
                        actorId: token?.actorId ?? token?.actor?.id ?? null,
                        label: token?.name ?? checkbox.value,
                    });
                }
                await game.settings.set(MODULE_ID, "actorUserLinks", actorLinks);
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
        void onCreateChatMessage(message).finally(() => scheduleRender(0));
        scheduleRender();
    });
    Hooks.on("updateChatMessage", (message, changes) => {
        void onUpdateChatMessage(message, changes).finally(() => scheduleRender(0));
        scheduleRender();
    });
    Hooks.on("deleteChatMessage", scheduleRender);
    Hooks.on("diceSoNiceRollComplete", (messageId) => {
        if (game.messages?.get?.(messageId)) scheduleRender(0);
    });

    Hooks.on("renderChatMessageHTML", (message, html) => prepareRenderedChatMessage(message, html));
    Hooks.on("renderChatMessage", (message, html) => prepareRenderedChatMessage(message, asElement(html)));
    Hooks.on("renderTokenHUD", (app, html) => renderTokenOwnerControl(app, html));
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
            const offense = game.messages.get(pending?.attackMessageId);
            if (!pending || !offense || !isOffensiveCombatMessage(offense)) return;
            if (!sender.isGM && !canUserSubmitDefense(sender, pending, message)) return;

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
        this.element.addEventListener("contextmenu", (event) => this.onContextMenu(event));
    }

    async render() {
        if (!this.element) return;
        const generation = ++this.renderGeneration;
        const viewState = captureHudViewState(this.element);
        const context = getHudContext();
        const enabled = getSetting("enabled", true);
        if (!enabled || !context) {
            runtime.hiddenByShortcut = false;
            runtime.eventExpansionRequest = null;
        }
        const visible = Boolean(enabled && context && !runtime.hiddenByShortcut);
        const minimized = Boolean(visible && getSetting("minimized", false));
        this.element.classList.toggle("is-hidden", !visible);
        syncSystemActionBar(visible);
        syncMinimizedHudPosition(this.element, minimized);
        if (!visible) {
            delete this.element.dataset.activeCombatantId;
            delete this.element.dataset.activeActorId;
            clearHoveredToken();
            clearSpellTooltip();
            this.element.replaceChildren();
            return;
        }

        const html = await buildHud(context);
        if (generation !== this.renderGeneration) return;
        clearHoveredToken();
        clearSpellTooltip();
        this.element.innerHTML = html;
        this.element.dataset.activeCombatantId = context.combatant.id ?? "";
        this.element.dataset.activeActorId = context.actor.id ?? "";
        enforceChatPermissions(this.element, context);
        enforceFumbleActionState(this.element);
        bindQuickTargetHover(this.element);
        bindSpellTooltips(this.element, context);
        restoreHudViewState(this.element, viewState);
        applyCombatEventExpansionRequest(this.element);
    }

    onContextMenu(event) {
        const portrait = event.target.closest(".sf-portrait[data-sf-token-uuid]");
        if (portrait && this.element.contains(portrait)) {
            event.preventDefault();
            event.stopPropagation();
            showTokenOnCanvas(resolveToken(portrait.dataset.sfTokenUuid));
            return;
        }

        const target = event.target.closest("[data-spell-id], [data-attack-id], [data-item-id]");
        if (!target || !this.element.contains(target) || !target.closest(".sf-actions")) return;
        const context = getHudContext();
        const item = context ? resolveActionItem(context.actor, target) : null;
        if (!item?.sheet) return;
        event.preventDefault();
        event.stopPropagation();
        clearSpellTooltip();
        item.sheet.render({ force: true });
    }

    async onClick(event) {
        const target = event.target.closest("[data-sf-action], [data-sf-roll-toggle], .sf-chat-message .splittermond-chat-action, .sf-chat-message button, .sf-chat-message [role=button]");
        if (!target || !this.element.contains(target)) return;
        if (target.getAttribute("aria-disabled") === "true") {
            event.preventDefault();
            return;
        }

        if (Object.hasOwn(target.dataset, "sfRollToggle")) {
            event.preventDefault();
            const roll = target.closest(".sf-collapsible-roll");
            const breakdown = roll?.querySelector(":scope > .sf-roll-breakdown");
            if (!roll || !breakdown) return;
            const expanded = !roll.classList.contains("is-details-open");
            roll.classList.toggle("is-details-open", expanded);
            breakdown.hidden = !expanded;
            target.setAttribute("aria-expanded", String(expanded));
            target.querySelector("i")?.classList.toggle("fa-chevron-up", expanded);
            target.querySelector("i")?.classList.toggle("fa-chevron-down", !expanded);
            return;
        }

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
                case "defend-other":
                    await beginDefenderDefense(game.messages.get(target.dataset.messageId));
                    break;
                case "defend-target":
                    await beginAdditionalTargetDefense(game.messages.get(target.dataset.messageId));
                    break;
                case "toggle-equipped":
                    await requireOwner(context, () => toggleEquipped(context.actor, target.dataset.itemId));
                    break;
                case "set-target":
                    await setTargetFromQuickMenu(context, target.dataset.tokenUuid);
                    break;
                case "toggle-cards":
                    runtime.eventExpansionRequest = null;
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
    const personalTarget = isCurrentUserTarget(target);

    if (minimized) {
        return `
            <div class="sf-shell is-minimized">
                <main class="sf-center">
                    <header class="sf-turnline">
                        <span class="sf-live-dot"></span>
                        <strong>${escapeHtml(actor.name)}</strong>
                        <span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.CurrentTick", { tick }))}</span>
                        <span class="sf-turn-target ${personalTarget ? "is-user-target" : ""}"><i class="fa-solid fa-crosshairs"></i> ${escapeHtml(targetLine)}</span>
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
                    <span class="sf-turn-target ${personalTarget ? "is-user-target" : ""}"><i class="fa-solid fa-crosshairs"></i> ${escapeHtml(targetLine)}</span>
                    ${hudToggle}
                </header>
                ${canAct ? buildCombatControls(context) : ""}
                ${canAct ? await buildActionBar(context) : `<p class="sf-owner-note"><i class="fa-solid fa-lock"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoOwner"))}</p>`}
                ${getSetting("showCards", true) ? buildCombatEvents(context) : ""}
            </main>
            <div class="sf-target-column">
                ${canChooseTarget(context) ? buildQuickTargets(context) : ""}
                ${target ? portraitPanel({ side: "target", token: target, actor: target.actor, eyebrow: t("SMOOTHER_FIGHT.HUD.Target"), highlighted: personalTarget }) : noTargetPanel()}
            </div>
        </div>
    `;
}

function buildHudToggle(minimized) {
    const label = t(minimized ? "SMOOTHER_FIGHT.HUD.ExpandHud" : "SMOOTHER_FIGHT.HUD.MinimizeHud");
    const icon = minimized ? "fa-window-maximize" : "fa-window-minimize";
    return `<button type="button" class="sf-hud-toggle" data-sf-action="toggle-hud" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"><i class="fa-solid ${icon}"></i></button>`;
}

function portraitPanel({ side, token, actor, eyebrow, action = "", highlighted = false }) {
    const image = token?.texture?.src ?? actor?.img ?? "icons/svg/mystery-man.svg";
    const clickable = action ? `data-sf-action="${action}" role="button" tabindex="0"` : "";
    const tokenReference = token?.uuid ? `data-sf-token-uuid="${escapeAttr(token.uuid)}"` : "";
    const defense = getDerivedValue(actor, "defense");
    const body = getDerivedValue(actor, "bodyresist");
    const mind = getDerivedValue(actor, "mindresist");
    return `
        <aside class="sf-portrait sf-${side} ${highlighted ? "sf-is-user-target" : ""}" ${clickable} ${tokenReference}>
            <div class="sf-portrait-image" style="--sf-token-image:url('${escapeCssUrl(image)}')">
                <span class="sf-eyebrow">${escapeHtml(eyebrow)}</span>
                ${highlighted ? `<span class="sf-target-alert"><i class="fa-solid fa-bullseye"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.YouAreTarget"))}</span></span>` : ""}
            </div>
            <div class="sf-portrait-name">${escapeHtml(token?.name ?? actor?.name ?? "–")}</div>
            <div class="sf-defense-row" aria-label="VTD, KW, GW">
                <span><small>VTD</small>${escapeHtml(defense)}</span>
                <span><small>KW</small>${escapeHtml(body)}</span>
                <span><small>GW</small>${escapeHtml(mind)}</span>
            </div>
            ${canViewResources(actor) ? resourceBars(actor) : ""}
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

function canViewResources(actor) {
    const observer = Boolean(actor?.testUserPermission?.(game.user, "OBSERVER"));
    return mayViewActorResources(game.user?.isGM, observer);
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
    const tickButtons = [1, 2, 3, 5, 10].map((ticks) => `
        <button type="button" data-sf-action="add-ticks" data-ticks="${ticks}" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.AddTicks", { ticks }))}">+${ticks} T</button>
    `).join("");
    const pauseButtons = paused
        ? `<button type="button" data-sf-action="resume-combatant" class="is-resume" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.Resume"))}"><i class="fa-solid fa-play-circle"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Resume"))}</span></button>`
        : `<button type="button" data-sf-action="pause-combatant" data-pause-type="wait" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.Wait"))}"><i class="fa-solid fa-hourglass-half"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Wait"))}</span></button>
           <button type="button" data-sf-action="pause-combatant" data-pause-type="keepReady" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.KeepReady"))}"><i class="fa-solid fa-hand"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.KeepReady"))}</span></button>`;
    const gmControls = game.user.isGM ? `
        <button type="button" data-sf-action="toggle-combatant-hidden" class="sf-icon-button ${context.combatant.hidden ? "is-active" : ""}" title="${escapeAttr(t(context.combatant.hidden ? "SMOOTHER_FIGHT.HUD.ShowCombatant" : "SMOOTHER_FIGHT.HUD.HideCombatant"))}"><i class="fa-solid ${context.combatant.hidden ? "fa-eye" : "fa-eye-slash"}"></i></button>
        <button type="button" data-sf-action="toggle-combatant-defeated" class="sf-icon-button ${context.combatant.isDefeated ? "is-active" : ""}" title="${escapeAttr(t(context.combatant.isDefeated ? "SMOOTHER_FIGHT.HUD.RestoreCombatant" : "SMOOTHER_FIGHT.HUD.MarkDefeated"))}"><i class="fa-solid fa-skull"></i></button>
        <button type="button" data-sf-action="remove-combatant" class="sf-icon-button is-danger" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.RemoveCombatant"))}"><i class="fa-solid fa-circle-minus"></i></button>
    ` : "";

    return `<section class="sf-combat-controls" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.HUD.CombatControls"))}">
        <div class="sf-tick-buttons"><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Advance"))}</span>${tickButtons}<button type="button" data-sf-action="add-ticks" data-ticks="custom" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.CustomTicks"))}">+X</button></div>
        <div class="sf-pause-buttons">${pauseButtons}</div>
        <div class="sf-tracker-buttons">
            <button type="button" data-sf-action="focus-combatant" class="sf-icon-button" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.FocusCombatant"))}"><i class="fa-solid fa-bullseye"></i></button>
            ${gmControls}
        </div>
    </section>`;
}

async function buildActionBar(context) {
    const actor = context.actor;
    const preparedSpellId = actor.getFlag?.("splittermond", "preparedSpell");
    const skills = Object.values(actor.skills ?? {})
        .filter((skill) => numericValue(skill.points) > 0 || ["acrobatics", "athletics", "determination", "stealth", "perception", "endurance"].includes(skill.id))
        .sort((a, b) => displayLabel(a.label).localeCompare(displayLabel(b.label), game.i18n.lang));
    const spells = [...(actor.spells ?? [])].sort((a, b) =>
        Number(b.id === preparedSpellId) - Number(a.id === preparedSpellId) || sortByName(a, b)
    );
    const preparedSpell = spells.find((spell) => spell.id === preparedSpellId) ?? null;
    const attacks = [...(actor.attacks ?? [])].sort(sortByName);
    const attackSpeeds = new Map(await Promise.all(attacks.map(async (attack) => [attack.id, await getAttackSpeed(attack)])));
    const equipment = Array.from(actor.items ?? []).filter((item) => ["weapon", "shield"].includes(item.type)).sort(sortByName);

    return `<nav class="sf-actions" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.Title"))}">
        ${actionMenu("fa-solid fa-dice-d20", t("SMOOTHER_FIGHT.HUD.Skills"), skills.map((skill) => `
            <button type="button" data-sf-action="skill" data-skill-id="${escapeAttr(skill.id)}">
                <span>${escapeHtml(displayLabel(skill.label, skill.id))}</span><b>${escapeHtml(displayValue(skill.value))}</b>
            </button>`).join(""))}
        ${preparedSpell ? preparedSpellMenu(preparedSpell) : actionMenu("fa-solid fa-wand-sparkles", t("SMOOTHER_FIGHT.HUD.Spells"), spells.map((spell) => {
            const preparing = runtime.preparingSpellId === spell.id;
            const skillLabel = displayLabel(spell.skill?.label);
            const skillValue = displayValue(spell.skill?.value, "");
            const skill = [skillLabel, skillValue].filter((value) => value !== "").join(" ");
            const focus = t("SMOOTHER_FIGHT.HUD.FocusCosts", { costs: spellFocusCosts(spell) });
            const status = preparing
                ? t("SMOOTHER_FIGHT.HUD.Preparing")
                : displayValue(spell.castDuration, "–");
            return `<button type="button" data-sf-action="spell" data-spell-id="${escapeAttr(spell.id)}" class="sf-spell-action ${preparing ? "is-preparing" : ""}" ${spell.enoughFocus === false || preparing ? 'aria-disabled="true"' : ""}>
                <img src="${escapeAttr(spell.img)}" alt=""><span>${escapeHtml(spell.name)}<small>${escapeHtml([skill, focus].filter(Boolean).join(" · "))}</small></span>
                <b>${escapeHtml(status)}</b>
            </button>`;
        }).join("") || emptyMenuText())}
        ${actionMenu("fa-solid fa-hand-fist", t("SMOOTHER_FIGHT.HUD.Attacks"), `
            ${attacks.map((attack) => `<button type="button" data-sf-action="attack" data-attack-id="${escapeAttr(attack.id)}" class="${attack.isPrepared ? "is-prepared" : ""}" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.OpenItemHint"))}">
                <img src="${escapeAttr(attack.img)}" alt=""><span>${escapeHtml(attack.name)}<small>${escapeHtml([displayLabel(attack.skill?.label), displayValue(attack.skill?.value, "")].filter((value) => value !== "").join(" "))}</small></span>
                <b>${escapeHtml(attack.isPrepared ? (displayValue(attack.damage, "–")) : `${attackSpeeds.get(attack.id) ?? "–"} T`)}</b>
            </button>`).join("") || emptyMenuText()}
            ${equipment.length ? `<h4>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Equip"))}</h4>${equipment.map((item) => `<button type="button" data-sf-action="toggle-equipped" data-item-id="${escapeAttr(item.id)}" class="${item.system?.equipped ? "is-equipped" : "is-unequipped"}" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.OpenItemHint"))}">
                <img src="${escapeAttr(item.img)}" alt=""><span>${escapeHtml(item.name)}</span><i class="fa-solid ${item.system?.equipped ? "fa-toggle-on" : "fa-toggle-off"}"></i>
            </button>`).join("")}` : ""}
        `)}
        ${actionMenu("fa-solid fa-shield-halved", t("SMOOTHER_FIGHT.HUD.Defense"), [
            defenseButton(actor, "defense", "VTD"),
            defenseButton(actor, "bodyresist", "KW"),
            defenseButton(actor, "mindresist", "GW"),
        ].join(""), isCurrentUserTarget(context.target) ? "is-defense-alert" : "")}
        <div class="sf-defense-pills" aria-hidden="true">
            <span>VTD <b>${escapeHtml(getDerivedValue(actor, "defense"))}</b></span>
            <span>KW <b>${escapeHtml(getDerivedValue(actor, "bodyresist"))}</b></span>
            <span>GW <b>${escapeHtml(getDerivedValue(actor, "mindresist"))}</b></span>
        </div>
    </nav>`;
}

function actionMenu(icon, label, body, className = "") {
    return `<details class="sf-action-menu ${escapeAttr(className)}">
        <summary><i class="${icon}"></i><span>${escapeHtml(label)}</span><i class="fa-solid fa-chevron-up sf-chevron"></i></summary>
        <div class="sf-action-popover">${body}</div>
    </details>`;
}

function preparedSpellMenu(spell) {
    const cast = t("SMOOTHER_FIGHT.HUD.Cast");
    const cancel = t("SMOOTHER_FIGHT.HUD.CancelSpell");
    return `<div class="sf-action-menu sf-prepared-spell-menu">
        <button type="button" class="sf-prepared-spell-cast sf-spell-action" data-sf-action="cast-prepared-spell" data-spell-id="${escapeAttr(spell.id)}" aria-label="${escapeAttr(`${spell.name}: ${cast}`)}">
            <img src="${escapeAttr(spell.img ?? "icons/svg/daze.svg")}" alt="">
            <span><small>${escapeHtml(t("SMOOTHER_FIGHT.HUD.PreparedSpell"))}</small><strong>${escapeHtml(spell.name)}</strong></span>
            <b><i class="fa-solid fa-wand-sparkles"></i><span>${escapeHtml(cast)}</span></b>
        </button>
        <button type="button" class="sf-prepared-spell-cancel" data-sf-action="cancel-prepared-spell" title="${escapeAttr(cancel)}" aria-label="${escapeAttr(cancel)}"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
}

function spellFocusCosts(spell) {
    return displayLabel(spell?.costs ?? spell?.system?.costs, "–");
}

function resolveActionItem(actor, element) {
    const spellId = element?.dataset?.spellId;
    if (spellId) {
        return actor?.spells?.find((spell) => spell.id === spellId)
            ?? actor?.items?.get?.(spellId)
            ?? null;
    }

    const attackId = element?.dataset?.attackId;
    if (attackId) {
        const attack = actor?.attacks?.find((candidate) => candidate.id === attackId);
        return attack?.item ?? actor?.items?.get?.(attackId) ?? null;
    }

    const itemId = element?.dataset?.itemId;
    return itemId ? actor?.items?.get?.(itemId) ?? null : null;
}

function bindSpellTooltips(root, context) {
    for (const button of root.querySelectorAll("[data-spell-id]")) {
        const spell = resolveActionItem(context.actor, button);
        if (!spell) continue;
        button.addEventListener("mouseenter", () => showSpellTooltip(button, spell));
        button.addEventListener("mouseleave", () => clearSpellTooltip(button));
        button.addEventListener("focus", () => showSpellTooltip(button, spell));
        button.addEventListener("blur", () => clearSpellTooltip(button));
    }
}

function showSpellTooltip(anchor, spell) {
    if (runtime.spellTooltip?.anchor === anchor) return;
    clearSpellTooltip();

    const description = itemPlainText(spell.description ?? spell.system?.description);
    const enhancement = itemPlainText(spell.enhancementDescription ?? spell.system?.enhancementDescription);
    const enhancementCosts = displayLabel(spell.enhancementCosts ?? spell.system?.enhancementCosts, "–");
    const tooltip = document.createElement("aside");
    tooltip.id = `${MODULE_ID}-spell-tooltip`;
    tooltip.className = "sf-spell-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.innerHTML = `
        <header>
            <img src="${escapeAttr(spell.img ?? "icons/svg/book.svg")}" alt="">
            <span><strong>${escapeHtml(spell.name)}</strong><small>${escapeHtml(t("SMOOTHER_FIGHT.HUD.FocusCosts", { costs: spellFocusCosts(spell) }))}</small></span>
        </header>
        <section>
            <h4>${escapeHtml(t("SMOOTHER_FIGHT.HUD.SpellDescription"))}</h4>
            <p>${escapeHtml(description || t("SMOOTHER_FIGHT.HUD.NoSpellDescription"))}</p>
        </section>
        <section>
            <h4>${escapeHtml(t("SMOOTHER_FIGHT.HUD.SpellEnhancement"))}<span>${escapeHtml(enhancementCosts)}</span></h4>
            <p>${escapeHtml(enhancement || t("SMOOTHER_FIGHT.HUD.NoSpellEnhancement"))}</p>
        </section>
        <footer><i class="fa-solid fa-arrow-pointer"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.OpenItemHint"))}</footer>
    `;
    document.body.append(tooltip);
    anchor.setAttribute("aria-describedby", tooltip.id);
    runtime.spellTooltip = { anchor, element: tooltip };

    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const gap = 10;
    const viewportGap = 8;
    let left = anchorRect.right + gap;
    if (left + tooltipRect.width > window.innerWidth - viewportGap) {
        left = anchorRect.left - tooltipRect.width - gap;
    }
    left = Math.max(viewportGap, Math.min(left, window.innerWidth - tooltipRect.width - viewportGap));
    const top = Math.max(
        viewportGap,
        Math.min(anchorRect.top, window.innerHeight - tooltipRect.height - viewportGap),
    );
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
    tooltip.classList.add("is-visible");
}

function clearSpellTooltip(anchor = null) {
    const state = runtime.spellTooltip;
    if (!state || (anchor && state.anchor !== anchor)) return;
    runtime.spellTooltip = null;
    state.anchor?.removeAttribute?.("aria-describedby");
    state.element?.remove?.();
}

function itemPlainText(value) {
    const source = String(value ?? "").trim();
    if (!source) return "";
    const template = document.createElement("template");
    template.innerHTML = source
        .replace(/<br\s*\/?\s*>/giu, "\n")
        .replace(/<\/(?:p|div|li|h[1-6])>/giu, "\n");
    return String(template.content.textContent ?? "")
        .replace(/\u00a0/gu, " ")
        .replace(/[ \t]+\n/gu, "\n")
        .replace(/\n[ \t]+/gu, "\n")
        .replace(/\n{3,}/gu, "\n\n")
        .replace(/[ \t]{2,}/gu, " ")
        .trim();
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
        : groups.map((group, index) => buildEventGroup(group, index === groups.length - 1, context)).join("");
    return `<section class="sf-events ${runtime.cardsCollapsed ? "is-collapsed" : ""}">
        <button type="button" class="sf-events-heading" data-sf-action="toggle-cards" title="${escapeAttr(title)}">
            <span><i class="fa-solid fa-message"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.CombatEvents"))}</span>
            <i class="fa-solid fa-chevron-${runtime.cardsCollapsed ? "up" : "down"}"></i>
        </button>
        <div class="sf-event-scroller">${body}</div>
    </section>`;
}

function buildEventGroup(group, isLatest, hudContext) {
    const primary = group.primary;
    const context = getMessageContext(primary);
    const recalculated = context?.recalculatedFrom;
    const superseded = context?.supersededBy;
    const defenseAlert = shouldHighlightActiveDefense(group, isLatest, hudContext, context);
    const badge = group.kind === "spell"
        ? `<span class="sf-event-badge is-spell"><i class="fa-solid fa-wand-sparkles"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Spells"))}</span>`
        : recalculated
        ? `<span class="sf-event-badge is-defense"><i class="fa-solid fa-shield-halved"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenseResult"))}</span>`
        : superseded
            ? `<span class="sf-event-badge is-muted">${escapeHtml(t("SMOOTHER_FIGHT.HUD.OriginalAttack"))}</span>`
            : "";
    const defenseBadge = defenseAlert
        ? `<span class="sf-event-badge is-defense-alert"><i class="fa-solid fa-shield-halved"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenseAvailable"))}</span>`
        : "";
    const targetBadge = buildEventTargetBadge(context);
    const belongsToActiveCombatant = messageBelongsToCombatant(primary, hudContext.combatant, context);
    const open = isLatest && belongsToActiveCombatant && !runtime.cardsCollapsed ? "open" : "";
    const hasDamage = group.damages.length > 0;
    return `<details class="sf-event-group ${defenseAlert ? "is-defense-alert" : ""}" data-event-id="${escapeAttr(primary.id)}" data-event-combatant-id="${escapeAttr(context?.combatantId ?? "")}" data-event-actor-id="${escapeAttr(primary.speaker?.actor ?? "")}" ${open}>
        <summary><span>${escapeHtml(primary.speaker?.alias ?? primary.author?.name ?? t(group.kind === "spell" ? "SMOOTHER_FIGHT.HUD.Spells" : "SMOOTHER_FIGHT.HUD.Attacks"))}</span>${badge}${defenseBadge}${targetBadge}<i class="fa-solid fa-chevron-down"></i></summary>
        <div class="sf-event-body">
            ${group.defenses.map((message, index) => buildAssociatedEvent(message, {
                kind: "defense",
                icon: "fa-shield",
                label: t("SMOOTHER_FIGHT.HUD.DefenseResult"),
                open: !hasDamage && index === group.defenses.length - 1,
            })).join("")}
            ${chatMessageHtml(primary)}
            ${group.damages.map((message, index) => buildAssociatedEvent(message, {
                kind: "damage",
                icon: "fa-droplet",
                label: t("SMOOTHER_FIGHT.HUD.Damage"),
                open: index === group.damages.length - 1,
            })).join("")}
            ${group.fumbles.map((message, index) => buildAssociatedEvent(message, {
                kind: "fumble",
                icon: "fa-burst",
                label: t("SMOOTHER_FIGHT.HUD.MagicFumble"),
                open: index === group.fumbles.length - 1,
            })).join("")}
        </div>
    </details>`;
}

function buildAssociatedEvent(message, { kind, icon, label, open = false }) {
    return `<details class="sf-associated-card is-${escapeAttr(kind)}" data-subevent-id="${escapeAttr(message.id)}" data-subevent-kind="${escapeAttr(kind)}" ${open ? "open" : ""}>
        <summary><span><i class="fa-solid ${escapeAttr(icon)}"></i>${escapeHtml(label)}</span><i class="fa-solid fa-chevron-down"></i></summary>
        <div class="sf-associated-body">${chatMessageHtml(message)}</div>
    </details>`;
}

function buildEventTargetBadge(context) {
    const targetName = getMessageTargetName(context);
    if (!targetName) return "";
    const label = t("SMOOTHER_FIGHT.HUD.EventTarget", { target: targetName });
    return `<span class="sf-event-target" title="${escapeAttr(label)}"><i class="fa-solid fa-crosshairs"></i>${escapeHtml(label)}</span>`;
}

function getMessageTargetName(context) {
    const target = resolveMessageTarget(context);
    return context?.targetName ?? target?.token?.name ?? target?.actor?.name ?? "";
}

function shouldHighlightActiveDefense(group, isLatest, hudContext, messageContext) {
    if (game.user?.isGM || !messageOffersActiveDefense(group.primary)) return false;
    if (messageContext?.recalculatedFrom || messageContext?.supersededBy || group.defenses.length) return false;
    const storedTarget = resolveToken(messageContext?.targetTokenUuid);
    if (storedTarget) return isCurrentUserTarget(storedTarget);
    return Boolean(isLatest && isCurrentUserTarget(hudContext?.target));
}

function messageOffersActiveDefense(message) {
    return /data-local-?action\s*=\s*["']activeDefense["']/iu.test(String(message?.content ?? ""));
}

function captureHudViewState(root) {
    const scroller = root?.querySelector?.(".sf-event-scroller");
    if (!scroller) return null;
    const groups = Array.from(scroller.querySelectorAll(".sf-event-group[data-event-id]"));
    const subevents = Array.from(scroller.querySelectorAll(".sf-associated-card[data-subevent-id]"));
    return {
        scrollTop: scroller.scrollTop,
        activeCombatantId: root.dataset.activeCombatantId || null,
        activeActorId: root.dataset.activeActorId || null,
        eventIds: new Set(groups.map((group) => group.dataset.eventId)),
        openEventIds: new Set(groups.filter((group) => group.open).map((group) => group.dataset.eventId)),
        subeventIds: new Set(subevents.map((subevent) => subevent.dataset.subeventId)),
        openSubeventIds: new Set(subevents.filter((subevent) => subevent.open).map((subevent) => subevent.dataset.subeventId)),
    };
}

function restoreHudViewState(root, state) {
    if (!state) return;
    const scroller = root?.querySelector?.(".sf-event-scroller");
    if (!scroller) return;

    const groups = Array.from(scroller.querySelectorAll(".sf-event-group[data-event-id]"));
    const currentEventIds = groups.map((group) => group.dataset.eventId);
    const eventCombatantIds = new Map(groups.map((group) => [group.dataset.eventId, group.dataset.eventCombatantId || null]));
    const eventActorIds = new Map(groups.map((group) => [group.dataset.eventId, group.dataset.eventActorId || null]));
    const openEventIds = resolveCombatEventOpenIds(state.eventIds, state.openEventIds, currentEventIds, {
        previousCombatantId: state.activeCombatantId,
        currentCombatantId: root.dataset.activeCombatantId || null,
        previousActorId: state.activeActorId,
        currentActorId: root.dataset.activeActorId || null,
        eventCombatantIds,
        eventActorIds,
    });
    groups.forEach((group) => {
        group.open = openEventIds.has(group.dataset.eventId);
    });
    let newestDamage = null;
    for (const group of groups) {
        const subevents = Array.from(group.querySelectorAll(":scope > .sf-event-body > .sf-associated-card[data-subevent-id]"));
        const newDamages = subevents.filter((subevent) =>
            subevent.dataset.subeventKind === "damage" && !state.subeventIds?.has(subevent.dataset.subeventId)
        );
        if (newDamages.length) {
            newestDamage = newDamages.at(-1);
            subevents.forEach((subevent) => {
                if (subevent.dataset.subeventKind === "defense" || subevent.dataset.subeventKind === "damage") {
                    subevent.open = subevent === newestDamage;
                }
            });
            continue;
        }
        subevents.forEach((subevent) => {
            if (!state.subeventIds?.has(subevent.dataset.subeventId)) return;
            subevent.open = state.openSubeventIds?.has(subevent.dataset.subeventId);
        });
    }
    if (!currentEventIds.some((eventId) => state.eventIds.has(eventId))) return;

    const restoreScroll = () => {
        if (!scroller.isConnected) return;
        const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const scrollerRect = scroller.getBoundingClientRect();
        const damageRect = newestDamage?.getBoundingClientRect();
        const damageBottom = damageRect
            ? scroller.scrollTop + damageRect.bottom - scrollerRect.top - scroller.clientHeight
            : 0;
        scroller.scrollTop = Math.min(Math.max(state.scrollTop, damageBottom), maximum);
    };
    restoreScroll();
    requestAnimationFrame(restoreScroll);
}

function applyCombatEventExpansionRequest(root) {
    const request = runtime.eventExpansionRequest;
    if (!request) return;
    const scroller = root?.querySelector?.(".sf-event-scroller");
    if (!scroller) return;

    runtime.eventExpansionRequest = null;
    const groups = Array.from(scroller.querySelectorAll(".sf-event-group[data-event-id]"));
    groups.forEach((group) => {
        group.open = false;
    });
    if (request !== "latest") return;

    const latest = groups.at(-1);
    if (!latest) return;
    latest.open = true;
    requestAnimationFrame(() => {
        if (!latest.isConnected || !scroller.isConnected) return;
        const top = Math.max(0, latest.offsetTop - scroller.offsetTop);
        const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTop = Math.min(top, maximum);
    });
}

function messageBelongsToCombatant(message, combatant, messageContext = getMessageContext(message)) {
    if (!message || !combatant) return false;
    if (messageContext?.combatantId) return messageContext.combatantId === combatant.id;
    if (message.speaker?.token && combatant.tokenId) return message.speaker.token === combatant.tokenId;
    return Boolean(message.speaker?.actor && message.speaker.actor === combatant.actorId);
}

function chatMessageHtml(message) {
    let content = message.content ?? "";
    if (isMagicFumbleMessage(message)) {
        const fumble = getFumbleData(message) ?? createMagicFumbleData(message, content);
        if (fumble) content = decorateMagicFumbleCard(content, fumble);
    }
    content = promoteChatCardActions(content, message);
    content = scopeChatCardIds(content, message.id);
    return `<article class="sf-chat-message message" data-message-id="${escapeAttr(message.id)}"><div class="message-content">${content}</div></article>`;
}

function promoteChatCardActions(content, message) {
    const template = document.createElement("template");
    template.innerHTML = content ?? "";
    arrangeCheckResults(template.content, message);
    for (const actions of template.content.querySelectorAll(".splittermond.check > .actions, .actions.splittermond-chat-action-container")) {
        const precedingOptions = actions.previousElementSibling;
        const degreeOptions = precedingOptions?.matches(".splittermond-chat-action-container.chat-card-segment")
            && precedingOptions.querySelector(".splittermond-chat-action")
            ? precedingOptions
            : null;
        const promotedControls = document.createElement("div");
        promotedControls.className = "sf-promoted-controls";
        actions.classList.add("sf-promoted-actions");
        const card = actions.parentElement;
        const header = card?.querySelector(":scope > .chat-message-header");
        if (header) header.after(promotedControls);
        else card?.prepend(promotedControls);
        promotedControls.append(actions);
        if (degreeOptions) {
            degreeOptions.classList.add("sf-promoted-degree-options");
            promotedControls.append(degreeOptions);
        }
    }
    const wrapper = document.createElement("div");
    wrapper.append(template.content.cloneNode(true));
    return wrapper.innerHTML;
}

function arrangeCheckResults(root, message) {
    arrangeDamageResult(root, message);
    const recalculated = root.querySelector(".sf-chat-recalculated");
    const defenseMessage = isDefenseMessage(message);
    for (const card of root.querySelectorAll(".splittermond.check")) {
        const roll = card.querySelector(":scope > .roll-summary");
        const degrees = card.querySelector(":scope > .degree-of-success");
        if (!roll || !degrees || roll.closest(".sf-check-result-grid")) continue;
        if (card.matches(".attack, .spell")) {
            card.classList.add("sf-offense-check");
            addOffenseTarget(card, message);
            makeRollCollapsible(roll);
        } else if (defenseMessage) {
            card.classList.add("sf-defense-check");
            makeRollCollapsible(roll);
        }
        const summary = document.createElement("div");
        summary.className = "sf-check-result-grid";
        roll.dataset.sfLabel = t("SMOOTHER_FIGHT.HUD.RollResult");
        degrees.dataset.sfLabel = t("SMOOTHER_FIGHT.HUD.DegreesOfSuccess");
        roll.before(summary);
        summary.append(roll, degrees);
        if (defenseMessage) {
            const defenseValue = card.querySelector(":scope > .degree-of-success-description");
            if (defenseValue) {
                decorateDefenseValue(defenseValue);
                degrees.append(defenseValue);
            }
        }
        if (recalculated && card.matches(".attack, .spell")) degrees.append(recalculated);
    }
}

function arrangeDamageResult(root, message) {
    if (!isDamageMessage(message)) return;
    for (const card of root.querySelectorAll(".splittermond.damage")) {
        const roll = card.querySelector(":scope > .roll-summary");
        if (!roll) continue;
        card.classList.add("sf-damage-check");
        roll.dataset.sfLabel = t("SMOOTHER_FIGHT.HUD.DamageRoll");
        makeRollCollapsible(roll);
    }
}

function addOffenseTarget(card, message) {
    if (card.querySelector(":scope > .sf-offense-target")) return;
    const header = card.querySelector(":scope > .chat-message-header");
    const targetName = getMessageTargetName(getMessageContext(message));
    if (!header || !targetName) return;

    const label = t("SMOOTHER_FIGHT.HUD.EventTarget", { target: targetName });
    const target = document.createElement("div");
    target.className = "sf-offense-target";
    target.title = label;
    target.setAttribute("aria-label", label);
    target.innerHTML = `<i class="fa-solid fa-crosshairs"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Target"))}</span><strong>${escapeHtml(targetName)}</strong>`;
    header.after(target);
}

function makeRollCollapsible(roll) {
    const total = roll.querySelector(":scope > .roll-total");
    if (!total || roll.querySelector(":scope > .sf-roll-breakdown")) return;
    const detailNodes = Array.from(roll.childNodes).filter((node) =>
        node !== total && (node.nodeType === Node.ELEMENT_NODE || String(node.textContent ?? "").trim())
    );
    if (!detailNodes.length) return;

    const breakdown = document.createElement("div");
    breakdown.className = "sf-roll-breakdown";
    breakdown.hidden = true;
    detailNodes.forEach((node) => breakdown.append(node));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "sf-roll-toggle";
    toggle.dataset.sfRollToggle = "";
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = `<span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.RollDetails"))}</span><i class="fa-solid fa-chevron-down"></i>`;

    roll.classList.remove("expanded", "sf-expanded-roll-result");
    roll.classList.add("sf-collapsible-roll");
    roll.append(toggle, breakdown);
}

function decorateDefenseValue(element) {
    element.classList.add("sf-defense-value");
    const match = String(element.textContent ?? "").trim().match(/^(.+?)\s*:\s*(-?\d+)$/u);
    if (!match) return;
    const label = document.createElement("span");
    label.textContent = match[1].trim();
    const value = document.createElement("strong");
    value.textContent = match[2];
    element.replaceChildren(label, value);
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
    const candidates = getTargetSceneTokens(context.combat).filter((token) => token.uuid !== context.token?.uuid);
    const labels = quickTargetLabels(candidates);
    const body = candidates.length
        ? candidates.map((token) => `<button type="button" data-sf-action="set-target" data-token-uuid="${escapeAttr(token.uuid)}" class="${context.target?.uuid === token.uuid ? "is-current" : ""}">
            <img src="${escapeAttr(token.texture?.src ?? token.actor?.img ?? "icons/svg/mystery-man.svg")}" alt=""><span>${escapeHtml(labels.get(token.uuid) ?? token.name)}</span>
            ${context.target?.uuid === token.uuid ? '<i class="fa-solid fa-crosshairs"></i>' : ""}
        </button>`).join("")
        : `<p>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoCombatants"))}</p>`;
    const label = t("SMOOTHER_FIGHT.HUD.QuickTarget");
    return `<details class="sf-quick-targets">
        <summary title="${escapeAttr(label)}"><i class="fa-solid fa-crosshairs"></i><span>${escapeHtml(label)}</span><i class="fa-solid fa-chevron-up"></i></summary>
        <div>${body}</div>
    </details>`;
}

function quickTargetLabels(tokens) {
    const names = new Map(tokens.map((token) => [token.uuid, String(token.name ?? token.actor?.name ?? "–")]));
    const totals = new Map();
    for (const name of names.values()) totals.set(name, (totals.get(name) ?? 0) + 1);
    const occurrences = new Map();
    return new Map(tokens.map((token) => {
        const name = names.get(token.uuid);
        const total = totals.get(name) ?? 1;
        const occurrence = (occurrences.get(name) ?? 0) + 1;
        occurrences.set(name, occurrence);
        return [token.uuid, total > 1 ? `${name} · ${occurrence}/${total}` : name];
    }));
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
    const combatantTokenUuid = combatant.token?.uuid ?? combatant.tokenUuid ?? null;
    const exact = assignments.find(([, userLinks]) =>
        userLinks.some((link) => link.tokenUuid && link.tokenUuid === combatantTokenUuid)
    ) ?? assignments.find(([, userLinks]) =>
        userLinks.some((link) => !link.tokenUuid && linkMatchesCombatant(link, combatant))
    );
    const explicitlyLinkedUser = exact ? game.users.get(exact[0]) : null;
    if (explicitlyLinkedUser) return explicitlyLinkedUser;

    const actorLinks = normalizeActorUserLinks(getSetting("actorUserLinks", {}));
    const actorLinkedUser = game.users.get(actorLinks[actorAssignmentUuid(actor, combatant.actorId)]);
    if (actorLinkedUser) return actorLinkedUser;

    const primaryGm = game.users.get(primaryGmId);
    if (primaryGm?.isGM) return primaryGm;

    const users = Array.from(game.users ?? []);
    const owners = users.filter((user) => !user.isGM && actor.testUserPermission?.(user, "OWNER"));
    return owners.find((user) => user.active) ?? owners[0] ?? (game.user.isGM ? game.user : null);
}

function settingsLinkMatchesToken(link, token) {
    if (link.tokenUuid) return link.tokenUuid === token.uuid;
    if (link.actorUuid && token.actorUuid) return link.actorUuid === token.actorUuid;
    return Boolean(link.actorId && token.actorId && link.actorId === token.actorId);
}

function actorAssignmentUuid(actor, sourceActorId = null) {
    return actorLinkUuid(actor?.uuid, sourceActorId ?? actor?.id);
}

function renderTokenOwnerControl(app, html) {
    if (!game.user.isGM) return;
    const root = asElement(html);
    const tokenObject = app?.object ?? app?.token ?? null;
    const token = tokenObject?.document ?? tokenObject;
    if (!root || !token?.uuid || !token?.actor) return;

    root.querySelector(".sf-token-owner-control")?.remove();
    const column = root.querySelector(".col.right") ?? root.querySelector(".right") ?? root;
    const explicitOwnerId = getExplicitTokenOwnerId(token);
    const effectiveOwner = getEffectiveTokenOwner(token);
    const control = document.createElement("div");
    control.className = `control-icon sf-token-owner-control${explicitOwnerId ? " active" : ""}`;
    control.dataset.action = "smoother-fight-assign-owner";
    control.dataset.tooltip = t("SMOOTHER_FIGHT.Settings.TokenAssignControl", {
        owner: effectiveOwner?.name ?? t("SMOOTHER_FIGHT.Settings.Unassigned"),
    });
    control.setAttribute("aria-label", control.dataset.tooltip);
    control.innerHTML = '<i class="fa-solid fa-user-tag"></i>';
    control.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void openTokenOwnerDialog(token);
    });
    column.append(control);
}

function getExplicitTokenOwnerId(token) {
    const primaryGmId = getSetting("primaryGmId", "");
    const links = normalizeUserTokenLinks(getSetting("userTokenLinks", {}), primaryGmId);
    return Object.entries(links)
        .find(([, userLinks]) => userLinks.some((link) => link.tokenUuid === token.uuid))?.[0] ?? "";
}

function getEffectiveTokenOwner(token) {
    const explicitOwner = game.users.get(getExplicitTokenOwnerId(token));
    if (explicitOwner) return explicitOwner;
    const actorLinks = normalizeActorUserLinks(getSetting("actorUserLinks", {}));
    const actorOwner = game.users.get(actorLinks[actorAssignmentUuid(token.actor, token.actorId)]);
    if (actorOwner) return actorOwner;
    const primaryGm = game.users.get(getSetting("primaryGmId", ""));
    if (primaryGm?.isGM) return primaryGm;
    const owners = Array.from(game.users ?? [])
        .filter((user) => !user.isGM && token.actor?.testUserPermission?.(user, "OWNER"));
    return owners.find((user) => user.active) ?? owners[0] ?? null;
}

function isCurrentUserTarget(token) {
    if (!token || !game.user || game.user.isGM) return false;
    const explicitOwnerId = getExplicitTokenOwnerId(token);
    if (explicitOwnerId) return explicitOwnerId === game.user.id;

    const actorLinks = normalizeActorUserLinks(getSetting("actorUserLinks", {}));
    const actorOwnerId = actorLinks[actorAssignmentUuid(token.actor, token.actorId)];
    if (actorOwnerId) return actorOwnerId === game.user.id;
    return Boolean(token.actor?.testUserPermission?.(game.user, "OWNER"));
}

async function openTokenOwnerDialog(token) {
    if (!game.user.isGM) return;
    const users = Array.from(game.users ?? []).sort((left, right) =>
        Number(left.isGM) - Number(right.isGM) || sortByName(left, right)
    );
    if (!users.length) return;

    const explicitOwnerId = getExplicitTokenOwnerId(token);
    const actorLinks = normalizeActorUserLinks(getSetting("actorUserLinks", {}));
    const actorOwner = game.users.get(actorLinks[actorAssignmentUuid(token.actor, token.actorId)]);
    const primaryGm = game.users.get(getSetting("primaryGmId", ""));
    const effectiveOwner = getEffectiveTokenOwner(token);
    const source = explicitOwnerId
        ? t("SMOOTHER_FIGHT.Settings.DirectTokenAssignment")
        : actorOwner
            ? t("SMOOTHER_FIGHT.Settings.SheetAssignment")
            : primaryGm?.isGM
                ? t("SMOOTHER_FIGHT.Settings.PrimaryGmAssignment")
                : t("SMOOTHER_FIGHT.Settings.OwnerAssignment");
    const options = users.map((user) =>
        `<option value="${escapeAttr(user.id)}" ${user.id === effectiveOwner?.id ? "selected" : ""}>${escapeHtml(user.name)}${user.isGM ? " (GM)" : ""}</option>`
    ).join("");
    const content = `<form class="sf-token-owner-dialog">
        <p>${escapeHtml(t("SMOOTHER_FIGHT.Settings.TokenAssignHint", { token: token.name }))}</p>
        <p class="notes"><strong>${escapeHtml(t("SMOOTHER_FIGHT.Settings.CurrentAssignment"))}:</strong>
            ${escapeHtml(effectiveOwner?.name ?? t("SMOOTHER_FIGHT.Settings.Unassigned"))}
            <span>(${escapeHtml(source)})</span>
        </p>
        <div class="form-group">
            <label>${escapeHtml(t("SMOOTHER_FIGHT.Settings.User"))}</label>
            <select name="ownerId">${options}</select>
        </div>
    </form>`;
    const result = await foundry.applications.api.DialogV2.wait({
        id: `${MODULE_ID}-token-owner-dialog`,
        window: { title: t("SMOOTHER_FIGHT.Settings.TokenAssignTitle", { token: token.name }) },
        position: { width: 420 },
        content,
        buttons: [
            {
                action: "assign",
                label: t("SMOOTHER_FIGHT.Settings.Assign"),
                icon: "fa-solid fa-user-check",
                callback: (_event, button) => button.form.elements.ownerId.value,
                default: true,
            },
            {
                action: "clear",
                label: t("SMOOTHER_FIGHT.Settings.ClearDirectAssignment"),
                icon: "fa-solid fa-rotate-left",
                callback: () => "",
            },
            {
                action: "cancel",
                label: t("SMOOTHER_FIGHT.Settings.Cancel"),
                icon: "fa-solid fa-xmark",
                callback: () => null,
            },
        ],
        close: () => null,
        modal: true,
    });
    if (result === null || result === undefined) return;
    await setExplicitTokenOwner(token, result);
}

async function setExplicitTokenOwner(token, userId) {
    if (!game.user.isGM || !token?.uuid) return;
    const primaryGmId = getSetting("primaryGmId", "");
    const links = normalizeUserTokenLinks(getSetting("userTokenLinks", {}), primaryGmId);
    for (const user of game.users ?? []) links[user.id] ??= [];
    for (const existingUserId of Object.keys(links)) {
        links[existingUserId] = links[existingUserId].filter((link) => link.tokenUuid !== token.uuid);
    }

    const user = game.users.get(userId);
    if (user) {
        links[user.id].push({
            tokenUuid: token.uuid,
            actorUuid: actorAssignmentUuid(token.actor, token.actorId),
            actorId: token.actorId ?? token.actor?.id ?? null,
            label: token.name ?? token.actor?.name ?? token.uuid,
        });
    }
    await game.settings.set(MODULE_ID, "userTokenLinks", links);
    if (user) {
        ui.notifications.info(t("SMOOTHER_FIGHT.Settings.TokenAssigned", { token: token.name, user: user.name }));
    } else {
        ui.notifications.info(t("SMOOTHER_FIGHT.Settings.TokenAssignmentCleared", { token: token.name }));
    }
    scheduleRender();
    canvas?.hud?.token?.render?.();
}

function getTargetForUser(user) {
    if (!user) return null;
    let uuid = runtime.targetByUser.get(user.id);
    if (user.id === game.user.id) {
        const localTarget = Array.from(user.targets ?? []).at(-1);
        uuid = tokenUuid(localTarget);
        runtime.targetByUser.set(user.id, uuid || null);
    }
    const target = uuid ? resolveToken(uuid) : null;
    return !game.user.isGM && target?.hidden ? null : target;
}

function getSceneTokens() {
    const scene = canvas?.scene;
    if (!scene) return [];
    return Array.from(scene.tokens ?? []).filter((token) => game.user.isGM || !token.hidden);
}

function getTargetSceneTokens(combat) {
    const sceneId = canvas?.scene?.id;
    const combatTokens = Array.from(combat.combatants ?? [])
        .map((combatant) => combatant.token ?? resolveCombatantToken(combatant))
        .filter((token) => token && (!sceneId || token.parent?.id === sceneId) && (game.user.isGM || !token.hidden));
    return uniqueTokensByReference([...combatTokens, ...getSceneTokens()]);
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
        if (isDiceAnimationPending(message)) return false;
        if (!isOffensiveCombatMessage(message)) return false;
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
        if (isDiceAnimationPending(message)) continue;
        if (!isDamageMessage(message) && !isDefenseMessage(message) && !isMagicFumbleMessage(message)) continue;
        const fumble = getFumbleData(message);
        const cardContext = getMessageContext(message);
        let group = isDefenseMessage(message)
            ? [...groups].reverse().find((candidate) => {
                const primaryContext = getMessageContext(candidate.primary);
                return primaryContext?.defenseMessageId === message.id
                    || primaryContext?.defenseMessageIds?.includes?.(message.id);
            })
            : null;
        group ??= fumble?.sourceMessageId
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
    if (isTargetDependentDifficulty(spell.difficulty ?? spell.system?.difficulty) && !context.target) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.SelectTargetFirst"));
        return;
    }
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

function showTokenOnCanvas(token) {
    const sceneId = token?.parent?.id ?? token?.scene?.id;
    if (!canvas?.ready || (sceneId && sceneId !== canvas.scene?.id)) return;

    const object = token?.object ?? canvas?.tokens?.get(token?.id);
    if (!object?.visible || !object?.center) {
        ui.notifications.warn("COMBATANT.WarnNonVisibleToken", { localize: true });
        return;
    }

    const { x, y } = object.center;
    const animation = canvas.animatePan({
        x,
        y,
        scale: Math.max(canvas.stage.scale.x, canvas.dimensions.scale.default),
    });
    canvas.ping?.(object.center);
    return animation;
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
        await waitForDiceSoNice(message);
        if (isOffensiveCombatMessage(message)) await attachCombatContext(message);
        if (isMagicFumbleMessage(message)) await attachMagicFumbleActions(message);
        if (isDefenseMessage(message)) await processDefenseMessage(message);
    } catch (error) {
        console.error(`${MODULE_ID} | Failed to process chat message`, error);
    }
}

async function onUpdateChatMessage(message, changes) {
    if (!hasSplittermondCheckUpdate(changes) || !isDefenseMessage(message)) return;
    try {
        await processDefenseMessage(message);
    } catch (error) {
        console.error(`${MODULE_ID} | Failed to process updated defense message`, error);
    }
}

async function waitForDiceSoNice(message) {
    if (!game.modules?.get?.("dice-so-nice")?.active) return;
    await Promise.resolve();
    if (!isDiceAnimationPending(message)) return;

    await new Promise((resolve) => {
        let timeoutId = null;
        let hookId = null;
        const finish = () => {
            if (timeoutId) clearTimeout(timeoutId);
            if (hookId !== null) Hooks.off("diceSoNiceRollComplete", hookId);
            resolve();
        };
        hookId = Hooks.on("diceSoNiceRollComplete", (messageId) => {
            if (messageId !== message.id) return;
            queueMicrotask(() => {
                if (!isDiceAnimationPending(message)) finish();
            });
        });
        timeoutId = setTimeout(finish, 30000);
        if (!isDiceAnimationPending(message)) finish();
    });
}

function isDiceAnimationPending(message) {
    return Boolean(message?._dice3danimating || Number(message?._dice3dPendingRenders) > 0);
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
        targetName: target?.name ?? target?.actor?.name ?? null,
        linkedUserId: linkedUser?.id ?? game.user.id,
        createdAt: Date.now(),
    };
    await safeSetFlag(message, "context", context);
}

function captureSystemActiveDefense(message, html) {
    if (!html || !isOffensiveCombatMessage(message)) return;
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

function rememberPendingDefense(message, targetOverride = null, options = {}) {
    const context = getMessageContext(message);
    const target = targetOverride
        ?? resolveToken(context?.targetTokenUuid)
        ?? getControlledTokenDocument()
        ?? getHudContext()?.target;
    const defender = options.defender ?? target;
    runtime.pendingDefense = {
        attackMessageId: message.id,
        targetTokenUuid: target?.uuid ?? null,
        targetActorUuid: target?.actor?.uuid ?? null,
        defenderTokenUuid: defender?.uuid ?? null,
        defenderActorUuid: defender?.actor?.uuid ?? null,
        assisted: Boolean(options.assisted),
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
        defenderTokenUuid: typeof value.defenderTokenUuid === "string" ? value.defenderTokenUuid : null,
        defenderActorUuid: typeof value.defenderActorUuid === "string" ? value.defenderActorUuid : null,
        assisted: Boolean(value.assisted),
        expiresAt: Number(value.expiresAt) || Date.now() + 60 * 1000,
    };
}

function getActiveGm() {
    return Array.from(game.users ?? []).find((user) => user.isGM && user.active) ?? null;
}

async function processDefenseMessage(message, pendingOverride = null, { allowForeign = false } = {}) {
    if (runtime.processingDefenseMessages.has(message.id)) return null;
    runtime.processingDefenseMessages.add(message.id);
    try {
        return await processDefenseMessageOnce(message, pendingOverride, { allowForeign });
    } finally {
        runtime.processingDefenseMessages.delete(message.id);
    }
}

async function processDefenseMessageOnce(message, pendingOverride = null, { allowForeign = false } = {}) {
    if ((!allowForeign && !isOwnMessage(message)) || !getSetting("defenseRecalculation", true)) return;
    const check = getDefenseCheck(message);
    if (!check) return;

    let pending = normalizePendingDefense(pendingOverride)
        ?? normalizePendingDefense(getMessageContext(message))
        ?? runtime.pendingDefense;
    if (!pending || pending.expiresAt < Date.now()) pending = findPendingOffenseForDefense(message);
    if (!pending?.attackMessageId) return;

    const target = resolveToken(pending.targetTokenUuid);
    const defender = resolveToken(pending.defenderTokenUuid);
    const expectedActor = pending.assisted ? defender?.actor : target?.actor;
    if (expectedActor && message.speaker?.actor && expectedActor.id !== message.speaker.actor) return;
    if (pending.assisted && !isValidDefenderAttempt(pending, message)) return;

    await safeSetFlag(message, "context", {
        attackMessageId: pending.attackMessageId,
        targetTokenUuid: pending.targetTokenUuid,
        targetActorUuid: pending.targetActorUuid,
        defenderTokenUuid: pending.defenderTokenUuid,
        defenderActorUuid: pending.defenderActorUuid,
        assisted: pending.assisted,
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

    if (!check.succeeded) {
        await recordDefenseAttempt(pending.attackMessageId, message, pending);
        runtime.pendingDefense = null;
        scheduleRender(0);
        return;
    }

    const newOffense = await recreateOffenseAfterDefense(pending.attackMessageId, message, check);
    runtime.pendingDefense = null;
    if (newOffense) scheduleRender(0);
}

async function recordDefenseAttempt(offenseMessageId, defenseMessage, pending = null) {
    const offense = game.messages.get(offenseMessageId);
    if (!offense) return;
    const context = getMessageContext(offense) ?? {};
    const actorUuid = pending?.defenderActorUuid ?? resolveSpeakerActor(defenseMessage)?.uuid ?? null;
    const attemptedDefenseActorUuids = Array.from(new Set([
        ...(context.attemptedDefenseActorUuids ?? []),
        actorUuid,
    ].filter(Boolean)));
    const defenseMessageIds = Array.from(new Set([
        ...(context.defenseMessageIds ?? []),
        context.defenseMessageId,
        defenseMessage.id,
    ].filter(Boolean)));
    await safeSetFlag(offense, "context", {
        ...context,
        attemptedDefenseActorUuids,
        defenseMessageIds,
    });
}

function findPendingOffenseForDefense(message) {
    const messages = Array.from(game.messages?.contents ?? []).filter(isOffensiveCombatMessage).reverse();
    const defenseActorId = message.speaker?.actor;
    const offense = messages.find((candidate) => {
        const context = getMessageContext(candidate);
        if (!context?.targetActorUuid) return false;
        const actor = globalThis.fromUuidSync?.(context.targetActorUuid);
        return actor?.id === defenseActorId && !context.supersededBy;
    });
    if (!offense) return null;
    const context = getMessageContext(offense);
    return {
        attackMessageId: offense.id,
        targetTokenUuid: context.targetTokenUuid,
        targetActorUuid: context.targetActorUuid,
        expiresAt: Date.now() + 1000,
    };
}

async function recreateOffenseAfterDefense(offenseMessageId, defenseMessage, defenseCheck) {
    const original = game.messages.get(offenseMessageId);
    if (!original || !isOffensiveCombatMessage(original)) return null;

    const featureValue = findDefensiveFeatureValue(defenseCheck.itemData);
    const originalContext = getMessageContext(original) ?? {};
    const target = resolveToken(originalContext.targetTokenUuid);
    const calculatedBase = await target?.actor?.derivedValues?.[defenseCheck.defenseType]?.value?.calculate?.();
    const candidateDefense = calculateActiveDefenseValue({
        ...defenseCheck,
        baseDefense: Number.isFinite(Number(calculatedBase)) ? Number(calculatedBase) : defenseCheck.baseDefense,
    }, featureValue);
    const newDefense = bestActiveDefenseValue(originalContext.defenseValue, candidateDefense);
    const pending = normalizePendingDefense(getMessageContext(defenseMessage)) ?? runtime.pendingDefense;
    const actorUuid = pending?.defenderActorUuid ?? resolveSpeakerActor(defenseMessage)?.uuid ?? null;
    const attemptedDefenseActorUuids = Array.from(new Set([
        ...(originalContext.attemptedDefenseActorUuids ?? []),
        actorUuid,
    ].filter(Boolean)));
    const defenseMessageIds = Array.from(new Set([
        ...(originalContext.defenseMessageIds ?? []),
        originalContext.defenseMessageId,
        defenseMessage.id,
    ].filter(Boolean)));

    if (Number.isFinite(Number(originalContext.defenseValue)) && newDefense <= Number(originalContext.defenseValue)) {
        await safeSetFlag(original, "context", {
            ...originalContext,
            attemptedDefenseActorUuids,
            defenseMessageIds,
        });
        return original;
    }
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
    resetOffenseHandlers(systemSource);

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
            ...originalContext,
            recalculatedFrom: original.id,
            defenseMessageId: defenseMessage.id,
            defenseMessageIds,
            defenseValue: newDefense,
            defenseType: defenseCheck.defenseType,
            attemptedDefenseActorUuids,
            createdAt: Date.now(),
        },
    };
    if (source.flags.splittermond?.chatCard) source.flags.splittermond.chatCard.messageId = null;

    const created = await ChatMessage.create(source);
    if (!created) return null;
    const rendered = await renderTemplate(created.system.template, created.system.getData());
    const defenseLabel = localizeSystem(`splittermond.derivedAttribute.${defenseCheck.defenseType}.short`, String(defenseCheck.defenseType).toUpperCase());
    const hiddenClass = systemSource.checkReport.hideDifficulty ? " gm-only" : "";
    const banner = `<div class="sf-chat-recalculated${hiddenClass}"><i class="fa-solid fa-shield-halved"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NewDefense", { defense: defenseLabel }))}</span><strong>${escapeHtml(newDefense)}</strong></div>`;
    const decorated = decorateRecalculatedCard(rendered, banner);
    await created.update({ content: decorated });
    await safeSetFlag(original, "context", { ...getMessageContext(original), supersededBy: created.id });
    return created;
}

function resetOffenseHandlers(systemSource) {
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
        if (localAction && String(action).toLocaleLowerCase() === "applydamagetousertargets") {
            await applyDamageToLinkedTarget(message, actionData);
            scheduleRender();
            return;
        }
        if (!localAction && String(action).toLocaleLowerCase() === "usesplinterpoint" && forwardToOriginalChatHandler(message, button, action)) {
            return;
        }
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

function forwardToOriginalChatHandler(message, sourceButton, action) {
    const messageRoots = Array.from(document.querySelectorAll(".message[data-message-id]"))
        .filter((element) => element.dataset.messageId === message.id && !element.closest(`#${MODULE_ID}-hud`));
    const candidates = messageRoots.flatMap((element) =>
        Array.from(element.querySelectorAll(".splittermond-chat-action[data-action]"))
    );
    const original = candidates.find((candidate) => candidate.dataset.action === action && !candidate.disabled);
    if (!original) return false;

    sourceButton.disabled = true;
    original.click();
    setTimeout(() => {
        if (sourceButton.isConnected) sourceButton.disabled = false;
    }, 1500);
    return true;
}

async function applyDamageToLinkedTarget(message, actionData) {
    const target = resolveDamageApplicationTarget(message);
    const tokenObject = target?.object ?? canvas?.tokens?.get(target?.id);
    const currentTargets = game.user?.targets;
    if (!target || !tokenObject || !currentTargets?.clear || !currentTargets?.add) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DamageTargetMissing"));
        return;
    }

    await withTemporarySetValues(currentTargets, [tokenObject], () =>
        message.system.handleGenericAction({ ...actionData, action: "applyDamageToTargets" })
    );
}

function resolveDamageApplicationTarget(message) {
    const directTargetUuid = getMessageContext(message)?.targetTokenUuid;
    if (directTargetUuid) {
        const directTarget = resolveToken(directTargetUuid);
        return directTarget && (game.user.isGM || !directTarget.hidden) ? directTarget : null;
    }

    const hudContext = getHudContext();
    if (!hudContext) return null;
    const group = collectCombatEventGroups(hudContext).find((candidate) =>
        candidate.damages.some((damage) => damage.id === message.id)
    );
    const attackTargetUuid = getMessageContext(group?.primary)?.targetTokenUuid;
    if (attackTargetUuid) {
        const attackTarget = resolveToken(attackTargetUuid);
        return attackTarget && (game.user.isGM || !attackTarget.hidden) ? attackTarget : null;
    }

    const speakerActor = resolveSpeakerActor(message);
    const sameActiveActor = speakerActor?.id && speakerActor.id === hudContext.actor?.id;
    return sameActiveActor ? hudContext.target : null;
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

async function beginAdditionalTargetDefense(message) {
    if (!message) return;
    const context = getMessageContext(message);
    const target = resolveToken(context?.targetTokenUuid);
    const attempted = new Set(context?.attemptedDefenseActorUuids ?? []);
    if (!target?.actor || attempted.has(target.actor.uuid) || !(game.user.isGM || target.actor.isOwner)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenseNotAllowed"));
        return;
    }
    rememberPendingDefense(message, target, { defender: target });
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.WaitingForDefense", { target: target.name }));
    const type = message.system?.checkReport?.defenseType ?? context?.defenseType ?? "defense";
    await target.actor.activeDefenseDialog(type || undefined);
}

async function beginDefenderDefense(message) {
    if (!message) return;
    const choices = getEligibleDefenderChoices(message, game.user);
    if (!choices.length) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenderUnavailable"));
        return;
    }
    const target = resolveToken(getMessageContext(message)?.targetTokenUuid);
    if (!target?.actor) return;

    const options = choices.map((choice, index) =>
        `<option value="${index}">${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenderChoice", {
            defender: choice.token.name ?? choice.actor.name,
            defense: choice.defense.name,
        }))}</option>`
    ).join("");
    const content = `<form class="sf-defender-dialog">
        <p>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenderRule", { target: target.name }))}</p>
        <div class="form-group"><label>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenderDefense"))}</label><select name="choice">${options}</select></div>
    </form>`;
    const selectedIndex = await foundry.applications.api.DialogV2.wait({
        id: `${MODULE_ID}-defender-dialog`,
        window: { title: t("SMOOTHER_FIGHT.HUD.DefenderDialogTitle", { target: target.name }) },
        position: { width: 470 },
        content,
        buttons: [
            {
                action: "roll",
                label: t("SMOOTHER_FIGHT.HUD.DefenderRoll"),
                icon: "fa-solid fa-shield-halved",
                callback: (_event, button) => Number(button.form.elements.choice.value),
                default: true,
            },
            {
                action: "cancel",
                label: t("SMOOTHER_FIGHT.Settings.Cancel"),
                icon: "fa-solid fa-xmark",
                callback: () => null,
            },
        ],
        close: () => null,
        modal: true,
    });
    if (!Number.isInteger(selectedIndex)) return;

    const currentChoices = getEligibleDefenderChoices(message, game.user);
    const selected = choices[selectedIndex];
    const current = currentChoices.find((choice) =>
        choice.token.uuid === selected?.token.uuid && choice.defense.id === selected?.defense.id
    );
    if (!current) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenderUnavailable"));
        return;
    }

    rememberPendingDefense(message, target, { defender: current.token, assisted: true });
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.WaitingForDefender", {
        defender: current.token.name ?? current.actor.name,
        target: target.name,
    }));
    const baseDefense = await target.actor.derivedValues.defense.value.calculate();
    const difficulty = Number(globalThis.CONFIG?.splittermond?.check?.activeDefenseDifficulty) || 15;
    const defenderModifier = Array.from(current.defense.skill.selectableModifier ?? [])
        .find((modifier) => isDefenderMasteryName(modifier?.attributes?.name));
    const rolled = await current.defense.skill.roll({
        type: "defense",
        preSelectedModifier: defenderModifier ? [defenderModifier.attributes.name] : [],
        difficulty,
        modifier: defenderModifier ? 0 : -3,
        title: t("SMOOTHER_FIGHT.HUD.DefenderRollTitle", {
            defender: current.token.name ?? current.actor.name,
            target: target.name,
        }),
        checkMessageData: {
            defenseType: "defense",
            baseDefense,
            itemData: current.defense,
        },
    });
    if (!rolled) runtime.pendingDefense = null;
}

function getEligibleDefenderChoices(message, user) {
    if (!message || !user || !isOffensiveCombatMessage(message)) return [];
    const context = getMessageContext(message);
    if (context?.supersededBy || !message.system?.checkReport?.succeeded) return [];
    const defenseType = String(message.system?.checkReport?.defenseType ?? context?.defenseType ?? "defense").toLocaleLowerCase();
    if (defenseType !== "defense" && defenseType !== "vtd") return [];
    const target = resolveToken(context?.targetTokenUuid);
    if (!target?.actor) return [];
    const attempted = new Set(context?.attemptedDefenseActorUuids ?? []);
    const choices = [];
    for (const combatant of Array.from(game.combat?.combatants ?? [])) {
        const token = combatant.token?.document ?? combatant.token ?? resolveCombatantToken(combatant);
        const actor = token?.actor ?? combatant.actor;
        if (!token?.uuid || !actor || actor.id === target.actor.id || attempted.has(actor.uuid)) continue;
        if (!(user.isGM || actor.testUserPermission?.(user, "OWNER"))) continue;
        if (!hasDefenderMastery(actor) || measureTokenDistance(token, target) > 2) continue;
        for (const defense of getCombatDefenseOptions(actor, { requireDefenderMastery: true })) choices.push({ token, actor, defense });
    }
    return choices;
}

function getCombatDefenseOptions(actor, { requireDefenderMastery = false } = {}) {
    const masteries = getDefenderMasteries(actor);
    const masterySkills = new Set(masteries.map((mastery) => mastery.system?.skill).filter(Boolean));
    return Array.from(actor?.activeDefense?.defense ?? []).filter((defense) => {
        if (!defense?.skill || defense.id === "acrobatics" || defense.skill.id === "acrobatics") return false;
        return !requireDefenderMastery || !masterySkills.size || masterySkills.has(defense.skill.id);
    });
}

function hasDefenderMastery(actor) {
    return getDefenderMasteries(actor).length > 0;
}

function getDefenderMasteries(actor) {
    return Array.from(actor?.items ?? []).filter((item) =>
        item.type === "mastery" && isDefenderMasteryName(item.name)
    );
}

function measureTokenDistance(left, right) {
    const leftPoint = tokenCenter(left);
    const rightPoint = tokenCenter(right);
    if (!leftPoint || !rightPoint) return Number.POSITIVE_INFINITY;
    try {
        const measured = canvas?.grid?.measurePath?.([leftPoint, rightPoint]);
        if (Number.isFinite(Number(measured?.distance))) return Number(measured.distance);
    } catch (error) {
        console.debug(`${MODULE_ID} | Could not measure Defender distance through the grid`, error);
    }
    const gridSize = Number(canvas?.grid?.size) || 100;
    const gridDistance = Number(canvas?.scene?.grid?.distance) || 1;
    return Math.hypot(rightPoint.x - leftPoint.x, rightPoint.y - leftPoint.y) / gridSize * gridDistance;
}

function tokenCenter(token) {
    const object = token?.object ?? canvas?.tokens?.get?.(token?.id);
    if (object?.center) return { x: object.center.x, y: object.center.y };
    if (!Number.isFinite(Number(token?.x)) || !Number.isFinite(Number(token?.y))) return null;
    const gridSize = Number(canvas?.grid?.size) || 100;
    return {
        x: Number(token.x) + Number(token.width ?? 1) * gridSize / 2,
        y: Number(token.y) + Number(token.height ?? 1) * gridSize / 2,
    };
}

function canUserSubmitDefense(user, pending, message) {
    const target = resolveToken(pending?.targetTokenUuid);
    if (!target?.actor) return false;
    if (!pending.assisted) return Boolean(target.actor.testUserPermission?.(user, "OWNER"));
    const defender = resolveToken(pending.defenderTokenUuid);
    return Boolean(defender?.actor?.testUserPermission?.(user, "OWNER") && isValidDefenderAttempt(pending, message));
}

function isValidDefenderAttempt(pending, message) {
    const target = resolveToken(pending?.targetTokenUuid);
    const defender = resolveToken(pending?.defenderTokenUuid);
    const check = getDefenseCheck(message);
    const offense = game.messages.get(pending?.attackMessageId);
    const attempted = new Set(getMessageContext(offense)?.attemptedDefenseActorUuids ?? []);
    if (!target?.actor || !defender?.actor || !check || target.actor.id === defender.actor.id) return false;
    if (pending.defenderActorUuid && pending.defenderActorUuid !== defender.actor.uuid) return false;
    if (message.speaker?.actor && message.speaker.actor !== defender.actor.id) return false;
    if (attempted.has(defender.actor.uuid) || !hasDefenderMastery(defender.actor)) return false;
    if (String(check.defenseType).toLocaleLowerCase() !== "defense") return false;
    if (check.itemData?.id === "acrobatics" || check.itemData?.skill?.id === "acrobatics") return false;
    const validOption = getCombatDefenseOptions(defender.actor, { requireDefenderMastery: true })
        .some((defense) => defense.id === check.itemData?.id);
    return validOption && measureTokenDistance(defender, target) <= 2;
}

function addEventDefenseActions(element, message) {
    if (!isOffensiveCombatMessage(message) || !message.system?.checkReport?.succeeded) return;
    const context = getMessageContext(message);
    if (context?.supersededBy) return;
    const target = resolveToken(context?.targetTokenUuid);
    if (!target?.actor) return;
    const attempted = new Set(context?.attemptedDefenseActorUuids ?? []);
    const mayDefendTarget = Boolean(
        context?.recalculatedFrom
        && !attempted.has(target.actor.uuid)
        && (game.user.isGM || target.actor.isOwner)
    );
    const mayDefendOther = getEligibleDefenderChoices(message, game.user).length > 0;
    if (!mayDefendTarget && !mayDefendOther) return;

    let actions = element.querySelector(".sf-promoted-actions");
    if (!actions) {
        const card = element.querySelector(".sf-offense-check");
        if (!card) return;
        let controls = card.querySelector(":scope > .sf-promoted-controls");
        if (!controls) {
            controls = document.createElement("div");
            controls.className = "sf-promoted-controls";
            const header = card.querySelector(":scope > .chat-message-header");
            if (header) header.after(controls);
            else card.prepend(controls);
        }
        actions = document.createElement("div");
        actions.className = "actions splittermond-chat-action-container sf-promoted-actions";
        actions.innerHTML = `<h3>${escapeHtml(localizeSystem("splittermond.furtherActions", "Weitere Aktionen"))}</h3>`;
        controls.prepend(actions);
    }

    if (mayDefendTarget) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "splittermond-chat-action sf-defender-action";
        button.dataset.sfAction = "defend-target";
        button.dataset.messageId = message.id;
        button.innerHTML = `<i class="fa-solid fa-shield-halved"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefendTarget", { target: target.name }))}`;
        actions.append(button);
    }
    if (mayDefendOther) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "splittermond-chat-action sf-defender-action";
        button.dataset.sfAction = "defend-other";
        button.dataset.messageId = message.id;
        button.innerHTML = `<i class="fa-solid fa-shield-heart"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenderAction", { target: target.name }))}`;
        actions.append(button);
    }
}

function enforceChatPermissions(root, hudContext) {
    for (const element of root.querySelectorAll(".sf-chat-message")) {
        const message = game.messages.get(element.dataset.messageId);
        if (!message) continue;
        const renderedActions = getRenderedChatActionKeys(message.id);
        if (renderedActions) {
            for (const button of element.querySelectorAll(".splittermond-chat-action[data-action], .splittermond-chat-action[data-localaction], .splittermond-chat-action[data-local-action]")) {
                const key = chatActionKey(button);
                if (key && !renderedActions.has(key)) button.remove();
            }
        } else {
            const speakerActor = message.speaker?.actor ? game.actors.get(message.speaker.actor) : null;
            const authorId = message.author?.id ?? message.user?.id ?? message.user;
            const mayChange = mayUseRemoteChatActions(game.user.isGM, speakerActor?.isOwner, authorId === game.user.id);
            if (!mayChange) {
                element.querySelectorAll(".splittermond-chat-action[data-action]:not([data-localaction]):not([data-local-action])").forEach((button) => button.remove());
            }
        }

        const context = getMessageContext(message);
        enforceSystemVisibility(element, message, context);
        const defenseTarget = resolveToken(context?.targetTokenUuid) ?? getControlledTokenDocument() ?? hudContext.target;
        const mayDefend = game.user.isGM || defenseTarget?.actor?.isOwner;
        const targetAlreadyDefended = Boolean(
            defenseTarget?.actor?.uuid
            && context?.attemptedDefenseActorUuids?.includes?.(defenseTarget.actor.uuid)
        );
        if (!mayDefend || targetAlreadyDefended || context?.supersededBy || context?.recalculatedFrom) {
            element.querySelectorAll('[data-localaction="activeDefense" i], [data-local-action="activeDefense" i]').forEach((button) => {
                button.remove();
            });
        }
        addEventDefenseActions(element, message);
        element.querySelectorAll(".splittermond-chat-action-container:not(:has(.splittermond-chat-action)), .sf-promoted-actions:not(:has(.splittermond-chat-action))").forEach((container) => container.remove());
        element.querySelectorAll(".sf-promoted-controls:not(:has(.splittermond-chat-action))").forEach((container) => container.remove());
    }
}

function enforceSystemVisibility(element, message, context = getMessageContext(message)) {
    if (game.user.isGM) return;
    const target = resolveMessageTarget(context);
    const observer = Boolean(target?.actor?.testUserPermission?.(game.user, "OBSERVER"));
    const markedDifficulty = element.querySelector(".gm-only.difficulty, .gm-only .difficulty");
    const targetDependent = Boolean(message.system?.checkReport?.hideDifficulty || markedDifficulty);
    const mayViewDifficulty = mayViewTargetDifficulty(targetDependent, false, observer);

    for (const restricted of element.querySelectorAll(".gm-only")) {
        const isDifficulty = restricted.matches(".difficulty, .sf-chat-recalculated")
            || Boolean(restricted.querySelector(".difficulty, .sf-chat-recalculated"));
        if (!isDifficulty || !mayViewDifficulty) restricted.remove();
    }
    if (!mayViewDifficulty) {
        element.querySelectorAll(".sf-chat-recalculated").forEach((restricted) => restricted.remove());
    }
    if (!mayViewActorResources(false, observer)) {
        element.querySelectorAll(".sf-defense-value").forEach((restricted) => restricted.remove());
    }
}

function resolveMessageTarget(context) {
    if (!context) return { token: null, actor: null };
    const token = resolveToken(context.targetTokenUuid);
    if (token?.actor) return { token, actor: token.actor };
    let actor = null;
    if (context.targetActorUuid) {
        try {
            actor = globalThis.fromUuidSync?.(context.targetActorUuid) ?? null;
        } catch (error) {
            console.debug(`${MODULE_ID} | Could not resolve target actor ${context.targetActorUuid}`, error);
        }
    }
    return { token, actor };
}

function getRenderedChatActionKeys(messageId) {
    const messageRoots = Array.from(document.querySelectorAll(".message[data-message-id]"))
        .filter((element) => element.dataset.messageId === messageId && !element.closest(`#${MODULE_ID}-hud`));
    if (!messageRoots.length) return null;
    return new Set(messageRoots.flatMap((element) =>
        Array.from(element.querySelectorAll(".splittermond-chat-action[data-action], .splittermond-chat-action[data-localaction], .splittermond-chat-action[data-local-action]"))
            .map(chatActionKey)
            .filter(Boolean)
    ));
}

function chatActionKey(button) {
    const localAction = button?.dataset?.localaction ?? button?.dataset?.localAction;
    if (localAction) return `local:${String(localAction).toLocaleLowerCase()}`;
    const remoteAction = button?.dataset?.action;
    return remoteAction ? `remote:${String(remoteAction).toLocaleLowerCase()}` : "";
}

function getMessageContext(message) {
    return message?.getFlag?.(MODULE_ID, "context") ?? message?.flags?.[MODULE_ID]?.context ?? null;
}

function getDefenseCheck(message) {
    return message?.getFlag?.("splittermond", "check") ?? message?.flags?.splittermond?.check ?? null;
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

function toggleHudMinimizedFromKeybinding() {
    if (!getSetting("enabled", true) || !getHudContext()) return false;
    void game.settings.set(MODULE_ID, "minimized", !getSetting("minimized", false));
    return true;
}

function toggleHudVisibilityFromKeybinding() {
    if (!getSetting("enabled", true) || !getHudContext()) return false;
    runtime.hiddenByShortcut = !runtime.hiddenByShortcut;
    runtime.eventExpansionRequest = null;
    scheduleRender(0);
    return true;
}

function requestCombatEventExpansion(request) {
    if (!getSetting("enabled", true) || !getSetting("showCards", true) || runtime.hiddenByShortcut || !getHudContext()) {
        return false;
    }
    runtime.eventExpansionRequest = request;
    if (request === "latest") {
        runtime.cardsCollapsed = false;
        if (getSetting("minimized", false)) void game.settings.set(MODULE_ID, "minimized", false);
    }
    scheduleRender(0);
    return true;
}

function syncSystemActionBar(hudVisible) {
    const bar = document.querySelector("#token-action-bar");
    if (!bar) return;
    const shouldHide = hudVisible && getSetting("hideSystemBar", true);
    bar.classList.toggle("sf-system-bar-hidden", shouldHide);
}

function syncMinimizedHudPosition(hud, minimized) {
    hud.classList.toggle("is-minimized", minimized);
    hud.classList.remove("is-action-bar-aligned");
    hud.style.removeProperty("--sf-minimized-center");
    hud.style.removeProperty("--sf-minimized-top");
    if (!minimized) return;

    const actionBarSelectors = [
        "#token-action-bar:not(.sf-system-bar-hidden) .token-action-bar",
        "#custom-hotbar",
        "#hotbar",
    ];
    const bounds = actionBarSelectors
        .map((selector) => document.querySelector(selector))
        .filter((element) => element && window.getComputedStyle(element).display !== "none")
        .map((element) => element.getBoundingClientRect())
        .find((candidate) => candidate.width > 0 && candidate.height > 0);
    if (!bounds) return;

    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const hudWidth = Math.min(620, Math.max(0, viewportWidth - 24));
    const halfWidth = hudWidth / 2;
    const desiredCenter = bounds.left + bounds.width / 2;
    const center = Math.min(viewportWidth - halfWidth - 12, Math.max(halfWidth + 12, desiredCenter));
    const top = bounds.top + bounds.height / 2;
    hud.classList.add("is-action-bar-aligned");
    hud.style.setProperty("--sf-minimized-center", `${Math.round(center)}px`);
    hud.style.setProperty("--sf-minimized-top", `${Math.round(top)}px`);
}

function isUnmodifiedKeyAvailable(key) {
    const customBindings = game.settings.get("core", "keybindings") ?? {};
    for (const [actionId, config] of game.keybindings.actions ?? []) {
        const editable = Object.hasOwn(customBindings, actionId) ? customBindings[actionId] : config.editable;
        const bindings = [...(config.uneditable ?? []), ...(editable ?? [])];
        if (bindings.some((binding) => binding?.key === key && !(binding.modifiers?.length))) return false;
    }
    return true;
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
