import { activeDefenseState } from "./state.js";

import { services } from "../../core/services.js";

import {
    activeDefenseChangesDifficulty,
    attackOutcomeChanged,
    bestActiveDefenseValue,
    calculateActiveDefenseValue,
    findDefensiveFeatureValue,
    isDefenderMasteryName,
    isOffensiveCombatMessage,
    parseActiveDefenseDescription,
    recalculateAttackReport,
    tokenDocumentCenter,
    totalDegreesOfSuccess,
} from "../../combat-rules.js";

import {
    MODULE_ID,
    SOCKET,
} from "../../core/constants.js";

import {
    cloneData,
    escapeHtml,
    getSetting,
    localizeSystem,
    t,
} from "../../shared/values.js";

function primaryTargetTokenUuid(context) {
    return context?.primaryTargetTokenUuid ?? context?.targetTokenUuid ?? null;
}

function primaryTargetActorUuid(context) {
    return context?.primaryTargetActorUuid ?? context?.targetActorUuid ?? null;
}

function rememberPendingDefense(message, targetOverride = null, options = {}) {
    const context = services.getMessageContext(message);
    const target = targetOverride
        ?? services.resolveToken(primaryTargetTokenUuid(context))
        ?? getControlledTokenDocument()
        ?? services.getHudContext()?.target;
    const defender = options.defender ?? target;
    activeDefenseState.pendingDefense = {
        attackMessageId: message.id,
        primaryTargetTokenUuid: target?.uuid ?? null,
        primaryTargetActorUuid: target?.actor?.uuid ?? null,
        targetTokenUuid: target?.uuid ?? null,
        targetActorUuid: target?.actor?.uuid ?? null,
        defenderTokenUuid: defender?.uuid ?? null,
        defenderActorUuid: defender?.actor?.uuid ?? null,
        defenseId: options.defense?.id ?? null,
        defenseSkillId: options.defense?.skill?.id ?? null,
        assisted: Boolean(options.assisted),
        expiresAt: Date.now() + 10 * 60 * 1000,
    };
    return target;
}

export function getControlledTokenDocument() {
    const controlled = Array.from(canvas?.tokens?.controlled ?? []);
    return controlled.at(-1)?.document ?? null;
}

export function normalizePendingDefense(value) {
    if (!value || typeof value !== "object" || typeof value.attackMessageId !== "string") return null;
    const targetTokenUuid = primaryTargetTokenUuid(value);
    const targetActorUuid = primaryTargetActorUuid(value);
    return {
        attackMessageId: value.attackMessageId,
        primaryTargetTokenUuid: typeof targetTokenUuid === "string" ? targetTokenUuid : null,
        primaryTargetActorUuid: typeof targetActorUuid === "string" ? targetActorUuid : null,
        targetTokenUuid: typeof targetTokenUuid === "string" ? targetTokenUuid : null,
        targetActorUuid: typeof targetActorUuid === "string" ? targetActorUuid : null,
        defenderTokenUuid: typeof value.defenderTokenUuid === "string" ? value.defenderTokenUuid : null,
        defenderActorUuid: typeof value.defenderActorUuid === "string" ? value.defenderActorUuid : null,
        defenseId: typeof value.defenseId === "string" ? value.defenseId : null,
        defenseSkillId: typeof value.defenseSkillId === "string" ? value.defenseSkillId : null,
        assisted: Boolean(value.assisted),
        expiresAt: Number(value.expiresAt) || Date.now() + 60 * 1000,
    };
}

export function getActiveGm() {
    return Array.from(game.users ?? []).find((user) => user.isGM && user.active) ?? null;
}

export async function processDefenseMessage(message, pendingOverride = null, { allowForeign = false } = {}) {
    if (activeDefenseState.processingDefenseMessages.has(message.id)) return null;
    activeDefenseState.processingDefenseMessages.add(message.id);
    try {
        return await processDefenseMessageOnce(message, pendingOverride, { allowForeign });
    } finally {
        activeDefenseState.processingDefenseMessages.delete(message.id);
    }
}

async function processDefenseMessageOnce(message, pendingOverride = null, { allowForeign = false } = {}) {
    if ((!allowForeign && !services.isOwnMessage(message)) || !getSetting("defenseRecalculation", true)) return;
    const check = services.getDefenseCheck(message);
    if (!check) return;

    let pending = normalizePendingDefense(pendingOverride)
        ?? normalizePendingDefense(services.getMessageContext(message))
        ?? activeDefenseState.pendingDefense;
    if (!pending || pending.expiresAt < Date.now()) pending = findPendingOffenseForDefense(message);
    if (!pending?.attackMessageId) return;

    const target = services.resolveToken(pending.targetTokenUuid);
    const defender = services.resolveToken(pending.defenderTokenUuid);
    const expectedActor = pending.assisted ? defender?.actor : target?.actor;
    if (expectedActor && message.speaker?.actor && expectedActor.id !== message.speaker.actor) return;
    if (pending.assisted && !isValidDefenderAttempt(pending, message)) return;
    requestLatestEventForDefense(pending);

    const existingDefenseContext = services.getMessageContext(message) ?? {};
    const contentTemplate = document.createElement("template");
    contentTemplate.innerHTML = message.content ?? "";
    const defensePresentation = parseActiveDefenseDescription(contentTemplate.content.textContent);
    const numbingDamage = defensePresentation.numbingDamage;
    await services.safeSetFlag(message, "context", {
        ...existingDefenseContext,
        attackMessageId: pending.attackMessageId,
        primaryTargetTokenUuid: pending.targetTokenUuid,
        primaryTargetActorUuid: pending.targetActorUuid,
        targetTokenUuid: pending.targetTokenUuid,
        targetActorUuid: pending.targetActorUuid,
        defenderTokenUuid: pending.defenderTokenUuid,
        defenderActorUuid: pending.defenderActorUuid,
        defenseId: pending.defenseId,
        defenseSkillId: pending.defenseSkillId,
        assisted: pending.assisted,
        numbingDamage: existingDefenseContext.numbingDamage ?? (numbingDamage || null),
        numbingDamageApplied: Boolean(existingDefenseContext.numbingDamageApplied),
    });

    if (!game.user.isGM) {
        const gm = getActiveGm();
        activeDefenseState.pendingDefense = null;
        if (!gm) {
            ui.notifications.warn(localizeSystem("splittermond.chatCard.noGMConnected", "Kein GM verbunden."));
            return;
        }
        game.socket.emit(SOCKET, {
            type: "recalculate-defense",
            senderId: game.user.id,
            recipientId: gm.id,
            defenseMessageId: message.id,
            pending,
        });
        return;
    }

    if (!activeDefenseChangesDifficulty(check, defensePresentation.defenseValue)) {
        await recordDefenseAttempt(pending.attackMessageId, message, pending);
        activeDefenseState.pendingDefense = null;
        services.scheduleRender(0);
        return;
    }

    const newOffense = await recreateOffenseAfterDefense(
        pending.attackMessageId,
        message,
        check,
        defensePresentation.defenseValue
    );
    activeDefenseState.pendingDefense = null;
    if (newOffense) services.scheduleRender(0);
}

function requestLatestEventForDefense(pending) {
    const offense = game.messages.get(pending?.attackMessageId);
    const combatant = game.combat?.combatant;
    if (!offense || !combatant || !services.messageBelongsToCombatant(offense, combatant)) return;
    services.setCombatEventExpansionRequest("latest");
    services.scheduleRender(0);
}

export function isDefenseMessageProcessing(messageId) {
    return activeDefenseState.processingDefenseMessages.has(messageId);
}

async function recordDefenseAttempt(offenseMessageId, defenseMessage, pending = null) {
    const offense = game.messages.get(offenseMessageId);
    if (!offense) return;
    const context = services.getMessageContext(offense) ?? {};
    const actorUuid = pending?.defenderActorUuid ?? services.resolveSpeakerActor(defenseMessage)?.uuid ?? null;
    const attemptedDefenseActorUuids = Array.from(new Set([
        ...(context.attemptedDefenseActorUuids ?? []),
        actorUuid,
    ].filter(Boolean)));
    const defenseMessageIds = Array.from(new Set([
        ...(context.defenseMessageIds ?? []),
        context.defenseMessageId,
        defenseMessage.id,
    ].filter(Boolean)));
    await services.safeSetFlag(offense, "context", {
        ...context,
        attemptedDefenseActorUuids,
        defenseMessageIds,
    });
}

function findPendingOffenseForDefense(message) {
    const messages = Array.from(game.messages?.contents ?? []).filter(isOffensiveCombatMessage).reverse();
    const defenseActorId = message.speaker?.actor;
    const offense = messages.find((candidate) => {
        const context = services.getMessageContext(candidate);
        const actorUuid = primaryTargetActorUuid(context);
        if (!actorUuid) return false;
        const actor = globalThis.fromUuidSync?.(actorUuid);
        return actor?.id === defenseActorId && !context.supersededBy;
    });
    if (!offense) return null;
    const context = services.getMessageContext(offense);
    return {
        attackMessageId: offense.id,
        primaryTargetTokenUuid: primaryTargetTokenUuid(context),
        primaryTargetActorUuid: primaryTargetActorUuid(context),
        targetTokenUuid: primaryTargetTokenUuid(context),
        targetActorUuid: primaryTargetActorUuid(context),
        expiresAt: Date.now() + 1000,
    };
}

async function recreateOffenseAfterDefense(offenseMessageId, defenseMessage, defenseCheck, displayedDefenseValue = null) {
    const original = game.messages.get(offenseMessageId);
    if (!original || !isOffensiveCombatMessage(original)) return null;

    const featureValue = findDefensiveFeatureValue(defenseCheck.itemData);
    const originalContext = services.getMessageContext(original) ?? {};
    if (originalContext.supersededBy) return game.messages.get(originalContext.supersededBy) ?? null;
    const target = services.resolveToken(primaryTargetTokenUuid(originalContext));
    const calculatedBase = await target?.actor?.derivedValues?.[defenseCheck.defenseType]?.value?.calculate?.();
    const candidateDefense = displayedDefenseValue !== null && Number.isFinite(Number(displayedDefenseValue))
        ? Number(displayedDefenseValue)
        : calculateActiveDefenseValue({
            ...defenseCheck,
            baseDefense: Number.isFinite(Number(calculatedBase)) ? Number(calculatedBase) : defenseCheck.baseDefense,
        }, featureValue);
    const newDefense = bestActiveDefenseValue(originalContext.defenseValue, candidateDefense);
    const pending = normalizePendingDefense(services.getMessageContext(defenseMessage)) ?? activeDefenseState.pendingDefense;
    const actorUuid = pending?.defenderActorUuid ?? services.resolveSpeakerActor(defenseMessage)?.uuid ?? null;
    const attemptedDefenseActorUuids = Array.from(new Set([
        ...(originalContext.attemptedDefenseActorUuids ?? []),
        actorUuid,
    ].filter(Boolean)));
    const defenseMessageIds = Array.from(new Set([
        ...(originalContext.defenseMessageIds ?? []),
        originalContext.defenseMessageId,
        defenseMessage.id,
    ].filter(Boolean)));
    await services.safeSetFlag(defenseMessage, "context", {
        ...(services.getMessageContext(defenseMessage) ?? pending ?? {}),
        resultingDefenseValue: candidateDefense,
        defensiveFeatureValue: featureValue,
    });

    if (Number.isFinite(Number(originalContext.defenseValue)) && newDefense <= Number(originalContext.defenseValue)) {
        await services.safeSetFlag(original, "context", {
            ...originalContext,
            attemptedDefenseActorUuids,
            defenseMessageIds,
        });
        return original;
    }
    const systemSource = cloneData(original.system?.toObject?.() ?? original.toObject().system);
    const previousReport = systemSource.checkReport;
    const config = globalThis.CONFIG?.splittermond ?? {};
    const recalculatedReport = recalculateAttackReport(previousReport, newDefense, {
        triumphBonus: config.check?.degreeOfSuccess?.triumphBonus ?? 3,
        fumblePenalty: config.check?.degreeOfSuccess?.fumblePenalty ?? -3,
        grazingHitBasePenalty: config.grazingHitBasePenalty ?? 2,
    });
    if (!attackOutcomeChanged(previousReport, recalculatedReport)) {
        await services.safeSetFlag(original, "context", {
            ...originalContext,
            defenseMessageIds,
            defenseValue: newDefense,
            defenseType: defenseCheck.defenseType,
            attemptedDefenseActorUuids,
        });
        return original;
    }
    systemSource.checkReport = recalculatedReport;
    systemSource.checkReport.degreeOfSuccessMessage = services.checkResultMessage(systemSource.checkReport);
    systemSource.openDegreesOfSuccess = Math.max(
        0,
        totalDegreesOfSuccess(systemSource.checkReport) - (systemSource.checkReport.maneuvers?.length ?? 0)
    );
    resetOffenseHandlers(systemSource);

    const source = cloneData(original.toObject());
    delete source._id;
    delete source._stats;
    delete source.timestamp;
    source.user = game.user.id;
    source.sound = null;
    source.system = systemSource;
    source.content = original.content;
    source.flags ??= {};
    source.flags[MODULE_ID] = {
        context: {
            ...originalContext,
            recalculatedFrom: original.id,
            defenseMessageId: defenseMessage.id,
            defenseMessageIds,
            defenseValue: newDefense,
            defenseType: defenseCheck.defenseType,
            attemptedDefenseActorUuids,
            createdAt: Date.now(),
        },
    };
    if (source.flags.splittermond?.chatCard) source.flags.splittermond.chatCard.messageId = null;

    const created = await ChatMessage.create(source);
    if (!created) return null;
    const rendered = await renderTemplate(created.system.template, created.system.getData());
    const defenseLabel = localizeSystem(`splittermond.derivedAttribute.${defenseCheck.defenseType}.short`, String(defenseCheck.defenseType).toUpperCase());
    const hiddenClass = systemSource.checkReport.hideDifficulty ? " gm-only" : "";
    const banner = `<div class="sf-chat-recalculated${hiddenClass}"><i class="fa-solid fa-shield-halved"></i><span>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NewDefense", { defense: defenseLabel }))}</span><strong>${escapeHtml(newDefense)}</strong></div>`;
    const decorated = decorateRecalculatedCard(rendered, banner);
    await created.update({ content: decorated });
    await services.safeSetFlag(original, "context", {
        ...services.getMessageContext(original),
        attemptedDefenseActorUuids,
        defenseMessageIds,
        supersededBy: created.id,
    });
    return created;
}

function resetOffenseHandlers(systemSource) {
    if (systemSource.damageHandler) {
        systemSource.damageHandler.damageUsed = false;
        systemSource.damageHandler.penaltyUsed = false;
        systemSource.damageHandler.damageAddition = 0;
        systemSource.damageHandler.consumedGrazingHitCost = false;
        systemSource.damageHandler.convertedToNumbingDamage = false;
    }
    resetCheckedOptions(systemSource.damageHandler?.options);
    resetCheckedOptions(systemSource.noActionOptionsHandler);
}

function resetCheckedOptions(value, visited = new Set()) {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Object.hasOwn(value, "checked") && typeof value.checked === "boolean") value.checked = false;
    for (const nested of Object.values(value)) resetCheckedOptions(nested, visited);
}

function decorateRecalculatedCard(content, banner) {
    const template = document.createElement("template");
    template.innerHTML = content;
    template.content.querySelectorAll('[data-localaction="activeDefense" i], [data-local-action="activeDefense" i]').forEach((button) => button.remove());
    const wrapper = document.createElement("div");
    wrapper.append(template.content.cloneNode(true));
    return `${banner}${wrapper.innerHTML}`;
}

export async function beginActiveDefense(message) {
    message = resolveLatestOffenseMessage(message);
    const target = rememberPendingDefense(message);
    if (!target?.actor || !(game.user.isGM || target.actor.isOwner)) {
        activeDefenseState.pendingDefense = null;
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenseNotAllowed"));
        return;
    }
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.WaitingForDefense", { target: target.name }));
    const type = message.system?.checkReport?.defenseType ?? "defense";
    await target.actor.activeDefenseDialog(type || undefined);
}

export async function beginAdditionalTargetDefense(message) {
    if (!message) return;
    message = resolveLatestOffenseMessage(message);
    const context = services.getMessageContext(message);
    const target = services.resolveToken(primaryTargetTokenUuid(context));
    const attempted = new Set(context?.attemptedDefenseActorUuids ?? []);
    if (!target?.actor || attempted.has(target.actor.uuid) || !(game.user.isGM || target.actor.isOwner)) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenseNotAllowed"));
        return;
    }
    rememberPendingDefense(message, target, { defender: target });
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.WaitingForDefense", { target: target.name }));
    const type = message.system?.checkReport?.defenseType ?? context?.defenseType ?? "defense";
    await target.actor.activeDefenseDialog(type || undefined);
}

export async function beginDefenderDefense(message) {
    if (!message) return;
    message = resolveLatestOffenseMessage(message);
    const choices = getEligibleDefenderChoices(message, game.user);
    if (!choices.length) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenderUnavailable"));
        return;
    }
    const target = services.resolveToken(primaryTargetTokenUuid(services.getMessageContext(message)));
    if (!target?.actor) return;

    const options = choices.map((choice, index) =>
        `<option value="${index}">${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenderChoice", {
            defender: choice.token.name ?? choice.actor.name,
            defense: choice.defense.name,
        }))}</option>`
    ).join("");
    const content = `<form class="sf-defender-dialog">
        <p>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenderRule", { target: target.name }))}</p>
        <div class="form-group"><label>${escapeHtml(t("SMOOTHER_FIGHT.HUD.DefenderDefense"))}</label><select name="choice">${options}</select></div>
    </form>`;
    const selectedIndex = await foundry.applications.api.DialogV2.wait({
        id: `${MODULE_ID}-defender-dialog`,
        window: { title: t("SMOOTHER_FIGHT.HUD.DefenderDialogTitle", { target: target.name }) },
        position: { width: 470 },
        content,
        buttons: [
            {
                action: "roll",
                label: t("SMOOTHER_FIGHT.HUD.DefenderRoll"),
                icon: "fa-solid fa-shield-halved",
                callback: (_event, button) => Number(button.form.elements.choice.value),
                default: true,
            },
            {
                action: "cancel",
                label: t("SMOOTHER_FIGHT.Settings.Cancel"),
                icon: "fa-solid fa-xmark",
                callback: () => null,
            },
        ],
        close: () => null,
        modal: true,
    });
    if (!Number.isInteger(selectedIndex)) return;

    const currentChoices = getEligibleDefenderChoices(message, game.user);
    const selected = choices[selectedIndex];
    const current = currentChoices.find((choice) =>
        choice.token.uuid === selected?.token.uuid && choice.defense.id === selected?.defense.id
    );
    if (!current) {
        ui.notifications.warn(t("SMOOTHER_FIGHT.HUD.DefenderUnavailable"));
        return;
    }

    rememberPendingDefense(message, target, {
        defender: current.token,
        defense: current.defense,
        assisted: true,
    });
    ui.notifications.info(t("SMOOTHER_FIGHT.HUD.WaitingForDefender", {
        defender: current.token.name ?? current.actor.name,
        target: target.name,
    }));
    const baseDefense = await target.actor.derivedValues.defense.value.calculate();
    const difficulty = Number(globalThis.CONFIG?.splittermond?.check?.activeDefenseDifficulty) || 15;
    const defenderModifier = Array.from(current.defense.skill.selectableModifier ?? [])
        .find((modifier) => isDefenderMasteryName(modifier?.attributes?.name));
    const rolled = await current.defense.skill.roll({
        type: "defense",
        preSelectedModifier: defenderModifier ? [defenderModifier.attributes.name] : [],
        difficulty,
        modifier: defenderModifier ? 0 : -3,
        title: t("SMOOTHER_FIGHT.HUD.DefenderRollTitle", {
            defender: current.token.name ?? current.actor.name,
            target: target.name,
        }),
        checkMessageData: {
            defenseType: "defense",
            baseDefense,
            itemData: current.defense,
        },
    });
    if (!rolled) activeDefenseState.pendingDefense = null;
}

export function getEligibleDefenderChoices(message, user) {
    if (!message || !user || !isOffensiveCombatMessage(message)) return [];
    const context = services.getMessageContext(message);
    if (context?.supersededBy || !message.system?.checkReport?.succeeded) return [];
    if (!services.messageOffersActiveDefense(message) && !context?.recalculatedFrom) return [];
    const defenseType = String(message.system?.checkReport?.defenseType ?? context?.defenseType ?? "defense").toLocaleLowerCase();
    if (defenseType !== "defense" && defenseType !== "vtd") return [];
    const target = services.resolveToken(primaryTargetTokenUuid(context));
    if (!target?.actor) return [];
    const attempted = new Set(context?.attemptedDefenseActorUuids ?? []);
    const choices = [];
    for (const combatant of Array.from(game.combat?.combatants ?? [])) {
        const token = combatant.token?.document ?? combatant.token ?? services.resolveCombatantToken(combatant);
        const actor = token?.actor ?? combatant.actor;
        if (!token?.uuid || !actor || actor.id === target.actor.id || attempted.has(actor.uuid)) continue;
        if (!(user.isGM || actor.testUserPermission?.(user, "OWNER"))) continue;
        if (!hasDefenderMastery(actor) || measureTokenDistance(token, target) > 2) continue;
        for (const defense of getCombatDefenseOptions(actor, { requireDefenderMastery: true })) choices.push({ token, actor, defense });
    }
    return choices;
}

function resolveLatestOffenseMessage(message) {
    let current = message;
    const visited = new Set();
    while (current && !visited.has(current.id)) {
        visited.add(current.id);
        const nextId = services.getMessageContext(current)?.supersededBy;
        const next = nextId ? game.messages.get(nextId) : null;
        if (!next || !isOffensiveCombatMessage(next)) break;
        current = next;
    }
    return current;
}

function getCombatDefenseOptions(actor, { requireDefenderMastery = false } = {}) {
    const masteries = getDefenderMasteries(actor);
    const masterySkills = new Set(masteries.map((mastery) => mastery.system?.skill).filter(Boolean));
    return Array.from(actor?.activeDefense?.defense ?? []).filter((defense) => {
        if (!defense?.skill || defense.id === "acrobatics" || defense.skill.id === "acrobatics") return false;
        return !requireDefenderMastery || !masterySkills.size || masterySkills.has(defense.skill.id);
    });
}

function hasDefenderMastery(actor) {
    return getDefenderMasteries(actor).length > 0;
}

function getDefenderMasteries(actor) {
    return Array.from(actor?.items ?? []).filter((item) =>
        item.type === "mastery" && isDefenderMasteryName(item.name)
    );
}

function measureTokenDistance(left, right) {
    const leftPoint = tokenCenter(left);
    const rightPoint = tokenCenter(right);
    if (!leftPoint || !rightPoint) return Number.POSITIVE_INFINITY;
    try {
        const measured = canvas?.grid?.measurePath?.([leftPoint, rightPoint]);
        if (Number.isFinite(Number(measured?.distance))) return Number(measured.distance);
    } catch (error) {
        console.debug(`${MODULE_ID} | Could not measure Defender distance through the grid`, error);
    }
    const gridSize = Number(canvas?.grid?.size) || 100;
    const gridDistance = Number(canvas?.scene?.grid?.distance) || 1;
    return Math.hypot(rightPoint.x - leftPoint.x, rightPoint.y - leftPoint.y) / gridSize * gridDistance;
}

function tokenCenter(token) {
    const documentCenter = tokenDocumentCenter(token, canvas?.grid?.size);
    if (documentCenter) return documentCenter;
    const object = token?.object ?? canvas?.tokens?.get?.(token?.id);
    if (object?.center) return { x: object.center.x, y: object.center.y };
    return null;
}

export function canUserSubmitDefense(user, pending, message) {
    const target = services.resolveToken(pending?.targetTokenUuid);
    if (!target?.actor) return false;
    if (!pending.assisted) return Boolean(target.actor.testUserPermission?.(user, "OWNER"));
    const defender = services.resolveToken(pending.defenderTokenUuid);
    return Boolean(defender?.actor?.testUserPermission?.(user, "OWNER") && isValidDefenderAttempt(pending, message));
}

function isValidDefenderAttempt(pending, message) {
    const target = services.resolveToken(pending?.targetTokenUuid);
    const defender = services.resolveToken(pending?.defenderTokenUuid);
    const check = services.getDefenseCheck(message);
    const offense = game.messages.get(pending?.attackMessageId);
    const offenseContext = services.getMessageContext(offense);
    const attempted = new Set(offenseContext?.attemptedDefenseActorUuids ?? []);
    if (!target?.actor || !defender?.actor || !check || target.actor.id === defender.actor.id) return false;
    if (offenseContext?.supersededBy) return false;
    if (pending.defenderActorUuid && pending.defenderActorUuid !== defender.actor.uuid) return false;
    if (message.speaker?.actor && message.speaker.actor !== defender.actor.id) return false;
    if (attempted.has(defender.actor.uuid) || !hasDefenderMastery(defender.actor)) return false;
    if (String(check.defenseType).toLocaleLowerCase() !== "defense") return false;
    if (check.itemData?.id === "acrobatics" || check.itemData?.skill?.id === "acrobatics") return false;
    const validOption = getCombatDefenseOptions(defender.actor, { requireDefenderMastery: true })
        .some((defense) => defenseMatchesPendingCheck(defense, pending, check.itemData));
    return validOption && measureTokenDistance(defender, target) <= 2;
}

function defenseMatchesPendingCheck(defense, pending, itemData) {
    if (!defense) return false;
    if (pending.defenseId && defense.id !== pending.defenseId) return false;
    if (pending.defenseSkillId && defense.skill?.id !== pending.defenseSkillId) return false;

    const submittedIds = new Set([
        itemData?.id,
        itemData?._id,
        itemData?.item?.id,
        itemData?.item?._id,
    ].filter(Boolean));
    if (submittedIds.has(defense.id)) return true;

    const submittedSkillId = itemData?.skill?.id ?? itemData?.skill?._id;
    const sameSkill = Boolean(submittedSkillId && submittedSkillId === defense.skill?.id);
    const submittedName = String(itemData?.name ?? itemData?.item?.name ?? "").trim();
    return sameSkill && Boolean(submittedName && submittedName === String(defense.name ?? "").trim());
}
