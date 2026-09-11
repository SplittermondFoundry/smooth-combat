# Tokenbewegung: Leistungsprüfung und Korrektur

## GIF-Regressionsfall: kurz einklappende Angriffskarte

Das bereitgestellte GIF zeigte bei ungefähr 7,8–8,3 s, 19,8–20,3 s und 30,1–30,5 s wiederholte Höhensprünge des HUDs. Die aufgeklappte Angriffskarte „Albenbogen +2 (Relikt)“ verschwand kurz, bevor sie wieder eingeblendet wurde. Der Effekt begann bereits bei der Bewegungsbuchung, teilweise vor dem Wechsel des aktiven Charakters.

Der neue Browsertest reproduzierte den Fehler vor der Korrektur mit dem tatsächlichen Karten-View und HUD-Controller: Die äußere Ereignisgruppe war nach einem vollständigen Aufbau geschlossen, ihre innere Angriffskarte aber weiterhin offen. Die HUD-Höhe fiel von **762 auf 453 Pixel**. Ein verzögertes natives `toggle`-Ereignis öffnete die Gruppe anschließend wieder. Die bisherige Wiederherstellung schloss Karten fremder Charaktere auch bei unverändertem Kartenbestand und widersprach damit der gespeicherten manuellen Auswahl.

Bei unverändertem Ereignisbestand erhält die Workflow-gesteuerte Ansicht jetzt die manuell gewählte Historie unabhängig vom aktiven Charakter. Neue Workflow-Schritte übernehmen weiterhin den Fokus; abgeschlossene automatische Fokusse werden weiterhin geschlossen. Die Aktivierung der Kartenüberschriften verarbeitet das Accordion synchron. Programmatisch erzeugte, verzögerte `toggle`-Ereignisse ändern die Kartenwahl nicht mehr. Außerdem erfasst der Renderer den aktuellen Aufklappzustand unmittelbar vor dem Austausch des Inhalts, sodass Eingaben während des asynchronen Aufbaus nicht verloren gehen.

Verifikation: `npm.cmd run check` mit **776 erfolgreichen Tests** und zusätzlich **80 Regeltests**; Regelkern 99,11 % Zeilen-, 81,05 % Zweig- und 100 % Funktionsabdeckung. **Alle 114 Browserprüfungen bestanden.** Der zuvor fehlschlagende Test hielt die HUD-Höhe beim Neuaufbau durchgehend bei 762 Pixeln. Bei der kombinierten Bewegungsbuchung, den Charakterwechseln und automatischen Bewegungen mit offener fremder Angriffskarte wurde in keinem der 52 beobachteten Animationsframes eine eingeklappte Karte festgestellt. Zusätzlich geprüft wurden manuelles Öffnen und Schließen während langsamer Aufbauten, exklusive Kartenwahl und der Abschluss eines automatisch fokussierten Workflows.

Die Browserregression verwendet `tools/hud-event-state-regression.js` über `tools/hud-canvas-regression.html`, mit realem HUD-/Karten-DOM und kontrollierten Foundry-Dokumenten. Sie reproduziert den sichtbaren Zwischenzustand aus dem GIF; eine CPU-/GPU-Messung der laufenden Spielwelt ist damit nicht verbunden.

Die drei Laufzeitdateien wurden lokal installiert und per SHA-256 bestätigt. Die vorherigen Dateien und das Installationsprotokoll liegen unter `tmp/hud-card-state-backup-1789163933453`. Geöffnete Foundry-Clients müssen neu laden.

## Nachbesserung vom 11. September 2026: automatische Bewegung beim Charakterwechsel

Der nach dem manuellen Ziehen behobene Pfad deckte die automatische Bewegung noch nicht vollständig ab. `advancePendingMovements` und `syncDefaultMovementRoutePreviews` forderten nach Fortschritt oder Abschluss weiterhin einen vollständigen HUD-Aufbau an. Dasselbe galt für die Statuspflege laufender Bewegungen und das Entfernen ihrer Unterbrechungsaufforderungen. Zusätzlich konnte ein Sichtframe beim Zugwechsel das bisherige HUD ausblenden, und der Renderer veröffentlichte den neuen Kontext bereits vor dem Abschluss seines asynchronen Aufbaus.

Diese Bewegungspfade verwenden jetzt gebündelte Teilaktualisierungen. Die ausgewählte Bewegungsroute und ihre Abbruchknöpfe werden an der bestehenden Position im HUD aktualisiert oder entfernt; offene Menüs, Aktionsbuttons und die HUD-Schale bleiben bestehen. Entfallene Unterbrechungsaufforderungen verschwinden einzeln. Token-Flagupdates stoßen den Abgleich auch auf Clients an, die die Bewegung nicht selbst ausführen. Positionsupdates allein sammeln weiterhin keine Karten vor dem Bewegungsende.

Beim gewöhnlichen Zugwechsel bleibt das bisherige HUD sichtbar, bis der neue Charakter fertig aufgebaut ist. Währenddessen ist es über `inert` nicht bedienbar. Verdeckte Kontexte, Szenenwechsel und relevante Rechtewechsel verbergen die vorherige Anzeige weiterhin sofort. Der neue Canvas-Kontext wird erst mit der Montage übernommen. Sichtänderungen und Bewegungsabschlüsse während des Aufbaus werden vor dem nächsten Paint in dessen synchronen Teilbereichen nachgezogen, statt den teuren Aufbau neu zu starten. Andere Dokumentänderungen und Abschlüsse, die etwa die Kampfposition ändern, behalten ihre vollständige Aktualisierung.

Prüfung: `npm.cmd run check` mit **773 erfolgreichen Tests** und zusätzlich **79 Regeltests**; Regelkern weiterhin 99,11 % Zeilen-, 81,02 % Zweig- und 100 % Funktionsabdeckung. Neue Tests prüfen außerdem Statuspflege, Routenfortschritt, mehrere Unterbrechungsaufforderungen, verschachtelte und flache Flagupdates sowie den ausstehenden Kontext beim Zugwechsel.

Die Browserprüfung `tools/hud-canvas-regression.html` verwendet zusätzlich `tools/hud-turn-movement-regression.js` mit den tatsächlichen Lifecycle-Hooks, der automatischen Bewegungslogik und dem HUD-Renderer. **Alle 79 Browserprüfungen bestanden.** Foundry-Dokumentpersistenz, Tokenanimation und PIXI-Objekte sind kontrollierte Adapter. Pro geprüftem Versionswert (14.2.7 und 14.3.0-beta3) startet beim Charakterwechsel **genau ein** vollständiger HUD-Aufbau. Der nachfolgende Bewegungsschritt, Routenfortschritt, Historienreset und finale Abschluss erzeugen **keinen weiteren** vollständigen Aufbau und keine zusätzliche Angriffsgeschwindigkeitsberechnung. Sichtverluste während des verzögerten Aufbaus werden vor dessen Anzeige übernommen. Die Tests laden keine vollständigen Systeminstallationen und messen keine CPU-/GPU-Last der Spielwelt.

Die zehn geänderten Laufzeitdateien wurden nach der Prüfung lokal installiert. Der Installer akzeptierte nur den bekannten vorherigen Stand, sicherte alle ersetzten Dateien unter `tmp/turn-movement-backup-1789149473760` und bestätigte jede neue Datei per SHA-256. Das dortige `receipt.json` dokumentiert die Zielpfade und Prüfsummen. Alle geöffneten Foundry-Clients müssen neu laden.

## Ergänzung vom 11. September 2026: verbleibendes HUD-Flackern

Die Prüfung von 0.6.4 zeigte einen übersehenen Auslöser: `recordToken` forderte bei aktivierter Bewegungsverfolgung weiterhin einen vollständigen HUD-Aufbau an. Foundry sendet diesen Hook beim Speichern oder Leeren der Bewegungshistorie, unabhängig von der Splittermond-Systemversion. Außerdem blendete der bisherige Sichtvergleich bei veränderten sichtbaren Beteiligten das gesamte HUD bis zum nächsten Aufbau aus.

Die Nachbesserung leitet aufgezeichnete Bewegungen an die bestehende Teilaktualisierung weiter. Nur die Historie des im Bewegungstracker dargestellten Tokens ist dafür relevant. Andere aufgezeichnete Tokens planen keinen zusätzlichen Frame. Zurücksetzen und Rückgängigmachen aktualisieren ebenfalls die vorhandene Anzeige.

Bei unverändertem Kampf-, Akteur- und Controller-Kontext werden Sichtwechsel jetzt synchron in den betroffenen DOM-Teilen angewendet: Zielauswahl, Zielporträts, Zielbeschriftung, Abwehrmöglichkeiten, Tick-Sperren und Kampfereignisse. Unveränderte Teilbäume behalten ihre DOM-Knoten, Listener, geöffneten Menüs und lokalen Anzeigezustände. Eine WeakMap merkt sich dafür ausschließlich das zuletzt erzeugte Markup; Sichtrechte und Dokumentdaten werden weiterhin frisch ausgewertet. Beim vollständigen Aufbau und Canvas-Abbau wird sie verworfen. Neue Steuerelemente erhalten ihre Listener einmalig. Die Reihenfolge ansonsten identischer sichtbarer Kandidaten löst keine Arbeit aus.

Animationsframes und der Historien-Hook sammeln weiterhin keine Chatnachrichten. Ein tatsächlicher Sichtwechsel aktualisiert die betroffenen Kartendarstellungen und Rechte mit einer frischen Sammlung. Nach dem Bewegungsende erfolgt ebenfalls eine gebündelte Teilaktualisierung, damit entfernungsabhängige Verteidiger-Möglichkeiten aktuell bleiben. Im minimierten HUD entfällt diese Sammlung. Ein paralleler Dokumentaufbau mit veraltetem Zielkontext wird verworfen und ersetzt. Szenen-, Zug- und Controllerwechsel verwenden weiterhin einen vollständigen Aufbau.

Prüfung: `npm.cmd run check` mit 768 erfolgreichen Tests und zusätzlich 79 Regeltests. `node tools/diagnose-token-movement.mjs` zählt für 60 getrennte `recordToken`-Ereignisse jetzt 0 vollständige HUD-Aufrufe; 99 andere aufgezeichnete Tokens planen 0 Frames. Die übrigen Operationsgrenzen bleiben erhalten.

Die Browserregression liegt unter `tools/hud-canvas-regression.html` und kann über einen lokalen HTTP-Server aus dem Repository-Stamm geöffnet werden. Alle 53 Prüfungen bestanden mit echten HUD-Views, Controller, DOM und Styles sowie kontrollierten Foundry-Dokumenten. Sie prüfen unter anderem erhaltene Porträts und Chat-Knoten, sofort entfernte historische Zielnamen, Bewegung und Historienreset, geöffnete Zielmenüs, Eingabefokus, Abwehrwechsel durch Sicht und Entfernung, minimiertes HUD und konkurrierende Dokumentaufbauten. Die Systemversionswerte 14.2.7 und 14.3.0-beta3 wählen die jeweiligen Modul-Hooks; die Seite lädt keine zwei vollständigen Splittermond-Systeme. Es handelt sich weiterhin um Funktions- und Operationsprüfungen, nicht um eine CPU-/GPU-Messung der Spielwelt.

Die sieben geänderten Laufzeitdateien wurden am 11. September in die lokale Foundry-Installation übernommen, nach Abgleich mit dem unveränderten Ausgangsstand und mit Sicherung aller vorhandenen Dateien. Alle sieben Prüfsummen stimmen mit dem geprüften Workspace überein. Der geöffnete Foundry-Client muss neu laden, damit die Korrektur aktiv wird.

## Ursprüngliche Prüfung vom 9. September 2026

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
