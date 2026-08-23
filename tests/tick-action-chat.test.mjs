import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createTickActionChatCard } from "../Modul/splittermond-smoother-fight/scripts/features/chat/messages.js";
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

test("disengaging offers Acrobatics and an eligible wielded retreat-fighting skill before advancing ticks", async () => {
    const order = [];
    let dialogContent = "";
    const target = { name: "Rattling", uuid: "Token.rattling", actor: { name: "Rattling" } };
    installTickActionGlobals(target);
    globalThis.CONFIG = { splittermond: { skillGroups: { fighting: ["blades", "staffs"] } } };
    globalThis.foundry = { applications: { api: { DialogV2: {
        wait: async (config) => {
            dialogContent = config.content;
            return config.buttons[0].callback(null, { form: { elements: { choice: { value: "blades" } } } });
        },
    } } } };
    const context = tickActionContext({
        skills: {
            acrobatics: { id: "acrobatics", label: "Akrobatik" },
            blades: { id: "blades", label: "Klingenwaffen" },
            staffs: { id: "staffs", label: "Stangenwaffen" },
        },
        attacks: [
            { item: { type: "weapon", system: { equipped: true } }, skill: { id: "blades" } },
        ],
        items: [
            { type: "mastery", name: "Rückzugsgefecht", system: { skill: "blades" } },
            { type: "mastery", name: "Rückzugsgefecht", system: { skill: "staffs" } },
        ],
        rollSkill: async (skillId, options) => {
            order.push("roll");
            assert.equal(skillId, "blades");
            assert.equal(options.difficulty, "GW");
            return { id: "roll-message", flags: { splittermond: { check: { succeeded: true } } } };
        },
    });
    services.withTemporarySystemTargets = async (targets, operation) => {
        assert.deepEqual(targets, [target]);
        return operation();
    };
    services.createTickActionChatCard = async (_context, actionId, ticks, options) => {
        order.push("card");
        assert.equal(actionId, "disengage");
        assert.equal(ticks, 5);
        assert.equal(options.special, "Klingenwaffen gegen den GW von Rattling");
        return { id: "action-card" };
    };
    services.addCombatTicks = async (_context, ticks) => {
        order.push("ticks");
        return ticks;
    };

    assert.equal(await performTickAction(context, "disengage", "5"), true);
    assert.match(dialogContent, /Akrobatik/u);
    assert.match(dialogContent, /Klingenwaffen/u);
    assert.doesNotMatch(dialogContent, /Stangenwaffen/u, "a mastery without a wielded associated weapon is ineligible");
    assert.deepEqual(order, ["roll", "card", "ticks"]);
});

test("shield bash delegates to the equipped Splittermond shield attack without an extra card or tick movement", async () => {
    const order = [];
    const target = { name: "Ork", uuid: "Token.orc", actor: { name: "Ork" } };
    installTickActionGlobals(target);
    const shieldAttack = {
        id: "shield-attack",
        name: "Großschild",
        item: { type: "shield", system: { equipped: true } },
        skill: { id: "blades" },
    };
    const context = tickActionContext({
        skills: { blades: { id: "blades", label: "Klingenwaffen" } },
        attacks: [shieldAttack],
    });
    services.performAttack = async (_context, attackId, options) => {
        order.push("roll");
        assert.equal(attackId, shieldAttack.id);
        assert.equal(options, undefined);
        return true;
    };
    services.getAttackSpeed = async () => assert.fail("shield bash must not calculate its own tick cost");
    services.createTickActionChatCard = async () => assert.fail("shield bash must not create an extra chat card");
    services.addCombatTicks = async () => assert.fail("shield bash must not move the combatant itself");

    assert.equal(await performTickAction(context, "shieldBash", "7"), true);
    assert.deepEqual(order, ["roll"]);
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
    assert.deepEqual(getPendingOffenseKind(actor.id).targetTokenUuids, [targetA.uuid, targetB.uuid]);
    assert.equal(getPendingOffenseKind(actor.id).primaryTargetTokenUuid, targetB.uuid);
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
