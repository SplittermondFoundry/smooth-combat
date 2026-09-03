/** Public chat-action facade retained for stable feature and test imports. */

export {
    handleChatCardAction,
    handleRenderedOffenseFollowUp,
} from "./action-dispatch.js";

export {
    enforceChatPermissions,
    enforceOffenseDefensePhaseControls,
    hasUsableAssociatedDefenseTickAction,
    isMessageSpeakerAssignedToCurrentUser,
    isOffenseFollowUpControl,
    mayControlSpeakerActor,
    resolveMessageTarget,
} from "./rendered-controls.js";
