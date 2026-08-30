/**
 * Foundry-VTT-Skriptmakro fuer Splittermond.
 *
 * Entfernt aus allen Zaubereffekten namens "diverse Modifikatoren" ausschliesslich
 * Modifier-Klauseln mit emphasis="Gegner kniend" oder
 * emphasis="Gegner liegend". Andere Klauseln bleiben unveraendert.
 *
 * Das Makro beruecksichtigt Welt-Akteure sowie synthetische Akteure nicht
 * verknuepfter Token auf allen Szenen. Vor der Aenderung zeigt es eine Vorschau
 * und versucht, eine JSON-Sicherung herunterzuladen.
 */
(async () => {
    const EFFECT_NAME = "diverse Modifikatoren";
    const REMOVED_EMPHASES = new Set([
        "gegner kniend",
        "gegner liegend",
    ]);

    const game = globalThis.game;
    const notifications = globalThis.ui?.notifications;

    if (!game?.user?.isGM) {
        notifications?.error?.("Dieses Bereinigungsmakro muss von einem GM ausgefuehrt werden.");
        return;
    }

    const actorEntries = collectActors(game);
    const plans = [];

    for (const { actor, source } of actorEntries) {
        for (const effect of collectionValues(actor?.items)) {
            if (effect?.type !== "spelleffect") continue;
            if (normalizeText(effect.name) !== normalizeText(EFFECT_NAME)) continue;

            const before = String(effect.system?.modifier ?? "");
            const result = removePositionTargetClauses(before, REMOVED_EMPHASES);
            if (!result.removed.length) continue;

            plans.push({
                actor,
                effect,
                source,
                before,
                after: result.modifier,
                removed: result.removed,
            });
        }
    }

    if (!plans.length) {
        notifications?.info?.(
            `Keine Klauseln fuer "Gegner kniend" oder "Gegner liegend" in Zaubereffekten namens "${EFFECT_NAME}" gefunden.`
        );
        return;
    }

    const removedClauseCount = plans.reduce((sum, plan) => sum + plan.removed.length, 0);
    logCleanupPreview(plans);
    const confirmed = await confirmCleanup(plans, removedClauseCount);
    if (!confirmed) {
        notifications?.info?.("Bereinigung abgebrochen; es wurden keine Daten geaendert.");
        return;
    }

    const backup = {
        createdAt: new Date().toISOString(),
        effectName: EFFECT_NAME,
        removedEmphases: [...REMOVED_EMPHASES],
        entries: plans.map(({ actor, effect, source, before }) => ({
            actorName: actor?.name ?? "",
            actorUuid: actor?.uuid ?? null,
            effectName: effect?.name ?? "",
            effectUuid: effect?.uuid ?? null,
            source,
            modifier: before,
        })),
    };
    saveBackup(backup);

    const updated = [];
    const failed = [];
    for (const plan of plans) {
        try {
            await plan.effect.update({ "system.modifier": plan.after });
            updated.push(plan);
        } catch (error) {
            failed.push({ plan, error });
            console.error(
                `Smoother Fight | Bereinigung von ${plan.effect?.uuid ?? plan.effect?.name ?? "Zaubereffekt"} fehlgeschlagen`,
                error
            );
        }
    }

    console.group("Smoother Fight | Bereinigung: diverse Modifikatoren");
    console.table(updated.map(({ actor, effect, source, removed }) => ({
        Akteur: actor?.name ?? "",
        Quelle: source,
        Effekt: effect?.name ?? "",
        "Entfernte Klauseln": removed.length,
    })));
    if (failed.length) console.error("Fehlgeschlagene Aktualisierungen", failed);
    console.groupEnd();

    const successfulClauseCount = updated.reduce((sum, plan) => sum + plan.removed.length, 0);
    if (failed.length) {
        notifications?.warn?.(
            `${updated.length} Zaubereffekt(e) bereinigt (${successfulClauseCount} Klauseln); ${failed.length} Aktualisierung(en) fehlgeschlagen. Details stehen in der Konsole.`
        );
    } else {
        notifications?.info?.(
            `${updated.length} Zaubereffekt(e) bereinigt; ${successfulClauseCount} Klauseln entfernt.`
        );
    }

    function collectActors(foundryGame) {
        const entries = [];
        const seenObjects = new WeakSet();
        const seenUuids = new Set();

        const add = (actor, source) => {
            if (!actor || (typeof actor !== "object" && typeof actor !== "function")) return;
            const uuid = String(actor.uuid ?? "").trim();
            if (seenObjects.has(actor) || (uuid && seenUuids.has(uuid))) return;
            seenObjects.add(actor);
            if (uuid) seenUuids.add(uuid);
            entries.push({ actor, source });
        };

        for (const actor of collectionValues(foundryGame?.actors)) {
            add(actor, "Welt-Akteur");
        }

        for (const scene of collectionValues(foundryGame?.scenes)) {
            for (const token of collectionValues(scene?.tokens)) {
                const actor = token?.actor ?? token?.object?.actor ?? null;
                const tokenName = token?.name ?? token?.object?.name ?? "Unbenannter Token";
                const sceneName = scene?.name ?? "Unbenannte Szene";
                add(actor, `Token: ${sceneName} / ${tokenName}`);
            }
        }

        return entries;
    }

    function removePositionTargetClauses(modifier, removedEmphases) {
        const kept = [];
        const removed = [];

        for (const clause of splitModifierClauses(modifier)) {
            const emphasis = emphasisName(clause);
            if (emphasis && removedEmphases.has(normalizeText(emphasis))) removed.push(clause);
            else if (clause) kept.push(clause);
        }

        return {
            modifier: kept.join(", "),
            removed,
        };
    }

    function splitModifierClauses(value) {
        const clauses = [];
        let current = "";
        let quote = null;
        let escaped = false;

        for (const character of String(value ?? "")) {
            if (escaped) {
                current += character;
                escaped = false;
                continue;
            }
            if (character === "\\" && quote) {
                current += character;
                escaped = true;
                continue;
            }
            if (quote) {
                current += character;
                if (character === quote) quote = null;
                continue;
            }
            if (character === "\"" || character === "'") {
                quote = character;
                current += character;
                continue;
            }
            if (character === ",") {
                const clause = current.trim();
                if (clause) clauses.push(clause);
                current = "";
                continue;
            }
            current += character;
        }

        const finalClause = current.trim();
        if (finalClause) clauses.push(finalClause);
        return clauses;
    }

    function emphasisName(clause) {
        const match = String(clause ?? "").match(/\bemphasis\s*=\s*(?:"([^"]*)"|'([^']*)')/iu);
        return match?.[1] ?? match?.[2] ?? null;
    }

    function normalizeText(value) {
        return String(value ?? "")
            .normalize("NFKD")
            .replace(/\p{Mark}/gu, "")
            .replace(/\s+/gu, " ")
            .trim()
            .toLocaleLowerCase("de");
    }

    function collectionValues(collection) {
        if (!collection) return [];
        if (Array.isArray(collection)) return collection;
        if (Array.isArray(collection.contents)) return collection.contents;
        if (typeof collection.values === "function") return Array.from(collection.values());
        return Array.from(collection);
    }

    async function confirmCleanup(cleanupPlans, clauseCount) {
        const shownPlans = cleanupPlans.slice(0, 6);
        const omitted = cleanupPlans.length - shownPlans.length;
        const rows = shownPlans.map(({ actor, effect, source, removed }) => (
            `<li><strong>${escapeHtml(actor?.name ?? "Unbenannter Akteur")}</strong>`
            + ` - ${escapeHtml(source)} - ${escapeHtml(effect?.name ?? EFFECT_NAME)}`
            + ` (${removed.length} Klauseln)</li>`
        )).join("");
        const omittedText = omitted > 0
            ? `<p><em>... und ${omitted} weitere Zaubereffekt(e). Die vollstaendige Liste steht in der Konsole.</em></p>`
            : "";
        const content = [
            `<p>Es werden <strong>${clauseCount}</strong> Klauseln aus <strong>${cleanupPlans.length}</strong> Zaubereffekt(en) entfernt.</p>`,
            "<p>Entfernt werden ausschliesslich <code>Gegner kniend</code> und <code>Gegner liegend</code>. Alle anderen Modifier bleiben erhalten.</p>",
            `<div style="max-height: 12rem; overflow-y: auto; padding-right: 0.5rem;"><ul>${rows}</ul></div>`,
            omittedText,
            "<p>Falls die Foundry-Dateifunktion verfuegbar ist, wird vorher eine JSON-Sicherung heruntergeladen.</p>",
        ].join("");
        const title = "Diverse Modifikatoren bereinigen?";
        const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
        if (typeof DialogV2?.confirm === "function") {
            return Boolean(await DialogV2.confirm({ window: { title }, content }));
        }
        if (typeof globalThis.Dialog?.confirm === "function") {
            return Boolean(await globalThis.Dialog.confirm({ title, content }));
        }
        return Boolean(globalThis.confirm?.(
            `${title}\n\n${clauseCount} Klauseln aus ${cleanupPlans.length} Zaubereffekten entfernen?`
        ));
    }

    function logCleanupPreview(cleanupPlans) {
        console.groupCollapsed("Smoother Fight | Vorschau: diverse Modifikatoren bereinigen");
        console.table(cleanupPlans.map(({ actor, effect, source, removed }) => ({
            Akteur: actor?.name ?? "",
            Quelle: source,
            Effekt: effect?.name ?? "",
            "Zu entfernende Klauseln": removed.length,
        })));
        console.groupEnd();
    }

    function saveBackup(backupData) {
        const saveDataToFile = globalThis.saveDataToFile
            ?? globalThis.foundry?.utils?.saveDataToFile;
        const json = JSON.stringify(backupData, null, 2);
        const filename = `smoother-fight-diverse-modifikatoren-backup-${backupData.createdAt.replace(/[:.]/gu, "-")}.json`;
        if (typeof saveDataToFile === "function") {
            try {
                saveDataToFile(json, "application/json", filename);
                return;
            } catch (error) {
                console.warn("Smoother Fight | JSON-Sicherung konnte nicht heruntergeladen werden", error);
            }
        }
        console.warn("Smoother Fight | Keine Dateifunktion fuer die Sicherung verfuegbar. Sicherungsdaten:", backupData);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\"", "&quot;")
            .replaceAll("'", "&#039;");
    }
})();
