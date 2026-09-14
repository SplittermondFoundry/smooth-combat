# Changelog

## Unveröffentlicht

## 0.7.0 – 14. September 2026

Änderungen seit **0.6.6**. Version **0.7.0** ergänzt das bestehende Kampf-HUD um eine eigene Charakterwahl. Spieler können ihre Figuren bedienen, die Spielleitung kann zwischen Szenentokens wechseln – während der aktive Kämpfer und der Kampfverlauf sichtbar bleiben.

### Charakterwahl und persönliche Ziele

- **Charaktere direkt auswählen:** Die Auswahl enthält ausschließlich Tokens der aktuellen Szene. Spieler sehen ihre berechtigten Figuren, die SL alle Szenentokens. Suche und Filter erleichtern die Auswahl. Ein berechtigtes Token lässt sich auch direkt auf der Kampfkarte auswählen; eine offene Charakterauswahl schließt sich dabei.
- **Aktiven Kampf im Blick behalten:** Eigene Figur bzw. SL-Auswahl und eigenes Ziel stehen oben, gerade aktiver Kämpfer und sein Primärziel darunter. Der bediente Charakter erhält die große Karte. Identische Tokens oder Ziele erscheinen nur einmal; verschiedene Tokens desselben Actors bleiben getrennt.
- **Ziele eindeutig zuordnen:** Eigene Ziele bleiben beim Wechsel zwischen Figuren innerhalb der Sitzung erhalten. Jede Zielkarte nennt, für welchen Charakter das Ziel ausgewählt ist. Die Kampfereignisse folgen weiterhin dem aktiven Kämpfer.
- **Ressourcen auch kompakt anzeigen:** Kleine Karten zeigen Porträt, Name sowie Lebens- und Fokusleisten, sofern die nötige Sichtberechtigung besteht.
- **Handlungsbedarf erkennen:** Ist die eigene Figur am Zug, während eine andere Figur bedient wird, blinkt das aktive Porträt für den zuständigen Spieler bzw. die SL. Die Bewegungsreichweite erscheint bei Spielern nur für den gerade aktiven Token und nicht für besiegte Figuren.
- **Schnell zur Figur zurückfinden:** Der erste Klick auf eine kompakte Charakterkarte übernimmt die Bedienung. Ein weiterer Klick auf das bereits geöffnete Porträt zeigt den Token auf der Kampfkarte.

Die Charakterwahl ist **standardmäßig aktiv**. Unter **Moduleinstellungen → Charakterwahl im HUD** lässt sich die klassische Ansicht wiederherstellen. Eine bereits gespeicherte Abschaltung wird respektiert.

### Aktionen und Bedienung

- **Zugsperre für Zauber und Fernkampf:** Vorbereiten und Auslösen sind im laufenden Kampf nur im Zug des ausgewählten Tokens möglich – auch für die SL und für bereits vorbereitete Aktionen. Dass eine andere Figur desselben Spielers oder ein anderer Token desselben Actors am Zug ist, reicht nicht aus. Gesperrte Buttons zeigen ein Schloss mit Begründung im Tooltip. Die Vorbereitung bleibt erhalten; Abbrechen und Item-Rechtsklick bleiben erreichbar.
- **Vollständige Aktionsmenüs:** Fertigkeiten, Angriffe, Zauber und Aktive Abwehr bleiben in ihren aufklappbaren, scrollbaren Listen. Das Öffnen eines Menüs schließt das zuvor geöffnete. Favoriten und die bisherigen Ausrüstungsschalter bleiben verfügbar.
- **Freie Wege zu Buttons und Karte:** Tooltips stehen über der Aktionsleiste bzw. neben der gesamten Angriffszeile einschließlich Favoritenstern. Freie Flächen über den Portraitspalten und zwischen den HUD-Bereichen lassen Klicks, Ziehen und Mausrad zur Kampfkarte durch.
- **Zuverlässige Aktionseinblendungen:** Die Icon-Pfade sind korrigiert. HUD-Aktualisierungen setzen eine laufende Einblendung fort, statt dieselbe Animation erneut zu starten.
- **Scrollbare Wurfdialoge:** Bei langen Modifikatorlisten bleiben die Wurfbuttons erreichbar. Die Korrektur bleibt ausdrücklich für **Splittermond 14.2.7** enthalten und wird auch bei neueren Systemversionen geladen.

### Aktualisierung und Kompatibilität

Die Mindestanforderungen bleiben unverändert: **Foundry VTT 14 ab Build 14.359** und **Splittermond ab 14.2.0**. Die Vorbereitungsdaten von **14.2.7** und **14.3.0-beta4** werden unterstützt. Einstellungen und Weltdaten benötigen keine Migration.

Nach Veröffentlichung kann das Modul über Foundrys Modulverwaltung aktualisiert werden. Bei manueller Installation enthält das reguläre ZIP die Moduldateien direkt auf der obersten Ebene: Bei beendetem Foundry in **Data/modules/splittermond-smoother-fight** entpacken. Anschließend Foundry bzw. die Welt und die Browserseiten aller Beteiligten neu laden, bei Bedarf mit **Strg+F5**. Die bisherigen CSS-Adressen aus 0.6.4 und 0.6.6 bleiben als Weiterleitungen erhalten.

### Prüfung

- **706 automatisierte Tests** und zusätzlich **80 Regeltests** mit den vorgegebenen Coverage-Grenzen erfolgreich.
- Lokale Browserprüfungen in **Chromium und Firefox** bei **1920 × 1080** und **1280 × 720** prüfen unter anderem Auswahl, Ziele, Berechtigungen, Zugsperren, Rechtsklick, Tooltips, Mausdurchleitung und Einblendungen.
- Die Zugsperren wurden mit den Vorbereitungsdaten aus **14.2.7** und **14.3.0-beta4** geprüft. Die Browserprüfungen verwenden echte HUD-Komponenten mit Testdaten; sie sind kein vollständiger Integrationstest in einer Foundry-Spielwelt.

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
