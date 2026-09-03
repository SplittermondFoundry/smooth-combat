import assert from "node:assert/strict";
import test from "node:test";

import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    CONTINUOUS_ACTION_FLAG,
    getContinuousAction,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/continuous-action.js";
import {
    bindContinuousActionInterruptionCard,
    canCurrentUserRollContinuousActionInterruption,
    clearContinuousActionInterruptionForDeletedCard,
    confirmContinuousActionInterruptionForActiveDefense,
    getContinuousActionInterruptionCard,
    getPendingContinuousActionInterruption,
    getPendingContinuousActionInterruptionsForCurrentUser,
    interruptContinuousActionForActiveDefense,
    isContinuousActionInterruptionPending,
    reconcileContinuousActionInterruptionRoll,
    requestContinuousActionInterruptionForDamage,
    restoreContinuousActionFromInterruptionCard,
    rollContinuousActionInterruption,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/continuous-action-interruption.js";
import {
    beginStandaloneActiveDefense,
} from "../Modul/splittermond-smoother-fight/scripts/features/active-defense/active-defense.js";

const MODULE_ID = "splittermond-smoother-fight";

test("damage creates a pending chat and HUD request without rolling Determination", async () => {
    const fixture = installFixture();
    const attack = {
        id: "attack",
        system: {
            noActionOptionsHandler: {
                interruptingAttack: {
                    options: {
                        multiplicities: [
                            { multiplicity: 1, checked: false },
                            { multiplicity: 2, checked: true },
                            { multiplicity: 4, checked: false },
                            { multiplicity: 8, checked: false },
                        ],
                    },
                },
            },
        },
    };
    const damage = {
        id: "damage",
    };
    fixture.messages.set(attack.id, attack);
    fixture.messages.set(damage.id, damage);
    fixture.eventGroups.push({ primary: attack, damages: [damage] });

    const request = await requestContinuousActionInterruptionForDamage({
        actorUuid: fixture.actor.uuid,
        tokenUuid: fixture.token.uuid,
        damage: 7,
        sourceMessageId: "damage",
    });

    assert.equal(fixture.rolls.length, 0, "the damage path must never roll automatically");
    assert.equal(request.difficulty, 23);
    assert.equal(request.disturbingAttackLevels, 2);
    assert.equal(getPendingContinuousActionInterruption(fixture)?.id, request.id);
    assert.equal(fixture.cards.length, 1);
    assert.match(fixture.cards[0].content, /data-sf-action="roll-continuous-action-interruption"/u);
    assert.match(fixture.cards[0].content, />23</u);
    assert.deepEqual(getContinuousActionInterruptionCard(fixture.cards[0]), {
        requestId: request.id,
        tokenUuid: fixture.token.uuid,
        sourceMessageId: "damage",
        combatId: fixture.combat.id,
        combatantId: fixture.combatant.id,
        createdAt: request.createdAt,
    });
    assert.equal(isContinuousActionInterruptionPending(fixture.cards[0], fixture.combat), true);
    services.getRuntimeController = () => ({ id: "player" });
    assert.equal(
        canCurrentUserRollContinuousActionInterruption(fixture.cards[0], fixture.combat),
        true,
        "the responsible runtime controller may roll from the HUD card",
    );
    fixture.user.id = "other-player";
    assert.equal(
        canCurrentUserRollContinuousActionInterruption(fixture.cards[0], fixture.combat),
        false,
        "an unrelated player sees the pending step but may not roll it",
    );
    fixture.user.isGM = true;
    assert.equal(
        canCurrentUserRollContinuousActionInterruption(fixture.cards[0], fixture.combat),
        true,
        "a GM may resolve another player's pending interruption",
    );
});

test("deleting an interruption chat card removes only its pending HUD request", async () => {
    const fixture = installFixture();
    const first = await requestContinuousActionInterruptionForDamage({
        actorUuid: fixture.actor.uuid,
        tokenUuid: fixture.token.uuid,
        damage: 4,
        sourceMessageId: "damage-one",
    });
    const firstCard = fixture.cards.at(-1);
    const second = await requestContinuousActionInterruptionForDamage({
        actorUuid: fixture.actor.uuid,
        tokenUuid: fixture.token.uuid,
        damage: 7,
        sourceMessageId: "damage-two",
    });

    fixture.messages.delete(firstCard.id);
    assert.equal(
        getPendingContinuousActionInterruption(fixture)?.id,
        second.id,
        "an already orphaned request must disappear from the HUD before its stored flag is migrated",
    );
    assert.equal(await clearContinuousActionInterruptionForDeletedCard(firstCard), true);
    const requests = fixture.token.flags[MODULE_ID].continuousActionInterruptions;
    assert.deepEqual(requests.map(({ id }) => id), [second.id]);
    assert.equal(requests.some(({ id }) => id === first.id), false);
    assert.equal(getPendingContinuousActionInterruption(fixture)?.id, second.id);
    assert.equal(await clearContinuousActionInterruptionForDeletedCard({ id: "unrelated" }), false);
});

test("a GM receives pending interruption controls for non-active combatants", async () => {
    const fixture = installFixture();
    fixture.user.isGM = true;
    const request = await requestContinuousActionInterruptionForDamage({
        actorUuid: fixture.actor.uuid,
        tokenUuid: fixture.token.uuid,
        damage: 5,
    });

    const pending = getPendingContinuousActionInterruptionsForCurrentUser(fixture.combat);

    assert.equal(fixture.combat.combatant.id, "ahead", "the damaged token is not currently acting");
    assert.deepEqual(pending, [{ request, token: fixture.token }]);
});

test("a successful player-triggered Determination roll keeps the action at its projected tick", async () => {
    const fixture = installFixture();
    const request = await requestContinuousActionInterruptionForDamage({
        actorUuid: fixture.actor.uuid,
        tokenUuid: fixture.token.uuid,
        damage: 4,
    });
    fixture.rollResult = true;

    const result = await rollContinuousActionInterruption(fixture, request.id);

    assert.equal(result.status, "succeeded");
    assert.deepEqual(fixture.rolls, [{ skillId: "determination", difficulty: 14 }]);
    assert.ok(getContinuousAction(fixture.token, fixture.combat));
    assert.equal(fixture.combatant.initiative, 16);
    assert.equal(getPendingContinuousActionInterruption(fixture), null);
});

test("closing a cancelled Determination dialog releases the request for another attempt", async () => {
    const fixture = installFixture();
    let rollCalls = 0;
    fixture.actor.rollSkill = () => {
        rollCalls += 1;
        return false;
    };
    const request = await requestContinuousActionInterruptionForDamage({
        actorUuid: fixture.actor.uuid,
        tokenUuid: fixture.token.uuid,
        damage: 4,
    });

    assert.deepEqual(
        await rollContinuousActionInterruption(fixture, request.id),
        { status: "cancelled" },
    );
    assert.equal(getPendingContinuousActionInterruption(fixture)?.id, request.id);

    const retryMessage = flagDocument({
        id: "determination-retry",
        speaker: { token: fixture.token.id },
        system: { checkReport: { succeeded: false } },
    });
    fixture.messages.set(retryMessage.id, retryMessage);
    fixture.actor.rollSkill = (skillId, options) => {
        rollCalls += 1;
        fixture.rolls.push({ skillId, difficulty: options.difficulty });
        return retryMessage;
    };

    assert.equal((await rollContinuousActionInterruption(fixture, request.id)).status, "failed");
    assert.equal(rollCalls, 2, "closing the first dialog must release the in-flight roll lock");
    assert.equal(getContinuousAction(fixture.token, fixture.combat), null);
    assert.equal(getPendingContinuousActionInterruption(fixture), null);
});

test("the rendered chat control is enabled again after cancelling Determination", async () => {
    const fixture = installFixture();
    fixture.actor.rollSkill = () => false;
    const request = await requestContinuousActionInterruptionForDamage({
        actorUuid: fixture.actor.uuid,
        tokenUuid: fixture.token.uuid,
        damage: 4,
    });
    const message = fixture.cards.at(-1);
    let clickListener = null;
    const button = {
        dataset: {},
        disabled: false,
        isConnected: true,
        addEventListener(type, listener) {
            if (type === "click") clickListener = listener;
        },
    };
    const html = {
        querySelectorAll: (selector) => selector.includes("roll-continuous-action-interruption") ? [button] : [],
    };
    bindContinuousActionInterruptionCard(message, html);

    clickListener({ preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(button.disabled, true, "the control stays locked while the dialog is open");
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(button.disabled, false);
    assert.equal(getPendingContinuousActionInterruption(fixture)?.id, request.id);
});

test("an unrelated player does not see the rendered Determination control", async () => {
    const fixture = installFixture();
    await requestContinuousActionInterruptionForDamage({
        actorUuid: fixture.actor.uuid,
        tokenUuid: fixture.token.uuid,
        damage: 4,
    });
    const message = fixture.cards.at(-1);
    services.getRuntimeController = () => ({ id: "another-player" });
    let clickListener = null;
    const panel = {
        removed: false,
        remove() {
            this.removed = true;
        },
    };
    const button = {
        dataset: {},
        disabled: false,
        closest: (selector) => selector === ".sf-continuous-action-interruption-actions" ? panel : null,
        addEventListener(type, listener) {
            if (type === "click") clickListener = listener;
        },
    };
    const html = {
        querySelectorAll: (selector) => selector.includes("roll-continuous-action-interruption") ? [button] : [],
    };

    bindContinuousActionInterruptionCard(message, html);

    assert.equal(panel.removed, true);
    assert.equal(clickListener, null);
});

test("a Determination result arriving after the closed-dialog grace period stays linked", async (t) => {
    const fixture = installFixture();
    const hooks = installHookFixture();
    t.after(() => {
        delete globalThis.Hooks;
    });
    let resolveRoll;
    fixture.actor.rollSkill = () => new Promise((resolve) => {
        resolveRoll = resolve;
    });
    const request = await requestContinuousActionInterruptionForDamage({
        actorUuid: fixture.actor.uuid,
        tokenUuid: fixture.token.uuid,
        damage: 4,
    });

    const attempt = rollContinuousActionInterruption(fixture, request.id);
    const dialog = { actor: fixture.actor, constructor: { name: "CheckDialog" } };
    const message = flagDocument({
        id: "determination-from-dialog",
        speaker: { actor: fixture.actor.id, token: fixture.token.id },
        system: { checkReport: { succeeded: false } },
    });
    fixture.messages.set(message.id, message);
    hooks.emit("renderApplicationV2", dialog);
    hooks.emit("closeApplicationV2", dialog);
    await new Promise((resolve) => setTimeout(resolve, 300));
    hooks.emit("createChatMessage", message);
    resolveRoll(message);

    assert.equal((await attempt).status, "failed");
    assert.equal(getContinuousAction(fixture.token, fixture.combat), null);
    assert.equal(getPendingContinuousActionInterruption(fixture), null);
    assert.match(fixture.cards.at(-1).content, /data-sf-action="restore-continuous-action"/u);
});

test("a failed Determination roll clears spell preparation without moving the combatant to waiting", async () => {
    const fixture = installFixture({ actionId: "focusMagic", completionTrigger: "spell" });
    fixture.actor.flags.splittermond.preparedSpell = "spell";
    const request = await requestContinuousActionInterruptionForDamage({
        actorUuid: fixture.actor.uuid,
        damage: 7,
    });
    fixture.rollResult = false;

    const result = await rollContinuousActionInterruption(fixture, request.id);

    assert.equal(result.status, "failed");
    assert.equal(fixture.actor.flags.splittermond.preparedSpell, null);
    assert.equal(getContinuousAction(fixture.token, fixture.combat), null);
    assert.equal(fixture.combatant.initiative, 16, "the projected completion tick remains visible");
    assert.match(fixture.cards.at(-1).content, /data-sf-action="restore-continuous-action"/u);
    assert.deepEqual(getPendingContinuousActionInterruptionsForCurrentUser(fixture.combat), []);
});

test("only a GM can use the chat action to restore an interrupted continuous action", async () => {
    const fixture = installFixture({ actionId: "focusMagic", completionTrigger: "spell" });
    fixture.actor.flags.splittermond.preparedSpell = "spell";
    const request = await requestContinuousActionInterruptionForDamage({
        actorUuid: fixture.actor.uuid,
        damage: 7,
    });
    fixture.rollResult = false;
    const result = await rollContinuousActionInterruption(fixture, request.id);
    const recoveryCard = fixture.cards.at(-1);

    assert.equal(await restoreContinuousActionFromInterruptionCard(recoveryCard), false);
    assert.equal(getContinuousAction(fixture.token, fixture.combat), null);
    fixture.user.isGM = true;
    assert.equal(await restoreContinuousActionFromInterruptionCard(recoveryCard), true);
    assert.ok(getContinuousAction(fixture.token, fixture.combat));
    assert.equal(fixture.actor.flags.splittermond.preparedSpell, "spell");
    assert.equal(recoveryCard.flags[MODULE_ID].continuousActionInterruptionRecoveryCard.status, "restored");
    assert.equal(result.message.flags[MODULE_ID].continuousActionInterruptionRoll.status, "restored");
});

test("the recovery control is hidden from players and shown to GMs", async () => {
    const fixture = installFixture({ actionId: "focusMagic", completionTrigger: "spell" });
    fixture.actor.flags.splittermond.preparedSpell = "spell";
    const request = await requestContinuousActionInterruptionForDamage({
        actorUuid: fixture.actor.uuid,
        damage: 7,
    });
    fixture.rollResult = false;
    await rollContinuousActionInterruption(fixture, request.id);
    const recoveryCard = fixture.cards.at(-1);
    const button = {
        dataset: {},
        hidden: false,
        disabled: false,
        addEventListener() {},
    };
    const html = {
        querySelectorAll: (selector) => selector.includes("restore-continuous-action") ? [button] : [],
    };

    bindContinuousActionInterruptionCard(recoveryCard, html);
    assert.equal(button.hidden, true);
    fixture.user.isGM = true;
    bindContinuousActionInterruptionCard(recoveryCard, html);
    assert.equal(button.hidden, false);
    assert.equal(button.disabled, false);
});

test("a Splinterpoint success restores an interrupted spell preparation", async () => {
    const fixture = installFixture({ actionId: "focusMagic", completionTrigger: "spell" });
    const preparationApplication = {
        version: 1,
        state: "completed",
        kind: "spell",
        itemId: "spell",
    };
    fixture.actor.flags.splittermond.preparedSpell = "spell";
    fixture.actor.flags[MODULE_ID].preparationApplication = preparationApplication;
    const request = await requestContinuousActionInterruptionForDamage({
        actorUuid: fixture.actor.uuid,
        damage: 7,
    });
    fixture.rollResult = false;
    const result = await rollContinuousActionInterruption(fixture, request.id);

    result.message.system.checkReport.succeeded = true;
    assert.equal(await reconcileContinuousActionInterruptionRoll(result.message), true);
    assert.ok(getContinuousAction(fixture.token, fixture.combat));
    assert.equal(fixture.actor.flags.splittermond.preparedSpell, "spell");
    assert.deepEqual(fixture.actor.flags[MODULE_ID].preparationApplication, preparationApplication);
    assert.equal(result.message.flags[MODULE_ID].continuousActionInterruptionRoll.status, "restored");
});

test("a late Splinterpoint cannot restore an action after the token has reached its own turn", async () => {
    const fixture = installFixture({ actionId: "focusMagic", completionTrigger: "spell" });
    fixture.actor.flags.splittermond.preparedSpell = "spell";
    const request = await requestContinuousActionInterruptionForDamage({
        actorUuid: fixture.actor.uuid,
        damage: 7,
    });
    fixture.rollResult = false;
    const result = await rollContinuousActionInterruption(fixture, request.id);
    fixture.combat.currentTick = fixture.combatant.initiative;
    fixture.combat.combatant = fixture.combatant;

    result.message.system.checkReport.succeeded = true;
    assert.equal(await reconcileContinuousActionInterruptionRoll(result.message), false);
    assert.equal(getContinuousAction(fixture.token, fixture.combat), null);
    assert.equal(fixture.actor.flags.splittermond.preparedSpell, null);
    assert.equal(result.message.flags[MODULE_ID].continuousActionInterruptionRoll.status, "expired");
});

test("a Splinterpoint success restores Aim and Search for an Opening bonuses", async (t) => {
    for (const actionId of ["aim", "searchOpening"]) {
        await t.test(actionId, async () => {
            const fixture = installFixture({ actionId, completionTrigger: "attack" });
            const preparation = {
                id: `${actionId}-preparation`,
                actionId,
                ticks: 4,
                bonus: 2,
                combatId: fixture.combat.id,
                combatantId: fixture.combatant.id,
            };
            if (actionId === "aim") {
                preparation.attackId = "bow";
                preparation.targetTokenUuid = "Scene.scene.Token.target";
            }
            fixture.actor.flags[MODULE_ID].attackPreparation = preparation;
            const request = await requestContinuousActionInterruptionForDamage({
                actorUuid: fixture.actor.uuid,
                damage: 4,
            });
            fixture.rollResult = false;
            const result = await rollContinuousActionInterruption(fixture, request.id);

            assert.equal(fixture.actor.flags[MODULE_ID].attackPreparation, null);
            result.message.system.checkReport.succeeded = true;
            assert.equal(await reconcileContinuousActionInterruptionRoll(result.message), true);
            assert.deepEqual(fixture.actor.flags[MODULE_ID].attackPreparation, preparation);
            assert.ok(getContinuousAction(fixture.token, fixture.combat));
        });
    }
});

test("a Splinterpoint success resumes an interrupted movement from its actual route position", async () => {
    const fixture = installFixture({ actionId: "walk", completionTrigger: "movement" });
    const plan = {
        version: 1,
        actionId: "walk",
        combatId: fixture.combat.id,
        combatantId: fixture.combatant.id,
        completedFraction: 0.25,
        createdBy: fixture.user.id,
        milestones: [
            { tick: 11, tickOffset: 1, fraction: 0.25 },
            { tick: 13, tickOffset: 3, fraction: 0.5 },
            { tick: 15, tickOffset: 5, fraction: 0.75 },
            { tick: 16, tickOffset: 6, fraction: 1 },
        ],
        route: [{ x: 0, y: 0 }, { x: 60, y: 0 }],
        segmentLengths: [60],
        startTick: 10,
        tokenUuid: fixture.token.uuid,
    };
    fixture.token.flags[MODULE_ID].movementPlan = plan;
    fixture.token.x = 15;
    fixture.token.y = 0;
    fixture.token.elevation = 0;
    const request = await requestContinuousActionInterruptionForDamage({
        actorUuid: fixture.actor.uuid,
        damage: 4,
    });
    fixture.rollResult = false;
    const result = await rollContinuousActionInterruption(fixture, request.id);

    assert.equal(fixture.token.flags[MODULE_ID].movementPlan, null);
    result.message.system.checkReport.succeeded = true;
    assert.equal(await reconcileContinuousActionInterruptionRoll(result.message), true);
    assert.equal(fixture.token.flags[MODULE_ID].movementPlan.completedFraction, 0.25);
    assert.ok(getContinuousAction(fixture.token, fixture.combat));
});

test("active defense warns before interrupting while Coordinated Evasion preserves Acrobatics", async () => {
    const fixture = installFixture();
    fixture.actor.items.push({
        type: "mastery",
        name: "Koordiniertes Ausweichen",
        system: { id: "koordiniertesAusweichen" },
    });

    assert.equal(await confirmContinuousActionInterruptionForActiveDefense(fixture.token, {
        skillId: "acrobatics",
    }), true);
    assert.equal(fixture.confirmations.length, 0, "the mastery exception needs no warning");
    assert.equal(await interruptContinuousActionForActiveDefense(fixture.token, {
        skillId: "acrobatics",
    }), false);
    assert.ok(getContinuousAction(fixture.token, fixture.combat));

    assert.equal(await confirmContinuousActionInterruptionForActiveDefense(fixture.token), true);
    assert.equal(fixture.confirmations.length, 1);
    assert.deepEqual(
        fixture.confirmations[0].buttons.map(({ label }) => label),
        [
            "SMOOTHER_FIGHT.HUD.ActiveDefenseInterruptionConfirm",
            "SMOOTHER_FIGHT.HUD.ActiveDefenseInterruptionDecline",
        ],
    );
    assert.equal(await interruptContinuousActionForActiveDefense(fixture.token), true);
    assert.equal(getContinuousAction(fixture.token, fixture.combat), null);
    assert.equal(fixture.combatant.initiative, 16);
    assert.match(fixture.cards.at(-1).content, /data-sf-action="restore-continuous-action"/u);
    assert.equal(
        fixture.cards.at(-1).flags[MODULE_ID].continuousActionInterruptionRecoveryCard.reason,
        "activeDefense",
    );
});

test("standalone active defense interrupts only when the warned player actually rolls", async () => {
    const fixture = installFixture();
    let defenseRolls = 0;
    fixture.actor.rollActiveDefense = async () => {
        defenseRolls += 1;
        return true;
    };
    fixture.actor.activeDefenseDialog = async function () {
        return {
            close() {},
            roll: () => this.rollActiveDefense("defense", { id: "sword", skill: { id: "blades" } }),
        };
    };
    services.confirmContinuousActionInterruptionForActiveDefense = confirmContinuousActionInterruptionForActiveDefense;
    services.interruptContinuousActionForActiveDefense = interruptContinuousActionForActiveDefense;

    const dialog = await beginStandaloneActiveDefense(fixture, "defense");

    assert.equal(fixture.confirmations.length, 1);
    assert.ok(getContinuousAction(fixture.token, fixture.combat), "opening the dialog alone does not interrupt");
    await dialog.roll();
    assert.equal(defenseRolls, 1);
    assert.equal(getContinuousAction(fixture.token, fixture.combat), null);
    assert.equal(fixture.combatant.initiative, 16);
});

test("standalone resistance defense also waits for the actual roll before interrupting", async () => {
    const fixture = installFixture();
    let defenseRolls = 0;
    fixture.actor.rollActiveDefense = async () => {
        defenseRolls += 1;
        return true;
    };
    fixture.actor.activeDefenseDialog = async function () {
        return {
            close() {},
            roll: () => this.rollActiveDefense("bodyresist", { id: "endurance", skill: { id: "endurance" } }),
        };
    };
    services.confirmContinuousActionInterruptionForActiveDefense = confirmContinuousActionInterruptionForActiveDefense;
    services.interruptContinuousActionForActiveDefense = interruptContinuousActionForActiveDefense;

    const dialog = await beginStandaloneActiveDefense(fixture, "kw");

    assert.equal(fixture.confirmations.length, 1);
    assert.ok(getContinuousAction(fixture.token, fixture.combat));
    await dialog.roll();
    assert.equal(defenseRolls, 1);
    assert.equal(getContinuousAction(fixture.token, fixture.combat), null);
});

function installFixture({ actionId = "coordinate", completionTrigger = "tick" } = {}) {
    const rolls = [];
    const cards = [];
    const confirmations = [];
    const eventGroups = [];
    const messages = new Map();
    const actorFlags = { splittermond: {}, [MODULE_ID]: {} };
    const actor = {
        id: "actor",
        uuid: "Actor.actor",
        name: "Held",
        isOwner: true,
        effects: [],
        items: [],
        flags: actorFlags,
        getFlag(scope, key) {
            return this.flags[scope]?.[key] ?? null;
        },
        async setFlag(scope, key, value) {
            this.flags[scope] ??= {};
            this.flags[scope][key] = structuredClone(value);
            return this;
        },
        async deleteEmbeddedDocuments() {
            return [];
        },
        async rollSkill(skillId, options) {
            rolls.push({ skillId, difficulty: options.difficulty });
            const message = flagDocument({
                id: "determination-roll",
                system: { checkReport: { succeeded: fixture.rollResult } },
            });
            messages.set(message.id, message);
            return message;
        },
    };
    const action = {
        version: 2,
        id: "continuous",
        actionId,
        completionTrigger,
        combatId: "combat",
        combatantId: "combatant",
        tokenUuid: "Scene.scene.Token.token",
        startTick: 10,
        endTick: 16,
        createdAt: 1,
        createdBy: "player",
        updatedAt: 1,
    };
    const tokenFlags = { [MODULE_ID]: { [CONTINUOUS_ACTION_FLAG]: action } };
    const token = {
        id: "token",
        uuid: action.tokenUuid,
        name: "Heldentoken",
        actor,
        flags: tokenFlags,
        getFlag(scope, key) {
            return this.flags[scope]?.[key] ?? null;
        },
        async setFlag(scope, key, value) {
            this.flags[scope] ??= {};
            this.flags[scope][key] = structuredClone(value);
            return this;
        },
    };
    const combatant = { id: action.combatantId, initiative: action.endTick, actor, token };
    const ahead = { id: "ahead", initiative: 12 };
    const combat = {
        id: action.combatId,
        currentTick: 12,
        combatant: ahead,
        combatants: new Map([[combatant.id, combatant], [ahead.id, ahead]]),
        turns: [ahead, combatant],
    };
    const user = { id: "player", isGM: false };
    const fixture = {
        actor,
        cards,
        combat,
        combatant,
        confirmations,
        eventGroups,
        messages,
        rollResult: true,
        rolls,
        token,
        user,
    };

    globalThis.game = {
        combat,
        messages,
        user,
        i18n: {
            localize: (key) => key,
            format: (key, data) => `${key}:${JSON.stringify(data)}`,
        },
    };
    globalThis.ui = { notifications: { error: () => {}, info: () => {}, warn: () => {} } };
    let id = 0;
    globalThis.foundry = {
        applications: { api: { DialogV2: { wait: async (options) => {
            confirmations.push(options);
            return options.buttons.find(({ default: isDefault }) => isDefault)?.callback?.();
        } } } },
        utils: { randomID: () => `request-${++id}` },
    };
    globalThis.ChatMessage = {
        create: async (data) => {
            const message = flagDocument({
                id: `card-${cards.length + 1}`,
                ...data,
                flags: structuredClone(data.flags ?? {}),
            });
            cards.push(message);
            messages.set(message.id, message);
            return message;
        },
        getSpeaker: () => ({ actor: actor.id, token: token.id }),
    };
    services.getMessageContext = (message) => message?.flags?.[MODULE_ID]?.context ?? null;
    services.getHudContext = () => ({ combat });
    services.collectCombatEventGroups = () => eventGroups;
    services.getRuntimeController = () => user;
    services.resolveToken = (reference) => reference === token.uuid || reference === token.id ? token : null;
    services.abortMovementPlan = async (tokenLike) => {
        const document = tokenLike?.document ?? tokenLike;
        await document.setFlag(MODULE_ID, "movementPlan", null);
        return true;
    };
    services.scheduleRender = () => {};
    services.waitForDiceSoNice = async () => {};
    return fixture;
}

function installHookFixture() {
    const handlers = new Map();
    let id = 0;
    globalThis.Hooks = {
        on(hook, callback) {
            const registration = ++id;
            handlers.set(registration, { hook, callback });
            return registration;
        },
        off(hook, registration) {
            if (handlers.get(registration)?.hook === hook) handlers.delete(registration);
        },
    };
    return {
        emit(hook, ...args) {
            for (const handler of [...handlers.values()]) {
                if (handler.hook === hook) handler.callback(...args);
            }
        },
    };
}

function flagDocument(data) {
    return {
        flags: {},
        ...data,
        getFlag(scope, key) {
            return this.flags[scope]?.[key] ?? null;
        },
        async setFlag(scope, key, value) {
            this.flags[scope] ??= {};
            this.flags[scope][key] = structuredClone(value);
            return this;
        },
    };
}
