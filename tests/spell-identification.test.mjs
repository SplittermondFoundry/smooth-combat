import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spellIdentificationDifficulty, spellIdentificationOutcome } from "../Modul/splittermond-smoother-fight/scripts/domain/combat/spell-identification.js";
import { performTickAction } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/tick-actions.js";
import { createTickActionChatCard } from "../Modul/splittermond-smoother-fight/scripts/features/chat/messages.js";
import { buildTickActionReference } from "../Modul/splittermond-smoother-fight/scripts/features/hud/tick-action-reference.js";
import { buildTickActionChatModel } from "../Modul/splittermond-smoother-fight/scripts/features/chat/tick-action-localization.js";
import { COMBAT_TICK_ACTIONS } from "../Modul/splittermond-smoother-fight/scripts/domain/combat/ticks.js";
import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";

const TEXT = "SMOOTHER_FIGHT.HUD.SpellIdentification";
const dictionaries = Object.fromEntries(["de", "en"].map((lang) => [lang, JSON.parse(readFileSync(
    new URL(`../Modul/splittermond-smoother-fight/lang/${lang}.json`, import.meta.url), "utf8",
))]));

test("spell grades 0 through 5 produce difficulties 15 through 30", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(spellIdentificationDifficulty), [15, 18, 21, 24, 27, 30]);
    for (const invalid of [-1, 6, 0.5, "", " ", null, undefined, NaN, Infinity]) {
        assert.equal(spellIdentificationDifficulty(invalid), null);
    }
});

test("identification distinguishes all five outcomes, including zero EG and fumbles", () => {
    const cases = [
        [false, -6, "devastating"], [false, -5, "devastating"], [false, -4, "failure"],
        [false, -1, "failure"], [false, 0, "nearmiss"], [true, 0, "success"],
        [true, 4, "success"], [true, 5, "outstanding"], [true, 8, "outstanding"],
    ];
    for (const [succeeded, degrees, expected] of cases) {
        assert.equal(spellIdentificationOutcome({ succeeded, degreeOfSuccess: degrees }), expected);
        assert.equal(spellIdentificationOutcome({ succeeded, degreeOfSuccess: { fromRoll: degrees, modification: 0 } }), expected);
    }
    assert.equal(spellIdentificationOutcome({ succeeded: false, isFumble: true, degreeOfSuccess: -1 }), "devastating");
    assert.equal(spellIdentificationOutcome({ succeeded: true, degreeOfSuccess: { fromRoll: 3, modification: 2 } }), "outstanding");
    assert.equal(spellIdentificationOutcome({ succeeded: true, isCrit: true, degreeOfSuccess: 3 }), "success");
    for (const invalid of [null, {}, { succeeded: true }, { succeeded: true, degreeOfSuccess: "invalid" }]) {
        assert.equal(spellIdentificationOutcome(invalid), null);
    }
});

test("identification is an executable two-tick reaction in the action menu", () => {
    const fixture = install();
    const action = COMBAT_TICK_ACTIONS.find(({ id }) => id === "identifySpell");
    assert.equal(action.kind, "reaction");
    assert.equal(action.ticks, 2);
    assert.notEqual(action.actionable, false);
    const html = buildTickActionReference(fixture.actor);
    assert.match(html, /data-tick-action-id="identifySpell"[^>]*data-tick-action-advance="2"/u);
    assert.match(html, /Zauber identifizieren/u);
});

test("the dialog requires a difficulty and every grade button fills it without submitting", async () => {
    const fixture = install();
    foundry.applications.api.DialogV2.wait = async (config) => {
        assert.match(config.content, /15 \+ dreifacher Zaubergrad/u);
        assert.match(config.content, /name="difficulty"[^>]*required/u);
        assert.equal((config.content.match(/data-sf-spell-grade=/gu) ?? []).length, 6);
        const fields = formFields({ difficulty: "" });
        const dialog = bindDialog(config, fields);
        const blocked = dialog.click("submit");
        assert.equal(blocked.prevented, true);
        assert.equal(blocked.stopped, true);
        assert.equal(config.buttons[0].callback(null, { form: { elements: fields } }), null);
        for (let grade = 0; grade <= 5; grade++) {
            const click = dialog.click("grade", grade);
            assert.equal(click.prevented, true);
            assert.equal(fields.difficulty.value, String(15 + 3 * grade));
            assert.equal(fixture.rolls.length, 0);
        }
        fields.difficulty.value = "23";
        assert.equal(dialog.click("submit").prevented, false);
        return config.buttons[0].callback(null, { form: { elements: fields } });
    };
    assert.equal(await performTickAction(fixture.context, "identifySpell", "2"), true);
    assert.equal(fixture.rolls[0].skillId, "arcanelore");
    assert.equal(fixture.rolls[0].options.difficulty, 23);
    assert.deepEqual(fixture.order, ["roll", "dice", "card", "ticks"]);
    assert.equal(fixture.warnings.length, 1);
});

test("omitted components and completed-spell circumstances apply only to the chosen roll", async () => {
    const fixture = install();
    for (const [raw, expected] of [
        [{ components: "one" }, -3],
        [{ completed: true, circumstance: "-2" }, -2],
        [{ completed: true, circumstance: "-4" }, -4],
        [{ completed: true, circumstance: "-6", components: "both" }, -6],
        [{}, undefined],
    ]) {
        choose(raw);
        assert.equal(await performTickAction(fixture.context, "identifySpell", "2"), true);
        assert.equal(fixture.rolls.at(-1).options.modifier, expected);
        assert.deepEqual(fixture.rolls.at(-1).options.preSelectedModifier, ["Zauber identifizieren"]);
    }
    assert.equal(fixture.context.combatant.initiative, 20, "five rolls book two ticks each");
    assert.equal(fixture.actor.flags, undefined, "circumstances do not persist as actor flags");
});

test("both omitted components block identification during casting, but not observation of a completed effect", async () => {
    const fixture = install();
    foundry.applications.api.DialogV2.wait = async (config) => {
        const fields = formFields({ components: "both" });
        const dialog = bindDialog(config, fields);
        assert.equal(fields.circumstance.disabled, true);
        assert.equal(fields.components.disabled, false);
        assert.equal(dialog.click("submit").stopped, true);
        assert.match(fixture.warnings.at(-1), /Ohne Gesten und Formel/u);
        assert.equal(config.buttons[0].callback(null, { form: { elements: fields } }), null);
        fields.completed.checked = true;
        dialog.change();
        assert.equal(fields.circumstance.disabled, false);
        assert.equal(fields.components.disabled, true);
        assert.equal(dialog.click("submit").prevented, false);
        return config.buttons[0].callback(null, { form: { elements: fields } });
    };
    assert.equal(await performTickAction(fixture.context, "identifySpell", "2"), true);
    assert.equal(fixture.rolls.length, 1);
    assert.equal(fixture.rolls[0].options.modifier, -2);
});

test("cancelling either dialog or the skill check creates no result card and spends no ticks", async () => {
    const fixture = install();
    foundry.applications.api.DialogV2.wait = async () => null;
    assert.equal(await performTickAction(fixture.context, "identifySpell", "2"), false);
    assert.equal(fixture.rolls.length, 0);
    choose({ components: "one" });
    fixture.message = false;
    assert.equal(await performTickAction(fixture.context, "identifySpell", "2"), false);
    assert.equal(fixture.cards.length, 0);
    assert.equal(fixture.context.combatant.initiative, 10);
});

test("all five chat outcomes follow the screenshot and localize per viewing client", async () => {
    const fixture = install();
    const action = COMBAT_TICK_ACTIONS.find(({ id }) => id === "identifySpell");
    for (const [succeeded, degreeOfSuccess, expected, detail] of [
        [false, -5, "devastating", /−5/u], [false, -1, "failure", /weiß nicht/u],
        [false, 0, "nearmiss", /10 Ticks.*−3/u], [true, 2, "success", /Magieschule, Grad und Typen.*\+1/u],
        [true, 5, "outstanding", /genauen Zauber.*exakte Wirkung.*\+3/u],
    ]) {
        const report = { succeeded, degreeOfSuccess: { fromRoll: degreeOfSuccess, modification: 0 }, difficulty: 27 };
        fixture.message = { flags: { splittermond: { check: report } } };
        assert.equal(await performTickAction(fixture.context, "identifySpell", "2"), true);
        const options = fixture.cards.at(-1).options;
        assert.equal(options.specialKey, `${TEXT}.Results.${expected}`);
        assert.equal(options.descriptionData.difficulty, 27, "use the final roll difficulty");
        game.i18n = i18n("de");
        assert.match(buildTickActionChatModel(action, 2, options).special, detail);
        game.i18n = i18n("en");
        assert.equal(buildTickActionChatModel(action, 2, options).special, dictionaries.en.SMOOTHER_FIGHT.HUD.SpellIdentification.Results[expected]);
    }
    fixture.message = { system: { checkReport: { succeeded: false, degreeOfSuccess: 0 } } };
    assert.equal(await performTickAction(fixture.context, "identifySpell", "2"), true);
    assert.equal(fixture.cards.at(-1).options.specialKey, `${TEXT}.Results.nearmiss`);
    fixture.message = {};
    assert.equal(await performTickAction(fixture.context, "identifySpell", "2"), true);
    assert.equal(fixture.cards.at(-1).options.specialKey, `${TEXT}.Results.unknown`);
});

test("result cards preserve private and blind roll recipients", async () => {
    const fixture = install();
    const created = [];
    fixture.message.whisper = ["gm"];
    fixture.message.blind = true;
    globalThis.ChatMessage = {
        getSpeaker: () => ({ actor: fixture.actor.id }),
        create: async (data) => { created.push(data); return data; },
    };
    services.createTickActionChatCard = createTickActionChatCard;
    assert.equal(await performTickAction(fixture.context, "identifySpell", "2"), true);
    assert.deepEqual(created[0].whisper, ["gm"]);
    assert.equal(created[0].blind, true);
    assert.match(created[0].content, /Gelungen:/u);
});

test("result cards do not reveal a difficulty hidden by the system roll", async () => {
    const fixture = install();
    fixture.message.flags.splittermond.check = { succeeded: true, degreeOfSuccess: 1, difficulty: 37, hideDifficulty: true };
    assert.equal(await performTickAction(fixture.context, "identifySpell", "2"), true);
    const options = fixture.cards[0].options;
    assert.equal(options.descriptionKey, `${TEXT}.HiddenDifficultyDescription`);
    assert.deepEqual(options.descriptionData, {});
});

test("named modifiers work with both system manager signatures and are cleaned up after cancellation or errors", async () => {
    for (const version of ["14.2", "14.3"]) {
        const fixture = install();
        const manager = modifierManager(version);
        fixture.actor.modifier = manager;
        const observed = [];
        let reject = false;
        const original = function (options) {
            assert.equal(this, fixture.actor.skills.arcanelore);
            observed.push({ options, modifiers: [...manager._modifier.get("arcanelore")] });
            if (reject) throw new Error("roll rejected");
            return false;
        };
        fixture.actor.skills.arcanelore.roll = original;
        fixture.actor.rollSkill = async (id, options) => fixture.actor.skills[id].roll(options);
        choose({ components: "one" });
        assert.equal(await performTickAction(fixture.context, "identifySpell", "2"), false);
        assert.equal(observed[0].modifiers.length, 1);
        assert.equal(observed[0].modifiers[0].value.amount, -3);
        assert.equal(observed[0].modifiers[0].selectable, true);
        assert.ok(observed[0].options.preSelectedModifier.includes(dictionaries.de.SMOOTHER_FIGHT.HUD.SpellIdentification.OmittedModifier));
        assert.equal(manager._modifier.has("arcanelore"), false);
        assert.equal(fixture.actor.skills.arcanelore.roll, original);
        reject = true;
        await assert.rejects(performTickAction(fixture.context, "identifySpell", "2"), /roll rejected/u);
        assert.equal(manager._modifier.has("arcanelore"), false);
        assert.equal(fixture.actor.skills.arcanelore.roll, original);
        assert.equal(fixture.context.combatant.initiative, 10);
    }
});

function i18n(lang) {
    const localize = (key) => key.split(".").reduce((value, segment) => value?.[segment], dictionaries[lang]) ?? key;
    return { localize, format: (key, values) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), localize(key)) };
}

function install() {
    const fixture = { rolls: [], cards: [], order: [], warnings: [], message: { flags: { splittermond: { check: { succeeded: true, degreeOfSuccess: 1 } } } } };
    const user = { id: "player", isGM: false };
    globalThis.game = { user, i18n: i18n("de") };
    globalThis.ui = { notifications: { warn: (text) => fixture.warnings.push(text) } };
    globalThis.foundry = { applications: { api: { DialogV2: {} } } };
    fixture.actor = {
        id: "actor", name: "Tester", skills: { arcanelore: { id: "arcanelore", value: 18 } },
        async rollSkill(skillId, options) {
            fixture.order.push("roll");
            fixture.rolls.push({ skillId, options });
            return fixture.message;
        },
    };
    fixture.context = { actor: fixture.actor, token: { uuid: "Token.tester" }, combatant: { id: "tester", initiative: 10 }, combat: { id: "combat" } };
    services.getRuntimeController = () => user;
    services.getTargetSelectionForUser = () => ({ target: null, targets: [] });
    services.getBlockingCombatWorkflow = () => null;
    services.waitForDiceSoNice = async () => fixture.order.push("dice");
    services.createTickActionChatCard = async (context, actionId, ticks, options) => {
        fixture.order.push("card");
        fixture.cards.push({ context, actionId, ticks, options });
        return { id: "card" };
    };
    services.addCombatTicks = async (context, ticks) => {
        fixture.order.push("ticks");
        assert.equal(ticks, 2);
        context.combatant.initiative += ticks;
        return ticks;
    };
    choose({});
    return fixture;
}

function choose(raw) {
    foundry.applications.api.DialogV2.wait = async (config) => config.buttons[0].callback(null, { form: { elements: formFields(raw) } });
}

function formFields({ difficulty = "15", completed = false, circumstance = "-2", components = "none" } = {}) {
    return {
        difficulty: { value: difficulty, focus() {}, reportValidity() {} },
        completed: { checked: completed }, circumstance: { value: circumstance }, components: { value: components, focus() {} },
    };
}

function bindDialog(config, fields) {
    const callbacks = {};
    const circumstanceGroup = { style: { display: "none" } };
    const root = { querySelector: (selector) => selector === "[data-sf-completed-circumstance]"
        ? circumstanceGroup : fields[selector.match(/name="([^"]+)"/u)[1]], contains: () => true, addEventListener: (name, callback) => callbacks[name] = callback };
    config.render(null, { element: root });
    return {
        change: () => callbacks.change(),
        click(kind, grade) {
            const event = { prevented: false, stopped: false,
                preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; },
                target: { closest: (selector) => selector === "[data-sf-spell-grade]"
                    ? kind === "grade" ? { dataset: { sfSpellGrade: String(grade) } } : null
                    : kind === "submit" ? {} : null },
            };
            callbacks.click(event);
            return event;
        },
    };
}

function modifierManager(version) {
    class Amount { constructor(amount) { this.amount = amount; } }
    const manager = { _modifier: new Map([["template", [{ value: new Amount(0) }]]]) };
    const insert = (group, attributes, value, selectable) => manager._modifier.set(group, [
        ...(manager._modifier.get(group) ?? []), { attributes, value, selectable },
    ]);
    manager.add = version === "14.2"
        ? (group, attributes, value, selectable = false) => insert(group, attributes, value, selectable)
        : (group, attributes, value, _origin = null, selectable = false) => insert(group, attributes, value, selectable);
    return manager;
}
