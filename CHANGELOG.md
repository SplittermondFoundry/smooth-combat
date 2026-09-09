# Changelog

## Noch nicht veröffentlicht

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

Zauberidentifikation mit Arkane-Kunde-Probe, Gradbuttons und passenden Ergebnishinweisen; zuverlässige Abschlüsse von Bewegungen und kontinuierlichen Handlungen in Splittermond 14.2.7 und 14.3.x. Die vollständigen Hinweise stehen in [RELEASE_NOTES.md](RELEASE_NOTES.md).
