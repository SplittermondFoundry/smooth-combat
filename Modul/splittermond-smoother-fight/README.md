# Splittermond Smoother Fight

Smoother Fight ist ein Foundry-VTT-Modul für **Splittermond 14**. Sobald ein Kampf gestartet wird, erscheint ein kompaktes HUD mit dem aktiven Kämpfer links, dessen ausgewähltem Ziel rechts, den aus dem System bekannten Kampfaktionen und den zugehörigen Chatkarten.

## Funktionen

- aktiver Combatant mit Tokenbild, VTD/KW/GW sowie Lebens- und Fokusleiste
- Ziel des dem aktiven Token zugeordneten Spielers; verständlicher Hinweis, wenn kein Ziel gewählt wurde
- persönliche Warnmarkierung, wenn der eigene Charakter das aktuelle Ziel ist
- Lebens- und Fokuswerte nur für Benutzer mit mindestens Observer-Rechten am jeweiligen Akteur
- dauerhafte Zuordnung von Charakter- und NSC-Bögen zu Benutzern, die auch für neu erstellte und nicht verknüpfte Tokens gilt
- durchsuchbare, getrennt einklappbare Listen für Spielercharakter- und NSC-Bögen
- eindeutige Token-Ausnahmen sowie Schnellzuweisung über einen zusätzlichen Button im Token-HUD
- frei bestimmbarer Haupt-GM für alle Bögen und Tokens ohne eigene Zuordnung
- Aktionen für Owner und GMs: Fertigkeiten, Zauber, Angriffe, Ausrüstung und Aktive Abwehr
- Zauberliste mit Fokuskosten, Beschreibungs-/Verstärkungs-Tooltip und Rechtsklick zum Öffnen des Zauberbogens; Waffen lassen sich ebenso per Rechtsklick öffnen
- mit Dice So Nice synchronisierte Verarbeitung und HUD-Kartenanzeige nach Abschluss der Würfelanimation
- korrekte Splittermond-Vorbereitung für Fernkampfangriffe und Zauber
- originale Splittermond-Angriffs- und Zauberkarten in voller HUD-Breite; EG-Optionen stehen kompakt neben den weiteren Aktionen oberhalb des Ergebnisses
- Zauberpatzer mit direkten, nur einmal nutzbaren Buttons für Lebenspunktverlust und die genannten Zustände
- Gruppierung von Angriff und anschließendem Schaden zu einem Kampfereignis
- „Auf die Ziele des Angreifers anwenden“ verwendet dessen im HUD gespeichertes Ziel und weiterhin den originalen Splittermond-Schadenshandler
- erfolgreiche Aktive Abwehr erzeugt eine neue Angriffskarte mit neuer VTD/KW/GW und neu berechneten EG
- Ziel-Quickmenü für den GM und den Owner des aktiven Tokens mit allen sichtbaren Szenen-Tokens; Kampfteilnehmer stehen zuerst, gleichnamige Tokens werden nummeriert und beim Überfahren auf der Karte hervorgehoben
- direkte Tickbuttons, freie Tickeingabe sowie Abwartend/Bereithalten/Reaktivieren
- relevante Combat-Reiter-Aktionen für Tokenfokus, Sichtbarkeit, Besiegt-Status und Entfernen aus dem Kampf
- vorbereitete Zauber als hervorgehobene Direktaktion mit Auslösen- und Abbrechen-Button
- Socket-Synchronisierung, damit das Ziel des zugeordneten Spielers auf allen Clients sichtbar ist
- standardmäßiges Ausblenden der normalen Splittermond-Aktionsleiste während eines Kampfes; pro Client deaktivierbar
- konfigurierbare Tastenkürzel: `V` blendet das HUD vollständig ein oder aus, `X` klappt alle Kampfaktionen ein und `Y` öffnet ausschließlich die neueste Aktion

## Installation zum Entwickeln/Testen

Den gesamten Ordner als `splittermond-smoother-fight` in Foundrys `Data/modules` ablegen oder verlinken. Danach Foundry neu starten, das Modul in der Welt aktivieren und unter **Einstellungen → Moduleinstellungen → Spieler, Bögen und Tokens verknüpfen** die Zuordnungen festlegen.

Eine direkte Token-Zuordnung hat Vorrang vor der Zuordnung seines Charakter- oder NSC-Bogens. Danach greift der festgelegte Haupt-GM und zuletzt die normalen Owner-Rechte des Akteurs. Jeder Bogen und jedes Token kann dabei höchstens einem Benutzer zugeordnet sein; ein Benutzer darf weiterhin beliebig viele davon besitzen. Alte Einzelzuordnungen werden automatisch weiterverwendet.

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
