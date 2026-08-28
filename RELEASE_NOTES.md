# Splittermond Smoother Fight 0.6.0

> In Vorbereitung – noch nicht veröffentlicht.

Dieses Update macht mehrstufige Kampfvorgänge ausfallsicherer. Begonnene und erfolgreich abgeschlossene Anwendungen werden nun getrennt behandelt, damit ein bestätigter Fehlschlag keinen dauerhaft gesperrten Zustand hinterlässt.

## Neue Funktionen

- Die Spielleitung erhält einen kleinen, ausschließlich für sie sichtbaren **Cheat-Button**. Nach dem Aktivieren lassen sich die Einzelwerte des nächsten tatsächlich ausgeführten Würfelwurfs festlegen – von 1W6-Schaden bis zur vierwürfeligen Risikoprobe. Interne HUD-Berechnungen werden ignoriert und Spieler erhalten keinen Hinweis auf Aktivierung oder Eingabe. Zufall ist damit optional – aber nur für die SL.
- Angriffe sowie Waffen und Schilde im Bereich **Ausrüstung** besitzen jetzt einen kompakten Tooltip nach dem Vorbild der Zauber. Er zeigt Fertigkeit, WGS, Schaden, Merkmale, bei Fernkampfangriffen die Reichweite und relevante Zustände wie **Standardangriff**, **vorbereitet** oder **ausgerüstet**. Ausgerüstete Gegenstände verwenden die aktuell berechneten Angriffswerte, nicht ausgerüstete Gegenstände ihre hinterlegten Basiswerte; der Tooltip ist per Mauszeiger und Tastaturfokus erreichbar.
- Das HUD zeigt die gemessene Entfernung direkt am Primärziel und kennzeichnet Angriffe sowie zielabhängige Zauber als in Reichweite, gegebenenfalls außer Reichweite oder nicht automatisch prüfbar. Eine mögliche Überschreitung erzeugt beim tatsächlichen Auslösen nur eine Warnung und blockiert den Wurf nicht. Für Nahkampf wird von einer Standardreichweite von **2 m** ausgegangen; die Spielleitung kann diesen Wert in den Moduleinstellungen ändern.
- Bei mehr als acht Zaubern erhält das Zaubermenü automatisch eine Suche über Name, Magieschule, Grad, Fokuskosten und Zauberdauer. Zusätzlich kann nach ausreichendem Fokus sowie – sofern mehrere Werte vorhanden sind – nach Magieschule und Grad gefiltert werden. Suchbegriff, Filterauswahl und Scrollposition bleiben bei einer Neudarstellung des HUDs erhalten.
- **Zielen** und **Lücke suchen** werden nun als kampfgebundene Vorbereitungen im HUD fortgeführt. Nach einer frei gewählten Dauer von 2, 4 oder 6 Ticks erscheint der Bonus von +1 bis +3 beim passenden Folgeangriff als vorausgewählter, benannter Modifikator und wird erst nach dem tatsächlich ausgeführten Angriff verbraucht. **Zielen** bleibt dabei an die vorbereitete Fernkampfwaffe und das angesagte Ziel gebunden; **Lücke suchen** gilt für den nächsten Nahkampfangriff.
- Zauberproben gegen ein Ziel mit aktivem Zaubereffekt **Kleiner Magieschutz** erhalten automatisch einen vorausgewählten Malus von −1. Enthält der Name desselben Effekts **Verstärkt**, ersetzt **Kleiner Magieschutz (Verstärkt)** mit −2 den normalen Malus vollständig. Der temporäre Systemeintrag existiert nur beim Aufbau des zugehörigen Würfeldialogs und kann dadurch nicht in spätere Proben gegen ungeschützte Ziele gelangen.
- Angriffe besitzen nun eine eindeutige **Abwehrphase**: Bevor Erfolgsgrade ausgegeben, Fokus oder Schaden verarbeitet oder Ticks weitergesetzt werden können, muss die Aktive Abwehr abgeschlossen oder ausdrücklich abgelehnt werden. Der Aktive-Abwehr-Button ist dafür als geteilte Schaltfläche sowohl direkt auf der Angriffskarte als auch unten links im HUD verfügbar; ein auffälliges rotes **X** bestätigt den Verzicht. Solange die Entscheidung aussteht, weist ein kurzer Hinweis über den Erfolgsoptionen darauf hin und verhindert eine verfrühte Hervorhebung nachgelagerter Aktionen.

## Verbesserungen und Fehlerbehebungen

- Optimierung des Release-Prozesses.
- Neu berechnete Angriffskarten nach einer **Aktiven Abwehr** behalten den ursprünglichen Würfelwurf, lösen diesen in **Dice So Nice** aber nicht länger ein zweites Mal als 3D-Animation aus und erscheinen erst nach dem vollständigen Abschluss des Abwehrwurfs.
- Wird ein knapp misslungener Angriff durch einen nachträglich eingesetzten **Splitterpunkt** erfolgreich, öffnet sich die Abwehrphase nun ohne Reload. Die **Aktive Abwehr** erscheint sofort auf der Angriffskarte; auch bereits beim Modulstart dargestellte Karten erhalten zuverlässig die rote Verzichtsoption.
- Vorbereitete Fernkampfangriffe und Zauber passen ihre Aktionsbeschriftung jetzt an die tatsächlich verfügbare Breite an. Dadurch überlagern lange Bezeichnungen wie **Vorbereiteter Fernkampfangriff** nicht mehr die Schaltfläche zum Auslösen.
- Schadensanwendungen verwenden ein eindeutiges Zustandsmodell: **bereit → wird angewendet → abgeschlossen**. Ein begonnener Versuch gilt nicht länger automatisch als erfolgreich.
- Kann sicher festgestellt werden, dass kein Schaden angewendet wurde – etwa weil das Ziel fehlt, nicht berechtigt ist oder Kosten nicht verbraucht werden konnten –, wird die Aktion für einen erneuten Versuch freigegeben.
- Ist nach einem Fehler unklar, ob eine Änderung bereits wirksam wurde, bleibt der Vorgang vorsorglich gesperrt. Die Spielleitung kann ihn nach Prüfung erneut freigeben oder als abgeschlossen markieren.
- Dasselbe Verhalten schützt den **Betäubungsschaden aus Aktiver Abwehr** sowie weitere mehrstufige Vorgänge: Splitterpunkte bei Aktiver Abwehr, Patzerfolgen, ältere Chatkarten mit Tickkosten, das Vorbereiten von Angriffen und Zaubern und das Rückgängigmachen von Bewegung.
- Die Aktionsbuttons sämtlicher Kampf-, Priester- und Zaubererpatzer werden jetzt aus den tatsächlichen mechanischen Folgen der Splittermond-Tabelle erzeugt. Doppelt verlinkte Zustände werden nur einmal angewendet, beschreibende Formulierungen mit „oder“ erzeugen keine falsche Auswahl und **Benommen 2** aus dem Kampfpatzer erhält zuverlässig seine Dauer von 30 Ticks.
- Patzerzustände werden am Actor des betroffenen Tokens angelegt. Dabei werden vorhandene Welt-Items bevorzugt; stehen diese nicht zur Verfügung, folgen UUID beziehungsweise Kompendium und schließlich vollständige lokale Vorlagen für alle vorkommenden Zustände. Der Waffenpatzer erhöht außerdem den persistenten Gegenstandsschaden der tatsächlich verwendeten Waffe oder des Schildes korrekt von **unbeschädigt** zu **angeschlagen** und anschließend zu **demoliert**.
- Die **Splitterpunkt-Resonanz** richtet sich jetzt korrekt nach unterschiedlichen Splitterträgern statt nach deren Foundry-Benutzerzuordnung. Dadurch können auch zwei Figuren desselben Spielers oder mehrere von derselben Spielleitung gesteuerte NSC einander regelkonform unterstützen.
- Wird ein Angriffs- oder Zauberwurf im Systemdialog abgebrochen, wird der zwischengespeicherte Angriffs- und Zielkontext sofort verworfen. Ein anschließender Wurf derselben Figur kann dadurch weder die alte Angriffsart noch alte Ziele übernehmen; gleichzeitig laufende Würfe räumen nur ihren jeweils eigenen Kontext auf.
- Bei manuellen offensiven Würfen außerhalb des Kampf-HUDs wird der Zielkontext jetzt vom Würfelautor übernommen. Würfelt die Spielleitung vom Bogen eines online kontrollierten Spielercharakters, wird damit das auf dem GM-Client verwendete Ziel gespeichert und nicht versehentlich das Ziel des Spielers.
- Gleichzeitige Klicks und wiederholte Anfragen werden während einer laufenden Anwendung abgefangen, ohne einen Fehlversuch fälschlich als Erfolg zu speichern.
- Aktualisiert ein Splitterpunkt eine **Aktive Abwehr**, während deren erste Auswertung noch läuft, wird die neue VTD nun anschließend zuverlässig verarbeitet statt verworfen. Dadurch bleiben auch Waffenmerkmale wie **Defensiv** und der zusätzliche Erfolgsgrad des Splitterpunkts gemeinsam wirksam.
- Die HUD-Handlung **Schildstoß** verwendet jetzt die besonderen Regelwerte: 1W6+1 Schaden, 7 Ticks Grunddauer und freie Manöver, aber keine Meisterschafts-Manöver. Die falsche Hand wird einschließlich ihrer Ausnahmen durch **Kampf mit zwei Waffen** und **Starker Schildarm I** berücksichtigt; der allgemeine Tick-Zuschlag aus Ausrüstung bleibt wirksam.
- Nicht mehr verwendete Zusatzanzeigen für **VTD, KW und GW** wurden aus dem Kampf-HUD entfernt. Die Abwehrwerte bleiben weiterhin im Actor-Portrait und im Menü **Aktive Abwehr** verfügbar.
- Die Zielanzeige berücksichtigt nun durchgehend die Wahrnehmung des aktuellen Benutzers. Verborgene oder durch Sichtlinie, Beleuchtung und Fog of War nicht sichtbare Tokens erscheinen für Spieler weder in der Schnellzielauswahl noch als gespeicherte Primär- oder Sekundärziele, in Kampfereignissen oder im Feedback; die Spielleitung sieht weiterhin alle Tokens.
- Die Zuordnungseinstellungen trennen nun klar zwischen der dauerhaften Zuordnung (**direktes Token → Bogen → Foundry-OWNER**) und der vorübergehenden Laufzeitsteuerung (**aktiver zugeordneter Benutzer → aktiver Primary GM → anderer aktiver GM**).
- Greift diese vorübergehende Vertretungsregel, erhält der vertretende GM jetzt auch die Hervorhebung für die sinnvoll nächste Handlung auf den zugehörigen Kampf- und Abwehrkarten.
- Die Zuordnungseinstellungen warnen jetzt bereits bei der Auswahl, wenn einem zugeordneten Spieler die erforderliche Foundry-**OWNER**-Berechtigung für den Bogen oder das direkt zugewiesene Token fehlt. Die Warnung bietet einen direkten Link zum betroffenen Bogen; Berechtigungen werden weiterhin nicht automatisch verändert.
- Nicht verbrauchte Boni aus **Zielen** und **Lücke suchen** werden beim Kampfende sowie beim Entfernen des zugehörigen Kampfteilnehmers zuverlässig gelöscht und können nicht in einen späteren Kampf übernommen werden.
- Fehlt der auswählbare Systemeintrag für die Meisterschaft **Verteidiger**, wird der Malus von −3 im Abwehrdialog dynamisch als vorausgewählter Modifikator mit eindeutiger Herkunft angezeigt. Nach dem Würfelwurf oder dem Abbruch des Dialogs wird der temporäre Eintrag wieder entfernt.
- Neue automatisierte Tests decken erfolgreiche Anwendungen, sicher erkennbare Fehlschläge, unklare Ergebnisse, Wiederholungsversuche und konkurrierende Aufrufe ab.

## Installation

In Foundry unter **Add-on-Module → Modul installieren** diese Manifest-URL verwenden:

```text
https://github.com/SplittermondFoundry/smooth-combat/releases/latest/download/module.json
```

Das Release wird außerdem ein ZIP für die manuelle Installation enthalten.
