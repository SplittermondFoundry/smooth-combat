# Splittermond Smoother Fight 0.6.6

Änderungen seit **0.6.5**. Dieses Kompatibilitätsupdate erhält vorbereitete Angriffe und Zauber unter **Splittermond 14.3.0-beta4** und bleibt mit **14.2.7** kompatibel.

## Vorbereitete Angriffe und Zauber

- Splittermond 14.3.0-beta4 speichert vorbereitete Aktionen im neuen Actor-Datenmodell `system.preparedAction`. Smoother Fight erkennt dieses Modell und verwendet unter 14.2.7 weiterhin die bisherigen Systemflags.
- Vorbereitung, Anzeige, Auslösen, Abbruch, Unterbrechung und Wiederherstellung verwenden nun einen gemeinsamen, strukturprüfenden Kompatibilitätsadapter.
- Vorbereitungsticks werden weiterhin genau einmal gebucht. Smoother Fight schreibt den vorbereiteten Zustand unter beta4 direkt, da die neue Systemmethode `PreparedAction.set(...)` zusätzlich selbst Ticks berechnet.
- Kurze und lange Rasten entfernen nun auch die zugehörige kontinuierliche Handlung und deren Status aus dem HUD, nachdem beta4 die vorbereitete Aktion gelöscht hat.

## Rollmodifikatoren und allgemeine Kompatibilität

- Die Actor-Rollmethoden, Zielermittlung, vorausgewählten temporären Modifikatoren und der synchrone Dialog-Snapshot wurden gegen **14.2.7** und **14.3.0-beta4** geprüft. Das bestehende Konzept für zielabhängige Modifikatoren bleibt unverändert funktionsfähig.
- Bei der Prüfung der Änderungen von beta3 auf beta4 wurden keine weiteren inkompatiblen, von Smoother Fight verwendeten System-Schnittstellen gefunden.
- Die Voraussetzungen bleiben **Foundry VTT 14 ab Build 14.359** und **Splittermond ab 14.2.0**. Einstellungen und Weltdaten benötigen keine Migration.

## Aktualisierung

- Nach der Installation Foundry beziehungsweise die Welt und anschließend die Browserseiten aller Beteiligten neu laden, bei Bedarf mit **Strg+F5**.
- Bereits vorbereitete Aktionen aus einer laufenden 14.2.7-Sitzung sollten vor einem gleichzeitigen Systemwechsel auf beta4 abgeschlossen oder abgebrochen werden.

## Prüfung

- `npm run check`: **808 Tests** erfolgreich; zusätzlich **80 Regeltests** mit den vorgegebenen Coverage-Grenzen.
- Regressionstests decken beide Speichermodelle, einfache Tickbuchung, Abbruch und erfolgreiche Ausführung sowie die Bereinigung durch kurze und lange Rasten ab.
