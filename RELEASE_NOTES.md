# Splittermond Smoother Fight 0.4.0

Dieses Update ergänzt das Kampf-HUD um eine vollständige Bewegungsverfolgung auf Basis der von Foundry gemessenen Token-Wege.

## Änderungen

- Der neue Bewegungsbalken unterscheidet **2 m freie Bewegung**, **Laufen bis GSW** und **Sprinten bis 3 × GSW**.
- Die Segmentbreiten bilden die Bewegungsbereiche besser ab und bleiben auch bei wenig Platz sauber lesbar.
- Nach Überschreiten der freien Bewegung werden die passenden Segmente direkt zu Schaltflächen für **Laufen (5 Ticks)** und **Sprinten (10 Ticks)**. Beim Sprinten bleibt Laufen weiterhin auswählbar.
- Bewegungen über 3 × GSW werden rot markiert und zeigen die überschrittene Distanz an.
- **Bewegung rückgängig** setzt das Token an seine Startposition zurück und leert Foundrys Bewegungshistorie einschließlich der sofort sichtbaren Meteranzeige.
- Chatkarten für Laufen und Sprinten zeigen zusätzlich die tatsächlich gemessene Bewegung an.
- Die Bewegungsverfolgung ist als globale Welteinstellung standardmäßig aktiv und kann vollständig deaktiviert werden.

## Installation

In Foundry unter **Add-on-Module → Modul installieren** diese Manifest-URL verwenden:

```text
https://github.com/SplittermondFoundry/smooth-combat/releases/latest/download/module.json
```

Das Release enthält außerdem ein ZIP für die manuelle Installation.
