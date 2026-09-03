import assert from "node:assert/strict";
import test from "node:test";

import {
    rollSkillWithDialogCancellation,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/roll-dialog-outcome.js";

test("closing a hanging check dialog through its X resolves the roll as cancelled", async (t) => {
    const hooks = installHookFixture();
    t.after(() => delete globalThis.Hooks);
    const actor = { id: "actor", rollSkill: () => new Promise(() => {}) };
    const element = eventTargetFixture();
    const attempt = rollSkillWithDialogCancellation(actor, "determination", {}, { closeGraceMs: 10_000 });

    hooks.emit("renderApplicationV2", {
        actor,
        element,
        constructor: { name: "CheckDialog" },
    });
    element.emit("click", {
        target: { closest: (selector) => selector.includes('data-action="close"') ? {} : null },
    });

    assert.equal(await attempt, null);
    assert.equal(hooks.size(), 0, "all temporary hooks are removed after cancellation");
});

test("a matching roll message wins over the close fallback", async (t) => {
    const hooks = installHookFixture();
    t.after(() => delete globalThis.Hooks);
    const actor = { id: "actor", rollSkill: () => new Promise(() => {}) };
    const message = { id: "roll", speaker: { actor: actor.id } };
    const attempt = rollSkillWithDialogCancellation(actor, "determination", {}, { closeGraceMs: 50 });
    const dialog = { actor, constructor: { name: "CheckDialog" } };

    hooks.emit("renderApplicationV2", dialog);
    hooks.emit("closeApplicationV2", dialog);
    hooks.emit("createChatMessage", message);

    assert.equal(await attempt, message);
});

function installHookFixture() {
    const handlers = new Map();
    let id = 0;
    globalThis.Hooks = {
        on(hook, callback) {
            const registration = ++id;
            handlers.set(registration, { hook, callback });
            return registration;
        },
        off(hook, registration) {
            if (handlers.get(registration)?.hook === hook) handlers.delete(registration);
        },
    };
    return {
        emit(hook, ...args) {
            for (const handler of [...handlers.values()]) {
                if (handler.hook === hook) handler.callback(...args);
            }
        },
        size: () => handlers.size,
    };
}

function eventTargetFixture() {
    const listeners = new Map();
    return {
        addEventListener(type, callback) {
            listeners.set(type, callback);
        },
        removeEventListener(type, callback) {
            if (listeners.get(type) === callback) listeners.delete(type);
        },
        emit(type, event) {
            listeners.get(type)?.(event);
        },
    };
}
