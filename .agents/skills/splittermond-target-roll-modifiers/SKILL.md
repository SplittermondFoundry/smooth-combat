---
name: splittermond-target-roll-modifiers
description: Implement or change target-derived, preselected temporary modifiers in Splittermond Smoother Fight roll dialogs. Use when a target condition, spell effect, or Active Effect should affect exactly one spell, attack, defense, or skill roll without persisting or contaminating later targets.
---

# Zielgebundene Würfelmodifikatoren

Lies vor Änderungen die vollständige [Implementierungsanleitung](references/implementation.md). Verwende den bestehenden Ablauf für „Kleiner Magieschutz“ als Referenz und passe ihn nur dort an, wo der neue Probentyp oder die neue Effektquelle es erfordert.

## Verbindlicher Ablauf

1. Ermittle das aktuelle Ziel unmittelbar an der gemeinsamen Systemgrenze. Bei `Actor.rollAttack` und `Actor.rollSpell` ist das erste aktuelle Element von `game.user.targets` maßgeblich, weil Splittermond genau dieses Ziel für dieselbe Probe verwendet. HUD-Aktionen müssen ihr Primärziel zuvor mit `withTemporarySystemTargets(...)` dort einsetzen. Verwende keinen früher gerenderten oder zwischengespeicherten Zielzustand.
2. Suche ausschließlich in der fachlich richtigen Quelle nach dem Zustand, Zaubereffekt oder Active Effect und prüfe dessen tatsächliche Aktivität.
3. Berechne daraus ohne Seiteneffekte höchstens einen Modifikator-Datensatz. Löse Varianten und Vorrangregeln vor der Installation auf.
4. Bereite native und direkte Systemwürfe im zentralen `Actor.rollAttack`-/`Actor.rollSpell`-Interceptor vor. Kennzeichne einen bereits in einer HUD-Aktion vorbereiteten Wurf einmalig und entferne diese private Kennzeichnung vor dem Aufruf des Systems, damit kein Modifikator doppelt entsteht.
5. Installiere einen benannten, vorausgewählten Modifikator weiterhin erst innerhalb des konkreten `skill.roll`-Aufrufs. Entferne ihn unmittelbar nachdem Splittermond die Dialogdaten synchron übernommen hat.
6. Sichere zusätzlich den gesamten äußeren Actor- oder HUD-Roll-Aufruf mit idempotentem Cleanup in `finally` ab.
7. Ergänze Regressionstests für HUD und native Systemaufrufe sowie für Erkennung, Vorrang, Abbruch, Fehler und mindestens zwei überlappende beziehungsweise aufeinanderfolgende Ziele.

## Nicht verhandelbare Invarianten

- Ein temporärer Modifikator darf niemals bereits beim Vorbereiten der Aktion dauerhaft im Modifier-Manager liegen.
- Jeder Roll-Aufruf erhält eine eindeutige Auswahl-ID; globale Namen oder Werte dürfen keine Roll-Zuordnung ersetzen.
- Die interne Kennzeichnung eines bereits vorbereiteten HUD-Wurfs muss vor dem ursprünglichen Actor-Systemaufruf entfernt werden und darf weder `attack.roll`/`spell.roll` noch `skill.roll` erreichen.
- Entfernt wird nur das exakt selbst eingefügte Modifier-Objekt, nicht pauschal nach Name oder Zahlenwert.
- Das Cleanup ist mehrfach aufrufbar und bleibt nach Abbruch oder Exception wirksam.
- Ein noch offener Dialog darf die Modifier-Collection für spätere Proben oder andere Ziele nicht verändern.
- Falls die benannte Injektion mit der aktuellen System-API nicht sicher möglich ist, wird der Zahlenwert nur in den Optionen dieser einen Probe addiert.
- Foundry-Dokumentrechte sind keine Geheimhaltungsgrenze für bereits zum Client übertragene Zielinformationen. Geheime Effekte benötigen einen GM-seitigen Auswertungspfad.

## Abschlussprüfung

Führe mindestens `npm.cmd test -- tests/spell-target-modifier.test.mjs` aus. Bei Änderungen an gemeinsam genutzten Roll- oder Modifier-Helfern ist zusätzlich `npm.cmd run check` erforderlich.
