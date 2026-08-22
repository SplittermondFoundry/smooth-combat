import {
    actorAssignmentUuid,
    assignmentSourceIcon,
    assignmentSourceLabel,
} from "./assignments.js";

import { services } from "../../core/services.js";

import {
    actorLinkUuid,
    isRedundantDeletedTokenLink,
    normalizeActorUserLinks,
    normalizeSearchText,
    normalizeUserTokenLinks,
    replaceManagedUserTokenLinks,
} from "../../combat-rules.js";

import {
    MODULE_ID,
} from "../../core/constants.js";

import {
    getSetting,
    sortByName,
    t,
} from "../../shared/values.js";

export function registerSettingsMenu() {
    const Base = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2);

    class UserTokenLinksApplication extends Base {
        static DEFAULT_OPTIONS = {
            id: "smoother-fight-user-token-links",
            classes: ["smoother-fight", "sf-settings"],
            tag: "div",
            position: { width: 940, height: 780 },
            window: {
                title: "SMOOTHER_FIGHT.Settings.LinksTitle",
                icon: "fa-solid fa-link",
                minimizable: true,
                resizable: true,
            },
        };

        static PARTS = {
            form: {
                template: `modules/${MODULE_ID}/templates/user-token-links.hbs`,
            },
        };

        async _prepareContext(options) {
            const context = await super._prepareContext(options);
            const primaryGmId = getSetting("primaryGmId", "");
            const links = normalizeUserTokenLinks(getSetting("userTokenLinks", {}), primaryGmId);
            const actorLinks = normalizeActorUserLinks(getSetting("actorUserLinks", {}));
            const allUsers = Array.from(game.users ?? []);
            const validUserIds = new Set(allUsers.map((user) => user.id));
            const validPrimaryGm = allUsers.find((user) => user.id === primaryGmId && user.isGM) ?? null;
            const explicitOwnerByToken = new Map();
            const legacyOwnerByActor = new Map();
            for (const [userId, userLinks] of Object.entries(links)) {
                for (const link of userLinks) {
                    if (link.tokenUuid) explicitOwnerByToken.set(link.tokenUuid, userId);
                    else {
                        const actorUuid = actorLinkUuid(link.actorUuid, link.actorId);
                        if (actorUuid) legacyOwnerByActor.set(actorUuid, userId);
                    }
                }
            }
            const displayActorLinks = {
                ...Object.fromEntries(legacyOwnerByActor),
                ...actorLinks,
            };
            const sceneTokens = services.getAllSceneTokens();
            const tokenNameTotals = new Map();
            for (const token of sceneTokens) {
                const key = `${token.parent?.id ?? ""}:${normalizeSearchText(token.name)}`;
                tokenNameTotals.set(key, (tokenNameTotals.get(key) ?? 0) + 1);
            }
            const tokenNameIndexes = new Map();
            let ambiguousOwnerCount = 0;
            let missingUserCount = 0;
            const warningItems = [];
            const tokens = sceneTokens.map((token) => {
                const scene = token.parent ?? game.scenes?.get?.(token.parent?.id);
                const actorUuid = actorAssignmentUuid(token.actor, token.actorId);
                const nameKey = `${scene?.id ?? ""}:${normalizeSearchText(token.name)}`;
                const nameIndex = (tokenNameIndexes.get(nameKey) ?? 0) + 1;
                tokenNameIndexes.set(nameKey, nameIndex);
                const duplicateName = (tokenNameTotals.get(nameKey) ?? 0) > 1;
                const displayName = duplicateName ? `${token.name} #${nameIndex}` : token.name;
                const storedDirectUserId = explicitOwnerByToken.get(token.uuid) ?? null;
                const directUserId = validUserIds.has(storedDirectUserId) ? storedDirectUserId : null;
                if (storedDirectUserId && !directUserId) {
                    missingUserCount += 1;
                    warningItems.push({
                        typeClass: "is-missing-user",
                        icon: "fa-solid fa-user-slash",
                        title: displayName,
                        context: t("SMOOTHER_FIGHT.Settings.WarningTokenContext", {
                            scene: scene?.name ?? t("SMOOTHER_FIGHT.Settings.UnknownScene"),
                            actor: token.actor?.name ?? "–",
                        }),
                        reason: t("SMOOTHER_FIGHT.Settings.MissingUserWarningDetail", { user: storedDirectUserId }),
                    });
                }
                const legacyUserId = validUserIds.has(legacyOwnerByActor.get(actorUuid)) ? legacyOwnerByActor.get(actorUuid) : null;
                const sheetUserId = validUserIds.has(displayActorLinks[actorUuid]) ? displayActorLinks[actorUuid] : null;
                const ownerUsers = allUsers.filter((user) => !user.isGM && token.actor?.testUserPermission?.(user, "OWNER"));
                const ownerUser = ownerUsers.find((user) => user.active) ?? ownerUsers[0] ?? null;
                const ownerAmbiguous = !legacyUserId && !sheetUserId && !validPrimaryGm && ownerUsers.length > 1;
                if (ownerAmbiguous) {
                    ambiguousOwnerCount += 1;
                    warningItems.push({
                        typeClass: "is-ambiguous-owner",
                        icon: "fa-solid fa-users",
                        title: displayName,
                        context: t("SMOOTHER_FIGHT.Settings.WarningTokenContext", {
                            scene: scene?.name ?? t("SMOOTHER_FIGHT.Settings.UnknownScene"),
                            actor: token.actor?.name ?? "–",
                        }),
                        reason: t("SMOOTHER_FIGHT.Settings.AmbiguousOwnerWarningDetail", {
                            owners: ownerUsers.map((user) => user.name).join(", "),
                        }),
                    });
                }
                const standardUserId = legacyUserId || sheetUserId || validPrimaryGm?.id || ownerUser?.id || null;
                const standardSource = legacyUserId || sheetUserId
                    ? "sheet"
                    : validPrimaryGm
                        ? "primary-gm"
                        : ownerUser
                            ? "owner"
                            : "unassigned";
                const effectiveUserId = directUserId || standardUserId;
                const source = directUserId ? "direct" : standardSource;
                const effectiveUser = allUsers.find((user) => user.id === effectiveUserId) ?? null;
                const standardUser = allUsers.find((user) => user.id === standardUserId) ?? null;
                return {
                    uuid: token.uuid,
                    actorUuid,
                    actorId: token.actorId ?? token.actor?.id ?? "",
                    actorName: token.actor?.name ?? "–",
                    img: token.texture?.src ?? token.actor?.img ?? "icons/svg/mystery-man.svg",
                    name: token.name,
                    displayName,
                    sceneId: scene?.id ?? "",
                    sceneName: scene?.name ?? t("SMOOTHER_FIGHT.Settings.UnknownScene"),
                    directUserId,
                    isDirect: Boolean(directUserId),
                    effectiveUserName: effectiveUser?.name ?? t("SMOOTHER_FIGHT.Settings.Unassigned"),
                    sourceLabel: assignmentSourceLabel(source),
                    sourceClass: `is-${source}`,
                    sourceIcon: assignmentSourceIcon(source),
                    standardLabel: t("SMOOTHER_FIGHT.Settings.StandardAssignment", {
                        owner: standardUser?.name ?? t("SMOOTHER_FIGHT.Settings.Unassigned"),
                        source: assignmentSourceLabel(standardSource),
                    }),
                    ownerUserId: ownerUser?.id ?? "",
                    ownerAmbiguous,
                    search: `${displayName} ${token.actor?.name ?? ""} ${scene?.name ?? ""}`,
                    users: allUsers.map((user) => ({
                        id: user.id,
                        name: user.name,
                        isGM: user.isGM,
                        selected: directUserId === user.id,
                    })),
                };
            }).sort((left, right) =>
                left.sceneName.localeCompare(right.sceneName, undefined, { sensitivity: "base" })
                || left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" })
            );
            const gms = allUsers.filter((user) => user.isGM).map((user) => ({
                id: user.id,
                name: user.name,
                selected: user.id === primaryGmId,
            }));
            const actors = Array.from(game.actors ?? [])
                .filter((actor) => ["character", "npc"].includes(actor.type))
                .sort(sortByName)
                .map((actor) => ({
                    uuid: actor.uuid,
                    name: actor.name,
                    img: actor.img ?? "icons/svg/mystery-man.svg",
                    type: actor.type,
                    typeLabel: actor.type === "npc"
                        ? t("SMOOTHER_FIGHT.Settings.NpcSheet")
                        : t("SMOOTHER_FIGHT.Settings.CharacterSheet"),
                    tokenCount: tokens.filter((token) => token.actorUuid === actor.uuid).length,
                    users: allUsers.map((user) => ({
                        id: user.id,
                        name: user.name,
                        isGM: user.isGM,
                        selected: displayActorLinks[actor.uuid] === user.id,
                    })),
                }));
            const actorGroups = [
                {
                    id: "character",
                    label: t("SMOOTHER_FIGHT.Settings.PlayerCharacters"),
                    icon: "fa-solid fa-user-shield",
                    open: true,
                    actors: actors.filter((actor) => actor.type === "character"),
                },
                {
                    id: "npc",
                    label: t("SMOOTHER_FIGHT.Settings.Npcs"),
                    icon: "fa-solid fa-dragon",
                    open: false,
                    actors: actors.filter((actor) => actor.type === "npc"),
                },
            ].map((group) => ({ ...group, count: group.actors.length }));
            const users = allUsers.map((user) => ({
                id: user.id,
                name: user.name,
                active: user.active,
                isGM: user.isGM,
                sheetCount: actors.filter((actor) => displayActorLinks[actor.uuid] === user.id).length,
                directTokenCount: tokens.filter((token) => token.directUserId === user.id).length,
                effectiveTokenCount: tokens.filter((token) => {
                    if (token.directUserId) return token.directUserId === user.id;
                    const actorUserId = displayActorLinks[token.actorUuid];
                    if (actorUserId) return actorUserId === user.id;
                    if (validPrimaryGm) return validPrimaryGm.id === user.id;
                    return token.ownerUserId === user.id;
                }).length,
            }));
            const knownTokenUuids = new Set(tokens.map((token) => token.uuid));
            const unresolvedLinks = Object.entries(links).flatMap(([userId, userLinks]) => userLinks
                .filter((link) => link.tokenUuid && !knownTokenUuids.has(link.tokenUuid))
                .map((link) => ({ userId, link })));
            const cleanupTokenUuids = [];
            const unresolvedWarnings = [];
            for (const unresolvedLink of unresolvedLinks) {
                if (isRedundantDeletedTokenLink(unresolvedLink.userId, unresolvedLink.link, tokens, displayActorLinks)) {
                    cleanupTokenUuids.push(unresolvedLink.link.tokenUuid);
                } else unresolvedWarnings.push(unresolvedLink);
            }
            const unresolvedTokenCount = unresolvedWarnings.length;
            for (const { userId, link } of unresolvedWarnings) {
                const assignedUser = allUsers.find((user) => user.id === userId);
                const assignedUserLabel = assignedUser?.name
                    ?? t("SMOOTHER_FIGHT.Settings.MissingUserReference", { id: userId });
                const actorUuid = actorLinkUuid(link.actorUuid, link.actorId);
                const linkedActor = actors.find((actor) => actor.uuid === actorUuid) ?? null;
                warningItems.push({
                    typeClass: "is-unresolved-token",
                    icon: "fa-solid fa-link-slash",
                    title: link.label || t("SMOOTHER_FIGHT.Settings.UnknownStoredToken"),
                    context: t("SMOOTHER_FIGHT.Settings.StoredTokenReference", { reference: link.tokenUuid }),
                    reason: t("SMOOTHER_FIGHT.Settings.UnresolvedTokenWarningDetail", { user: assignedUserLabel }),
                    isUnresolvedToken: true,
                    tokenUuid: link.tokenUuid,
                    actorUuid,
                    assignedUserId: userId,
                    assignedUserLabel,
                    canOpenActor: Boolean(linkedActor),
                    canPromoteToSheet: Boolean(linkedActor && assignedUser),
                });
            }
            warningItems.sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: "base" }));
            const warningCount = ambiguousOwnerCount + missingUserCount + unresolvedTokenCount;
            const scenes = Array.from(game.scenes ?? []).map((scene) => ({
                id: scene.id,
                name: scene.name,
                count: tokens.filter((token) => token.sceneId === scene.id).length,
            })).filter((scene) => scene.count > 0).sort(sortByName);
            return {
                ...context,
                users,
                gms,
                actors,
                actorGroups,
                tokens,
                scenes,
                summary: {
                    sheetCount: actors.length,
                    assignedSheetCount: actors.filter((actor) => validUserIds.has(displayActorLinks[actor.uuid])).length,
                    tokenCount: tokens.length,
                    directTokenCount: tokens.filter((token) => token.isDirect).length,
                    warningCount,
                },
                warningItems,
                cleanupTokenUuids,
                cleanupTokenCount: cleanupTokenUuids.length,
                hasCleanupTokens: cleanupTokenUuids.length > 0,
                hasWarnings: warningCount > 0,
                hasActors: actors.length > 0,
                hasTokens: tokens.length > 0,
            };
        }

        async _onRender(context, options) {
            await super._onRender(context, options);
            const primaryGmSelect = this.element.querySelector('[data-role="primary-gm"]');
            const actorAssignmentSelects = () => Array.from(this.element.querySelectorAll('select[data-actor-uuid]'));
            const tokenAssignmentSelects = () => Array.from(this.element.querySelectorAll('select[data-token-uuid]'));
            const userName = (userId) => Array.from(game.users ?? []).find((user) => user.id === userId)?.name ?? t("SMOOTHER_FIGHT.Settings.Unassigned");
            const markDirty = () => this.element.querySelector('[data-role="assignment-dirty"]')?.removeAttribute("hidden");
            const cleanupTokenUuids = new Set(context.cleanupTokenUuids ?? []);
            const refreshWarningCount = () => {
                const warningItems = Array.from(this.element.querySelectorAll("[data-warning-item]"));
                const warningCount = warningItems.filter((item) => !item.classList.contains("is-pending-resolution")).length;
                const countOutput = this.element.querySelector('[data-role="warning-count"]');
                const summaryLabel = this.element.querySelector('[data-role="warning-summary-label"]');
                const summaryTile = this.element.querySelector('[data-role="warning-summary-tile"]');
                const warningPanel = this.element.querySelector('[data-role="assignment-warnings"]');
                if (countOutput) countOutput.textContent = String(warningCount);
                if (summaryLabel) summaryLabel.textContent = t("SMOOTHER_FIGHT.Settings.AssignmentsToCheck", { count: warningCount });
                summaryTile?.classList.toggle("has-warning", warningCount > 0);
                warningPanel?.classList.toggle("is-resolved", warningCount === 0);
            };
            const activateTab = (tabId) => {
                for (const button of this.element.querySelectorAll('[data-action="assignment-tab"]')) {
                    const active = button.dataset.tab === tabId;
                    button.classList.toggle("is-active", active);
                    button.setAttribute("aria-selected", String(active));
                }
                for (const panel of this.element.querySelectorAll('[data-tab-panel]')) panel.hidden = panel.dataset.tabPanel !== tabId;
            };
            for (const button of this.element.querySelectorAll('[data-action="assignment-tab"]')) {
                button.addEventListener("click", () => activateTab(button.dataset.tab));
            }
            activateTab("overview");
            const actorSearchInput = this.element.querySelector('[data-role="actor-search"]');
            const actorGroups = Array.from(this.element.querySelectorAll('[data-actor-group]'));
            const noSearchResults = this.element.querySelector('[data-role="no-actor-search-results"]');
            const openBeforeSearch = new Map();
            let searchActive = false;
            const refreshActorSearch = () => {
                const query = normalizeSearchText(actorSearchInput?.value);
                if (query && !searchActive) {
                    for (const group of actorGroups) openBeforeSearch.set(group.dataset.actorGroup, group.open);
                }
                let totalMatches = 0;
                for (const group of actorGroups) {
                    const rows = Array.from(group.querySelectorAll('[data-actor-row]'));
                    let visibleCount = 0;
                    for (const row of rows) {
                        const visible = !query || normalizeSearchText(row.dataset.search).includes(query);
                        row.hidden = !visible;
                        if (visible) visibleCount += 1;
                    }
                    totalMatches += visibleCount;
                    const count = group.querySelector('[data-role="actor-group-count"]');
                    if (count) count.textContent = query ? `${visibleCount}/${rows.length}` : String(rows.length);
                    group.hidden = Boolean(query && visibleCount === 0);
                    if (query && visibleCount > 0) group.open = true;
                    if (!query && searchActive) group.open = openBeforeSearch.get(group.dataset.actorGroup) ?? group.open;
                }
                if (noSearchResults) noSearchResults.hidden = !query || totalMatches > 0;
                searchActive = Boolean(query);
                if (!query) openBeforeSearch.clear();
            };
            actorSearchInput?.addEventListener("input", refreshActorSearch);
            const overviewRowPool = this.element.querySelector('[data-role="overview-row-pool"]');
            const overviewActorRows = Array.from(this.element.querySelectorAll("[data-overview-actor-row]"));
            const overviewTokenRows = Array.from(this.element.querySelectorAll("[data-overview-token-row]"));
            const overviewActorSelects = Array.from(this.element.querySelectorAll("select[data-overview-actor-uuid]"));
            const overviewTokenSelects = Array.from(this.element.querySelectorAll("select[data-overview-token-uuid]"));
            const moveOverviewRow = (row, destination) => {
                const target = destination ?? overviewRowPool;
                if (target && row.parentElement !== target) target.append(row);
            };
            const refreshOverviewAssignments = () => {
                for (const row of overviewActorRows) {
                    const actorUuid = row.dataset.overviewActorRow;
                    const actorSelect = actorAssignmentSelects().find((select) => select.dataset.actorUuid === actorUuid);
                    const userId = actorSelect?.value ?? "";
                    const overviewSelect = row.querySelector("select[data-overview-actor-uuid]");
                    if (overviewSelect) overviewSelect.value = userId;
                    moveOverviewRow(row, userId
                        ? this.element.querySelector(`[data-overview-sheets-for="${CSS.escape(userId)}"]`)
                        : null);
                }
                for (const row of overviewTokenRows) {
                    const tokenUuid = row.dataset.overviewTokenRow;
                    const tokenSelect = tokenAssignmentSelects().find((select) => select.dataset.tokenUuid === tokenUuid);
                    const tokenRow = tokenSelect?.closest("[data-token-row]");
                    if (!tokenSelect || !tokenRow) {
                        moveOverviewRow(row, null);
                        continue;
                    }
                    const actorUserId = actorAssignmentSelects()
                        .find((select) => select.dataset.actorUuid === tokenRow.dataset.actorUuid)?.value ?? "";
                    const primaryGmId = primaryGmSelect?.value ?? "";
                    const standardUserId = actorUserId || primaryGmId || tokenRow.dataset.ownerUserId || "";
                    const standardSource = actorUserId ? "sheet" : primaryGmId ? "primary-gm" : tokenRow.dataset.ownerUserId ? "owner" : "unassigned";
                    const directUserId = tokenSelect.value;
                    const effectiveUserId = directUserId || standardUserId;
                    const source = directUserId ? "direct" : standardSource;
                    const overviewSelect = row.querySelector("select[data-overview-token-uuid]");
                    if (overviewSelect) {
                        overviewSelect.value = directUserId;
                        const standardOption = overviewSelect.querySelector('option[value=""]');
                        if (standardOption) standardOption.textContent = t("SMOOTHER_FIGHT.Settings.StandardAssignment", {
                            owner: userName(standardUserId),
                            source: assignmentSourceLabel(standardSource),
                        });
                    }
                    const sourceBadge = row.querySelector('[data-role="overview-token-source"]');
                    if (sourceBadge) {
                        sourceBadge.className = `sf-assignment-source is-${source}`;
                        const sourceIcon = sourceBadge.querySelector("i");
                        const sourceLabel = sourceBadge.querySelector("span");
                        if (sourceIcon) sourceIcon.className = assignmentSourceIcon(source);
                        if (sourceLabel) sourceLabel.textContent = assignmentSourceLabel(source);
                    }
                    const destinationUserId = row.dataset.overviewKind === "direct" ? directUserId : effectiveUserId;
                    const destinationRole = row.dataset.overviewKind === "direct"
                        ? "data-overview-direct-tokens-for"
                        : "data-overview-effective-tokens-for";
                    moveOverviewRow(row, destinationUserId
                        ? this.element.querySelector(`[${destinationRole}="${CSS.escape(destinationUserId)}"]`)
                        : null);
                }
                for (const card of this.element.querySelectorAll("[data-user-summary]")) {
                    const sheetList = card.querySelector("[data-overview-sheets-for]");
                    const directList = card.querySelector("[data-overview-direct-tokens-for]");
                    const effectiveList = card.querySelector("[data-overview-effective-tokens-for]");
                    const sections = [
                        ["sheets", sheetList, card.querySelector('[data-role="overview-sheet-count"]')],
                        ["direct", directList, card.querySelector('[data-role="overview-direct-count"]')],
                        ["effective", effectiveList, card.querySelector('[data-role="overview-effective-count"]')],
                    ];
                    for (const [kind, list, countOutput] of sections) {
                        const count = list?.children.length ?? 0;
                        if (countOutput) countOutput.textContent = String(count);
                        const empty = card.querySelector(`[data-overview-empty="${kind}"]`);
                        if (empty) empty.hidden = count > 0;
                    }
                }
            };
            const refreshTokenRows = () => {
                const primaryGmId = primaryGmSelect?.value ?? "";
                for (const select of tokenAssignmentSelects()) {
                    const row = select.closest("[data-token-row]");
                    if (!row) continue;
                    const actorOwnerId = actorAssignmentSelects().find((candidate) => candidate.dataset.actorUuid === row.dataset.actorUuid)?.value ?? "";
                    const standardUserId = actorOwnerId || primaryGmId || row.dataset.ownerUserId || "";
                    const standardSource = actorOwnerId ? "sheet" : primaryGmId ? "primary-gm" : row.dataset.ownerUserId ? "owner" : "unassigned";
                    const directUserId = select.value;
                    const source = directUserId ? "direct" : standardSource;
                    const sourceBadge = row.querySelector('[data-role="token-source"]');
                    const sourceIcon = sourceBadge?.querySelector('[data-role="token-source-icon"]');
                    const sourceLabel = sourceBadge?.querySelector('[data-role="token-source-label"]');
                    const effectiveUser = row.querySelector('[data-role="token-effective-user"]');
                    const standardOption = select.querySelector('option[value=""]');
                    if (standardOption) standardOption.textContent = t("SMOOTHER_FIGHT.Settings.StandardAssignment", {
                        owner: userName(standardUserId),
                        source: assignmentSourceLabel(standardSource),
                    });
                    if (sourceBadge) {
                        sourceBadge.className = `sf-assignment-source is-${source}`;
                    }
                    if (sourceIcon) sourceIcon.className = assignmentSourceIcon(source);
                    if (sourceLabel) sourceLabel.textContent = assignmentSourceLabel(source);
                    if (effectiveUser) effectiveUser.textContent = userName(directUserId || standardUserId);
                    row.dataset.isDirect = String(Boolean(directUserId));
                }
                refreshOverviewAssignments();
                refreshTokenFilter();
                refreshCounts();
            };
            const tokenSearchInput = this.element.querySelector('[data-role="token-search"]');
            const tokenSceneSelect = this.element.querySelector('[data-role="token-scene"]');
            const showAllTokens = this.element.querySelector('[data-role="show-all-tokens"]');
            const noTokenResults = this.element.querySelector('[data-role="no-token-results"]');
            function refreshTokenFilter() {
                const query = normalizeSearchText(tokenSearchInput?.value);
                const sceneId = tokenSceneSelect?.value ?? "";
                const showAll = Boolean(showAllTokens?.checked);
                let visible = 0;
                for (const row of this.element.querySelectorAll('[data-token-row]')) {
                    const matchesSearch = !query || normalizeSearchText(row.dataset.search).includes(query);
                    const matchesScene = !sceneId || row.dataset.sceneId === sceneId;
                    const matchesMode = showAll || row.dataset.isDirect === "true";
                    row.hidden = !(matchesSearch && matchesScene && matchesMode);
                    if (!row.hidden) visible += 1;
                }
                if (noTokenResults) noTokenResults.hidden = visible > 0;
                const count = this.element.querySelector('[data-role="visible-token-count"]');
                if (count) count.textContent = String(visible);
            }
            refreshTokenFilter = refreshTokenFilter.bind(this);
            const refreshCounts = () => {
                const assignedSheets = actorAssignmentSelects().filter((select) => select.value).length;
                const directTokens = tokenAssignmentSelects().filter((select) => select.value).length;
                const effectiveTokenCounts = new Map(Array.from(game.users ?? [], (user) => [user.id, 0]));
                const primaryGmId = primaryGmSelect?.value ?? "";
                for (const select of tokenAssignmentSelects()) {
                    const row = select.closest("[data-token-row]");
                    const actorUserId = actorAssignmentSelects().find((candidate) => candidate.dataset.actorUuid === row?.dataset.actorUuid)?.value ?? "";
                    const userId = select.value || actorUserId || primaryGmId || row?.dataset.ownerUserId || "";
                    if (userId) effectiveTokenCounts.set(userId, (effectiveTokenCounts.get(userId) ?? 0) + 1);
                }
                const assignedSheetCount = this.element.querySelector('[data-role="assigned-sheet-count"]');
                const directTokenCount = this.element.querySelector('[data-role="direct-token-count"]');
                if (assignedSheetCount) assignedSheetCount.textContent = String(assignedSheets);
                if (directTokenCount) directTokenCount.textContent = String(directTokens);
                for (const card of this.element.querySelectorAll('[data-user-summary]')) {
                    const userId = card.dataset.userSummary;
                    const sheetCount = actorAssignmentSelects().filter((select) => select.value === userId).length;
                    const tokenCount = tokenAssignmentSelects().filter((select) => select.value === userId).length;
                    const sheetOutput = card.querySelector('[data-role="user-sheet-count"]');
                    const tokenOutput = card.querySelector('[data-role="user-token-count"]');
                    const effectiveOutput = card.querySelector('[data-role="user-effective-count"]');
                    if (sheetOutput) sheetOutput.textContent = String(sheetCount);
                    if (tokenOutput) tokenOutput.textContent = String(tokenCount);
                    if (effectiveOutput) effectiveOutput.textContent = String(effectiveTokenCounts.get(userId) ?? 0);
                }
            };
            tokenSearchInput?.addEventListener("input", refreshTokenFilter);
            tokenSceneSelect?.addEventListener("change", refreshTokenFilter);
            showAllTokens?.addEventListener("change", refreshTokenFilter);
            for (const select of actorAssignmentSelects()) select.addEventListener("change", () => {
                markDirty();
                refreshTokenRows();
            });
            for (const select of tokenAssignmentSelects()) select.addEventListener("change", () => {
                markDirty();
                refreshTokenRows();
            });
            for (const select of overviewActorSelects) select.addEventListener("change", () => {
                const actorSelect = actorAssignmentSelects()
                    .find((candidate) => candidate.dataset.actorUuid === select.dataset.overviewActorUuid);
                if (!actorSelect) return;
                actorSelect.value = select.value;
                markDirty();
                refreshTokenRows();
            });
            for (const select of overviewTokenSelects) select.addEventListener("change", () => {
                const tokenSelect = tokenAssignmentSelects()
                    .find((candidate) => candidate.dataset.tokenUuid === select.dataset.overviewTokenUuid);
                if (!tokenSelect) return;
                tokenSelect.value = select.value;
                markDirty();
                refreshTokenRows();
            });
            primaryGmSelect?.addEventListener("change", () => {
                markDirty();
                refreshTokenRows();
            });
            for (const button of this.element.querySelectorAll('[data-action="open-warning-actor"], [data-action="open-overview-actor"]')) {
                button.addEventListener("click", async () => {
                    const actor = await fromUuid(button.dataset.actorUuid).catch(() => null);
                    if (!actor?.sheet) {
                        ui.notifications.warn(t("SMOOTHER_FIGHT.Settings.WarningActorUnavailable"));
                        return;
                    }
                    actor.sheet.render({ force: true });
                });
            }
            for (const button of this.element.querySelectorAll('[data-action="resolve-warning"]')) {
                button.addEventListener("click", () => {
                    const row = button.closest("[data-warning-item]");
                    const tokenUuid = button.dataset.tokenUuid;
                    if (!row || !tokenUuid) return;
                    if (button.dataset.resolution === "promote") {
                        const actorSelect = actorAssignmentSelects()
                            .find((select) => select.dataset.actorUuid === button.dataset.actorUuid);
                        if (!actorSelect) {
                            ui.notifications.warn(t("SMOOTHER_FIGHT.Settings.WarningActorUnavailable"));
                            return;
                        }
                        actorSelect.value = button.dataset.userId ?? "";
                    }
                    cleanupTokenUuids.add(tokenUuid);
                    row.classList.add("is-pending-resolution");
                    const pending = row.querySelector('[data-role="warning-pending"]');
                    if (pending) {
                        pending.textContent = button.dataset.resolution === "promote"
                            ? t("SMOOTHER_FIGHT.Settings.PromoteWarningPending", { user: button.dataset.userLabel ?? "" })
                            : t("SMOOTHER_FIGHT.Settings.RemoveWarningPending");
                        pending.removeAttribute("hidden");
                    }
                    markDirty();
                    refreshTokenRows();
                    refreshWarningCount();
                });
            }
            refreshTokenRows();
            if (cleanupTokenUuids.size > 0) markDirty();
            this.element.querySelector('[data-action="save-links"]')?.addEventListener("click", async () => {
                const primaryGmId = primaryGmSelect?.value ?? "";
                const actorLinks = Object.fromEntries(actorAssignmentSelects()
                    .filter((select) => select.value)
                    .map((select) => [select.dataset.actorUuid, select.value]));
                const replacements = Object.fromEntries(Array.from(game.users ?? [], (user) => [user.id, []]));
                const managedTokenUuids = new Set(cleanupTokenUuids);
                for (const select of tokenAssignmentSelects()) {
                    managedTokenUuids.add(select.dataset.tokenUuid);
                    if (!select.value) continue;
                    replacements[select.value] ??= [];
                    replacements[select.value].push({
                        tokenUuid: select.dataset.tokenUuid,
                        actorUuid: select.dataset.actorUuid,
                        actorId: select.dataset.actorId || null,
                        label: select.dataset.tokenLabel || select.dataset.tokenUuid,
                    });
                }
                const mergedLinks = replaceManagedUserTokenLinks(
                    getSetting("userTokenLinks", {}),
                    managedTokenUuids,
                    replacements,
                    primaryGmId
                );
                const managedActorUuids = new Set(actorAssignmentSelects().map((select) => select.dataset.actorUuid));
                const links = Object.fromEntries(Object.entries(mergedLinks).map(([userId, userLinks]) => [
                    userId,
                    userLinks.filter((link) => link.tokenUuid || !managedActorUuids.has(actorLinkUuid(link.actorUuid, link.actorId))),
                ]));
                await game.settings.set(MODULE_ID, "actorUserLinks", actorLinks);
                await game.settings.set(MODULE_ID, "primaryGmId", primaryGmId);
                await game.settings.set(MODULE_ID, "userTokenLinks", links);
                ui.notifications.info(t("SMOOTHER_FIGHT.Settings.Saved"));
                this.close();
            });
        }
    }

    game.settings.registerMenu(MODULE_ID, "userTokenLinksMenu", {
        name: "SMOOTHER_FIGHT.Settings.LinksMenuName",
        label: "SMOOTHER_FIGHT.Settings.LinksMenuLabel",
        hint: "SMOOTHER_FIGHT.Settings.LinksMenuHint",
        icon: "fa-solid fa-link",
        type: UserTokenLinksApplication,
        restricted: true,
    });
}
