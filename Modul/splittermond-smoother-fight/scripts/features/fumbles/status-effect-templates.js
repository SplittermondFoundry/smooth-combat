const EMPTY_COMBAT_EVENT = Object.freeze({
    startTick: null,
    interval: null,
    repeats: null,
});

const STATUS_EFFECT_DEFINITIONS = Object.freeze({
    "Erschöpft": Object.freeze({
        img: "icons/svg/mystery-man.svg",
        description: "<p>Kampf- und allgemeine Fertigkeiten sowie die Geschwindigkeit sinken pro Stufe um 1; die Initiative steigt pro Stufe um 1.</p>",
        source: "Splittermond: Die Regeln, S. 168",
        modifier: "skills.fighting -1, skills.general -1, GSW -1, INI +1, npcattacks -1",
        combatEvent: EMPTY_COMBAT_EVENT,
    }),
    Benommen: Object.freeze({
        img: "icons/svg/stoned.svg",
        description: "<p>Alle Handlungen dauern pro Stufe 1 Tick länger. Der Zustand endet normalerweise nach 60 Ticks.</p>",
        source: "Splittermond: Die Regeln, S. 168",
        modifier: "tickMalus.mod +1",
        combatEvent: Object.freeze({ startTick: null, interval: 60, repeats: 1 }),
    }),
    Glaubenskrise: Object.freeze({
        img: "icons/svg/angel.svg",
        description: "<p>Proben auf Magieschulen erhalten pro Stufe einen Malus von 1.</p>",
        source: "Splittermond: Die Regeln, S. 168",
        modifier: "actor.skills.magic -1",
        combatEvent: EMPTY_COMBAT_EVENT,
    }),
    "Angsterfüllt": Object.freeze({
        img: "icons/svg/eye.svg",
        description: "<p>Der Betroffene kann sich bei Proben nur für Sicherheitswürfe entscheiden.</p>",
        source: "Splittermond: Die Regeln, S. 168",
        modifier: "check.require rollType=\"safety\"",
        combatEvent: EMPTY_COMBAT_EVENT,
    }),
    Verwundet: Object.freeze({
        img: "icons/svg/bones.svg",
        description: "<p>Wundabzüge werden pro Stufe so behandelt, als wäre der Betroffene eine Wundstufe schwerer verletzt.</p>",
        source: "Splittermond: Die Regeln, S. 169",
        modifier: "woundMalus.levelMod 1",
        combatEvent: EMPTY_COMBAT_EVENT,
    }),
    Sterbend: Object.freeze({
        img: "icons/svg/skull.svg",
        description: "<p>Der Betroffene verliert abhängig von der Stufe in regelmäßigen Abständen eine volle Gesundheitsstufe.</p>",
        source: "Splittermond: Die Regeln, S. 169, 172–173",
        modifier: "",
        combatEvent: EMPTY_COMBAT_EVENT,
    }),
    Brennend: Object.freeze({
        img: "icons/svg/fire.svg",
        description: "<p>Der Betroffene erleidet alle 15 Ticks Feuerschaden. Der Zustand hält normalerweise 90 Ticks an.</p>",
        source: "Splittermond: Die Regeln, S. 168",
        modifier: "",
        combatEvent: Object.freeze({ startTick: null, interval: 15, repeats: 6 }),
    }),
    Blutend: Object.freeze({
        img: "icons/svg/blood.svg",
        description: "<p>Der Betroffene verliert alle 15 Ticks 3 Lebenspunkte pro Stufe. Der Zustand hält normalerweise 60 Ticks an.</p>",
        source: "Splittermond: Die Regeln, S. 168",
        modifier: "",
        combatEvent: Object.freeze({ startTick: null, interval: 15, repeats: 4 }),
    }),
    Liegend: Object.freeze({
        img: "icons/svg/falling.svg",
        description: "<p>Der Betroffene befindet sich in der Kampfposition Liegend. Aufstehen dauert normalerweise 6 Ticks.</p>",
        source: "Splittermond: Die Regeln, S. 159, 170",
        modifier: "",
        combatEvent: EMPTY_COMBAT_EVENT,
    }),
});

const STATUS_EFFECT_ALIASES = Object.freeze({
    prone: "Liegend",
});

export const FUMBLE_STATUS_EFFECT_NAMES = Object.freeze(Object.keys(STATUS_EFFECT_DEFINITIONS));

export function getBundledFumbleStatusEffectData(name) {
    const requestedName = String(name ?? "").trim();
    const canonicalName = STATUS_EFFECT_ALIASES[requestedName.toLocaleLowerCase()] ?? requestedName;
    const definition = STATUS_EFFECT_DEFINITIONS[canonicalName];
    if (!definition) return null;
    return {
        name: requestedName || canonicalName,
        type: "statuseffect",
        img: definition.img,
        system: {
            description: definition.description,
            source: definition.source,
            modifier: definition.modifier,
            level: 1,
            combatEvent: {
                ...definition.combatEvent,
                macroRef: { name: null, uuid: null },
                postDescription: true,
            },
        },
        effects: [],
        flags: {},
    };
}
