import {
    getAudioFeedbackProfile,
    playFeedbackSelection,
} from "./feedback.js";

import {
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
} from "../../core/constants.js";

import {
    t,
} from "../../shared/values.js";

export function registerAudioSettingsMenu() {
    const Base = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2);

    class AudioFeedbackApplication extends Base {
        static DEFAULT_OPTIONS = {
            id: "smoother-fight-audio-feedback",
            classes: ["smoother-fight", "sf-audio-settings"],
            tag: "div",
            position: { width: 760, height: 590 },
            window: {
                title: "SMOOTHER_FIGHT.Settings.AudioTitle",
                icon: "fa-solid fa-volume-high",
                minimizable: true,
                resizable: true,
            },
        };

        static PARTS = {
            form: {
                template: `modules/${MODULE_ID}/templates/audio-feedback-settings.hbs`,
            },
        };

        async _prepareContext(options) {
            const context = await super._prepareContext(options);
            const profile = getAudioFeedbackProfile();
            const sounds = Object.entries(AUDIO_SOUND_PROFILES).map(([id, soundProfile]) => ({
                id,
                label: t(soundProfile.label),
            })).concat({ id: AUDIO_CUSTOM_SOUND, label: t("SMOOTHER_FIGHT.Settings.AudioSoundCustom") });
            const events = Object.entries(AUDIO_FEEDBACK_EVENTS).map(([id, config]) => {
                const eventSettings = profile.events[id];
                return {
                    id,
                    label: t(`SMOOTHER_FIGHT.Settings.${config.name}EventName`),
                    enabled: eventSettings.enabled,
                    defaultSound: config.defaultSound,
                    customSound: eventSettings.customSound,
                    customSelected: eventSettings.sound === AUDIO_CUSTOM_SOUND,
                    sounds: sounds.map((sound) => ({
                        ...sound,
                        selected: sound.id === eventSettings.sound,
                    })),
                };
            });
            return { ...context, events, userName: game.user?.name ?? "" };
        }

        async _onRender(context, options) {
            await super._onRender(context, options);
            const rows = Array.from(this.element.querySelectorAll("[data-audio-event]"));
            const refreshRow = (row) => {
                const enabled = row.querySelector('[data-role="audio-enabled"]')?.checked ?? false;
                const customSelected = row.querySelector('[data-role="audio-sound"]')?.value === AUDIO_CUSTOM_SOUND;
                row.classList.toggle("is-disabled", !enabled);
                row.querySelector('[data-role="audio-custom-source"]')?.toggleAttribute("hidden", !customSelected);
            };
            const markDirty = () => this.element.querySelector('[data-role="audio-dirty"]')?.removeAttribute("hidden");
            for (const row of rows) {
                refreshRow(row);
                row.querySelector('[data-role="audio-enabled"]')?.addEventListener("change", () => {
                    refreshRow(row);
                    markDirty();
                });
                row.querySelector('[data-role="audio-sound"]')?.addEventListener("change", () => {
                    refreshRow(row);
                    markDirty();
                });
                row.querySelector('[data-role="audio-custom"]')?.addEventListener("input", markDirty);
                row.querySelector('[data-action="preview-audio"]')?.addEventListener("click", async () => {
                    const select = row.querySelector('[data-role="audio-sound"]');
                    const customSound = row.querySelector('[data-role="audio-custom"]')?.value ?? "";
                    const played = await playFeedbackSelection(select?.value, customSound, row.dataset.defaultSound, true);
                    if (!played) ui.notifications.warn(t("SMOOTHER_FIGHT.Settings.AudioPreviewUnavailable"));
                });
            }
            this.element.querySelector('[data-action="save-audio"]')?.addEventListener("click", async () => {
                const profile = { version: 1, events: {} };
                for (const row of rows) {
                    const eventId = row.dataset.audioEvent;
                    if (!eventId || !AUDIO_FEEDBACK_EVENTS[eventId]) continue;
                    const sound = row.querySelector('[data-role="audio-sound"]')?.value ?? row.dataset.defaultSound;
                    const customPicker = row.querySelector('[data-role="audio-custom"]');
                    const customSound = String(customPicker?.value ?? "").trim();
                    if (sound === AUDIO_CUSTOM_SOUND && !customSound) {
                        ui.notifications.warn(t("SMOOTHER_FIGHT.Settings.AudioCustomRequired"));
                        customPicker?.focus?.();
                        return;
                    }
                    profile.events[eventId] = {
                        enabled: Boolean(row.querySelector('[data-role="audio-enabled"]')?.checked),
                        sound,
                        customSound,
                    };
                }
                await game.user.setFlag(MODULE_ID, AUDIO_PROFILE_FLAG, normalizeAudioFeedbackProfile(
                    profile,
                    AUDIO_PROFILE_DEFAULTS,
                    AUDIO_SOUND_IDS
                ));
                ui.notifications.info(t("SMOOTHER_FIGHT.Settings.AudioSaved"));
                this.close();
            });
        }
    }

    game.settings.registerMenu(MODULE_ID, "audioFeedbackMenu", {
        name: "SMOOTHER_FIGHT.Settings.AudioMenuName",
        label: "SMOOTHER_FIGHT.Settings.AudioMenuLabel",
        hint: "SMOOTHER_FIGHT.Settings.AudioMenuHint",
        icon: "fa-solid fa-volume-high",
        type: AudioFeedbackApplication,
        restricted: false,
    });
}
