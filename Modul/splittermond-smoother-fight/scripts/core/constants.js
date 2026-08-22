export const MODULE_ID = "splittermond-smoother-fight";

export const SOCKET = `module.${MODULE_ID}`;

export const SYSTEM_SOCKET = "system.splittermond";

export const MAX_FAVORITE_SKILLS = 4;

export const COMBAT_PAUSE = Object.freeze({ wait: 10000, keepReady: 20000 });

export const AUDIO_PROFILE_FLAG = "audioFeedbackProfile";

export const AUDIO_CUSTOM_SOUND = "custom";

export const AUDIO_FEEDBACK_EVENTS = Object.freeze({
    defense: { enabled: "audioDefenseEnabled", sound: "audioDefenseSound", name: "AudioDefense", defaultSound: "shield" },
    damage: { enabled: "audioDamageEnabled", sound: "audioDamageSound", name: "AudioDamage", defaultSound: "impact" },
    damageBlocked: { enabled: "audioDamageBlockedEnabled", sound: "audioDamageBlockedSound", name: "AudioDamageBlocked", defaultSound: "blocked" },
    spell: { enabled: "audioSpellEnabled", sound: "audioSpellSound", name: "AudioSpell", defaultSound: "arcane" },
    ranged: { enabled: "audioRangedEnabled", sound: "audioRangedSound", name: "AudioRanged", defaultSound: "shot" },
    turn: { enabled: "audioTurnEnabled", sound: "audioTurnSound", name: "AudioTurn", defaultSound: "turn" },
});

export const AUDIO_SOUND_PROFILES = Object.freeze({
    shield: { label: "SMOOTHER_FIGHT.Settings.AudioSoundShield", wave: "sine", notes: [[330, 0], [494, 0.08], [659, 0.16]] },
    impact: { label: "SMOOTHER_FIGHT.Settings.AudioSoundImpact", wave: "triangle", notes: [[180, 0], [125, 0.1]] },
    blocked: { label: "SMOOTHER_FIGHT.Settings.AudioSoundBlocked", wave: "square", notes: [[740, 0], [520, 0.055], [370, 0.11]] },
    arcane: { label: "SMOOTHER_FIGHT.Settings.AudioSoundArcane", wave: "sine", notes: [[523, 0], [659, 0.07], [784, 0.14]] },
    shot: { label: "SMOOTHER_FIGHT.Settings.AudioSoundShot", wave: "sine", notes: [[880, 0], [440, 0.06]] },
    turn: { label: "SMOOTHER_FIGHT.Settings.AudioSoundTurn", wave: "sine", notes: [[440, 0], [660, 0.11], [880, 0.22]] },
});

export const AUDIO_PROFILE_DEFAULTS = Object.freeze(Object.fromEntries(
    Object.entries(AUDIO_FEEDBACK_EVENTS).map(([id, config]) => [id, { enabled: true, sound: config.defaultSound }])
));

export const AUDIO_SOUND_IDS = Object.freeze([...Object.keys(AUDIO_SOUND_PROFILES), AUDIO_CUSTOM_SOUND]);
