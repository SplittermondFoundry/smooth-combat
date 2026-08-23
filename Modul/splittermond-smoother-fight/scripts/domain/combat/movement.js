export const FREE_MOVEMENT_DISTANCE = 2;

export function movementTrackerState(distance, speed) {
    const moved = nonNegativeNumber(distance);
    const movementSpeed = nonNegativeNumber(speed);
    const available = movementSpeed > 0;
    const walkLimit = Math.max(FREE_MOVEMENT_DISTANCE, movementSpeed);
    const sprintLimit = Math.max(walkLimit, movementSpeed * 3);
    const excess = Math.max(0, moved - sprintLimit);

    let phase = "free";
    let actionId = null;
    let actionTicks = null;
    if (!available) phase = "unavailable";
    else if (moved > sprintLimit) {
        phase = "excess";
        actionId = "sprint";
        actionTicks = 10;
    } else if (moved > walkLimit) {
        phase = "sprint";
        actionId = "sprint";
        actionTicks = 10;
    } else if (moved > FREE_MOVEMENT_DISTANCE) {
        phase = "walk";
        actionId = "walk";
        actionTicks = 5;
    }

    return {
        actionId,
        actionTicks,
        available,
        excess,
        freeLimit: FREE_MOVEMENT_DISTANCE,
        moved,
        phase,
        sectionProgress: {
            free: rangeProgress(moved, 0, FREE_MOVEMENT_DISTANCE),
            walk: rangeProgress(moved, FREE_MOVEMENT_DISTANCE, walkLimit),
            sprint: rangeProgress(moved, walkLimit, sprintLimit),
        },
        speed: movementSpeed,
        sprintLimit,
        walkLimit,
    };
}

function rangeProgress(value, minimum, maximum) {
    if (value <= minimum) return 0;
    const range = maximum - minimum;
    if (range <= 0) return 100;
    return Math.min(100, Math.max(0, ((value - minimum) / range) * 100));
}

function nonNegativeNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}
