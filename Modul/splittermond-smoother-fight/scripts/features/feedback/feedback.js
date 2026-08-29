import { feedbackState } from "./state.js";

import { services } from "../../core/services.js";

import {
    combatMessageKind,
    healthCostFeedbackKind,
    healthCostTotal,
    isCombatantVisibleToUser,
    normalizeAudioFeedbackProfile,
} from "../../combat-rules.js";

import {
    AUDIO_CUSTOM_SOUND,
    AUDIO_FEEDBACK_EVENTS,
    AUDIO_PROFILE_DEFAULTS,
    AUDIO_PROFILE_FLAG,
    AUDIO_SOUND_IDS,
    AUDIO_SOUND_PROFILES,
    MODULE_ID,
    SOCKET,
} from "../../core/constants.js";

import {
    escapeAttr,
    getSetting,
} from "../../shared/values.js";

export function announceMessageFeedback(message) {
    if (!message?.id || feedbackState.heardMessageIds.has(message.id)) return;
    let kind = null;
    if (services.isDefenseMessage(message)) kind = "defense";
    else if (services.isSpellMessage(message)) kind = "spell";
    else if (combatMessageKind(message) === "attack") {
        const contextKind = services.getMessageContext(message)?.actionKind;
        if (contextKind === "ranged" || services.isRangedAttackMessage(message)) kind = "ranged";
    }
    if (!kind) return;

    feedbackState.heardMessageIds.add(message.id);
    const speakerActor = services.resolveSpeakerActor(message);
    const messageContext = services.getMessageContext(message);
    const tokenUuid = services.speakerTokenUuid(message)
        ?? messageContext?.defenderTokenUuid
        ?? messageContext?.attackerTokenUuid
        ?? null;
    const token = services.resolveToken(tokenUuid);
    const mayObserve = Boolean(speakerActor?.testUserPermission?.(game.user, "OBSERVER"));
    if (!game.user?.isGM && token && !services.isTokenPerceivableByUser(token, game.user)) return;
    if (!game.user?.isGM && tokenUuid && !token && !mayObserve) return;
    triggerFeedback(kind, { tokenUuid, actorUuid: speakerActor?.uuid ?? null });
}

export function seedHealthFeedbackState() {
    feedbackState.healthCostsByActor.clear();
    for (const actor of game.actors?.contents ?? game.actors ?? []) rememberActorHealthCost(actor);
    for (const token of services.getSceneTokens()) rememberActorHealthCost(token.actor);
}

function actorHealthFeedbackKey(actor) {
    return actor?.uuid ?? actor?.id ?? null;
}

export function rememberActorHealthCost(actor) {
    const key = actorHealthFeedbackKey(actor);
    if (!key || feedbackState.healthCostsByActor.has(key)) return;
    feedbackState.healthCostsByActor.set(key, healthCostTotal(actor?.system?.health));
}

export function forgetActorHealthCost(actor) {
    const key = actorHealthFeedbackKey(actor);
    if (key) feedbackState.healthCostsByActor.delete(key);
}

export function announceAppliedDamageFeedback(actor) {
    const key = actorHealthFeedbackKey(actor);
    if (!key) return;
    const previous = feedbackState.healthCostsByActor.get(key);
    const current = healthCostTotal(actor?.system?.health);
    feedbackState.healthCostsByActor.set(key, current);
    if (healthCostFeedbackKind(previous, current) !== "damage") return;

    const tokens = services.getSceneTokens();
    const token = tokens.find((candidate) => candidate.actor?.uuid === actor.uuid)
        ?? tokens.find((candidate) => candidate.actorId === actor.id || candidate.actor?.id === actor.id)
        ?? null;
    const mayObserve = Boolean(actor.testUserPermission?.(game.user, "OBSERVER"));
    if (!game.user?.isGM && !token && !mayObserve) return;
    triggerFeedback("damage", { tokenUuid: token?.uuid ?? null, actorUuid: actor.uuid });
}

export function installHealthCostFeedbackInterceptor() {
    const prototype = CONFIG?.Actor?.documentClass?.prototype;
    if (!prototype || typeof prototype.consumeCost !== "function") return;
    const marker = Symbol.for(`${MODULE_ID}.healthCostFeedbackInterceptor`);
    if (prototype[marker]) return;

    const original = prototype.consumeCost;
    prototype.consumeCost = function smootherFightConsumeCost(resource, cost, ...args) {
        const tracksHealth = String(resource ?? "").toLocaleLowerCase() === "health";
        const previous = tracksHealth ? healthCostTotal(this.system?.health) : null;
        const damageApplication = tracksHealth
            ? services.findPendingDamageApplicationForActor(this.uuid)
            : null;
        let result;
        try {
            result = original.call(this, resource, cost, ...args);
        } catch (error) {
            if (tracksHealth) {
                const current = healthCostTotal(this.system?.health);
                const outcome = healthCostOutcome(this, previous, current, "failed", error);
                if (damageApplication) damageApplication.completionPromises?.push(Promise.resolve(outcome));
                else if (outcome.damage > 0) requestDamageInterruption(outcome);
            }
            throw error;
        }
        if (tracksHealth) {
            const completion = Promise.resolve(result).then(() => {
                const current = healthCostTotal(this.system?.health);
                if (healthCostFeedbackKind(previous, current, true) === "damageBlocked") {
                    publishFeedback("damageBlocked", feedbackReferenceForActor(this));
                }
                return healthCostOutcome(this, previous, current, "completed", null);
            }, (error) => healthCostOutcome(
                this,
                previous,
                healthCostTotal(this.system?.health),
                "failed",
                error
            ));
            if (damageApplication) damageApplication.completionPromises?.push(completion);
            else void completion.then((outcome) => {
                if (outcome.damage > 0) requestDamageInterruption(outcome);
            });
        }
        return result;
    };
    Object.defineProperty(prototype, marker, { value: true });
}

function healthCostOutcome(actor, previous, current, status, error) {
    return {
        status,
        actorUuid: actor?.uuid ?? null,
        tokenUuid: feedbackReferenceForActor(actor).tokenUuid,
        previousHealthCost: previous,
        currentHealthCost: current,
        damage: Math.max(0, Number(current) - Number(previous)),
        healthChanged: current !== previous,
        error,
    };
}

function requestDamageInterruption(outcome) {
    const operation = services.requestContinuousActionInterruptionForDamage?.({
        actorUuid: outcome.actorUuid,
        tokenUuid: outcome.tokenUuid,
        damage: outcome.damage,
    });
    if (!operation || typeof operation.catch !== "function") return;
    void operation.catch((error) => {
        console.error(`${MODULE_ID} | Could not request a continuous-action interruption`, error);
    });
}

export function resolveActorUuid(uuid) {
    if (!uuid) return null;
    try {
        const resolved = globalThis.fromUuidSync?.(uuid) ?? null;
        return resolved?.documentName === "Actor" || resolved?.constructor?.name?.includes("Actor") ? resolved : null;
    } catch (error) {
        console.debug(`${MODULE_ID} | Could not resolve actor ${uuid}`, error);
        return null;
    }
}

export function mayUserApplyDamageToActor(user, actor) {
    if (!user || !actor) return false;
    if (user.isGM || actor.testUserPermission?.(user, "OWNER")) return true;
    return services.getSceneTokens().some((token) =>
        (token.actor?.uuid === actor.uuid || token.actorId === actor.id)
        && services.getExplicitTokenOwnerId(token) === user.id
    );
}

function feedbackReferenceForActor(actor) {
    const tokens = services.getSceneTokens();
    const token = tokens.find((candidate) => candidate.actor?.uuid === actor?.uuid)
        ?? tokens.find((candidate) => candidate.actorId === actor?.id || candidate.actor?.id === actor?.id)
        ?? null;
    return { tokenUuid: token?.uuid ?? null, actorUuid: actor?.uuid ?? null };
}

function publishFeedback(kind, reference) {
    triggerFeedback(kind, reference);
    game.socket?.emit(SOCKET, {
        type: "combat-feedback",
        senderId: game.user?.id,
        kind,
        ...reference,
    });
}

export function receivePublishedFeedback(kind, { tokenUuid = null, actorUuid = null } = {}) {
    const token = services.resolveToken(tokenUuid);
    const actor = token?.actor ?? globalThis.fromUuidSync?.(actorUuid) ?? null;
    const mayObserve = Boolean(actor?.testUserPermission?.(game.user, "OBSERVER"));
    if (!game.user?.isGM && token && !services.isTokenPerceivableByUser(token, game.user)) return;
    if (!game.user?.isGM && !token && !mayObserve) return;
    triggerFeedback(kind, { tokenUuid: token?.uuid ?? null, actorUuid: actor?.uuid ?? actorUuid });
}

export function announceTurnFeedback(combat) {
    const combatant = combat?.combatant ?? null;
    const combatantId = combatant?.id ?? null;
    if (!combatantId || combatantId === feedbackState.lastTurnCombatantId) return;
    feedbackState.lastTurnCombatantId = combatantId;
    const actor = combatant.actor;
    const token = combatant.token ?? services.resolveCombatantToken(combatant);
    if (!actor || !isCombatantVisibleToUser(game.user?.isGM, combatant.hidden, token?.hidden)) return;
    if (token && !services.isTokenPerceivableByUser(token, game.user)) return;
    const ownTurn = services.getCurrentTurnController(combat)?.id === game.user?.id;
    if (ownTurn) triggerFeedback("turn", { tokenUuid: token?.uuid ?? null, actorUuid: actor.uuid });
}

export function setLastTurnCombatantId(combatantId) {
    feedbackState.lastTurnCombatantId = combatantId;
}

function triggerFeedback(kind, { tokenUuid = null, actorUuid = null } = {}) {
    feedbackState.feedback = { kind, tokenUuid, actorUuid, id: foundry?.utils?.randomID?.() ?? `${Date.now()}` };
    clearTimeout(feedbackState.feedbackTimer);
    feedbackState.feedbackTimer = setTimeout(() => {
        feedbackState.feedback = null;
        services.scheduleRender(0);
    }, 1400);
    playFeedbackTone(kind);
    services.scheduleRender(0);
}

export function feedbackMarkup(token, actor) {
    const feedback = feedbackState.feedback;
    if (!feedback) return "";
    const matches = (feedback.tokenUuid && feedback.tokenUuid === token?.uuid)
        || (feedback.actorUuid && feedback.actorUuid === actor?.uuid);
    if (!matches) return "";
    const icon = AUDIO_FEEDBACK_EVENTS[feedback.kind]
        ? `<span class="sf-media-icon sf-icon-${escapeAttr(feedback.kind)}" aria-hidden="true"></span>`
        : '<i class="fa-solid fa-burst"></i>';
    return `<span class="sf-action-feedback is-${escapeAttr(feedback.kind)}">${icon}</span>`;
}

function legacyAudioFeedbackProfile() {
    const legacyEnabled = getSetting("audioFeedback", true);
    const events = {};
    for (const [eventId, config] of Object.entries(AUDIO_FEEDBACK_EVENTS)) {
        events[eventId] = {
            enabled: legacyEnabled && Boolean(getSetting(config.enabled, true)),
            sound: getSetting(config.sound, config.defaultSound),
            customSound: "",
        };
    }
    return normalizeAudioFeedbackProfile({ version: 1, events }, AUDIO_PROFILE_DEFAULTS, AUDIO_SOUND_IDS);
}

export function getAudioFeedbackProfile() {
    const stored = game.user?.getFlag?.(MODULE_ID, AUDIO_PROFILE_FLAG);
    const source = stored === null || stored === undefined ? legacyAudioFeedbackProfile() : stored;
    return normalizeAudioFeedbackProfile(source, AUDIO_PROFILE_DEFAULTS, AUDIO_SOUND_IDS);
}

export async function migrateAudioFeedbackSettings() {
    if (!game.user) return;
    try {
        const stored = game.user.getFlag(MODULE_ID, AUDIO_PROFILE_FLAG);
        if (stored === null || stored === undefined) {
            await game.user.setFlag(MODULE_ID, AUDIO_PROFILE_FLAG, legacyAudioFeedbackProfile());
        }
        if (!getSetting("audioFeedbackMigrated", false)) {
            await game.settings.set(MODULE_ID, "audioFeedbackMigrated", true);
        }
    } catch (error) {
        console.warn(`${MODULE_ID} | Could not migrate audio feedback settings`, error);
    }
}

function isFeedbackSoundEnabled(kind) {
    return Boolean(AUDIO_FEEDBACK_EVENTS[kind] && getAudioFeedbackProfile().events[kind]?.enabled);
}

export function unlockFeedbackAudio() {
    void prepareFeedbackAudio(false);
}

async function prepareFeedbackAudio(force = false) {
    if (!force && !Object.keys(AUDIO_FEEDBACK_EVENTS).some(isFeedbackSoundEnabled)) return null;
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContext) return null;
    feedbackState.audioContext ??= new AudioContext();
    try {
        await feedbackState.audioContext.resume?.();
    } catch (error) {
        console.debug(`${MODULE_ID} | Could not resume audio context`, error);
    }
    return feedbackState.audioContext.state === "running" ? feedbackState.audioContext : null;
}

function playFeedbackTone(kind) {
    const eventConfig = AUDIO_FEEDBACK_EVENTS[kind];
    if (!eventConfig || !isFeedbackSoundEnabled(kind)) return;
    const eventSettings = getAudioFeedbackProfile().events[kind];
    void playFeedbackSelection(
        eventSettings.sound,
        eventSettings.customSound,
        eventConfig.defaultSound
    );
}

export async function playFeedbackSelection(soundId, customSound, fallbackSoundId = "shield", force = false) {
    if (soundId === AUDIO_CUSTOM_SOUND) {
        const src = String(customSound ?? "").trim();
        if (!src || !game.audio?.play) return false;
        try {
            await game.audio.play(src, { context: game.audio.interface });
            return true;
        } catch (error) {
            console.debug(`${MODULE_ID} | Could not play custom audio ${src}`, error);
            return false;
        }
    }
    return playFeedbackProfile(soundId, fallbackSoundId, force);
}

async function playFeedbackProfile(soundId, fallbackSoundId = "shield", force = false) {
    const profile = AUDIO_SOUND_PROFILES[soundId]
        ?? AUDIO_SOUND_PROFILES[fallbackSoundId]
        ?? AUDIO_SOUND_PROFILES.shield;
    if (profile?.src && game.audio?.play) {
        try {
            await game.audio.play(profile.src, { context: game.audio.interface });
            return true;
        } catch (error) {
            console.debug(`${MODULE_ID} | Could not play audio asset ${profile.src}`, error);
        }
    }
    const audio = await prepareFeedbackAudio(force);
    if (!audio) return false;
    const notes = profile?.notes ?? [];
    if (!notes.length) return false;
    const now = audio.currentTime;
    try {
        for (const [frequency, delay] of notes) {
            const oscillator = audio.createOscillator();
            const gain = audio.createGain();
            oscillator.type = profile.wave;
            oscillator.frequency.setValueAtTime(frequency, now + delay);
            gain.gain.setValueAtTime(0.0001, now + delay);
            gain.gain.exponentialRampToValueAtTime(0.055, now + delay + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.18);
            oscillator.connect(gain).connect(audio.destination);
            oscillator.start(now + delay);
            oscillator.stop(now + delay + 0.2);
        }
        return true;
    } catch (error) {
        console.debug(`${MODULE_ID} | Could not play audio profile ${soundId}`, error);
        return false;
    }
}
