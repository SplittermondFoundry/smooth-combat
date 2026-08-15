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
- Angriffe sowie Zauber gegen VTD, KW oder GW verlangen vor dem Vorbereiten und Auslösen ein ausgewähltes Ziel
- Zauberliste mit Fokuskosten, Beschreibungs-/Verstärkungs-Tooltip und Rechtsklick zum Öffnen des Zauberbogens; Waffen lassen sich ebenso per Rechtsklick öffnen
- mit Dice So Nice synchronisierte Verarbeitung und HUD-Kartenanzeige nach Abschluss der Würfelanimation
- korrekte Splittermond-Vorbereitung für Fernkampfangriffe und Zauber
- höhensparend strukturierte Splittermond-Angriffs- und Zauberkarten mit gespeichertem, zum Anzeigen des Tokens anklickbarem Ziel direkt neben dem Namen der Waffe oder des Zaubers; Aktionen und Ergebnis stehen nebeneinander, die vollständige Würfelzerlegung ist über „Wurfdetails“ erreichbar
- EG-Optionen, Fokusausgabe, Tickkosten und Splitterpunkte in den HUD-Karten sind nur für GM, Owner des würfelnden Akteurs oder den Nachrichtenautor sichtbar und ausführbar
- Zauberpatzer mit direkten, nur einmal nutzbaren Buttons für Lebenspunktverlust und die genannten Zustände
- Gruppierung von Angriff und anschließendem Schaden zu einem Kampfereignis
- einzeln ein- und ausklappbare Abwehr-, Schadens- und Patzer-Subevents; ein neuer Schadenswurf klappt ältere Abwehrdetails automatisch zu und wird in den sichtbaren Scrollbereich geholt
- vollbreite, zweispaltige Schadenskarte mit gut umbrechenden Aktionsbuttons sowie prominentem Gesamtergebnis und optionaler Würfelzerlegung
- „Auf die Ziele des Angreifers anwenden“ verwendet dessen im HUD gespeichertes Ziel und weiterhin den originalen Splittermond-Schadenshandler
- erfolgreiche Aktive Abwehr erzeugt eine neue Angriffskarte mit neu berechneten EG; die kompakte Abwehrprobe steht davor und zeigt neue VTD/KW/GW direkt im EG-Feld
- regelgerechte Unterstützung durch die Meisterschaft **Verteidiger**: nur Besitzer der Meisterschaft erhalten innerhalb von 2 m eine Zusatzaktion, ausschließlich passende Nahkampf-Abwehren werden angeboten und der systemeigene −3-Modifikator wird vorausgewählt; verteidigt das Ziel ebenfalls, zählt die höhere neue VTD
- Ziel-Quickmenü für den GM und den Owner des aktiven Tokens mit allen sichtbaren Szenen-Tokens; Kampfteilnehmer stehen zuerst, gleichnamige Tokens werden nummeriert und beim Überfahren auf der Karte hervorgehoben
- direkte Tickbuttons, freie Tickeingabe sowie Abwartend/Bereithalten/Reaktivieren
- relevante Combat-Reiter-Aktionen für Tokenfokus, Sichtbarkeit, Besiegt-Status und Entfernen aus dem Kampf
- vorbereitete Zauber als hervorgehobene Direktaktion mit Auslösen- und Abbrechen-Button
- Socket-Synchronisierung, damit das Ziel des zugeordneten Spielers auf allen Clients sichtbar ist
- standardmäßiges Ausblenden der normalen Splittermond-Aktionsleiste während eines Kampfes; pro Client deaktivierbar
- konfigurierbare Tastenkürzel: `V` klappt das HUD ein oder aus, `B` blendet es vollständig ein oder aus (sofern die Taste noch frei ist), `X` klappt alle Kampfaktionen ein und `Y` öffnet ausschließlich die neueste Aktion

## Installation zum Entwickeln/Testen

Den gesamten Ordner als `splittermond-smoother-fight` in Foundrys `Data/modules` ablegen oder verlinken. Danach Foundry neu starten, das Modul in der Welt aktivieren und unter **Einstellungen → Moduleinstellungen → Spieler, Bögen und Tokens verknüpfen** die Zuordnungen festlegen.

Eine direkte Token-Zuordnung hat Vorrang vor der Zuordnung seines Charakter- oder NSC-Bogens. Danach greift der festgelegte Haupt-GM und zuletzt die normalen Owner-Rechte des Akteurs. Jeder Bogen und jedes Token kann dabei höchstens einem Benutzer zugeordnet sein; ein Benutzer darf weiterhin beliebig viele davon besitzen. Alte Einzelzuordnungen werden automatisch weiterverwendet.

## Ablauf Aktive Abwehr

1. Der Angreifer führt den Angriff aus. Smoother Fight merkt sich dessen aktuelles Ziel an der Chatkarte.
2. Der Owner des Ziels klickt im HUD auf **Aktive Abwehr**. Ein anderer Spieler mit der Meisterschaft **Verteidiger**, einer passenden Nahkampf-Abwehr und höchstens 2 m Abstand kann stattdessen oder zusätzlich **Verteidiger für …** wählen.
3. Das normale Splittermond-System führt die Abwehrprobe aus.
4. Bei Erfolg wird der neue Verteidigungswert als `Basis + 1 + EG + Defensiv` berechnet. Bei mehreren Abwehrproben bleibt der höchste Wert bestehen.
5. Eine neue, voll funktionsfähige Splittermond-Angriffskarte wird mit diesem Wert erzeugt. Trefferstatus, verfügbare EG und Streiftreffer werden neu bestimmt.
6. Gewürfelter Schaden erscheint als geöffnetes, vollbreites Subevent im selben HUD-Ereignis; ältere Abwehrdetails werden dabei eingeklappt und die originalen Anwenden-Buttons bleiben nutzbar.

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
