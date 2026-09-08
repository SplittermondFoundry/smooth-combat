export function captureMovementRoute(token) {
    if (!token) return null;
    const history = Array.from(token.movementHistory ?? []).map(serializeWaypoint).filter(Boolean);
    if (!history.length) return null;
    const current = serializeWaypoint(token);
    if (current && !samePosition(history.at(-1), current)) history.push(current);
    const waypoints = distinctConsecutiveWaypoints(history);
    if (waypoints.length < 2 || samePosition(waypoints[0], waypoints.at(-1))) return null;

    let measurement = null;
    try {
        measurement = token.measureMovementPath?.(waypoints) ?? null;
    } catch {
        // Pixel lengths below retain the route if Foundry cannot remeasure it.
    }
    const segmentLengths = waypoints.slice(1).map((point, index) => {
        const measured = Number(measurement?.segments?.[index]?.distance);
        if (Number.isFinite(measured) && measured > 0) return measured;
        const previous = waypoints[index];
        return Math.hypot(point.x - previous.x, point.y - previous.y);
    });
    return segmentLengths.some((length) => length > 0) ? { segmentLengths, waypoints } : null;
}

function serializeWaypoint(point) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const result = { x, y };
    for (const key of ["action", "depth", "elevation", "height", "level", "shape", "width"]) {
        if (point[key] !== undefined && point[key] !== null) result[key] = point[key];
    }
    result.checkpoint = Boolean(point.checkpoint);
    result.explicit = Boolean(point.explicit);
    result.snapped = Boolean(point.snapped);
    return result;
}

function distinctConsecutiveWaypoints(waypoints) {
    return waypoints.filter((point, index) => index === 0 || !samePosition(point, waypoints[index - 1]));
}

function samePosition(left, right) {
    return left?.x === right?.x && left?.y === right?.y
        && Number(left?.elevation ?? 0) === Number(right?.elevation ?? 0);
}

export function tokenReachedWaypoint(token, waypoint) {
    if (!token || !waypoint || Number(token.x) !== Number(waypoint.x)
        || Number(token.y) !== Number(waypoint.y)) return false;
    return waypoint.elevation === undefined
        || Number(token.elevation ?? 0) === Number(waypoint.elevation);
}
