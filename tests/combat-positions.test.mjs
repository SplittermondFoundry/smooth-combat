import assert from "node:assert/strict";
import test from "node:test";

import { MODULE_ID } from "../Modul/splittermond-smoother-fight/scripts/core/constants.js";
import {
    COMBAT_POSITION_ICONS,
    combatPositionFromItem,
    getCombatPositionStatusData,
    resolveCombatPosition,
    setCombatPosition,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-positions/positions.js";
import {
    combatPositionOverlayPresentation,
    refreshCombatPositionOverlay,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-positions/overlay.js";
import { renderTokenCombatPositionControl } from "../Modul/splittermond-smoother-fight/scripts/features/combat-positions/token-hud.js";
import { getBundledFumbleStatusEffectData } from "../Modul/splittermond-smoother-fight/scripts/features/fumbles/status-effect-templates.js";

const TRANSLATIONS = {
    "SMOOTHER_FIGHT.StatusEffects.CombatPositions.kneeling.Name": "Kniend",
    "SMOOTHER_FIGHT.StatusEffects.CombatPositions.kneeling.Description": "Kniend-Beschreibung",
    "SMOOTHER_FIGHT.StatusEffects.CombatPositions.kneeling.Source": "Kniend-Quelle",
    "SMOOTHER_FIGHT.StatusEffects.CombatPositions.prone.Name": "Liegend",
    "SMOOTHER_FIGHT.StatusEffects.CombatPositions.prone.Description": "Liegend-Beschreibung",
    "SMOOTHER_FIGHT.StatusEffects.CombatPositions.prone.Source": "Liegend-Quelle",
    "SMOOTHER_FIGHT.StatusEffects.CombatPositions.flying.Name": "Fliegend",
    "SMOOTHER_FIGHT.StatusEffects.CombatPositions.flying.Description": "Fliegend-Beschreibung",
    "SMOOTHER_FIGHT.StatusEffects.CombatPositions.flying.Source": "Fliegend-Quelle",
};

test.beforeEach(() => {
    globalThis.game = {
        i18n: {
            localize: (key) => TRANSLATIONS[key] ?? key,
            format: (key) => TRANSLATIONS[key] ?? key,
        },
    };
});

test("only active status effects count as combat positions", () => {
    const actor = actorWithItems([
        item("spell", "Fliegend", "spelleffect", 1),
        item("feature", "Fliegend", "npcfeature", 1),
        item("inactive", "Kniend", "statuseffect", 0),
        item("prone", "Liegend", "statuseffect", 1),
    ]);

    assert.deepEqual(resolveCombatPosition(actor), {
        id: "prone",
        ambiguous: false,
        markers: [actor.items[3]],
        positions: ["prone"],
    });
    assert.equal(combatPositionFromItem(actor.items[0]), null);
    assert.equal(combatPositionFromItem(actor.items[1]), null);
});

test("module flags make localized or renamed status markers unambiguous", () => {
    const marker = item("flying", "Schwebend", "statuseffect", 2, {
        [MODULE_ID]: { combatPosition: "flying" },
    });

    assert.equal(combatPositionFromItem(marker), "flying");
    assert.equal(resolveCombatPosition(actorWithItems([marker])).id, "flying");
});

test("multiple active positions are reported as a conflict", () => {
    const actor = actorWithItems([
        item("kneeling", "Kniend", "statuseffect", 1),
        item("flying", "Fliegend", "statuseffect", 1),
    ]);

    const result = resolveCombatPosition(actor);
    assert.equal(result.id, null);
    assert.equal(result.ambiguous, true);
    assert.deepEqual(result.positions, ["kneeling", "flying"]);
});

test("a combat position marker is self-contained and has no persistent modifier", () => {
    const marker = getCombatPositionStatusData("flying");

    assert.equal(marker.name, "Fliegend");
    assert.equal(marker.type, "statuseffect");
    assert.equal(marker.system.level, 1);
    assert.equal(marker.system.modifier, "");
    assert.equal(Object.hasOwn(marker.system, "active"), false);
    assert.deepEqual(marker.flags[MODULE_ID], { combatPosition: "flying" });
    assert.equal(getCombatPositionStatusData("kneeling").img, "icons/svg/leg.svg");
    assert.equal(getCombatPositionStatusData("prone").img, "icons/svg/falling.svg");
    assert.equal(getCombatPositionStatusData("flying").img, "icons/svg/wing.svg");
});

test("combat position overlays use the requested core icon paths", () => {
    assert.deepEqual(COMBAT_POSITION_ICONS, {
        standing: null,
        kneeling: "icons/svg/leg.svg",
        prone: "icons/svg/falling.svg",
        flying: "icons/svg/wing.svg",
    });
    assert.deepEqual(combatPositionOverlayPresentation(actorWithItems([
        item("kneeling", "Kniend", "statuseffect", 1),
    ])), { id: "kneeling", icon: "icons/svg/leg.svg" });
    assert.equal(combatPositionOverlayPresentation(actorWithItems([])), null);
});

test("the token overlay follows position changes and is removed for standing", async (t) => {
    const originalFoundry = globalThis.foundry;
    const originalPixi = globalThis.PIXI;
    globalThis.foundry = { canvas: { loadTexture: async (icon) => ({ icon }) } };
    globalThis.PIXI = { Sprite: FakeSprite };
    t.after(() => {
        globalThis.foundry = originalFoundry;
        globalThis.PIXI = originalPixi;
    });
    const actor = actorWithItems([item("prone", "Liegend", "statuseffect", 1)]);
    const token = fakeCanvasToken(actor, 200, 100);

    assert.equal(await refreshCombatPositionOverlay(token), true);
    assert.equal(token.children.length, 1);
    assert.equal(token.children[0].texture.icon, "icons/svg/falling.svg");
    assert.deepEqual([token.children[0].x, token.children[0].y], [100, 50]);
    assert.deepEqual([token.children[0].width, token.children[0].height], [62, 62]);

    actor.items = [item("flying", "Fliegend", "statuseffect", 1)];
    await refreshCombatPositionOverlay(token);
    assert.equal(token.children.length, 1);
    assert.equal(token.children[0].texture.icon, "icons/svg/wing.svg");

    actor.items = [];
    await refreshCombatPositionOverlay(token);
    assert.equal(token.children.length, 0);
});

test("a GM can set a token position through the Token HUD palette", async (t) => {
    const originalDocument = globalThis.document;
    const originalFoundry = globalThis.foundry;
    const originalHTMLElement = globalThis.HTMLElement;
    const originalPixi = globalThis.PIXI;
    globalThis.HTMLElement = FakeElement;
    globalThis.document = { createElement: () => new FakeElement() };
    globalThis.foundry = { canvas: { loadTexture: async (icon) => ({ icon }) } };
    globalThis.PIXI = { Sprite: FakeSprite };
    globalThis.game.user = { isGM: true };
    t.after(() => {
        globalThis.document = originalDocument;
        globalThis.foundry = originalFoundry;
        globalThis.HTMLElement = originalHTMLElement;
        globalThis.PIXI = originalPixi;
    });
    const actor = new TestActor();
    actor.isOwner = false;
    const token = fakeCanvasToken(actor);
    token.document = { actor };
    const root = new FakeElement();
    const column = new FakeElement("col right");
    root.append(column);
    const paletteToggles = [];
    const app = {
        object: token,
        togglePalette: (...args) => paletteToggles.push(args),
    };

    renderTokenCombatPositionControl(app, root);

    const controls = root.querySelectorAll(".sf-token-position-control");
    assert.equal(controls.length, 1);
    assert.equal(controls[0].dataset.action, "togglePalette");
    const palette = root.querySelector(".sf-combat-position-palette");
    assert.ok(palette);
    assert.equal(controls[0].dataset.palette, palette.dataset.palette);
    assert.equal(palette.classList.contains("status-effects"), true);
    const choices = root.querySelectorAll(".sf-combat-position-choice");
    assert.deepEqual(choices.map((choice) => choice.dataset.combatPosition), [
        "standing", "kneeling", "prone", "flying",
    ]);
    assert.equal(choices[0].classList.contains("active"), true);
    await choices[1].dispatch("click", clickEvent());
    assert.equal(resolveCombatPosition(actor).id, "kneeling");
    assert.equal(token.children[0].texture.icon, "icons/svg/leg.svg");
    assert.equal(choices[1].classList.contains("active"), true);
    assert.match(controls[0].innerHTML, /icons\/svg\/leg\.svg/u);
    assert.deepEqual(paletteToggles, [[controls[0].dataset.palette, false]]);
});

test("positions can be switched and cleared on a clean actor", async () => {
    const unrelated = item("burning", "Brennend", "statuseffect", 1);
    const actor = new TestActor([unrelated]);

    await setCombatPosition(actor, "kneeling");
    assert.equal(resolveCombatPosition(actor).id, "kneeling");
    assert.equal(actor.items.length, 2);
    assert.equal(actor.createdSources[0].system.combatEvent.interval, 1);
    assert.equal(actor.items[1].system.combatEvent.startTick, null);
    assert.equal(actor.items[1].system.combatEvent.interval, null);
    assert.equal(actor.items[1].system.combatEvent.repeats, null);

    await setCombatPosition(actor, "flying");
    assert.equal(resolveCombatPosition(actor).id, "flying");
    assert.equal(actor.items.length, 2);
    assert.equal(actor.items.includes(unrelated), true);

    await setCombatPosition(actor, "standing");
    assert.deepEqual(resolveCombatPosition(actor), {
        id: "standing",
        ambiguous: false,
        markers: [],
        positions: [],
    });
    assert.deepEqual(actor.items, [unrelated]);
});

test("a failed creation leaves the previous position untouched", async () => {
    const prone = item("prone", "Liegend", "statuseffect", 1);
    const actor = new TestActor([prone]);
    actor.failCreation = true;

    await assert.rejects(() => setCombatPosition(actor, "flying"), /creation failed/u);
    assert.equal(resolveCombatPosition(actor).id, "prone");
    assert.deepEqual(actor.deletedIds, []);
});

test("a failed compatibility cleanup rolls the temporary marker back", async () => {
    const prone = item("prone", "Liegend", "statuseffect", 1);
    const actor = new TestActor([prone]);
    actor.failUpdate = true;

    await assert.rejects(() => setCombatPosition(actor, "flying"), /update failed/u);
    assert.equal(resolveCombatPosition(actor).id, "prone");
    assert.deepEqual(actor.items, [prone]);
    assert.deepEqual(actor.deletedIds, ["created-1"]);
});

test("the bundled fumble fallback creates the same neutral prone marker", () => {
    assert.equal(getBundledFumbleStatusEffectData("Liegend").system.modifier, "");
});

class TestActor {
    constructor(items = []) {
        this.items = items;
        this.nextId = 1;
        this.createdSources = [];
        this.deletedIds = [];
        this.failCreation = false;
        this.failUpdate = false;
    }

    async createEmbeddedDocuments(documentName, sources) {
        assert.equal(documentName, "Item");
        if (this.failCreation) throw new Error("creation failed");
        this.createdSources.push(...structuredClone(sources));
        const created = sources.map((source) => ({
            ...structuredClone(source),
            _id: `created-${this.nextId++}`,
        }));
        for (const item of created) {
            if (item.system.combatEvent.interval) item.system.combatEvent.startTick = 101;
        }
        this.items.push(...created);
        return created;
    }

    async updateEmbeddedDocuments(documentName, changes) {
        assert.equal(documentName, "Item");
        if (this.failUpdate) throw new Error("update failed");
        for (const change of changes) {
            const existing = this.items.find((candidate) => (candidate.id ?? candidate._id) === change._id);
            if (existing && Object.hasOwn(change, "system.level")) existing.system.level = change["system.level"];
            if (!existing) continue;
            for (const key of ["startTick", "interval", "repeats", "postDescription"]) {
                const path = `system.combatEvent.${key}`;
                if (Object.hasOwn(change, path)) existing.system.combatEvent[key] = change[path];
            }
        }
    }

    async deleteEmbeddedDocuments(documentName, ids) {
        assert.equal(documentName, "Item");
        this.deletedIds.push(...ids);
        this.items = this.items.filter((candidate) => !ids.includes(candidate.id ?? candidate._id));
    }
}

function actorWithItems(items) {
    return { items };
}

function item(id, name, type, level, flags = {}) {
    return { _id: id, name, type, system: { level }, flags };
}

class FakeSprite {
    constructor(texture) {
        this.texture = texture;
        this.anchor = { set: (x, y) => this.anchorValue = [x, y] };
    }

    static from(texture) {
        return new FakeSprite(texture);
    }

    destroy() {
        this.destroyed = true;
    }
}

class FakeElement {
    constructor(className = "") {
        this.attributes = new Map();
        this.children = [];
        this.className = className;
        this.dataset = {};
        this.disabled = false;
        this.listeners = new Map();
        this.parentElement = null;
        this.style = {
            setProperty: () => {},
        };
        this.classList = {
            contains: (name) => this.className.split(/\s+/u).includes(name),
            toggle: (name, active) => {
                const names = new Set(this.className.split(/\s+/u).filter(Boolean));
                if (active) names.add(name);
                else names.delete(name);
                this.className = [...names].join(" ");
            },
        };
    }

    addEventListener(name, callback) {
        this.listeners.set(name, callback);
    }

    append(...children) {
        for (const child of children) {
            child.parentElement = this;
            this.children.push(child);
        }
    }

    async dispatch(name, event) {
        return this.listeners.get(name)?.(event);
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }

    querySelector(selector) {
        if (selector === ".col.right") return this.descendants().find((element) =>
            element.classList.contains("col") && element.classList.contains("right")
        ) ?? null;
        if (selector === ".right") return this.descendants().find((element) =>
            element.classList.contains("right")
        ) ?? null;
        return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector) {
        if (!selector.startsWith(".")) return [];
        const className = selector.slice(1);
        return this.descendants().filter((element) => element.classList.contains(className));
    }

    remove() {
        if (!this.parentElement) return;
        this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
        this.parentElement = null;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    descendants() {
        return this.children.flatMap((child) => [child, ...child.descendants()]);
    }
}

function fakeCanvasToken(actor, width = 100, height = 100) {
    const token = {
        actor,
        children: [],
        h: height,
        w: width,
        addChild(child) {
            child.parent = this;
            this.children.push(child);
        },
        removeChild(child) {
            this.children = this.children.filter((candidate) => candidate !== child);
            child.parent = null;
        },
    };
    return token;
}

function clickEvent() {
    return {
        key: null,
        preventDefault() {},
        stopPropagation() {},
    };
}
