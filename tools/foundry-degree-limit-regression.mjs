// Load as a world esmodule in a disposable Foundry world with Smoother Fight and Quench.
// Uses real system rolls, the addon's successor transaction, and the rendered SP button.
const MODULE = "splittermond-smoother-fight";
const BATCH = `${MODULE}.degree-limit`;
let testWorldId = "splinterpoint-repro";
const entries = [];
let output;
let restoreDice;

function record(label, value) {
    entries.push({ label, value });
    if (output) output.textContent = JSON.stringify(entries, null, 2);
}

function guard() {
    if (game.world.id !== testWorldId || !game.user.isGM) throw new Error("Disposable GM test world required");
    if (!game.modules.get(MODULE)?.active) throw new Error("Smoother Fight must be active");
}

function fixedDice() {
    const restores = [];
    for (const RollClass of new Set(CONFIG.Dice.rolls)) {
        const original = RollClass.prototype.evaluate;
        RollClass.prototype.evaluate = async function (...args) {
            const terms = this.dice.map(term => ({ term, original: term.randomFace, own: Object.hasOwn(term, "randomFace") }));
            for (const { term } of terms) term.randomFace = () => 4;
            try { return await original.apply(this, args); }
            finally {
                for (const { term, original: randomFace, own } of terms) {
                    if (own) term.randomFace = randomFace;
                    else delete term.randomFace;
                }
            }
        };
        restores.push(() => { RollClass.prototype.evaluate = original; });
    }
    return () => { for (const restore of restores.reverse()) restore(); };
}

async function until(predicate, label) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out: ${label}`);
}

function snapshot(message) {
    const model = message.system;
    return {
        id: message.id, total: model.checkReport.roll.total,
        difficulty: model.checkReport.difficulty, degrees: model.checkReport.degreeOfSuccess,
        open: model.openDegreesOfSuccess, used: model.splinterPointUsed,
        points: game.actors.get(message.speaker.actor).splinterpoints.value,
        disabled: model.getData().actions.useSplinterpoint.disabled,
    };
}

async function freshAttack(untrained = false) {
    guard();
    const actor = await Actor.create({
        name: `SF EG-Test ${untrained ? "ungelernt" : "gelernt"}`, type: "character",
        system: { attributes: { agility: { initial: untrained ? 11 : 3 }, strength: { initial: 4 } },
            skills: { blades: { points: untrained ? 0 : 8 } }, splinterpoints: { value: 5, max: 5 } },
    });
    const [weapon] = await actor.createEmbeddedDocuments("Item", [{
        name: "Langschwert", type: "weapon", system: { skill: "blades", attribute1: "agility",
            attribute2: "strength", damage: "1W6+4", weaponSpeed: 10, equipped: true },
    }]);
    const defender = await Actor.create({
        name: "SF EG-Test Orkkrieger", type: "npc",
        system: { attributes: { agility: { value: 3 }, constitution: { value: 5 } },
            skills: { slashing: { points: 8 } }, derivedAttributes: { defense: { value: 22 } } },
    });
    const [club] = await defender.createEmbeddedDocuments("Item", [{
        name: "Streitkolben", type: "weapon", system: { skill: "slashing", attribute1: "agility",
            attribute2: "constitution", damage: "1W6+5", weaponSpeed: 9, equipped: true },
    }]);
    await actor.attacks.find(attack => attack.id === weapon.id).roll({ askUser: false, difficulty: "22" });
    const attack = game.messages.contents.filter(m => m.type === "attackRollMessage" && m.speaker.actor === actor.id).at(-1);
    await attack.setFlag(MODULE, "context", { defensePhase: "open", baseDefenseValue: 22 });
    return { actor, defender, club, attack };
}

async function defend(fixture) {
    const defense = fixture.defender.activeDefense.defense.find(d => d.id === fixture.club.id);
    const card = await defense.roll({ askUser: false });
    const check = card.getFlag("splittermond", "check");
    if (card.rolls[0].total !== 24) throw new Error(`Expected defense 24, got ${card.rolls[0].total}`);
    const { queueDefenseForAttack } = await import(`/modules/${MODULE}/scripts/features/active-defense/recalculation.js`);
    return queueDefenseForAttack(fixture.attack.id, card, check, 26, { defenderActorUuid: fixture.defender.uuid });
}

function register(quench) {
    quench.registerBatch(BATCH, ({ describe, it, expect }) => {
        describe("new active-defense successors", function () {
            this.timeout(30000);
            for (const untrained of [false, true]) {
                it(`persists finite EG and spends exactly one SP on the first click (${untrained ? "untrained" : "trained"})`, async () => {
                    const restore = fixedDice();
                    try {
                        const fixture = await freshAttack(untrained);
                        const initial = fixture.attack.toObject().system.checkReport;
                        expect(initial.roll.total).to.equal(23);
                        expect(initial.degreeOfSuccess.limitedTo).to.equal(untrained ? 0 : 999);
                        const next = await defend(fixture);
                        expect(next.id).not.to.equal(fixture.attack.id);
                        expect(next.system.checkReport.degreeOfSuccess).to.deep.equal({ fromRoll: -1, modification: 0, limitedTo: untrained ? 0 : 999 });
                        expect(fixture.attack.toObject().system.checkReport).to.deep.equal(initial);
                        const button = await until(() => document.querySelector(`.message[data-message-id="${next.id}"] [data-action="useSplinterpoint"]`), "SP button");
                        expect(button.disabled).to.equal(false);
                        button.click();
                        await until(() => next.toObject().system.splinterPointUsed && fixture.actor.splinterpoints.value === 4, "persisted first SP click");
                        const persisted = new CONFIG.ChatMessage.documentClass(JSON.parse(JSON.stringify(next.toObject())));
                        const state = snapshot(persisted);
                        expect(state.total).to.equal(26);
                        expect(state.difficulty).to.equal(26);
                        expect(state.degrees).to.deep.equal({ fromRoll: 0, modification: 0, limitedTo: untrained ? 0 : 999 });
                        expect(state.open).to.equal(0);
                        expect(state.disabled).to.equal(true);
                        await next.setFlag(MODULE, "degreeLimitRegression", true);
                        record("Quench persisted successor", state);
                        // The system action must also reject a repeated invocation without spending again.
                        await persisted.system.handleGenericAction({ action: "useSplinterpoint" });
                        expect(fixture.actor.splinterpoints.value).to.equal(4);
                    } finally { restore(); }
                });
            }
        });
    });
}

export function startDegreeLimitRegression(worldId = "splinterpoint-repro") {
    testWorldId = worldId;
    guard();
    if (document.getElementById("sf-degree-limit-regression")) return;
    register(quench);
    const panel = document.createElement("section");
    panel.id = "sf-degree-limit-regression";
    panel.style.cssText = "position:fixed;left:85px;top:65px;width:560px;max-height:75vh;overflow:auto;z-index:95;background:white;color:black;padding:12px;font:12px monospace";
    const title = document.createElement("h3");
    title.textContent = `SF EG-Regression | Foundry ${game.version} | System ${game.system.version}`;
    title.style.color = "black";
    panel.append(title);
    output = document.createElement("pre");
    output.style.cssText = "white-space:pre-wrap;color:black";
    function button(label, action) {
        const element = document.createElement("button");
        element.textContent = label;
        element.style.color = "black";
        element.onclick = () => Promise.resolve().then(action).catch(error => record("ERROR", error.stack));
        panel.append(element);
    }
    button("Quench EG-Regression starten", async () => {
        guard();
        await quench.app.render({ force: true });
        const result = await quench.runBatches(BATCH);
        if (!result.stats.end) await new Promise(resolve => result.once("end", resolve));
        const tests = [];
        result.suite.eachTest(test => tests.push({ title: test.fullTitle(), state: test.state, error: test.err?.message }));
        record("Quench result", { stats: result.stats, tests });
    });
    button("Manuellen Angriff 23 gegen 22 vorbereiten", async () => {
        restoreDice?.();
        restoreDice = fixedDice();
        const f = await freshAttack();
        const scene = await Scene.create({ name: "SF EG-Regressionsszene", width: 1200, height: 900, grid: { size: 100, distance: 1, units: "m" } });
        await scene.activate();
        await scene.view();
        const token = await f.defender.getTokenDocument({ x: 500, y: 300, actorLink: true });
        const [target] = await scene.createEmbeddedDocuments("Token", [token.toObject()]);
        await f.attack.setFlag(MODULE, "context", { defensePhase: "open", baseDefenseValue: 22, primaryTargetTokenUuid: target.uuid, targetTokenUuid: target.uuid });
        await f.attack.setFlag(MODULE, "degreeLimitManual", true);
        record("manual fresh attack", snapshot(f.attack));
        record("next step", "Aktive Abwehr an der Angriffskarte anklicken; Streitkolben und Standardwurf wählen; anschließend Splitterpunkt an der neuen Angriffskarte.");
    });
    button("Gespeicherte Ergebnisse prüfen", () => {
        const recorded = new Set();
        for (const root of game.messages.filter(m => m.getFlag(MODULE, "degreeLimitManual") || m.getFlag(MODULE, "degreeLimitRegression"))) {
            let latest = root;
            const seen = new Set();
            while (!seen.has(latest.id)) {
                seen.add(latest.id);
                const next = game.messages.get(latest.getFlag(MODULE, "context")?.supersededBy);
                if (!next) break;
                latest = next;
            }
            if (recorded.has(latest.id)) continue;
            recorded.add(latest.id);
            record("stored card", snapshot(latest));
        }
        restoreDice?.();
        restoreDice = null;
    });
    panel.append(output);
    document.body.append(panel);
    record("loaded", { foundry: game.version, system: game.system.version, module: game.modules.get(MODULE)?.version, world: game.world.id });
}

Hooks.once("ready", () => {
    if (game.world.id === "splinterpoint-repro" && game.user.isGM) startDegreeLimitRegression();
});
