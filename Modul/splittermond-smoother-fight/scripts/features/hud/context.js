import { hudState } from "./state.js";

import { services } from "../../core/services.js";

import {
    isCombatantVisibleToUser,
    selectPersonalCombatant,
} from "../../combat-rules.js";

export function getHudContext() {
    const combat = game.combat;
    if (!combat?.started) return null;
    const combatant = combat.combatant ?? combat.turns?.[0] ?? null;
    if (!combatant) return null;
    const actor = combatant?.actor ?? null;
    const resolvedToken = combatant.token ?? services.resolveCombatantToken(combatant);
    const token = resolvedToken?.document ?? resolvedToken;
    const visible = isCombatantVisibleToUser(game.user?.isGM, combatant.hidden, token?.hidden);
    if (!visible || (!actor && !game.user?.isGM)) {
        return {
            combat,
            combatant,
            actor: null,
            token: null,
            assignedUser: null,
            runtimeController: null,
            target: null,
            targets: [],
            concealed: true,
        };
    }
    if (!actor) return null;
    const assignedUser = services.getAssignedUser(combatant);
    const runtimeController = services.getRuntimeController(combatant);
    const targetSelection = services.getTargetSelectionForUser(runtimeController);
    return { combat, combatant, actor, token, assignedUser, runtimeController, ...targetSelection };
}

export function getPersonalHudCandidates(activeContext = getHudContext()) {
    const combat = activeContext?.combat;
    if (!combat || game.user?.isGM) return [];
    return Array.from(combat.combatants ?? []).map((combatant) => {
        const actor = combatant.actor;
        const token = combatant.token?.document ?? combatant.token ?? services.resolveCombatantToken(combatant);
        const owned = Boolean(
            actor?.isOwner
            && services.getRuntimeController(combatant)?.id === game.user?.id
        );
        return {
            id: combatant.id,
            combatant,
            actor,
            token,
            tokenId: token?.id ?? combatant.tokenId ?? null,
            tokenUuid: services.tokenUuid(token),
            owned,
        };
    }).filter((candidate) => candidate.owned && candidate.actor);
}

export function getPersonalHudContext(activeContext = getHudContext()) {
    const combat = activeContext?.combat;
    if (!combat || game.user?.isGM) return null;
    const candidates = getPersonalHudCandidates(activeContext);
    const controlledToken = services.getControlledTokenDocument();
    const preferredCombatantId = hudState.personalCombatId === combat.id ? hudState.personalCombatantId : null;
    const selected = selectPersonalCombatant(
        candidates,
        services.tokenUuid(controlledToken) ?? controlledToken?.id,
        preferredCombatantId
    );
    if (!selected?.actor || !selected.combatant) return null;
    const targetSelection = services.getTargetSelectionForUser(game.user);
    return {
        combat,
        combatant: selected.combatant,
        actor: selected.actor,
        token: selected.token,
        assignedUser: services.getAssignedUser(selected.combatant),
        runtimeController: game.user,
        ...targetSelection,
        personal: true,
    };
}

export function selectPersonalCombatantFromMenu(activeContext, combatantId) {
    const selected = getPersonalHudCandidates(activeContext)
        .find((candidate) => candidate.combatant.id === combatantId);
    if (!selected) return;
    hudState.personalCombatId = activeContext.combat.id;
    hudState.personalCombatantId = selected.combatant.id;
    const tokenObject = selected.token?.object ?? canvas?.tokens?.get?.(selected.token?.id);
    tokenObject?.control?.({ releaseOthers: true });
    services.scheduleRender(0);
}

export function resetPersonalCombatantSelection() {
    hudState.personalCombatId = null;
    hudState.personalCombatantId = null;
}

export function resolveHudActionContext(activeContext, element) {
    if (!activeContext) return null;
    const scope = element?.closest?.("[data-sf-context-combatant-id]");
    if (!scope) return activeContext;
    const combatantId = scope.dataset.sfContextCombatantId;
    if (combatantId && combatantId === activeContext.combatant?.id) return activeContext;
    const personalContext = getPersonalHudContext(activeContext);
    return personalContext?.combatant?.id === combatantId ? personalContext : null;
}
