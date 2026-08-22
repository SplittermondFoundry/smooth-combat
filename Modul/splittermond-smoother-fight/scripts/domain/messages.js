export function combatMessageKind(message) {
    const type = message?.type;
    const modelName = message?.system?.constructor?.name;
    if (type === "attackRollMessage" || modelName === "AttackRollMessage") return "attack";
    if (type === "spellRollMessage" || modelName === "SpellRollMessage") return "spell";
    if (type === "damageMessage" || modelName === "DamageMessage") return "damage";
    return null;
}

export function isOffensiveCombatMessage(message) {
    const kind = combatMessageKind(message);
    return kind === "attack" || kind === "spell";
}

export function parseStatusEffectLabel(value) {
    const label = String(value ?? "").trim();
    if (!label) return { name: "", level: 0 };
    const match = label.match(/^(.*?)(?:\s+(\d+))?$/u);
    return {
        name: (match?.[1] ?? label).trim(),
        level: Math.max(1, Number.parseInt(match?.[2] ?? "1", 10) || 1),
    };
}
