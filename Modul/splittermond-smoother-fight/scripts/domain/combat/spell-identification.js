export function spellIdentificationDifficulty(grade) {
    if (grade === null || grade === undefined || String(grade).trim() === "") return null;
    const value = Number(grade);
    return Number.isInteger(value) && value >= 0 && value <= 5 ? 15 + (3 * value) : null;
}

export function spellIdentificationOutcome(check) {
    if (!check || typeof check !== "object") return null;
    if (check.isFumble === true) return "devastating";
    if (typeof check.succeeded !== "boolean" || check.degreeOfSuccess == null) return null;
    const degrees = typeof check.degreeOfSuccess === "object"
        ? Number(check.degreeOfSuccess.fromRoll) + Number(check.degreeOfSuccess.modification ?? 0)
        : Number(check.degreeOfSuccess);
    if (!Number.isFinite(degrees)) return null;
    if (check.succeeded) return degrees >= 5 ? "outstanding" : "success";
    if (degrees <= -5) return "devastating";
    return degrees === 0 ? "nearmiss" : "failure";
}
