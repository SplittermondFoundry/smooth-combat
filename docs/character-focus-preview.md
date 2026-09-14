# Charakterwahl im HUD – lokale Vorschau

Die kleine Erweiterung ist auf dem lokalen Branch `codex/character-focus` umgesetzt. Grundlage ist der Quellstand 0.6.6 (`507426b`). Die Installation erfolgt getrennt über das Vorschaupaket.

## Ausprobieren

Die ausführbare Funktionsvorschau startet aus diesem Worktree mit:

```powershell
node tools/serve-demo.mjs
```

Adresse: http://127.0.0.1:4267/demo/character-focus.html?gm=1

Die Vorschau verwendet die echten HUD-Renderer, den Controller und die Aktionslogik mit lokalen Testdaten. Die Karte, Bilder und Kampfereignisse sind Beispieldaten. Über „Spieler“, „SL“ und „Zug wechseln“ lassen sich Rechte, Kartenzusammenführung und offene Listen beim Zugwechsel prüfen. Sie ist kein vollständiger Foundry-Integrationstest.

Der Browser dient zum Prüfen von Layout, Charakterwechsel, Zielauswahl und Menüverhalten. Vollständige Charakterbögen und Spielaktionen benötigen Foundry.

## In einer Foundry-Testwelt

Das aktuelle Vorschaupaket liegt unter `dist/character-focus-preview/smoother-fight-character-focus-preview-4.zip`. Es trägt im Paket die Version `0.6.6-character-focus.4` und bietet keine öffentliche Update-URL. Die zuvor installierte Version 0.6.4 ist separat und vollständig als `smoother-fight-installed-backup.zip` gesichert.

Die Charakterwahl ist ab Revision 3 standardmäßig eingeschaltet. Eine bereits ausdrücklich gespeicherte Abschaltung wird respektiert und kann über den Schalter unten geändert werden. Die eigene Figur bzw. SL-Auswahl und deren Ziel stehen oben; der gerade aktive Charakter und sein Primärziel stehen unten. Diese Rollenreihenfolge bleibt beim Umschalten bestehen. Identische Tokens werden weiterhin zusammengefasst.

Revision 2 ergänzt den CSS-Einstiegspunkt `smoother-fight-0.6.4.css` als Weiterleitung auf die aktuellen Styles. Damit funktioniert das Layout auch dann, wenn ein Client beim Austausch des Modulordners noch die frühere Stylesheet-Adresse verwendet. Beim ersten Paket lieferte diese Adresse HTTP 404. Der gemeldete Layoutfehler verschwand nach einem weiteren Foundry-Neustart; der genaue Ladezustand des betroffenen Clients konnte nachträglich nicht nachgewiesen werden.

1. In einer getrennten Foundry-Datenkopie das Vorschaupaket nach `Data/modules` entpacken. Der enthaltene Ordner heißt wie bisher `splittermond-smoother-fight`.
2. Foundry mit dieser Datenkopie starten und die Testwelt öffnen; den Browser vollständig neu laden.
3. Die Charakterwahl ist standardmäßig aktiv. Unter **Einstellungen → Einstellungen konfigurieren → Splittermond Smoother Fight** lässt sich **Charakterwahl im HUD (Vorschau)** pro Client ausschalten oder eine zuvor gespeicherte Abschaltung zurücknehmen.
4. Auf die linke Charakterkarte klicken, den Auswahlpfeil verwenden oder ein berechtigtes Token auf der Karte auswählen. Die Bedienzeile nennt die ausgewählte Figur. Der Kampfverlauf folgt weiter dem aktiven Kampfteilnehmer.

Ab Revision 4 übernimmt eine neue Tokenauswahl auf der Karte direkt die persönliche HUD-Auswahl: für die SL jedes Token, für Spieler nur eigene sichtbare Tokens. Bei Mehrfachauswahl gilt das zuletzt hinzugenommene berechtigte Token. Abwählen entfernt die persönliche Auswahl nicht. Auch ohne vorausgewählten SL-Charakter öffnet sich das Auswahlmenü frei außerhalb der kleinen Karte. Fertigkeiten, Angriffe, Zauber und Aktive Abwehr bilden eine gemeinsame Menügruppe: Öffnen eines Menüs schließt das andere, auch bei Favoriten-/Standardangriff-Pfeilen und in der klassischen Ansicht.

Die bestehenden Menüs, Favoriten, Ausrüstungsschalter, vollständigen Bögen und Reaktionsabläufe bleiben vorhanden. Neue Zauber- und Fernkampfvorbereitungen sind außerhalb des eigenen Token-Zuges gesperrt, auch für die SL. Vorhandene Regeln für bereits vorbereitete Aktionen bleiben bestehen.

Ziele werden pro Benutzer und Token getrennt gehalten. Gleiche Token-UUIDs werden zusammengefasst; unterschiedliche Tokens desselben Actors nicht. Auswahl und persönliche Ziele sind Sitzungsdaten. Der Ansichtswechsel selbst migriert keine Welt-, Actor- oder Token-Daten.

## Rückkehr

- Für die klassische Bedienoberfläche den Vorschau-Schalter ausschalten.
- Für den exakt zuvor installierten Code bei gestoppter Testinstallation den Vorschau-Modulordner durch den Modulordner aus `smoother-fight-installed-backup.zip` ersetzen und Foundry neu starten.
- Für den ursprünglichen Quellstand existiert der lokale Tag `codex/hud-before-character-focus-20260914`. Der ursprüngliche Checkout bleibt auf seinem vorherigen Stand.

Die Installation auf dem produktiven Foundry-Server ist nicht Bestandteil dieser lokalen Vorschau. Normale Spielaktionen in einer späteren Testwelt verändern deren Daten wie bisher; eine Code-Rückkehr macht solche Spielaktionen nicht rückgängig.

## Prüfung

`npm run check` prüft die gesamte Testsuite sowie die vorgeschriebene Regelabdeckung. Die zusätzlichen Tests behandeln insbesondere Besitzrechte, unsichtbare Ziele, getrennte Benutzerziele, identische Actor-IDs mit unterschiedlichen Tokens, exakte Tickempfänger, Zugwechsel während asynchroner Vorbereitung und die klassische Ansicht.

`tools/verify-hud-focus.mjs` prüft mit Playwright die echten HUD-Komponenten bei 1920 × 1080: Charakterauswahl einschließlich Actor ohne Token, Bogen-/Detailknöpfe, 18 Zauber in aufklappbaren Listen, Startsperren, stabile Menüs beim Zugwechsel, Kartenzusammenführung sowie helles und dunkles Erscheinungsbild. Playwright wird optional über `PLAYWRIGHT_MODULE_PATH`, ein Chromium-Browser über `BROWSER_EXECUTABLE` angegeben.

Mit `HUD_MODULE_ROOT` kann die Prüfung direkt auf den aus dem ZIP entpackten Modulordner zeigen. Zusätzlich werden die aktuelle, unversionierte und frühere CSS-Adresse über den von Foundry verwendeten Inline-Import mit und ohne CSS-Layer geladen. Geprüft werden HTTP-Fehler, die feste HUD-Position, die kompakte Karte und der Rückwechsel zur klassischen Ansicht. Die Browserprüfung verwendet weiterhin eine lokale Testumgebung und keine vollständige Foundry-Spielwelt.

Die leere SL-Auswahl wird bei 1920 × 1080 und 1280 × 720 mit einem tatsächlichen Klick auf einen Menüeintrag außerhalb der Karte geprüft. Weitere Browserprüfungen decken Kartenwahl, gegenseitig ausschließende Menüs per Maus und Tastatur, Favoriten, Standardangriffe und Neurendern ab. Der Foundry-Hook und die Besitzprüfung sind separat automatisiert geprüft.

Gemessen: Seitenbreite weiterhin 172 Pixel; große Karte 246 Pixel, kleine Karte 72 Pixel plus 6 Pixel Abstand. Bei zwei unterschiedlichen Figuren und Zielen sind das rund 1,3 Prozent zusätzliche Bildschirmfläche. Die Höhe der HUD-Mitte hängt weiterhin vom bisherigen Inhalt der Kampfereignisse ab.
