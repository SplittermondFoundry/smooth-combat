export function linkMatchesCombatant(link, combatant) {
    if (!link || !combatant) return false;
    const tokenUuid = combatant.token?.uuid ?? combatant.tokenUuid ?? null;
    const actorUuid = combatant.actor?.uuid ?? combatant.actorUuid ?? null;
    const actorId = combatant.actor?.id ?? combatant.actorId ?? null;
    if (link.tokenUuid && tokenUuid) return link.tokenUuid === tokenUuid;
    if (link.actorUuid && actorUuid) return link.actorUuid === actorUuid;
    return Boolean(link.actorId && actorId && link.actorId === actorId);
}

export function uniqueTokensByReference(tokens) {
    const references = new Set();
    return Array.from(tokens ?? []).filter((token) => {
        const reference = token?.uuid ?? token?.id ?? null;
        if (!reference || references.has(reference)) return false;
        references.add(reference);
        return true;
    });
}

export function normalizeUserTokenLinks(value, fallbackUserId = null) {
    if (!value || typeof value !== "object") return {};

    const normalized = Object.fromEntries(Object.entries(value).map(([userId, storedLinks]) => {
        const links = (Array.isArray(storedLinks) ? storedLinks : [storedLinks])
            .filter((link) => link && typeof link === "object")
            .filter((link) => link.tokenUuid || link.actorUuid || link.actorId)
            .map((link) => ({ ...link }));
        return [userId, links];
    }));
    const result = Object.fromEntries(Object.keys(normalized).map((userId) => [userId, []]));
    const entries = Object.entries(normalized).sort(([leftId], [rightId]) => {
        if (!fallbackUserId) return 0;
        if (leftId === fallbackUserId) return 1;
        if (rightId === fallbackUserId) return -1;
        return 0;
    });
    const claimed = new Set();
    for (const [userId, links] of entries) {
        for (const link of links) {
            const key = link.tokenUuid
                ? `token:${link.tokenUuid}`
                : link.actorUuid
                    ? `actor:${link.actorUuid}`
                    : `actor-id:${link.actorId}`;
            if (claimed.has(key)) continue;
            claimed.add(key);
            result[userId].push(link);
        }
    }
    return result;
}

export function replaceManagedUserTokenLinks(value, managedTokenUuids, replacementsByUser, fallbackUserId = null) {
    const current = normalizeUserTokenLinks(value, fallbackUserId);
    const managed = new Set(Array.from(managedTokenUuids ?? []).filter((uuid) => typeof uuid === "string" && uuid));
    const replacements = replacementsByUser && typeof replacementsByUser === "object" ? replacementsByUser : {};
    const userIds = new Set([...Object.keys(current), ...Object.keys(replacements)]);
    const merged = Object.fromEntries(Array.from(userIds, (userId) => [
        userId,
        (current[userId] ?? []).filter((link) => !link.tokenUuid || !managed.has(link.tokenUuid)),
    ]));

    for (const [userId, links] of Object.entries(replacements)) {
        merged[userId] ??= [];
        for (const link of Array.isArray(links) ? links : []) {
            if (!link?.tokenUuid || !managed.has(link.tokenUuid)) continue;
            merged[userId].push({ ...link });
        }
    }
    return normalizeUserTokenLinks(merged, fallbackUserId);
}

export function isRedundantDeletedTokenLink(userId, link, tokens, actorUserLinks = {}) {
    if (typeof userId !== "string" || !userId || typeof link?.tokenUuid !== "string") return false;
    const sceneMatch = /^Scene\.([^.]+)\.Token\.[^.]+$/.exec(link.tokenUuid);
    if (!sceneMatch) return false;
    const actorUuid = actorLinkUuid(link.actorUuid, link.actorId);
    if (!actorUuid) return false;
    if (actorUserLinks?.[actorUuid] === userId) return true;
    return Array.from(tokens ?? []).some((token) =>
        token?.uuid !== link.tokenUuid
        && token?.sceneId === sceneMatch[1]
        && token?.actorUuid === actorUuid
        && token?.effectiveUserId === userId
    );
}

export function normalizeActorUserLinks(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
        .filter(([actorUuid, userId]) =>
            typeof actorUuid === "string"
            && actorUuid.length > 0
            && actorUuid !== "__proto__"
            && actorUuid !== "constructor"
            && typeof userId === "string"
            && userId.length > 0
        ));
}

export function actorLinkUuid(actorUuid, actorId = null) {
    if (typeof actorUuid === "string" && actorUuid.startsWith("Actor.")) return actorUuid;
    if (actorId) return `Actor.${actorId}`;
    const embeddedActor = typeof actorUuid === "string" ? /\.Actor\.([^.]+)$/.exec(actorUuid) : null;
    return embeddedActor ? `Actor.${embeddedActor[1]}` : actorUuid ?? "";
}

export function normalizeSearchText(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLocaleLowerCase("de")
        .trim();
}

export function normalizeTargetReferences(values) {
    const references = new Set();
    for (const value of values ?? []) {
        const reference = typeof value === "string"
            ? value
            : value?.document?.uuid ?? value?.uuid ?? value?.id ?? null;
        if (reference) references.add(reference);
    }
    return Array.from(references);
}
