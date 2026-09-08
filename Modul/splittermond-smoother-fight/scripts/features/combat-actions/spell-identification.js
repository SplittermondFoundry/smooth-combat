import { services } from "../../core/services.js";
import { MODULE_ID } from "../../core/constants.js";
import {
    spellIdentificationDifficulty,
    spellIdentificationOutcome,
} from "../../domain/combat/spell-identification.js";
import { prepareTemporaryRollModifiers } from "../../shared/temporary-roll-modifiers.js";
import { displayValue, escapeAttr, escapeHtml, t } from "../../shared/values.js";

const TEXT = "SMOOTHER_FIGHT.HUD.SpellIdentification";
const ACTION_ID = "identifySpell";
const SKILL_ID = "arcanelore";
const CIRCUMSTANCES = [-2, -4, -6];

export async function performSpellIdentification(context) {
    const actor = context.actor;
    const skill = actor?.skills?.[SKILL_ID]
        ?? Object.values(actor?.skills ?? {}).find((candidate) => candidate?.id === SKILL_ID);
    if (!skill || typeof actor.rollSkill !== "function") {
        ui.notifications.warn(t(`${TEXT}.SkillUnavailable`));
        return false;
    }
    const choice = await chooseIdentificationCheck(skill);
    if (!choice) return false;
    const title = t(`SMOOTHER_FIGHT.HUD.TickActions.${ACTION_ID}.Name`);
    const prepared = prepareTemporaryRollModifiers({
        skill,
        modifierManager: actor.modifier,
        groupId: SKILL_ID,
        rollOptions: { difficulty: choice.difficulty, title, preSelectedModifier: [title] },
        modifiers: identificationModifiers(choice),
    });
    let message;
    try {
        message = await actor.rollSkill(SKILL_ID, prepared.rollOptions);
    } finally {
        prepared.cleanup();
    }
    if (!message) return false;
    await services.waitForDiceSoNice(message);
    const check = message.flags?.splittermond?.check
        ?? message.getFlag?.("splittermond", "check")
        ?? message.system?.checkReport;
    const outcome = spellIdentificationOutcome(check) ?? "unknown";
    const difficulty = check?.difficulty == null ? choice.difficulty : Number(check.difficulty);
    const card = await services.createTickActionChatCard(context, ACTION_ID, 2, {
        descriptionKey: `${TEXT}.${check?.hideDifficulty ? "HiddenDifficultyDescription" : "CheckDescription"}`,
        descriptionData: check?.hideDifficulty ? {} : { difficulty: Number.isFinite(difficulty) ? difficulty : choice.difficulty },
        specialKey: `${TEXT}.Results.${outcome}`,
        whisper: Array.isArray(message.whisper) ? message.whisper : [],
        blind: message.blind === true,
    });
    if (!card) return false;
    return await services.addCombatTicks(context, 2) !== null;
}

function identificationModifiers(choice) {
    const modifiers = [];
    if (choice.completed) modifiers.push({
        name: t(`${TEXT}.CompletedModifier`),
        amount: choice.circumstance,
        recordId: "spell-identification:completed",
    });
    if (!choice.completed && choice.components === "one") modifiers.push({
        name: t(`${TEXT}.OmittedModifier`),
        amount: -3,
        recordId: "spell-identification:omitted-component",
    });
    return modifiers;
}

async function chooseIdentificationCheck(skill) {
    const id = `${MODULE_ID}-identify-spell`;
    const gradeButtons = Array.from({ length: 6 }, (_, grade) => (
        `<button type="button" data-sf-spell-grade="${grade}" title="${escapeAttr(t(`${TEXT}.GradeDifficulty`, {
            grade, difficulty: spellIdentificationDifficulty(grade),
        }))}">${escapeHtml(t(`${TEXT}.Grade`, { grade }))}</button>`
    )).join("");
    const circumstanceOptions = CIRCUMSTANCES.map((amount) => (
        `<option value="${amount}">${escapeHtml(t(`${TEXT}.Circumstances.${Math.abs(amount)}`))}</option>`
    )).join("");
    return globalThis.foundry?.applications?.api?.DialogV2?.wait?.({
        id,
        window: { title: t(`SMOOTHER_FIGHT.HUD.TickActions.${ACTION_ID}.Name`) },
        position: { width: 540 },
        content: `<div class="sf-tick-action-dialog sf-spell-identification-dialog">
            <p>${escapeHtml(t(`${TEXT}.DifficultyHint`))}</p>
            <div class="form-group stacked">
                <label for="${id}-difficulty">${escapeHtml(t(`${TEXT}.Difficulty`))}</label>
                <input id="${id}-difficulty" name="difficulty" type="number" min="0" step="1" inputmode="numeric" autocomplete="off" required autofocus>
                <div role="group" aria-label="${escapeAttr(t(`${TEXT}.SpellGrade`))}" style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px">${gradeButtons}</div>
            </div>
            <div class="form-group">
                <label for="${id}-completed">${escapeHtml(t(`${TEXT}.Completed`))}</label>
                <input id="${id}-completed" name="completed" type="checkbox">
            </div>
            <div class="form-group stacked" data-sf-completed-circumstance style="display:none">
                <label for="${id}-circumstance">${escapeHtml(t(`${TEXT}.Circumstance`))}</label>
                <select id="${id}-circumstance" name="circumstance" disabled>${circumstanceOptions}</select>
                <p class="hint">${escapeHtml(t(`${TEXT}.CompletedHint`))}</p>
            </div>
            <div class="form-group stacked">
                <label for="${id}-components">${escapeHtml(t(`${TEXT}.Components`))}</label>
                <select id="${id}-components" name="components">
                    <option value="none">${escapeHtml(t(`${TEXT}.ComponentsPresent`))}</option>
                    <option value="one">${escapeHtml(t(`${TEXT}.OneOmitted`))}</option>
                    <option value="both">${escapeHtml(t(`${TEXT}.BothOmitted`))}</option>
                </select>
                <p class="hint">${escapeHtml(t(`${TEXT}.ComponentsHint`))}</p>
            </div>
        </div>`,
        buttons: [{
            action: "identify",
            label: t("SMOOTHER_FIGHT.HUD.TickActionSkillWithValue", {
                skill: t(`${TEXT}.Skill`), value: displayValue(skill.value, "–"),
            }),
            icon: "fa-solid fa-dice-d20",
            callback: (_event, button) => identificationChoice(button?.form?.elements),
            default: true,
        }],
        render: (_event, dialog) => bindIdentificationDialog(dialog?.element),
        close: () => null,
        modal: true,
    }) ?? null;
}

function identificationChoice(fields) {
    const rawDifficulty = String(fields?.difficulty?.value ?? "").trim();
    const difficulty = Number(rawDifficulty);
    if (!rawDifficulty || !Number.isInteger(difficulty) || difficulty < 0) return null;
    const completed = fields?.completed?.checked === true;
    const circumstance = Number(fields?.circumstance?.value);
    const components = String(fields?.components?.value ?? "none");
    if (completed && !CIRCUMSTANCES.includes(circumstance)) return null;
    if (!completed && !["none", "one"].includes(components)) return null;
    return { difficulty, completed, circumstance: completed ? circumstance : 0, components: completed ? "none" : components };
}

function bindIdentificationDialog(root) {
    if (!root?.addEventListener) return;
    const fields = Object.fromEntries(["difficulty", "completed", "circumstance", "components"].map((name) => (
        [name, root.querySelector(`[name="${name}"]`)]
    )));
    const circumstanceGroup = root.querySelector("[data-sf-completed-circumstance]");
    const updateControls = () => {
        if (circumstanceGroup) circumstanceGroup.style.display = fields.completed?.checked ? "" : "none";
        if (fields.circumstance) fields.circumstance.disabled = !fields.completed?.checked;
        if (fields.components) fields.components.disabled = fields.completed?.checked === true;
    };
    root.addEventListener("change", updateControls);
    updateControls();
    root.addEventListener("click", (event) => {
        const gradeButton = event.target?.closest?.("[data-sf-spell-grade]");
        if (gradeButton && root.contains(gradeButton)) {
            const difficulty = spellIdentificationDifficulty(gradeButton.dataset.sfSpellGrade);
            if (difficulty !== null && fields.difficulty) {
                event.preventDefault();
                fields.difficulty.value = String(difficulty);
                fields.difficulty.focus();
            }
            return;
        }
        const button = event.target?.closest?.('button[data-action="identify"]');
        if (!button || !root.contains(button) || identificationChoice(fields)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const impossible = !fields.completed?.checked && fields.components?.value === "both";
        ui.notifications.warn(t(`${TEXT}.${impossible ? "Impossible" : "DifficultyRequired"}`));
        if (impossible) fields.components?.focus();
        else {
            fields.difficulty?.focus();
            fields.difficulty?.reportValidity();
        }
    }, { capture: true });
}
