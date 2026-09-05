# Splittermond Smoother Fight 0.6.2

Dieses kleine Fehlerbehebungsupdate verhindert, dass Spieler beim Ausgeben von EG, beim Schadenwurf oder beim Bezahlen von Angriffsticks vergeblich auf die Spielleitung warten, weil deren Modul-Empfänger beim Weltstart nicht registriert wurde.

## Fehlerbehebung

- Der Empfänger für Spieleranfragen startet jetzt vor der übrigen Initialisierung. Verzögerungen oder Fehler in nachfolgenden Startschritten verhindern seine Registrierung nicht mehr.
- Wenn eine Antwort der Spielleitung ausbleibt, enthält die Konsole nun konkrete Angaben zur betroffenen Anfrage und Chatkarte.
- Die bestehenden Berechtigungsprüfungen und die Reihenfolge von Aktiver Abwehr und Folgeaktionen bleiben erhalten.

## Prüfung und Kompatibilität

- 691 automatisierte Tests sowie die zusätzlichen Coverage-Prüfungen bestehen. Elf neue Integrationstests prüfen den Spieler–SL–Spieler-Ablauf für EG, Schaden und Ticks sowie offene Abwehren und ausbleibende Antworten. Der Starttest prüft zusätzlich die Registrierung während einer verzögerten Initialisierung.
- Die Voraussetzungen bleiben unverändert: Foundry VTT 14 ab Build **14.359** und Splittermond ab **14.2.0**, einschließlich **14.2.7**.
- Die Kompatibilitätskorrekturen aus [0.6.1](https://github.com/SplittermondFoundry/smooth-combat/releases/tag/v0.6.1) sind weiterhin enthalten.

## Update

Das Modul über Foundrys Modulverwaltung aktualisieren und die Welt anschließend neu starten. Danach sollen Spielleitung und Spieler ihre Browserseiten neu laden. Einstellungen und Weltdaten müssen nicht migriert werden.
