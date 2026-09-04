# Splittermond Smoother Fight 0.6.0

Dieses große Update erweitert den Kampfablauf deutlich und macht mehrstufige Aktionen, Bewegungen und Abwehrentscheidungen zugleich übersichtlicher und ausfallsicherer.

## Voraussetzungen und Kompatibilität

- Foundry Virtual Tabletop 14 ab Build **14.359**, verifiziert mit **14.363**
- Splittermond-System ab Version **14.3.0-alpha4**
- Für ein reguläres Update von Smoother Fight 0.5.0 sind keine manuellen Migrationsschritte erforderlich.

## Große neue Funktionen

- Das Kampf-HUD führt Angriffe, neu berechnete Ergebnisse, Aktive Abwehr, Schaden und Patzer jetzt als zusammenhängende **Kampfvorgänge**. Automatisch geöffnet bleibt genau die Karte mit dem nächsten ausstehenden Schritt; ältere Karten werden zu einklappbaren Verlaufseinträgen. Offene Vorgänge bleiben unabhängig von der eingestellten Kartenanzahl sichtbar und erfassen auch Gelegenheitsangriffe außerhalb des aktiven Combatants.
- **Kontinuierliche Handlungen** besitzen einen kampfgebundenen Zustand mit Start- und Abschluss-Tick. Ein benannter Token-Status zeigt die laufende Handlung an. Fernkampfwaffe bereitmachen, Magie fokussieren, Zielen und Lücke suchen bleiben bis zur zugehörigen Probe bestehen und werden durch einen abgebrochenen Würfeldialog nicht verbraucht.
- Schaden während einer kontinuierlichen Handlung erzeugt eine **Entschlossenheitsprobe** gegen 10 + Schaden; Erfolgsgrade aus **Störender Angriff** erhöhen die Schwierigkeit um jeweils 3. Misslingen beendet die Handlung und ihre Vorbereitungen, ein nachträglich erfolgreicher Splitterpunkteinsatz kann sie rechtzeitig wiederherstellen. Auch Aktive Abwehr berücksichtigt die Unterbrechung; **Koordiniertes Ausweichen** bleibt als Regelausnahme erhalten.
- **Kriechen, Laufen und Sprinten** verwenden jetzt die zuvor auf dem Spielfeld gewählte Foundry-Route und bewegen den Token sichtbar über Zwischenpunkte zum Ziel: Kriechen bei Tick 5, Laufen bei Tick 3 und 5 sowie Sprinten bei Tick 3, 5, 7 und 10. Mehrere tokenfarbige Routen können parallel angezeigt werden. Die Standardanzeige ist pro Client abschaltbar; eine Welteinstellung kann Routen auf den betroffenen Spieler und die Spielleitung beschränken.
- Die Kampfpositionen **Stehend, Kniend, Liegend und Fliegend** lassen sich im Kampf-HUD und Token-HUD festlegen. Eigene und gegnerische Nah- und Fernkampfangriffe sowie Zauber gegen VTD erhalten automatisch die regelgerechten, nur für den jeweiligen Würfeldialog gültigen Positionsmodifikatoren.
- Angriffe besitzen eine verbindliche **Abwehrphase**. Ziel und erreichbare Charaktere mit **Verteidiger** würfeln oder verzichten unabhängig voneinander; erst danach werden Schaden, Erfolgsgradoptionen und Angriffsticks freigegeben. Solange die Entscheidung, der Wurf oder die Abwehr-Tickzahlung aussteht, sind gewöhnliche Tickaktionen im Spieler-HUD gesperrt; die Spielleitung kann weiterhin korrigierend eingreifen. Mehrere Verteidigerwürfe sind möglich, wobei die höchste tatsächlich erzeugte VTD einschließlich **Defensiv** zählt.

## Weitere neue Funktionen

- Ziele mit 0 LP können von der Spielleitung direkt am Portrait als **besiegt** markiert werden. Foundrys Besiegt-Status und das Totenkopf-Overlay werden dabei gemeinsam gesetzt oder entfernt.
- Ein ausschließlich für die Spielleitung sichtbarer **Cheat-Button** kann die Einzelwerte des nächsten tatsächlich ausgeführten Würfelwurfs vorgeben, ohne den Spielern Aktivierung oder Eingabe anzuzeigen.
- Angriffe, Waffen und Schilde besitzen neue kompakte Tooltips. Die Zauber-Tooltips zeigen zusätzliche Regeldetails wie Magieschule, Grad, Schwierigkeit, Kosten, Reichweite, Dauer, Wirkungsbereich, Typus und Merkmale.
- Das HUD zeigt die gemessene Entfernung zum Primärziel und warnt bei möglicherweise überschrittener Angriffs- oder Zauberreichweite, ohne den Wurf zu blockieren. Die angenommene Nahkampfreichweite ist als Welteinstellung konfigurierbar.
- Kampfhandlungs-Chatkarten werden auf jedem Client in dessen eigener Sprache dargestellt. Bereits vorhandene Standardkarten werden beim Anzeigen ebenfalls neu lokalisiert.
- Bei mehr als acht Zaubern erhält das Zaubermenü eine Suche sowie Filter nach verfügbarem Fokus, Magieschule und Grad. Suchbegriff, Filter und Scrollposition bleiben bei einer Neudarstellung erhalten.
- **Zielen** und **Lücke suchen** verleihen nach 2, 4 oder 6 Ticks einen vorausgewählten Bonus von +1 bis +3 auf den passenden Folgeangriff. Zielen bleibt an Fernkampfwaffe und Ziel gebunden; Lücke suchen gilt für den nächsten Nahkampfangriff.
- **Kleiner Magieschutz** erzeugt bei Zauberproben gegen das betroffene Ziel automatisch einen vorausgewählten Malus von −1 beziehungsweise −2 bei der verstärkten Variante. Das gilt auch für Würfe aus Action-Bar, Charakterbogen und Systemmakros.

## Wichtige Verbesserungen und Fehlerbehebungen

- **Aufstehen (Liegend)** und **Aufstehen (Kniend)** setzen die Kampfposition am erfolgreich erreichten Abschluss-Tick auf Stehend. Unpassende Ausgangspositionen werden vorab bestätigt; abgebrochene oder unterbrochene Handlungen ändern die Position nicht.
- HUD, Ticker und Hintergrundabläufe verwenden den aktiven Kampf der dargestellten Szene. Nach Reload, Szenenwechsel oder Änderungen am Kampf wird der exakt passende Token gewählt; gleichnamige oder nicht mehr beteiligte Tokens werden nicht ersatzweise übernommen.
- Der angreifende Combatant wird nicht mehr als Verteidiger seines eigenen Ziels angeboten. Eine Abwehrphase ohne weitere berechtigte Verteidiger endet nach dem Verzicht des Ziels sofort.
- Patzertabellen und Patzerfolgen bleiben nach einem Reload erledigt. Ihre Aktionsbuttons werden aus den tatsächlichen mechanischen Folgen erzeugt; Zustände, Dauer und Waffenschaden werden zuverlässig auf den betroffenen Actor beziehungsweise Gegenstand angewandt.
- Die HUD-Handlung **Schildstoß** verwendet jetzt 1W6+1 Schaden, 7 Ticks, freie Manöver und keine Meisterschafts-Manöver. Die falsche Hand und die Ausnahmen durch **Kampf mit zwei Waffen** und **Starker Schildarm I** werden berücksichtigt.
- Bewegungsabschnitte bleiben auch bei Foundrys Rasterkorrekturen und zerlegten Mehrpunktbewegungen korrekt nachverfolgbar. Ein fehlgeschlagener Abschluss verwirft den Plan nicht; tatsächlich gestoppte Bewegungen bleiben offen.
- Vorbereitete Zauber erhalten nach der Probe immer den regelgerechten Folgeschritt von **3 Ticks**, auch wenn der Zauber keine Option zum Verkürzen der Zauberdauer anbietet.
- Patzertabellen, Patzerfolgen und Unterbrechungsproben übernehmen jeweils den Workflow-Fokus, solange ihre mechanischen Schritte offen sind. Unberechtigte Spieler sehen keine ausführbaren Aktionsbuttons.
- Bestehende Schadens- oder Patzerkarten verhindern nach Reload zuverlässig, dass historische Folgebuttons erneut Schaden würfeln oder anwenden.
- Verborgene oder durch Sichtlinie, Beleuchtung und Fog of War nicht sichtbare Tokens erscheinen Spielern weder in Zielauswahl und gespeicherten Zielen noch in Kampfereignissen oder Feedback.
- Die Zuordnungseinstellungen erklären dauerhafte Zuordnung und vorübergehende GM-Vertretung klarer. Sie warnen außerdem, wenn einem zugeordneten Spieler die erforderliche Foundry-OWNER-Berechtigung fehlt.
- Nicht verbrauchte Boni aus Zielen und Lücke suchen werden beim Kampfende oder beim Entfernen des Combatants gelöscht. Ein fehlender Systemeintrag für **Verteidiger** wird vorübergehend als benannter Malus von −3 bereitgestellt.

## Kleine und unauffällige Korrekturen

- Abwehrbutton und roter Verzichtsbutton bleiben auch auf neu berechneten Angriffskarten als gemeinsame Schaltfläche angeordnet.
- Automatisch fokussierte Angriffskarten schließen nach der letzten Folgeaktion oder Tickzahlung wieder zuverlässig; manuell geöffnete Verlaufskarten bleiben offen.
- Erfolgreich bezahlte Aktive-Abwehr-Ticks bleiben in Chat und HUD deaktiviert, auch bei mehreren Tokens desselben Actors oder gleichzeitigen Oberflächenaktualisierungen.
- Die jeweils nächste Abwehr-, Patzer-, Unterbrechungs- oder Tickaktion wird eindeutiger hervorgehoben. Der defensive Splitterpunkt +3 VTD wird nur stark markiert, wenn er den Treffer verhindert.
- Zauber mit Reichweite **Zauberer** zeigen ohne passende **Hand des Zauberers** keinen irreführenden Dauerhinweis. Berührungsreichweite erkennt angrenzende Tokenflächen auf dem Raster.
- Portraitnamen, Portrait-Kopfzeilen und vorbereitete Aktionsbeschriftungen wurden für dunkle Bilder und schmale HUD-Breiten lesbarer gestaltet.
- Lange Zauber-Tooltips bleiben beim Wechsel mit der Maus geöffnet, sind scrollbar und passen ihre Größe an den verfügbaren Viewport an.
- Die Statussymbole für kontinuierliche Handlung und Bewegung werden auch in Firefox quadratisch und zentriert dargestellt.
- Relative Chat-Zeitstempel bleiben einzeilig und verändern nicht länger Nachrichtenhöhe oder Scrollposition; lange Absendernamen werden kontrolliert gekürzt.
- Neu berechnete Angriffskarten behalten den ursprünglichen Würfelwurf, lösen in **Dice So Nice** aber keine zweite 3D-Animation aus.
- Ein nachträglicher offensiver Splitterpunkt öffnet eine wieder verfügbare Abwehrphase sofort. Gleichzeitige Splitterpunkt- und Abwehrauswertungen verlieren weder Erfolgsgrade noch **Defensiv**.
- Splitterpunkt-Resonanz richtet sich nach unterschiedlichen Splitterträgern statt nach deren Benutzerzuordnung.
- Abgebrochene Angriffs- und Zauberdialoge verwerfen ihren Zielkontext. Manuelle GM-Würfe verwenden die Ziele des Würfelautors statt die eines online steuernden Spielers.
- Ein tatsächlich ausgeführter Angriff beendet eine vorbereitete Zauberhandlung; ein abgebrochener Angriffsdialog lässt sie bestehen.
- Nach einer erfolgreich ausgeführten Handlung klappt die Handlungsübersicht automatisch zu. Abbruch, fehlende Berechtigung oder Fehler lassen sie geöffnet.
- Vorübergehend noch nicht verfügbare Combatant-Actoren und die während Foundrys Init-Phase noch fehlende Core-Keybinding-Einstellung verhindern den Weltstart nicht mehr.

## Sicherheit, Stabilität und Technik

- Modul-Socketnachrichten verwenden nun die von Foundry authentifizierte Absenderidentität. Eine im Payload behauptete fremde Benutzer-ID wird verworfen.
- Spieleraktionen auf fremden Chatkarten werden autorisiert über den aktiven Primary GM ausgeführt. Absender, Berechtigung, Ziel-Token, angebotene Aktion und eindeutige Anfragekennung werden validiert; verspätete oder fremde Antworten können keine andere laufende Schadensanwendung entsperren.
- Kampfteilnehmer werden vorrangig über Combatant- und Token-ID aufgelöst. Teilen mehrere Tokens denselben Actor und ist keine eindeutige Zuordnung möglich, wird die Aktion sicher abgebrochen, statt den falschen Combatant zu verändern.
- Mehrstufige Anwendungen unterscheiden **bereit, wird angewendet, abgeschlossen und unklar**. Sicher fehlgeschlagene Aktionen können wiederholt werden; bei unklarem Ergebnis bleibt der Vorgang geschützt und kann von der Spielleitung geprüft, freigegeben oder abgeschlossen werden.
- Die zentrale Chat-Aktionslogik wurde in getrennte Module für Darstellung, Dispatch, Folgeaktionen, Tickablauf, Patzer, Altkompatibilität und Schadensanwendung aufgeteilt.
- Die automatisierten Tests decken erfolgreiche, fehlgeschlagene und unklare Anwendungen, Wiederholungen, konkurrierende Aufrufe, Berechtigungen und Wiederherstellung nach Reload ab.
- Der Release-Workflow prüft Tests, Manifestversion, Tag, Downloadpfad und Archivnamen, bevor Manifest und ZIP veröffentlicht werden.

## Installation

In Foundry unter **Add-on-Module → Modul installieren** diese Manifest-URL verwenden:

```text
https://github.com/SplittermondFoundry/smooth-combat/releases/latest/download/module.json
```

Das Release enthält außerdem ein ZIP für die manuelle Installation.
