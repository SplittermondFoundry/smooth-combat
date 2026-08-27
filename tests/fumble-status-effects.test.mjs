import assert from "node:assert/strict";
import test from "node:test";

import { FUMBLE_STATUS_EFFECT_NAMES } from "../Modul/splittermond-smoother-fight/scripts/features/fumbles/status-effect-templates.js";
import {
    applyFumbleConditions,
    resolveFumbleStatusEffectCreateData,
} from "../Modul/splittermond-smoother-fight/scripts/features/fumbles/status-effects.js";
import {
    extractFumbleEffects,
    getFumbleActionKeys,
} from "../Modul/splittermond-smoother-fight/scripts/features/fumbles/fumbles.js";

const EXPECTED_FUMBLE_STATUS_EFFECTS = [
    "Angsterfüllt",
    "Benommen",
    "Blutend",
    "Brennend",
    "Erschöpft",
    "Glaubenskrise",
    "Liegend",
    "Sterbend",
    "Verwundet",
];

test.beforeEach(() => {
    globalThis.foundry = { utils: { deepClone: structuredClone } };
    globalThis.game = {
        i18n: { lang: "de" },
        items: [],
        packs: new Map(),
    };
    delete globalThis.fromUuid;
    delete globalThis.fromUuidSync;
});

test("bundled fallbacks cover every condition in Splittermond's fumble tables", async () => {
    assert.deepEqual([...FUMBLE_STATUS_EFFECT_NAMES].sort(), EXPECTED_FUMBLE_STATUS_EFFECTS);
    const actor = new TestActor();

    await applyFumbleConditions(actor, FUMBLE_STATUS_EFFECT_NAMES.map((name, index) => ({
        name,
        level: index + 1,
    })));

    assert.equal(actor.created.length, EXPECTED_FUMBLE_STATUS_EFFECTS.length);
    for (const [index, item] of actor.created.entries()) {
        assert.equal(item.name, FUMBLE_STATUS_EFFECT_NAMES[index]);
        assert.equal(item.type, "statuseffect");
        assert.equal(item.system.level, index + 1);
        assert.equal(typeof item.system.description, "string");
        assert.equal(typeof item.system.modifier, "string");
        assert.deepEqual(item.system.combatEvent.macroRef, { name: null, uuid: null });
        assert.equal(item.system.combatEvent.postDescription, true);
        assert.deepEqual(item.effects, []);
    }
});

test("an existing actor condition is increased without resolving another template", async () => {
    const actor = new TestActor();
    const existing = actor.addExisting("Erschöpft", 2);
    globalThis.game.items = [{
        name: "Erschöpft",
        type: "statuseffect",
        toObject: () => {
            throw new Error("world template must not be read");
        },
    }];

    await applyFumbleConditions(actor, [{ name: "erschöpft", level: 3 }]);

    assert.equal(existing.system.level, 5);
    assert.equal(actor.created.length, 0);
});

test("a matching world Item is preferred over UUID and compendium templates", async () => {
    let uuidCalls = 0;
    let packCalls = 0;
    globalThis.game.items = [{
        _id: "world-id",
        name: "Erschöpft",
        type: "statuseffect",
        toObject: () => ({
            _id: "world-id",
            name: "Erschöpft",
            type: "statuseffect",
            img: "world.webp",
            system: {
                description: "world template",
                source: "world",
                modifier: "world.modifier -1",
                level: 1,
                combatEvent: emptyCombatEvent(),
            },
        }),
    }];
    globalThis.fromUuid = async () => {
        uuidCalls += 1;
        return null;
    };
    globalThis.game.packs = packCollection({
        collection: "splittermond.statuseffects",
        documentName: "Item",
        getIndex: async () => {
            packCalls += 1;
            return [];
        },
    });

    const item = await resolveFumbleStatusEffectCreateData({
        uuid: "Compendium.splittermond.statuseffects.Item.Erschöpft",
        name: "Erschöpft",
        level: 4,
    });

    assert.equal(uuidCalls, 0);
    assert.equal(packCalls, 0);
    assert.equal(item._id, undefined);
    assert.equal(item.img, "world.webp");
    assert.equal(item.system.description, "world template");
    assert.equal(item.system.level, 4);
});

test("compendium UUIDs are loaded asynchronously instead of using their v14 index entry", async () => {
    let syncCalls = 0;
    let asyncCalls = 0;
    globalThis.fromUuidSync = () => {
        syncCalls += 1;
        return { _id: "index-only", name: "Benommen", type: "statuseffect" };
    };
    globalThis.fromUuid = async () => {
        asyncCalls += 1;
        return statusDocument("Benommen", "uuid document");
    };

    const item = await resolveFumbleStatusEffectCreateData({
        uuid: "Compendium.splittermond.statuseffects.Item.Benommen",
        name: "Benommen",
        level: 2,
    });

    assert.equal(syncCalls, 0);
    assert.equal(asyncCalls, 1);
    assert.equal(item.system.description, "uuid document");
    assert.equal(item.system.level, 2);
});

test("a full compendium document is found by name when its UUID cannot be resolved", async () => {
    const pack = {
        collection: "splittermond.statuseffects",
        documentName: "Item",
        getIndex: async (options) => {
            assert.deepEqual(options, { fields: ["name", "type"] });
            return [{ _id: "bleeding-id", name: "Blutend", type: "statuseffect" }];
        },
        getDocument: async (id) => {
            assert.equal(id, "bleeding-id");
            return statusDocument("Blutend", "compendium document");
        },
    };
    globalThis.game.packs = packCollection(pack);
    globalThis.fromUuid = async () => null;

    const item = await resolveFumbleStatusEffectCreateData({
        uuid: "Compendium.splittermond.statuseffects.Item.missing",
        name: "Blutend",
        level: 3,
    });

    assert.equal(item.system.description, "compendium document");
    assert.equal(item.system.level, 3);
});

test("an explicit fumble duration overrides the template's normal combat duration", async () => {
    const item = await resolveFumbleStatusEffectCreateData({
        name: "Benommen",
        level: 2,
        durationTicks: 30,
    });

    assert.equal(item.system.combatEvent.startTick, null);
    assert.equal(item.system.combatEvent.interval, 30);
    assert.equal(item.system.combatEvent.repeats, 1);
});

test("an unknown future fumble condition still produces a valid generic status Item", async () => {
    const item = await resolveFumbleStatusEffectCreateData({ name: "Unbekannter Zustand", level: 2 });

    assert.deepEqual(item, {
        name: "Unbekannter Zustand",
        type: "statuseffect",
        img: "icons/svg/mystery-man.svg",
        system: {
            description: "",
            source: "",
            modifier: "",
            level: 2,
            combatEvent: emptyCombatEvent(),
        },
        effects: [],
        flags: {},
    });
});

test("every Splittermond fumble result produces exactly its mechanical action buttons", () => {
    for (const fixture of FUMBLE_ACTION_FIXTURES) {
        assert.deepEqual(getFumbleActionKeys({
            damage: fixture.damage ? 7 : 0,
            ticks: fixture.ticks,
            damagesWeapon: fixture.weapon,
            sourceItemId: fixture.weapon ? "weapon-id" : null,
            conditions: fixture.conditions,
            conditionMode: fixture.choose ? "choose" : "all",
        }), fixture.actions, fixture.id);
    }
});

test("fumble extraction handles adjacent DOM text, repeated condition links, and prose containing 'oder'", () => {
    const weapon = extractFumbleEffects(fakeFumbleRoot({
        childTexts: ["Beschädigte Waffe", "Unbeschädigte Waffe angeschlagen"],
    }));
    assert.equal(weapon.damagesWeapon, true);

    const repeatedCondition = fakeStatusLink("Blutend 2", " (für 30 Ticks)");
    const conditions = extractFumbleEffects(fakeFumbleRoot({
        childTexts: ["Nasenbluten oder Ähnlichem", "Blutend 2", "Blutend 2"],
        links: [repeatedCondition, fakeStatusLink("Blutend 2", " (für 30 Ticks)")],
    }));
    assert.deepEqual(conditions.conditions, [{
        uuid: null,
        name: "Blutend",
        level: 2,
        durationTicks: 30,
    }]);
    assert.equal(conditions.conditionMode, "all");
});

const FUMBLE_ACTION_FIXTURES = [
    fumbleFixture("fight.1", [], []),
    fumbleFixture("fight.2-3", ["ticks", "conditions"], ["Benommen 2", "Liegend 1"], { ticks: 10 }),
    fumbleFixture("fight.4-6", ["weapon"], [], { weapon: true }),
    fumbleFixture("fight.7-9", ["ticks"], [], { ticks: 3 }),
    fumbleFixture("fight.10-12", ["ticks"], [], { ticks: 6 }),
    fumbleFixture("fight.13-15", ["conditions"], ["Liegend 1"]),
    fumbleFixture("fight.16-18", ["ticks"], [], { ticks: 3 }),
    fumbleFixture("fight.19-20", ["conditions"], ["Blutend 2"]),
    fumbleFixture("priest.1-2", [], []),
    fumbleFixture("priest.3-20", ["conditions"], ["Erschöpft 2"]),
    fumbleFixture("priest.21-35", ["conditions"], ["Erschöpft 2", "Glaubenskrise 1"]),
    fumbleFixture("priest.36-70", ["conditions"], ["Erschöpft 2", "Benommen 1", "Glaubenskrise 2"]),
    fumbleFixture("priest.71-100", ["conditions"], ["Erschöpft 2", "Benommen 2", "Glaubenskrise 3"]),
    fumbleFixture("priest.101-130", ["conditions"], ["Angsterfüllt 1", "Erschöpft 3", "Benommen 2", "Glaubenskrise 3"]),
    fumbleFixture("priest.131+", ["conditions"], ["Angsterfüllt 1", "Erschöpft 4", "Benommen 3"]),
    fumbleFixture("sorcerer.1-2", [], []),
    fumbleFixture("sorcerer.3-20", ["damage", "conditions"], ["Erschöpft 1"], { damage: true }),
    fumbleFixture("sorcerer.21-35", ["damage", "conditions"], ["Erschöpft 2"], { damage: true }),
    fumbleFixture("sorcerer.36-70", ["damage", "conditions"], ["Erschöpft 2", "Benommen 1"], { damage: true }),
    fumbleFixture("sorcerer.71-100", ["damage", "conditions"], ["Angsterfüllt 1", "Benommen 1"], { damage: true }),
    fumbleFixture("sorcerer.101-130", ["damage", "conditions"], ["Angsterfüllt 1", "Verwundet 2"], { damage: true }),
    fumbleFixture("sorcerer.131-175", ["damage", "conditions"], ["Sterbend 1", "Verwundet 2"], { damage: true }),
    fumbleFixture("sorcerer.176-250", ["damage", "conditions"], ["Sterbend 2", "Blutend 2"], { damage: true }),
    fumbleFixture("sorcerer.251+", ["damage", "condition:0", "condition:1", "condition:2"], ["Sterbend 3", "Brennend 5", "Blutend 3"], { damage: true, choose: true }),
];

class TestActor {
    constructor() {
        this.items = [];
        this.created = [];
    }

    addExisting(name, level) {
        const item = {
            name,
            type: "statuseffect",
            system: { level },
            async update(change) {
                this.system.level = change["system.level"];
            },
        };
        this.items.push(item);
        return item;
    }

    async createEmbeddedDocuments(documentName, sources) {
        assert.equal(documentName, "Item");
        for (const source of sources) {
            const item = structuredClone(source);
            item.update = async function update(change) {
                this.system.level = change["system.level"];
            };
            this.items.push(item);
            this.created.push(item);
        }
        return this.created.slice(-sources.length);
    }
}

function statusDocument(name, description) {
    return {
        name,
        type: "statuseffect",
        toObject: () => ({
            _id: `${name}-id`,
            name,
            type: "statuseffect",
            img: "document.webp",
            system: {
                description,
                source: "test",
                modifier: "",
                level: 1,
                combatEvent: emptyCombatEvent(),
            },
        }),
    };
}

function packCollection(pack) {
    return new Map([["splittermond.statuseffects", pack]]);
}

function emptyCombatEvent() {
    return {
        startTick: null,
        interval: null,
        repeats: null,
        macroRef: { name: null, uuid: null },
        postDescription: true,
    };
}

function fumbleFixture(id, actions, labels, options = {}) {
    return {
        id,
        actions,
        conditions: labels.map((label) => {
            const match = label.match(/^(.*)\s+(\d+)$/u);
            return { name: match[1], level: Number(match[2]), durationTicks: null, uuid: null };
        }),
        damage: Boolean(options.damage),
        ticks: options.ticks ?? 0,
        weapon: Boolean(options.weapon),
        choose: Boolean(options.choose),
    };
}

function fakeFumbleRoot({ childTexts, links = [] }) {
    const childNodes = childTexts.map((textContent) => ({ textContent }));
    const active = {
        childNodes,
        textContent: childTexts.join(""),
        querySelector: () => null,
        querySelectorAll: () => links,
    };
    return {
        querySelector: (selector) => selector === ".fumble-table-result-item-active" ? active : null,
    };
}

function fakeStatusLink(textContent, trailingText) {
    return {
        dataset: { pack: "splittermond.statuseffects" },
        textContent,
        nextSibling: trailingText ? { textContent: trailingText, nextSibling: null } : null,
    };
}
