import { displayLabel, displayValue } from "../../shared/values.js";

export function activeDefenseOptionSummaries(options) {
    const seen = new Set();
    return Array.from(options ?? []).flatMap((option) => {
        const name = displayLabel(option?.name ?? option?.item?.name, "");
        const skill = displayLabel(option?.skill?.label ?? option?.skill?.name, option?.skill?.id ?? "");
        const label = name && skill && name.localeCompare(skill, undefined, { sensitivity: "base" }) !== 0
            ? `${name} · ${skill}`
            : name || skill || displayLabel(option?.id, "");
        const value = displayValue(option?.skill?.value, "");
        const key = `${label}\u0000${value}`;
        if (!label || seen.has(key)) return [];
        seen.add(key);
        return [{ label, value }];
    });
}
