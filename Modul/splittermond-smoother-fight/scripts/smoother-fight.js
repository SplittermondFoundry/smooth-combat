import {
    activeDefenseChangesDifficulty,
    actorLinkUuid,
    bestActiveDefenseValue,
    calculateActiveDefenseValue,
    combatMessageKind,
    findDefensiveFeatureValue,
    fullyConsumedCost,
    hasSplittermondCheckUpdate,
    isCombatantVisibleToUser,
    isDamageSelectionAction,
    isDefenderMasteryName,
    isPlayersTurn,
    isTargetDependentDifficulty,
    isOffensiveCombatMessage,
    linkMatchesCombatant,
    mayUseRemoteChatActions,
    mayViewActorResources,
    mayViewTargetDefenses,
    mayViewTargetDifficulty,
    mergeActiveDefenseCheck,
    normalizeActorUserLinks,
    normalizeSearchText,
    normalizeTargetReferences,
    normalizeUserTokenLinks,
    parseActiveDefenseDescription,
    parseStatusEffectLabel,
    recalculateAttackReport,
    requiresRollManagementPermission,
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
    feedback: null,
    feedbackTimer: null,
    audioContext: null,
    lastTurnCombatantId: null,
    heardMessageIds: new Set(),
    pendingOffenseKinds: new Map(),
    combatEventDeletionPending: false,
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
    runtime.lastTurnCombatantId = game.combat?.combatant?.id ?? null;
    window.addEventListener("pointerdown", unlockFeedbackAudio, { once: true, capture: true });
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
    game.settings.register(MODULE_ID, "revealTargetDefenses", {
        name: "SMOOTHER_FIGHT.Settings.RevealTargetDefensesName",
        hint: "SMOOTHER_FIGHT.Settings.RevealTargetDefensesHint",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: false,
        onChange: rerender,
    });
    game.settings.register(MODULE_ID, "audioFeedback", {
        name: "SMOOTHER_FIGHT.Settings.AudioFeedbackName",
        hint: "SMOOTHER_FIGHT.Settings.AudioFeedbackHint",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID, "theme", {
        scope: "client",
        config: false,
        type: String,
        default: "dark",
        onChange: rerender,
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
        const targets = new Set(normalizeTargetReferences(user.targets));
        const changedUuid = tokenUuid(token);
        if (changedUuid) {
            if (targeted) targets.add(changedUuid);
            else targets.delete(changedUuid);
        }
        const references = Array.from(targets);
        runtime.targetByUser.set(user.id, references);
        if (user.id === game.user.id) publishOwnTarget(references);
        scheduleRender();
    });

    Hooks.on("combatTurn", (combat) => {
        announceTurnFeedback(combat);
        scheduleRender();
    });
    Hooks.on("combatStart", (combat) => {
        runtime.lastTurnCombatantId = null;
        announceTurnFeedback(combat);
    });

    Hooks.on("createChatMessage", (message) => {
        void onCreateChatMessage(message).finally(() => scheduleRender(0));
        scheduleRender();
    });
    Hooks.on("updateChatMessage", (message, changes) => {
        void onUpdateChatMessage(message, changes).finally(() => scheduleRender(0));
        scheduleRender();
    });
    Hooks.on("deleteChatMessage", (message) => {
        if (isCombatEventMessage(message)) runtime.combatEventDeletionPending = true;
        runtime.eventExpansionRequest = null;
        scheduleRender(0);
    });
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
            const targetUuids = normalizeTargetReferences(payload.targetUuids ?? [payload.tokenUuid]);
            runtime.targetByUser.set(payload.userId, targetUuids);
            scheduleRender();
            return;
        }

        if (payload.type === "set-target" && payload.recipientId === game.user.id) {
            const sender = game.users.get(payload.senderId);
            if (!sender?.isGM) return;
            const target = resolveToken(payload.tokenUuid);
            if (!target) return;
            setLocalTarget(target, payload.targeted !== false, Boolean(payload.releaseOthers));
            publishOwnTarget();
            return;
        }

        if (payload.type === "recalculate-defense" && payload.recipientId === game.user.id && game.user.isGM) {
            const sender = game.users.get(payload.senderId);
            const message = await waitForChatMessage(payload.defenseMessageId);
            const authorId = message?.author?.id ?? message?.user?.id ?? message?.user;
            if (!sender || !message || (!sender.isGM && authorId !== sender.id)) return;

            const pending = normalizePendingDefense(payload.pending);
            const offense = game.messages.get(pending?.attackMessageId);
            if (!pending || !offense || !isOffensiveCombatMessage(offense)) return;
            if (!sender.isGM && !canUserSubmitDefense(sender, pending, message)) return;

            await waitForDefenseProcessing(message.id);
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
        const forceLatestEvent = runtime.combatEventDeletionPending;
        const context = getHudContext();
        const enabled = getSetting("enabled", true);
        if (!enabled || !context) {
            runtime.hiddenByShortcut = false;
            runtime.eventExpansionRequest = null;
        }
        const visible = Boolean(enabled && context && !runtime.hiddenByShortcut);
        const minimized = Boolean(visible && getSetting("minimized", false));
        this.element.classList.toggle("sf-theme-light", getSetting("theme", "dark") === "light");
        this.element.classList.toggle("is-hidden", !visible);
        syncSystemActionBar(visible);
        syncMinimizedHudPosition(this.element, minimized);
        if (!visible) {
            runtime.combatEventDeletionPending = false;
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
        restoreHudViewState(this.element, viewState, { forceLatestEvent });
        if (forceLatestEvent) runtime.combatEventDeletionPending = false;
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
                case "open-token-sheet": {
                    const token = resolveToken(target.dataset.sfTokenUuid);
                    token?.actor?.sheet?.render?.({ force: true });
                    break;
                }
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
                case "cancel-prepared-attack":
                    await requireOwner(context, () => cancelPreparedAttack(context));
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
                case "show-token":
                    showTokenOnCanvas(resolveToken(target.dataset.tokenUuid));
                    break;
                case "toggle-combatant-hidden":
                    await requireGm(() => context.combatant.update({ hidden: !context.combatant.hidden }));
                    break;
                case "toggle-combatant-visibility":
                    await requireGm(() => toggleCombatantVisibility(context));
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
                    await setHudMinimized(!getSetting("minimized", false));
                    break;
                case "toggle-theme":
                    await game.settings.set(MODULE_ID, "theme", getSetting("theme", "dark") === "light" ? "dark" : "light");
                    break;
            }
        } catch (error) {
            console.error(`${MODULE_ID} | HUD action failed`, error);
            ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
        }
    }
}

async function buildHud(context) {
    const { combat, combatant, actor, token, linkedUser, target, targets } = context;
    const canAct = Boolean(game.user.isGM || actor.isOwner);
    const tick = combat.currentTick ?? Math.round(Number(combatant.initiative) || 0);
    const userName = linkedUser?.name ?? t("SMOOTHER_FIGHT.HUD.AutomaticOwner");
    const targetNames = targets.map((candidate) => candidate.name ?? candidate.actor?.name).filter(Boolean).join(", ");
    const targetLine = targets.length
        ? t("SMOOTHER_FIGHT.HUD.PlayerTargetName", { user: userName, target: targetNames })
        : t("SMOOTHER_FIGHT.HUD.NoTargetDetail");
    const minimized = getSetting("minimized", false);
    const hudToggle = buildHudToggle(minimized);
    const personalTarget = targets.some((candidate) => isCurrentUserTarget(candidate));
    const currentPlayersTurn = isPlayersTurn({
        isGm: game.user?.isGM,
        userId: game.user?.id,
        linkedUserId: linkedUser?.id,
        ownsActor: actor.isOwner,
    });
    const turnNotice = currentPlayersTurn
        ? `<span class="sf-your-turn"><i class="fa-solid fa-bolt"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.YourTurn"))}</span>`
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
                        <span class="sf-turn-target ${personalTarget ? "is-user-target" : ""}"><i class="fa-solid fa-crosshairs"></i> ${escapeHtml(targetLine)}</span>
                        ${buildThemeToggle()}
                        ${hudToggle}
                    </header>
                </main>
            </div>
        `;
    }

    return `
        <div class="${shellClass}">
            ${portraitPanel({ side: "actor", token, actor, eyebrow: t("SMOOTHER_FIGHT.HUD.Active"), action: "open-sheet" })}
            <main class="sf-center">
                <header class="sf-turnline">
                    <span class="sf-live-dot"></span>
                    <strong>${escapeHtml(actor.name)}</strong>
                    <span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.CurrentTick", { tick }))}</span>
                    ${turnNotice}
                    <span class="sf-turn-target ${personalTarget ? "is-user-target" : ""}"><i class="fa-solid fa-crosshairs"></i> ${escapeHtml(targetLine)}</span>
                    ${buildThemeToggle()}
                    ${hudToggle}
                </header>
                ${canAct ? buildCombatControls(context) : ""}
                ${canAct ? await buildActionBar(context) : `<p class="sf-owner-note"><i class="fa-solid fa-lock"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoOwner"))}</p>`}
                ${getSetting("showCards", true) ? buildCombatEvents(context) : ""}
            </main>
            <div class="sf-target-column">
                ${canChooseTarget(context) ? buildQuickTargets(context) : ""}
                ${targets.length ? `<div class="sf-target-list ${targets.length > 1 ? "is-multi" : ""}">${targets.map((candidate) => portraitPanel({
                    side: "target",
                    token: candidate,
                    actor: candidate.actor,
                    eyebrow: t("SMOOTHER_FIGHT.HUD.Target"),
                    action: "open-token-sheet",
                    highlighted: isCurrentUserTarget(candidate),
                    showDefenses: canViewTargetDefenseValues(candidate.actor),
                })).join("")}</div>` : noTargetPanel()}
            </div>
        </div>
    `;
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

function portraitPanel({ side, token, actor, eyebrow, action = "", highlighted = false, showDefenses = true }) {
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
                ${feedbackMarkup(token, actor)}
            </div>
            <div class="sf-portrait-name">${escapeHtml(token?.name ?? actor?.name ?? "–")}</div>
            ${showDefenses ? `<div class="sf-defense-row" aria-label="VTD, KW, GW">
                <span><small>VTD</small>${escapeHtml(defense)}</span>
                <span><small>KW</small>${escapeHtml(body)}</span>
                <span><small>GW</small>${escapeHtml(mind)}</span>
            </div>` : `<div class="sf-defense-row is-concealed"><i class="fa-solid fa-eye-slash"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefensesHidden"))}</span></div>`}
            ${canViewResources(actor) ? resourceBars(actor) : ""}
        </aside>
    `;
}

function canViewTargetDefenseValues(actor) {
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
    const tickButtons = [1, 2, 3, 5, 7, 10].map((ticks) => `
        <button type="button" data-sf-action="add-ticks" data-ticks="${ticks}" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.AddTicks", { ticks }))}">+${ticks} T</button>
    `).join("");
    const pauseButtons = paused
        ? `<button type="button" data-sf-action="resume-combatant" class="is-resume" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.Resume"))}"><i class="fa-solid fa-play-circle"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Resume"))}</span></button>`
        : `<button type="button" data-sf-action="pause-combatant" data-pause-type="wait" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.Wait"))}"><i class="fa-solid fa-hourglass-half"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Wait"))}</span></button>
           <button type="button" data-sf-action="pause-combatant" data-pause-type="keepReady" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.KeepReady"))}"><i class="fa-solid fa-hand"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.KeepReady"))}</span></button>`;
    const focusLabel = t("SMOOTHER_FIGHT.HUD.FocusCombatant");
    const visibilityHidden = Boolean(context.combatant.hidden || context.token?.hidden);
    const visibilityLabel = t(visibilityHidden ? "SMOOTHER_FIGHT.HUD.ShowTokenAndCombatant" : "SMOOTHER_FIGHT.HUD.HideTokenAndCombatant");
    const defeatedLabel = t(context.combatant.isDefeated ? "SMOOTHER_FIGHT.HUD.RestoreCombatant" : "SMOOTHER_FIGHT.HUD.MarkDefeated");
    const removeLabel = t("SMOOTHER_FIGHT.HUD.RemoveCombatant");
    const gmControls = game.user.isGM ? `
        <button type="button" data-sf-action="toggle-combatant-visibility" class="sf-icon-button ${visibilityHidden ? "is-active" : ""}" title="${escapeAttr(visibilityLabel)}"><i class="fa-solid ${visibilityHidden ? "fa-eye" : "fa-eye-slash"}"></i><span class="sf-control-label">${escapeHtml(visibilityLabel)}</span></button>
        <button type="button" data-sf-action="toggle-combatant-defeated" class="sf-icon-button ${context.combatant.isDefeated ? "is-active" : ""}" title="${escapeAttr(defeatedLabel)}"><i class="fa-solid fa-skull"></i><span class="sf-control-label">${escapeHtml(defeatedLabel)}</span></button>
        <button type="button" data-sf-action="remove-combatant" class="sf-icon-button is-danger" title="${escapeAttr(removeLabel)}"><i class="fa-solid fa-circle-minus"></i><span class="sf-control-label">${escapeHtml(removeLabel)}</span></button>
    ` : "";

    return `<section class="sf-combat-controls" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.HUD.CombatControls"))}">
        <div class="sf-tick-buttons"><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Advance"))}</span>${tickButtons}<button type="button" data-sf-action="add-ticks" data-ticks="custom" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.CustomTicks"))}">+X</button></div>
        <div class="sf-pause-buttons">${pauseButtons}</div>
        <div class="sf-tracker-buttons">
            <button type="button" data-sf-action="focus-combatant" class="sf-icon-button" title="${escapeAttr(focusLabel)}"><i class="fa-solid fa-bullseye"></i><span class="sf-control-label">${escapeHtml(focusLabel)}</span></button>
            ${gmControls}
        </div>
    </section>`;
}

async function buildActionBar(context) {
    const actor = context.actor;
    const preparedSpellId = actor.getFlag?.("splittermond", "preparedSpell");
    const preparedAttackId = actor.getFlag?.("splittermond", "preparedAttack");
    const skills = Object.values(actor.skills ?? {})
        .filter((skill) => numericValue(skill.points) > 0 || ["acrobatics", "athletics", "determination", "stealth", "perception", "endurance"].includes(skill.id))
        .sort((a, b) => displayLabel(a.label).localeCompare(displayLabel(b.label), game.i18n.lang));
    const spells = [...(actor.spells ?? [])].sort((a, b) =>
        Number(b.id === preparedSpellId) - Number(a.id === preparedSpellId) || sortByName(a, b)
    );
    const preparedSpell = spells.find((spell) => spell.id === preparedSpellId) ?? null;
    const availableSpells = spells.filter((spell) => spell.enoughFocus !== false).length;
    const spellLabel = `${t("SMOOTHER_FIGHT.HUD.Spells")} (${availableSpells})`;
    const attacks = [...(actor.attacks ?? [])].sort((a, b) =>
        Number(b.id === preparedAttackId || b.isPrepared) - Number(a.id === preparedAttackId || a.isPrepared) || sortByName(a, b)
    );
    const preparedAttack = attacks.find((attack) => attack.id === preparedAttackId || attack.isPrepared) ?? null;
    const attackSpeeds = new Map(await Promise.all(attacks.map(async (attack) => [attack.id, await getAttackSpeed(attack)])));
    const equipment = Array.from(actor.items ?? []).filter((item) => ["weapon", "shield"].includes(item.type)).sort(sortByName);

    return `<nav class="sf-actions" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.Title"))}">
        ${actionMenu("fa-solid fa-dice-d20", t("SMOOTHER_FIGHT.HUD.Skills"), skills.map((skill) => `
            <button type="button" data-sf-action="skill" data-skill-id="${escapeAttr(skill.id)}">
                <span>${escapeHtml(displayLabel(skill.label, skill.id))}</span><b>${escapeHtml(displayValue(skill.value))}</b>
            </button>`).join(""))}
        ${preparedAttack ? preparedAttackMenu(preparedAttack) : actionMenu("fa-solid fa-hand-fist", t("SMOOTHER_FIGHT.HUD.Attacks"), `
            ${attacks.map((attack) => `<button type="button" data-sf-action="attack" data-attack-id="${escapeAttr(attack.id)}" class="${attack.isPrepared ? "is-prepared" : ""}" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.OpenItemHint"))}">
                <img src="${escapeAttr(attack.img)}" alt=""><span>${escapeHtml(attack.name)}<small>${escapeHtml([displayLabel(attack.skill?.label), displayValue(attack.skill?.value, "")].filter((value) => value !== "").join(" "))}</small></span>
                <b>${escapeHtml(attack.isPrepared ? (displayValue(attack.damage, "–")) : `${attackSpeeds.get(attack.id) ?? "–"} T`)}</b>
            </button>`).join("") || emptyMenuText()}
            ${equipment.length ? `<h4>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Equip"))}</h4>${equipment.map((item) => `<button type="button" data-sf-action="toggle-equipped" data-item-id="${escapeAttr(item.id)}" class="${item.system?.equipped ? "is-equipped" : "is-unequipped"}" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.OpenItemHint"))}">
                <img src="${escapeAttr(item.img)}" alt=""><span>${escapeHtml(item.name)}</span><i class="fa-solid ${item.system?.equipped ? "fa-toggle-on" : "fa-toggle-off"}"></i>
            </button>`).join("")}` : ""}
        `)}
        ${preparedSpell ? preparedSpellMenu(preparedSpell, availableSpells) : actionMenu("fa-solid fa-wand-sparkles", spellLabel, spells.map((spell) => {
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
        <summary><i class="${icon}"></i><span>${escapeHtml(label)}</span><i class="fa-solid fa-chevron-down sf-chevron"></i></summary>
        <div class="sf-action-popover">${body}</div>
    </details>`;
}

function preparedSpellMenu(spell, availableSpells) {
    const cast = t("SMOOTHER_FIGHT.HUD.Cast");
    const cancel = t("SMOOTHER_FIGHT.HUD.CancelSpell");
    return `<div class="sf-action-menu sf-prepared-spell-menu">
        <button type="button" class="sf-prepared-spell-cast sf-spell-action" data-sf-action="cast-prepared-spell" data-spell-id="${escapeAttr(spell.id)}" aria-label="${escapeAttr(`${spell.name}: ${cast}`)}">
            <img src="${escapeAttr(spell.img ?? "icons/svg/daze.svg")}" alt="">
            <span><small>${escapeHtml(`${t("SMOOTHER_FIGHT.HUD.Spells")} (${availableSpells}) · ${t("SMOOTHER_FIGHT.HUD.PreparedSpell")}`)}</small><strong>${escapeHtml(spell.name)}</strong></span>
            <b><i class="fa-solid fa-wand-sparkles"></i><span>${escapeHtml(cast)}</span></b>
        </button>
        <button type="button" class="sf-prepared-spell-cancel" data-sf-action="cancel-prepared-spell" title="${escapeAttr(cancel)}" aria-label="${escapeAttr(cancel)}"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
}

function preparedAttackMenu(attack) {
    const release = t("SMOOTHER_FIGHT.HUD.ReleaseAttack");
    const cancel = t("SMOOTHER_FIGHT.HUD.CancelAttack");
    return `<div class="sf-action-menu sf-prepared-spell-menu sf-prepared-attack-menu">
        <button type="button" class="sf-prepared-spell-cast sf-prepared-attack-release" data-sf-action="attack" data-attack-id="${escapeAttr(attack.id)}" aria-label="${escapeAttr(`${attack.name}: ${release}`)}">
            <img src="${escapeAttr(attack.img ?? "icons/svg/sword.svg")}" alt="">
            <span><small>${escapeHtml(t("SMOOTHER_FIGHT.HUD.PreparedAttack"))}</small><strong>${escapeHtml(attack.name)}</strong></span>
            <b><i class="fa-solid fa-crosshairs"></i><span>${escapeHtml(release)}</span></b>
        </button>
        <button type="button" class="sf-prepared-spell-cancel" data-sf-action="cancel-prepared-attack" title="${escapeAttr(cancel)}" aria-label="${escapeAttr(cancel)}"><i class="fa-solid fa-xmark"></i></button>
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
            <i class="fa-solid fa-chevron-down sf-events-chevron"></i>
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
    const eventActorId = primary.speaker?.actor ?? "";
    return `<details class="sf-event-group ${defenseAlert ? "is-defense-alert" : ""}" data-event-id="${escapeAttr(primary.id)}" data-event-combatant-id="${escapeAttr(context?.combatantId ?? "")}" data-event-actor-id="${escapeAttr(eventActorId)}" ${open}>
        <summary><span>${escapeHtml(primary.speaker?.alias ?? primary.author?.name ?? t(group.kind === "spell" ? "SMOOTHER_FIGHT.HUD.Spells" : "SMOOTHER_FIGHT.HUD.Attacks"))}</span>${badge}${defenseBadge}${targetBadge}<i class="fa-solid fa-chevron-down"></i></summary>
        <div class="sf-event-body">
            ${group.defenses.map((message) => buildAssociatedEvent(message, {
                kind: "defense",
                icon: "fa-shield",
                label: `${t("SMOOTHER_FIGHT.HUD.DefenseResult")} · ${message.speaker?.alias ?? message.author?.name ?? "–"}`,
                open: !hasDamage,
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
                label: getFumbleData(message)?.kind === "fight"
                    ? t("SMOOTHER_FIGHT.HUD.CombatFumble")
                    : t("SMOOTHER_FIGHT.HUD.MagicFumble"),
                open: index === group.fumbles.length - 1,
            })).join("")}
        </div>
    </details>`;
}

function buildAssociatedEvent(message, { kind, icon, label, open = false }) {
    return `<details class="sf-associated-card is-${escapeAttr(kind)}" data-subevent-id="${escapeAttr(message.id)}" data-subevent-kind="${escapeAttr(kind)}" data-subevent-actor-id="${escapeAttr(message.speaker?.actor ?? "")}" ${open ? "open" : ""}>
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
    if (Array.isArray(context?.targetNames) && context.targetNames.length) return context.targetNames.join(", ");
    const target = resolveMessageTarget(context);
    return context?.targetName ?? target?.token?.name ?? target?.actor?.name ?? "";
}

function shouldHighlightActiveDefense(group, isLatest, hudContext, messageContext) {
    if (!messageOffersActiveDefense(group.primary) && !messageContext?.recalculatedFrom) return false;
    if (messageContext?.supersededBy) return false;
    const storedTarget = resolveToken(messageContext?.targetTokenUuid);
    if (storedTarget) {
        const alreadyDefended = messageContext?.attemptedDefenseActorUuids?.includes?.(storedTarget.actor?.uuid);
        return !alreadyDefended && isCurrentUserTarget(storedTarget);
    }
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

function restoreHudViewState(root, state, { forceLatestEvent = false } = {}) {
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
        forceLatestEvent,
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
    if (isFumbleTableMessage(message)) {
        const fumble = getFumbleData(message) ?? createFumbleData(message, content);
        if (fumble) content = decorateFumbleCard(content, fumble);
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
                const defenseBadge = decorateDefenseValue(defenseValue, message, summary);
                if (defenseBadge) degrees.append(defenseBadge);
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
    const messageContext = getMessageContext(message);
    const targetName = getMessageTargetName(messageContext);
    if (!header || !targetName) return;

    const targetToken = resolveToken(messageContext?.targetTokenUuid);
    const label = t(targetToken ? "SMOOTHER_FIGHT.HUD.ShowEventTarget" : "SMOOTHER_FIGHT.HUD.EventTarget", { target: targetName });
    const target = document.createElement(targetToken ? "button" : "div");
    target.className = "sf-offense-target";
    target.title = label;
    target.setAttribute("aria-label", label);
    if (targetToken) {
        target.type = "button";
        target.dataset.sfAction = "show-token";
        target.dataset.tokenUuid = targetToken.uuid;
    }
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

function decorateDefenseValue(element, message, summary) {
    const parsed = parseActiveDefenseDescription(element.textContent);
    if (!parsed.defenseLabel || !Number.isFinite(parsed.defenseValue)) return null;

    const badge = document.createElement("div");
    badge.className = "sf-defense-value";
    const label = document.createElement("span");
    label.textContent = parsed.defenseLabel;
    const value = document.createElement("strong");
    value.textContent = String(parsed.defenseValue);
    badge.append(label, value);

    removeLeadingText(element, parsed.defensePrefixLength);
    if (!String(element.textContent ?? "").trim()) {
        element.remove();
        return badge;
    }

    element.classList.add("sf-defense-consequences");
    if (parsed.numbingDamage > 0) addDefenseNumbingDamageAction(element, message, parsed.numbingDamage);
    summary.after(element);
    return badge;
}

function removeLeadingText(element, length) {
    let remaining = Math.max(0, length);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && remaining > 0) {
        const take = Math.min(remaining, node.data.length);
        node.data = node.data.slice(take);
        remaining -= take;
        node = walker.nextNode();
    }
    element.normalize();
}

function addDefenseNumbingDamageAction(element, message, damage) {
    const actor = resolveSpeakerActor(message);
    const context = getMessageContext(message) ?? {};
    const allowed = Boolean(actor && (game.user.isGM || actor.isOwner));
    const applied = Boolean(context.numbingDamageApplied);
    const actions = document.createElement("div");
    actions.className = "sf-defense-consequence-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sf-defense-damage-action ${allowed ? "is-own-defense-damage" : ""} ${applied ? "is-applied" : ""}`.trim();
    button.dataset.sfDefenseNumbingDamage = String(damage);
    button.disabled = applied || !allowed;
    button.title = applied ? t("SMOOTHER_FIGHT.HUD.AlreadyApplied") : "";
    button.innerHTML = `<i class="fa-solid fa-heart-crack"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyDefenseNumbingDamage", {
        damage,
        name: actor?.name ?? message.speaker?.alias ?? "–",
    }))}`;
    actions.append(button);
    element.append(actions);
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
    const selected = new Set(context.targets.map((token) => token.uuid));
    const body = candidates.length
        ? candidates.map((token) => `<button type="button" data-sf-action="set-target" data-token-uuid="${escapeAttr(token.uuid)}" class="${selected.has(token.uuid) ? "is-current" : ""}" aria-pressed="${selected.has(token.uuid)}">
            <img src="${escapeAttr(token.texture?.src ?? token.actor?.img ?? "icons/svg/mystery-man.svg")}" alt=""><span>${escapeHtml(labels.get(token.uuid) ?? token.name)}</span>
            ${selected.has(token.uuid) ? '<i class="fa-solid fa-crosshairs"></i>' : ""}
        </button>`).join("")
        : `<p>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoCombatants"))}</p>`;
    const label = t("SMOOTHER_FIGHT.HUD.QuickTarget");
    return `<details class="sf-quick-targets">
        <summary title="${escapeAttr(label)}"><i class="fa-solid fa-crosshairs"></i><span>${escapeHtml(label)}</span><i class="fa-solid fa-chevron-down sf-chevron"></i></summary>
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
    if (!isCombatantVisibleToUser(game.user?.isGM, combatant.hidden)) return null;
    const linkedUser = getLinkedUser(combatant, actor);
    const targets = getTargetsForUser(linkedUser);
    const target = targets.at(-1) ?? null;
    return { combat, combatant, actor, token, linkedUser, target, targets };
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
    if (!token || !game.user) return false;
    const explicitOwnerId = getExplicitTokenOwnerId(token);
    if (explicitOwnerId) return explicitOwnerId === game.user.id;

    const actorLinks = normalizeActorUserLinks(getSetting("actorUserLinks", {}));
    const actorOwnerId = actorLinks[actorAssignmentUuid(token.actor, token.actorId)];
    if (actorOwnerId) return actorOwnerId === game.user.id;
    const primaryGmId = getSetting("primaryGmId", "");
    if (primaryGmId && game.user.isGM) return primaryGmId === game.user.id;
    if (game.user.isGM) return false;
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

function getTargetsForUser(user) {
    if (!user) return [];
    let uuids = normalizeTargetReferences(runtime.targetByUser.get(user.id));
    if (user.id === game.user.id) {
        uuids = normalizeTargetReferences(user.targets);
        runtime.targetByUser.set(user.id, uuids);
    }
    return uuids.map(resolveToken).filter((target) => target && (game.user.isGM || !target.hidden));
}

function getTargetForUser(user) {
    return getTargetsForUser(user).at(-1) ?? null;
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
        if (!isDamageMessage(message) && !isDefenseMessage(message) && !isFumbleTableMessage(message)) continue;
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
                (isFumbleTableMessage(message)
                    ? (fumble?.kind === "fight" ? candidate.kind === "attack" : candidate.kind === "spell")
                        && message.speaker?.actor === candidate.primary.speaker?.actor
                    : isDefenseMessage(message)
                    ? candidate.kind === "attack"
                    : message.speaker?.actor === candidate.primary.speaker?.actor)
            );
        }
        if (!group) continue;
        if (isFumbleTableMessage(message)) group.fumbles.push(message);
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
    const prepared = attack.isPrepared || context.actor.getFlag?.("splittermond", "preparedAttack") === attackId;
    if (prepared) {
        runtime.pendingOffenseKinds.set(context.actor.id, {
            kind: isRangedAttack(attack) ? "ranged" : "attack",
            expiresAt: Date.now() + 60_000,
        });
        try {
            const success = await context.actor.rollAttack(attackId);
            if (success) await context.actor.setFlag("splittermond", "preparedAttack", null);
        } catch (error) {
            runtime.pendingOffenseKinds.delete(context.actor.id);
            throw error;
        }
    } else {
        await context.actor.addTicks(await getAttackSpeed(attack), `${localizeSystem("splittermond.attack", "Angriff")}: ${attack.name}`);
        await context.actor.setFlag("splittermond", "preparedAttack", attackId);
    }
    scheduleRender();
}

async function cancelPreparedAttack(context) {
    await context.actor.setFlag("splittermond", "preparedAttack", null);
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.AttackCancelled"));
    scheduleRender(0);
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
    const hud = document.querySelector(`#${MODULE_ID}-hud:not(.is-hidden)`);
    const hudTop = hud?.getBoundingClientRect?.().top;
    const viewportCenter = (document.documentElement.clientHeight || window.innerHeight) / 2;
    const desiredScreenY = Number.isFinite(hudTop)
        ? Math.min(viewportCenter, Math.max(90, hudTop - 90))
        : viewportCenter;
    const scale = Math.max(Number(canvas.stage?.scale?.y) || 1, 0.1);
    const yOffset = Math.max(0, viewportCenter - desiredScreenY) / scale;
    const animation = canvas.animatePan({
        x,
        y: y + yOffset,
        scale: Math.max(canvas.stage.scale.x, canvas.dimensions.scale.default),
    });
    canvas.ping?.(object.center);
    return animation;
}

async function toggleCombatantVisibility(context) {
    const hidden = Boolean(context.combatant.hidden || context.token?.hidden);
    const nextHidden = !hidden;
    const updates = [context.combatant.update({ hidden: nextHidden })];
    if (context.token?.update) updates.push(context.token.update({ hidden: nextHidden }));
    await Promise.all(updates);
    scheduleRender(0);
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
    const current = new Set(context.targets.map((candidate) => candidate.uuid));
    const targeted = !current.has(token.uuid);
    if (targeted) current.add(token.uuid);
    else current.delete(token.uuid);
    const targetUuids = Array.from(current);
    runtime.targetByUser.set(recipient.id, targetUuids);

    if (recipient.id === game.user.id) {
        setLocalTarget(token, targeted, false);
        publishOwnTarget();
    } else {
        game.socket.emit(SOCKET, {
            type: "set-target",
            senderId: game.user.id,
            recipientId: recipient.id,
            tokenUuid: token.uuid,
            targeted,
            releaseOthers: false,
        });
        game.socket.emit(SOCKET, {
            type: "target-update",
            senderId: game.user.id,
            userId: recipient.id,
            tokenUuids: targetUuids,
        });
    }
    ui.notifications.info(t(targeted ? "SMOOTHER_FIGHT.HUD.TargetAdded" : "SMOOTHER_FIGHT.HUD.TargetRemoved", { target: token.name }));
    scheduleRender();
}

function setLocalTarget(tokenDocument, targeted = true, releaseOthers = false) {
    const tokenObject = tokenDocument.object ?? canvas?.tokens?.get(tokenDocument.id);
    tokenObject?.setTarget(targeted, { user: game.user, releaseOthers, groupSelection: false });
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

function publishOwnTarget(explicitUuids) {
    if (!game.user) return;
    const targetUuids = normalizeTargetReferences(explicitUuids === undefined ? game.user.targets : explicitUuids);
    runtime.targetByUser.set(game.user.id, targetUuids);
    game.socket?.emit(SOCKET, {
        type: "target-update",
        senderId: game.user.id,
        userId: game.user.id,
        targetUuids,
        tokenUuid: targetUuids.at(-1) ?? null,
    });
}

async function onCreateChatMessage(message) {
    try {
        await waitForDiceSoNice(message);
        if (isOffensiveCombatMessage(message)) await attachCombatContext(message);
        if (isFumbleTableMessage(message)) await attachFumbleActions(message);
        if (isDefenseMessage(message)) await processDefenseMessage(message);
        announceMessageFeedback(message);
    } catch (error) {
        console.error(`${MODULE_ID} | Failed to process chat message`, error);
    }
}

function announceMessageFeedback(message) {
    if (!message?.id || runtime.heardMessageIds.has(message.id)) return;
    let kind = null;
    if (isDefenseMessage(message)) kind = "defense";
    else if (isDamageMessage(message)) kind = "damage";
    else if (isSpellMessage(message)) kind = "spell";
    else if (combatMessageKind(message) === "attack") {
        const contextKind = getMessageContext(message)?.actionKind;
        if (contextKind === "ranged" || isRangedAttackMessage(message)) kind = "ranged";
    }
    if (!kind) return;

    runtime.heardMessageIds.add(message.id);
    const messageContext = getMessageContext(message);
    const speakerActor = resolveSpeakerActor(message);
    const damageTarget = kind === "damage" ? resolveDamageApplicationTarget(message) : null;
    const tokenUuid = kind === "damage"
        ? messageContext?.targetTokenUuid ?? damageTarget?.uuid ?? null
        : speakerTokenUuid(message) ?? messageContext?.defenderTokenUuid ?? messageContext?.attackerTokenUuid ?? null;
    triggerFeedback(kind, { tokenUuid, actorUuid: damageTarget?.actor?.uuid ?? speakerActor?.uuid ?? null });
}

function announceTurnFeedback(combat) {
    const combatant = combat?.combatant ?? null;
    const combatantId = combatant?.id ?? null;
    if (!combatantId || combatantId === runtime.lastTurnCombatantId) return;
    runtime.lastTurnCombatantId = combatantId;
    const actor = combatant.actor;
    const token = combatant.token ?? resolveCombatantToken(combatant);
    if (!actor || !isCombatantVisibleToUser(game.user?.isGM, combatant.hidden)) return;
    const linkedUser = getLinkedUser(combatant, actor);
    const ownTurn = linkedUser?.id === game.user?.id
        || (!linkedUser && Boolean(actor.testUserPermission?.(game.user, "OWNER")));
    if (ownTurn) triggerFeedback("turn", { tokenUuid: token?.uuid ?? null, actorUuid: actor.uuid });
}

function triggerFeedback(kind, { tokenUuid = null, actorUuid = null } = {}) {
    runtime.feedback = { kind, tokenUuid, actorUuid, id: foundry?.utils?.randomID?.() ?? `${Date.now()}` };
    clearTimeout(runtime.feedbackTimer);
    runtime.feedbackTimer = setTimeout(() => {
        runtime.feedback = null;
        scheduleRender(0);
    }, 1400);
    playFeedbackTone(kind);
    scheduleRender(0);
}

function feedbackMarkup(token, actor) {
    const feedback = runtime.feedback;
    if (!feedback) return "";
    const matches = (feedback.tokenUuid && feedback.tokenUuid === token?.uuid)
        || (feedback.actorUuid && feedback.actorUuid === actor?.uuid);
    if (!matches) return "";
    const icons = {
        defense: "fa-shield-halved",
        damage: "fa-droplet",
        spell: "fa-wand-sparkles",
        ranged: "fa-crosshairs",
        turn: "fa-bolt",
    };
    return `<span class="sf-action-feedback is-${escapeAttr(feedback.kind)}"><i class="fa-solid ${icons[feedback.kind] ?? "fa-burst"}"></i></span>`;
}

function unlockFeedbackAudio() {
    if (!getSetting("audioFeedback", true)) return;
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContext) return;
    runtime.audioContext ??= new AudioContext();
    void runtime.audioContext.resume?.();
}

function playFeedbackTone(kind) {
    if (!getSetting("audioFeedback", true)) return;
    unlockFeedbackAudio();
    const audio = runtime.audioContext;
    if (!audio || audio.state !== "running") return;
    const patterns = {
        defense: [[330, 0], [494, 0.08], [659, 0.16]],
        damage: [[180, 0], [125, 0.1]],
        spell: [[523, 0], [659, 0.07], [784, 0.14]],
        ranged: [[880, 0], [440, 0.06]],
        turn: [[440, 0], [660, 0.11], [880, 0.22]],
    };
    const notes = patterns[kind] ?? [];
    const now = audio.currentTime;
    for (const [frequency, delay] of notes) {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = kind === "damage" ? "triangle" : "sine";
        oscillator.frequency.setValueAtTime(frequency, now + delay);
        gain.gain.setValueAtTime(0.0001, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.055, now + delay + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.18);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(now + delay);
        oscillator.stop(now + delay + 0.2);
    }
}

async function onUpdateChatMessage(message, changes) {
    if ((!hasSplittermondCheckUpdate(changes) && !hasDefenseContextUpdate(changes)) || !isDefenseMessage(message)) return;
    try {
        const author = message.author ?? game.users.get(message.user?.id ?? message.user);
        const pending = normalizePendingDefense(getMessageContext(message));
        const processForAuthor = Boolean(
            game.user.isGM
            && !isOwnMessage(message)
            && author
            && pending
            && canUserSubmitDefense(author, pending, message)
        );
        await processDefenseMessage(
            message,
            processForAuthor ? pending : null,
            { allowForeign: processForAuthor }
        );
        announceMessageFeedback(message);
    } catch (error) {
        console.error(`${MODULE_ID} | Failed to process updated defense message`, error);
    }
}

function hasDefenseContextUpdate(changes) {
    if (!changes || typeof changes !== "object") return false;
    const contextPath = `flags.${MODULE_ID}.context`;
    return Object.keys(changes).some((key) => key === contextPath || key.startsWith(`${contextPath}.`))
        || Boolean(changes.flags?.[MODULE_ID]?.context);
}

async function waitForChatMessage(messageId, attempts = 12) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const message = game.messages.get(messageId);
        if (message) return message;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
}

async function waitForDefenseProcessing(messageId, attempts = 20) {
    for (let attempt = 0; attempt < attempts && runtime.processingDefenseMessages.has(messageId); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
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
    const targets = getTargetsForUser(linkedUser);
    const target = targets.at(-1) ?? null;
    const pendingKind = runtime.pendingOffenseKinds.get(actor?.id);
    if (pendingKind && pendingKind.expiresAt < Date.now()) runtime.pendingOffenseKinds.delete(actor.id);
    const context = {
        combatId: combat?.id ?? null,
        combatantId: speakerCombatant?.id ?? null,
        attackerTokenUuid: speakerCombatant?.token?.uuid ?? speakerTokenUuid(message),
        attackerActorUuid: actor?.uuid ?? null,
        targetTokenUuid: target?.uuid ?? null,
        targetActorUuid: target?.actor?.uuid ?? null,
        targetName: target?.name ?? target?.actor?.name ?? null,
        targetTokenUuids: targets.map((candidate) => candidate.uuid),
        targetActorUuids: targets.map((candidate) => candidate.actor?.uuid).filter(Boolean),
        targetNames: targets.map((candidate) => candidate.name ?? candidate.actor?.name).filter(Boolean),
        actionKind: pendingKind?.expiresAt >= Date.now() ? pendingKind.kind : null,
        linkedUserId: linkedUser?.id ?? game.user.id,
        createdAt: Date.now(),
    };
    if (pendingKind) runtime.pendingOffenseKinds.delete(actor?.id);
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
    if (isFumbleTableMessage(message) && !getFumbleData(message)) void attachFumbleActions(message, html);
    if (!mayControlSpeakerActor(message)) {
        removeOutgoingDamageControls(html);
        html.querySelectorAll(".splittermond-chat-action-container:not(:has(.splittermond-chat-action))").forEach((container) => container.remove());
    }
    captureSystemActiveDefense(message, html);
    bindFumbleActions(message, html);
}

async function attachFumbleActions(message, renderedRoot = null, sourceMessageId = null, sourceItemId = null) {
    const existing = getFumbleData(message);
    if (!(game.user.isGM || isOwnMessage(message)) || (existing && !sourceMessageId && !sourceItemId)) return;
    const renderedContent = renderedRoot
        ? (renderedRoot.matches?.(".message-content") ? renderedRoot : renderedRoot.querySelector?.(".message-content"))
        : null;
    const baseFumble = existing ?? createFumbleData(message, renderedContent ?? message.content);
    if (!baseFumble) return;
    const fumble = {
        ...baseFumble,
        sourceMessageId: sourceMessageId ?? baseFumble.sourceMessageId ?? null,
        sourceItemId: sourceItemId ?? baseFumble.sourceItemId ?? null,
    };
    const content = decorateFumbleCard(renderedContent?.innerHTML ?? message.content, fumble);
    if (renderedContent) renderedContent.innerHTML = content;
    await message.update({ content, [`flags.${MODULE_ID}.fumble`]: fumble });
}

function createFumbleData(message, contentOrRoot = message.content) {
    const kind = fumbleTableKind(message);
    if (!kind) return null;
    const extracted = extractFumbleEffects(contentOrRoot);
    const actor = resolveSpeakerActor(message);
    const sourceMessage = findFumbleSourceMessage(message, kind);
    const sourceContext = getMessageContext(sourceMessage);
    return {
        kind,
        actorUuid: actor?.uuid ?? null,
        actorName: actor?.name ?? message.speaker?.alias ?? "",
        sourceMessageId: sourceContext?.attackMessageId ?? sourceMessage?.id ?? null,
        sourceItemId: resolveFumbleSourceItemId(sourceMessage),
        damage: extracted.damage,
        ticks: extracted.ticks,
        tickMessage: extracted.tickMessage,
        damagesWeapon: extracted.damagesWeapon,
        conditions: extracted.conditions,
        conditionMode: extracted.conditionMode,
        damageApplied: false,
        ticksApplied: false,
        weaponDamageApplied: false,
        conditionsApplied: false,
    };
}

function resolveFumbleSourceItemId(message) {
    if (!message) return null;
    const actor = resolveSpeakerActor(message);
    const itemData = getDefenseCheck(message)?.itemData
        ?? message.system?.checkReport?.itemData
        ?? message.system?.itemData;
    const ids = [itemData?.id, itemData?._id, itemData?.item?.id, itemData?.item?._id].filter(Boolean);
    const direct = ids.map((id) => actor?.items?.get?.(id)).find(Boolean);
    if (direct) return direct.id;
    const name = String(itemData?.name ?? itemData?.item?.name ?? "").trim();
    return Array.from(actor?.items ?? []).find((item) =>
        ["weapon", "shield"].includes(item.type) && item.name === name
    )?.id ?? null;
}

function findFumbleSourceMessage(message, kind) {
    return [...Array.from(game.messages?.contents ?? [])].reverse().find((candidate) => {
        if (candidate.id === message.id || isFumbleTableMessage(candidate)) return false;
        if (candidate.speaker?.actor !== message.speaker?.actor) return false;
        if (Number(candidate.timestamp) > Number(message.timestamp)) return false;
        if (kind === "magic") return isSpellMessage(candidate);
        if (isDefenseMessage(candidate)) {
            const check = getDefenseCheck(candidate);
            return Boolean(check?.isFumble || String(candidate.content ?? "").includes("attackFumble"));
        }
        return isOffensiveCombatMessage(candidate) && Boolean(candidate.system?.checkReport?.isFumble);
    }) ?? null;
}

function extractFumbleEffects(contentOrRoot) {
    let root = contentOrRoot;
    if (typeof contentOrRoot === "string") {
        const template = document.createElement("template");
        template.innerHTML = contentOrRoot;
        root = template.content;
    }
    const active = root?.querySelector?.(".fumble-table-result-item-active");
    if (!active) return { damage: 0, ticks: 0, tickMessage: "", damagesWeapon: false, conditions: [], conditionMode: "all" };
    const inlineRoll = active.querySelector(".inline-roll, [data-roll]");
    const damageMatch = inlineRoll?.textContent?.trim().match(/-?\d+/u);
    const damage = Math.max(0, Number.parseInt(damageMatch?.[0] ?? "0", 10) || 0);
    const tickLink = active.querySelector(".add-tick[data-ticks]");
    const tickDirective = String(active.innerHTML ?? "").match(/@Ticks\[\s*(\d+)\s*Ticks?(?:\s*,\s*([^\]]+))?\]/iu);
    const ticks = Math.max(0, Number.parseInt(tickLink?.dataset?.ticks ?? tickDirective?.[1] ?? "0", 10) || 0);
    const tickMessage = String(tickLink?.dataset?.message ?? tickDirective?.[2] ?? "").trim();
    const conditions = [];
    for (const link of active.querySelectorAll("a[data-uuid], a[data-pack], a.content-link")) {
        const pack = link.dataset.pack ?? "";
        const uuid = link.dataset.uuid ?? (pack && link.dataset.id ? `Compendium.${pack}.Item.${link.dataset.id}` : "");
        if (!uuid.includes("splittermond.statuseffects") && !pack.includes("splittermond.statuseffects")) continue;
        const parsed = parseStatusEffectLabel(link.textContent);
        if (!parsed.name) continue;
        conditions.push({ uuid: uuid || null, name: parsed.name, level: parsed.level });
    }
    const activeText = String(active.textContent ?? "");
    const damagesWeapon = /\b(?:beschädigte\s+Waffe|damaged\s+weapon)\b/iu.test(activeText);
    if (/\b(?:liegend|prone)\b/iu.test(activeText)
        && !conditions.some((condition) => /^(?:liegend|prone)$/iu.test(condition.name))) {
        conditions.push({
            uuid: null,
            name: String(game.i18n.lang ?? "").toLocaleLowerCase().startsWith("de") ? "Liegend" : "Prone",
            level: 1,
        });
    }
    const conditionMode = /\b(?:oder|or)\b/iu.test(active.textContent ?? "") ? "choose" : "all";
    return { damage, ticks, tickMessage, damagesWeapon, conditions, conditionMode };
}

function decorateFumbleCard(content, fumble) {
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
        ${fumble.ticks ? `<button type="button" data-sf-fumble-action="ticks"><i class="fa-solid fa-stopwatch"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumbleTicks", { ticks: fumble.ticks }))}</button>` : ""}
        ${fumble.damagesWeapon && fumble.sourceItemId ? `<button type="button" data-sf-fumble-action="weapon"><i class="fa-solid fa-hammer"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumbleWeaponDamage"))}</button>` : ""}
        ${fumble.damage ? `<button type="button" data-sf-fumble-action="damage"><i class="fa-solid fa-heart-crack"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.ApplyFumbleDamage", { damage: fumble.damage }))}</button>` : ""}
        ${conditionActions}
    </div>`;
    table.insertAdjacentHTML("afterend", actions);
    const wrapper = document.createElement("div");
    wrapper.append(template.content.cloneNode(true));
    return wrapper.innerHTML;
}

function bindFumbleActions(message, html) {
    applyFumbleActionState(message, html);
    for (const button of html.querySelectorAll("[data-sf-fumble-action]")) {
        if (button.dataset.smootherFightBound) continue;
        button.dataset.smootherFightBound = "true";
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await handleFumbleAction(message, button.dataset.sfFumbleAction);
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
    const fumble = getFumbleData(message) ?? createFumbleData(message);
    if (!fumble) return;
    const actor = resolveFumbleActor(message, fumble);
    const allowed = Boolean(game.user.isGM || actor?.isOwner);
    for (const button of root.querySelectorAll("[data-sf-fumble-action]")) {
        const action = button.dataset.sfFumbleAction;
        const applied = action === "damage"
            ? fumble.damageApplied
            : action === "ticks"
                ? fumble.ticksApplied
                : action === "weapon"
                    ? fumble.weaponDamageApplied
                : fumble.conditionsApplied;
        button.disabled = applied || !allowed;
        button.classList.toggle("is-applied", Boolean(applied));
        if (applied) button.title = t("SMOOTHER_FIGHT.HUD.AlreadyApplied");
    }
}

async function handleFumbleAction(message, action) {
    const fumble = getFumbleData(message) ?? createFumbleData(message);
    if (!fumble) return;
    const actor = resolveFumbleActor(message, fumble);
    if (!actor || !(game.user.isGM || actor.isOwner)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.FumbleNotAllowed"));
        return;
    }
    const updated = { ...fumble };
    const fumbleLabel = updated.kind === "fight"
        ? t("SMOOTHER_FIGHT.HUD.CombatFumble")
        : t("SMOOTHER_FIGHT.HUD.MagicFumble");
    if (action === "ticks" && !updated.ticksApplied && updated.ticks > 0) {
        await actor.addTicks(updated.ticks, updated.tickMessage || fumbleLabel, false);
        updated.ticksApplied = true;
        ui.notifications.info(t("SMOOTHER_FIGHT.HUD.FumbleTicksApplied", { ticks: updated.ticks, name: actor.name }));
    }
    if (action === "weapon" && !updated.weaponDamageApplied && updated.sourceItemId) {
        const item = actor.items?.get?.(updated.sourceItemId);
        if (!item || !["weapon", "shield"].includes(item.type)) throw new Error("Fumble weapon could not be resolved");
        const currentDamageLevel = Math.max(0, numericValue(item.system?.damageLevel));
        const nextDamageLevel = Math.min(2, currentDamageLevel + 1);
        await item.update({ "system.damageLevel": nextDamageLevel });
        updated.weaponDamageApplied = true;
        ui.notifications.info(t("SMOOTHER_FIGHT.HUD.FumbleWeaponDamageApplied", { item: item.name }));
    }
    if (action === "damage" && !updated.damageApplied && updated.damage > 0) {
        await actor.consumeCost("health", fullyConsumedCost(updated.damage), fumbleLabel);
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

function isFumbleTableMessage(message) {
    const content = String(message?.content ?? "");
    return content.includes("fumble-table-result");
}

function fumbleTableKind(message) {
    if (!isFumbleTableMessage(message)) return null;
    const content = String(message?.content ?? "");
    const attackLabel = localizeSystem("splittermond.attackFumble", "Kampfpatzer");
    if (content.includes(attackLabel)) return "fight";
    const formula = String(message?.rolls?.[0]?.formula ?? "");
    const labels = [
        localizeSystem("splittermond.magicFumbleSorcerer", "Zauberpatzer (Zauberer)"),
        localizeSystem("splittermond.magicFumblePriest", "Zauberpatzer (Priester)"),
        localizeSystem("splittermond.focusCosts", "Fokuskosten"),
    ];
    return labels.some((label) => content.includes(label) || formula.includes(label)) ? "magic" : "fight";
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
        defenseId: options.defense?.id ?? null,
        defenseSkillId: options.defense?.skill?.id ?? null,
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
        defenseId: typeof value.defenseId === "string" ? value.defenseId : null,
        defenseSkillId: typeof value.defenseSkillId === "string" ? value.defenseSkillId : null,
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
    requestLatestEventForDefense(pending);

    const existingDefenseContext = getMessageContext(message) ?? {};
    const contentTemplate = document.createElement("template");
    contentTemplate.innerHTML = message.content ?? "";
    const defensePresentation = parseActiveDefenseDescription(contentTemplate.content.textContent);
    const numbingDamage = defensePresentation.numbingDamage;
    await safeSetFlag(message, "context", {
        ...existingDefenseContext,
        attackMessageId: pending.attackMessageId,
        targetTokenUuid: pending.targetTokenUuid,
        targetActorUuid: pending.targetActorUuid,
        defenderTokenUuid: pending.defenderTokenUuid,
        defenderActorUuid: pending.defenderActorUuid,
        defenseId: pending.defenseId,
        defenseSkillId: pending.defenseSkillId,
        assisted: pending.assisted,
        numbingDamage: existingDefenseContext.numbingDamage ?? (numbingDamage || null),
        numbingDamageApplied: Boolean(existingDefenseContext.numbingDamageApplied),
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

    if (!activeDefenseChangesDifficulty(check, defensePresentation.defenseValue)) {
        await recordDefenseAttempt(pending.attackMessageId, message, pending);
        runtime.pendingDefense = null;
        scheduleRender(0);
        return;
    }

    const newOffense = await recreateOffenseAfterDefense(
        pending.attackMessageId,
        message,
        check,
        defensePresentation.defenseValue
    );
    runtime.pendingDefense = null;
    if (newOffense) scheduleRender(0);
}

function requestLatestEventForDefense(pending) {
    const offense = game.messages.get(pending?.attackMessageId);
    const combatant = game.combat?.combatant;
    if (!offense || !combatant || !messageBelongsToCombatant(offense, combatant)) return;
    runtime.eventExpansionRequest = "latest";
    scheduleRender(0);
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

async function recreateOffenseAfterDefense(offenseMessageId, defenseMessage, defenseCheck, displayedDefenseValue = null) {
    const original = game.messages.get(offenseMessageId);
    if (!original || !isOffensiveCombatMessage(original)) return null;

    const featureValue = findDefensiveFeatureValue(defenseCheck.itemData);
    const originalContext = getMessageContext(original) ?? {};
    if (originalContext.supersededBy) return game.messages.get(originalContext.supersededBy) ?? null;
    const target = resolveToken(originalContext.targetTokenUuid);
    const calculatedBase = await target?.actor?.derivedValues?.[defenseCheck.defenseType]?.value?.calculate?.();
    const candidateDefense = displayedDefenseValue !== null && Number.isFinite(Number(displayedDefenseValue))
        ? Number(displayedDefenseValue)
        : calculateActiveDefenseValue({
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
    await safeSetFlag(defenseMessage, "context", {
        ...(getMessageContext(defenseMessage) ?? pending ?? {}),
        resultingDefenseValue: candidateDefense,
        defensiveFeatureValue: featureValue,
    });

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
    await safeSetFlag(original, "context", {
        ...getMessageContext(original),
        attemptedDefenseActorUuids,
        defenseMessageIds,
        supersededBy: created.id,
    });
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
    const defenseNumbingDamage = Number.parseInt(button.dataset.sfDefenseNumbingDamage ?? "", 10);
    if (Number.isFinite(defenseNumbingDamage) && defenseNumbingDamage > 0) {
        event.preventDefault();
        await applyDefenseNumbingDamage(message, defenseNumbingDamage);
        return;
    }
    const fumbleAction = button.dataset.sfFumbleAction;
    if (fumbleAction) {
        event.preventDefault();
        await handleFumbleAction(message, fumbleAction);
        return;
    }
    if (isCombatFumbleRollControl(button)) {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        try {
            await rollCombatFumble(message);
        } catch (error) {
            console.error(`${MODULE_ID} | Combat fumble roll failed`, error);
            ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
        } finally {
            if (button.isConnected) button.disabled = false;
        }
        return;
    }
    if (isLegacyTickAction(button)) {
        event.preventDefault();
        if (!mayManageMessageRoll(message)) {
            ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.NoOwner"));
            return;
        }
        try {
            await advanceLegacyChatTicks(message, button);
        } catch (error) {
            console.error(`${MODULE_ID} | Failed to advance legacy chat ticks`, error);
            ui.notifications.error(t("SMOOTHER_FIGHT.HUD.ActionFailed"));
        }
        return;
    }
    const localAction = button.dataset.localaction ?? button.dataset.localAction;
    const remoteAction = button.dataset.action;
    if (!localAction && !remoteAction) return;
    event.preventDefault();
    if (isRollManagementControl(button) && !mayManageMessageRoll(message)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.NoOwner"));
        return;
    }
    if (isOutgoingDamageControl(button) && !mayControlSpeakerActor(message)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DamageOwnerOnly"));
        return;
    }

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

async function applyDefenseNumbingDamage(message, fallbackDamage) {
    const actor = resolveSpeakerActor(message);
    if (!actor || !(game.user.isGM || actor.isOwner)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenseDamageNotAllowed"));
        return;
    }
    const context = getMessageContext(message) ?? {};
    if (context.numbingDamageApplied) return;
    const damage = Math.max(0, Number.parseInt(context.numbingDamage ?? fallbackDamage, 10) || 0);
    if (!damage) return;

    await actor.consumeCost("health", String(damage), t("SMOOTHER_FIGHT.HUD.DefenseNumbingDamageSource"));
    await safeSetFlag(message, "context", {
        ...context,
        numbingDamage: damage,
        numbingDamageApplied: true,
    });
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.DefenseNumbingDamageApplied", { damage, name: actor.name }));
    scheduleRender(0);
}

function isCombatFumbleRollControl(control) {
    const rollType = String(control?.dataset?.rollType ?? control?.dataset?.rolltype ?? "").toLocaleLowerCase();
    const action = String(control?.dataset?.localaction ?? control?.dataset?.localAction ?? "").toLocaleLowerCase();
    return rollType === "attackfumble" || action === "rollfumble";
}

async function rollCombatFumble(message) {
    const actor = resolveSpeakerActor(message);
    if (!actor || !(game.user.isGM || actor.testUserPermission?.(game.user, "OWNER") || actor.isOwner)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.FumbleNotAllowed"));
        return;
    }
    const sourceMessageId = getMessageContext(message)?.attackMessageId
        ?? (isOffensiveCombatMessage(message) ? message.id : null);
    const sourceItemId = resolveFumbleSourceItemId(message);
    const created = await actor.rollAttackFumble();
    if (created) await attachFumbleActions(created, null, sourceMessageId, sourceItemId);
    runtime.eventExpansionRequest = "latest";
    scheduleRender(0);
}

function isLegacyTickAction(control) {
    return Boolean(control?.matches?.(".add-tick[data-ticks]"));
}

async function advanceLegacyChatTicks(message, button) {
    const actor = resolveSpeakerActor(message);
    const ticks = Number(button.dataset.ticks);
    const mayAdvance = Boolean(game.user.isGM || actor?.testUserPermission?.(game.user, "OWNER") || actor?.isOwner);
    if (!actor || !Number.isFinite(ticks) || ticks < 1 || !mayAdvance) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.NoOwner"));
        return;
    }

    button.disabled = true;
    try {
        await actor.addTicks(ticks, button.dataset.message || undefined);
        scheduleRender(0);
    } finally {
        if (button.isConnected) button.disabled = false;
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
    if (!(game.user.isGM || target.actor?.testUserPermission?.(game.user, "OWNER"))) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DamageTargetNotOwned"));
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
    message = resolveLatestOffenseMessage(message);
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
    message = resolveLatestOffenseMessage(message);
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
    message = resolveLatestOffenseMessage(message);
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

    rememberPendingDefense(message, target, {
        defender: current.token,
        defense: current.defense,
        assisted: true,
    });
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
    if (!messageOffersActiveDefense(message) && !context?.recalculatedFrom) return [];
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

function resolveLatestOffenseMessage(message) {
    let current = message;
    const visited = new Set();
    while (current && !visited.has(current.id)) {
        visited.add(current.id);
        const nextId = getMessageContext(current)?.supersededBy;
        const next = nextId ? game.messages.get(nextId) : null;
        if (!next || !isOffensiveCombatMessage(next)) break;
        current = next;
    }
    return current;
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
    const offenseContext = getMessageContext(offense);
    const attempted = new Set(offenseContext?.attemptedDefenseActorUuids ?? []);
    if (!target?.actor || !defender?.actor || !check || target.actor.id === defender.actor.id) return false;
    if (offenseContext?.supersededBy) return false;
    if (pending.defenderActorUuid && pending.defenderActorUuid !== defender.actor.uuid) return false;
    if (message.speaker?.actor && message.speaker.actor !== defender.actor.id) return false;
    if (attempted.has(defender.actor.uuid) || !hasDefenderMastery(defender.actor)) return false;
    if (String(check.defenseType).toLocaleLowerCase() !== "defense") return false;
    if (check.itemData?.id === "acrobatics" || check.itemData?.skill?.id === "acrobatics") return false;
    const validOption = getCombatDefenseOptions(defender.actor, { requireDefenderMastery: true })
        .some((defense) => defenseMatchesPendingCheck(defense, pending, check.itemData));
    return validOption && measureTokenDistance(defender, target) <= 2;
}

function defenseMatchesPendingCheck(defense, pending, itemData) {
    if (!defense) return false;
    if (pending.defenseId && defense.id !== pending.defenseId) return false;
    if (pending.defenseSkillId && defense.skill?.id !== pending.defenseSkillId) return false;

    const submittedIds = new Set([
        itemData?.id,
        itemData?._id,
        itemData?.item?.id,
        itemData?.item?._id,
    ].filter(Boolean));
    if (submittedIds.has(defense.id)) return true;

    const submittedSkillId = itemData?.skill?.id ?? itemData?.skill?._id;
    const sameSkill = Boolean(submittedSkillId && submittedSkillId === defense.skill?.id);
    const submittedName = String(itemData?.name ?? itemData?.item?.name ?? "").trim();
    return sameSkill && Boolean(submittedName && submittedName === String(defense.name ?? "").trim());
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
        synchronizeRenderedTickAction(element, message);
        const mayManageRoll = mayManageMessageRoll(message);
        if (!mayManageRoll) removeRollManagementControls(element);
        if (!mayControlSpeakerActor(message)) removeOutgoingDamageControls(element);
        const renderedActions = getRenderedChatActionKeys(message.id);
        if (renderedActions) {
            for (const button of element.querySelectorAll(".splittermond-chat-action[data-action], .splittermond-chat-action[data-localaction], .splittermond-chat-action[data-local-action]")) {
                const key = chatActionKey(button);
                if (key && !renderedActions.has(key)) button.remove();
            }
        } else {
            if (!mayManageRoll) {
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
        decorateEventActionButtons(element, message);
        element.querySelectorAll(".splittermond-chat-action-container:not(:has(.splittermond-chat-action, .add-tick[data-ticks])), .sf-promoted-actions:not(:has(.splittermond-chat-action, .add-tick[data-ticks]))").forEach((container) => container.remove());
        element.querySelectorAll(".sf-promoted-degree-options:not(:has(.splittermond-chat-action))").forEach((container) => container.remove());
        element.querySelectorAll(".sf-promoted-controls:not(:has(.splittermond-chat-action, .add-tick[data-ticks]))").forEach((container) => container.remove());
    }
}

function synchronizeRenderedTickAction(element, message) {
    const existing = Array.from(element.querySelectorAll(".splittermond-chat-action, .add-tick[data-ticks]"))
        .some(isTickAdvanceControl);
    if (existing) return;
    const source = getRenderedChatActionElements(message.id)
        .find((button) => isTickAdvanceControl(button) && !button.disabled);
    if (!source) return;

    const card = element.querySelector(".splittermond.check, .splittermond.damage");
    if (!card) return;
    let controls = card.querySelector(":scope > .sf-promoted-controls");
    if (!controls) {
        controls = document.createElement("div");
        controls.className = "sf-promoted-controls";
        const header = card.querySelector(":scope > .chat-message-header, :scope > header");
        if (header) header.after(controls);
        else card.prepend(controls);
    }
    let actions = controls.querySelector(":scope > .sf-promoted-actions");
    if (!actions) {
        actions = document.createElement("div");
        actions.className = "actions splittermond-chat-action-container sf-promoted-actions";
        controls.prepend(actions);
    }
    actions.append(source.cloneNode(true));
}

function isTickAdvanceControl(control) {
    return isLegacyTickAction(control)
        || String(control?.dataset?.action ?? "").toLocaleLowerCase() === "advancetoken";
}

function decorateEventActionButtons(element, message) {
    const ownsSpeaker = isMessageSpeakerAssignedToCurrentUser(message);
    const groupHasDamage = Boolean(element.closest(".sf-event-group")?.querySelector(".sf-associated-card.is-damage"));
    for (const button of element.querySelectorAll(".splittermond-chat-action, .add-tick[data-ticks], .rollable[data-roll-type]")) {
        const action = String(button.dataset.action ?? button.dataset.localaction ?? button.dataset.localAction ?? "").toLocaleLowerCase();
        if (isTickAdvanceControl(button)) {
            button.classList.add("sf-tick-advance-action");
            if (isDefenseMessage(message) && ownsSpeaker) button.classList.add("is-own-defense-ticks");
            if (isDamageMessage(message) || (groupHasDamage && isOffensiveCombatMessage(message))) {
                button.classList.add("is-damage-ticks");
            }
        }
        if (isCombatFumbleRollControl(button) && ownsSpeaker) button.classList.add("is-own-fumble-roll");
        if (action === "applydamagetoself" || action === "applydamagetousertargets") {
            const target = resolveDamageApplicationTarget(message);
            if (target && isCurrentUserTarget(target)) button.classList.add("is-self-target");
        }
    }
}

function isMessageSpeakerAssignedToCurrentUser(message) {
    const token = resolveToken(speakerTokenUuid(message));
    if (token) return isCurrentUserTarget(token);
    const actor = resolveSpeakerActor(message);
    const combatant = Array.from(game.combat?.combatants ?? []).find((candidate) => candidate.actorId === actor?.id);
    if (combatant && actor) {
        const linkedUser = getLinkedUser(combatant, actor);
        if (linkedUser) return linkedUser.id === game.user?.id;
    }
    return Boolean(!game.user?.isGM && actor?.testUserPermission?.(game.user, "OWNER"));
}

function getRenderedChatActionElements(messageId) {
    return Array.from(document.querySelectorAll(".message[data-message-id]"))
        .filter((element) => element.dataset.messageId === messageId && !element.closest(`#${MODULE_ID}-hud`))
        .flatMap((element) => Array.from(element.querySelectorAll(".splittermond-chat-action, .add-tick[data-ticks]")));
}

function mayManageMessageRoll(message, user = game.user) {
    const speakerActor = resolveSpeakerActor(message);
    const ownsSpeakerActor = Boolean(speakerActor?.testUserPermission?.(user, "OWNER") ?? speakerActor?.isOwner);
    const authorId = message?.author?.id ?? message?.user?.id ?? message?.user;
    return mayUseRemoteChatActions(Boolean(user?.isGM), ownsSpeakerActor, authorId === user?.id);
}

function mayControlSpeakerActor(message, user = game.user) {
    if (user?.isGM) return true;
    const speakerActor = resolveSpeakerActor(message);
    return Boolean(speakerActor?.testUserPermission?.(user, "OWNER") ?? speakerActor?.isOwner);
}

function isOutgoingDamageControl(control) {
    const action = String(control?.dataset?.action ?? control?.dataset?.localaction ?? control?.dataset?.localAction ?? "")
        .trim();
    return isDamageSelectionAction(action);
}

function removeOutgoingDamageControls(element) {
    for (const control of element.querySelectorAll(".splittermond-chat-action")) {
        if (!isOutgoingDamageControl(control)) continue;
        (control.closest(".splittermond-inline-label-input") ?? control).remove();
    }
}

function isRollManagementControl(control) {
    const isDegreeOption = Boolean(
        control?.closest?.(".sf-promoted-degree-options")
        || control?.matches?.('input[type="checkbox"].splittermond-chat-action[data-action]')
    );
    const action = isLegacyTickAction(control) ? "addTick" : control?.dataset?.action;
    return requiresRollManagementPermission(action, isDegreeOption);
}

function removeRollManagementControls(element) {
    element.querySelectorAll([
        ".sf-promoted-degree-options",
        '.splittermond-chat-action[data-action="consumeCosts" i]',
        '.splittermond-chat-action[data-action="advanceToken" i]',
        '.splittermond-chat-action[data-action="useSplinterpoint" i]',
        ".add-tick[data-ticks]",
    ].join(", ")).forEach((control) => control.remove());
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
    const checkData = message?.getFlag?.("splittermond", "check") ?? message?.flags?.splittermond?.check ?? null;
    return mergeActiveDefenseCheck(checkData, message?.system?.checkReport);
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

function isCombatEventMessage(message) {
    return Boolean(
        isOffensiveCombatMessage(message)
        || isDefenseMessage(message)
        || isDamageMessage(message)
        || isFumbleTableMessage(message)
    );
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
    void setHudMinimized(!getSetting("minimized", false));
    return true;
}

async function setHudMinimized(minimized) {
    const hud = runtime.hud?.element;
    const shell = hud?.querySelector?.(".sf-shell");
    const previousBounds = shell?.getBoundingClientRect?.();
    await game.settings.set(MODULE_ID, "minimized", minimized);

    // The setting change schedules a regular render. Replace it with this immediate
    // render so it cannot swap out the shell while its transition is still running.
    clearTimeout(runtime.renderTimer);
    runtime.renderTimer = null;
    await runtime.hud?.render?.();

    const nextShell = runtime.hud?.element?.querySelector?.(".sf-shell");
    if (!previousBounds || !nextShell?.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

    const nextBounds = nextShell.getBoundingClientRect();
    if (!previousBounds.width || !previousBounds.height || !nextBounds.width || !nextBounds.height) return;

    const previousCenter = previousBounds.left + previousBounds.width / 2;
    const nextCenter = nextBounds.left + nextBounds.width / 2;
    const offsetX = previousCenter - nextCenter;
    const offsetY = previousBounds.bottom - nextBounds.bottom;
    const scaleX = previousBounds.width / nextBounds.width;
    const scaleY = previousBounds.height / nextBounds.height;
    const animation = nextShell.animate([
        {
            opacity: 0.72,
            transformOrigin: "bottom center",
            transform: `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scaleX}, ${scaleY})`,
        },
        {
            opacity: 1,
            transformOrigin: "bottom center",
            transform: "translate3d(0, 0, 0) scale(1, 1)",
        },
    ], { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" });
    void animation.finished.catch(() => null).finally(() => animation.cancel());
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
    const top = bounds.top - 6;
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

function isRangedAttack(attack) {
    const item = attack?.item ?? attack;
    const fields = [
        attack?.name,
        attack?.type,
        attack?.skill?.id,
        displayLabel(attack?.skill?.label),
        item?.type,
        item?.system?.category,
        item?.system?.weaponType,
        item?.system?.skill,
        item?.system?.range,
    ];
    return fields.some((value) => /fern|range|marksman|shoot|missile|schuss|wurf|throw|bow|bogen|crossbow|armbrust/iu.test(String(value ?? "")));
}

function isRangedAttackMessage(message) {
    const report = message?.system?.checkReport;
    return isRangedAttack(report?.itemData ?? report?.attack ?? message?.system?.itemData);
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
