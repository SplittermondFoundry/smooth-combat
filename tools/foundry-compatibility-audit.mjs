// Execute as a Script macro in the authorized local test world.
// Uses its own actor and messages; does not replace production code or alter old cards.
if (!game.user.isGM || game.world.id !== "reise-um-den-kristallsee") {
    throw new Error("Only run in the authorized GM test world");
}
const base = "/modules/splittermond-smoother-fight/scripts/";
const { withTrackedHealthCosts } = await import(base + "features/feedback/feedback.js");
const { applyDefenseNumbingDamage, getNumbingDamageApplicationState } = await import(base + "features/chat/damage-application.js");
const { handleFumbleAction, getFumbleActionApplicationState } = await import(base + "features/fumbles/fumbles.js");
const { snapshotActorHealthCosts } = await import(base + "shared/health-cost-compatibility.js");
const { healthDamageTaken } = await import(base + "domain/feedback.js");
const { preparedActionId, setPreparedActionId } = await import(base + "shared/prepared-action-compatibility.js");
const { statusEffectTimingData } = await import(base + "shared/status-effect-compatibility.js");
const scope = "splittermond-smoother-fight";
const results = [];
const panel = document.createElement("section");
panel.id = "sf-compatibility-audit";
panel.style.cssText = "position:fixed;left:80px;top:65px;z-index:2000;width:700px;max-height:80vh;overflow:auto;padding:20px;background:#17212b;color:white;border:2px solid #d7b46a;white-space:normal;font:15px sans-serif";
const heading = document.createElement("h2");
heading.textContent = "Smoother Fight: Vergleich 14.2.7 → 14.3.1";
const output = document.createElement("pre");
output.style.cssText = "white-space:pre-wrap;font:13px monospace;color:#eee";
const summary = document.createElement("ul");
summary.style.cssText = "padding-left:24px;line-height:1.6";
const close = document.createElement("button");
close.textContent = "Prüfbericht schließen";
close.onclick = () => panel.remove();
panel.append(heading, summary, output, close);
document.getElementById(panel.id)?.remove();
document.body.append(panel);
const record = (name, value) => {
    results.push({ name, ...value });
    output.textContent = JSON.stringify(results, null, 2);
    if (typeof value.pass === "boolean") {
        const row = document.createElement("li");
        row.textContent = `${value.pass ? "BESTANDEN" : "FEHLER"}: ${name}`;
        row.style.color = value.pass ? "#a8e6a3" : "#ff9999";
        summary.append(row);
    }
};
const run = async (name, callback) => {
    try { record(name, await callback()); }
    catch (error) { record(name, { pass: false, error: String(error), stack: error.stack }); }
};
record("Umgebung", { foundry: game.version, system: game.system.version, module: game.modules.get(scope)?.version });
const actor = await Actor.create({ name: "SF Kompatibilitätsaudit 14.3", type: "character" });
record("Testfigur", { uuid: actor.uuid, consumeCost: typeof actor.consumeCost, applyCost: typeof actor.applyCost });
const speaker = ChatMessage.getSpeaker({ actor });
await run("Betäubungsschaden aus Aktiver Abwehr", async () => {
    const message = await ChatMessage.create({ speaker, content: "SF Kompatibilitätsaudit: Abwehr-Betäubungsschaden", flags: { [scope]: { context: { numbingDamage: 3 } } } });
    try {
        await applyDefenseNumbingDamage(message, 3);
        await applyDefenseNumbingDamage(message, 3);
        return { pass: actor.system.health.exhausted.value === 3 && getNumbingDamageApplicationState(message) === "completed",
            messageId: message.id, result: "applied once", exhausted: actor.system.health.exhausted.value };
    } catch (error) { return { pass: false, messageId: message.id, result: "failed", error: String(error), exhausted: actor.system.health.exhausted.value }; }
});
await run("Patzer-Eigenschaden", async () => {
    const fumble = { kind: "fight", actorUuid: actor.uuid, actorName: actor.name, damage: 3, ticks: 0,
        conditions: [], damageApplied: false, damageApplicationStarted: false, applications: {} };
    const message = await ChatMessage.create({ speaker, content: "SF Kompatibilitätsaudit: Patzer-Eigenschaden", flags: { [scope]: { fumble } } });
    try {
        await handleFumbleAction(message, "damage");
        await handleFumbleAction(message, "damage");
        return { pass: actor.system.health.consumed.value === 3 && getFumbleActionApplicationState(message, "damage") === "completed",
            messageId: message.id, result: "applied once", consumed: actor.system.health.consumed.value };
    } catch (error) { return { pass: false, messageId: message.id, result: "failed", error: String(error), consumed: actor.system.health.consumed.value }; }
});
const [spell] = await actor.createEmbeddedDocuments("Item", [{ name: "SF Audit Kostenquelle", type: "spell", system: { costs: "5V5", skill: "deathmagic" } }]);
const snapshot = () => ({ consumed: actor.system.health.consumed.value, exhausted: actor.system.health.exhausted.value,
    bonusRemaining: actor.system.health.bonusPool.remaining, bonusEntries: actor.system.health.bonus.entries.map(e => ({ sourceId: e.sourceId, value: e.value })) });
const resetHealth = () => actor.update({ "system.health.consumed.value": 0, "system.health.exhausted.value": 0, "system.health.bonus.entries": [] });
async function observeDamage(amount) {
    await resetHealth();
    await spell.update({ "system.costs": `${amount}V${amount}` });
    const cost = spell.getCostsForFinishedRoll(0, true);
    const before = snapshot();
    const application = { actorUuids: new Set([actor.uuid]), completionPromises: [] };
    await withTrackedHealthCosts(application, [actor], () => actor.applyCost("health", cost, "SF Audit"));
    const outcomes = await Promise.all(application.completionPromises);
    return { pass: outcomes.length === 1 && outcomes[0].damage === amount && outcomes[0].status === "completed",
        actualDamage: amount, before, after: snapshot(), detectedDamage: outcomes.at(-1)?.damage,
        status: outcomes.at(-1)?.status, healthChanged: outcomes.at(-1)?.healthChanged };
}
await run("Kontrolle: 5 Schaden ohne Bonus-LE", () => observeDamage(5));
const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "SF Audit 5 Bonus-LE", type: "modifier", system: { modifiers: [{ path: "actor.healthpoints.bonus", implementation: "additive", selectable: false,
    serializedValue: { type: "amount", amount: 5 }, attributes: { name: "SF Audit 5 Bonus-LE", type: "innate" } }], costModifiers: [] } }]);
await run("5 Schaden bei 5 Bonus-LE", () => observeDamage(5));
await run("7 Schaden bei 5 Bonus-LE", () => observeDamage(7));
await resetHealth();
await run("Deaktivierter Bonus-Effekt verursacht keinen Schaden", async () => {
    const before = snapshotActorHealthCosts(actor);
    await effect.update({ disabled: true });
    const damage = healthDamageTaken(before, snapshotActorHealthCosts(actor));
    await effect.update({ disabled: false });
    return { pass: damage === 0, detectedDamage: damage };
});
await run("Vorbereitungsadapter", async () => {
    await setPreparedActionId(actor, "spell", spell.id);
    const actual = preparedActionId(actor, "spell");
    await setPreparedActionId(actor, "spell", null);
    return { pass: actual === spell.id && preparedActionId(actor, "spell") === null,
        preparedCorrectly: actual === spell.id, released: preparedActionId(actor, "spell") === null };
});
await run("Status-Timer-Adapter", async () => {
    const [status] = await actor.createEmbeddedDocuments("Item", [{ type: "statuseffect", name: "SF Audit Timer", system: { level: 1, ...statusEffectTimingData({ startTick: 10, interval: 5, repeats: 2 }) } }]);
    const recognized = actor.getVirtualStatusTokens().some(t => t.statusId === status.id);
    return { pass: recognized, combatEvent: status.system.combatEvent, recognized };
});
record("Abgeschlossen", { actor: actor.uuid, effect: effect.uuid, oldDocumentsChanged: false });
