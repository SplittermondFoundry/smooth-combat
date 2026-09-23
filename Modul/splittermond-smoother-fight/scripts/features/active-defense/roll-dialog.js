import { registerPendingDefenseCleanup } from "./pending.js";

// Splittermond's CheckDialog.create promise can remain pending on
// dismissal: DialogV2 does not invoke a constructor option named "close".
// Observe the actual check window, including the second window after choosing
// a VTD defense. Never time out a submitted roll while its message is created.
export async function withDefenseDialogCancellation(pending, operation, skillId = null) {
    const hooks = globalThis.Hooks;
    if (!hooks?.on || !hooks?.off) return operation();

    let observedDialog = null;
    let restoreDialog = () => {};
    let submitted = false;
    const preparedInputs = new WeakSet();
    let resolveCancellation;
    const cancellation = new Promise(resolve => { resolveCancellation = resolve; });
    const observe = (dialog) => {
        if (observedDialog || typeof dialog?.close !== "function"
            || !dialog.options?.classes?.includes("dialog-check")) return;
        const skill = dialog.checkData?.skill;
        const actorUuid = pending.defenderActorUuid ?? pending.targetActorUuid;
        if (!actorUuid || skill?.actor?.uuid !== actorUuid || (skillId && skill?.id !== skillId)) return;

        const DialogClass = dialog.constructor;
        const originalPrepare = DialogClass._prepareFormData;
        if (typeof originalPrepare !== "function") return;
        const prepare = function (element, ...args) {
            const input = originalPrepare.call(this, element, ...args);
            if (element === dialog.element && input && typeof input === "object") preparedInputs.add(input);
            return input;
        };
        DialogClass._prepareFormData = prepare;
        const originalClose = dialog.close;
        const hadOwnClose = Object.hasOwn(dialog, "close");
        const close = async function (options = {}, ...args) {
            // Foundry DialogV2._onSubmit calls close({ submitted: true }).
            // Splittermond 14.3 also calls close() itself after accepting input,
            // so track the exact form input reaching onBeforeCheck below.
            submitted ||= options?.submitted === true;
            const result = await originalClose.call(this, options, ...args);
            // Let the system's resolved input pass through its async skill
            // methods before classifying dismissal. This never waits for dice
            // or a chat message and also covers deferred fear confirmations.
            if (!submitted) await new Promise(resolve => setTimeout(resolve, 0));
            if (!submitted) resolveCancellation(null);
            return result;
        };
        dialog.close = close;
        observedDialog = dialog;
        restoreDialog = () => {
            if (DialogClass._prepareFormData === prepare) DialogClass._prepareFormData = originalPrepare;
            if (dialog.close !== close) return;
            if (hadOwnClose) dialog.close = originalClose;
            else delete dialog.close;
        };
    };
    const checkStarted = (skill, input) => {
        if (skill === observedDialog?.checkData?.skill && preparedInputs.has(input)) submitted = true;
    };
    // System bundles can minify CheckDialog's constructor name (e.g. "e" in
    // 14.3 beta5). The Foundry base hook and the dialog CSS class stay stable.
    const registrations = [
        ["renderApplicationV2", hooks.on("renderApplicationV2", observe)],
        ["splittermond.check.onBeforeCheck", hooks.on("splittermond.check.onBeforeCheck", checkStarted)],
    ];
    const cleanup = () => {
        for (const [hook, registration] of registrations) hooks.off(hook, registration);
        restoreDialog();
    };
    const unregisterCleanup = registerPendingDefenseCleanup(pending.pendingDefenseId, cleanup);
    try {
        return await Promise.race([operation(), cancellation]);
    } finally {
        unregisterCleanup();
        cleanup();
    }
}
