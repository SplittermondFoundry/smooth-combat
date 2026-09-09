# Leistungsprüfung vom 9. September 2026

Ergänzung zur später gemeldeten Last beim Loslassen und Animieren von Tokens: [gezielte Prüfung und Korrektur der Tokenbewegung](docs/token-movement-performance.md). Wiederholte vollständige HUD-Aufrufe und Bewegungsflag-Abfragen über `sightRefresh` sind inzwischen behoben. Die unten beschriebenen früheren Optimierungen des separaten `refreshToken`-Pfads bleiben wirksam.

Geprüft wurden die lokalen Quellen, die Ereignis- und Renderpfade sowie eine Browser-Testszene mit der PIXI-Version aus der installierten Foundry-Anwendung. Es wurde kein CPU-, GPU-, Speicher- oder FPS-Profil der laufenden Spielwelt aufgenommen. Die folgenden Zahlen messen gezählte Operationen in reproduzierbaren Tests, keine prozentuale CPU-Ersparnis.

## Behobene Ursachen

### Bewegungsbuttons

Die bisherigen Buttons lagen als separate, fest positionierte HTML-Elemente über der Karte. Ihre Position wurde aus Canvas- und Browserkoordinaten berechnet. Dadurch hatten sie einen eigenen Aktualisierungszeitpunkt und folgten nicht unmittelbar der Transformation des gerenderten Tokens. Außerdem wurde bei jedem `refreshToken` und `canvasPan` die komplette Tokenliste geprüft: Bewegungsflags lesen, Combatants suchen, Stoppsegmente berechnen und HTML-Positionen schreiben. Das wiederholte Lesen von Canvas-Abmessungen zwischen DOM-Schreibzugriffen konnte zusätzliche Layoutarbeit auslösen.

Die Buttons sind jetzt native PIXI-Kinder des Tokens. Kameratranslation und laufende Tokenanimation werden über die gemeinsame Transformation übernommen. Eine Zoomänderung passt ausschließlich die Größe der bereits vorhandenen Buttons an. Reine Kartenverschiebung benötigt anschließend keine weitere Positionsberechnung. Die Schaltfläche bleibt innerhalb der Token-Klickfläche; kleine und nicht rechteckige Tokens werden berücksichtigt.

`refreshToken` bearbeitet nur den vorhandenen Button dieses Tokens. Dokument- und Berechtigungsänderungen werden höchstens einmal je Animationsframe zusammengeführt. Sichtänderungen aktualisieren vorhandene Buttons unmittelbar ohne erneute Bewegungsflag-Abfragen. Eine Stoppunktberechnung erfolgt für die Vorschau und beim tatsächlichen Abbruch. Tokens ohne Bewegung lösen keine zusätzliche Combatant-Suche aus. Aufgerufene Abbrüche prüfen weiterhin die aktuellen Rechte und die konkrete Handlungs-ID.

Regressionstest: 100 Tokens × 60 Refresh-Durchläufe ergeben **6.000 Ereignisse ohne erneute Bewegungsflag-Abfrage**. 100 gleichzeitig angeforderte Zustandsabgleiche ergeben **einen Abgleich**. Beim Szenenwechsel werden geplante Abgleiche abgemeldet und Buttons, Tooltip-Texturen und Vorschaumarker zerstört. Es gibt keinen neuen dauerhaften Ticker oder Polling-Timer.

### Kampfereignisse im Chat

Die Zuordnung jeder Abwehr suchte rückwärts durch alle Angriffe und las deren Kontext erneut. Schaden, Patzer und Unterbrechungen hatten weitere lineare Suchläufe. Bei vielen zusammengehörenden Nachrichten konnte dadurch quadratischer Aufwand entstehen.

Die Sammlung erstellt jetzt einmal lokale Indizes für Angriffs-, Abwehr- und Quellnachrichten. Direkte Verknüpfungen werden darüber aufgelöst. Der neueste neuberechnete Angriff erhält weiterhin die zugehörige Abwehr; Patzer und Unterbrechungen bleiben an ihrer Quelle. Die Indizes werden bei jeder Sammlung neu aufgebaut, damit nachträglich geänderte Flags und Würfelzustände sofort gelten. Alte Nachrichten ohne gespeicherte Verknüpfung behalten die zeitbasierte Ersatzzuordnung.

| Testfall | Vorher | Nachher |
| --- | ---: | ---: |
| Kontextabfragen bei 200 Angriffen und 200 verknüpften Abwehren | 22.300 | 2.400 |

Das entspricht rund **89 % weniger Kontextabfragen in diesem Testfall**. Die Zuordnungen wurden dabei vollständig geprüft. Dieser Wert ist keine Messung der gesamten HUD-Laufzeit.

## Verbleibende mögliche Last

- **HUD-Neuaufbau:** Token-, Actor- und Chat-Änderungen können weiterhin den Aufbau des gesamten HUDs anfordern. Asynchrone Aufbauten laufen jetzt nacheinander; währenddessen eingehende Anforderungen werden zusammengeführt. Sicht-/Animationsframes aktualisieren bestehende Anzeigen. Nur tatsächliche Änderungen sichtbarer Beteiligter erfordern dabei einen vollständigen Aufbau. Ein vollständiger Aufbau teilt seine Ereignissammlung intern zwischen den Verbrauchern.
- **Langer Chatverlauf:** Die Ereignissammlung sichtet weiterhin alle sichtbaren Chatnachrichten. Die Einstellung für die Anzahl angezeigter Karten begrenzt die Darstellung, nicht die gesamte Prüfung. Auch ältere offene Abwehren oder Unterbrechungen müssen erkannt werden. Viele historische Nachrichten und alte Karten ohne direkte Verknüpfungen können deshalb weiterhin mehr Zeit beanspruchen.
- **Routen und Sichtberechnung:** `updateToken` bündelt den Abgleich der Standard-Routenvorschauen jetzt je Animationsframe; `canvasPan` passt die Größe ihrer Segmentmarker an. Die verbleibenden Kosten wachsen mit der Anzahl aktiver Routen und Marker. Foundrys eigene Beleuchtung, Sichtberechnung, Animation und andere Module sind davon getrennte, hier nicht gemessene Kosten.
- **Leerlauf und Speicher:** Die geprüften Produktionsquellen enthalten keinen permanenten `setInterval`-Zyklus und keinen eigenen dauerhaften PIXI-Ticker. Die Canvas-Vorschauen werden explizit entfernt. Das ist kein Nachweis, dass die gesamte Anwendung frei von Speicherlecks ist; dafür wären Heap-Aufnahmen über längere Spielsitzungen erforderlich.

## Verifikation

- `npm.cmd run check`: 764 Tests einschließlich Architektur-, Asset- und Regelverträgen erfolgreich; zusätzliche 79 Regeltests erfolgreich.
- `tests/hud-canvas-performance.test.mjs`: begrenzte Renderaufrufe, unveränderte Bewegungshistorien, aktuelle Regelmessungen, Sichtverlust, historische Kartenziele, Renderwarteschlange und Szenenwechsel. Die ergänzende Browserprüfung des tatsächlichen HUDs besteht alle 21 Prüfungen; Einzelheiten stehen im verlinkten Bewegungsbericht.
- `tests/movement-tracking.test.mjs`: verschachtelte Canvas-Transformationen, Animation vor dem Dokumentupdate, Kamera/Zoom, Berechtigungen, Mehrfachklick, Neuzeichnen und Szenenwechsel; bestehende Segment- und Tickregeln bleiben abgesichert.
- `tests/combat-event-collection.test.mjs`: gezählte Kontextabfragen, direkte und alte Verknüpfungen, neuberechnete Angriffe, private Nachrichten und ältere offene Unterbrechungen.
- Lokaler Browser: tatsächliche PIXI-Bibliothek aus Foundry, Canvas mit Bildschirmversatz und Renderauflösung 2; Verschieben, Zoomen, Tokenanimation und Klick auf den Stop-Button. Der Abbruch auf Tick 14 setzte den Sprint auf die Hälfte und ließ den regulären Zug auf Tick 20 bestehen.

Für eine weitere Leistungsoptimierung sollte zuerst die betroffene Foundry-Szene beim Verschieben der Karte und bei einer Gruppenbewegung profiliert werden. Dabei sind Dauer und Häufigkeit von HUD-Aufbau, Ereignissammlung und Routenvorschau sowie die GPU-/Sichtarbeit von Foundry getrennt zu betrachten. Erst diese Messung kann zeigen, welcher verbleibende Anteil auf dem verwendeten Rechner tatsächlich spürbar ist.
