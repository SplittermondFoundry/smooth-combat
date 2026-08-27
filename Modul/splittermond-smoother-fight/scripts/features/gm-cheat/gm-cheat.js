import { services } from "../../core/services.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    escapeHtml,
    t,
} from "../../shared/values.js";

import { gmCheatState } from "./state.js";

const PATCH_MARKER = Symbol.for(`${MODULE_ID}.gmCheatEvaluate`);

export function installGmCheatRollInterceptor() {
    let installed = 0;
    for (const RollClass of configuredRollClasses()) {
        const prototype = RollClass?.prototype;
        const originalEvaluate = prototype?.evaluate;
        if (typeof originalEvaluate !== "function") continue;
        if (originalEvaluate[PATCH_MARKER]) {
            installed += 1;
            continue;
        }

        const interceptedEvaluate = async function (...args) {
            return evaluateWithGmCheat(this, originalEvaluate, args);
        };
        Object.defineProperty(interceptedEvaluate, PATCH_MARKER, { value: true });
        prototype.evaluate = interceptedEvaluate;
        if (prototype.evaluate === interceptedEvaluate) installed += 1;
    }
    return installed > 0;
}

export function getGmCheatRollPreset() {
    if (!globalThis.game?.user?.isGM || !gmCheatState.armed) return null;
    return { armed: true };
}

export async function toggleGmCheatRoll() {
    if (!globalThis.game?.user?.isGM) return false;
    if (gmCheatState.armed) {
        resetCheatState();
        globalThis.ui?.notifications?.info?.(t("SMOOTHER_FIGHT.HUD.CheatRollCancelled"));
    } else {
        gmCheatState.armed = true;
        gmCheatState.phase = "armed";
        globalThis.ui?.notifications?.info?.(t("SMOOTHER_FIGHT.HUD.CheatRollArmed"));
    }
    services.scheduleRender?.(0);
    return true;
}

async function evaluateWithGmCheat(roll, originalEvaluate, args) {
    if (!shouldInterceptRoll(roll, args)) return originalEvaluate.apply(roll, args);
    const descriptors = describeDice(roll);
    if (!descriptors.length) return originalEvaluate.apply(roll, args);

    gmCheatState.phase = "prompting";
    let selection;
    try {
        selection = await openResultDialog(roll, descriptors);
    } catch (error) {
        console.error(`${MODULE_ID} | Could not open the GM dice preset dialog`, error);
        resetCheatState();
        globalThis.ui?.notifications?.warn?.(t("SMOOTHER_FIGHT.HUD.CheatRollUnavailable"));
        services.scheduleRender?.(0);
        return originalEvaluate.apply(roll, args);
    }

    if (!selection?.values) {
        resetCheatState();
        globalThis.ui?.notifications?.info?.(t("SMOOTHER_FIGHT.HUD.CheatRollNormal"));
        services.scheduleRender?.(0);
        return originalEvaluate.apply(roll, args);
    }

    const restoreRandomFaces = installForcedResults(descriptors, selection.values);
    resetCheatState();
    if (!restoreRandomFaces) {
        globalThis.ui?.notifications?.warn?.(t("SMOOTHER_FIGHT.HUD.CheatRollUnavailable"));
        services.scheduleRender?.(0);
        return originalEvaluate.apply(roll, args);
    }

    gmCheatState.phase = "forcing";
    services.scheduleRender?.(0);
    let completed = false;
    try {
        const result = await originalEvaluate.apply(roll, args);
        completed = true;
        return result;
    } finally {
        restoreRandomFaces();
        gmCheatState.phase = "idle";
        if (completed) globalThis.ui?.notifications?.info?.(t("SMOOTHER_FIGHT.HUD.CheatRollUsed"));
        services.scheduleRender?.(0);
    }
}

function shouldInterceptRoll(roll, args) {
    const evaluationOptions = args?.[0];
    return Boolean(
        globalThis.game?.user?.isGM
        && gmCheatState.armed
        && gmCheatState.phase === "armed"
        && !roll?._evaluated
        && evaluationOptions?.allowInteractive !== false
    );
}

function configuredRollClasses() {
    return new Set([
        ...(globalThis.CONFIG?.Dice?.rolls ?? []),
        globalThis.foundry?.dice?.Roll,
        globalThis.Roll,
    ].filter((candidate) => typeof candidate === "function"));
}

function describeDice(roll) {
    let dice;
    try {
        dice = Array.from(roll?.dice ?? []);
    } catch {
        return [];
    }
    const seen = new Set();
    return dice.flatMap((term) => {
        if (!term || seen.has(term) || typeof term.randomFace !== "function") return [];
        seen.add(term);
        const number = Number(term.number);
        const faces = Number(term.faces);
        if (!Number.isInteger(number) || number < 1 || !Number.isInteger(faces) || faces < 2) return [];
        return [{ term, number, faces }];
    });
}

async function openResultDialog(roll, descriptors) {
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (!DialogV2?.wait) return null;
    const facesByInput = descriptors.flatMap(({ number, faces }) => Array(number).fill(faces));
    const diceSummary = descriptors.map(({ number, faces }) => `${number}W${faces}`).join(" + ");
    const inputs = facesByInput.map((faces, index) => {
        const label = t("SMOOTHER_FIGHT.HUD.CheatRollDie", { number: index + 1, faces });
        return `<label><span>${escapeHtml(label)}</span><input name="die${index}" type="number" min="1" max="${faces}" step="1" value="${faces}" inputmode="numeric" autocomplete="off" required ${index === 0 ? "autofocus" : ""}></label>`;
    }).join("");
    const formula = String(roll?.formula ?? roll?._formula ?? diceSummary);
    const content = `<form class="sf-cheat-roll-dialog">
        <p>${escapeHtml(t("SMOOTHER_FIGHT.HUD.CheatRollHint", { dice: diceSummary }))}</p>
        <p class="sf-cheat-roll-formula"><code>${escapeHtml(formula)}</code></p>
        <fieldset><legend>${escapeHtml(t("SMOOTHER_FIGHT.HUD.CheatRollDice"))}</legend><div class="sf-cheat-dice-inputs">${inputs}</div></fieldset>
    </form>`;
    return DialogV2.wait({
        id: `${MODULE_ID}-gm-cheat-roll-dialog`,
        window: { title: t("SMOOTHER_FIGHT.HUD.CheatRollTitle") },
        position: { width: Math.min(720, Math.max(360, 230 + (facesByInput.length * 74))) },
        content,
        buttons: [
            {
                action: "apply",
                label: t("SMOOTHER_FIGHT.HUD.CheatRollApply"),
                icon: "fa-solid fa-wand-magic-sparkles",
                callback: (_event, button) => readResultsFromForm(button.form, facesByInput),
                default: true,
            },
            {
                action: "random",
                label: t("SMOOTHER_FIGHT.HUD.CheatRollRandom"),
                icon: "fa-solid fa-dice",
                callback: () => null,
            },
        ],
        render: (_event, dialog) => bindResultDialog(dialog?.element, facesByInput),
        close: () => null,
        modal: true,
    });
}

function bindResultDialog(root, facesByInput) {
    if (!root?.addEventListener) return;
    root.addEventListener("click", (event) => {
        const button = event.target?.closest?.('button[data-action="apply"]');
        if (!button || (root.contains && !root.contains(button)) || readResultsFromForm(button.form, facesByInput)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        globalThis.ui?.notifications?.warn?.(t("SMOOTHER_FIGHT.HUD.CheatRollInvalid"));
        button.form?.querySelector?.(":invalid")?.focus?.();
        button.form?.reportValidity?.();
    }, { capture: true });
}

function readResultsFromForm(form, facesByInput) {
    const values = facesByInput.map((faces, index) => {
        const input = form?.elements?.[`die${index}`];
        const raw = String(input?.value ?? "").trim();
        const value = raw ? Number(input?.valueAsNumber ?? raw) : Number.NaN;
        return Number.isInteger(value) && value >= 1 && value <= faces ? value : Number.NaN;
    });
    return values.some(Number.isNaN) ? null : { values };
}

function installForcedResults(descriptors, values) {
    const restorers = [];
    let offset = 0;
    try {
        for (const { term, number } of descriptors) {
            const queue = values.slice(offset, offset + number);
            offset += number;
            const originalRandomFace = term.randomFace;
            const hadOwnRandomFace = Object.hasOwn(term, "randomFace");
            const forcedRandomFace = function (...args) {
                return queue.length ? queue.shift() : originalRandomFace.apply(this, args);
            };
            term.randomFace = forcedRandomFace;
            if (term.randomFace !== forcedRandomFace) throw new Error("Dice term rejected the result interceptor");
            restorers.push(() => {
                if (hadOwnRandomFace) term.randomFace = originalRandomFace;
                else delete term.randomFace;
            });
        }
    } catch (error) {
        for (const restore of restorers.reverse()) restore();
        console.error(`${MODULE_ID} | Could not apply the GM dice preset`, error);
        return null;
    }
    return () => {
        for (const restore of restorers.reverse()) restore();
    };
}

function resetCheatState() {
    gmCheatState.armed = false;
    gmCheatState.phase = "idle";
}
