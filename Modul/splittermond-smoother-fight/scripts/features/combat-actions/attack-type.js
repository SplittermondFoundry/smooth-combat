export function isRangedAttack(attack) {
    const item = attack?.item ?? attack;
    if (typeof attack?.isRanged === "boolean") return attack.isRanged;
    const rawSkill = attack?.skill?.id
        ?? attack?.skill
        ?? item?.skill?.id
        ?? item?.system?.skill?.id
        ?? item?.system?.skill;
    const skillId = typeof rawSkill === "string" ? rawSkill : rawSkill?.id;
    const rangedSkills = globalThis.CONFIG?.splittermond?.skillGroups?.ranged ?? ["throwing", "longrange"];
    return Boolean(skillId && Array.from(rangedSkills).includes(skillId));
}
