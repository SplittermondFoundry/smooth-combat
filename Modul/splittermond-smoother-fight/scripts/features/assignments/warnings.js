export function collectOwnerPermissionWarnings({
    sheetAssignments = [],
    tokenAssignments = [],
    translate = (key) => key,
} = {}) {
    return [
        ...sheetAssignments.map((assignment) => ({ ...assignment, assignmentKind: "sheet" })),
        ...tokenAssignments.map((assignment) => ({ ...assignment, assignmentKind: "token" })),
    ].flatMap((assignment) => {
        const { actor, user } = assignment;
        if (!actor || !user || user.isGM || actor.testUserPermission?.(user, "OWNER")) return [];
        const canOpenActor = Boolean(assignment.canOpenActor && assignment.actorUuid);
        return [{
            typeClass: "is-missing-owner",
            icon: "fa-solid fa-key",
            title: assignment.title,
            context: assignment.context,
            reason: translate("SMOOTHER_FIGHT.Settings.MissingOwnerWarningDetail", { user: user.name }),
            isOwnerPermission: true,
            assignmentKind: assignment.assignmentKind,
            reference: assignment.reference,
            actorUuid: assignment.actorUuid,
            canOpenActor,
            hasActions: canOpenActor,
        }];
    });
}

export function collectSelectedOwnerPermissionWarnings({
    actorSelects,
    tokenSelects,
    actorByUuid,
    tokenByUuid,
    actorContextByUuid,
    tokenContextByUuid,
    userById,
    translate,
}) {
    const sheetAssignments = actorSelects.map((select) => {
        const actor = actorByUuid.get(select.dataset.actorUuid);
        const context = actorContextByUuid.get(select.dataset.actorUuid);
        return {
            actor,
            user: userById.get(select.value),
            title: context?.name ?? actor?.name ?? select.dataset.actorUuid,
            context: translate("SMOOTHER_FIGHT.Settings.WarningSheetContext", { type: context?.typeLabel ?? "–" }),
            reference: select.dataset.actorUuid,
            actorUuid: select.dataset.actorUuid,
            canOpenActor: Boolean(actor),
        };
    });
    const tokenAssignments = tokenSelects.map((select) => {
        const token = tokenByUuid.get(select.dataset.tokenUuid);
        const context = tokenContextByUuid.get(select.dataset.tokenUuid);
        return {
            actor: token?.actor,
            user: userById.get(select.value),
            title: context?.displayName ?? token?.name ?? select.dataset.tokenUuid,
            context: translate("SMOOTHER_FIGHT.Settings.WarningTokenContext", {
                scene: context?.sceneName ?? translate("SMOOTHER_FIGHT.Settings.UnknownScene"),
                actor: context?.actorName ?? token?.actor?.name ?? "–",
            }),
            reference: select.dataset.tokenUuid,
            actorUuid: select.dataset.actorUuid,
            canOpenActor: actorByUuid.has(select.dataset.actorUuid),
        };
    });
    return collectOwnerPermissionWarnings({ sheetAssignments, tokenAssignments, translate });
}

export function replaceOwnerPermissionWarningItems(root, warnings, translate = (key) => key) {
    const list = root?.querySelector?.('[data-role="warning-list"]');
    if (!list) return;
    list.querySelectorAll("[data-owner-permission-warning]").forEach((item) => item.remove());
    for (const warning of warnings) list.append(createOwnerPermissionWarningItem(warning, translate));
}

function createOwnerPermissionWarningItem(warning, translate) {
    const item = document.createElement("li");
    item.className = `sf-warning-item ${warning.typeClass}`;
    item.dataset.warningItem = "";
    item.dataset.ownerPermissionWarning = "";

    const icon = document.createElement("i");
    icon.className = warning.icon;
    icon.setAttribute("aria-hidden", "true");
    item.append(icon);

    const identity = document.createElement("span");
    identity.className = "sf-warning-token";
    const title = document.createElement("strong");
    title.title = warning.title;
    title.textContent = warning.title;
    const context = document.createElement("small");
    context.title = warning.context;
    context.textContent = warning.context;
    identity.append(title, context);
    item.append(identity);

    const reason = document.createElement("small");
    reason.className = "sf-warning-reason";
    reason.textContent = warning.reason;
    item.append(reason);

    if (warning.canOpenActor) {
        const actions = document.createElement("span");
        actions.className = "sf-warning-actions";
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.action = "open-warning-actor";
        button.dataset.actorUuid = warning.actorUuid;
        button.title = translate("SMOOTHER_FIGHT.Settings.OpenWarningSheetHint");
        const buttonIcon = document.createElement("i");
        buttonIcon.className = "fa-solid fa-file-lines";
        button.append(buttonIcon, ` ${translate("SMOOTHER_FIGHT.Settings.OpenWarningSheet")}`);
        actions.append(button);
        item.append(actions);
    }
    return item;
}
