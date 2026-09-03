import {
    combatWorkflowCandidates,
    selectCombatWorkflowFocus,
} from "../../domain/combat-flow.js";
import { preparedSpellReleaseTickCost } from "../../domain/spell-release.js";

import { MODULE_ID } from "../../core/constants.js";
import { services } from "../../core/services.js";
import { getApplicableCombat } from "../../core/combat-compatibility.js";

const FLOW_ACTIONS = new Set([
    "applydamage",
    "applydamagetoself",
    "applydamagetotargets",
    "applydamagetousertargets",
    "consumecost",
    "consumecosts",
    "damageupdate",
    "rolldamage",
]);

const DAMAGE_FOLLOW_UP_ACTIONS = new Set([
    "applydamage",
    "applydamagetoself",
    "applydamagetotargets",
    "applydamagetousertargets",
    "damageupdate",
    "rolldamage",
]);

export function analyzeCombatEventGroups(groups, { maxCards = 3, pendingDefense = null } = {}) {
    const allGroups = Array.from(groups ?? []);
    const workflows = buildCombatWorkflows(allGroups, pendingDefense);
    const candidates = combatWorkflowCandidates(workflows);
    const focus = selectCombatWorkflowFocus(workflows);
    const pendingWorkflowIds = new Set(candidates.map((candidate) => candidate.workflowId));
    const requiredGroupIds = new Set(workflows
        .filter((workflow) => pendingWorkflowIds.has(workflow.id))
        .flatMap((workflow) => workflow.groupIds));
    const completed = allGroups.filter((group) => !requiredGroupIds.has(group.primary.id));
    const historyLimit = Math.max(1, Number(maxCards) || 3);
    const visibleIds = new Set([
        ...requiredGroupIds,
        ...completed.slice(-historyLimit).map((group) => group.primary.id),
    ]);
    return {
        groups: allGroups.filter((group) => visibleIds.has(group.primary.id)),
        workflows,
        candidates,
        focus,
    };
}

export function buildCombatWorkflows(groups, pendingDefense = null) {
    const allGroups = Array.from(groups ?? []);
    const groupsById = new Map(allGroups.map((group) => [group.primary.id, group]));
    const workflowsById = new Map();
    allGroups.forEach((group, order) => {
        const workflowId = rootOffenseId(group.primary, groupsById);
        const workflow = workflowsById.get(workflowId) ?? {
            id: workflowId,
            createdAt: messageTimestamp(group.primary),
            order,
            groupIds: [],
            cards: [],
        };
        workflow.createdAt = Math.min(workflow.createdAt, messageTimestamp(group.primary));
        workflow.groupIds.push(group.primary.id);
        workflow.cards.push(...cardsForGroup(group, groupsById));
        workflowsById.set(workflowId, workflow);
    });

    const pendingAttackId = pendingDefense?.attackMessageId;
    if (pendingAttackId) {
        const workflow = [...workflowsById.values()].find((candidate) =>
            candidate.groupIds.includes(pendingAttackId)
            || candidate.id === rootOffenseId(groupsById.get(pendingAttackId)?.primary, groupsById)
        );
        const groupId = workflow?.groupIds.find((id) => id === pendingAttackId) ?? workflow?.groupIds.at(-1);
        if (workflow && groupId) {
            workflow.cards.push({
                groupId,
                kind: "defense",
                messageId: `pending-defense:${pendingDefense.pendingDefenseId ?? pendingAttackId}`,
                pendingAction: true,
                step: "defense-roll",
                synthetic: true,
                timestamp: Number(pendingDefense.startedAt) || Date.now(),
            });
        }
    }
    return [...workflowsById.values()].sort((left, right) => left.createdAt - right.createdAt || left.order - right.order);
}

function cardsForGroup(group, groupsById) {
    if (group.kind === "interruption") {
        return [interruptionCard(group.primary, group.primary.id)];
    }
    const primaryContext = services.getMessageContext(group.primary) ?? {};
    const successor = primaryContext.supersededBy && groupsById.has(primaryContext.supersededBy);
    const offenseHasAdvanced = messageSpeakerHasAdvanced(group.primary);
    return [
        {
            groupId: group.primary.id,
            messageId: group.primary.id,
            kind: "offense",
            canonical: !successor,
            awaitingDefense: !successor && services.defenseAwaitsResponse(group.primary),
            pendingAction: !successor && messageHasPendingFlowAction(group.primary, {
                damageFollowUpStarted: group.damages.length > 0,
                fumbleFollowUpStarted: group.fumbles.length > 0,
            }),
            timestamp: messageTimestamp(group.primary),
        },
        ...group.defenses.map((message) => ({
            groupId: group.primary.id,
            messageId: message.id,
            kind: "defense",
            pendingAction: messageHasPendingFlowAction(message, {
                fumbleFollowUpStarted: group.fumbles.some((fumble) => fumbleBelongsToMessage(
                    fumble,
                    message,
                    group.primary
                )),
            }),
            pendingTicks: messageHasPendingTicks(message),
            timestamp: messageTimestamp(message),
        })),
        ...group.damages.map((message) => ({
            groupId: group.primary.id,
            messageId: message.id,
            kind: "damage",
            pendingAction: messageHasPendingFlowAction(message, { workflowExpired: offenseHasAdvanced }),
            pendingTicks: messageHasPendingTicks(message),
            timestamp: messageTimestamp(message),
        })),
        ...group.fumbles.map((message) => ({
            groupId: group.primary.id,
            messageId: message.id,
            kind: "fumble",
            pendingAction: services.hasPendingFumbleActions?.(message)
                ?? messageHasPendingFlowAction(message),
            timestamp: messageTimestamp(message),
        })),
        ...Array.from(group.interruptions ?? [], (message) => interruptionCard(message, group.primary.id)),
    ].sort((left, right) => left.timestamp - right.timestamp);
}

function fumbleBelongsToMessage(fumbleMessage, sourceMessage, primaryMessage) {
    const fumble = services.getFumbleData?.(fumbleMessage);
    const sourceMessageId = fumble?.sourceMessageId;
    if (!sourceMessageId) return false;
    if (sourceMessageId === sourceMessage.id) return true;
    const context = services.getMessageContext(sourceMessage) ?? {};
    const attackIds = new Set([
        primaryMessage?.id,
        context.attackMessageId,
        context.rootAttackMessageId,
    ].filter(Boolean));
    return attackIds.has(sourceMessageId)
        && Boolean(fumbleMessage?.speaker?.actor)
        && fumbleMessage.speaker.actor === sourceMessage?.speaker?.actor;
}

function interruptionCard(message, groupId) {
    return {
        groupId,
        messageId: message.id,
        kind: "interruption",
        pendingAction: services.isContinuousActionInterruptionPending?.(message) ?? true,
        timestamp: messageTimestamp(message),
    };
}

export function messageHasPendingTicks(message) {
    const legacyState = legacyTickState(message);
    if (legacyState === "completed") return false;
    if (legacyState === "applying" || legacyState === "uncertain") return true;
    if (message?.system?.tickCostHandler?.used || messageSpeakerHasAdvanced(message)) return false;
    const renderedActionPending = messageActionTags(message).some((tag) => isUsableTag(tag) && (
        dataValue(tag, "action").toLocaleLowerCase() === "advancetoken"
        || (/\badd-tick\b/iu.test(classValue(tag)) && hasDataAttribute(tag, "ticks"))
    ));
    const context = services.getMessageContext?.(message)
        ?? message?.flags?.[MODULE_ID]?.context
        ?? null;
    return renderedActionPending || Boolean(preparedSpellReleaseTickCost(message, context));
}

export function messageHasPendingFlowAction(message, {
    damageFollowUpStarted = false,
    fumbleFollowUpStarted = false,
    workflowExpired = false,
} = {}) {
    const damageState = effectiveDamageApplicationState(message);
    if (workflowExpired && damageState === "idle") return false;
    if (messageHasPendingTicks(message)) return true;
    const damageCompleted = damageState === "completed";
    return messageActionTags(message).some((tag) => {
        if (!isUsableTag(tag)) return false;
        const action = (
            dataValue(tag, "action")
            || dataValue(tag, "localaction")
            || dataValue(tag, "local-action")
        ).toLocaleLowerCase();
        if (FLOW_ACTIONS.has(action)) {
            if (damageFollowUpStarted && DAMAGE_FOLLOW_UP_ACTIONS.has(action)) return false;
            return !damageCompleted || !/^(?:applydamage|damageupdate)/u.test(action);
        }
        const rollType = dataValue(tag, "roll-type") || dataValue(tag, "rolltype");
        return !fumbleFollowUpStarted && /fumble/iu.test(rollType);
    });
}

function rootOffenseId(message, groupsById) {
    if (!message) return "unknown";
    let current = message;
    const visited = new Set();
    while (current && !visited.has(current.id)) {
        visited.add(current.id);
        const context = services.getMessageContext(current) ?? {};
        if (context.rootAttackMessageId && groupsById.has(context.rootAttackMessageId)) {
            return context.rootAttackMessageId;
        }
        const previous = context.recalculatedFrom ? groupsById.get(context.recalculatedFrom)?.primary : null;
        if (!previous) return current.id;
        current = previous;
    }
    return current?.id ?? message.id;
}

function messageActionTags(message) {
    return String(message?.content ?? "").match(/<(?:button|input|a)\b[^>]*>/giu) ?? [];
}

function isUsableTag(tag) {
    return !/(?:^|\s)disabled(?:\s|=|>)/iu.test(tag)
        && !/\baria-disabled\s*=\s*["']?true\b/iu.test(tag)
        && !/\bchecked(?:\s|=|>)/iu.test(tag);
}

function dataValue(tag, name) {
    const match = tag.match(new RegExp(`\\bdata-${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "iu"));
    return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function hasDataAttribute(tag, name) {
    return new RegExp(`\\bdata-${name}\\s*=`, "iu").test(tag);
}

function classValue(tag) {
    const match = tag.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/iu);
    return match?.[1] ?? match?.[2] ?? "";
}

function legacyTickState(message) {
    const record = message?.getFlag?.(MODULE_ID, "legacyTickAdvance")
        ?? message?.flags?.[MODULE_ID]?.legacyTickAdvance;
    if (record?.state) return record.state;
    if (message?.getFlag?.(MODULE_ID, "legacyTickAdvanceApplied")
        ?? message?.flags?.[MODULE_ID]?.legacyTickAdvanceApplied) return "completed";
    if (message?.getFlag?.(MODULE_ID, "legacyTickAdvanceStarted")
        ?? message?.flags?.[MODULE_ID]?.legacyTickAdvanceStarted) return "uncertain";
    return "idle";
}

function damageApplicationState(message) {
    return message?.getFlag?.(MODULE_ID, "damageApplication")?.state
        ?? message?.flags?.[MODULE_ID]?.damageApplication?.state
        ?? "idle";
}

function effectiveDamageApplicationState(message) {
    return services.getDamageApplicationState?.(message) ?? damageApplicationState(message);
}

function messageSpeakerHasAdvanced(message, combat = getApplicableCombat()) {
    const context = services.getMessageContext(message) ?? {};
    if (context.attackerInitiativeAtCreation === null
        || context.attackerInitiativeAtCreation === undefined
        || context.attackerInitiativeAtCreation === "") return false;
    const initialInitiative = Number(context.attackerInitiativeAtCreation);
    if (!Number.isFinite(initialInitiative)) return false;
    const messageCombat = combatForContext(context, combat);
    if (!messageCombat) return false;
    const combatants = combatantDocuments(messageCombat);
    const attackerTokenId = tokenIdFromReference(context.attackerTokenUuid) ?? message?.speaker?.token ?? null;
    const combatant = messageCombat.combatants?.get?.(context.combatantId)
        ?? combatants.find((candidate) => candidate.id === context.combatantId)
        ?? combatants.find((candidate) => combatantTokenId(candidate) === attackerTokenId)
        ?? combatants.find((candidate) => candidate.actorId === message?.speaker?.actor);
    const currentInitiative = Number(combatant?.initiative);
    return Number.isFinite(currentInitiative) && currentInitiative > initialInitiative;
}

function combatForContext(context, preferredCombat) {
    const combatId = context?.combatId;
    if (!combatId || preferredCombat?.id === combatId) return preferredCombat ?? null;
    return globalThis.game?.combats?.get?.(combatId)
        ?? Array.from(globalThis.game?.combats?.values?.() ?? globalThis.game?.combats ?? [])
            .map(unwrapCollectionEntry)
            .find((candidate) => candidate?.id === combatId)
        ?? null;
}

function combatantDocuments(combat) {
    const collection = combat?.combatants;
    const candidates = collection?.contents
        ?? Array.from(collection?.values?.() ?? collection ?? combat?.turns ?? []);
    return Array.from(candidates ?? [], unwrapCollectionEntry).filter(Boolean);
}

function unwrapCollectionEntry(candidate) {
    return Array.isArray(candidate) && candidate.length === 2 ? candidate[1] : candidate;
}

function tokenIdFromReference(reference) {
    const value = String(reference ?? "");
    return value.match(/\.Token\.([^.]+)/u)?.[1] ?? null;
}

function combatantTokenId(combatant) {
    return combatant?.tokenId
        ?? combatant?.token?.id
        ?? combatant?.token?.document?.id
        ?? null;
}

function messageTimestamp(message) {
    const value = Number(message?.timestamp);
    return Number.isFinite(value) ? value : 0;
}
