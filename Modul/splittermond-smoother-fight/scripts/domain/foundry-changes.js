export function hasSplittermondCheckUpdate(changes) {
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) return false;
    if (Object.keys(changes).some((key) =>
        key === "flags.splittermond.check" || key.startsWith("flags.splittermond.check.")
        || key === "system.checkReport" || key.startsWith("system.checkReport.")
    )) return true;

    const system = changes.system;
    if (system && typeof system === "object" && !Array.isArray(system)
        && Object.hasOwn(system, "checkReport")) return true;

    const flags = changes.flags;
    if (!flags || typeof flags !== "object" || Array.isArray(flags)) return false;
    if (Object.hasOwn(flags, "splittermond.check")) return true;
    const splittermond = flags.splittermond;
    return Boolean(splittermond && typeof splittermond === "object" && Object.hasOwn(splittermond, "check"));
}

export function hasTokenPositionUpdate(changes) {
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) return false;
    return ["x", "y", "width", "height", "elevation"].some((key) => Object.hasOwn(changes, key));
}

export function tokenDocumentCenter(token, gridSize = 100) {
    const document = token?.document ?? token;
    if (document?.x === null || document?.x === undefined || document?.x === ""
        || document?.y === null || document?.y === undefined || document?.y === "") return null;
    const x = Number(document?.x);
    const y = Number(document?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const size = Number(gridSize) > 0 ? Number(gridSize) : 100;
    const widthValue = Number(document?.width);
    const heightValue = Number(document?.height);
    const width = Number.isFinite(widthValue) && widthValue > 0 ? widthValue : 1;
    const height = Number.isFinite(heightValue) && heightValue > 0 ? heightValue : 1;
    return {
        x: x + width * size / 2,
        y: y + height * size / 2,
    };
}

export function mapValue(values, key) {
    return values?.get?.(key) ?? values?.[key] ?? null;
}

export async function withTemporarySetValues(targetSet, values, callback) {
    const original = Array.from(targetSet ?? []);
    targetSet.clear();
    for (const value of values) targetSet.add(value);
    try {
        return await callback();
    } finally {
        targetSet.clear();
        for (const value of original) targetSet.add(value);
    }
}
