import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createTickActionChatCard } from "../Modul/splittermond-smoother-fight/scripts/features/chat/messages.js";
import { COMBAT_TICK_ACTIONS } from "../Modul/splittermond-smoother-fight/scripts/domain/combat/ticks.js";
import { addCombatTicks } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/actions.js";
import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";

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
    assert.deepEqual(created[0].flags["splittermond-smoother-fight"].tickAction, {
        id: "searchOpening",
        ticks: "4",
        tokenUuid: "Scene.scene-1.Token.token-1",
    });
});
