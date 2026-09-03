import {
    COMBAT_TICK_ACTIONS,
} from "../../combat-rules.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    formatMovementDistance,
} from "../../shared/movement.js";

import {
    t,
} from "../../shared/values.js";

const MOVEMENT_ACTIONS = new Set(["crawl", "walk", "sprint"]);

export function buildTickActionChatModel(action, selectedTicks = "custom", localization = {}) {
    if (!action) return null;
    const description = localizedOption(
        localization.descriptionKey,
        localization.descriptionData,
        localization.description,
        `SMOOTHER_FIGHT.HUD.TickActions.${action.id}.Description`,
    );
    const baseSpecial = localizedOption(
        localization.specialKey,
        localization.specialData,
        localization.special,
        action.special
            ? `SMOOTHER_FIGHT.HUD.TickActions.${action.id}.Special`
            : "SMOOTHER_FIGHT.HUD.TickActionDash",
    );
    const movementDistance = finiteDistance(localization.movementDistance);
    const special = MOVEMENT_ACTIONS.has(action.id) && movementDistance !== null
        ? `${baseSpecial} (${t("SMOOTHER_FIGHT.HUD.MovementDistance", {
            distance: formatMovementDistance(movementDistance),
        })})`
        : baseSpecial;
    return {
        eyebrow: t("SMOOTHER_FIGHT.HUD.TickActionCardEyebrow"),
        name: t(`SMOOTHER_FIGHT.HUD.TickActions.${action.id}.Name`),
        tokenLabel: t("SMOOTHER_FIGHT.HUD.TickActionToken"),
        durationLabel: t("SMOOTHER_FIGHT.HUD.TickActionDurationHeading"),
        duration: tickActionCardDuration(action, selectedTicks),
        typeLabel: t("SMOOTHER_FIGHT.HUD.TickActionType"),
        type: t(`SMOOTHER_FIGHT.HUD.TickActionKinds.${action.kind}`),
        descriptionLabel: t("SMOOTHER_FIGHT.HUD.TickActionDescription"),
        description,
        specialLabel: t("SMOOTHER_FIGHT.HUD.TickActionSpecial"),
        special,
        source: action.source ? t("SMOOTHER_FIGHT.HUD.TickActionSource", action.source) : "",
    };
}

export function localizeTickActionChatCard(message, html) {
    const data = message?.getFlag?.(MODULE_ID, "tickAction")
        ?? message?.flags?.[MODULE_ID]?.tickAction;
    if (!data?.id || !html?.querySelector) return false;
    const action = COMBAT_TICK_ACTIONS.find((candidate) => candidate.id === data.id);
    const card = html.matches?.(".sf-tick-action-chat-card:not(.sf-defense-splinterpoint-chat-card)")
        ? html
        : html.querySelector(".sf-tick-action-chat-card:not(.sf-defense-splinterpoint-chat-card)");
    if (!action || !card) return false;

    const sections = Array.from(card.querySelectorAll(":scope > section"));
    const legacyDistance = readLegacyMovementDistance(sections[1]?.querySelector("p")?.textContent);
    const localization = {
        ...legacyLocalization(data),
        ...(data.localization ?? {}),
        movementDistance: finiteDistance(data.localization?.movementDistance) ?? legacyDistance,
    };
    const model = buildTickActionChatModel(action, data.ticks, localization);
    setText(card.querySelector("header small"), model.eyebrow);
    setText(card.querySelector("header h2"), model.name);

    const fields = Array.from(card.querySelectorAll(":scope > dl > div"));
    setField(fields[0], model.tokenLabel);
    setField(fields[1], model.durationLabel, model.duration);
    setField(fields[2], model.typeLabel, model.type);
    setSection(sections[0], model.descriptionLabel, model.description);
    setSection(sections[1], model.specialLabel, model.special);
    setText(card.querySelector(":scope > footer small"), model.source);
    return true;
}

function legacyLocalization(data) {
    if (!Number.isInteger(Number(data?.bonus)) || Number(data.bonus) <= 0) return {};
    if (!["aim", "searchOpening"].includes(data.id)) return {};
    return {
        descriptionKey: `SMOOTHER_FIGHT.HUD.TickActions.${data.id}.ChatDescription`,
        descriptionData: {
            target: data.targetName ?? "–",
            ticks: data.ticks,
        },
        specialKey: `SMOOTHER_FIGHT.HUD.TickActions.${data.id}.ChatSpecial`,
        specialData: { bonus: Number(data.bonus) },
    };
}

function localizedOption(key, data, literal, fallbackKey) {
    if (typeof key === "string" && key) return t(key, data ?? {});
    if (literal !== undefined && literal !== null && literal !== "") return String(literal);
    return t(fallbackKey);
}

function tickActionCardDuration(action, selectedTicks) {
    const selected = Number(selectedTicks);
    if (selectedTicks !== "custom" && Number.isFinite(selected)) {
        return t("SMOOTHER_FIGHT.HUD.TickActionDuration", { ticks: selected });
    }
    if (Array.isArray(action.ticks)) {
        return t("SMOOTHER_FIGHT.HUD.TickActionDurationRange", {
            first: action.ticks[0],
            last: action.ticks.at(-1),
        });
    }
    if (Number.isFinite(Number(action.ticks))) {
        return t("SMOOTHER_FIGHT.HUD.TickActionDuration", { ticks: action.ticks });
    }
    const suffix = action.ticks === "wgs" ? "Wgs" : action.ticks === "spell" ? "Spell" : "Unavailable";
    return t(`SMOOTHER_FIGHT.HUD.TickActionDuration${suffix}`);
}

function readLegacyMovementDistance(value) {
    const match = String(value ?? "").match(/\(([-+]?\d+(?:[.,]\d+)?)\s*m\s+(?:moved|bewegt)\)/iu);
    return match ? finiteDistance(match[1].replace(",", ".")) : null;
}

function finiteDistance(value) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function setField(field, label, value) {
    if (!field) return;
    setText(field.querySelector("dt"), label);
    if (value !== undefined) setText(field.querySelector("dd"), value);
}

function setSection(section, label, value) {
    if (!section) return;
    setText(section.querySelector("h3"), label);
    setText(section.querySelector("p"), value);
}

function setText(element, value) {
    if (element) element.textContent = String(value ?? "");
}
