import {
    calculateActiveDefenseValue,
    findDefensiveFeatureValue,
    linkMatchesCombatant,
    recalculateAttackReport,
    totalDegreesOfSuccess,
} from "./combat-rules.js";

const MODULE_ID = "splittermond-smoother-fight";
const SOCKET = `module.${MODULE_ID}`;
const SYSTEM_SOCKET = "system.splittermond";

const runtime = {
    hud: null,
    renderTimer: null,
    targetByUser: new Map(),
    pendingDefense: null,
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
}

function registerSettingsMenu() {
    const Base = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2);

    class UserTokenLinksApplication extends Base {
        static DEFAULT_OPTIONS = {
            id: "smoother-fight-user-token-links",
            classes: ["smoother-fight", "sf-settings"],
            tag: "div",
            position: { width: 620, height: "auto" },
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
            const links = getSetting("userTokenLinks", {});
            const tokens = getSceneTokens().map((token) => ({
                uuid: token.uuid,
                actorUuid: token.actor?.uuid ?? null,
                label: `${token.name} — ${token.actor?.name ?? "–"}`,
            }));
            const users = Array.from(game.users ?? []).map((user) => {
                const link = links[user.id];
                const matchingToken = tokens.find((token) =>
                    token.uuid === link?.tokenUuid || (link?.actorUuid && token.actorUuid === link.actorUuid)
                );
                return {
                    id: user.id,
                    name: user.name,
                    active: user.active,
                    isGM: user.isGM,
                    selected: matchingToken?.uuid ?? "",
                };
            });
            return { ...context, users, tokens };
        }

        async _onRender(context, options) {
            await super._onRender(context, options);
            this.element.querySelector('[data-action="save-links"]')?.addEventListener("click", async () => {
                const links = {};
                for (const select of this.element.querySelectorAll("select[data-user-id]")) {
                    if (!select.value) continue;
                    const token = resolveToken(select.value);
                    links[select.dataset.userId] = {
                        tokenUuid: select.value,
                        actorUuid: token?.actor?.uuid ?? null,
                        actorId: token?.actor?.id ?? null,
                        label: token?.name ?? select.value,
                    };
                }
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
        const remaining = Array.from(user.targets ?? []);
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

    Hooks.on("renderChatMessageHTML", (message, html) => captureSystemActiveDefense(message, html));
    Hooks.on("renderChatMessage", (message, html) => captureSystemActiveDefense(message, asElement(html)));
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
            this.element.replaceChildren();
            return;
        }

        const html = await buildHud(context);
        if (generation !== this.renderGeneration) return;
        this.element.innerHTML = html;
        enforceChatPermissions(this.element, context);
    }

    async onClick(event) {
        const target = event.target.closest("[data-sf-action], .sf-chat-message button, .sf-chat-message [role=button]");
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
        ? t("SMOOTHER_FIGHT.HUD.PlayerTarget", { user: userName })
        : t("SMOOTHER_FIGHT.HUD.NoTargetDetail");

    return `
        <div class="sf-shell">
            ${portraitPanel({ side: "actor", token, actor, eyebrow: t("SMOOTHER_FIGHT.HUD.Active"), action: "open-sheet" })}
            <main class="sf-center">
                <header class="sf-turnline">
                    <span class="sf-live-dot"></span>
                    <strong>${escapeHtml(actor.name)}</strong>
                    <span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.CurrentTick", { tick }))}</span>
                    <span class="sf-turn-target"><i class="fa-solid fa-crosshairs"></i> ${escapeHtml(targetLine)}</span>
                </header>
                ${canAct ? buildActionBar(context) : `<p class="sf-owner-note"><i class="fa-solid fa-lock"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoOwner"))}</p>`}
                ${getSetting("showCards", true) ? buildCombatEvents(context) : ""}
            </main>
            ${target ? portraitPanel({ side: "target", token: target, actor: target.actor, eyebrow: t("SMOOTHER_FIGHT.HUD.Target") }) : noTargetPanel()}
        </div>
        ${game.user.isGM ? buildGmQuickTargets(context) : ""}
    `;
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
                <span><small>VTD</small>${defense}</span>
                <span><small>KW</small>${body}</span>
                <span><small>GW</small>${mind}</span>
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
    const value = Number(resource.value) || 0;
    const max = Math.max(0, Number(resource.max) || 0);
    const percent = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return `<div class="sf-resource sf-resource-${type}" title="${escapeAttr(`${label}: ${value}/${max}`)}">
        <span style="width:${percent}%"></span><small>${escapeHtml(label)} ${value}/${max}</small>
    </div>`;
}

function buildActionBar(context) {
    const actor = context.actor;
    const skills = Object.values(actor.skills ?? {})
        .filter((skill) => Number(skill.points) > 0 || ["acrobatics", "athletics", "determination", "stealth", "perception", "endurance"].includes(skill.id))
        .sort((a, b) => String(a.label).localeCompare(String(b.label), game.i18n.lang));
    const spells = [...(actor.spells ?? [])].sort(sortByName);
    const attacks = [...(actor.attacks ?? [])].sort(sortByName);
    const equipment = Array.from(actor.items ?? []).filter((item) => ["weapon", "shield"].includes(item.type)).sort(sortByName);
    const preparedSpell = actor.getFlag?.("splittermond", "preparedSpell");

    return `<nav class="sf-actions" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.Title"))}">
        ${actionMenu("fa-solid fa-dice-d20", t("SMOOTHER_FIGHT.HUD.Skills"), skills.map((skill) => `
            <button type="button" data-sf-action="skill" data-skill-id="${escapeAttr(skill.id)}">
                <span>${escapeHtml(skill.label)}</span><b>${Number(skill.value) || 0}</b>
            </button>`).join(""))}
        ${actionMenu("fa-solid fa-wand-sparkles", t("SMOOTHER_FIGHT.HUD.Spells"), spells.map((spell) => {
            const prepared = preparedSpell === spell.id;
            return `<button type="button" data-sf-action="spell" data-spell-id="${escapeAttr(spell.id)}" class="${prepared ? "is-prepared" : ""}" ${spell.enoughFocus === false ? "disabled" : ""}>
                <img src="${escapeAttr(spell.img)}" alt=""><span>${escapeHtml(spell.name)}<small>${escapeHtml(spell.skill?.label ?? "")} ${spell.skill?.value ?? ""}</small></span>
                <b>${escapeHtml(prepared ? t("SMOOTHER_FIGHT.HUD.Cast") : (spell.castDuration?.display ?? spell.castDuration ?? ""))}</b>
            </button>`;
        }).join("") || emptyMenuText() )}
        ${actionMenu("fa-solid fa-hand-fist", t("SMOOTHER_FIGHT.HUD.Attacks"), `
            ${attacks.map((attack) => `<button type="button" data-sf-action="attack" data-attack-id="${escapeAttr(attack.id)}" class="${attack.isPrepared ? "is-prepared" : ""}">
                <img src="${escapeAttr(attack.img)}" alt=""><span>${escapeHtml(attack.name)}<small>${escapeHtml(attack.skill?.label ?? "")} ${attack.skill?.value ?? ""}</small></span>
                <b>${escapeHtml(attack.isPrepared ? (attack.damage || "–") : `${attack.weaponSpeed ?? "–"} T`)}</b>
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
            <span>VTD <b>${getDerivedValue(actor, "defense")}</b></span>
            <span>KW <b>${getDerivedValue(actor, "bodyresist")}</b></span>
            <span>GW <b>${getDerivedValue(actor, "mindresist")}</b></span>
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
        <span>${abbreviation}${suffix}</span><b>${getDerivedValue(actor, type)}</b>
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
    const attack = group.attack;
    const context = getMessageContext(attack);
    const recalculated = context?.recalculatedFrom;
    const superseded = context?.supersededBy;
    const badge = recalculated
        ? `<span class="sf-event-badge is-defense"><i class="fa-solid fa-shield-halved"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenseResult"))}</span>`
        : superseded
            ? `<span class="sf-event-badge is-muted">${escapeHtml(t("SMOOTHER_FIGHT.HUD.OriginalAttack"))}</span>`
            : "";
    return `<details class="sf-event-group" ${isLatest && !runtime.cardsCollapsed ? "open" : ""}>
        <summary><span>${escapeHtml(attack.speaker?.alias ?? attack.author?.name ?? t("SMOOTHER_FIGHT.HUD.Attacks"))}</span>${badge}<i class="fa-solid fa-chevron-down"></i></summary>
        <div class="sf-event-body">
            ${chatMessageHtml(attack)}
            ${group.defenses.map((message) => `<div class="sf-associated-card"><h4><i class="fa-solid fa-shield"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenseResult"))}</h4>${chatMessageHtml(message)}</div>`).join("")}
            ${group.damages.map((message) => `<div class="sf-associated-card"><h4><i class="fa-solid fa-droplet"></i>${escapeHtml(t("SMOOTHER_FIGHT.HUD.Damage"))}</h4>${chatMessageHtml(message)}</div>`).join("")}
        </div>
    </details>`;
}

function chatMessageHtml(message) {
    return `<article class="sf-chat-message message" data-message-id="${escapeAttr(message.id)}"><div class="message-content">${message.content ?? ""}</div></article>`;
}

function buildGmQuickTargets(context) {
    const candidates = getCombatSceneTokens(context.combat).filter((token) => token.id !== context.token?.id);
    const body = candidates.length
        ? candidates.map((token) => `<button type="button" data-sf-action="set-target" data-token-uuid="${escapeAttr(token.uuid)}" class="${context.target?.uuid === token.uuid ? "is-current" : ""}">
            <img src="${escapeAttr(token.texture?.src ?? token.actor?.img ?? "icons/svg/mystery-man.svg")}" alt=""><span>${escapeHtml(token.name)}</span>
            ${context.target?.uuid === token.uuid ? '<i class="fa-solid fa-crosshairs"></i>' : ""}
        </button>`).join("")
        : `<p>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoCombatants"))}</p>`;
    return `<details class="sf-gm-targets">
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
    const links = getSetting("userTokenLinks", {});
    const exact = Object.entries(links).find(([, link]) => linkMatchesCombatant(link, combatant));
    if (exact) return game.users.get(exact[0]) ?? null;

    const users = Array.from(game.users ?? []);
    const owners = users.filter((user) => !user.isGM && actor.testUserPermission?.(user, "OWNER"));
    return owners.find((user) => user.active) ?? owners[0] ?? (game.user.isGM ? game.user : null);
}

function getTargetForUser(user) {
    if (!user) return null;
    let uuid = runtime.targetByUser.get(user.id);
    if (user.id === game.user.id) {
        const localTarget = Array.from(user.targets ?? []).at(-1);
        uuid = tokenUuid(localTarget) ?? uuid;
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
    const attacks = messages.filter((message) => {
        if (!isAttackMessage(message)) return false;
        const cardContext = getMessageContext(message);
        if (cardContext) return cardContext.combatId === context.combat.id;
        return Number(message.timestamp) >= runtime.startedAt && combatActorIds.has(message.speaker?.actor);
    });

    const groups = attacks.map((attack) => ({ attack, damages: [], defenses: [] }));
    for (const message of messages) {
        if (!isDamageMessage(message) && !isDefenseMessage(message)) continue;
        const cardContext = getMessageContext(message);
        let group = cardContext?.attackMessageId
            ? groups.find((candidate) => candidate.attack.id === cardContext.attackMessageId)
            : null;
        if (!group) {
            group = [...groups].reverse().find((candidate) =>
                message.timestamp >= candidate.attack.timestamp &&
                (isDefenseMessage(message) || message.speaker?.actor === candidate.attack.speaker?.actor)
            );
        }
        if (!group) continue;
        (isDamageMessage(message) ? group.damages : group.defenses).push(message);
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
        await context.actor.addTicks(attack.weaponSpeed, `${localizeSystem("splittermond.attack", "Angriff")}: ${attack.name}`);
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
        await context.actor.addTicks(
            spell.castDuration?.inTicks ?? Number(spell.castDuration) ?? 0,
            `${localizeSystem("splittermond.castDuration", "Zauberdauer")}: ${spell.name}`
        );
        await context.actor.setFlag("splittermond", "preparedSpell", spellId);
    }
    scheduleRender();
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
    if (!game.user.isGM) return;
    const token = resolveToken(uuid);
    if (!token) return;
    const recipient = context.linkedUser ?? game.user;
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
        if (isAttackMessage(message)) await attachAttackContext(message);
        if (isDefenseMessage(message)) await processDefenseMessage(message);
    } catch (error) {
        console.error(`${MODULE_ID} | Failed to process chat message`, error);
    }
}

async function attachAttackContext(message) {
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
        button.addEventListener("click", () => rememberPendingDefense(message), { capture: true });
    }
}

function rememberPendingDefense(message, targetOverride = null) {
    const context = getMessageContext(message);
    const target = targetOverride ?? resolveToken(context?.targetTokenUuid) ?? getHudContext()?.target;
    runtime.pendingDefense = {
        attackMessageId: message.id,
        targetTokenUuid: target?.uuid ?? null,
        targetActorUuid: target?.actor?.uuid ?? null,
        expiresAt: Date.now() + 10 * 60 * 1000,
    };
    return target;
}

async function processDefenseMessage(message) {
    if (!isOwnMessage(message) || !getSetting("defenseRecalculation", true)) return;
    const check = getDefenseCheck(message);
    if (!check?.succeeded) return;

    let pending = runtime.pendingDefense;
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
        const speakerActor = message.speaker?.actor ? game.actors.get(message.speaker.actor) : null;
        const mayChange = game.user.isGM || speakerActor?.isOwner || message.author?.id === game.user.id;
        if (!mayChange) {
            element.querySelectorAll("[data-action]:not([data-localaction]):not([data-local-action])").forEach((button) => button.remove());
        }

        const context = getMessageContext(message);
        const defenseTarget = resolveToken(context?.targetTokenUuid) ?? hudContext.target;
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
    return message?.type === "attackRollMessage" || message?.system?.constructor?.name === "AttackRollMessage";
}

function isDamageMessage(message) {
    return message?.type === "damageMessage" || message?.system?.constructor?.name === "DamageMessage";
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
    return Number(actor?.derivedValues?.[key]?.value ?? actor?.system?.derivedValues?.[key]?.value ?? 0);
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
