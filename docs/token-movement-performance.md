# Tokenbewegung: Leistungsprüfung und Korrektur

Stand: 9. September 2026. Gemeldetes Symptom: hohe Last erst beim Loslassen oder während der anschließenden Animation. Die ursprüngliche Untersuchung bezog sich auf `e54d513`; die Korrekturen bauen auf `098c66e` auf.

Die Prüfung hat vermeidbare Zusatzarbeit im Modul nachgewiesen. Sichtaktualisierungen lösten wiederholt vollständige HUD-Aufbauten, Chat-Sammlungen und Bewegungsflag-Abfragen aus. Diese Pfade sind korrigiert. Die folgenden Messungen zählen Operationen in kontrollierten Szenarien; der Anteil an der tatsächlichen CPU-/GPU-Last der Spielszene ist nicht gemessen.

## Umgesetzte Korrekturen

### Sicht und Animation aktualisieren bestehende Anzeigen

In der lokal geprüften Foundry-Version 14.361 aktualisiert `Token._onAnimationUpdate` bei eingeschalteter `core.visionAnimation` die Sicht-/Lichtquellen bewegter Tokens. Die Wahrnehmungsverwaltung aktualisiert daraufhin die Sicht und sendet `sightRefresh`. Dieser Pfad kann während der Animation in jedem Frame auftreten.

`sightRefresh` fordert jetzt eine gebündelte Canvas-Aktualisierung an. `hud/canvas-updates.js` aktualisiert Entfernungen, Zielbeschriftungen, Angriffs-/Zauberreichweiten und den Bewegungstracker nur bei veränderten Werten. HUD-Schale, Chatkarten und geöffnete Menüs bleiben bestehen. Persönliche Aktionen verwenden weiterhin den eigenen Combatant, auch bei gemeinsamem Actor und während eines verborgenen Zuges.

Ändert sich tatsächlich die Menge sichtbarer Beteiligter, wird das alte HUD sofort verborgen und einmal vollständig neu aufgebaut. Das berücksichtigt auch historische Kartenziele für Beobachter ohne aktive Zielauswahl. Tooltips und Hervorhebungen werden dabei entfernt. Dokument-, Nachrichten-, Rechte- und relevante Zustandsänderungen lösen weiterhin vollständige Aufbauten aus. Nach Ende oder Abbruch der Tokenanimation erfolgt eine abschließende leichte Aktualisierung.

### Vollständige HUD-Aufbauten laufen nacheinander

Der Controller erlaubt höchstens einen asynchronen Aufbau gleichzeitig. Währenddessen eingehende Anforderungen werden zu einem anschließenden Aufbau zusammengeführt; veraltete Ergebnisse werden nicht montiert. Fehler geben die Warteschlange wieder frei. Ein Szenenwechsel beendet geplante Aktualisierungen und verhindert, dass alte Animations-Promises das neue Canvas nachträglich aktualisieren.

Innerhalb eines vollständigen Aufbaus verwenden Karten, Abwehrprüfung und blockierende Aktionen dieselbe Sammlung der Kampfereignisse. Der nächste Aufbau sammelt Nachrichten und Sichtrechte erneut. Es gibt keinen dauerhaften Chatcache.

### Sichtprüfungen lesen keine Bewegungsflags mehr pro Frame

Der Sicht-Hook aktualisiert vorhandene Bewegungsbuttons und Routenvorschauen unmittelbar. Unsichtbare Buttons bleiben für berechtigte Benutzer vorbereitet, werden aber nicht angezeigt. Bei einer tatsächlichen Änderung sichtbarer Combatants wird der Routenbestand einmal neu abgeglichen. Wiederholte Sichtaktualisierungen bei unverändertem Bestand benötigen keine Bewegungsflag-Abfragen.

`updateToken` bündelt Standard-Routenabgleiche über einen Animationsframe. Eine Gruppe von Tokenupdates führt damit zu einem gemeinsamen Abgleich statt zu einer vollständigen synchronen Prüfung je Token. Der zuvor optimierte `refreshToken`-Pfad bleibt erhalten.

### Unveränderte Bewegungshistorien werden wiederverwendet

Nur HUD-Aufrufer verwenden einen flüchtigen Cache für die gemessene historische Strecke. Historienänderungen, einschließlich Änderungen innerhalb bestehender Wegpunkte, Tokenabmessungen, Raster- und Messfunktionsänderungen beenden die Wiederverwendung. Laufender Bewegungsfortschritt wird weiterhin aktuell gelesen. Vollständige Dokumentaufbauten und Canvas-Abbau verwerfen den Cache. Aktionsausführung und Regelprüfungen messen weiterhin frisch.

## Reproduzierbare Operationszählung

Ausführen: `node tools/diagnose-token-movement.mjs`.

Das Skript importiert die tatsächlichen Modul-Hooks, Scheduler und Abgleichfunktionen. Dokumente, Eventloop, Renderer und Mess-API sind kontrollierte Ersatzobjekte. Es verändert keine Foundry-Welt und benötigt keine Zusatzpakete. Die Szenarien werden separat ausgeführt; die Zahlen sind keine zusammenhängende Live-Messung und keine CPU-Prozentwerte.

| Szenario | Vorher | Nachher |
| --- | ---: | ---: |
| 60 Sicht-Ereignisse in getrennten Frames, 100 Tokens ohne laufende Bewegung; Sichtbestand bereits initialisiert | 60 vollständige HUD-Aufrufe, 12.000 Token-Flagabfragen | 0 vollständige HUD-Aufrufe, 0 Token-Flagabfragen |
| 6.000 reine `refreshToken`-Ereignisse ohne Bewegungsbuttons | 0 Token-Flagabfragen, 0 HUD-Aufrufe | unverändert 0 / 0 |
| 100 Token-Drehungsupdates, 100 Combatants | 10.000 synchrone Routen-Flagabfragen und ein gebündelter Buttonabgleich | 0 synchrone Abfragen; ein Routen- und ein Buttonabgleich mit zusammen 300 Flagabfragen |
| 60 HUD-Distanzabrufe bei unveränderter Historie mit 101 Wegpunkten | 60 vollständige Pfadmessungen | 1 vollständige Pfadmessung |

Die erste Initialisierung oder ein tatsächlicher Sichtwechsel kann weiterhin einen Abgleich auslösen. Bei 60 zusätzlichen Anforderungen während eines absichtlich verzögerten HUD-Aufbaus läuft höchstens ein Aufbau gleichzeitig; anschließend folgt ein zusammengefasster Folgeaufbau.

Die Kosten einer einzelnen Chat-Sammlung werden durch diese Korrektur nicht weiter reduziert: 60 ausdrücklich angeforderte Sammlungen mit jeweils 200 Angriffen und 200 verknüpften Abwehren erzeugen weiterhin 144.000 Nachrichten-Kontextabfragen. Entscheidend ist, dass unveränderte Animationsframes diese Sammlungen nicht mehr anfordern und ein vollständiger HUD-Aufbau seine Sammlung intern wiederverwendet. `maxCards` begrenzt weiterhin nur die angezeigten Karten, nicht die zuvor geprüfte Historie.

## Verifikation und Grenzen

- `npm.cmd run check`: 764 Tests erfolgreich; zusätzliche Regelprüfung mit 79 Tests erfolgreich. Regelkern: 99,11 % Zeilen-, 81,02 % Zweig- und 100 % Funktionsabdeckung.
- Neue Regressionen sichern Aufrufgrenzen über mehrere Frames, sofortiges Ausblenden verborgener Ziele, historische Kartenziele, parallele Renderanforderungen, Fehlerbehandlung, Szenenwechsel, Cacheinvalidierung und aktuelle Regelmessungen ab.
- Lokaler Browser mit tatsächlichem HUD-Controller, View, DOM und Styles sowie kontrollierten Foundry-Dokumenten: alle 21 Prüfungen erfolgreich. Darunter 60 Animationsframes ohne vollständige Aufbauten, Angriffsgeschwindigkeitsberechnungen oder Chat-Sammlungen; identische HUD-/Chat-DOM-Knoten, erhaltenes offenes Zielmenü, aktuelle Entfernungen und Reichweiten, Sichtverlust/-rückkehr sowie persönliche Aktionen bei gemeinsamem Actor und verborgenem Zug.
- Foundry-Quellen lokal geprüft: `client/canvas/placeables/token.mjs`, `client/canvas/perception/perception-manager.mjs`, `client/canvas/groups/visibility.mjs`; installierte Version laut `resources/app/package.json`: 14.361.
- Die Leistungsverbesserungen und die bereits vorhandene Kompatibilitätskorrektur aus `098c66e` wurden lokal installiert und per SHA-256 geprüft. Anschließend wurden der deutlichere GSW-0-Hinweis und das durchgestrichene Lauf-Symbol ebenfalls mit Sicherung und Prüfsummenvergleich übernommen. Spielweltdaten wurden nicht verändert.
- Kein Live-Profil der Spielszene und keine Messung der aktivierten Sichtanimationseinstellung. Foundrys Beleuchtung, Wände, GPU-Arbeit und andere Module können zusätzlich beitragen. Ein geöffneter Foundry-Client muss nach Übernahme der Dateien neu laden, um die Korrekturen zu verwenden.
