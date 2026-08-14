# Splittermond: Smoother Fight

Smoother Fight ist ein Foundry-VTT-Modul für **Splittermond 14**. Sobald ein Kampf gestartet wird, erscheint ein kompaktes HUD mit dem aktiven Kämpfer links, dessen ausgewähltem Ziel rechts, den aus dem System bekannten Kampfaktionen und den zugehörigen Chatkarten.

## Funktionen

- aktiver Combatant mit Tokenbild, VTD/KW/GW sowie Lebens- und Fokusleiste
- Ziel des dem aktiven Token zugeordneten Spielers; verständlicher Hinweis, wenn kein Ziel gewählt wurde
- Aktionen für Owner und GMs: Fertigkeiten, Zauber, Angriffe, Ausrüstung und Aktive Abwehr
- korrekte Splittermond-Vorbereitung für Fernkampfangriffe und Zauber
- originale Splittermond-Angriffs- und Zauberkarten im HUD, einschließlich ihrer EG-, Fokus-, Tick-, Schaden- und Anwenden-Buttons
- Gruppierung von Angriff und anschließendem Schaden zu einem Kampfereignis
- erfolgreiche Aktive Abwehr erzeugt eine neue Angriffskarte mit neuer VTD/KW/GW und neu berechneten EG
- Ziel-Quickmenü für den GM und den Owner des aktiven Tokens; beim Überfahren eines Eintrags wird dessen Token auf der Karte hervorgehoben
- Socket-Synchronisierung, damit das Ziel des zugeordneten Spielers auf allen Clients sichtbar ist
- optionales Ausblenden der normalen Splittermond-Aktionsleiste während eines Kampfes

## Installation zum Entwickeln/Testen

Den gesamten Ordner als `splittermond-smoother-fight` in Foundrys `Data/modules` ablegen oder verlinken. Danach Foundry neu starten, das Modul in der Welt aktivieren und unter **Einstellungen → Moduleinstellungen → Spieler und Tokens verknüpfen** die Zuordnungen festlegen.

Ohne manuelle Zuordnung wird der erste aktive Nicht-GM mit Owner-Rechten am Akteur verwendet. Einem Spieler können beliebig viele Tokens zugeordnet werden. Die Zuordnung speichert sowohl Token- als auch Akteursbezug; dadurch bleibt sie auch dann brauchbar, wenn derselbe Akteur auf einer späteren Szene mit einem neuen Token eingesetzt wird. Alte Einzelzuordnungen werden automatisch weiterverwendet.

## Ablauf Aktive Abwehr

1. Der Angreifer führt den Angriff aus. Smoother Fight merkt sich dessen aktuelles Ziel an der Chatkarte.
2. Der Owner des Ziels klickt im HUD auf **Aktive Abwehr**.
3. Das normale Splittermond-System führt die Abwehrprobe aus.
4. Bei Erfolg wird der neue Verteidigungswert als `Basis + 1 + EG + Defensiv` berechnet.
5. Eine neue, voll funktionsfähige Splittermond-Angriffskarte wird mit diesem Wert erzeugt. Trefferstatus, verfügbare EG und Streiftreffer werden neu bestimmt.
6. Gewürfelter Schaden erscheint im selben HUD-Ereignis; die originalen Anwenden-Buttons bleiben nutzbar.

## Qualitätssicherung

```powershell
npm test
npm run check
```

Der Befehl wird aus dem Projektstamm ausgeführt. Die Berechnungen sind in `scripts/combat-rules.js` bewusst unabhängig von Foundry gehalten und werden mit Node-Testfällen abgesichert.

## Sinnvolle nächste Ausbaustufen

- frei verschiebbare HUD-Position pro Client
- optionale Entfernungsmessung und Reichweitenwarnung zwischen Angreifer und Ziel
- Zustands- und Wundmalus-Chips direkt an beiden Portraits
- „Zug abschließen“-Knopf mit häufig verwendeten Tickwerten
- Zielhistorie (letzte drei Ziele) für schnelle Gegnerwechsel
- akustischer oder dezenter visueller Hinweis nur für den aktuell handelnden Spieler
