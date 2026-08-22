/** Public pure-rule facade retained for stable module and test imports. */

export {
    actorLinkUuid,
    isRedundantDeletedTokenLink,
    linkMatchesCombatant,
    normalizeActorUserLinks,
    normalizeSearchText,
    normalizeTargetReferences,
    normalizeTargetSelection,
    normalizeUserTokenLinks,
    replaceManagedUserTokenLinks,
    uniqueTokensByReference,
} from "./domain/assignments.js";

export {
    attackControlSelection,
    attackControlState,
    attackOutcomeChanged,
    attackReadiness,
    DEFAULT_CHECK_CONFIG,
    isTargetDependentDifficulty,
    recalculateAttackReport,
    totalDegreesOfSuccess,
} from "./domain/combat/attack.js";

export {
    activeDefenseChangesDifficulty,
    bestActiveDefenseValue,
    calculateActiveDefenseValue,
    findDefensiveFeatureValue,
    isDefenderMasteryName,
    mergeActiveDefenseCheck,
    parseActiveDefenseDescription,
} from "./domain/combat/defense.js";

export {
    actionRequiresTarget,
    COMBAT_TICK_ACTIONS,
    combatTickActionsFor,
    tickAdvanceConfirmed,
} from "./domain/combat/ticks.js";

export {
    fullyConsumedCost,
    healthCostFeedbackKind,
    healthCostTotal,
    normalizeAudioFeedbackProfile,
} from "./domain/feedback.js";

export {
    hasSplittermondCheckUpdate,
    hasTokenPositionUpdate,
    tokenDocumentCenter,
    withTemporarySetValues,
} from "./domain/foundry-changes.js";

export {
    combatActionHighlightState,
    normalizeFavoriteSkillIds,
    reorderFavoriteSkillIds,
    resolveCombatEventOpenIds,
    selectPersonalCombatant,
    toggleFavoriteSkillId,
    visibleCanvasCenterY,
} from "./domain/hud.js";

export {
    combatMessageKind,
    isOffensiveCombatMessage,
    parseStatusEffectLabel,
} from "./domain/messages.js";

export {
    isCombatantVisibleToUser,
    isDamageSelectionAction,
    isPlayersTurn,
    mayRollCombatFumble,
    mayUseRemoteChatActions,
    mayViewActorResources,
    mayViewTargetDefenses,
    mayViewTargetDifficulty,
    requiresRollManagementPermission,
} from "./domain/permissions.js";

export {
    numberOr,
} from "./domain/shared.js";
