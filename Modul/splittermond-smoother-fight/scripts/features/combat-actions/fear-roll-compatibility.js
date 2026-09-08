import { MODULE_ID } from "../../core/constants.js";
import { escapeHtml, t } from "../../shared/values.js";
import { combatActionState } from "./state.js";

const FORM_PATCH = Symbol.for(`${MODULE_ID}.fearRollForm1427`);
const ROLL_TYPES = new Set(["risk", "standard", "safety"]);

export function isFearRollCompatibilityRequired() {
    return globalThis.game?.system?.id === "splittermond" && game.system.version === "14.2.7";
}

export function prepareFearRollDialog(application) {
    if (!isFearRollCompatibilityRequired()) return false;
    const actor = application?.checkData?.skill?.actor;
    const element = application?.element;
    if (!application?.options?.classes?.includes("splittermond") || !application.options.classes.includes("dialog-check")
        || !actor || !element?.querySelector || typeof application._onSubmit !== "function"
        || typeof application.constructor?._prepareFormData !== "function") return false;

    let state = combatActionState.fearRollDialogs.get(application);
    if (!state) {
        state = { application, actor, element, pending: false, allowedRollType: null, initialized: false, defaults: null };
        combatActionState.fearRollDialogs.set(application, state);
        const original = application._onSubmit;
        application._onSubmit = function (target, event) {
            return submitFearRoll(state, original, target, event);
        };
        installFormDataCapture(application.constructor);
    }
    state.element = element;
    combatActionState.fearRollElements.set(element, state);
    refreshPreset(state, !state.initialized);
    state.initialized = true;
    return true;
}

export function applyFearRollRequirement(skill, checkData) {
    if (!isFearRollCompatibilityRequired() || !checkData || typeof checkData !== "object") return;
    const approved = combatActionState.fearRollInputs.get(checkData);
    combatActionState.fearRollInputs.delete(checkData);
    if (!isAngsterfuellt(skill?.actor)) return;
    // The system calls this before rolling and before adding the Grandmaster suffix.
    // Each approved exception belongs to one exact input object and rolling actor.
    if (approved?.actor === skill.actor && approved.rollType === checkData.rollType) return;
    checkData.rollType = "safety";
}

function installFormDataCapture(DialogClass) {
    const original = DialogClass._prepareFormData;
    if (original[FORM_PATCH]) return;
    const prepare = function (element, ...args) {
        const data = original.call(this, element, ...args);
        const state = combatActionState.fearRollElements.get(element);
        if (isFearRollCompatibilityRequired() && data && state?.allowedRollType) {
            combatActionState.fearRollInputs.set(data, { actor: state.actor, rollType: state.allowedRollType });
        }
        return data;
    };
    Object.defineProperty(prepare, FORM_PATCH, { value: true });
    DialogClass._prepareFormData = prepare;
}

async function submitFearRoll(state, original, target, event) {
    const { application } = state;
    if (!isFearRollCompatibilityRequired()) return original.call(application, target, event);
    event?.preventDefault?.();
    if (state.pending || application.rendered === false || state.element.isConnected === false) return application;
    const rollType = target?.dataset?.action;
    if (!ROLL_TYPES.has(rollType)) return original.call(application, target, event);
    state.pending = true;
    try {
        refreshPreset(state);
        if (isAngsterfuellt(state.actor) && rollType !== "safety") {
            const confirmed = await globalThis.foundry?.applications?.api?.DialogV2?.confirm({
                window: { title: t("SMOOTHER_FIGHT.HUD.FearRollConfirmTitle") },
                content: `<p>${escapeHtml(t("SMOOTHER_FIGHT.HUD.FearRollConfirmBody", {
                    rollType: t(`splittermond.rollType.${rollType}`),
                }))}</p>`,
                defaultYes: false,
                rejectClose: false,
            });
            if (!confirmed || application.rendered === false || state.element.isConnected === false) return application;
        }
        state.allowedRollType = rollType;
        return await original.call(application, target, event);
    } finally {
        state.allowedRollType = null;
        state.pending = false;
    }
}

function refreshPreset(state, focus = false) {
    const { application, element } = state;
    const fearful = isAngsterfuellt(state.actor);
    if (!fearful && !state.defaults) return;
    if (fearful && !state.defaults) {
        state.defaults = Object.fromEntries([...ROLL_TYPES].map(type => [type, {
            autofocus: element.querySelector(`button[data-action="${type}"]`)?.hasAttribute("autofocus") ?? false,
            default: application.options?.buttons?.[type]?.default,
        }]));
    }
    element.classList.toggle("sf-fear-roll-compat", fearful);
    for (const type of ROLL_TYPES) {
        const button = element.querySelector(`button[data-action="${type}"]`);
        if (!button) continue;
        const preferred = fearful ? type === "safety" : state.defaults[type].autofocus;
        button.classList.toggle("sf-fear-roll-preset", fearful && preferred);
        button.toggleAttribute("autofocus", preferred);
        if (application.options?.buttons?.[type]) {
            application.options.buttons[type].default = fearful ? preferred : state.defaults[type].default;
        }
        if (focus && fearful && preferred) button.focus();
    }
    const notice = element.querySelector(".sf-fear-roll-hint");
    if (!fearful) {
        notice?.remove();
        state.defaults = null;
    } else if (!notice) {
        const content = element.querySelector(".dialog-content");
        content?.insertAdjacentHTML("afterbegin", `<p class="sf-fear-roll-hint" role="note">${escapeHtml(t("SMOOTHER_FIGHT.HUD.FearRollHint"))}</p>`);
    }
}

function isAngsterfuellt(actor) {
    const items = actor?.items?.contents ?? Array.from(actor?.items ?? []);
    if (items.some((item) => item.type === "statuseffect" && Number(item.system?.level ?? 1) > 0
        && isFearName(item.name))) return true;
    const effects = actor?.effects?.contents ?? Array.from(actor?.effects ?? []);
    return effects.some((effect) => !effect.disabled && !effect.isSuppressed && !effect.duration?.expired
        && (isFearName(effect.name) || Array.from(effect.statuses ?? []).some(isFearName)));
}

function isFearName(value) {
    const name = String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").trim().toLowerCase();
    return name === "angsterfullt" || name === "angsterfuellt";
}
