import test from "node:test";
import assert from "node:assert/strict";

test("cleanup macro removes only prone and kneeling target clauses from world and token actors", async (context) => {
    const previous = {
        confirm: globalThis.confirm,
        foundry: globalThis.foundry,
        game: globalThis.game,
        saveDataToFile: globalThis.saveDataToFile,
        ui: globalThis.ui,
    };
    context.after(() => {
        restoreGlobal("confirm", previous.confirm);
        restoreGlobal("foundry", previous.foundry);
        restoreGlobal("game", previous.game);
        restoreGlobal("saveDataToFile", previous.saveDataToFile);
        restoreGlobal("ui", previous.ui);
    });

    let updateCount = 0;
    const worldEffect = spellEffect(
        "DIVERSE MODIFIKATOREN",
        [
            'melee emphasis="Gegner kniend" +3',
            'longrange emphasis="ins Kampfgetümmel" -6',
            'npcattacks emphasis="Gegner liegend" -6',
            'actor.skills.fighting emphasis="Taktischer\u00a0Vorteil"\u00a0+3',
        ].join(", ")
    );
    const tokenEffect = spellEffect(
        "diverse Modifikatoren",
        "throwing emphasis='Gegner liegend' -6, perception emphasis=\"Lichtverhältnis Stufe 2\" -3"
    );
    const unrelatedEffect = spellEffect(
        "Andere Modifikatoren",
        'melee emphasis="Gegner kniend" +3'
    );
    for (const effect of [worldEffect, tokenEffect, unrelatedEffect]) {
        effect.update = async (changes) => {
            updateCount += 1;
            effect.system.modifier = changes["system.modifier"];
        };
    }

    const worldActor = actor("Actor.world", "Welt-Held", [worldEffect, unrelatedEffect]);
    const tokenActor = actor("Scene.scene.Token.token.Actor.synthetic", "Token-Held", [tokenEffect]);
    let confirmationCount = 0;
    let confirmationOptions = null;
    let backup = null;
    const messages = [];
    globalThis.game = {
        user: { isGM: true },
        actors: [worldActor],
        scenes: [{
            name: "Testszene",
            tokens: [
                { name: "Verknüpft", actor: worldActor },
                { name: "Unverknüpft", actor: tokenActor },
            ],
        }],
    };
    globalThis.ui = {
        notifications: {
            error: (message) => messages.push(["error", message]),
            info: (message) => messages.push(["info", message]),
            warn: (message) => messages.push(["warn", message]),
        },
    };
    globalThis.foundry = {
        applications: {
            api: {
                DialogV2: {
                    confirm: async (options) => {
                        confirmationCount += 1;
                        confirmationOptions = options;
                        return true;
                    },
                },
            },
        },
    };
    globalThis.saveDataToFile = (json) => backup = JSON.parse(json);

    await import(`../tools/foundry-macros/cleanup-diverse-modifikatoren.js?test=${Date.now()}`);
    await waitFor(() => updateCount === 2);

    assert.equal(confirmationCount, 1);
    assert.match(confirmationOptions?.content ?? "", /max-height: 12rem; overflow-y: auto/u);
    assert.equal(updateCount, 2);
    assert.equal(
        worldEffect.system.modifier,
        'longrange emphasis="ins Kampfgetümmel" -6, actor.skills.fighting emphasis="Taktischer\u00a0Vorteil"\u00a0+3'
    );
    assert.equal(
        tokenEffect.system.modifier,
        'perception emphasis="Lichtverhältnis Stufe 2" -3'
    );
    assert.equal(unrelatedEffect.system.modifier, 'melee emphasis="Gegner kniend" +3');
    assert.equal(backup.entries.length, 2);
    assert.equal(backup.entries.some((entry) => entry.actorUuid === tokenActor.uuid), true);
    assert.match(messages.at(-1)?.[1] ?? "", /2 Zaubereffekt\(e\) bereinigt; 3 Klauseln entfernt\./u);
});

function actor(uuid, name, items) {
    return { uuid, name, items };
}

function spellEffect(name, modifier) {
    return {
        name,
        type: "spelleffect",
        uuid: `Item.${Math.random()}`,
        system: { modifier },
    };
}

async function waitFor(predicate) {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > 1_000) throw new Error("Timed out waiting for macro completion");
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

function restoreGlobal(name, value) {
    if (value === undefined) delete globalThis[name];
    else globalThis[name] = value;
}
