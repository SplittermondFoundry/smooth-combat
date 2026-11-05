import assert from "node:assert/strict";
import test from "node:test";
import { applyHealthDamage } from "../Modul/splittermond-smoother-fight/scripts/shared/health-cost-compatibility.js";

class PrimaryCost {
    constructor(source) { Object.assign(this, source); }
    get consumed() { return this._consumed; }
    get exhausted() { return this._nonConsumed; }
    get channeled() { return this._isChanneled ? this._nonConsumed : 0; }
}
function installModel(t) {
    const previous = globalThis.game;
    t.after(() => { globalThis.game = previous; });
    globalThis.game = { splittermond: { API: { hooks: { onApplyCost: {
        defineSchema: () => [{}, {}, { model: PrimaryCost }],
    } } } } };
}

for (const consumed of [false, true]) {
    test(`14.2.7 receives the original ${consumed ? "consumed" : "exhausted"} cost string`, async () => {
        const actor = { consumeCost(...args) { assert.deepEqual(args, ["health", consumed ? "3V3" : "3", "Source"]); return "applied"; } };
        assert.equal(await applyHealthDamage(actor, 3, "Source", { consumed }), "applied");
    });
    test(`14.3.1 receives a real native model for ${consumed ? "consumed" : "exhausted"} damage`, async (t) => {
        installModel(t);
        const actor = { applyCost(resource, cost, description) {
            assert.equal(resource, "health");
            assert.equal(description, "Source");
            assert.ok(cost instanceof PrimaryCost);
            assert.equal(cost.consumed, consumed ? 3 : 0);
            assert.equal(cost.exhausted, consumed ? 0 : 3);
            assert.equal(cost.channeled, 0);
            return "applied";
        } };
        assert.equal(await applyHealthDamage(actor, 3, "Source", { consumed }), "applied");
    });
}

test("a failed modern booking never retries through the legacy API", async (t) => {
    installModel(t);
    const failure = new Error("Failure after resource update");
    const actor = { applyCost: async () => { throw failure; }, consumeCost: () => assert.fail("double charge") };
    await assert.rejects(applyHealthDamage(actor, 5, "Source"), error => error === failure);
});
test("missing native model or API fails before any resource write", (t) => {
    installModel(t);
    game.splittermond.API.hooks = {};
    assert.throws(() => applyHealthDamage({ applyCost: () => assert.fail("write") }, 2, ""), /PrimaryCost/);
    assert.throws(() => applyHealthDamage({}, 2, ""), /API is unavailable/);
    assert.throws(() => applyHealthDamage({}, Infinity, ""), /finite/);
});
