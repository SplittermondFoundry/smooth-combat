import assert from "node:assert/strict";
import test from "node:test";

import {
    combatWorkflowAllowsTick,
    combatWorkflowCandidates,
    selectCombatWorkflowFocus,
} from "../Modul/splittermond-smoother-fight/scripts/domain/combat-flow.js";

import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    analyzeCombatEventGroups,
    messageHasPendingFlowAction,
    messageHasPendingTicks,
} from "../Modul/splittermond-smoother-fight/scripts/features/combat-events/workflow.js";
import { collectCombatEventPresentation } from "../Modul/splittermond-smoother-fight/scripts/features/combat-events/service.js";
import { requireOpenCombatFlowForTicks } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/flow-guard.js";
import { hasPendingFumbleActions } from "../Modul/splittermond-smoother-fight/scripts/features/fumbles/fumbles.js";
import { getRunningActiveDefense } from "../Modul/splittermond-smoother-fight/scripts/features/active-defense/active-defense.js";
import { receivePublishedPendingDefense } from "../Modul/splittermond-smoother-fight/scripts/features/active-defense/pending.js";
import { rejectBlockedCombatWorkflowTick } from "../Modul/splittermond-smoother-fight/scripts/features/chat/tick-flow.js";

function card(messageId, kind, overrides = {}) {
    return { groupId: overrides.groupId ?? messageId, messageId, kind, ...overrides };
}

function message(id, { content = "", context = {}, timestamp = 0, flags = {}, system = {} } = {}) {
    return {
        id,
        content,
        flags: { "splittermond-smoother-fight": { context, ...flags } },
        system,
        timestamp,
    };
}

function group(primary, { defenses = [], damages = [], fumbles = [] } = {}) {
    return { primary, kind: "attack", defenses, damages, fumbles };
}

test("active-defense ticks retain focus ahead of a recalculated attack", () => {
    const workflow = {
        id: "root",
        createdAt: 10,
        cards: [
            card("root", "offense", { canonical: false, pendingAction: false }),
            card("defense", "defense", { groupId: "root", pendingAction: true, pendingTicks: true }),
            card("successor", "offense", { canonical: true, pendingAction: true }),
        ],
    };

    assert.deepEqual(selectCombatWorkflowFocus([workflow]), {
        workflowId: "root",
        createdAt: 10,
        order: 0,
        groupId: "root",
        messageId: "defense",
        kind: "defense",
        step: "defense-ticks",
        blocking: true,
        synthetic: false,
    });

    workflow.cards[1].pendingTicks = false;
    workflow.cards[1].pendingAction = false;
    assert.equal(selectCombatWorkflowFocus([workflow]).messageId, "successor");
    assert.equal(selectCombatWorkflowFocus([workflow]).step, "offense");
});

test("pending fumble effects take blocking focus ahead of active-defense ticks", () => {
    const workflow = {
        id: "root",
        createdAt: 10,
        cards: [
            card("root", "offense", { canonical: true, pendingAction: false }),
            card("defense", "defense", { groupId: "root", pendingAction: true, pendingTicks: true }),
            card("fumble", "fumble", { groupId: "root", pendingAction: true }),
        ],
    };

    assert.deepEqual(selectCombatWorkflowFocus([workflow]), {
        workflowId: "root",
        createdAt: 10,
        order: 0,
        groupId: "root",
        messageId: "fumble",
        kind: "fumble",
        step: "fumble",
        blocking: true,
        synthetic: false,
    });

    workflow.cards[2].pendingAction = false;
    assert.equal(selectCombatWorkflowFocus([workflow]).messageId, "defense");
    assert.equal(selectCombatWorkflowFocus([workflow]).step, "defense-ticks");
});

test("a pending Determination interruption becomes the blocking card before attack follow-ups", () => {
    const workflow = {
        id: "attack",
        createdAt: 10,
        cards: [
            card("attack", "offense", { canonical: true, pendingAction: true }),
            card("damage", "damage", { groupId: "attack", pendingAction: false }),
            card("determination", "interruption", { groupId: "attack", pendingAction: true }),
        ],
    };

    assert.deepEqual(selectCombatWorkflowFocus([workflow]), {
        workflowId: "attack",
        createdAt: 10,
        order: 0,
        groupId: "attack",
        messageId: "determination",
        kind: "interruption",
        step: "interruption",
        blocking: true,
        synthetic: false,
    });

    workflow.cards[2].pendingAction = false;
    assert.equal(selectCombatWorkflowFocus([workflow]).messageId, "attack");
});

test("an interruption card joins its attack group and overrides the open offense card", () => {
    services.getMessageContext = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.context ?? {};
    services.defenseAwaitsResponse = () => false;
    services.isContinuousActionInterruptionPending = () => true;
    const offense = message("attack", {
        timestamp: 1,
        content: '<button data-action="advanceToken">Ticks</button>',
    });
    const determination = message("determination", { timestamp: 3 });
    const presentation = analyzeCombatEventGroups([
        { ...group(offense), interruptions: [determination] },
    ]);

    assert.equal(presentation.focus?.messageId, "determination");
    assert.equal(presentation.focus?.step, "interruption");
    assert.equal(presentation.focus?.groupId, "attack");
});

test("the event collector associates a pending interruption with its source damage card", (t) => {
    const previousGame = globalThis.game;
    const serviceNames = [
        "defenseAwaitsResponse",
        "getContinuousActionInterruptionCard",
        "getDamageApplicationState",
        "getFumbleData",
        "getMessageContext",
        "getRunningActiveDefense",
        "hasPendingFumbleActions",
        "isContinuousActionInterruptionPending",
        "isDamageMessage",
        "isDefenseMessage",
        "isDiceAnimationPending",
        "isFumbleTableMessage",
        "isSpellMessage",
    ];
    const previousServices = Object.fromEntries(serviceNames.map((name) => [name, services[name]]));
    t.after(() => {
        globalThis.game = previousGame;
        Object.assign(services, previousServices);
    });

    const combat = { id: "combat", combatants: [{ actorId: "attacker" }] };
    const offense = {
        ...message("attack", {
            timestamp: 1,
            context: { combatId: combat.id, combatantId: "attacker-combatant" },
            content: '<button data-action="advanceToken">Ticks</button>',
        }),
        type: "attackRollMessage",
        speaker: { actor: "attacker" },
    };
    const damage = {
        ...message("damage", { timestamp: 2, context: { attackMessageId: offense.id } }),
        type: "damageMessage",
        speaker: { actor: "attacker" },
    };
    const determination = {
        ...message("determination", { timestamp: 3 }),
        speaker: { actor: "defender" },
    };
    globalThis.game = {
        combat,
        messages: { contents: [offense, damage, determination] },
        settings: { get: () => 3 },
    };
    services.getMessageContext = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.context ?? null;
    services.isDiceAnimationPending = () => false;
    services.isSpellMessage = () => false;
    services.isDamageMessage = (entry) => entry?.type === "damageMessage";
    services.isDefenseMessage = () => false;
    services.isFumbleTableMessage = () => false;
    services.getFumbleData = () => null;
    services.defenseAwaitsResponse = () => false;
    services.getDamageApplicationState = () => "completed";
    services.getRunningActiveDefense = () => null;
    services.isContinuousActionInterruptionPending = (entry) => entry?.id === determination.id;
    services.getContinuousActionInterruptionCard = () => ({
        sourceMessageId: damage.id,
        combatId: combat.id,
        combatantId: "defender-combatant",
    });

    const presentation = collectCombatEventPresentation({ combat });
    assert.deepEqual(presentation.groups[0].interruptions.map((entry) => entry.id), [determination.id]);
    assert.equal(presentation.focus?.messageId, determination.id);
    assert.equal(presentation.focus?.step, "interruption");
});

test("the event collector restores a completed fumble linked to its defense card after reload", (t) => {
    const previousGame = globalThis.game;
    const serviceNames = [
        "defenseAwaitsResponse",
        "getDamageApplicationState",
        "getFumbleData",
        "getMessageContext",
        "getRunningActiveDefense",
        "hasPendingFumbleActions",
        "isContinuousActionInterruptionPending",
        "isDamageMessage",
        "isDefenseMessage",
        "isDiceAnimationPending",
        "isFumbleTableMessage",
        "isSpellMessage",
    ];
    const previousServices = Object.fromEntries(serviceNames.map((name) => [name, services[name]]));
    t.after(() => {
        globalThis.game = previousGame;
        Object.assign(services, previousServices);
    });

    const combat = { id: "combat", combatants: [{ actorId: "attacker" }, { actorId: "defender" }] };
    const offense = {
        ...message("attack", {
            timestamp: 1,
            context: { combatId: combat.id, defenseMessageIds: ["defense"] },
        }),
        type: "attackRollMessage",
        speaker: { actor: "attacker" },
    };
    const defense = {
        ...message("defense", {
            timestamp: 2,
            context: { attackMessageId: offense.id },
            content: '<button class="rollable" data-roll-type="attackFumble">Fumble</button>',
        }),
        type: "defenseMessage",
        speaker: { actor: "defender" },
    };
    const fumble = {
        ...message("fumble", {
            timestamp: 3,
            flags: {
                fumble: {
                    kind: "fight",
                    sourceMessageId: defense.id,
                    ticks: 3,
                    damagesWeapon: false,
                    damage: 0,
                    conditions: [],
                    applications: { ticks: { state: "completed" } },
                },
            },
        }),
        type: "fumbleMessage",
        speaker: { actor: "defender" },
    };
    globalThis.game = {
        combat,
        messages: { contents: [offense, defense, fumble] },
        settings: { get: () => 3 },
    };
    services.getMessageContext = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.context ?? null;
    services.isDiceAnimationPending = () => false;
    services.isSpellMessage = () => false;
    services.isDamageMessage = () => false;
    services.isDefenseMessage = (entry) => entry?.id === defense.id;
    services.isFumbleTableMessage = (entry) => entry?.id === fumble.id;
    services.getFumbleData = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.fumble ?? null;
    services.hasPendingFumbleActions = hasPendingFumbleActions;
    services.defenseAwaitsResponse = () => false;
    services.getDamageApplicationState = () => "completed";
    services.getRunningActiveDefense = () => null;
    services.isContinuousActionInterruptionPending = () => false;

    const presentation = collectCombatEventPresentation({ combat });

    assert.deepEqual(presentation.groups[0].defenses.map((entry) => entry.id), [defense.id]);
    assert.deepEqual(presentation.groups[0].fumbles.map((entry) => entry.id), [fumble.id]);
    assert.equal(presentation.focus, null);
});

test("the oldest unresolved workflow wins without depending on the active combatant", () => {
    const opportunity = {
        id: "opportunity",
        createdAt: 20,
        cards: [card("opportunity", "offense", {
            awaitingDefense: true,
            canonical: true,
            pendingAction: true,
        })],
    };
    const older = {
        id: "older",
        createdAt: 10,
        cards: [card("older-defense", "defense", { pendingTicks: true })],
    };

    assert.deepEqual(combatWorkflowCandidates([opportunity, older]).map((entry) => entry.workflowId), [
        "older",
        "opportunity",
    ]);
    assert.equal(selectCombatWorkflowFocus([opportunity]).step, "defense-decision");
});

test("recalculated attacks share one workflow and pending workflows ignore the history limit", () => {
    services.getMessageContext = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.context ?? {};
    services.defenseAwaitsResponse = (entry) => services.getMessageContext(entry).defensePhase === "open";

    const root = message("root", {
        timestamp: 10,
        context: { supersededBy: "successor", outOfTurn: true },
    });
    const defense = message("defense", {
        timestamp: 11,
        content: '<button class="add-tick" data-ticks="3">Ticks</button>',
        context: { attackMessageId: "root" },
    });
    const successor = message("successor", {
        timestamp: 12,
        content: '<button data-action="advanceToken">Ticks</button>',
        context: {
            rootAttackMessageId: "root",
            recalculatedFrom: "root",
            defensePhase: "resolved",
            outOfTurn: true,
        },
    });
    const presentation = analyzeCombatEventGroups([
        group(root, { defenses: [defense] }),
        group(successor),
    ], { maxCards: 1 });

    assert.equal(presentation.workflows.length, 1);
    assert.deepEqual(presentation.groups.map((entry) => entry.primary.id), ["root", "successor"]);
    assert.equal(presentation.focus.messageId, "defense");
    assert.equal(presentation.focus.step, "defense-ticks");

    defense.flags["splittermond-smoother-fight"].legacyTickAdvance = { state: "completed" };
    const completedDefense = analyzeCombatEventGroups([
        group(root, { defenses: [defense] }),
        group(successor),
    ], { maxCards: 1 });
    assert.equal(completedDefense.focus.messageId, "successor");
    assert.equal(completedDefense.focus.step, "offense");
});

test("uncertain defense tick applications remain blocking until recovered", () => {
    const defense = message("defense", {
        content: '<button class="add-tick" data-ticks="3">Ticks</button>',
        flags: { legacyTickAdvance: { state: "uncertain" } },
    });
    assert.equal(messageHasPendingTicks(defense), true);
    defense.flags["splittermond-smoother-fight"].legacyTickAdvance.state = "completed";
    assert.equal(messageHasPendingTicks(defense), false);
});

test("a prepared spell retains its three release ticks when the system omitted the button", () => {
    services.getMessageContext = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.context ?? {};
    const spell = message("spell", {
        context: {
            actionKind: "spell",
            combatId: "combat",
            combatantId: "caster",
        },
        system: {
            tickCostHandler: {
                baseTickCost: 3,
                isOption: false,
                used: false,
            },
        },
    });
    spell.type = "spellRollMessage";

    assert.equal(messageHasPendingTicks(spell), true);
    spell.flags["splittermond-smoother-fight"].legacyTickAdvance = { state: "completed" };
    assert.equal(messageHasPendingTicks(spell), false);
});

test("unused optional degrees do not retain an otherwise completed offense", () => {
    const offense = message("offense", {
        content: '<button data-action="applyDamage" disabled>Damage</button><button data-action="advanceToken" disabled>Ticks</button>',
        system: { openDegreesOfSuccess: 2, tickCostHandler: { used: true } },
    });

    assert.equal(messageHasPendingFlowAction(offense), false);
});

test("an associated damage card replaces the attack damage action and completed ticks close the workflow", () => {
    services.getMessageContext = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.context ?? {};
    services.defenseAwaitsResponse = () => false;
    services.getDamageApplicationState = (entry) => (
        entry?.flags?.["splittermond-smoother-fight"]?.damageApplication?.state ?? "idle"
    );
    const offense = message("offense", {
        timestamp: 1,
        content: '<button data-action="rollDamage">Damage</button><button data-action="advanceToken">Ticks</button>',
        flags: { legacyTickAdvance: { state: "completed" } },
    });
    const damage = message("damage", {
        timestamp: 2,
        content: '<button data-action="applyDamage">Apply</button>',
        context: { attackMessageId: "offense" },
    });

    const pendingDamage = analyzeCombatEventGroups([group(offense, { damages: [damage] })]);
    assert.equal(pendingDamage.focus?.messageId, "damage");
    assert.equal(pendingDamage.focus?.step, "damage");

    damage.flags["splittermond-smoother-fight"].damageApplication = { state: "completed" };
    assert.equal(analyzeCombatEventGroups([group(offense, { damages: [damage] })]).focus, null);
});

test("reload does not reopen an idle damage card after its attacker has left the original tick", () => {
    services.getMessageContext = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.context ?? {};
    services.defenseAwaitsResponse = () => false;
    services.getDamageApplicationState = (entry) => (
        entry?.flags?.["splittermond-smoother-fight"]?.damageApplication?.state ?? "idle"
    );
    globalThis.game = {
        combat: {
            id: "combat",
            combatants: new Map([["attacker", {
                id: "attacker",
                actorId: "actor",
                initiative: 22,
            }]]),
        },
    };
    const offense = message("expired-offense", {
        timestamp: 1,
        content: '<button data-action="advanceToken">Ticks</button>',
        context: {
            combatId: "combat",
            combatantId: "attacker",
            attackerInitiativeAtCreation: 13,
        },
    });
    offense.speaker = { actor: "actor" };
    const damage = message("expired-damage", {
        timestamp: 2,
        content: '<button data-action="applyDamageToSelf">Apply</button>',
        context: { attackMessageId: offense.id },
    });

    const presentation = analyzeCombatEventGroups([group(offense, { damages: [damage] })]);

    assert.equal(presentation.focus, null);
    assert.deepEqual(presentation.candidates, []);
});

test("reload closes a recalculated attack after its exact combatant advanced in a Foundry collection", (t) => {
    const previousGame = globalThis.game;
    const previousGetMessageContext = services.getMessageContext;
    const previousDefenseAwaitsResponse = services.defenseAwaitsResponse;
    t.after(() => {
        globalThis.game = previousGame;
        services.getMessageContext = previousGetMessageContext;
        services.defenseAwaitsResponse = previousDefenseAwaitsResponse;
    });

    services.getMessageContext = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.context ?? {};
    services.defenseAwaitsResponse = () => false;
    const combatant = {
        id: "pranke-combatant",
        actorId: "pranke-actor",
        tokenId: "pranke-token",
        initiative: 22.02,
    };
    const combatants = {
        contents: [combatant],
        *[Symbol.iterator]() {
            yield [combatant.id, combatant];
        },
    };
    const combat = { id: "combat", combatants };
    globalThis.game = {
        combat,
        combats: {
            get: (id) => id === combat.id ? combat : null,
            values: () => [combat],
        },
    };

    const root = message("root", {
        timestamp: 1,
        context: {
            combatId: combat.id,
            combatantId: combatant.id,
            attackerTokenUuid: "Scene.scene.Token.pranke-token",
            attackerInitiativeAtCreation: 18.03,
            supersededBy: "successor",
        },
    });
    root.speaker = { actor: combatant.actorId, token: combatant.tokenId };
    const defense = message("defense", {
        timestamp: 2,
        content: '<button class="add-tick" data-ticks="2">Ticks</button>',
        context: { attackMessageId: root.id },
        flags: { legacyTickAdvance: { state: "completed" } },
    });
    const successor = message("successor", {
        timestamp: 3,
        content: '<button data-action="advanceToken">8 Ticks</button>',
        context: {
            combatId: combat.id,
            combatantId: combatant.id,
            attackerTokenUuid: "Scene.scene.Token.pranke-token",
            attackerInitiativeAtCreation: 18.03,
            rootAttackMessageId: root.id,
            recalculatedFrom: root.id,
            defensePhase: "resolved",
        },
        system: { tickCostHandler: { used: false } },
    });
    successor.speaker = { actor: combatant.actorId, token: combatant.tokenId };

    const presentation = analyzeCombatEventGroups([
        group(root, { defenses: [defense] }),
        group(successor),
    ]);

    assert.equal(messageHasPendingTicks(successor), false);
    assert.equal(presentation.focus, null);
    assert.deepEqual(presentation.candidates, []);
});

test("an uncertain damage application remains visible after its attacker advances", () => {
    services.getMessageContext = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.context ?? {};
    services.defenseAwaitsResponse = () => false;
    services.getDamageApplicationState = (entry) => (
        entry?.flags?.["splittermond-smoother-fight"]?.damageApplication?.state ?? "idle"
    );
    globalThis.game = {
        combat: {
            id: "combat",
            combatants: new Map([["attacker", {
                id: "attacker",
                actorId: "actor",
                initiative: 22,
            }]]),
        },
    };
    const offense = message("uncertain-offense", {
        timestamp: 1,
        context: {
            combatId: "combat",
            combatantId: "attacker",
            attackerInitiativeAtCreation: 13,
        },
    });
    offense.speaker = { actor: "actor" };
    const damage = message("uncertain-damage", {
        timestamp: 2,
        content: '<button data-action="applyDamageToSelf">Apply</button>',
        context: { attackMessageId: offense.id },
        flags: { damageApplication: { state: "uncertain" } },
    });

    const presentation = analyzeCombatEventGroups([group(offense, { damages: [damage] })]);

    assert.equal(presentation.focus?.messageId, damage.id);
    assert.equal(presentation.focus?.step, "damage");
});

test("expired damage workflows obey the configured combat-log history limit", () => {
    services.getMessageContext = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.context ?? {};
    services.defenseAwaitsResponse = () => false;
    services.getDamageApplicationState = () => "idle";
    const combatants = new Map();
    const groups = Array.from({ length: 6 }, (_, index) => {
        const combatantId = `attacker-${index}`;
        const actorId = `actor-${index}`;
        combatants.set(combatantId, {
            id: combatantId,
            actorId,
            initiative: 20 + index,
        });
        const offense = message(`offense-${index}`, {
            timestamp: index * 2,
            context: {
                combatId: "combat",
                combatantId,
                attackerInitiativeAtCreation: 10 + index,
            },
        });
        offense.speaker = { actor: actorId };
        const damage = message(`damage-${index}`, {
            timestamp: index * 2 + 1,
            content: '<button data-action="applyDamageToSelf">Apply</button>',
            context: { attackMessageId: offense.id },
        });
        return group(offense, { damages: [damage] });
    });
    globalThis.game = {
        combat: { id: "combat", combatants },
    };

    const presentation = analyzeCombatEventGroups(groups, { maxCards: 2 });

    assert.deepEqual(presentation.groups.map((entry) => entry.primary.id), ["offense-4", "offense-5"]);
    assert.deepEqual(presentation.candidates, []);
});

test("an associated fumble card replaces the attack fumble action", () => {
    services.getMessageContext = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.context ?? {};
    services.defenseAwaitsResponse = () => false;
    services.hasPendingFumbleActions = () => false;
    const offense = message("offense", {
        timestamp: 1,
        content: '<button class="rollable" data-roll-type="attack-fumble">Fumble</button>',
    });
    const fumble = message("fumble", { timestamp: 2 });

    assert.equal(messageHasPendingFlowAction(offense), true);
    assert.equal(analyzeCombatEventGroups([group(offense, { fumbles: [fumble] })]).focus, null);
});

test("an associated fumble card also replaces its defense-card fumble action after reload", () => {
    services.getMessageContext = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.context ?? {};
    services.getFumbleData = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.fumble ?? null;
    services.defenseAwaitsResponse = () => false;
    services.hasPendingFumbleActions = () => false;
    const offense = {
        ...message("offense", { timestamp: 1 }),
        speaker: { actor: "attacker" },
    };
    const defense = {
        ...message("defense", {
            timestamp: 2,
            context: { attackMessageId: offense.id },
            content: '<button class="rollable" data-roll-type="attack-fumble">Fumble</button>',
        }),
        speaker: { actor: "defender" },
    };
    const fumble = {
        ...message("fumble", {
            timestamp: 3,
            flags: { fumble: { sourceMessageId: offense.id } },
        }),
        speaker: { actor: "defender" },
    };

    assert.equal(messageHasPendingFlowAction(defense), true);
    assert.equal(analyzeCombatEventGroups([
        group(offense, { defenses: [defense], fumbles: [fumble] }),
    ]).focus, null);
});

test("advancing the attacker through another tick control completes the card tick step", () => {
    services.getMessageContext = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.context ?? {};
    globalThis.game = {
        combat: {
            id: "combat",
            combatants: new Map([["attacker", {
                id: "attacker",
                actorId: "actor",
                initiative: 14,
            }]]),
        },
    };
    const offense = message("offense", {
        content: '<button data-action="advanceToken">Ticks</button>',
        context: {
            combatId: "combat",
            combatantId: "attacker",
            attackerInitiativeAtCreation: 10,
        },
    });
    offense.speaker = { actor: "actor" };

    assert.equal(messageHasPendingTicks(offense), false);
    assert.equal(messageHasPendingFlowAction(offense), false);

    const current = message("current", {
        timestamp: 2,
        content: '<button data-action="advanceToken">Ticks</button>',
        context: {
            combatId: "combat",
            combatantId: "attacker",
            attackerInitiativeAtCreation: 14,
        },
    });
    current.speaker = { actor: "actor" };
    offense.timestamp = 1;
    services.defenseAwaitsResponse = () => false;
    const presentation = analyzeCombatEventGroups([group(offense), group(current)], { maxCards: 1 });
    assert.equal(presentation.focus?.messageId, "current");
    assert.deepEqual(presentation.candidates.map((entry) => entry.messageId), ["current"]);
});

test("an actor-only card stays pending when only one of multiple shared-actor combatants advanced", () => {
    services.getMessageContext = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.context ?? {};
    globalThis.game = {
        combat: {
            id: "combat",
            combatants: new Map([
                ["wolf-a", { id: "wolf-a", actorId: "wolf", tokenId: "token-a", initiative: 20 }],
                ["wolf-b", { id: "wolf-b", actorId: "wolf", tokenId: "token-b", initiative: 10 }],
            ]),
        },
    };
    const offense = message("ambiguous-offense", {
        content: '<button data-action="advanceToken">Ticks</button>',
        context: {
            combatId: "combat",
            attackerActorUuid: "Actor.wolf",
            attackerInitiativeAtCreation: 10,
        },
    });
    offense.speaker = { actor: "wolf" };

    assert.equal(messageHasPendingTicks(offense), true);
});

test("singular attack costs remain part of the offense workflow", () => {
    const offense = message("offense", {
        content: '<button data-action="consumeCost">Cost</button>',
    });
    assert.equal(messageHasPendingFlowAction(offense), true);
});

test("persisted fumble actions take focus until every effect is completed", () => {
    services.getMessageContext = (entry) => entry?.flags?.["splittermond-smoother-fight"]?.context ?? {};
    services.defenseAwaitsResponse = () => false;
    services.hasPendingFumbleActions = hasPendingFumbleActions;
    const offense = message("offense", { timestamp: 1 });
    const fumble = message("fumble", {
        timestamp: 2,
        flags: {
            fumble: {
                ticks: 3,
                damagesWeapon: false,
                damage: 0,
                conditions: [],
                applications: {},
            },
        },
    });
    assert.equal(hasPendingFumbleActions(fumble), true);
    assert.equal(analyzeCombatEventGroups([
        group(offense, { fumbles: [fumble] }),
    ]).focus?.messageId, "fumble");
    fumble.flags["splittermond-smoother-fight"].fumble.applications.ticks = { state: "completed" };
    assert.equal(hasPendingFumbleActions(fumble), false);
    assert.equal(analyzeCombatEventGroups([
        group(offense, { fumbles: [fumble] }),
    ]).focus, null);
});

test("only the focused defense tick card bypasses a player workflow blocker", () => {
    const blocker = { step: "defense-ticks", messageId: "defense" };
    assert.equal(combatWorkflowAllowsTick({ blocker, messageId: "offense" }), false);
    assert.equal(combatWorkflowAllowsTick({ blocker, messageId: "defense" }), true);
    assert.equal(combatWorkflowAllowsTick({ isGM: true, blocker, messageId: "offense" }), true);
});

test("only the focused fumble card may apply its tick consequence during a fumble blocker", () => {
    const blocker = { step: "fumble", messageId: "fumble" };
    assert.equal(combatWorkflowAllowsTick({ blocker, messageId: "defense" }), false);
    assert.equal(combatWorkflowAllowsTick({ blocker, messageId: "fumble" }), true);
    assert.equal(combatWorkflowAllowsTick({ isGM: true, blocker, messageId: "defense" }), true);
});

test("chat-card tick controls reject every non-defense path during the blocker", () => {
    let warning = null;
    let prevented = false;
    services.messageHasPendingTicks = () => true;
    services.canAdvanceCombatWorkflowTicks = () => false;
    services.scheduleRender = () => {};
    globalThis.ui = { notifications: { warn: (value) => { warning = value; } } };
    globalThis.game = { i18n: { localize: (key) => key } };
    const event = {
        preventDefault: () => { prevented = true; },
        stopImmediatePropagation: () => {},
    };
    const button = {
        dataset: { action: "advanceToken" },
        matches: () => false,
    };

    assert.equal(rejectBlockedCombatWorkflowTick(event, button, { id: "offense" }), true);
    assert.equal(prevented, true);
    assert.equal(warning, "SMOOTHER_FIGHT.HUD.CombatFlow.TickBlocked");
});

test("a published active-defense roll is visible to other clients until it clears", () => {
    services.scheduleRender = () => {};
    const pending = {
        pendingDefenseId: "remote-defense",
        attackMessageId: "attack",
        targetTokenUuid: "Scene.scene.Token.target",
        startedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
    };

    assert.equal(receivePublishedPendingDefense(pending, "defender-user", true), true);
    assert.equal(getRunningActiveDefense()?.pendingDefenseId, "remote-defense");
    assert.equal(receivePublishedPendingDefense(pending, "defender-user", false), true);
    assert.notEqual(getRunningActiveDefense()?.pendingDefenseId, "remote-defense");
});

test("ordinary player tick controls stop at a blocking workflow while the GM can override", () => {
    let warnings = 0;
    globalThis.game = {
        user: { id: "player", isGM: false },
        i18n: { localize: (key) => key },
    };
    globalThis.ui = { notifications: { warn: () => { warnings += 1; } } };
    services.getBlockingCombatWorkflow = () => ({ step: "defense-ticks" });
    services.scheduleRender = () => {};

    assert.equal(requireOpenCombatFlowForTicks({ combat: { id: "combat" } }), false);
    assert.equal(warnings, 1);
    globalThis.game.user.isGM = true;
    assert.equal(requireOpenCombatFlowForTicks({ combat: { id: "combat" } }), true);
});
