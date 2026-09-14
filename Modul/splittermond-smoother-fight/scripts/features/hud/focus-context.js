import { services } from "../../core/services.js";
import { getApplicableCombat } from "../../core/combat-compatibility.js";
import { getSetting } from "../../shared/values.js";
import { clearHudFocusTargetSync, getPublishedHudFocusTargets, publishHudFocusTargets } from "./focus-target-sync.js";

// Session-only preferences: no Actor/Token flags or world migrations.
const users = new Map();
let syncingNativeTargets = false;
export const focusEnabled = () => Boolean(getSetting("characterFocusHud", true));
const documentOf = (value) => value?.document ?? value;
const refOf = (value) => documentOf(value)?.uuid ?? null;
const values = (collection) => Array.from(collection?.contents ?? collection ?? []);
function state() {
    const id = globalThis.game?.user?.id;
    if (!users.has(id)) users.set(id, { mode: null, reference: null, targets: new Map() });
    return users.get(id);
}
export function resetHudFocus() { users.clear(); clearHudFocusTargetSync(); }
export function focusReference(context) { return refOf(context?.token) ?? context?.actor?.uuid ?? null; }
export function sameHudToken(left, right) {
    return Boolean(refOf(left) && refOf(left) === refOf(right));
}
function canOwn(actor) { return Boolean(actor && (game.user?.isGM || actor.isOwner)); }
function tokenVisible(token) {
    return Boolean(token && (game.user?.isGM || (!token.hidden && services.isTokenPerceivableByUser?.(token, game.user))));
}
export function getHudFocusCandidates(active = services.getHudContext?.()) {
    const combat = active?.combat ?? getApplicableCombat();
    const combatants = values(combat?.combatants);
    const tokens = new Map();
    for (const scene of values(globalThis.game?.scenes)) for (const token of values(scene.tokens)) {
        if (refOf(token)) tokens.set(refOf(token), documentOf(token));
    }
    for (const token of values(globalThis.canvas?.scene?.tokens)) if (refOf(token)) tokens.set(refOf(token), documentOf(token));
    for (const cb of combatants) {
        const token = documentOf(cb.token ?? services.resolveCombatantToken?.(cb));
        if (refOf(token)) tokens.set(refOf(token), token);
    }
    const candidates = [];
    const represented = new Set();
    for (const token of tokens.values()) {
        if (!canOwn(token.actor) || !tokenVisible(token)) continue;
        const combatant = combatants.find(cb => sameHudToken(cb.token ?? services.resolveCombatantToken?.(cb), token)) ?? null;
        candidates.push({ reference: token.uuid, token, actor: token.actor, combatant, combat });
        represented.add(token.actor.id);
    }
    for (const actor of values(globalThis.game?.actors)) {
        if (!canOwn(actor) || represented.has(actor.id)) continue;
        candidates.push({ reference: actor.uuid, token: null, actor, combatant: null, combat });
    }
    return candidates.sort((a, b) => {
        const current = token => (token?.parent?.id ?? token?.scene?.id) === globalThis.canvas?.scene?.id;
        return Number(current(b.token)) - Number(current(a.token))
            || String(a.token?.name ?? a.actor.name).localeCompare(String(b.token?.name ?? b.actor.name));
    });
}
function preferredCandidate(active) {
    const s = state(), candidates = getHudFocusCandidates(active);
    let candidate = candidates.find(c => c.reference === s.reference);
    if (!candidate && !s.reference) {
        const assigned = globalThis.game?.user?.character;
        const controlled = refOf(services.getControlledTokenDocument?.());
        candidate = candidates.find(c => c.reference === controlled)
            ?? candidates.find(c => c.actor.id === assigned?.id)
            ?? (candidates.length === 1 ? candidates[0] : null);
        if (candidate) s.reference = candidate.reference;
    }
    return candidate ?? null;
}
function selection(references = [], primary = null) {
    const targets = [...new Set(references)].map(id => services.resolveToken?.(id)).filter(tokenVisible);
    const target = targets.find(token => token.uuid === primary) ?? targets.at(-1) ?? null;
    return { targets, target, targetTokenUuids: targets.map(token => token.uuid),
        targetActorUuids: targets.map(token => token.actor?.uuid).filter(Boolean),
        primaryTargetTokenUuid: target?.uuid ?? null, primaryTargetActorUuid: target?.actor?.uuid ?? null,
        targetTokenUuid: target?.uuid ?? null, targetActorUuid: target?.actor?.uuid ?? null };
}
function storeTargets(reference, value) {
    if (!reference) return;
    state().targets.set(reference, { references: value.targets?.map(token => token.uuid) ?? [], primary: value.target?.uuid ?? null });
}
function targetsFor(reference, seed = null) {
    const saved = state().targets.get(reference);
    if (saved) return selection(saved.references, saved.primary);
    const initial = seed ?? selection();
    storeTargets(reference, initial);
    return selection(initial.targets?.map(token => token.uuid), initial.target?.uuid);
}
export function getHudFocusTurnTargets(active, fallback) {
    if (active.runtimeController?.id !== game.user?.id) {
        const saved = getPublishedHudFocusTargets(active.runtimeController?.id, active.token?.uuid);
        return saved ? selection(saved.references, saved.primary) : fallback;
    }
    if (!focusEnabled()) return fallback;
    const chosen = targetsFor(focusReference(active), fallback);
    publishHudFocusTargets(active, chosen);
    return chosen;
}
function actionContext(candidate, active, seed = null) {
    if (!candidate?.actor) return null;
    const reference = candidate.reference ?? focusReference(candidate);
    return { ...candidate, combat: active?.combat ?? candidate.combat,
        ...targetsFor(reference, seed), runtimeController: game.user,
        assignedUser: candidate.combatant ? services.getAssignedUser?.(candidate.combatant) : null,
        hudFocus: true, focusReference: reference, focusUserId: game.user.id,
        combatEventPresentation: active?.combatEventPresentation };
}
export function getHudFocusContexts(active) {
    const s = state(), candidate = preferredCandidate(active);
    if (!s.mode) s.mode = game.user.isGM ? "active" : candidate ? "personal" : "active";
    // Following another user's turn starts with that turn's visible target.
    // A GM edit below switches explicitly to the GM's personal target context.
    if (s.mode === "active" && active?.runtimeController?.id !== game.user.id) storeTargets(focusReference(active), active);
    const nativeTargets = services.getTargetSelectionForUser?.(game.user);
    const personal = actionContext(candidate, active,
        candidate && (candidate.actor.id === game.user.character?.id || sameHudToken(candidate.token, services.getControlledTokenDocument?.())) ? nativeTargets : null);
    const activeAction = !active?.concealed && canOwn(active?.actor)
        ? actionContext(active, active, active) : null;
    return { mode: s.mode, personal, action: s.mode === "personal" ? personal : activeAction };
}
export function hudFocusContextKey(active) {
    if (!focusEnabled()) return null;
    const { mode, personal, action } = getHudFocusContexts(active);
    return JSON.stringify([mode, personal?.focusReference, action?.focusReference]);
}
export function selectHudFocus(active, mode, reference = null) {
    if (!focusEnabled() || !["active", "personal"].includes(mode)) return false;
    // Materialize the previous target context before changing the selection.
    getHudFocusContexts(active);
    if (reference && !getHudFocusCandidates(active).some(c => c.reference === reference)) return false;
    if (reference) state().reference = reference;
    state().mode = mode;
    syncNativeTargets(getHudFocusContexts(active).action);
    services.clearActionMenuExpansionRequest?.();
    services.scheduleRender?.(0);
    return true;
}
export function selectControlledHudToken(token, controlled) {
    const document = documentOf(token), reference = refOf(document);
    if (!controlled || !focusEnabled() || !reference || !canOwn(document?.actor) || !tokenVisible(document)) return false;
    return selectHudFocus(services.getHudContext?.(), "personal", reference);
}
export function resolveHudFocusActionContext(context) {
    if (!focusEnabled() || !context?.hudFocus || context.focusUserId !== game.user?.id) return null;
    const combat = getApplicableCombat();
    if (context.combat?.id !== combat?.id) return null;
    const candidate = getHudFocusCandidates({ combat }).find(c => c.reference === context.focusReference);
    if (!candidate || !canOwn(candidate.actor)) return null;
    return actionContext(candidate, { combat });
}
export function resolveHudFocusElement(active, element) {
    const scope = element?.closest?.("[data-sf-focus-reference]");
    if (!scope) return null;
    return resolveHudFocusActionContext({ hudFocus: true, focusUserId: game.user.id, combat: active?.combat,
        focusReference: scope.dataset.sfFocusReference });
}
export function captureHudFocusTargets(user, references = null) {
    if (!focusEnabled() || user?.id !== game.user?.id) return false;
    if (syncingNativeTargets) return true;
    const active = services.getHudContext?.();
    if (!active) return false;
    const { action } = getHudFocusContexts(active);
    if (action) {
        const chosen = references ? selection(references) : services.getTargetSelectionForUser(user);
        storeTargets(action.focusReference, chosen);
        publishHudFocusTargets(action, chosen);
    }
    return true;
}
export async function setHudFocusTarget(context, uuid, { additive = false, replaceSelection = !additive, remove = false } = {}) {
    const live = resolveHudFocusActionContext(context), target = services.resolveToken?.(uuid);
    if (!live || !tokenVisible(target)) return false;
    const ids = new Set(live.targets.map(token => token.uuid));
    if (remove) ids.delete(uuid);
    else { if (replaceSelection) ids.clear(); ids.add(uuid); }
    const primary = !remove && !additive ? uuid : live.target?.uuid;
    storeTargets(live.focusReference, selection([...ids], primary));
    if (game.user.isGM && state().mode === "active" && sameHudToken(live.token, live.combat?.combatant?.token)
        && services.getRuntimeController?.(live.combat.combatant)?.id !== game.user.id) {
        state().reference = live.focusReference;
        state().mode = "personal";
    }
    publishHudFocusTargets(live, targetsFor(live.focusReference));
    if (getHudFocusContexts(services.getHudContext()).action?.focusReference === live.focusReference) {
        syncNativeTargets({ ...live, ...targetsFor(live.focusReference) });
    }
    // Publish only our active combatant's target; never send a remote set-target.
    const combatant = live.combat?.combatant;
    const controller = services.getRuntimeController?.(combatant);
    if (sameHudToken(live.token, combatant?.token) && controller?.id === game.user.id) {
        const chosen = targetsFor(live.focusReference);
        services.publishOwnTarget?.(chosen.targetTokenUuids, chosen.primaryTargetTokenUuid);
    }
    services.scheduleRender?.(0);
    return true;
}

function syncNativeTargets(context) {
    if (!context || !services.setLocalTarget) return;
    syncingNativeTargets = true;
    try {
        for (const token of game.user.targets ?? []) services.setLocalTarget(documentOf(token), false);
        for (const token of context.targets) services.setLocalTarget(token, true);
    } finally { syncingNativeTargets = false; }
}
