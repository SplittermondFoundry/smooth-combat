export {
    enforceChatPermissions,
    handleChatCardAction,
    resolveMessageTarget,
} from "./actions.js";

export {
    addDamageRecoveryActions,
    applyRemoteDefenseNumbingDamage,
    applyRemoteDamageApplication,
    finalizeRemoteDamageApplication,
    finishRemoteDefenseNumbingDamage,
    finishRemoteDamageApplication,
    getDamageApplicationState,
    getNumbingDamageApplicationState,
} from "./damage-application.js";

export {
    applyRemoteLegacyTickAdvance,
    finishRemoteLegacyTickAdvance,
} from "./legacy-ticks.js";

export {
    isDiceAnimationPending,
    onCreateChatMessage,
    onUpdateChatMessage,
    prepareExistingRenderedChatMessages,
    prepareRenderedChatMessage,
    waitForChatMessage,
    waitForDefenseProcessing,
    waitForDiceSoNice,
} from "./lifecycle.js";

export {
    checkResultMessage,
    createDefenseSplinterpointChatCard,
    createTickActionChatCard,
    getDefenseCheck,
    getMessageContext,
    isCombatEventMessage,
    isDamageMessage,
    isDefenseMessage,
    isOwnMessage,
    isSpellMessage,
    resolveSpeakerActor,
    setRequiredFlag,
    speakerTokenUuid,
} from "./messages.js";
