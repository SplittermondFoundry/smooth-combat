export const FREE_MOVEMENT_DISTANCE = 2;

const MOVEMENT_MILESTONES = Object.freeze({
    crawl: Object.freeze([
        Object.freeze({ tickOffset: 5, fraction: 1 }),
    ]),
    walk: Object.freeze([
        Object.freeze({ tickOffset: 3, fraction: 0.5 }),
        Object.freeze({ tickOffset: 5, fraction: 1 }),
    ]),
    sprint: Object.freeze([
        Object.freeze({ tickOffset: 3, fraction: 0.25 }),
        Object.freeze({ tickOffset: 5, fraction: 0.5 }),
        Object.freeze({ tickOffset: 7, fraction: 0.75 }),
        Object.freeze({ tickOffset: 10, fraction: 1 }),
    ]),
});

export function movementActionMilestones(actionId, startTick = 0) {
    const start = finiteNumber(startTick);
    return (MOVEMENT_MILESTONES[actionId] ?? []).map(({ tickOffset, fraction }) => ({
        fraction,
        tick: start + tickOffset,
        tickOffset,
    }));
}

export function movementDueMilestones(plan, currentTick) {
    const completed = clampFraction(plan?.completedFraction);
    const tick = finiteNumber(currentTick);
    return Array.from(plan?.milestones ?? [])
        .filter((milestone) => (
            finiteNumber(milestone?.tick) <= tick
            && clampFraction(milestone?.fraction) > completed
        ))
        .sort((left, right) => left.tick - right.tick || left.fraction - right.fraction);
}

export function movementInterruptionMilestone(plan, currentTick) {
    const tick = finiteNumber(currentTick);
    const milestones = [
        { fraction: 0, tick: finiteNumber(plan?.startTick), tickOffset: 0 },
        ...Array.from(plan?.milestones ?? []).map((milestone) => ({
            fraction: clampFraction(milestone?.fraction),
            tick: finiteNumber(milestone?.tick),
            tickOffset: finiteNumber(milestone?.tickOffset),
        })),
    ].sort((left, right) => left.tick - right.tick || left.fraction - right.fraction);
    return milestones.reduce((nearest, candidate) => {
        const distance = Math.abs(candidate.tick - tick);
        const nearestDistance = Math.abs(nearest.tick - tick);
        return distance < nearestDistance || (distance === nearestDistance && candidate.tick > nearest.tick)
            ? candidate
            : nearest;
    });
}

export function movementPathThroughFractions(route, segmentLengths, fromFraction, fractions) {
    const points = normalizeRoute(route);
    if (points.length < 2) return [];
    const lengths = normalizeSegmentLengths(points, segmentLengths);
    const total = lengths.reduce((sum, length) => sum + length, 0);
    if (total <= 0) return [];

    const requested = Array.from(fractions ?? [], clampFraction)
        .filter((fraction) => fraction > clampFraction(fromFraction))
        .sort((left, right) => left - right);
    if (!requested.length) return [];

    const result = [];
    let cursor = clampFraction(fromFraction);
    for (const fraction of requested) {
        const section = movementPathSection(points, lengths, cursor * total, fraction * total);
        appendDistinctPoints(result, section);
        if (result.length) result.at(-1).checkpoint = true;
        cursor = fraction;
    }
    return result;
}

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

function movementPathSection(points, lengths, startDistance, endDistance) {
    const result = [];
    let elapsed = 0;
    for (let index = 0; index < lengths.length; index += 1) {
        const length = lengths[index];
        const segmentStart = elapsed;
        const segmentEnd = elapsed + length;
        elapsed = segmentEnd;
        if (segmentEnd <= startDistance || segmentStart >= endDistance || length <= 0) continue;

        if (segmentStart > startDistance) appendDistinctPoints(result, [points[index]]);
        if (segmentEnd < endDistance) appendDistinctPoints(result, [points[index + 1]]);
        else {
            const ratio = Math.min(1, Math.max(0, (endDistance - segmentStart) / length));
            appendDistinctPoints(result, [interpolatePoint(points[index], points[index + 1], ratio)]);
            break;
        }
    }
    return result;
}

function normalizeRoute(route) {
    return Array.from(route ?? []).flatMap((point) => {
        const x = Number(point?.x);
        const y = Number(point?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
        return [{ ...point, x, y }];
    });
}

function normalizeSegmentLengths(points, segmentLengths) {
    return points.slice(1).map((point, index) => {
        const measured = Number(segmentLengths?.[index]);
        if (Number.isFinite(measured) && measured > 0) return measured;
        const previous = points[index];
        return Math.hypot(point.x - previous.x, point.y - previous.y);
    });
}

function interpolatePoint(from, to, ratio) {
    const point = {
        ...to,
        x: Math.round(from.x + ((to.x - from.x) * ratio)),
        y: Math.round(from.y + ((to.y - from.y) * ratio)),
        checkpoint: false,
        explicit: false,
    };
    if (Number.isFinite(Number(from.elevation)) && Number.isFinite(Number(to.elevation))) {
        point.elevation = from.elevation + ((to.elevation - from.elevation) * ratio);
    }
    return point;
}

function appendDistinctPoints(target, points) {
    for (const point of points) {
        const previous = target.at(-1);
        if (previous && previous.x === point.x && previous.y === point.y
            && Number(previous.elevation ?? 0) === Number(point.elevation ?? 0)) continue;
        target.push({ ...point });
    }
}

function clampFraction(value) {
    return Math.min(1, Math.max(0, finiteNumber(value)));
}

function finiteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}
