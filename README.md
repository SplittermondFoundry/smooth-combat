# Splittermond Smoother Fight

Smoother Fight ist ein Foundry-VTT-Modul für Splittermond. Es ergänzt laufende Kämpfe um ein kompaktes HUD für den aktiven Kämpfer, dessen Ziele, häufige Systemaktionen, Chatkarten und die Aktive Abwehr.

## Voraussetzungen

- Foundry Virtual Tabletop 14
- Splittermond-System ab Version 14

## Installation

1. In Foundrys Einrichtungsansicht **Add-on-Module** öffnen.
2. **Modul installieren** wählen.
3. Diese Manifest-URL eintragen:

   ```text
   https://github.com/SplittermondFoundry/smooth-combat/releases/latest/download/module.json
   ```

4. Das Modul installieren und anschließend in der gewünschten Splittermond-Welt aktivieren.

Foundry verwendet dieselbe Manifest-URL auch für spätere Updateprüfungen.

Alternativ kann das ZIP der gewünschten Version unter [Releases](https://github.com/SplittermondFoundry/smooth-combat/releases) heruntergeladen und nach `Data/modules/splittermond-smoother-fight` entpackt werden. Danach Foundry neu starten.

## Funktionen

- kompaktes Kampf-HUD mit aktivem Combatant, ausgewählten Zielen, VTD/KW/GW sowie Lebens- und Fokusleiste
- persönliche Zuganzeige, Zielwarnungen und ein- oder ausblendbare Standard-Aktionsleiste
- Foundry-basierte Bewegungsverfolgung mit freier Bewegung, Laufen, Sprinten, Überziehungswarnung und Rückgängig-Funktion
- Fertigkeiten, Favoriten, Zauber, Angriffe, Ausrüstung und Aktive Abwehr direkt im HUD
- korrekte Vorbereitung und Auslösung von Fernkampfangriffen und Zaubern
- übersichtliche Kampfereignisse für Angriff, Abwehr, Schaden und Patzer mit weiter nutzbaren Splittermond-Aktionen
- Unterstützung der Meisterschaft **Verteidiger** einschließlich Reichweiten- und Abwehrprüfung
- Ziel-Quickmenü, Mehrfachziele und zwischen Clients synchronisiertes Primärziel
- Tickbuttons, freie Tickeingabe, Abwartend, Bereithalten und Reaktivieren
- dauerhafte Zuordnung von Charakteren, NSCs und einzelnen Tokens zu Benutzern
- Rechteprüfung für Ressourcen, Verteidigungswerte und ausführbare Chatkarten-Aktionen
- Dark-/Lightmode, anpassbare Hintergründe und Icons sowie optionale Audiohinweise
- konfigurierbare Tastenkürzel zum Einblenden und Einklappen des HUDs und seiner Ereignisse
- deutsche und englische Benutzeroberfläche

## Ersteinrichtung

Nach dem Aktivieren werden die Zuordnungen unter **Einstellungen → Moduleinstellungen → Spieler, Bögen und Tokens verknüpfen** festgelegt. Eine direkte Token-Zuordnung hat Vorrang vor der Zuordnung des Charakter- oder NSC-Bogens. Danach greifen der festgelegte Haupt-GM und zuletzt die normalen Owner-Rechte.

Unter **Darstellung und Medien** lassen sich Theme, Animationen, Hintergründe und ein eigenes Icon-Verzeichnis konfigurieren. **Audiohinweise** steuert die Signale für Zugbeginn, Aktive Abwehr, Schaden, Zauber und Fernkampf.

## Eigene Medien

Die mitgelieferten Standards liegen unter `assets/backgrounds`, `assets/icons` und `assets/audio`; alle Dateinamen sind in [`assets/README.md`](https://github.com/SplittermondFoundry/smooth-combat/blob/main/Modul/splittermond-smoother-fight/assets/README.md) beschrieben.

Eigene Medien sollten außerhalb des Modulordners im Foundry-Datenverzeichnis liegen, da Modulupdates den installierten Modulordner ersetzen. Ein eigenes Icon-Verzeichnis benötigt dieselben sechs SVG-Dateinamen wie `assets/icons`.

## Entwicklung und Qualitätssicherung

Das [GitHub-Repository](https://github.com/SplittermondFoundry/smooth-combat) enthält neben den Moduldateien auch die automatisierten Tests, eine statische HUD-Demo und das Werkzeug zum reproduzierbaren Erzeugen der mitgelieferten Audiodateien. Diese Entwicklungsdateien sind nicht Bestandteil des installierbaren Release-ZIPs.

Mit einer aktuellen Node.js-LTS-Version können im Stamm des geklonten Repositorys folgende Prüfungen ausgeführt werden:

```powershell
npm test
npm run check
npm run assets:audio
```

`npm run check` führt die vollständige Testsuite und die zusätzlichen Coverage-Regeln aus. `demo/index.html` dient als statische Vorschau und Test-Fixture für das HUD-Stylesheet.

## Probleme und Vorschläge

Fehler und Funktionswünsche können über die [GitHub-Issues](https://github.com/SplittermondFoundry/smooth-combat/issues) gemeldet werden. Bitte dabei Foundry-Version, Splittermond-Systemversion und Modulversion angeben.

## Lizenz

Veröffentlicht unter der [MIT-Lizenz](LICENSE).

Foundry Virtual Tabletop und Splittermond sind Marken ihrer jeweiligen Rechteinhaber. Dieses Community-Modul ist kein offizielles Produkt der Rechteinhaber.
