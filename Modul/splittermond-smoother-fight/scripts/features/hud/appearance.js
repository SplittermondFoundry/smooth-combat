import {
    DEFAULT_ASSETS,
    MODULE_ID,
} from "../../core/constants.js";

import {
    getSetting,
    t,
} from "../../shared/values.js";

const ICON_FILENAMES = Object.freeze({
    defense: "active-defense.svg",
    damage: "damage.svg",
    damageBlocked: "damage-blocked.svg",
    spell: "spell.svg",
    ranged: "ranged.svg",
    turn: "turn.svg",
});

const APPEARANCE_DEFAULTS = Object.freeze({
    hudBackgroundDark: "",
    hudBackgroundLight: "",
    hudIconDirectory: "",
    hudMotion: "system",
});

function cleanPath(value) {
    return String(value ?? "").trim().replace(/[\\/]+$/u, "");
}

function cssUrl(value) {
    const path = String(value ?? "").replace(/[\n\r\f]/gu, "");
    return `url(${JSON.stringify(path)})`;
}

function customIconPath(directory, filename) {
    return directory ? `${directory}/${filename}` : null;
}

export function applyHudAppearance(element) {
    if (!element) return;
    const darkBackground = cleanPath(getSetting("hudBackgroundDark", "")) || DEFAULT_ASSETS.backgrounds.dark;
    const lightBackground = cleanPath(getSetting("hudBackgroundLight", "")) || DEFAULT_ASSETS.backgrounds.light;
    const iconDirectory = cleanPath(getSetting("hudIconDirectory", ""));
    element.style.setProperty("--sf-hud-background-dark", cssUrl(darkBackground));
    element.style.setProperty("--sf-hud-background-light", cssUrl(lightBackground));
    for (const [id, defaultPath] of Object.entries(DEFAULT_ASSETS.icons)) {
        const path = customIconPath(iconDirectory, ICON_FILENAMES[id]) ?? defaultPath;
        element.style.setProperty(`--sf-icon-${id.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`, cssUrl(path));
    }
    const motion = getSetting("hudMotion", "system");
    element.classList.toggle("sf-motion-full", motion === "full");
    element.classList.toggle("sf-motion-none", motion === "none");
}

export function registerAppearanceSettingsMenu() {
    const Base = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2);

    class AppearanceApplication extends Base {
        static DEFAULT_OPTIONS = {
            id: "smoother-fight-appearance",
            classes: ["smoother-fight", "sf-appearance-settings"],
            tag: "div",
            position: { width: 700, height: 590 },
            window: {
                title: "SMOOTHER_FIGHT.Settings.AppearanceTitle",
                icon: "fa-solid fa-palette",
                minimizable: true,
                resizable: true,
            },
        };

        static PARTS = {
            form: {
                template: `modules/${MODULE_ID}/templates/appearance-settings.hbs`,
            },
        };

        async _prepareContext(options) {
            const context = await super._prepareContext(options);
            return {
                ...context,
                darkBackground: getSetting("hudBackgroundDark", ""),
                lightBackground: getSetting("hudBackgroundLight", ""),
                iconDirectory: getSetting("hudIconDirectory", ""),
                motion: getSetting("hudMotion", "system"),
                motionChoices: ["system", "full", "none"].map((id) => ({
                    id,
                    label: t(`SMOOTHER_FIGHT.Settings.Motion${id[0].toUpperCase()}${id.slice(1)}`),
                    selected: id === getSetting("hudMotion", "system"),
                })),
                defaults: DEFAULT_ASSETS,
            };
        }

        async _onRender(context, options) {
            await super._onRender(context, options);
            const read = (role) => String(this.element.querySelector(`[data-role="${role}"]`)?.value ?? "").trim();
            const markDirty = () => this.element.querySelector('[data-role="appearance-dirty"]')?.removeAttribute("hidden");
            for (const control of this.element.querySelectorAll("file-picker, input, select")) {
                control.addEventListener("change", markDirty);
                control.addEventListener("input", markDirty);
            }
            this.element.querySelector('[data-action="reset-appearance"]')?.addEventListener("click", async () => {
                await this.save(APPEARANCE_DEFAULTS);
            });
            this.element.querySelector('[data-action="save-appearance"]')?.addEventListener("click", async () => {
                await this.save({
                    hudBackgroundDark: read("background-dark"),
                    hudBackgroundLight: read("background-light"),
                    hudIconDirectory: cleanPath(read("icon-directory")),
                    hudMotion: read("motion") || "system",
                });
            });
        }

        async save(values) {
            for (const [key, value] of Object.entries(values)) {
                await game.settings.set(MODULE_ID, key, value);
            }
            ui.notifications.info(t("SMOOTHER_FIGHT.Settings.AppearanceSaved"));
            this.close();
        }
    }

    game.settings.registerMenu(MODULE_ID, "appearanceMenu", {
        name: "SMOOTHER_FIGHT.Settings.AppearanceMenuName",
        label: "SMOOTHER_FIGHT.Settings.AppearanceMenuLabel",
        hint: "SMOOTHER_FIGHT.Settings.AppearanceMenuHint",
        icon: "fa-solid fa-palette",
        type: AppearanceApplication,
        restricted: false,
    });
}
