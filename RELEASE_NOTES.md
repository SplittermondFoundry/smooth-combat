# Splittermond Smoother Fight 0.6.0

> In Vorbereitung – noch nicht veröffentlicht.

Dieses Update macht mehrstufige Kampfvorgänge ausfallsicherer. Begonnene und erfolgreich abgeschlossene Anwendungen werden nun getrennt behandelt, damit ein bestätigter Fehlschlag keinen dauerhaft gesperrten Zustand hinterlässt.

## Neue Funktionen

- Angriffe sowie Waffen und Schilde im Bereich **Ausrüstung** besitzen jetzt einen kompakten Tooltip nach dem Vorbild der Zauber. Er zeigt Fertigkeit, WGS, Schaden, Merkmale, bei Fernkampfangriffen die Reichweite und relevante Zustände wie **Standardangriff**, **vorbereitet** oder **ausgerüstet**. Ausgerüstete Gegenstände verwenden die aktuell berechneten Angriffswerte, nicht ausgerüstete Gegenstände ihre hinterlegten Basiswerte; der Tooltip ist per Mauszeiger und Tastaturfokus erreichbar.
- Bei mehr als acht Zaubern erhält das Zaubermenü automatisch eine Suche über Name, Magieschule, Grad, Fokuskosten und Zauberdauer. Zusätzlich kann nach ausreichendem Fokus sowie – sofern mehrere Werte vorhanden sind – nach Magieschule und Grad gefiltert werden. Suchbegriff, Filterauswahl und Scrollposition bleiben bei einer Neudarstellung des HUDs erhalten.

## Verbesserungen und Fehlerbehebungen

- Schadensanwendungen verwenden ein eindeutiges Zustandsmodell: **bereit → wird angewendet → abgeschlossen**. Ein begonnener Versuch gilt nicht länger automatisch als erfolgreich.
- Kann sicher festgestellt werden, dass kein Schaden angewendet wurde – etwa weil das Ziel fehlt, nicht berechtigt ist oder Kosten nicht verbraucht werden konnten –, wird die Aktion für einen erneuten Versuch freigegeben.
- Ist nach einem Fehler unklar, ob eine Änderung bereits wirksam wurde, bleibt der Vorgang vorsorglich gesperrt. Die Spielleitung kann ihn nach Prüfung erneut freigeben oder als abgeschlossen markieren.
- Dasselbe Verhalten schützt den **Betäubungsschaden aus Aktiver Abwehr** sowie weitere mehrstufige Vorgänge: Splitterpunkte bei Aktiver Abwehr, Patzerfolgen, ältere Chatkarten mit Tickkosten, das Vorbereiten von Angriffen und Zaubern und das Rückgängigmachen von Bewegung.
- Die **Splitterpunkt-Resonanz** richtet sich jetzt korrekt nach unterschiedlichen Splitterträgern statt nach deren Foundry-Benutzerzuordnung. Dadurch können auch zwei Figuren desselben Spielers oder mehrere von derselben Spielleitung gesteuerte NSC einander regelkonform unterstützen.
- Wird ein Angriffs- oder Zauberwurf im Systemdialog abgebrochen, wird der zwischengespeicherte Angriffs- und Zielkontext sofort verworfen. Ein anschließender Wurf derselben Figur kann dadurch weder die alte Angriffsart noch alte Ziele übernehmen; gleichzeitig laufende Würfe räumen nur ihren jeweils eigenen Kontext auf.
- Bei manuellen offensiven Würfen außerhalb des Kampf-HUDs wird der Zielkontext jetzt vom Würfelautor übernommen. Würfelt die Spielleitung vom Bogen eines online kontrollierten Spielercharakters, wird damit das auf dem GM-Client verwendete Ziel gespeichert und nicht versehentlich das Ziel des Spielers.
- Gleichzeitige Klicks und wiederholte Anfragen werden während einer laufenden Anwendung abgefangen, ohne einen Fehlversuch fälschlich als Erfolg zu speichern.
- Die HUD-Handlung **Schildstoß** verwendet jetzt die besonderen Regelwerte: 1W6+1 Schaden, 7 Ticks Grunddauer und freie Manöver, aber keine Meisterschafts-Manöver. Die falsche Hand wird einschließlich ihrer Ausnahmen durch **Kampf mit zwei Waffen** und **Starker Schildarm I** berücksichtigt; der allgemeine Tick-Zuschlag aus Ausrüstung bleibt wirksam.
- Nicht mehr verwendete Zusatzanzeigen für **VTD, KW und GW** wurden aus dem Kampf-HUD entfernt. Die Abwehrwerte bleiben weiterhin im Actor-Portrait und im Menü **Aktive Abwehr** verfügbar.
- Die Zielanzeige berücksichtigt nun durchgehend die Wahrnehmung des aktuellen Benutzers. Verborgene oder durch Sichtlinie, Beleuchtung und Fog of War nicht sichtbare Tokens erscheinen für Spieler weder in der Schnellzielauswahl noch als gespeicherte Primär- oder Sekundärziele, in Kampfereignissen oder im Feedback; die Spielleitung sieht weiterhin alle Tokens.
- Die Zuordnungseinstellungen trennen nun klar zwischen der dauerhaften Zuordnung (**direktes Token → Bogen → Foundry-OWNER**) und der vorübergehenden Laufzeitsteuerung (**aktiver zugeordneter Benutzer → aktiver Primary GM → anderer aktiver GM**).
- Greift diese vorübergehende Vertretungsregel, erhält der vertretende GM jetzt auch die Hervorhebung für die sinnvoll nächste Handlung auf den zugehörigen Kampf- und Abwehrkarten.
- Die Zuordnungseinstellungen warnen jetzt bereits bei der Auswahl, wenn einem zugeordneten Spieler die erforderliche Foundry-**OWNER**-Berechtigung für den Bogen oder das direkt zugewiesene Token fehlt. Die Warnung bietet einen direkten Link zum betroffenen Bogen; Berechtigungen werden weiterhin nicht automatisch verändert.
- Neue automatisierte Tests decken erfolgreiche Anwendungen, sicher erkennbare Fehlschläge, unklare Ergebnisse, Wiederholungsversuche und konkurrierende Aufrufe ab.

## Installation

In Foundry unter **Add-on-Module → Modul installieren** diese Manifest-URL verwenden:

```text
https://github.com/SplittermondFoundry/smooth-combat/releases/latest/download/module.json
```

Das Release wird außerdem ein ZIP für die manuelle Installation enthalten.
