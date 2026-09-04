import assert from "node:assert/strict";
import test from "node:test";

import {
    statusEffectTimingData,
    statusEffectTimingUpdate,
} from "../Modul/splittermond-smoother-fight/scripts/shared/status-effect-compatibility.js";
import { applyFumbleConditions } from "../Modul/splittermond-smoother-fight/scripts/features/fumbles/status-effects.js";
import {
    resolveCombatPosition,
    setCombatPosition,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-positions/positions.js";

const VERSIONS = [
    ...Array.from({ length: 8 }, (_, patch) => ({ version: `14.2.${patch}`, legacy: true })),
    { version: "14.3.0-alpha1", legacy: true },
    { version: "14.3.0-alpha4", legacy: false },
    { version: "14.3.0", legacy: false },
    { version: "14.3.7", legacy: false },
];
const TIMER = {
    startTick: null,
    interval: 30,
    repeats: 1,
    macroRef: { name: null, uuid: null },
    postDescription: true,
};

for (const { version, legacy } of VERSIONS) {
    test(`${version}: fumble levels, one-shot durations and recurring ticks are preserved`, async (t) => {
        const actor = installSystem(t, version, legacy);
        await applyFumbleConditions(actor, [
            { name: "Benommen", level: 2, durationTicks: 30 },
            { name: "Brennend", level: 5 },
            { name: "Blutend", level: 2 },
        ]);

        assert.deepEqual(actor.events(), [
            { name: "Benommen", level: 2, ticks: [130] },
            { name: "Brennend", level: 5, ticks: [115, 130, 145, 160, 175, 190] },
            { name: "Blutend", level: 2, ticks: [115, 130, 145, 160] },
        ]);
        assert.equal(actor.items[0].system.modifier, "tickMalus.mod +1");
        assert.deepEqual(actor.warnings, []);
        const originalTimer = structuredClone(actor.items[0].system);

        await applyFumbleConditions(actor, [{ name: "Benommen", level: 3, durationTicks: 60 }]);
        assert.equal(actor.items.length, 3);
        assert.deepEqual(actor.items[0].system, { ...originalTimer, level: 5 });

        actor.reload();
        assert.deepEqual(actor.events()[0], { name: "Benommen", level: 5, ticks: [130] });
    });

    test(`${version}: positions stay permanent through switching, reload and standing up`, async (t) => {
        const actor = installSystem(t, version, legacy);
        await applyFumbleConditions(actor, [{ name: "Brennend", level: 1 }]);
        const unrelated = structuredClone(actor.items[0].system);

        for (const position of ["kneeling", "prone", "flying"]) {
            await setCombatPosition(actor, position);
            assert.equal(resolveCombatPosition(actor).id, position);
            assert.equal(actor.items.length, 2);
            assert.equal(actor.items[1].system.modifier, "");
            assert.deepEqual(actor.items[1].effects, []);
            assert.equal(actor.events().length, 1, "a position must never generate timed chat events");
            assert.deepEqual(actor.items[0].system, unrelated);

            actor.reload();
            await setCombatPosition(actor, position);
            assert.equal(actor.items.length, 2, "reselecting must not duplicate the marker");
            assert.equal(resolveCombatPosition(actor).id, position);
        }

        await setCombatPosition(actor, "standing");
        assert.equal(resolveCombatPosition(actor).id, "standing");
        assert.equal(actor.items.length, 1);
        assert.deepEqual(actor.items[0].system, unrelated);
        assert.deepEqual(actor.warnings, [], "position creation must not raise invalid-interval warnings");
    });

    test(`${version}: failed timer cleanup keeps the old position and removes the new marker`, async (t) => {
        const actor = installSystem(t, version, legacy);
        await setCombatPosition(actor, "prone");
        const original = structuredClone(actor.items[0].system);
        actor.failUpdate = true;

        await assert.rejects(setCombatPosition(actor, "flying"), /update failed/u);
        assert.equal(resolveCombatPosition(actor).id, "prone");
        assert.equal(actor.items.length, 1);
        assert.deepEqual(actor.items[0].system, original);
        assert.deepEqual(actor.events(), []);
    });
}

for (const legacy of [true, false]) {
    test(`${legacy ? "legacy" : "grouped"} timers preserve world templates in either source format`, async (t) => {
        const actor = installSystem(t, legacy ? "14.2.7" : "14.3.0-alpha4", legacy);
        const effects = [{ name: "Custom effect", changes: [] }];
        const templates = [
            { name: "Alter Zustand", timing: { startTick: 7, interval: 12, times: 4 } },
            { name: "Neuer Zustand", timing: { combatEvent: { ...TIMER, interval: 12, repeats: 4 } } },
        ].map(({ name, timing }) => ({
            _id: name,
            type: "statuseffect",
            name,
            system: { modifier: "skills.general -1", level: 1, description: "World description", ...timing },
            effects,
            flags: { custom: { untouched: true } },
        }));
        game.items = templates;
        const before = structuredClone(templates);

        await applyFumbleConditions(actor, templates.map(({ name }) => ({ name, level: 3 })));
        assert.deepEqual(actor.events().map(({ level, ticks }) => ({ level, ticks })), [
            { level: 3, ticks: [112, 124, 136, 148] },
            { level: 3, ticks: [112, 124, 136, 148] },
        ]);
        assert.deepEqual(templates, before, "source documents must not be modified");
        for (const item of actor.items) {
            assert.equal(item.system.modifier, "skills.general -1");
            assert.equal(item.system.description, "World description");
            assert.deepEqual(item.effects, effects);
            assert.deepEqual(item.flags, { custom: { untouched: true } });
        }
    });

    test(`${legacy ? "legacy" : "grouped"} statuses created outside combat keep their durations without a start tick`, async (t) => {
        const actor = installSystem(t, legacy ? "14.2.7" : "14.3.0-alpha4", legacy);
        actor.currentTick = null;
        await applyFumbleConditions(actor, [{ name: "Benommen", level: 1, durationTicks: 30 }]);
        await setCombatPosition(actor, "kneeling");
        assert.deepEqual(actor.events(), []);
        assert.deepEqual(actor.warnings, []);
        assert.equal(resolveCombatPosition(actor).id, "kneeling");
        const timer = actor.items[0].system;
        assert.equal(legacy ? timer.interval : timer.combatEvent.interval, 30);
        assert.equal(legacy ? timer.startTick : timer.combatEvent.startTick, legacy ? 0 : null);
    });
}

test("without a schema every 14.2 patch selects legacy fields and 14.3 retains grouped fields", (t) => {
    installSystem(t, "14.2.0", true);
    delete CONFIG.Item;
    for (const version of ["14.2.0", "14.2.7", "14.2.10", "14.2.2-beta4", "14.2.99+local"]) {
        game.system.version = version;
        assert.deepEqual(statusEffectTimingData(TIMER), { startTick: 0, interval: 30, times: 1 }, version);
    }
    for (const version of ["14.3.0-alpha4", "14.3.0", "14.3.12", ""]) {
        game.system.version = version;
        assert.deepEqual(statusEffectTimingData(TIMER), { combatEvent: TIMER }, version);
    }
});

test("the live model takes priority over the version and is rechecked after init", (t) => {
    installSystem(t, "14.2.7", true);
    delete CONFIG.Item;
    assert.deepEqual(statusEffectTimingData(TIMER), { startTick: 0, interval: 30, times: 1 });
    CONFIG.Item = statusConfig(false);
    assert.deepEqual(statusEffectTimingData(TIMER), { combatEvent: TIMER });
    game.system.version = "14.3.0-alpha1";
    CONFIG.Item = statusConfig(true);
    assert.deepEqual(statusEffectTimingData(TIMER), { startTick: 0, interval: 30, times: 1 });
});

test("14.3 document updates retain macro settings and unrelated status properties", (t) => {
    installSystem(t, "14.3.0-alpha4", false);
    assert.deepEqual(statusEffectTimingUpdate({ startTick: null, interval: null, repeats: null, postDescription: true }), {
        "system.combatEvent.startTick": null,
        "system.combatEvent.interval": null,
        "system.combatEvent.repeats": null,
        "system.combatEvent.postDescription": true,
    });
    assert.deepEqual(statusEffectTimingData({ ...TIMER, macroRef: { name: "Custom", uuid: "Macro.custom" }, postDescription: false }), {
        combatEvent: { ...TIMER, macroRef: { name: "Custom", uuid: "Macro.custom" }, postDescription: false },
    });
});

function installSystem(t, version, legacy) {
    const previous = Object.fromEntries(["CONFIG", "game", "foundry"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    t.after(() => {
        for (const [key, descriptor] of Object.entries(previous)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    globalThis.CONFIG = { Item: statusConfig(legacy) };
    globalThis.foundry = { utils: { deepClone: structuredClone } };
    globalThis.game = {
        system: { id: "splittermond", version },
        i18n: { lang: "de", localize: (key) => key },
        items: [],
        packs: new Map(),
    };
    return new StatusActor(legacy);
}

function statusConfig(legacy) {
    const keys = legacy ? ["startTick", "interval", "times"] : ["combatEvent"];
    return { dataModels: { statuseffect: { schema: { fields: Object.fromEntries(keys.map((key) => [key, {}])) } } } };
}

// Models the external contracts, independently of the adapter. Sources:
// https://github.com/SplittermondFoundry/Splittermond/compare/v14.2.7...v14.3.0-alpha4
// StatusEffectDataModel, initialTickCalculator and Actor.getVirtualStatusTokens.
// Rejecting unknown fields makes a wrong-version write fail instead of being
// silently accepted by a plain-object mock. Foundry itself may discard them.
class StatusActor {
    constructor(legacy) {
        this.legacy = legacy;
        this.items = [];
        this.currentTick = 100;
        this.warnings = [];
        this.nextId = 0;
    }

    validate(system) {
        const base = ["description", "source", "modifier", "level"];
        const timing = this.legacy ? ["startTick", "interval", "times"] : ["combatEvent"];
        for (const key of Object.keys(system)) assert.ok([...base, ...timing].includes(key), `unknown status field: ${key}`);
        for (const key of timing) assert.ok(Object.hasOwn(system, key), `missing status field: ${key}`);
        const timer = this.legacy ? system : system.combatEvent;
        for (const key of this.legacy ? timing : ["startTick", "interval", "repeats"]) {
            assert.ok(timer[key] === null || Number.isFinite(timer[key]), `invalid number: ${key}`);
        }
        if (!this.legacy) assert.ok(timer.interval === null || timer.interval > 0, "modern interval must be positive or null");
    }

    async createEmbeddedDocuments(type, sources) {
        assert.equal(type, "Item");
        return sources.map((source) => {
            this.validate(source.system);
            const item = this.attach({ ...structuredClone(source), _id: `status-${++this.nextId}` });
            const timer = this.legacy ? item.system : item.system.combatEvent;
            if (this.currentTick !== null) {
                if (timer.interval) timer.startTick = this.currentTick + timer.interval;
                else this.warnings.push("invalidStatusEffectInterval");
            }
            this.items.push(item);
            return item;
        });
    }

    async updateEmbeddedDocuments(type, changes) {
        assert.equal(type, "Item");
        if (this.failUpdate) throw new Error("update failed");
        for (const change of changes) {
            const item = this.items.find(({ _id }) => _id === change._id);
            assert.ok(item, "update must address the exact status Item");
            for (const [path, value] of Object.entries(change)) {
                if (path === "_id") continue;
                const keys = path.split(".");
                const last = keys.pop();
                const target = keys.reduce((object, key) => object[key], item);
                assert.ok(target && Object.hasOwn(target, last), `unknown update field: ${path}`);
                target[last] = value;
            }
            this.validate(item.system);
        }
    }

    async deleteEmbeddedDocuments(type, ids) {
        assert.equal(type, "Item");
        this.items = this.items.filter(({ _id }) => !ids.includes(_id));
    }

    attach(item) {
        Object.defineProperty(item, "update", { value: (change) => this.updateEmbeddedDocuments("Item", [{ _id: item._id, ...change }]) });
        return item;
    }

    reload() {
        this.items = structuredClone(this.items).map((item) => this.attach(item));
        this.items.forEach((item) => this.validate(item.system));
    }

    events() {
        return this.items.flatMap(({ name, system }) => {
            const timer = this.legacy ? system : system.combatEvent;
            if (!(timer.startTick > 0 && timer.interval > 0)) return [];
            const count = this.legacy ? timer.times || 90 : timer.repeats ?? 90;
            return [{ name, level: system.level, ticks: Array.from({ length: count }, (_, n) => timer.startTick + n * timer.interval) }];
        });
    }
}
