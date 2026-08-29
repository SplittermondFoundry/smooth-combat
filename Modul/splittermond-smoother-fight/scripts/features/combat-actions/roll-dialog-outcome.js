export async function rollSkillWithDialogCancellation(actor, skillId, options) {
    const message = await actor.rollSkill?.(skillId, options);
    return message || null;
}
