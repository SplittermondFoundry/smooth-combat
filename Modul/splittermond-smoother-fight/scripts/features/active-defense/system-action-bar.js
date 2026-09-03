import { MODULE_ID } from "../../core/constants.js";
import { services } from "../../core/services.js";

const INSTALLED = Symbol("splittermond-smoother-fight.active-defense-action-bar");

export function installSystemActionBarActiveDefenseInterceptor(
    actionBar = globalThis.game?.splittermond?.tokenActionBar,
) {
    if (!actionBar || actionBar[INSTALLED]) return Boolean(actionBar?.[INSTALLED]);
    const original = actionBar.rollDefense;
    if (typeof original !== "function") return false;

    const interceptedRollDefense = function (event, target) {
        const actor = this?.currentActor ?? actionBar.currentActor;
        const token = actionBarTokenForActor(actor);
        if (!actor || !token || typeof services.beginStandaloneActiveDefense !== "function") {
            return original.call(this, event, target);
        }
        const type = target?.dataset?.defenseType || undefined;
        void services.beginStandaloneActiveDefense({ actor, token }, type).catch((error) => {
            console.error(`${MODULE_ID} | Active defense from the system action bar failed`, error);
        });
        return undefined;
    };

    try {
        actionBar.rollDefense = interceptedRollDefense;
        if (actionBar.rollDefense !== interceptedRollDefense) return false;
        Object.defineProperty(actionBar, INSTALLED, { configurable: true, value: true });
        return true;
    } catch {
        if (actionBar.rollDefense === interceptedRollDefense) actionBar.rollDefense = original;
        return false;
    }
}

function actionBarTokenForActor(actor) {
    const direct = actor?.token?.document ?? actor?.token;
    if (direct) return direct;
    const controlled = services.getControlledTokenDocument?.();
    if (tokenMatchesActor(controlled, actor)) return controlled;

    const matches = combatantsOf(globalThis.game?.combat)
        .map((combatant) => combatant?.token?.document ?? combatant?.token ?? services.resolveCombatantToken?.(combatant))
        .filter((token) => tokenMatchesActor(token, actor));
    return matches.length === 1 ? matches[0] : null;
}

function tokenMatchesActor(token, actor) {
    if (!token || !actor) return false;
    const tokenActor = token.actor;
    return tokenActor === actor
        || (tokenActor?.uuid && tokenActor.uuid === actor.uuid)
        || (tokenActor?.id && tokenActor.id === actor.id);
}

function combatantsOf(combat) {
    const combatants = combat?.combatants ?? combat?.turns ?? [];
    return Array.from(combatants?.values?.() ?? combatants);
}
