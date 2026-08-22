import { services } from "../../core/services.js";

import {
    escapeAttr,
    escapeHtml,
    t,
} from "../../shared/values.js";

export const QUICK_TARGET_STRUCTURE_THRESHOLD = 8;

export function buildQuickTargets(context) {
    const candidates = services.getTargetSceneTokens(context.combat)
        .filter((token) => token.uuid !== context.token?.uuid);
    const labels = quickTargetLabels(candidates);
    const selected = new Set(context.targets.map((token) => token.uuid));
    const primaryTargetUuid = context.target?.uuid;
    const ordered = orderQuickTargetCandidates(candidates, selected, primaryTargetUuid);
    const structured = candidates.length > QUICK_TARGET_STRUCTURE_THRESHOLD;
    const content = structured
        ? buildStructuredTargets(context, ordered, { labels, selected, primaryTargetUuid })
        : buildFlatTargets(ordered, { labels, selected, primaryTargetUuid });
    const label = t("SMOOTHER_FIGHT.HUD.QuickTarget");
    return `<details class="sf-quick-targets${structured ? " is-structured" : ""}">
        <summary title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"><i class="fa-solid fa-crosshairs" aria-hidden="true"></i><span>${escapeHtml(label)}</span><i class="fa-solid fa-chevron-down sf-chevron" aria-hidden="true"></i></summary>
        <div class="sf-quick-target-popover">${content}</div>
    </details>`;
}

export function bindQuickTargetSearch(root) {
    for (const input of root.querySelectorAll("[data-sf-quick-target-search]")) {
        const popover = input.closest(".sf-quick-target-popover");
        const rows = Array.from(popover?.querySelectorAll("[data-sf-quick-target-row]") ?? []);
        const actorGroups = Array.from(popover?.querySelectorAll("[data-sf-quick-target-actor-group]") ?? []);
        const groups = Array.from(popover?.querySelectorAll("[data-sf-quick-target-group]") ?? []);
        const filters = Array.from(popover?.querySelectorAll("[data-sf-quick-target-filter]") ?? []);
        const empty = popover?.querySelector("[data-sf-quick-target-empty]");
        let actorKind = "all";
        const applyFilters = () => {
            const query = String(input.value ?? "").trim().toLocaleLowerCase();
            let visibleCount = 0;
            for (const row of rows) {
                const matchesSearch = !query || String(row.dataset.sfSearch ?? "").includes(query);
                const matchesKind = actorKind === "all" || row.dataset.sfActorKind === actorKind;
                const visible = matchesSearch && matchesKind;
                row.hidden = !visible;
                if (visible) visibleCount += 1;
            }
            for (const group of actorGroups) {
                group.hidden = !Array.from(group.querySelectorAll("[data-sf-quick-target-row]"))
                    .some((row) => !row.hidden);
            }
            for (const group of groups) {
                group.hidden = !Array.from(group.querySelectorAll("[data-sf-quick-target-row]"))
                    .some((row) => !row.hidden);
            }
            if (empty) empty.hidden = visibleCount > 0;
        };
        input.addEventListener("input", applyFilters);
        for (const filter of filters) {
            filter.addEventListener("click", () => {
                actorKind = filter.dataset.sfQuickTargetFilter ?? "all";
                filters.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === filter)));
                applyFilters();
            });
        }
    }
}

export function quickTargetLabels(tokens) {
    const names = new Map(tokens.map((token) => [token.uuid, tokenDisplayName(token)]));
    const totals = new Map();
    for (const name of names.values()) {
        const key = name.toLocaleLowerCase();
        totals.set(key, (totals.get(key) ?? 0) + 1);
    }
    const occurrences = new Map();
    return new Map(tokens.map((token) => {
        const name = names.get(token.uuid);
        const key = name.toLocaleLowerCase();
        const total = totals.get(key) ?? 1;
        const occurrence = (occurrences.get(key) ?? 0) + 1;
        occurrences.set(key, occurrence);
        return [token.uuid, total > 1 ? `${name} · ${occurrence}/${total}` : name];
    }));
}

export function quickTargetSearchValue(token) {
    return [token?.name, token?.actor?.name]
        .map((name) => String(name ?? "").trim())
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
}

export function quickTargetActorKind(token) {
    return token?.actor?.type === "character" ? "character" : "npc";
}

export function orderQuickTargetCandidates(candidates, selected, primaryTargetUuid) {
    return candidates.map((token, index) => ({
        token,
        index,
        rank: token.uuid === primaryTargetUuid ? 0 : selected.has(token.uuid) ? 1 : 2,
    })).sort((left, right) => left.rank - right.rank || left.index - right.index)
        .map(({ token }) => token);
}

function buildFlatTargets(candidates, state) {
    return candidates.length
        ? candidates.map((token) => buildQuickTargetRow(token, state)).join("")
        : `<p>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoCombatants"))}</p>`;
}

function buildStructuredTargets(context, candidates, state) {
    const combatUuids = combatTokenUuids(context.combat);
    const inCombat = candidates.filter((token) => combatUuids.has(token.uuid));
    const otherScene = candidates.filter((token) => !combatUuids.has(token.uuid));
    const characterCount = candidates.filter((token) => quickTargetActorKind(token) === "character").length;
    const npcCount = candidates.length - characterCount;
    const searchLabel = t("SMOOTHER_FIGHT.HUD.TargetSearch");
    return `<label class="sf-quick-target-search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="search" data-sf-quick-target-search autocomplete="off" spellcheck="false" aria-label="${escapeAttr(searchLabel)}" placeholder="${escapeAttr(t("SMOOTHER_FIGHT.HUD.TargetSearchPlaceholder"))}">
    </label>
    <div class="sf-quick-target-filters" role="group" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.HUD.TargetTypeFilter"))}">
        ${buildTargetFilter("all", t("SMOOTHER_FIGHT.HUD.AllTargets"), candidates.length, true)}
        ${buildTargetFilter("character", t("SMOOTHER_FIGHT.HUD.CharacterTargets"), characterCount)}
        ${buildTargetFilter("npc", t("SMOOTHER_FIGHT.HUD.NpcTargets"), npcCount)}
    </div>
    <div class="sf-quick-target-results">
        ${buildTargetGroup("combat", t("SMOOTHER_FIGHT.HUD.TargetsInCombat"), inCombat, state)}
        ${buildTargetGroup("scene", t("SMOOTHER_FIGHT.HUD.OtherSceneTargets"), otherScene, state)}
        <p class="sf-quick-target-empty" data-sf-quick-target-empty hidden>${escapeHtml(t("SMOOTHER_FIGHT.HUD.NoMatchingTargets"))}</p>
    </div>`;
}

function buildTargetGroup(id, label, tokens, state) {
    if (!tokens.length) return "";
    const characters = tokens.filter((token) => quickTargetActorKind(token) === "character");
    const npcs = tokens.filter((token) => quickTargetActorKind(token) === "npc");
    return `<section class="sf-quick-target-group" data-sf-quick-target-group="${id}">
        <h4><span>${escapeHtml(label)}</span><b>${tokens.length}</b></h4>
        ${buildActorGroup("character", t("SMOOTHER_FIGHT.HUD.CharacterTargets"), characters, state)}
        ${buildActorGroup("npc", t("SMOOTHER_FIGHT.HUD.NpcTargets"), npcs, state)}
    </section>`;
}

function buildActorGroup(kind, label, tokens, state) {
    if (!tokens.length) return "";
    return `<div class="sf-quick-target-actor-group" data-sf-quick-target-actor-group="${kind}">
        <h5><span>${escapeHtml(label)}</span><b>${tokens.length}</b></h5>
        ${tokens.map((token) => buildQuickTargetRow(token, state)).join("")}
    </div>`;
}

function buildTargetFilter(kind, label, count, pressed = false) {
    return `<button type="button" data-sf-quick-target-filter="${kind}" aria-pressed="${pressed}"${count ? "" : " disabled"}><span>${escapeHtml(label)}</span><b>${count}</b></button>`;
}

function buildQuickTargetRow(token, { labels, selected, primaryTargetUuid }) {
    const isSelected = selected.has(token.uuid);
    const isPrimary = token.uuid === primaryTargetUuid;
    const name = labels.get(token.uuid) ?? tokenDisplayName(token);
    const status = isSelected
        ? `<small>${escapeHtml(t(isPrimary ? "SMOOTHER_FIGHT.HUD.PrimaryTarget" : "SMOOTHER_FIGHT.HUD.AdditionalTarget"))}</small>`
        : "";
    return `<div class="sf-quick-target-row ${isPrimary ? "is-primary" : isSelected ? "is-selected" : ""}" data-sf-quick-target-row data-sf-actor-kind="${quickTargetActorKind(token)}" data-sf-search="${escapeAttr(quickTargetSearchValue(token))}">
        <button type="button" data-sf-action="set-target" data-token-uuid="${escapeAttr(token.uuid)}" class="${isSelected ? "is-current" : ""} ${isPrimary ? "is-primary" : ""}" aria-pressed="${isSelected}" title="${escapeAttr(isPrimary ? t("SMOOTHER_FIGHT.HUD.PrimaryTarget") : t("SMOOTHER_FIGHT.HUD.MakePrimaryTarget", { target: name }))}">
            <img src="${escapeAttr(token.texture?.src ?? token.actor?.img ?? "icons/svg/mystery-man.svg")}" alt=""><span><b>${escapeHtml(name)}</b>${status}</span>
            ${isSelected ? `<i class="fa-solid ${isPrimary ? "fa-bullseye" : "fa-check"}"></i>` : ""}
        </button>
        ${isSelected ? `<button type="button" class="sf-quick-target-remove" data-sf-action="remove-target" data-token-uuid="${escapeAttr(token.uuid)}" title="${escapeAttr(t("SMOOTHER_FIGHT.HUD.RemoveTarget", { target: name }))}" aria-label="${escapeAttr(t("SMOOTHER_FIGHT.HUD.RemoveTarget", { target: name }))}"><i class="fa-solid fa-xmark"></i></button>` : ""}
    </div>`;
}

function combatTokenUuids(combat) {
    return new Set(Array.from(combat?.combatants ?? []).map((combatant) => {
        const token = combatant.token?.document ?? combatant.token ?? services.resolveCombatantToken(combatant);
        return services.tokenUuid(token);
    }).filter(Boolean));
}

function tokenDisplayName(token) {
    return String(token?.name ?? "").trim() || String(token?.actor?.name ?? "").trim() || "–";
}
