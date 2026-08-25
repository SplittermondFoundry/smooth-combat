import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
    createDefenseSplinterpointChatCard,
    createTickActionChatCard,
} from "../Modul/splittermond-smoother-fight/scripts/features/chat/messages.js";
import { COMBAT_TICK_ACTIONS } from "../Modul/splittermond-smoother-fight/scripts/domain/combat/ticks.js";
import {
    bindTickActionReferenceFilters,
    closeTickActionReferenceOnEscape,
    fitTickActionReferencePanel,
    toggleTickActionReferenceOnKeyboard,
} from "../Modul/splittermond-smoother-fight/scripts/features/hud/controller.js";
import {
    addCombatTicks,
    getPendingOffenseKind,
    performAttack,
    performSpell,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/actions.js";
import { performTickAction } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/tick-actions.js";
import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import { withTemporarySystemTargets } from "../Modul/splittermond-smoother-fight/scripts/features/targeting/targeting.js";

const german = JSON.parse(fs.readFileSync(
    new URL("../Modul/splittermond-smoother-fight/lang/de.json", import.meta.url),
    "utf8"
));

function translation(key) {
    return key.split(".").reduce((value, segment) => value?.[segment], german) ?? key;
}

test("every combat action has card-ready descriptive text", () => {
    for (const action of COMBAT_TICK_ACTIONS) {
        const entry = german.SMOOTHER_FIGHT.HUD.TickActions[action.id];
        assert.ok(entry?.Name, `missing name for ${action.id}`);
        assert.ok(entry?.Description, `missing description for ${action.id}`);
        if (action.special) assert.ok(entry?.Special, `missing special rule for ${action.id}`);
    }
});

test("combat action sources use verified structured publication metadata", () => {
    for (const action of COMBAT_TICK_ACTIONS) {
        assert.equal(typeof action.source?.book, "string", `missing source book for ${action.id}`);
        assert.ok(
            (Number.isInteger(action.source?.page) && action.source.page > 0)
                || /^\d+–\d+$/u.test(action.source?.page),
            `invalid source page for ${action.id}`,
        );
        assert.equal(Object.isFrozen(action.source), true, `mutable source metadata for ${action.id}`);
    }
    assert.deepEqual(COMBAT_TICK_ACTIONS.find(({ id }) => id === "standUpProne").source, { book: "GRW", page: 159 });
    assert.deepEqual(COMBAT_TICK_ACTIONS.find(({ id }) => id === "simpleCommand").source, { book: "Die Magie", page: 180 });
    assert.deepEqual(COMBAT_TICK_ACTIONS.find(({ id }) => id === "coordinate").source, { book: "GRW", page: 104 });
});

test("system-owned combat actions remain reference rows without action buttons", () => {
    const referenceOnly = new Set([
        "meleeAttack",
        "opportunityAttack",
        "readyRangedAttack",
        "rangedAttack",
        "activeDefense",
        "focusMagic",
        "castSpell",
        "complexTask",
    ]);
    for (const action of COMBAT_TICK_ACTIONS) {
        assert.equal(action.actionable === false, referenceOnly.has(action.id), `unexpected action control for ${action.id}`);
    }
});

test("Escape closes the tick action disclosure and restores focus to its summary", () => {
    let focused = 0;
    let prevented = 0;
    let stopped = 0;
    const summary = { focus: () => focused++ };
    const disclosure = {
        open: true,
        querySelector: (selector) => selector === ":scope > summary" ? summary : null,
    };
    const root = { querySelector: () => disclosure };
    const event = {
        key: "Escape",
        target: { closest: () => disclosure },
        preventDefault: () => prevented++,
        stopPropagation: () => stopped++,
    };

    assert.equal(closeTickActionReferenceOnEscape(root, event), true);
    assert.equal(disclosure.open, false);
    assert.equal(focused, 1);
    assert.equal(prevented, 1);
    assert.equal(stopped, 1);
    assert.equal(closeTickActionReferenceOnEscape(root, { ...event, key: "Enter" }), false);
});

test("the tick action panel opens toward the larger available viewport area", () => {
    let opensBelow = null;
    const panel = { style: {} };
    const disclosure = {
        open: true,
        classList: { toggle: (_className, enabled) => opensBelow = enabled },
        closest: () => ({ getBoundingClientRect: () => ({ top: 260, bottom: 300 }) }),
        querySelector: () => panel,
    };

    assert.equal(fitTickActionReferencePanel(disclosure, 720), true);
    assert.equal(opensBelow, true);
    assert.equal(panel.style.maxHeight, "408px");
});

test("Enter and Space toggle the focused tick action disclosure", () => {
    let prevented = 0;
    let stopped = 0;
    const disclosure = { open: false, matches: () => true };
    const summary = { parentElement: disclosure, closest: () => summary };
    const root = { contains: (candidate) => candidate === summary };
    const event = {
        key: "Enter",
        target: summary,
        preventDefault: () => prevented++,
        stopPropagation: () => stopped++,
    };

    assert.equal(toggleTickActionReferenceOnKeyboard(root, event), true);
    assert.equal(disclosure.open, true);
    assert.equal(toggleTickActionReferenceOnKeyboard(root, { ...event, key: " " }), true);
    assert.equal(disclosure.open, false);
    assert.equal(prevented, 2);
    assert.equal(stopped, 2);
});

test("the tick action search filters all row fields and hides empty categories", () => {
    const rows = [
        { dataset: { sfSearch: "Aufstehen Bewegungshandlungen Kontinuierliche Aktion 6 Ticks Quelle GRW", sfTickActionCategory: "movement" }, hidden: false },
        { dataset: { sfSearch: "Aus dem Kampf lösen Nahkampfhandlungen Sofortige Aktion 5 Ticks Akrobatik", sfTickActionCategory: "melee" }, hidden: false },
    ];
    const categories = ["movement", "melee"].map((category) => ({
        dataset: { sfTickActionCategory: category },
        hidden: false,
    }));
    const empty = { hidden: true };
    const popover = {
        querySelectorAll: (selector) => ({
            "[data-sf-tick-action-row]": rows,
            ".sf-tick-action-category[data-sf-tick-action-category]": categories,
        })[selector] ?? [],
        querySelector: () => empty,
    };
    let onInput = null;
    const input = {
        value: "",
        closest: () => popover,
        addEventListener: (_event, listener) => { onInput = listener; },
    };
    bindTickActionReferenceFilters({ querySelectorAll: () => [input] });

    input.value = "losen akrobatik";
    onInput();
    assert.deepEqual(rows.map((row) => row.hidden), [true, false]);
    assert.deepEqual(categories.map((category) => category.hidden), [true, false]);
    assert.equal(empty.hidden, true);

    input.value = "Zauber";
    onInput();
    assert.deepEqual(rows.map((row) => row.hidden), [true, true]);
    assert.deepEqual(categories.map((category) => category.hidden), [true, true]);
    assert.equal(empty.hidden, false);

    input.value = "";
    onInput();
    assert.deepEqual(rows.map((row) => row.hidden), [false, false]);
});

test("aiming and searching for an opening choose 2, 4, or 6 ticks and scale the chat bonus", async () => {
    const order = [];
    let dialogConfig;
    installTickActionGlobals();
    globalThis.foundry = { applications: { api: { DialogV2: {
        wait: async (config) => {
            dialogConfig = config;
            return config.buttons[1].callback();
        },
    } } } };
    const context = tickActionContext({ skills: {} });
    services.addCombatTicks = async (_context, ticks) => {
        order.push(`ticks:${ticks}`);
        return Number(ticks);
    };
    services.createTickActionChatCard = async (_context, actionId, ticks, options) => {
        order.push("card");
        assert.equal(actionId, "searchOpening");
        assert.equal(ticks, 4);
        assert.match(options.description, /4 Ticks/u);
        assert.equal(options.special, "+2 auf den nächsten Nahkampfangriff");
        return { id: "action-card" };
    };

    assert.equal(await performTickAction(context, "searchOpening", "custom"), true);
    assert.doesNotMatch(dialogConfig.content, /<select/u);
    assert.deepEqual(dialogConfig.buttons.map((button) => button.action), ["ticks-2", "ticks-4", "ticks-6"]);
    assert.deepEqual(dialogConfig.buttons.map((button) => button.label), ["2 Ticks", "4 Ticks", "6 Ticks"]);
    assert.equal(dialogConfig.buttons[0].default, true);
    assert.deepEqual(order, ["ticks:4", "card"]);
});

test("disengaging offers rollable combat skills with Retreat Fighting even though actor.skills excludes fighting skills", async () => {
    const order = [];
    let dialogConfig;
    const target = { name: "Rattling", uuid: "Token.rattling", actor: { name: "Rattling" } };
    installTickActionGlobals(target);
    globalThis.CONFIG = { splittermond: { skillGroups: { fighting: ["blades", "staffs"] } } };
    globalThis.foundry = { applications: { api: { DialogV2: {
        wait: async (config) => {
            dialogConfig = config;
            return config.buttons.find((button) => button.action === "choice-staffs").callback();
        },
    } } } };
    const context = tickActionContext({
        skills: {
            acrobatics: { id: "acrobatics", label: "Akrobatik" },
        },
        attacks: [
            {
                id: "blade-attack",
                item: { type: "weapon", system: { equipped: true } },
                skill: {
                    id: "blades",
                    label: "Klingenwaffen",
                    roll: async () => assert.fail("the unselected combat skill must not be rolled"),
                },
            },
            {
                id: "staff-attack",
                item: { type: "weapon", system: { equipped: true } },
                skill: {
                    id: "staffs",
                    label: "Stangenwaffen",
                    roll: async (options) => {
                        order.push("roll");
                        assert.equal(options.difficulty, "GW");
                        return { id: "roll-message", flags: { splittermond: { check: { succeeded: true } } } };
                    },
                },
            },
        ],
        getFlag: (scope, key) => scope === "splittermond-smoother-fight" && key === "defaultAttackId"
            ? "staff-attack"
            : null,
        items: [
            { type: "mastery", name: "Rückzugsgefecht", system: { skill: "blades" } },
            { type: "mastery", name: "Rückzugsgefecht", system: { skill: { id: "staffs" } } },
        ],
        rollSkill: async () => assert.fail("choosing a combat skill must not roll Acrobatics"),
    });
    services.withTemporarySystemTargets = async (targets, operation) => {
        assert.deepEqual(targets, [target]);
        return operation();
    };
    services.createTickActionChatCard = async (_context, actionId, ticks, options) => {
        order.push("card");
        assert.equal(actionId, "disengage");
        assert.equal(ticks, 5);
        assert.equal(options.special, "Stangenwaffen gegen den GW von Rattling");
        return { id: "action-card" };
    };
    services.addCombatTicks = async (_context, ticks) => {
        order.push("ticks");
        return ticks;
    };

    assert.equal(await performTickAction(context, "disengage", "5"), true);
    assert.doesNotMatch(dialogConfig.content, /<select/u);
    assert.deepEqual(dialogConfig.buttons.map((button) => button.label), ["Akrobatik", "Stangenwaffen", "Abbrechen"]);
    assert.deepEqual(dialogConfig.buttons.map((button) => button.action), ["choice-acrobatics", "choice-staffs", "cancel"]);
    assert.equal(dialogConfig.buttons.some((button) => button.label === "Klingenwaffen"), false);
    assert.deepEqual(order, ["roll", "card", "ticks"]);
});

test("disengaging excludes Retreat Fighting when no matching weapon attack is selected", async () => {
    const target = { name: "Rattling", uuid: "Token.rattling", actor: { name: "Rattling" } };
    installTickActionGlobals(target);
    globalThis.CONFIG = { splittermond: { skillGroups: { fighting: ["blades", "staffs"] } } };
    globalThis.foundry = { applications: { api: { DialogV2: {
        wait: async () => assert.fail("Acrobatics must run directly when no matching weapon is selected"),
    } } } };
    let rolledSkill;
    const context = tickActionContext({
        skills: { acrobatics: { id: "acrobatics", label: "Akrobatik" } },
        attacks: [
            {
                id: "blade-attack",
                item: { type: "weapon", system: { equipped: true } },
                skill: { id: "blades", label: "Klingenwaffen", roll: async () => assert.fail("wrong weapon skill") },
            },
            {
                id: "staff-shield-attack",
                item: { type: "shield", system: { equipped: true } },
                skill: { id: "staffs", label: "Stangenwaffen", roll: async () => assert.fail("a shield is not a weapon") },
            },
        ],
        getFlag: () => "blade-attack",
        items: [{ type: "mastery", name: "Rückzugsgefecht", system: { skill: "staffs" } }],
        rollSkill: async (skillId) => {
            rolledSkill = skillId;
            return { id: "acrobatics-roll", flags: { splittermond: { check: { succeeded: true } } } };
        },
    });
    services.withTemporarySystemTargets = async (_targets, operation) => operation();
    services.createTickActionChatCard = async () => ({ id: "action-card" });
    services.addCombatTicks = async (_context, ticks) => ticks;

    assert.equal(await performTickAction(context, "disengage", "5"), true);
    assert.equal(rolledSkill, "acrobatics");
});

test("shield bash derives a maneuver-free wrong-hand attack without mutating the system shield", async () => {
    const order = [];
    const target = { name: "Ork", uuid: "Token.orc", actor: { name: "Ork" } };
    installTickActionGlobals(target);
    const masteryManeuvers = [{ name: "Ausfall" }];
    let rolledAttack = null;
    const shieldAttack = {
        id: "shield-attack",
        name: "Großschild",
        weaponSpeed: 7,
        item: { type: "shield", system: { equipped: true } },
        skill: { id: "blades", maneuvers: masteryManeuvers },
        async roll(options) {
            order.push("roll");
            rolledAttack = this;
            assert.equal(options.title, "Schildstoß");
            assert.equal(this.weaponSpeed, 9);
            assert.equal(this.skill.id, "blades");
            assert.deepEqual(this.skill.maneuvers, []);
            return true;
        },
    };
    const context = tickActionContext({
        skills: { blades: { id: "blades", label: "Klingenwaffen" } },
        attacks: [shieldAttack],
    });
    services.performAttack = async (_context, attackId, options, rollAttack) => {
        assert.equal(attackId, shieldAttack.id);
        assert.equal(options.title, "Schildstoß");
        return rollAttack(shieldAttack, options);
    };
    services.createTickActionChatCard = async () => assert.fail("shield bash must not create an extra chat card");
    services.addCombatTicks = async () => assert.fail("shield bash must not move the combatant itself");

    assert.equal(await performTickAction(context, "shieldBash", "7"), true);
    assert.deepEqual(order, ["roll"]);
    assert.notEqual(rolledAttack, shieldAttack);
    assert.equal(rolledAttack.skill, shieldAttack.skill);
    assert.equal(shieldAttack.weaponSpeed, 7);
    assert.equal(shieldAttack.skill.maneuvers, masteryManeuvers);
});

test("shield bash keeps branded system skill receivers and supports calculated weapon speed", async () => {
    const target = { name: "Ork", uuid: "Token.orc", actor: { name: "Ork" } };
    installTickActionGlobals(target);
    class BrandedSkill {
        #value = 12;

        constructor() {
            this.id = "blades";
        }

        get maneuvers() {
            return [{ name: "Ausfall" }];
        }

        toObject() {
            return { id: this.id, value: this.#value };
        }
    }
    const skill = new BrandedSkill();
    const systemSpeed = {
        display: 7,
        async calculate() {
            return 7;
        },
    };
    const shieldAttack = {
        id: "shield-attack",
        name: "Großschild",
        weaponSpeed: systemSpeed,
        weaponSpeedAsync: async () => 7,
        item: { type: "shield", system: { equipped: true } },
        skill,
        async roll() {
            assert.deepEqual(this.skill.toObject(), { id: "blades", value: 12 });
            assert.deepEqual(this.skill.maneuvers, []);
            assert.equal(this.weaponSpeed.display, 9);
            assert.equal(await this.weaponSpeed.calculate(), 9);
            assert.equal(await this.weaponSpeedAsync(), 9);
            return true;
        },
    };
    const context = tickActionContext({ attacks: [shieldAttack] });
    services.performAttack = async (_context, _attackId, options, rollAttack) => (
        rollAttack(shieldAttack, options)
    );

    assert.equal(await performTickAction(context, "shieldBash", "7"), true);
    assert.equal(shieldAttack.weaponSpeed, systemSpeed);
    assert.deepEqual(skill.maneuvers, [{ name: "Ausfall" }]);
});

test("shield bash waives the wrong-hand surcharge only for its two rule exceptions", async () => {
    const target = { name: "Ork", uuid: "Token.orc", actor: { name: "Ork" } };
    const cases = [
        {
            name: "unrelated two-weapon mastery",
            items: [{ type: "mastery", name: "Kampf mit zwei Waffen", system: { skill: "staffs" } }],
            expectedSpeed: 9,
        },
        {
            name: "matching two-weapon mastery",
            items: [{ type: "mastery", name: "Localized mastery", system: { id: "kampf-mit-zwei-waffen", skill: { id: "blades" } } }],
            expectedSpeed: 7,
        },
        {
            name: "strong shield arm",
            items: [{ type: "mastery", name: "Starker Schildarm I", system: { skill: "endurance" } }],
            expectedSpeed: 7,
        },
    ];

    for (const scenario of cases) {
        installTickActionGlobals(target);
        const shieldAttack = {
            id: "shield-attack",
            name: "Großschild",
            weaponSpeed: 7,
            item: { type: "shield", system: { equipped: true } },
            skill: { id: "blades", maneuvers: [{ name: "Ausfall" }] },
            async roll() {
                assert.equal(this.weaponSpeed, scenario.expectedSpeed, scenario.name);
                assert.deepEqual(this.skill.maneuvers, [], scenario.name);
                return true;
            },
        };
        const context = tickActionContext({
            attacks: [shieldAttack],
            items: scenario.items,
        });
        services.performAttack = async (_context, _attackId, options, rollAttack) => (
            rollAttack(shieldAttack, options)
        );

        assert.equal(await performTickAction(context, "shieldBash", "7"), true, scenario.name);
        assert.equal(shieldAttack.weaponSpeed, 7, scenario.name);
    }
});

test("evasive leap reports its degree-scaled damage reduction and only then advances ticks", async () => {
    const order = [];
    installTickActionGlobals();
    const context = tickActionContext({
        skills: { acrobatics: { id: "acrobatics", label: "Akrobatik" } },
        rollSkill: async (skillId, options) => {
            order.push("roll");
            assert.equal(skillId, "acrobatics");
            assert.equal(options.difficulty, 15);
            return { id: "evasive-leap-roll", flags: { splittermond: { check: { succeeded: true, degreeOfSuccess: 2 } } } };
        },
    });
    services.waitForDiceSoNice = async (message) => {
        order.push("dice");
        assert.equal(message.id, "evasive-leap-roll");
    };
    services.createTickActionChatCard = async (_context, actionId, ticks, options) => {
        order.push("card");
        assert.equal(actionId, "evasiveLeap");
        assert.equal(ticks, 3);
        assert.equal(options.special, "Probe gelungen: Schaden −3; räumliche Position unverändert");
        return { id: "action-card" };
    };
    services.addCombatTicks = async (_context, ticks) => {
        order.push("ticks");
        return ticks;
    };

    assert.equal(await performTickAction(context, "evasiveLeap", "3"), true);
    assert.deepEqual(order, ["roll", "dice", "card", "ticks"]);
});

test("escaping a grapple offers both skill values directly and requires the opposed difficulty", async () => {
    const rolls = [];
    const cards = [];
    const warnings = [];
    let dialogConfig;
    installTickActionGlobals();
    ui.notifications.warn = (message) => warnings.push(message);
    globalThis.foundry = { applications: { api: { DialogV2: {
        wait: async (config) => {
            dialogConfig = config;
            let guardedClick;
            let focused = 0;
            let reported = 0;
            const input = {
                value: "",
                valueAsNumber: Number.NaN,
                focus: () => focused += 1,
                reportValidity: () => reported += 1,
            };
            const skillButton = {};
            const root = {
                addEventListener: (type, callback, options) => guardedClick = { type, callback, options },
                contains: (candidate) => candidate === skillButton,
                querySelector: () => input,
            };
            config.render(null, { element: root });
            let prevented = 0;
            let stopped = 0;
            guardedClick.callback({
                target: { closest: () => skillButton },
                preventDefault: () => prevented += 1,
                stopImmediatePropagation: () => stopped += 1,
            });
            assert.equal(guardedClick.type, "click");
            assert.deepEqual(guardedClick.options, { capture: true });
            assert.equal(prevented, 1);
            assert.equal(stopped, 1);
            assert.equal(focused, 1);
            assert.equal(reported, 1);
            assert.equal(warnings.length, 1);
            return config.buttons[1].callback(null, {
                form: { elements: { difficulty: { value: "23", valueAsNumber: 23 } } },
            });
        },
    } } } };
    const context = tickActionContext({
        skills: {
            acrobatics: { id: "acrobatics", label: "Akrobatik", value: 18 },
            athletics: { id: "athletics", label: "Athletik", value: 24 },
        },
        rollSkill: async (skillId, options) => {
            rolls.push({ skillId, options });
            return { flags: { splittermond: { check: { succeeded: true, difficulty: options.difficulty } } } };
        },
    });
    services.createTickActionChatCard = async (...args) => {
        cards.push(args);
        return { id: "action-card" };
    };
    services.addCombatTicks = async (_context, ticks) => ticks;

    assert.equal(await performTickAction(context, "escapeGrapple", "5"), true);
    assert.doesNotMatch(dialogConfig.content, /<select/u);
    assert.match(dialogConfig.content, /form-group stacked/u);
    assert.match(dialogConfig.content, /name="difficulty"[^>]*required/u);
    assert.doesNotMatch(dialogConfig.content, /name="difficulty"[^>]*value=/u);
    assert.doesNotMatch(dialogConfig.content, /Pflichtfeld/u);
    assert.deepEqual(dialogConfig.buttons.map((button) => button.action), [
        "skill-acrobatics",
        "skill-athletics",
    ]);
    assert.match(dialogConfig.buttons[0].label, /Akrobatik · FW 18/u);
    assert.match(dialogConfig.buttons[1].label, /Athletik · FW 24/u);
    assert.equal(rolls[0].skillId, "athletics");
    assert.equal(rolls[0].options.difficulty, 23);
    assert.match(cards[0][3].special, /Schwierigkeit 23/u);
});

test("coordinating presets difficulty 21", async () => {
    const rolls = [];
    let cardOptions = "not-created";
    installTickActionGlobals();
    const context = tickActionContext({
        skills: { leadership: { id: "leadership", label: "Anführen" } },
        rollSkill: async (skillId, options) => {
            rolls.push({ skillId, options });
            return { flags: { splittermond: { check: { succeeded: true, difficulty: options.difficulty } } } };
        },
    });
    services.createTickActionChatCard = async (_context, actionId, ticks, options) => {
        assert.equal(actionId, "coordinate");
        assert.equal(ticks, 10);
        cardOptions = options;
        return { id: "action-card" };
    };
    services.addCombatTicks = async (_context, ticks) => ticks;

    assert.equal(await performTickAction(context, "coordinate", "10"), true);
    assert.equal(rolls[0].skillId, "leadership");
    assert.equal(rolls[0].options.difficulty, 21);
    assert.deepEqual(rolls[0].options.preSelectedModifier, ["Koordinieren"]);
    assert.equal(cardOptions, undefined, "the regular coordinate Special text must remain unchanged");
});

function installTickActionGlobals(target = null) {
    const runtimeController = { id: "controller", active: true };
    globalThis.game = {
        i18n: {
            localize: translation,
            format: (key, data) => Object.entries(data).reduce(
                (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
                translation(key)
            ),
        },
    };
    globalThis.ui = { notifications: { warn: () => assert.fail("unexpected warning") } };
    services.getRuntimeController = () => runtimeController;
    services.getTargetSelectionForUser = () => ({
        target,
        targets: target ? [target] : [],
        primaryTargetTokenUuid: target?.uuid ?? null,
        primaryTargetActorUuid: target?.actor?.uuid ?? null,
    });
    services.waitForDiceSoNice = async () => {};
}

function tickActionContext(actorData) {
    return {
        actor: { id: "actor-1", name: "Arrou", items: [], attacks: [], ...actorData },
        combatant: { id: "combatant-1", initiative: 10 },
        combat: { id: "combat-1" },
        token: { id: "token-1", uuid: "Token.arrou", name: "Arrou" },
    };
}

test("choosing a tick action advances its combatant by the selected duration", async () => {
    let renders = 0;
    services.scheduleRender = () => renders++;
    globalThis.game = {
        i18n: {
            localize: translation,
            format: (key, data) => Object.entries(data).reduce(
                (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
                translation(key)
            ),
        },
    };
    globalThis.ui = { notifications: { warn: () => assert.fail("combatant should not be paused") } };

    const combatant = { id: "combatant-1", initiative: 12 };
    const context = {
        actor: {
            name: "Arrou",
            addTicks: async () => {
                combatant.initiative += 6;
            },
        },
        combatant,
        combat: {
            setInitiative: async (_id, initiative) => {
                combatant.initiative = initiative;
            },
        },
    };

    assert.equal(await addCombatTicks(context, "4"), 4);
    assert.equal(combatant.initiative, 16);
    assert.equal(await addCombatTicks(context, "custom"), 6);
    assert.equal(combatant.initiative, 22);
    assert.equal(renders, 2);
});

test("single-target attack mechanics use the primary target without losing secondary targets", async () => {
    const targetA = {
        id: "target-a",
        uuid: "Scene.scene.Token.target-a",
        name: "Ziel A",
        actor: { uuid: "Actor.target-a" },
    };
    const targetB = {
        id: "target-b",
        uuid: "Scene.scene.Token.target-b",
        name: "Ziel B",
        actor: { uuid: "Actor.target-b" },
    };
    const tokenObjectA = { document: targetA };
    const tokenObjectB = { document: targetB };
    targetA.object = tokenObjectA;
    targetB.object = tokenObjectB;
    const systemTargets = new Set([tokenObjectA, tokenObjectB]);
    const attack = { id: "attack-1", name: "Klinge", isRanged: false };
    let rolled = false;
    const actor = {
        id: "attacker",
        attacks: [attack],
        getFlag: () => attack.id,
        rollAttack: async (attackId) => {
            rolled = true;
            assert.equal(attackId, attack.id);
            assert.deepEqual([...systemTargets], [tokenObjectB]);
            assert.deepEqual(getPendingOffenseKind(actor.id).targetTokenUuids, [targetA.uuid, targetB.uuid]);
            assert.equal(getPendingOffenseKind(actor.id).primaryTargetTokenUuid, targetB.uuid);
            return true;
        },
        setFlag: async () => {},
    };
    const gm = { id: "primary-gm", isGM: true, active: true, targets: systemTargets };
    const offlinePlayer = { id: "offline-player", isGM: false, active: false };
    globalThis.game = { user: gm };
    globalThis.canvas = { tokens: { get: () => null } };
    globalThis.ui = { notifications: { warn: () => assert.fail("system target should resolve") } };
    services.scheduleRender = () => {};
    services.withTemporarySystemTargets = withTemporarySystemTargets;
    services.getRuntimeController = () => game.user;
    services.getTargetSelectionForUser = () => ({
        target: targetB,
        targets: [targetA, targetB],
        primaryTargetTokenUuid: targetB.uuid,
        primaryTargetActorUuid: targetB.actor.uuid,
    });

    await performAttack({
        actor,
        assignedUser: offlinePlayer,
        runtimeController: gm,
        target: targetB,
        targets: [targetA, targetB],
        primaryTargetTokenUuid: targetB.uuid,
    }, attack.id);

    assert.equal(rolled, true);
    assert.deepEqual([...systemTargets], [tokenObjectA, tokenObjectB]);
    assert.equal(getPendingOffenseKind(actor.id), undefined);
});

test("attack mechanics can execute a scoped attack view without bypassing target handling", async () => {
    const target = {
        id: "target",
        uuid: "Scene.scene.Token.target",
        actor: { uuid: "Actor.target" },
    };
    const attack = { id: "shield", name: "Schild", isRanged: false };
    let directRolls = 0;
    let scopedRolls = 0;
    const actor = {
        id: "shield-user",
        attacks: [attack],
        getFlag: () => null,
        rollAttack: async () => {
            directRolls += 1;
            return true;
        },
        setFlag: async () => {},
    };
    const user = { id: "user", isGM: true, active: true };
    globalThis.game = { user };
    globalThis.ui = { notifications: { warn: () => assert.fail("the scoped attack has a target") } };
    services.getRuntimeController = () => user;
    services.getTargetSelectionForUser = () => ({
        target,
        targets: [target],
        primaryTargetTokenUuid: target.uuid,
        primaryTargetActorUuid: target.actor.uuid,
    });
    services.withTemporarySystemTargets = async (targets, operation) => {
        assert.deepEqual(targets, [target]);
        return operation();
    };
    services.scheduleRender = () => {};

    const completed = await performAttack({ actor, target }, attack.id, { title: "Schildstoß" }, async (resolved, options) => {
        scopedRolls += 1;
        assert.equal(resolved, attack);
        assert.deepEqual(options, { title: "Schildstoß" });
        return true;
    });

    assert.equal(completed, true);
    assert.equal(scopedRolls, 1);
    assert.equal(directRolls, 0);
    assert.equal(getPendingOffenseKind(actor.id), undefined);
});

test("cancelled attack and spell dialogs clear their pending offense contexts", async () => {
    const target = {
        uuid: "Scene.scene.Token.cancel-target",
        name: "Abbruchziel",
        actor: { uuid: "Actor.cancel-target" },
    };
    const attack = { id: "cancelled-attack", name: "Klinge", isRanged: false };
    const spell = { id: "cancelled-spell", name: "Flammenstrahl", difficulty: "VTD" };
    const attackActor = {
        id: "cancelled-attacker",
        attacks: [attack],
        getFlag: () => attack.id,
        rollAttack: async () => false,
        setFlag: async () => assert.fail("a cancelled attack must not change preparation flags"),
    };
    const spellActor = {
        id: "cancelled-caster",
        spells: [spell],
        getFlag: () => spell.id,
        rollSpell: async () => false,
    };
    const user = { id: "user", selection: { target, targets: [target] } };
    globalThis.game = { user };
    globalThis.ui = { notifications: { warn: () => assert.fail("both actions have a target") } };
    services.getRuntimeController = () => user;
    services.getTargetSelectionForUser = (runtimeController) => runtimeController.selection;
    services.withTemporarySystemTargets = async (_targets, operation) => operation();
    services.scheduleRender = () => {};

    assert.equal(await performAttack({ actor: attackActor }, attack.id), false);
    assert.equal(getPendingOffenseKind(attackActor.id), undefined);

    await performSpell({ actor: spellActor }, spell.id);
    assert.equal(getPendingOffenseKind(spellActor.id), undefined);
});

test("an older roll completion cannot clear a newer pending offense context", async () => {
    const attack = { id: "overlapping-attack", name: "Klinge", isRanged: false };
    const targetA = {
        uuid: "Scene.scene.Token.overlap-a",
        name: "Ziel A",
        actor: { uuid: "Actor.overlap-a" },
    };
    const targetB = {
        uuid: "Scene.scene.Token.overlap-b",
        name: "Ziel B",
        actor: { uuid: "Actor.overlap-b" },
    };
    let resolveFirst;
    let resolveSecond;
    const firstRoll = new Promise((resolve) => resolveFirst = resolve);
    const secondRoll = new Promise((resolve) => resolveSecond = resolve);
    let rollCount = 0;
    const actor = {
        id: "overlapping-attacker",
        attacks: [attack],
        getFlag: () => attack.id,
        rollAttack: () => {
            rollCount += 1;
            return rollCount === 1 ? firstRoll : secondRoll;
        },
        setFlag: async () => assert.fail("cancelled attacks must not change preparation flags"),
    };
    const user = { id: "user", selection: { target: targetA, targets: [targetA] } };
    globalThis.game = { user };
    globalThis.ui = { notifications: { warn: () => assert.fail("both actions have a target") } };
    services.getRuntimeController = () => user;
    services.getTargetSelectionForUser = (runtimeController) => runtimeController.selection;
    services.withTemporarySystemTargets = async (_targets, operation) => operation();
    services.scheduleRender = () => {};

    const firstOperation = performAttack({ actor }, attack.id);
    await Promise.resolve();
    const firstPending = getPendingOffenseKind(actor.id);
    assert.equal(firstPending.primaryTargetTokenUuid, targetA.uuid);

    user.selection = { target: targetB, targets: [targetB] };
    const secondOperation = performAttack({ actor }, attack.id);
    await Promise.resolve();
    const secondPending = getPendingOffenseKind(actor.id);
    assert.equal(secondPending.primaryTargetTokenUuid, targetB.uuid);
    assert.notEqual(secondPending.nonce, firstPending.nonce);

    resolveFirst(false);
    assert.equal(await firstOperation, false);
    assert.equal(getPendingOffenseKind(actor.id), secondPending);

    resolveSecond(false);
    assert.equal(await secondOperation, false);
    assert.equal(getPendingOffenseKind(actor.id), undefined);
});

test("temporary Splittermond system targets are restored when a roll fails", async () => {
    const original = { document: { uuid: "Scene.scene.Token.original" } };
    const primary = { document: { uuid: "Scene.scene.Token.primary" } };
    const systemTargets = new Set([original]);
    globalThis.game = { user: { targets: systemTargets } };
    globalThis.ui = { notifications: { warn: () => assert.fail("target object is available") } };

    await assert.rejects(
        withTemporarySystemTargets([primary], async () => {
            assert.deepEqual([...systemTargets], [primary]);
            throw new Error("roll failed");
        }),
        /roll failed/u,
    );
    assert.deepEqual([...systemTargets], [original]);
});

test("clickable tick actions create a public chat card for the acting token", async () => {
    const created = [];
    const actor = { id: "actor-1", name: "Arrou" };
    const token = { id: "token-1", uuid: "Scene.scene-1.Token.token-1", name: "Arrou der Flinke" };

    globalThis.game = {
        i18n: {
            localize: translation,
            format: (key, data) => Object.entries(data).reduce(
                (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
                translation(key)
            ),
        },
    };
    globalThis.ChatMessage = {
        getSpeaker: (options) => ({ actor: options.actor.id, token: options.token.id }),
        create: async (data) => {
            created.push(data);
            return { id: "message-1", ...data };
        },
    };

    await createTickActionChatCard({ actor, token, combatant: { name: "Fallback" } }, "searchOpening", "4");

    assert.equal(created.length, 1);
    assert.deepEqual(created[0].speaker, { actor: "actor-1", token: "token-1" });
    assert.match(created[0].content, /Arrou der Flinke/u);
    assert.match(created[0].content, /Lücke suchen/u);
    assert.match(created[0].content, /4 Ticks/u);
    assert.match(created[0].content, /Kontinuierliche Aktion/u);
    assert.match(created[0].content, /beobachtet den Gegner/u);
    assert.match(created[0].content, /\+1 auf Nahkampfangriff pro 2 Ticks/u);
    assert.match(created[0].content, /sf-tick-action-chat-source/u);
    assert.match(created[0].content, /Quelle: GRW, S\. 161/u);
    assert.deepEqual(created[0].flags["splittermond-smoother-fight"].tickAction, {
        id: "searchOpening",
        ticks: "4",
        tokenUuid: "Scene.scene-1.Token.token-1",
    });
});

test("VTD splinterpoints and resonance report their reason and new defense in chat", async () => {
    const created = [];
    const actor = { id: "actor-splinter", uuid: "Actor.actor-splinter", name: "Arrou" };
    const token = { id: "token-splinter", uuid: "Scene.scene.Token.token-splinter", name: "Arrou" };
    globalThis.game = {
        i18n: {
            localize: translation,
            format: (key, data) => Object.entries(data).reduce(
                (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
                translation(key)
            ),
        },
    };
    globalThis.ChatMessage = {
        getSpeaker: (options) => ({ actor: options.actor.id, token: options.token.id }),
        create: async (data) => {
            created.push(data);
            return { id: `message-${created.length}`, ...data };
        },
    };

    await createDefenseSplinterpointChatCard({
        actor,
        token,
        targetName: "XYZ",
        targetTokenUuid: "Scene.scene.Token.xyz",
        defenseValue: 27,
        kind: "primary",
        attackMessageId: "attack-1",
    });
    await createDefenseSplinterpointChatCard({
        actor,
        token,
        targetName: "XYZ",
        targetTokenUuid: "Scene.scene.Token.xyz",
        defenseValue: 29,
        kind: "resonance",
        attackMessageId: "attack-1",
    });

    assert.equal(created.length, 2);
    assert.deepEqual(created[0].speaker, { actor: actor.id, token: token.id });
    assert.match(created[0].content, /Grund/u);
    assert.match(created[0].content, /Splitterpunkt: \+3 VTD/u);
    assert.match(created[0].content, /Neue VTD/u);
    assert.match(created[0].content, />27</u);
    assert.match(created[1].content, /Splitterpunkt-Resonanz: weitere \+2 VTD/u);
    assert.match(created[1].content, />29</u);
    assert.deepEqual(created[1].flags["splittermond-smoother-fight"].defenseSplinterpoint, {
        attackMessageId: "attack-1",
        actorUuid: actor.uuid,
        targetTokenUuid: "Scene.scene.Token.xyz",
        kind: "resonance",
        defenseValue: 29,
    });
});

test("walking and sprinting chat cards include the measured token movement", async () => {
    const created = [];
    let measuredDistance = 7;
    const actor = { id: "actor-1", name: "Arrou" };
    const token = {
        id: "token-1",
        uuid: "Scene.scene-1.Token.token-1",
        name: "Arrou der Flinke",
        movementHistory: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        measureMovementPath: () => ({ distance: measuredDistance }),
    };

    globalThis.game = {
        i18n: {
            lang: "de",
            localize: translation,
            format: (key, data) => Object.entries(data).reduce(
                (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
                translation(key)
            ),
        },
    };
    globalThis.ChatMessage = {
        getSpeaker: (options) => ({ actor: options.actor.id, token: options.token.id }),
        create: async (data) => {
            created.push(data);
            return { id: `message-${created.length}`, ...data };
        },
    };

    await createTickActionChatCard({ actor, token }, "walk", "5");
    measuredDistance = 18;
    await createTickActionChatCard({ actor, token }, "sprint", "10");

    assert.match(created[0].content, /GSW in m \(7 m bewegt\)/u);
    assert.match(created[1].content, /3 × GSW in m \(18 m bewegt\)/u);
});
