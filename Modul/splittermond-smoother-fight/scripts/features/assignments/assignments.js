import { services } from "../../core/services.js";

import { getApplicableCombat } from "../../core/combat-compatibility.js";

import {
    actorLinkUuid,
    linkMatchesCombatant,
    normalizeActorUserLinks,
    normalizeUserTokenLinks,
} from "../../combat-rules.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    asElement,
    escapeAttr,
    escapeHtml,
    getSetting,
    sortByName,
    t,
} from "../../shared/values.js";

export function getAssignedUser(actorOrCombatant, actorOverride = null) {
    return resolveAssignedUser(actorOrCombatant, actorOverride).user;
}

export function getRuntimeController(actorOrCombatant, actorOverride = null) {
    const assignedUser = getAssignedUser(actorOrCombatant, actorOverride);
    return assignedUser?.active ? assignedUser : getActivePrimaryGm();
}

export function getCurrentTurnController(combat = getApplicableCombat()) {
    const combatant = combat?.combatant ?? combat?.turns?.[0] ?? null;
    return combatant ? getRuntimeController(combatant) : null;
}

export function getActivePrimaryGm() {
    const primaryGm = game.users.get(getSetting("primaryGmId", ""));
    if (primaryGm?.isGM && primaryGm.active) return primaryGm;
    return Array.from(game.users ?? [])
        .filter((user) => user.isGM && user.active)
        .sort(compareUserIds)[0] ?? null;
}

function resolveAssignedUser(actorOrCombatant, actorOverride = null) {
    const { actor, combatant } = assignmentSubject(actorOrCombatant, actorOverride);
    if (!actor) return { user: null, source: "unassigned" };
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
    if (explicitlyLinkedUser) return { user: explicitlyLinkedUser, source: "direct" };

    const actorLinks = normalizeActorUserLinks(getSetting("actorUserLinks", {}));
    const actorLinkedUser = game.users.get(actorLinks[actorAssignmentUuid(actor, combatant.actorId)]);
    if (actorLinkedUser) return { user: actorLinkedUser, source: "sheet" };

    const owner = Array.from(game.users ?? [])
        .filter((user) => !user.isGM && actor.testUserPermission?.(user, "OWNER"))
        .sort(compareUserIds)[0] ?? null;
    return { user: owner, source: owner ? "owner" : "unassigned" };
}

function assignmentSubject(subject, actorOverride) {
    const token = subject?.token?.document
        ?? subject?.token
        ?? (subject?.documentName === "Token" || (subject?.actor && subject?.uuid) ? subject : null);
    const actor = actorOverride
        ?? subject?.actor
        ?? token?.actor
        ?? (subject?.documentName === "Actor" ? subject : null)
        ?? (!subject?.token && !subject?.actor ? subject : null);
    return {
        actor,
        combatant: {
            actor,
            actorId: subject?.actorId ?? token?.actorId ?? actor?.id ?? null,
            token,
            tokenUuid: subject?.tokenUuid ?? token?.uuid ?? null,
        },
    };
}

function compareUserIds(left, right) {
    return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
}

export function assignmentSourceLabel(source) {
    const keys = {
        direct: "DirectTokenAssignment",
        sheet: "SheetAssignment",
        "primary-gm": "PrimaryGmAssignment",
        owner: "OwnerAssignment",
        unassigned: "NoAssignmentSource",
    };
    return t(`SMOOTHER_FIGHT.Settings.${keys[source] ?? keys.unassigned}`);
}

export function assignmentSourceIcon(source) {
    const icons = {
        direct: "fa-solid fa-chess-pawn",
        sheet: "fa-solid fa-address-card",
        "primary-gm": "fa-solid fa-user-tie",
        owner: "fa-solid fa-key",
        unassigned: "fa-solid fa-circle-question",
    };
    return icons[source] ?? icons.unassigned;
}

export function actorAssignmentUuid(actor, sourceActorId = null) {
    return actorLinkUuid(actor?.uuid, sourceActorId ?? actor?.id);
}

export function renderTokenOwnerControl(app, html) {
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

export function getExplicitTokenOwnerId(token) {
    const primaryGmId = getSetting("primaryGmId", "");
    const links = normalizeUserTokenLinks(getSetting("userTokenLinks", {}), primaryGmId);
    return Object.entries(links)
        .find(([, userLinks]) => userLinks.some((link) => link.tokenUuid === token.uuid))?.[0] ?? "";
}

function getEffectiveTokenOwner(token) {
    return getAssignedUser(token);
}

export function isCurrentUserTarget(token) {
    return Boolean(token && game.user && getRuntimeController(token)?.id === game.user.id);
}

async function openTokenOwnerDialog(token) {
    if (!game.user.isGM) return;
    const users = Array.from(game.users ?? []).sort((left, right) =>
        Number(left.isGM) - Number(right.isGM) || sortByName(left, right)
    );
    if (!users.length) return;

    const assignment = resolveAssignedUser(token);
    const effectiveOwner = assignment.user;
    const source = assignmentSourceLabel(assignment.source);
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
    services.scheduleRender();
    canvas?.hud?.token?.render?.();
}
