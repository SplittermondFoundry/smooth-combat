# Splittermond Smoother Fight 0.7.0

Die Charakterwahl und alle Korrekturen aus Vorschau 14 gehören jetzt zum regulären Build. Das bestehende HUD behält seinen Aufbau; die Charakterwahl ist standardmäßig eingeschaltet.

## Charakterwahl im laufenden Kampf

- Spieler wechseln zwischen ihren Tokens der aktuellen Szene, die SL zwischen allen Szenentokens. Suche und direkte Auswahl auf der Karte führen zur gewünschten Figur.
- Eigene Figur und eigenes Ziel stehen oben, aktiver Kämpfer und sein Primärziel darunter. Gleiche Tokens werden zusammengefasst. Zielkarten nennen die zugehörige Figur und zeigen Ressourcen entsprechend den Berechtigungen.
- Die Kampfereignisse folgen weiterhin dem aktuellen Kämpfer. Sein Porträt blinkt, wenn der zuständige Spieler bzw. die SL gerade eine andere Figur bedient.
- Zauber und Fernkampfangriffe lassen sich nur im Zug des genauen Tokens vorbereiten oder auslösen. Gesperrte Aktionen zeigen ein Schloss und eine Begründung. Vorbereitung, Abbrechen und Item-Rechtsklick bleiben erhalten.

## Bedienung und Fehlerkorrekturen

- Die vollständigen Menüs für Fertigkeiten, Angriffe, Zauber und Aktive Abwehr schließen einander beim Öffnen. Tooltips lassen die Aktionsleiste und Favoritensterne frei.
- Freie Flächen über den Portraits und zwischen den HUD-Bereichen lassen Klicks, Ziehen und Mausrad wieder zur Kampfkarte durch.
- Aktionseinblendungen laden ihre Icons korrekt und starten bei HUD-Aktualisierungen nicht erneut.
- Die Scrollkorrektur für lange Modifikatorlisten bleibt auch für Splittermond 14.2.7 enthalten. Alte CSS-Adressen bleiben als Weiterleitungen verfügbar.

## Installation und Kompatibilität

Das ZIP enthält die Moduldateien direkt auf der obersten Ebene. Bei beendetem Foundry in **Data/modules/splittermond-smoother-fight** entpacken. Anschließend Foundry und die Browserseiten neu laden, bei Bedarf mit **Strg+F5**. Die Welt- und Systemeinstellungen benötigen keine Migration. Eine bereits gespeicherte Abschaltung der Charakterwahl bleibt bestehen.

Die Voraussetzungen bleiben **Foundry VTT 14 ab Build 14.359** und **Splittermond ab 14.2.0**. Die Vorbereitungsdaten aus **14.2.7** und **14.3.0-beta4** bleiben unterstützt. Die klassische HUD-Ansicht ist über **Charakterwahl im HUD** weiterhin erreichbar.

## Prüfung

- `npm run check` prüft die vollständige Testsuite und die Regelabdeckung.
- Lokale Browserprüfungen mit echten HUD-Komponenten decken Charakterwahl, unabhängige Ziele, Rechte, Zugsperren, Item-Rechtsklick, Tooltips, Mausdurchleitung und Aktionseinblendungen ab. Sie ersetzen keine vollständige Foundry-Spielwelt.
