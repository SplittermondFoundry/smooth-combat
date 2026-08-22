export function mayViewActorResources(isGm, hasObserverPermission) {
    return Boolean(isGm || hasObserverPermission);
}

export function mayViewTargetDefenses(revealToEveryone, isGm, hasObserverPermission) {
    return Boolean(revealToEveryone || isGm || hasObserverPermission);
}

export function isCombatantVisibleToUser(isGm, combatantHidden, tokenHidden = false) {
    return Boolean(isGm || (!combatantHidden && !tokenHidden));
}

export function mayViewTargetDifficulty(isTargetDependent, isGm, hasObserverPermission) {
    return !isTargetDependent || mayViewActorResources(isGm, hasObserverPermission);
}

export function mayUseRemoteChatActions(isGm, ownsSpeakerActor, isMessageAuthor, isAssignedSpeaker = false) {
    return Boolean(isGm || ownsSpeakerActor || isMessageAuthor || isAssignedSpeaker);
}

export function isPlayersTurn({
    isGm = false,
    userId = null,
    controllerUserId = null,
    ownsActor = false,
} = {}) {
    if (!userId) return false;
    if (controllerUserId) return controllerUserId === userId;
    return Boolean(!isGm && ownsActor);
}

export function requiresRollManagementPermission(action, isDegreeOption = false) {
    if (isDegreeOption) return true;
    return ["consumecosts", "advancetoken", "addtick", "usesplinterpoint"].includes(
        String(action ?? "").trim().toLocaleLowerCase()
    );
}

export function isDamageSelectionAction(action) {
    const normalized = String(action ?? "").trim().toLocaleLowerCase();
    if (!normalized || normalized.startsWith("applydamageto")) return false;
    return normalized.includes("damage");
}
