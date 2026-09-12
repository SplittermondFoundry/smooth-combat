# Changelog

## Unveröffentlicht

## 0.6.6 – 12. September 2026

Kompatibilitätsupdate für vorbereitete Angriffe und Zauber unter **Splittermond 14.3.0-beta4**, weiterhin vollständig kompatibel mit **14.2.7**.

### Splittermond 14.3.0-beta4

- Vorbereitete Angriffe und Zauber verwenden unter **Splittermond 14.3.0-beta4** das neue Datenmodell `system.preparedAction`; unter **14.2.7** bleiben die bisherigen Systemflags vollständig unterstützt. Vorbereitung, Anzeige, Auslösen, Abbruch, Unterbrechung und Wiederherstellung laufen über denselben fähigkeitsbasierten Adapter.
- Das Schreiben in beta4 ruft bewusst nicht `PreparedAction.set(...)` auf, damit Smoother Fight die bereits gebuchten Vorbereitungsticks nicht ein zweites Mal berechnet.
- Kurze und lange Rasten löschen in beta4 vorbereitete Aktionen. Smoother Fight entfernt daraufhin auch seine zugehörige kontinuierliche Handlung und deren Status, sodass kein veralteter Sperrzustand bestehen bleibt.
- Die Actor-Rollmethoden, Zielermittlung, vorausgewählten temporären Modifikatoren und der synchrone Dialog-Snapshot wurden gegen **14.2.7** und **14.3.0-beta4** erneut geprüft; ihre bisherigen Kompatibilitätswege bleiben unverändert.

## 0.6.5 – 12. September 2026

Änderungen seit **0.6.4**. Dieses Fehlerkorrektur-Update erkennt abgeschlossene Schadensanwendungen wieder zuverlässig und stabilisiert die HUD-Anzeige bei Bewegung, Sicht- und Charakterwechseln.

### Schaden und Angriffsablauf

- Nach dem Anwenden von Schaden im HUD wird die Schadenskarte als abgeschlossen erkannt. Der Ablauf kehrt zur Angriffskarte mit den noch offenen Ticks zurück. Das gilt auch für den SL-Button zum Anwenden auf die Ziele des Angreifers.
- Die Erkennung unterstützt sowohl die bisherige Schadensbuchung unter **Splittermond 14.2.7** als auch die neue Schnittstelle der **14.3-Betaversionen**, geprüft mit **14.3.0-beta3**. Fehlende oder nachträglich ersetzte globale Schadensfeedback-Hooks verhindern den Abschluss nicht mehr.
- Bestätigte Anwendungen mit **0 Schaden** schließen den Schadensschritt ebenfalls ab. Abgebrochene Dialoge bleiben offen. Bereits abgeschlossene Anwendungen sind gegen erneutes Anwenden gesperrt; bei einer fehlgeschlagenen Buchung mit unklarem Ergebnis bleibt die Wiederholung zur Sicherheit gesperrt.

### Stabile HUD-Anzeige

- Manuell aufgeklappte Kampfereignisse bleiben beim Buchen einer Bewegung und beim Charakterwechsel offen. Angriffskarten klappen dabei nicht mehr kurz ein und verschieben das HUD.
- Öffnen und Schließen von Karten wird unmittelbar übernommen. Auch Eingaben während eines langsamen HUD-Aufbaus bleiben erhalten.
- Das Speichern oder Zurücksetzen von Bewegungen aktualisiert gezielt den Bewegungstracker. Automatische Bewegungen beim Charakterwechsel sowie Routenfortschritt und Bewegungsstatus erzeugen keine zusätzlichen vollständigen HUD-Aufbauten. Abgeschlossene Bewegungen entfernen ihre Routen-, Abbruch- und Unterbrechungsanzeigen auch auf den anderen Clients.
- Sichtwechsel aktualisieren betroffene Ziele, Kampfereignisse, Abwehrmöglichkeiten und Tick-Sperren unmittelbar. Unveränderte Porträts, Chatkarten, geöffnete Menüs und Suchfelder bleiben erhalten; veraltete Zielinformationen werden nach einem laufenden Aufbau nicht wieder eingeblendet.
- Beim gewöhnlichen Zugwechsel bleibt das bisherige HUD sichtbar, bis der nächste Charakter fertig aufgebaut ist. Während des Wechsels ist die alte Anzeige nicht bedienbar.

### Kompatibilität und Aktualisierung

- Die Voraussetzungen bleiben unverändert: **Foundry VTT 14 ab Build 14.359** und **Splittermond ab 14.2.0**. Die versionsübergreifende Schadenskorrektur erweitert die Unterstützung nicht auf Foundry V13.
- Einstellungen und Weltdaten benötigen keine Migration. Nach der Installation Foundry beziehungsweise die Welt und anschließend die Browserseiten aller Beteiligten neu laden, bei Bedarf mit **Strg+F5**.
- Bereits vor dem Update abgezogenen Schaden nicht erneut anwenden. Den korrigierten Ablauf mit einem neuen Angriff prüfen.

### Prüfung

- `npm run check`: **802 Tests** erfolgreich; zusätzlich **80 Regeltests** mit den vorgegebenen Coverage-Grenzen.
- Die Schadensregressionen prüfen den Rücksprung zu offenen Angriffsticks, verzögerte Buchungen, beide Schadensschnittstellen, abgebrochene Dialoge, null Schaden und den Schutz vor doppelter Anwendung.
- Die bereits durchgeführten **114 Browserprüfungen** zur HUD-Stabilität verwenden kontrollierte Foundry-Dokumente. Einzelheiten: [Prüfung der HUD-Anzeige und Tokenbewegung](docs/token-movement-performance.md).

## 0.6.4 – 9. September 2026

Änderungen seit **0.6.3**. Dieses Update verbessert die Tokenbewegung, macht Bewegungseinschränkungen deutlicher und reduziert die Arbeit des HUDs während Animationen.

### Bewegung und Bedienung

- Bewegungen lassen sich direkt am Token abbrechen, auch außerhalb seines Zuges. Der Button zeigt eine **durchgestrichene laufende Figur** und folgt dem Token bei Animation, Kartenverschiebung und Zoom. Hover oder Tastaturfokus zeigt den vorgesehenen Stoppunkt. Der reguläre Zugtick einschließlich zusätzlicher Tickkosten bleibt erhalten.
- Spielleitungen können alle Bewegungen abbrechen; Spieler die ihrer zugeordneten, sichtbaren Tokens. Ohne gespeicherte Route wird die Stopp-Position manuell festgelegt.
- Bei **Liegend** bietet die Bewegungsleiste **Kriechen (höchstens 1 m, 5 Ticks)** und **Aufstehen (6 Ticks)**. Bei **Kniend** kostet Aufstehen 3 Ticks. Der Positionswechsel erfolgt beim Abschluss der Handlung. Zu lange Kriechrouten müssen vor der Buchung korrigiert werden.
- Die Bewegungsweite berücksichtigt die berechnete GSW einschließlich Abzügen und Modifikatoren. Bei **GSW 0** erscheint ein deutlich hervorgehobener Hinweis. Laufen und Sprinten zeigen ein Schloss und **„Nicht verfügbar“** statt irreführender „2 m“. Ein fehlender GSW-Wert wird gesondert angezeigt.
- Die ergänzten Hinweise stehen auf Deutsch und Englisch bereit; der GSW-Hinweis unterstützt beide Farbschemata und schmale HUD-Ansichten.

### Leistung und Zuverlässigkeit

- Sichtaktualisierungen während Tokenanimationen aktualisieren Entfernungen, Reichweiten und Bewegungsanzeigen gezielt. Unveränderte Aktionsbereiche, Chatkarten und geöffnete Menüs bleiben bestehen. Tatsächlich verborgene Beteiligte werden weiterhin unmittelbar ausgeblendet.
- Vollständige HUD-Aufbauten laufen nacheinander. Währenddessen eingehende Anforderungen werden zusammengeführt, veraltete Ergebnisse verworfen und ausstehende Aktualisierungen beim Szenenwechsel beendet.
- Unveränderte Bewegungshistorien werden für die Anzeige wiederverwendet. Aktionsausführung und Regelprüfungen verwenden weiterhin aktuelle Messungen.
- Bewegungsbuttons benötigen bei unveränderter Sicht keine erneuten Bewegungsflag-Abfragen. Mehrere Tokenupdates bündeln den Abgleich der Routenvorschauen.
- Kampfereignisse ordnen verknüpfte Nachrichten über lokale Indizes zu. Innerhalb eines HUD-Aufbaus verwenden Karten, Abwehrprüfung und blockierende Aktionen eine gemeinsame Sammlung.

### Kompatibilität

- Unter **Splittermond 14.2.7** gibt **Angsterfüllt** Sicherheitswürfe vor, auch bei dialoglosen Proben. Andere Wurfarten erfordern eine Bestätigung. Die Vorgabe gilt für Fertigkeiten, Angriffe, Zauber und Aktive Abwehr aus HUD, Charakterbogen und Makros. Andere Systemversionen verwenden ihre eigene Behandlung.
- Die Voraussetzungen bleiben unverändert: Foundry VTT 14 ab Build **14.359** und Splittermond ab **14.2.0**.
- Einstellungen und Weltdaten benötigen keine Migration. Nach dem Update Foundry beziehungsweise die Welt und anschließend die Browserseiten aller Beteiligten neu laden.

### Prüfung

- `npm run check`: **764 Tests** erfolgreich; zusätzlich **79 Regeltests** mit den vorgegebenen Coverage-Grenzen.
- Lokale Browserprüfungen decken HUD-Aktualisierungen, Sichtwechsel, persönliche Aktionen, die GSW-Anzeige und den Abbruch per Tokenbutton ab.
- Kontrollierte Operationszählung: 60 Animations-/Sichtframes bei unverändertem Sichtbestand erzeugen **0 statt 60 vollständige HUD-Aufrufe**; 60 HUD-Distanzabrufe derselben Bewegungshistorie benötigen **1 statt 60 Pfadmessungen**. Diese Werte sind keine CPU-/GPU-Messung der laufenden Spielwelt. Einzelheiten: [Leistungsprüfung der Tokenbewegung](docs/token-movement-performance.md).

## 0.6.3

Zauberidentifikation mit Arkane-Kunde-Probe, Gradbuttons und passenden Ergebnishinweisen; zuverlässige Abschlüsse von Bewegungen und kontinuierlichen Handlungen in Splittermond 14.2.7 und 14.3.x. Die vollständigen Hinweise stehen im [Release 0.6.3](https://github.com/SplittermondFoundry/smooth-combat/releases/tag/v0.6.3).
