import assert from "node:assert/strict";
import test from "node:test";
import {
    applyFearRollRequirement,
    isFearRollCompatibilityRequired,
    prepareFearRollDialog,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/fear-roll-compatibility.js";

test.beforeEach(() => {
    globalThis.game = {
        system: { id: "splittermond", version: "14.2.7" },
        i18n: { localize: key => key, format: (key, data) => `${key}:${JSON.stringify(data)}` },
    };
    globalThis.foundry = { applications: { api: { DialogV2: { confirm: async () => false } } } };
});

test("no compatibility mutation or interception outside exactly Splittermond 14.2.7", async () => {
    for (const version of [undefined, "14.2.6", "14.2.8", "14.2.70", "14.2.7-beta1", "14.3.0-beta1", "14.3.0", "15.0.0"]) {
        game.system.version = version;
        const dialog = newCheckDialog(fearfulActor());
        const original = dialog._onSubmit;
        const prepare = dialog.constructor._prepareFormData;
        assert.equal(isFearRollCompatibilityRequired(), false);
        assert.equal(prepareFearRollDialog(dialog), false);
        assert.equal(dialog._onSubmit, original);
        assert.equal(dialog.constructor._prepareFormData, prepare);
        const data = { rollType: "risk" };
        applyFearRollRequirement(dialog.checkData.skill, data);
        assert.equal(data.rollType, "risk");
        assert.equal(dialog.element.notice, null);
    }
    game.system = { id: "other-system", version: "14.2.7" };
    assert.equal(isFearRollCompatibilityRequired(), false);
});

test("a feared actor's dialog defaults to safety and rejection preserves the dialog and all input", async () => {
    const dialog = newCheckDialog(fearfulActor());
    const input = structuredClone(dialog.element.input);
    let confirmation;
    foundry.applications.api.DialogV2.confirm = async options => { confirmation = options; return false; };
    assert.equal(prepareFearRollDialog(dialog), true);
    assert.equal(dialog.element.buttons.safety.focused, true);
    assert.equal(dialog.options.buttons.safety.default, true);
    assert.equal(dialog.options.buttons.standard.default, false);
    assert.equal(dialog.element.buttons.safety.classList.contains("sf-fear-roll-preset"), true);
    assert.match(dialog.element.notice.html, /FearRollHint/u);

    await dialog.submit("risk");
    assert.match(confirmation.content, /splittermond.rollType.risk/u);
    assert.equal(confirmation.defaultYes, false);
    assert.equal(confirmation.rejectClose, false);
    assert.equal(dialog.rendered, true);
    assert.deepEqual(dialog.rolls, []);
    assert.deepEqual(dialog.element.input, input);
    await dialog.submit("safety");
    assert.equal(dialog.rolls[0].rollType, "safety");
    assert.deepEqual(dialog.rolls[0].modifierElements, input.modifierElements);
    assert.equal(dialog.rolls[0].difficulty, input.difficulty);
    assert.equal(dialog.rendered, false);
});

test("explicitly confirmed standard and risk choices survive the system hook for that one roll", async () => {
    for (const type of ["standard", "risk"]) {
        const actor = fearfulActor();
        const dialog = newCheckDialog(actor);
        foundry.applications.api.DialogV2.confirm = async () => true;
        prepareFearRollDialog(dialog);
        await dialog.submit(type);
        assert.equal(dialog.rolls[0].rollType, type);
        assert.equal(Object.keys(dialog.rolls[0]).some(key => key.includes("smoother")), false);
        const next = { rollType: type };
        applyFearRollRequirement({ actor }, next);
        assert.equal(next.rollType, "safety", "a confirmed exception must not carry into another roll");
    }
});

test("skill, attack, spell and defense checks without a dialog use safety, including NPCs and Grandmasters", () => {
    for (const type of ["skill", "attack", "spell", "defense"]) {
        for (const actorType of ["character", "npc"]) {
            const actor = { ...fearfulActor(), type: actorType };
            const data = { type, rollType: "risk", difficulty: "20", modifierElements: [] };
            applyFearRollRequirement({ actor }, data);
            assert.equal(data.rollType, "safety");
            assert.equal(data.difficulty, "20");
            // Skill.roll adds its Grandmaster suffix after the onBeforeCheck hook.
            assert.equal(data.rollType + "Grandmaster", "safetyGrandmaster");
        }
    }
});

test("condition detection uses the rolling synthetic actor, never the selected token or another same-id NPC", async () => {
    const afraid = fearfulActor();
    const healthy = { id: afraid.id, uuid: "Scene.other.Token.npc.Actor.shared", items: [] };
    globalThis.canvas = { tokens: { controlled: [{ actor: afraid }] } };
    game.user = { targets: new Set([{ actor: afraid }]) };
    const dialog = newCheckDialog(healthy);
    prepareFearRollDialog(dialog);
    assert.equal(dialog.element.notice, null);
    await dialog.submit("risk");
    assert.equal(dialog.rolls[0].rollType, "risk");
    const data = { rollType: "risk" };
    applyFearRollRequirement({ actor: afraid }, data);
    assert.equal(data.rollType, "safety");
    delete globalThis.canvas;
});

test("inactive conditions do not apply; active status items and named token effects do", () => {
    for (const [actor, expected] of [
        [{ items: [{ type: "statuseffect", name: "  ANGSTERFÜLLT ", system: { level: "1" } }] }, "safety"],
        [{ items: [{ type: "statuseffect", name: "Angsterfüllt", system: { level: 0 } }] }, "risk"],
        [{ items: [{ type: "spell", name: "Angsterfüllt", system: { level: 1 } }] }, "risk"],
        [{ items: [{ type: "statuseffect", name: "Panisch", system: { level: 1 } }] }, "risk"],
        [{ effects: [{ name: "Angsterfüllt", disabled: false }] }, "safety"],
        [{ effects: [{ name: "Angsterfüllt", disabled: true }] }, "risk"],
        [{ effects: [{ name: "Angsterfüllt", isSuppressed: true }] }, "risk"],
        [{ effects: [{ name: "Angsterfüllt", duration: { expired: true } }] }, "risk"],
        [{ effects: [{ statuses: new Set(["angsterfuellt"]) }] }, "safety"],
    ]) {
        const data = { rollType: "risk" };
        applyFearRollRequirement({ actor }, data);
        assert.equal(data.rollType, expected);
    }
});

test("adding or removing Angsterfüllt while a dialog is open is checked again on submission", async () => {
    for (const add of [true, false]) {
        const actor = fearfulActor();
        if (add) actor.items = [];
        const dialog = newCheckDialog(actor);
        prepareFearRollDialog(dialog);
        actor.items = add ? fearfulActor().items : [];
        let confirmations = 0;
        foundry.applications.api.DialogV2.confirm = async () => { confirmations++; return true; };
        await dialog.submit("risk");
        assert.equal(confirmations, add ? 1 : 0);
        assert.equal(dialog.rolls[0].rollType, "risk");
        assert.equal(Boolean(dialog.element.notice), add);
    }
});

test("simultaneous dialogs and clicks cannot share an exception or submit twice", async () => {
    const actor = fearfulActor();
    const first = newCheckDialog(actor);
    const second = newCheckDialog(actor);
    prepareFearRollDialog(first);
    prepareFearRollDialog(second);
    let release;
    let prompts = 0;
    foundry.applications.api.DialogV2.confirm = () => { prompts++; return new Promise(resolve => { release = resolve; }); };
    const pending = first.submit("risk");
    await first.submit("risk");
    assert.equal(prompts, 1);
    await second.submit("safety");
    assert.equal(second.rolls[0].rollType, "safety");
    const direct = { rollType: "risk" };
    applyFearRollRequirement({ actor }, direct);
    assert.equal(direct.rollType, "safety");
    release(true);
    await pending;
    assert.equal(first.rolls.length, 1);
    assert.equal(first.rolls[0].rollType, "risk");
});

test("closing the roll while confirmation is open never produces a roll afterward", async () => {
    const dialog = newCheckDialog(fearfulActor());
    prepareFearRollDialog(dialog);
    let release;
    foundry.applications.api.DialogV2.confirm = () => new Promise(resolve => { release = resolve; });
    const pending = dialog.submit("risk");
    dialog.rendered = false;
    dialog.element.isConnected = false;
    release(true);
    await pending;
    assert.deepEqual(dialog.rolls, []);
});

test("rerendering is idempotent and a failed confirmation releases its lock", async () => {
    const dialog = newCheckDialog(fearfulActor());
    prepareFearRollDialog(dialog);
    const submit = dialog._onSubmit;
    const form = dialog.constructor._prepareFormData;
    prepareFearRollDialog(dialog);
    assert.equal(dialog._onSubmit, submit);
    assert.equal(dialog.constructor._prepareFormData, form);
    assert.equal(dialog.element.noticesCreated, 1);
    foundry.applications.api.DialogV2.confirm = async () => { throw new Error("dialog failed"); };
    await assert.rejects(dialog.submit("risk"), /dialog failed/u);
    await dialog.submit("safety");
    assert.equal(dialog.rolls[0].rollType, "safety");
});

test("previously installed wrappers become inert if the system version no longer matches", async () => {
    const dialog = newCheckDialog(fearfulActor());
    prepareFearRollDialog(dialog);
    game.system.version = "14.3.0";
    foundry.applications.api.DialogV2.confirm = async () => assert.fail("14.3 must use its native handling");
    await dialog.submit("risk");
    assert.equal(dialog.rolls[0].rollType, "risk");
});

function fearfulActor() {
    return { id: "shared", uuid: "Scene.test.Token.npc.Actor.shared", items: [
        { type: "statuseffect", name: "Angsterfüllt", system: { level: 1, modifier: "" } },
    ] };
}

function newCheckDialog(actor) {
    return new CheckDialog(actor);
}

// Preserve 14.2.7's data hand-off and Foundry's frozen top-level options.
class CheckDialog {
    static _prepareFormData(element) { return structuredClone(element.input); }
    constructor(actor) {
        this.checkData = { skill: { actor } };
        this.element = elementFixture();
        this.options = Object.freeze({ classes: ["splittermond", "dialog-check"], buttons: { risk: {}, standard: { default: true }, safety: {} } });
        this.rendered = true;
        this.rolls = [];
    }
    async _onSubmit(target, event) {
        event.preventDefault();
        const data = this.constructor._prepareFormData(this.element, this.checkData);
        data.rollType = target.dataset.action;
        applyFearRollRequirement(this.checkData.skill, data);
        this.rolls.push(data);
        this.rendered = false;
        this.element.isConnected = false;
        return this;
    }
    submit(type) { return this._onSubmit(this.element.buttons[type], { preventDefault() {} }); }
}

function classListFixture() {
    const values = new Set();
    return { toggle: (key, enabled) => enabled ? values.add(key) : values.delete(key), contains: key => values.has(key) };
}

function elementFixture() {
    const element = {
        isConnected: true, classList: classListFixture(), notice: null, noticesCreated: 0,
        input: { difficulty: "23", modifierElements: [{ value: 3, description: "existing" }], maneuvers: ["Entwaffnen"], messageMode: "private" },
        buttons: Object.fromEntries(["risk", "standard", "safety"].map(type => [type, {
            dataset: { action: type }, classList: classListFixture(), focused: false,
            toggleAttribute(name, enabled) { this[name] = enabled; },
            hasAttribute(name) { return this[name] === true; },
            focus() { this.focused = true; },
        }])),
        querySelector(selector) {
            const type = selector.match(/data-action="([^"]+)"/u)?.[1];
            if (type) return this.buttons[type];
            if (selector === ".sf-fear-roll-hint") return this.notice;
            if (selector === ".dialog-content") return { insertAdjacentHTML: (_where, html) => {
                this.noticesCreated++;
                this.notice = { html, remove: () => { this.notice = null; } };
            } };
            return null;
        },
    };
    return element;
}
