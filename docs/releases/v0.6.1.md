# Splittermond Smoother Fight 0.6.1

Dieses Kompatibilitätsupdate ermöglicht die Aktivierung auch mit Splittermond **14.2.7** und den übrigen **14.2.x**-Versionen.

## Voraussetzungen und Kompatibilität

- Foundry Virtual Tabletop 14 ab Build **14.359**, verifiziert mit **14.363**
- Splittermond-System ab **14.2.0**; unterstützt werden 14.2.x einschließlich **14.2.7** sowie 14.3.x.
- Das passende Status-Datenformat wird automatisch erkannt. Für das Modulupdate von 0.6.0 sind keine neuen Einstellungen oder manuellen Datenmigrationen erforderlich.

## Wichtige Verbesserungen und Fehlerbehebungen

- Patzerzustände verwenden auch unter Splittermond 14.2.x die vorgesehenen Start-Ticks, Intervalle und Wiederholungen. Zustandsstufen und Modifikatoren werden wie bisher übernommen.
- Kampfpositionen bleiben dauerhaft bestehen, bis sie geändert oder durch Aufstehen beendet werden. Wechseln, Neuladen und die Rücknahme fehlgeschlagener Positionswechsel berücksichtigen beide System-Datenformate.
- Für den bisher verwendeten Stand **14.3.0-alpha4** bleiben die erzeugten Statusdaten und Dokumentänderungen unverändert.

## Sicherheit, Stabilität und Technik

- Ein gemeinsamer Status-Adapter erkennt das installierte Datenmodell, einschließlich älterer 14.3-Vorabversionen.
- 43 zusätzliche Kompatibilitätstests prüfen beide Datenformate. Der Originalcode für Statusschema, Start-Tick und Tickereignisse wurde aus 14.2.0, 14.2.7 und 14.3.0-alpha4 in einer isolierten Testumgebung geprüft. Ein vollständiger Praxistest in laufenden Foundry-Welten ist damit nicht abgedeckt.
- Manifest, Downloadpfad und CSS-Cacheversionen wurden gemeinsam auf **0.6.1** aktualisiert.

## Installation

In Foundry unter **Add-on-Module → Modul installieren** diese Manifest-URL verwenden:

```text
https://github.com/SplittermondFoundry/smooth-combat/releases/latest/download/module.json
```

Nach dem Update kann Smoother Fight in einer Welt mit Splittermond **14.2.7** aktiviert werden. Das Release enthält außerdem ein ZIP für die manuelle Installation.

Die ausführlichen Neuerungen von 0.6.0 stehen in den [Versionshinweisen zu 0.6.0](https://github.com/SplittermondFoundry/smooth-combat/releases/tag/v0.6.0).
