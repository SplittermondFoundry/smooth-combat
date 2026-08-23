# Splittermond Smoother Fight 0.5.0

Dieses Update erweitert die Aktive Abwehr um den Einsatz von Splitterpunkten und verbessert die Bedienung sowie den Schutz nicht freigegebener Kampfwerte im HUD.

## Neue Funktionen

- Bei Angriffen gegen die VTD kann der Besitzer des Ziels direkt über die Angriffskarte einen **Splitterpunkt für +3 VTD** einsetzen. Der Punkt wird automatisch abgezogen und die Angriffskarte mit dem neuen Verteidigungswert aktualisiert.
- Ab Heldengrad 3 kann ein anderer berechtigter Kampfteilnehmer eine **Splitterpunkt-Resonanz für weitere +2 VTD** beisteuern. Pro Angriff ist höchstens eine Resonanz möglich.
- Splitterpunkte und Aktive Abwehr lassen sich in beliebiger Reihenfolge einsetzen. Bereits gewährte Boni bleiben bei der Neuberechnung erhalten; die aktualisierten Angriffskarten und eigene Chatkarten dokumentieren das Ergebnis.
- Die vollständige Handlungsübersicht im Kampf-HUD besitzt jetzt eine Suche. Sie filtert unter anderem nach Handlung, Kategorie, Art, Dauer, Besonderheit und Quelle.
- Eine neue Welteinstellung erlaubt Spielleitungen, **LP und FO fremder Ziele offenzulegen**. Die Einstellung ist standardmäßig deaktiviert.

## Verbesserungen und Fehlerbehebungen

- Das Kampf-HUD blendet VTD, KW, GW, LP und FO des aktiven Kämpfers nun ebenfalls aus, wenn einem Spieler die nötigen Rechte oder Weltfreigaben fehlen.
- Ein **temporärer Kompatibilitäts-Hotfix für das Splittermond-System** verhindert, dass bei der Ausgabe eines Splitterpunkts für eine Aktive Abwehr das Merkmal **Defensiv** in der Neuberechnung verloren geht. Ohne den Hotfix konnte die neu berechnete VTD trotz des ausgegebenen Splitterpunkts niedriger ausfallen als zuvor. Das Modul rekonstruiert den fehlenden Merkmalswert und übernimmt ihn in die erneute Berechnung.
- Die Schnellauswahl von Zielen verhält sich eindeutiger: Ein normaler Klick ersetzt die bisherige Auswahl und setzt das Primärziel, während **Umschalt + Klick** weitere Ziele ergänzt.
- Bei der Mehrfachauswahl bleiben das geöffnete Zielmenü, der Suchbegriff, der gewählte Filter und die Scrollposition erhalten.
- Gleichzeitige Abwehr- und Splitterpunktaktionen werden geordnet verarbeitet, damit keine Boni verloren gehen oder mehrfach angewendet werden.
- Fehlgeschlagene Aktualisierungen rollen den abgezogenen Splitterpunkt sicher zurück.

## Installation

In Foundry unter **Add-on-Module → Modul installieren** diese Manifest-URL verwenden:

```text
https://github.com/SplittermondFoundry/smooth-combat/releases/latest/download/module.json
```

Das Release enthält außerdem ein ZIP für die manuelle Installation.
