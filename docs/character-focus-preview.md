# Charakterwahl im HUD – lokale Vorschau

Die kleine Erweiterung ist auf dem lokalen Branch `codex/character-focus` umgesetzt. Grundlage ist der Quellstand 0.6.6 (`507426b`). Die laufende Foundry-Installation wurde nicht verändert.

## Ausprobieren

Die ausführbare Funktionsvorschau startet aus diesem Worktree mit:

```powershell
node tools/serve-demo.mjs
```

Adresse: http://127.0.0.1:4267/demo/character-focus.html?gm=1

Die Vorschau verwendet die echten HUD-Renderer, den Controller und die Aktionslogik mit lokalen Testdaten. Die Karte, Bilder und Kampfereignisse sind Beispieldaten. Über „Spieler“, „SL“ und „Zug wechseln“ lassen sich Rechte, Kartenzusammenführung und offene Listen beim Zugwechsel prüfen. Sie ist kein vollständiger Foundry-Integrationstest.

Der Browser dient zum Prüfen von Layout, Charakterwechsel, Zielauswahl und Menüverhalten. Vollständige Charakterbögen und Spielaktionen benötigen Foundry.

## In einer Foundry-Testwelt

Das Vorschaupaket liegt unter `dist/character-focus-preview/smoother-fight-character-focus-preview.zip`. Es trägt im Paket die Version `0.6.6-character-focus.1` und bietet keine öffentliche Update-URL. Die bisher installierte Version 0.6.4 ist separat und vollständig als `smoother-fight-installed-backup.zip` gesichert.

1. In einer getrennten Foundry-Datenkopie das Vorschaupaket nach `Data/modules` entpacken. Der enthaltene Ordner heißt wie bisher `splittermond-smoother-fight`.
2. Foundry mit dieser Datenkopie starten und die Testwelt öffnen; den Browser vollständig neu laden.
3. Unter **Einstellungen → Einstellungen konfigurieren → Splittermond Smoother Fight** den Schalter **Charakterwahl im HUD (Vorschau)** aktivieren. Er ist standardmäßig aus und gilt pro Benutzer/Browser.
4. Auf die linke Charakterkarte klicken oder den Auswahlpfeil verwenden. Die Bedienzeile nennt die ausgewählte Figur. Der Kampfverlauf folgt weiter dem aktiven Kampfteilnehmer.

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

Gemessen: Seitenbreite weiterhin 172 Pixel; große Karte 246 Pixel, kleine Karte 72 Pixel plus 6 Pixel Abstand. Bei zwei unterschiedlichen Figuren und Zielen sind das rund 1,3 Prozent zusätzliche Bildschirmfläche. Die Höhe der HUD-Mitte hängt weiterhin vom bisherigen Inhalt der Kampfereignisse ab.
