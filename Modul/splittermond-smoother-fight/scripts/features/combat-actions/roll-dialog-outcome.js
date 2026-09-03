const DIALOG_CLOSE_GRACE_MS = 500;
const DIALOG_CLOSE_SELECTOR = '[data-action="close"], .window-close';

export async function rollSkillWithDialogCancellation(
    actor,
    skillId,
    options,
    { token = null, closeGraceMs = DIALOG_CLOSE_GRACE_MS } = {},
) {
    const hooks = globalThis.Hooks;
    if (!hooks?.on || !hooks?.off) {
        const message = await actor.rollSkill?.(skillId, options);
        return message || null;
    }

    let dialogSeen = false;
    let closeTimer = null;
    let settled = false;
    const registrations = [];
    const dialogListeners = new Map();
    let resolveObservedOutcome;
    const cancellation = new Promise((resolve) => {
        resolveObservedOutcome = resolve;
    });

    const finish = (outcome) => {
        if (settled) return;
        settled = true;
        resolveObservedOutcome(outcome);
    };
    const cancel = () => finish({ status: "cancelled", message: null });
    const observeDialog = (application) => {
        if (!isMatchingRollDialog(application, actor) || dialogListeners.has(application)) return false;
        dialogSeen = true;
        const element = applicationElement(application);
        const onClick = (event) => {
            if (event.target?.closest?.(DIALOG_CLOSE_SELECTOR)) cancel();
        };
        const onKeyDown = (event) => {
            if (event.key === "Escape") cancel();
        };
        element?.addEventListener?.("click", onClick, true);
        element?.addEventListener?.("keydown", onKeyDown, true);
        dialogListeners.set(application, { element, onClick, onKeyDown });
        return true;
    };
    const closeDialog = (application) => {
        if (!isMatchingRollDialog(application, actor)) return;
        observeDialog(application);
        clearTimeout(closeTimer);
        closeTimer = setTimeout(cancel, Math.max(0, Number(closeGraceMs) || 0));
        closeTimer?.unref?.();
    };
    const acceptCreatedMessage = (message) => {
        if (!dialogSeen || !messageMatchesRoll(message, actor, token)) return;
        finish({ status: "completed", message });
    };
    const register = (hook, callback) => {
        registrations.push([hook, hooks.on(hook, callback)]);
    };

    for (const hook of ["renderApplicationV2", "renderApplication"]) register(hook, observeDialog);
    for (const hook of ["closeApplicationV2", "closeApplication"]) register(hook, closeDialog);
    register("createChatMessage", acceptCreatedMessage);

    const roll = Promise.resolve()
        .then(() => actor.rollSkill?.(skillId, options))
        .then((message) => ({ status: "completed", message: message || null }));
    try {
        const outcome = await Promise.race([roll, cancellation]);
        return outcome.message;
    } finally {
        settled = true;
        clearTimeout(closeTimer);
        for (const [hook, registration] of registrations) hooks.off(hook, registration);
        for (const { element, onClick, onKeyDown } of dialogListeners.values()) {
            element?.removeEventListener?.("click", onClick, true);
            element?.removeEventListener?.("keydown", onKeyDown, true);
        }
    }
}

function isMatchingRollDialog(application, actor) {
    if (!application) return false;
    const applicationActor = application.actor
        ?? application.object?.actor
        ?? application.document?.actor
        ?? application.options?.actor;
    if (applicationActor && !sameDocument(applicationActor, actor)) return false;
    const identity = [
        application.constructor?.name,
        application.id,
        application.options?.id,
        ...(application.options?.classes ?? []),
    ].filter(Boolean).join(" ");
    return /(?:check|probe|roll|skill)/iu.test(identity);
}

function applicationElement(application) {
    const element = application?.element;
    return element?.[0] ?? element ?? null;
}

function messageMatchesRoll(message, actor, token) {
    const speaker = message?.speaker;
    if (!speaker) return false;
    if (speaker.actor && [actor?.id, actor?.uuid].filter(Boolean).includes(speaker.actor)) return true;
    return Boolean(speaker.token && [token?.id, token?.uuid].filter(Boolean).includes(speaker.token));
}

function sameDocument(left, right) {
    if (left === right) return true;
    const leftIds = [left?.id, left?.uuid].filter(Boolean);
    return [right?.id, right?.uuid].filter(Boolean).some((id) => leftIds.includes(id));
}
