# Splittermond Smoother Fight 0.6.5

Änderungen seit **0.6.4**. Dieses Fehlerkorrektur-Update erkennt abgeschlossene Schadensanwendungen wieder zuverlässig und stabilisiert die HUD-Anzeige bei Bewegung, Sicht- und Charakterwechseln.

## Schaden und Angriffsablauf

- Nach dem Anwenden von Schaden im HUD wird die Schadenskarte als abgeschlossen erkannt. Der Ablauf kehrt zur Angriffskarte mit den noch offenen Ticks zurück. Das gilt auch für den SL-Button zum Anwenden auf die Ziele des Angreifers.
- Die Erkennung unterstützt sowohl die bisherige Schadensbuchung unter **Splittermond 14.2.7** als auch die neue Schnittstelle der **14.3-Betaversionen**, geprüft mit **14.3.0-beta3**. Fehlende oder nachträglich ersetzte globale Schadensfeedback-Hooks verhindern den Abschluss nicht mehr.
- Bestätigte Anwendungen mit **0 Schaden** schließen den Schadensschritt ebenfalls ab. Abgebrochene Dialoge bleiben offen. Bereits abgeschlossene Anwendungen sind gegen erneutes Anwenden gesperrt; bei einer fehlgeschlagenen Buchung mit unklarem Ergebnis bleibt die Wiederholung zur Sicherheit gesperrt.

## Stabile HUD-Anzeige

- Manuell aufgeklappte Kampfereignisse bleiben beim Buchen einer Bewegung und beim Charakterwechsel offen. Angriffskarten klappen dabei nicht mehr kurz ein und verschieben das HUD.
- Öffnen und Schließen von Karten wird unmittelbar übernommen. Auch Eingaben während eines langsamen HUD-Aufbaus bleiben erhalten.
- Das Speichern oder Zurücksetzen von Bewegungen aktualisiert gezielt den Bewegungstracker. Automatische Bewegungen beim Charakterwechsel sowie Routenfortschritt und Bewegungsstatus erzeugen keine zusätzlichen vollständigen HUD-Aufbauten. Abgeschlossene Bewegungen entfernen ihre Routen-, Abbruch- und Unterbrechungsanzeigen auch auf den anderen Clients.
- Sichtwechsel aktualisieren betroffene Ziele, Kampfereignisse, Abwehrmöglichkeiten und Tick-Sperren unmittelbar. Unveränderte Porträts, Chatkarten, geöffnete Menüs und Suchfelder bleiben erhalten; veraltete Zielinformationen werden nach einem laufenden Aufbau nicht wieder eingeblendet.
- Beim gewöhnlichen Zugwechsel bleibt das bisherige HUD sichtbar, bis der nächste Charakter fertig aufgebaut ist. Während des Wechsels ist die alte Anzeige nicht bedienbar.

## Kompatibilität und Aktualisierung

- Die Voraussetzungen bleiben unverändert: **Foundry VTT 14 ab Build 14.359** und **Splittermond ab 14.2.0**. Die versionsübergreifende Schadenskorrektur erweitert die Unterstützung nicht auf Foundry V13.
- Einstellungen und Weltdaten benötigen keine Migration. Nach der Installation Foundry beziehungsweise die Welt und anschließend die Browserseiten aller Beteiligten neu laden, bei Bedarf mit **Strg+F5**.
- Bereits vor dem Update abgezogenen Schaden nicht erneut anwenden. Den korrigierten Ablauf mit einem neuen Angriff prüfen.

## Prüfung

- `npm run check`: **802 Tests** erfolgreich; zusätzlich **80 Regeltests** mit den vorgegebenen Coverage-Grenzen.
- Die Schadensregressionen prüfen den Rücksprung zu offenen Angriffsticks, verzögerte Buchungen, beide Schadensschnittstellen, abgebrochene Dialoge, null Schaden und den Schutz vor doppelter Anwendung.
- Die bereits durchgeführten **114 Browserprüfungen** zur HUD-Stabilität verwenden kontrollierte Foundry-Dokumente. Einzelheiten: [Prüfung der HUD-Anzeige und Tokenbewegung](https://github.com/SplittermondFoundry/smooth-combat/blob/v0.6.5/docs/token-movement-performance.md).
