import assert from "node:assert/strict";
import test from "node:test";

import {
    bindActionTooltips,
    buildAttackTooltipModel,
    buildEquipmentTooltipModel,
    resolveActionItem,
} from "../Modul/splittermond-smoother-fight/scripts/features/hud/action-tooltips.js";

const translations = {
    "SMOOTHER_FIGHT.HUD.AttackRangeValue": "{range} m",
    "SMOOTHER_FIGHT.HUD.DefaultAttack": "Standardangriff",
    "SMOOTHER_FIGHT.HUD.EquippedStatus": "Ausgerüstet",
    "SMOOTHER_FIGHT.HUD.PreparedAttack": "Vorbereiteter Fernkampfangriff",
    "SMOOTHER_FIGHT.HUD.UnequippedStatus": "Nicht ausgerüstet",
    "splittermond.skillLabel.longrange": "Schusswaffen",
};

globalThis.game = {
    i18n: {
        localize: (key) => translations[key] ?? key,
        format: (key, data) => (translations[key] ?? key).replace(/\{([^}]+)\}/gu, (_match, name) => data[name]),
    },
};

test("attack tooltip model exposes current melee combat values without ranged-only state", () => {
    const attack = {
        id: "sword",
        name: "Langschwert",
        img: "sword.webp",
        skill: { id: "blades", label: "Klingenwaffen", value: { value: 16 } },
        damage: "1W6+4",
        features: "Scharf 2, Vielseitig",
        range: 12,
    };
    const actor = {
        attacks: [attack],
        getFlag: (scope, key) => scope === "splittermond" && key === "preparedAttack" ? "sword" : null,
    };

    assert.deepEqual(buildAttackTooltipModel(actor, attack, { display: 8 }, false), {
        name: "Langschwert",
        img: "sword.webp",
        skill: "Klingenwaffen 16",
        speed: 8,
        damage: "1W6+4",
        features: "Scharf 2, Vielseitig",
        range: "",
        statuses: ["Standardangriff"],
    });
});

test("attack tooltip model adds range and prepared state for ranged attacks", () => {
    const sword = { id: "sword" };
    const bow = {
        id: "bow",
        name: "Langbogen",
        skill: { label: "Schusswaffen", value: 18 },
        damage: "1W10+2",
        features: "",
        featuresAsRef: { featuresAsStringList: () => ["Durchdringung 2"] },
        range: { value: 25 },
    };
    const actor = {
        attacks: [sword, bow],
        getFlag: (scope, key) => {
            if (scope === "splittermond-smoother-fight" && key === "defaultAttackId") return "bow";
            if (scope === "splittermond" && key === "preparedAttack") return "bow";
            return null;
        },
    };

    const model = buildAttackTooltipModel(actor, bow, 10, true);
    assert.equal(model.range, "25 m");
    assert.equal(model.features, "Durchdringung 2");
    assert.deepEqual(model.statuses, ["Standardangriff", "Vorbereiteter Fernkampfangriff"]);
});

test("action item resolution maps secondary attack ids back to their source item", () => {
    const item = { id: "weapon", sheet: {} };
    const actor = {
        attacks: [{ id: "weapon_secondary", item }],
        items: new Map([["weapon", item]]),
        spells: [],
    };

    assert.equal(resolveActionItem(actor, { dataset: { attackId: "weapon_secondary" } }), item);
    assert.equal(resolveActionItem(actor, { dataset: { itemId: "weapon" } }), item);
});

test("equipment tooltip model exposes base values and unequipped state without a live attack", () => {
    const item = {
        id: "bow",
        name: "Langbogen",
        img: "bow.webp",
        system: {
            equipped: false,
            skill: "longrange",
            weaponSpeed: { display: 11 },
            damage: "1W10+2",
            features: { features: "Durchdringung 2" },
            range: 25,
        },
    };
    const actor = {
        attacks: [{ id: "sword" }],
        skills: { longrange: { id: "longrange", label: "Schusswaffen", value: 17 } },
        getFlag: () => null,
    };

    assert.deepEqual(buildEquipmentTooltipModel(actor, item, null, "", true), {
        name: "Langbogen",
        img: "bow.webp",
        skill: "Schusswaffen 17",
        speed: 11,
        damage: "1W10+2",
        features: "Durchdringung 2",
        range: "25 m",
        statuses: ["Nicht ausgerüstet"],
    });
});

test("tooltip binding covers attacks and equipment on hover and keyboard focus", () => {
    const attackListeners = new Map();
    const equipmentListeners = new Map();
    const attackButton = {
        dataset: { attackId: "sword", sfAction: "attack" },
        addEventListener: (name, listener) => attackListeners.set(name, listener),
    };
    const equipmentButton = {
        dataset: { itemId: "sword", sfAction: "toggle-equipped" },
        addEventListener: (name, listener) => equipmentListeners.set(name, listener),
    };
    const root = {
        querySelectorAll: (selector) => {
            if (selector.includes('data-sf-action="attack"')) return [attackButton];
            if (selector.includes('data-sf-action="toggle-equipped"')) return [equipmentButton];
            return [];
        },
    };
    const item = { id: "sword", system: { equipped: true } };
    const actor = { attacks: [{ id: "sword", item }], items: new Map([["sword", item]]), spells: [] };

    bindActionTooltips(root, { actor });
    assert.deepEqual([...attackListeners.keys()], ["mouseenter", "mouseleave", "focus", "blur"]);
    assert.deepEqual([...equipmentListeners.keys()], ["mouseenter", "mouseleave", "focus", "blur"]);
});
