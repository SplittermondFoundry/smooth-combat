import { hudState } from "./state.js";

import { services } from "../../core/services.js";

import {
    getHudContext,
    resolveHudActionContext,
    selectPersonalCombatantFromMenu,
} from "./context.js";

import {
    applyActionMenuExpansionRequest,
    applyCombatEventExpansionRequest,
    captureHudViewState,
    requestActionMenuExpansion,
    restoreHudViewState,
} from "./view-state.js";

import {
    bindSpellTooltips,
    buildHud,
    clearSpellTooltip,
    resolveActionItem,
} from "./view.js";

import {
    scheduleRender,
    setHudMinimized,
    syncMinimizedHudPosition,
    syncSystemActionBar,
} from "./visibility.js";

import {
    normalizeFavoriteSkillIds,
    reorderFavoriteSkillIds,
} from "../../combat-rules.js";

import {
    MAX_FAVORITE_SKILLS,
    MODULE_ID,
} from "../../core/constants.js";

import {
    applyHudAppearance,
} from "./appearance.js";

import {
    getSetting,
    t,
} from "../../shared/values.js";

export function mountHud() {
    hudState.hud = new SmootherFightHud();
    hudState.hud.mount();
}

export async function renderHud() {
    await hudState.hud.render();
}

class SmootherFightHud {
    constructor() {
        this.element = null;
        this.renderGeneration = 0;
        this.draggedFavoriteSkillId = null;
        this.favoriteSkillClickBlockedUntil = 0;
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
        this.element.addEventListener("dragstart", (event) => this.onFavoriteSkillDragStart(event));
        this.element.addEventListener("dragover", (event) => this.onFavoriteSkillDragOver(event));
        this.element.addEventListener("drop", (event) => void this.onFavoriteSkillDrop(event));
        this.element.addEventListener("dragend", () => this.onFavoriteSkillDragEnd());
    }

    async render() {
        if (!this.element) return;
        const generation = ++this.renderGeneration;
        const viewState = captureHudViewState(this.element);
        const forceLatestEvent = services.isCombatEventDeletionPending();
        const context = getHudContext();
        const enabled = getSetting("enabled", true);
        if (!enabled || !context) {
            hudState.hiddenByShortcut = false;
            services.clearCombatEventExpansionRequest();
            hudState.actionMenuExpansionRequest = null;
        }
        const visible = Boolean(enabled && context && !hudState.hiddenByShortcut);
        const minimized = Boolean(visible && getSetting("minimized", false));
        this.element.classList.toggle("sf-theme-light", getSetting("theme", "dark") === "light");
        applyHudAppearance(this.element);
        this.element.classList.toggle("is-hidden", !visible);
        syncSystemActionBar(visible);
        syncMinimizedHudPosition(this.element, minimized);
        if (!visible) {
            services.clearCombatEventDeletionPending();
            delete this.element.dataset.activeCombatantId;
            delete this.element.dataset.activeActorId;
            services.clearHoveredToken();
            clearSpellTooltip();
            this.element.replaceChildren();
            return;
        }

        const html = await buildHud(context);
        if (generation !== this.renderGeneration) return;
        services.clearHoveredToken();
        clearSpellTooltip();
        this.element.innerHTML = html;
        this.element.dataset.activeCombatantId = context.combatant.id ?? "";
        this.element.dataset.activeActorId = context.actor?.id ?? "";
        services.enforceChatPermissions(this.element, context);
        services.enforceFumbleActionState(this.element);
        services.bindQuickTargetHover(this.element);
        bindSpellTooltips(this.element, context);
        restoreHudViewState(this.element, viewState, { forceLatestEvent });
        if (forceLatestEvent) services.clearCombatEventDeletionPending();
        applyCombatEventExpansionRequest(this.element);
        applyActionMenuExpansionRequest(this.element);
    }

    onContextMenu(event) {
        const portrait = event.target.closest(".sf-portrait[data-sf-token-uuid]");
        if (portrait && this.element.contains(portrait)) {
            event.preventDefault();
            event.stopPropagation();
            services.showTokenOnCanvas(services.resolveToken(portrait.dataset.sfTokenUuid));
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
        if (target.closest(".sf-skill-favorites") && Date.now() < this.favoriteSkillClickBlockedUntil) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
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
            await services.handleChatCardAction(event, target);
            return;
        }

        const hudContext = getHudContext();
        const context = resolveHudActionContext(hudContext, target);
        if (!context) return;

        try {
            switch (action) {
                case "open-sheet":
                    context.actor.sheet.render({ force: true });
                    break;
                case "open-token-sheet": {
                    const token = services.resolveToken(target.dataset.sfTokenUuid);
                    token?.actor?.sheet?.render?.({ force: true });
                    break;
                }
                case "skill":
                    await services.requireOwner(context, () => context.actor.rollSkill(target.dataset.skillId));
                    break;
                case "toggle-favorite-skill":
                    await services.requireOwner(context, () => {
                        requestActionMenuExpansion(context, target, "skills");
                        return services.toggleFavoriteSkill(context, target.dataset.skillId);
                    });
                    break;
                case "attack":
                    await services.requireOwner(context, () => services.performAttack(context, target.dataset.attackId));
                    break;
                case "toggle-default-attack":
                    await services.requireOwner(context, () => {
                        requestActionMenuExpansion(context, target, "attacks");
                        return services.toggleDefaultAttack(context, target.dataset.attackId);
                    });
                    break;
                case "spell":
                    await services.requireOwner(context, () => services.performSpell(context, target.dataset.spellId));
                    break;
                case "cast-prepared-spell":
                    await services.requireOwner(context, () => services.performSpell(context, target.dataset.spellId));
                    break;
                case "cancel-prepared-spell":
                    await services.requireOwner(context, () => services.cancelPreparedSpell(context));
                    break;
                case "cancel-prepared-attack":
                    await services.requireOwner(context, () => services.cancelPreparedAttack(context));
                    break;
                case "add-ticks":
                    await services.requireOwner(context, () => services.addCombatTicks(context, target.dataset.ticks));
                    break;
                case "share-tick-action":
                    await services.requireOwner(context, async () => {
                        const advanceTicks = target.dataset.tickActionAdvance;
                        const shouldAdvance = advanceTicks !== "0" && advanceTicks !== "none";
                        const actualTicks = shouldAdvance
                            ? await services.addCombatTicks(context, advanceTicks)
                            : target.dataset.tickActionTicks;
                        if (shouldAdvance && actualTicks === null) return;
                        await services.createTickActionChatCard(
                            context,
                            target.dataset.tickActionId,
                            actualTicks
                        );
                    });
                    break;
                case "select-personal-combatant":
                    selectPersonalCombatantFromMenu(hudContext, target.dataset.combatantId);
                    break;
                case "pause-combatant":
                    await services.requireOwner(context, () => services.pauseCombatant(context, target.dataset.pauseType));
                    break;
                case "resume-combatant":
                    await services.requireOwner(context, () => services.resumeCombatant(context));
                    break;
                case "focus-combatant":
                    services.focusCombatantToken(context);
                    break;
                case "show-token":
                    services.showTokenOnCanvas(services.resolveToken(target.dataset.tokenUuid));
                    break;
                case "toggle-combatant-hidden":
                    await services.requireGm(() => services.toggleCombatantHidden(context));
                    break;
                case "toggle-token-hidden":
                    await services.requireGm(() => services.toggleTokenHidden(context));
                    break;
                case "toggle-combatant-visibility":
                    await services.requireGm(() => services.toggleCombatantVisibility(context));
                    break;
                case "toggle-combatant-defeated":
                    await services.requireGm(() => context.combatant.update({ defeated: !context.combatant.isDefeated }));
                    break;
                case "remove-combatant":
                    await services.requireGm(() => services.removeCombatant(context));
                    break;
                case "defense":
                    await services.requireOwner(context, () => context.actor.activeDefenseDialog(target.dataset.defenseType));
                    break;
                case "defend-other":
                    await services.beginDefenderDefense(game.messages.get(target.dataset.messageId));
                    break;
                case "defend-target":
                    await services.beginAdditionalTargetDefense(game.messages.get(target.dataset.messageId));
                    break;
                case "toggle-equipped":
                    await services.requireOwner(context, () => {
                        requestActionMenuExpansion(context, target, "attacks");
                        return services.toggleEquipped(context.actor, target.dataset.itemId);
                    });
                    break;
                case "set-target":
                    await services.setTargetFromQuickMenu(context, target.dataset.tokenUuid);
                    break;
                case "toggle-cards":
                    services.clearCombatEventExpansionRequest();
                    services.toggleCombatEventCardsCollapsed();
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

    onFavoriteSkillDragStart(event) {
        const favorite = event.target.closest(".sf-skill-favorites [data-favorite-skill-id]");
        if (!favorite || !this.element.contains(favorite)) return;
        this.draggedFavoriteSkillId = favorite.dataset.favoriteSkillId;
        this.favoriteSkillClickBlockedUntil = Number.POSITIVE_INFINITY;
        favorite.classList.add("is-dragging");
        favorite.setAttribute("aria-grabbed", "true");
        event.dataTransfer?.setData("text/plain", this.draggedFavoriteSkillId);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    }

    onFavoriteSkillDragOver(event) {
        const favorite = event.target.closest(".sf-skill-favorites [data-favorite-skill-id]");
        if (!favorite || !this.draggedFavoriteSkillId || favorite.dataset.favoriteSkillId === this.draggedFavoriteSkillId) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        this.clearFavoriteSkillDropIndicators();
        const bounds = favorite.getBoundingClientRect();
        favorite.classList.add(event.clientX > bounds.left + (bounds.width / 2) ? "is-drop-after" : "is-drop-before");
    }

    async onFavoriteSkillDrop(event) {
        const favorite = event.target.closest(".sf-skill-favorites [data-favorite-skill-id]");
        const sourceSkillId = this.draggedFavoriteSkillId ?? event.dataTransfer?.getData("text/plain");
        const targetSkillId = favorite?.dataset.favoriteSkillId;
        if (!favorite || !sourceSkillId || !targetSkillId || sourceSkillId === targetSkillId) {
            this.onFavoriteSkillDragEnd();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const bounds = favorite.getBoundingClientRect();
        const placeAfter = event.clientX > bounds.left + (bounds.width / 2);
        this.onFavoriteSkillDragEnd();
        const hudContext = getHudContext();
        const context = resolveHudActionContext(hudContext, favorite);
        if (!context) return;
        await services.requireOwner(context, async () => {
            const skills = Object.values(context.actor.skills ?? {});
            const current = normalizeFavoriteSkillIds(
                context.actor.getFlag?.(MODULE_ID, "favoriteSkillIds"),
                skills.map((skill) => skill.id),
                MAX_FAVORITE_SKILLS
            );
            const next = reorderFavoriteSkillIds(current, sourceSkillId, targetSkillId, placeAfter);
            if (next.every((id, index) => id === current[index])) return;
            await context.actor.setFlag(MODULE_ID, "favoriteSkillIds", next);
            scheduleRender(0);
        });
    }

    onFavoriteSkillDragEnd() {
        this.favoriteSkillClickBlockedUntil = Date.now() + 250;
        this.draggedFavoriteSkillId = null;
        this.element?.querySelectorAll(".sf-skill-favorites [aria-grabbed]").forEach((favorite) => {
            favorite.classList.remove("is-dragging");
            favorite.setAttribute("aria-grabbed", "false");
        });
        this.clearFavoriteSkillDropIndicators();
    }

    clearFavoriteSkillDropIndicators() {
        this.element?.querySelectorAll(".sf-skill-favorites .is-drop-before, .sf-skill-favorites .is-drop-after")
            .forEach((favorite) => favorite.classList.remove("is-drop-before", "is-drop-after"));
    }
}
