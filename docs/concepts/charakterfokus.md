# Konzept: Charakterfokus im Kampf-HUD

**Überholt durch die kleinere Erweiterung in [charakterfokus-minimal.md](charakterfokus-minimal.md).** Der folgende große Umbau bleibt als frühere Entwurfsvariante dokumentiert. Er ist nicht mehr die Grundlage für eine Umsetzung.

Stand: 14. September 2026. FullHD-Entwurf nach Abgleich mit der laufenden Foundry-Welt; noch keine Änderung am Modul.

## Empfehlung

Das bestehende HUD erhält zwei Ansichten: **Am Zug** und **Mein Charakter**. Für die SL heißt die zweite Ansicht **Charakterfokus**. Beide verwenden dieselben Porträt-, Werte-, Ziel- und Aktionsbereiche. Eine schmale Kampfzeile zeigt unabhängig davon, wer tatsächlich am Zug ist. Ein zweiter, dauerhaft sichtbarer Bereich zeigt den laufenden Kampf mit Beteiligten, Ergebnis und nächstem ausstehenden Schritt. Charakterzugriff und Kampfverlauf bleiben gleichzeitig sichtbar.

Das normale HUD misst im FullHD-Entwurf **1220 × 296 Pixel**. Angriffe, Fertigkeiten, Zauber, Handlungen und Ausrüstung behalten nach oben ausklappende, scrollbar begrenzte Menüs. Nur kompakte Ereignisdetails ersetzen den mittleren Inhalt. Beim Einklappen bleiben Zugzeile und laufender Vorgang auf **100 Pixel Höhe** sichtbar. Offene Menüs überdecken vorübergehend zusätzliche Kartenfläche; sie sind in der Flächenanzeige der Vorschau mitgerechnet.

Die drei Begriffe haben jeweils genau eine Bedeutung:

- **Am Zug:** der aktuelle Combatant in der Tickreihenfolge.
- **Im Fokus:** der Charakter, dessen Werte und Aktionen gerade im HUD geöffnet sind.
- **Dein Ziel:** die persönliche Zielwahl für den eigenen bzw. zur Steuerung ausgewählten Charakter. Sie gehört nicht automatisch zum aktuellen Zug.

Der Fokus ist eine Ansicht mit zugehörigem Handlungskontext. Er verändert weder den aktiven Combatant noch allein durch seine Auswahl die Kameraposition, Tokensteuerung, Eigentümerzuordnung oder Zielmarkierungen anderer Benutzer.

## Anordnung

```text
⚡ Am Zug: Farruk · Tick 18 · Ziel: Rattling      ◎ Dein Ziel: Bogenschütze

[ ⚡ Am Zug | ♙ Mein Charakter ]  [ Liandra ▾ ]            Im Fokus

┌ Liandra ──────────┐ ┌ Aktionen für Liandra ─────────┐ ┌ Dein Ziel ──────┐
│ Porträt           │ │ Fertigkeiten · Angriff       │ │ Bogenschütze   │
│ Werte, LP, Fokus  │ │ Zauber · Abwehr               │ │ Entfernung     │
│ Charakterbogen   │ │ Ausrüstung · Zustände         │ │ Ziel wechseln  │
└───────────────────┘ └──────────────────────────────┘ └────────────────┘

LIVE · Farruk → Rattling · Breitschwert                     Vorgang öffnen
✓ Angriff 26 · 2 EG  →  Aktive Abwehr läuft  →  Schaden offen
```

Die bestehende Kampfzeile wird präziser beschriftet. Hinzu kommen eine kompakte Kontextwahl und der Charakterwähler. Charakter- und Zielkarten enthalten je einen **104 × 104 Pixel großen Bildbereich** einschließlich Rand. Die Werte stehen daneben. Die 160 Pixel hohe Mitte zeigt die Aktionsübersicht oder ausdrücklich geöffnete Ereignisdetails; lange Charakterlisten klappen darüber aus. Der laufende Kampf bleibt darunter sichtbar. Die bisherige Ereignispräsentation wird hierfür um eine kompakte, dauerhafte Zusammenfassung ergänzt; ihre heutige variable Höhe wird nicht einfach übernommen.

Beide Karten verwenden erkennbare Originalbilder: das hinterlegte Charakterporträt, ersatzweise das Tokenbild. Namensschild und „Im Fokus“ bzw. „Ziel für …“ stehen unabhängig vom Bild. Ein neutrales Ersatzbild erscheint nur, wenn kein brauchbares Bild hinterlegt ist. In der Vorschau stammen die Bilder aus der vorhandenen Kartenaufnahme; deren begrenzte Auflösung und eingeblendete Tokenmarkierungen sind keine Vorgabe für die Umsetzung. Buchstaben aus dem früheren Entwurf waren Platzhalter. Beim vollständigen Einklappen werden auch die großen Bilder eingeklappt.

**Gold + Blitz + „Am Zug“** kennzeichnet den Kampfstatus. **Türkis + Personen-/Fokuszeichen + „Im Fokus“** kennzeichnet den ausgewählten Charakter. Die Texte bleiben sichtbar; die Unterscheidung hängt nicht allein von Farbe ab. Keine zweite leuchtende Zugmarkierung um einen lediglich betrachteten Charakter.

Die rechte Zielkarte gehört immer zu dem links angezeigten Charakter. Ihre Überschrift lautet eindeutig „Farruks Ziel“, „Dein Ziel“ oder bei SL-Steuerung „Ziel für Rattling“. Entfernungen werden vom links angezeigten Token gemessen.

## FullHD-Aufteilung und Istzustand

Der Vergleich wurde am 14. September 2026 mit der laufenden Welt „Reise um den Kristallsee“, Szene „Battle-Map“, als **Guffel (GM)** abgeglichen. Die Browserfläche wurde auf **1920 × 1080 Pixel** gesetzt; Browserleiste und Windows-Taskleiste sind nicht Teil dieser Fläche. Die Istansicht verwendet jetzt echte Aufnahmen dieser Sitzung. Sie ersetzt die frühere Rekonstruktion mit dem lokalen Modul 0.6.6. Die laufende Welt lädt ein Stylesheet mit dem Dateinamen `smoother-fight-0.6.4.css`; daraus wird keine vollständig verifizierte Laufzeitversion abgeleitet.

In der Aufnahme ist **Geistervarg auf Tick 122** aktiv und **kein Ziel** gewählt. Drei historische Kampfereignisse sind zunächst zugeklappt. Für die zweite Aufnahme wurde nur das historische Ereignis **Anmar Bahrendahl → Kor**, einschließlich dessen bereits geöffnetem Schadensuntereintrag, aufgeklappt und anschließend wieder geschlossen. Keine Kampfhandlung, Tickänderung oder Ressourcenänderung wurde ausgeführt. Die vorübergehende HUD-Minimierung und Browser-Größenvorgabe wurden zurückgesetzt.

Gemessene Geometrie:

- Rechte Seitenleiste einschließlich vertikaler Tabs: **348 Pixel**, linker Rand x = 1572.
- Tickleiste: x = 110, y = 60, **1454 × 94 Pixel**.
- Aktuelles HUD: x = 233, unterer Rand y = 1070, **1220 Pixel breit**. Mittelteil 864 Pixel breit, Seitenporträts je 172 × 246 Pixel.
- Native Makroleiste: x = 578, y = 1004, **764 × 60 Pixel**. Das ausgeklappte aktuelle HUD überdeckt sie weitgehend. Nach dessen Minimierung ist zusätzlich das kompakte Splittermond-Systemmenü sichtbar.

Der Entwurf wird über dieselbe Originalaufnahme gelegt. Die bisherigen Systemaktionen werden in seinem Charakterbereich zusammengeführt; ein zusätzliches Systemmenü wird im Entwurf nicht parallel gezeigt. Die Makroleiste bleibt frei. Das neue HUD liegt dafür bei **x = 218, y = 702**, misst **1220 × 296 Pixel** und endet bei y = 998. Es hält 6 Pixel Abstand zur Makroleiste. Im Vergleich zum aktuellen geschlossenen HUD liegt seine Oberkante somit rund **28 Pixel höher**, obwohl es selbst rund **44 Pixel niedriger** ist.

Bei geschlossenen Menüs bleiben zwischen Tickleiste und neuem HUD in dessen Breite **548 Pixel durchgehende Kartenhöhe**. Die 296 Pixel HUD-Höhe bestehen aus 36 Pixel Zugzeile, 36 Pixel Kontextwahl, 160 Pixel Charakterbereich, 62 Pixel Ereignisbereich und 2 Pixel Rand. Die seitlichen Charakterkarten sind jeweils 224 Pixel breit; dazwischen verbleiben 770 Pixel. Beim Einklappen bleiben die beiden Kampfbereiche auf 100 Pixel Höhe sichtbar.

| Ansicht | Maximale HUD-Höhe | HUD-Fläche / Bildschirm | Kartenbereich ohne UI-Überdeckung, ca. |
| --- | ---: | ---: | ---: |
| Live-Ist · SL · Ereignisse zugeklappt | 340 px | 18,5 % | 67,1 % |
| Live-Ist · SL · historisches Schadensereignis offen | 635 px | 30,8 % | 52,1 % |
| Entwurf · Am Zug oder Charakterfokus | 296 px | 17,4 % | 65,7 % |
| Entwurf · kompakte Ereignisdetails offen | 296 px | 17,4 % | 65,7 % |
| Entwurf · Zaubermenü 390 × 440 px offen | 296 px + Menü | 25,7 % | 55,6 % |
| Entwurf · Handlungsmenü 690 × 480 px offen | 296 px + Menü | 33,4 % | 46,2 % |
| Entwurf · eingeklappt, Kampfverlauf sichtbar | 100 px | 5,9 % | 79,8 % |

Die HUD-Fläche ist die Vereinigungsfläche seiner sichtbaren rechteckigen Bereiche, nicht die gesamte Hüllfläche des unregelmäßigen Ist-HUDs. Der freie Kartenbereich berücksichtigt zusätzlich Tickleiste, Seitenleiste, tatsächliche Werkzeugknöpfe, Szenennavigation, Spielerübersicht und Makroleiste. Bezugsfläche ist **1572 × 1080 Pixel links der Seitenleiste einschließlich Fog of War**. Schatten, Token und Routen zählen nicht als UI. Rechteckige Leistenflächen sind eine konservative Näherung; die Werte messen keine spielerseitigen Sichtrechte und keine ausschließlich aufgedeckte Kartenfläche.

**Der Entwurf beansprucht bei geschlossenen Ereignissen geringfügig mehr Kartenfläche**, weil die Makroleiste wieder nutzbar ist. Bei geöffneten Ereignisdetails bleibt hingegen wesentlich mehr Karte sichtbar. Die feste Grundhöhe gilt für das HUD einschließlich kompakter Ereignisdetails. Ein ausgeklapptes Zauber- oder Ausrüstungsmenü benötigt zusätzliche Fläche. Besonders das breite Handlungsmenü verdeckt während seiner Nutzung einen merklichen Teil der Karte. Deshalb bleibt nur ein solches Menü gleichzeitig offen und lässt sich mit einem Klick oder Escape schließen. Zugzeile, beide Porträts, eigene Zielwahl und Ereignisleiste bleiben auch dann unverdeckt.

Die Entwurfsansichten zeigen einen ausdrücklich **simulierten Vorgang** mit Geistervarg, Feenhörnchen und Peritus. Eigene Ziele, persönliche Werte, Zauber, Ausrüstung, Tickabstände und Reaktionsbedarf sind Beispieldaten, keine behaupteten aktuellen Zustände dieser Figuren oder geprüften Regelwerte. Der Rollenwechsel simuliert nur das neue HUD; das Kartenbild bleibt eine Aufnahme aus SL-Sicht. Eine echte Sitzung als Spieler wurde nicht geprüft. Die frühere rekonstruierte Spieler-Messreihe ist deshalb kein Teil dieser Live-Vergleichstabelle.

Die Vorschau dient der Beurteilung von Größe, Zugriff und Kampfverfolgung. Vollständige Systembögen und echte Würfelabläufe werden darin nicht implementiert. Die technischen Bezüge in diesem Dokument beruhen weiterhin auf dem lokalen Quellstand und müssen vor Umsetzung mit der eingesetzten Modulversion abgeglichen werden.


## Kampfverlauf unabhängig vom Charakterfokus

Der untere Ereignisbereich gehört zum laufenden Kampf, nicht zum betrachteten Charakter. Er zeigt stets:

- handelnde Figur und Ziel;
- die konkrete Handlung;
- das bereits bekannte Ergebnis;
- den nächsten noch offenen Schritt, etwa Aktive Abwehr, Tickzahlung oder Schaden.

Öffnet die SL Liandra oder betrachtet ein Spieler seine Zauber, laufen diese Angaben weiter. Der eigene Fokus und offene Eingaben bleiben erhalten. Kein automatisches Durchblättern alter Ereignisse und kein selbstständiges Aufklappen großer Karten.

Im Normalfall wird genau der laufende Vorgang gezeigt. Unmittelbar nach Abschluss bleibt dessen Ergebnis bis zum nächsten Vorgang sichtbar. Gibt es mehrere ausstehende Vorgänge, zeigt die Leiste den nächsten handlungsrelevanten Vorgang und einen kompakten Zähler weiterer offener Vorgänge; die Liste erscheint auf Anforderung im mittleren Detailbereich.

Ein persönlicher Reaktionsbedarf wird im selben Bereich hervorgehoben, beispielsweise **„Bogenschütze → Liandra · Aktive Abwehr erforderlich“** mit **„Für Liandra reagieren“**. Erst der Klick öffnet die zuständige Reaktion. Der Hinweis bleibt auch im eingeklappten HUD sichtbar. In der Vorschau kann die Situation über „Vorgang“ gewechselt werden; das demonstriert, dass ein geöffnetes Zaubermenü stehen bleibt.

**„Vorgang öffnen“** ersetzt die mittlere Aktionsansicht durch kompakte Ereignisdetails. Porträts, Kontextwahl, Zugzeile und Ereignisfortschritt bleiben stehen. Vollständige Chatkarten und die gesamte Historie bleiben in Foundrys Chat bzw. einer explizit geöffneten Detailansicht erreichbar. Die Verdichtung ist ein eigener Darstellungsentwurf; bestehende ungekürzte Systemkarten passen nicht automatisch in 160 Pixel.

## Ausklappende Menüs und lange Listen

**Angriffe, Fertigkeiten, Zauber, Abwehr, Handlungen, Ausrüstung und Zustände bleiben ausklappende Menüs wie im aktuellen HUD.** Ihre vollständigen Listen werden nicht in die 160 Pixel hohe Aktionsmitte gedrängt. Das vorhandene Verhalten für Favoriten, Standardangriffe und vorbereitete Aktionen bleibt erhalten; der neue Fokus bestimmt, zu welcher Figur die Einträge gehören.

Der normale Menürahmen ist im FullHD-Beispiel 390 Pixel breit und höchstens 440 Pixel hoch. Das Handlungsmenü erhält wegen seiner zusätzlichen Angaben bis zu 690 × 480 Pixel. Kurze Listen dürfen weniger Höhe benötigen. Nur der Listeninhalt scrollt; Menütitel mit Charaktername, Suche und Schließen bleiben erreichbar. Das Menü öffnet oberhalb der gesamten Zugzeile, im Beispiel mit 12 Pixel Abstand zum HUD. Es wird bei Bedarf horizontal innerhalb der Kartenfläche versetzt und überdeckt weder Porträts noch Kampfereignisleiste.

Ein zweiter Menüklick schließt das Menü, ein anderer öffnet dessen Liste anstelle der bisherigen. Escape oder ein Klick außerhalb schließt es ebenfalls. Ein bewusster Charakterwechsel schließt die alte Liste, damit keine Aktion der falschen Figur zugeordnet erscheint. Fortschritte im laufenden Kampf erhalten dagegen geöffnetes Menü, Suchtext, Scrollposition und laufende Eingaben. Ein Reaktionshinweis öffnet erst nach ausdrücklichem Klick die passende Abwehr.

Ein bewusst geöffneter vollständiger Systembogen oder Würfeldialog darf als separates Fenster größer sein. Diese Fenster sind nicht Teil der garantierten HUD-Grundhöhe und werden in den Flächenwerten nicht mitgerechnet. Die im Vergleich gezeigten Menüflächen werden dagegen ausdrücklich mitgezählt.

## Umfang von „Ausrüstung“

**Istzustand:** Der Bereich „Ausrüsten“ im lokalen Angriffsmenü berücksichtigt derzeit ausschließlich eingebettete Items vom Typ `weapon` und `shield`. Der Schalter verwendet `item.system.equipped`. Siehe `Modul/splittermond-smoother-fight/scripts/features/hud/view.js`, Funktionen `buildAttackControlMarkup` und `buildAttackMenuBody`.

**Vorgeschlagener Umfang des neuen Menüs:** alle körperlichen Gegenstände des im Fokus geöffneten Actors bzw. synthetischen Token-Actors, unabhängig davon, ob angelegt oder verstaut. Maßgeblich ist der systemseitige Gegenstandstyp:

| Systemtyp | Im Menü | Beispiele |
| --- | --- | --- |
| `weapon` | Waffen | Schwert, Bogen, Kampfstab |
| `shield` | Schilde | Rundschild |
| `armor` | Rüstungen | Lederrüstung, Kettenhemd |
| `projectile` | Munition | Pfeile, Bolzen |
| `equipment` | Sonstige Gegenstände | Tränke, Seile, Werkzeuge, Vorräte, Amulette |

Diese fünf Typen sind im lokal gesicherten Systemmanifest 14.3.0-beta3 vorhanden. Die Zuordnung erfolgt nicht anhand von Namen, Gewicht, Preis oder Zauberwirkung. Ein magischer Stab bleibt entsprechend seinem gespeicherten Typ Waffe oder sonstiger Gegenstand. Gegenstände in Kompendien oder auf fremden Actors gehören nicht automatisch zum Inventar dieser Figur.

Zauber, Meisterschaften, Stärken, Ressourcen, Zustände und Effekte gehören in ihre jeweiligen Ansichten bzw. den vollständigen Bogen. Natürliche Angriffe und NSC-Angriffe erscheinen unter **Angriffe**, auch wenn ihnen kein Ausrüstungsgegenstand entspricht.

Die Liste zeigt Name, Gegenstandsart, Menge und den vom System unterstützten Ausrüstungszustand. Filter erlauben „Alles“, „Angelegt“ und die fünf Arten. Öffnen des Itembogens ist immer im Rahmen der vorhandenen Rechte möglich. An-/Ablegen, Mengenänderung und Benutzen werden nur angeboten, soweit der jeweilige Typ und das System sie unterstützen. Ein „Heiltrank“ im allgemeinen Inventar löst durch seinen Namen allein keine automatische Heilung aus. Der schnelle Waffen-/Schildzugriff im Angriffsmenü kann bestehen bleiben; er greift auf dieselben Items zu und erzeugt keine zweite Inventarliste im Datenmodell.

## Spieler

Ein Klick auf **Mein Charakter** öffnet den zugeordneten Hauptcharakter. Die Auswahl wird bei der ersten Nutzung sinnvoll vorbelegt; bei mehreren gleichrangigen Figuren zeigt der Wähler die eigenen Charaktere. Danach bleibt die letzte persönliche Auswahl erhalten.

Der Wähler enthält Charaktere, für die der Benutzer die erforderlichen Rechte besitzt, einschließlich Begleitern und weiterer zugeordneter Figuren. Bei nur einer Figur genügt die Namensanzeige ohne Dropdown. Einträge nennen den Token bzw. die Szene, wenn derselbe Actor mehrfach vorhanden ist.

Im Fokus sind jederzeit die erlaubten Charakterinformationen erreichbar: Ressourcen, abgeleitete Werte, Fertigkeiten, Angriffe samt Eigenschaften, Zauber, Inventar, Zustände, Effekte und laufende Vorbereitungen. **Charakterbogen** öffnet mit einem Klick den vollständigen Systembogen genau dieses Actors bzw. synthetischen Token-Actors. Meisterschaften, Stärken, Notizen und seltener benötigte Angaben erhalten dadurch einen vollständigen Zugang, ohne das HUD um weitere dauerhafte Kategorien zu erweitern.

Ansehen und Ausführen werden getrennt: Auch außerhalb des eigenen Zuges sind Angriffe und Zauber einsehbar. Reguläre Kampfhandlungen folgen den vorhandenen Zug- und Regelprüfungen. Zulässige Proben, Inventarverwaltung und Reaktionen bleiben verfügbar. Eine gesperrte Ausführung nennt den konkreten Grund am betreffenden Befehl, statt die gesamte Kategorie auszublenden. Das Konzept erweitert keine Spielerrechte.

## Spielleitung

**Charakterfokus → Charakter auswählen** öffnet dieselbe Oberfläche für jede Figur. Das Menü bietet die aktuelle Szene zuerst, dazu alle verfügbaren Actors; Suche erscheint im geöffneten Menü. Im HUD steht sichtbar **„Im Fokus · SL“** bzw. **„Aktionen für [Name]“**.

Für einen Actor ohne Szenentoken sind Bogen und Actor-Aktionen verfügbar. Tokenbezogene Entfernung, Bewegung und Tickverwaltung sind als „Kein Token in dieser Szene“ bzw. „Nicht im Kampf“ gekennzeichnet. Bei mehreren Tokens ist eine konkrete Auswahl nötig; ein gleicher Name reicht nicht zur Zuordnung.

Die SL kann Ressourcen, Ausrüstung und Effekte verwalten, Proben ausführen und vorhandene SL-Befehle für den gewählten Charakter verwenden. Tickänderungen nennen den Empfänger ausdrücklich, etwa **„Rattling +3 T“**. Befehle für den Kampfablauf bleiben eindeutig auf den laufenden Kampf bezogen. Eine Fokusauswahl allein rückt keine Ticks vor.

Ein optionaler Einstieg „Im HUD ansehen“ am Token oder im Kontextmenü des Kampftrackers kann den Wähler ergänzen. Das bloße Anklicken einer Figur auf der Karte sollte eine bewusst gewählte HUD-Ansicht nicht ständig ersetzen. Die direkte Token-Auswahl im interaktiven Beispiel verkürzt diesen Einstieg nur zur Demonstration.

## Ziele und Wechselverhalten

| Ansicht | Großes Ziel rechts | Persönliches Ziel |
| --- | --- | --- |
| Am Zug | Zielwahl des aktuellen Zuges, gemäß Sichtrechten | Als beschrifteter Eintrag in der Kampfzeile sichtbar und direkt erreichbar |
| Eigener Charakter | Persönliche Zielwahl für diesen Charakter | Vollständige Zielkarte; Eintrag in der Kampfzeile bleibt wiedererkennbar |
| SL-Charakterfokus | Zielwahl der SL für den gewählten Charakter | Als eigene Auswahl beschriftet; die Zielmarkierungen des zugeordneten Spielers bleiben unabhängig |

Die persönliche Zielwahl sollte pro **Benutzer + Szenentoken** erhalten bleiben, bei einem Actor ohne Token pro **Benutzer + Actor**. So verliert die SL beim Wechsel zwischen zwei NSCs nicht deren unterschiedliche Ziele. Auch Spieler mit mehreren Figuren behalten getrennte Auswahlen. Primärziel und weitere Ziele gehören gemeinsam in diesen Kontext; zusätzliche Ziele werden kompakt als „+2“ mit aufklappbarer Liste dargestellt.

Ohne Ziel zeigt die Karte „Kein eigenes Ziel“ und „Ziel wählen“. Ein verschwundenes oder nicht mehr sichtbares Ziel wird als nicht verfügbar behandelt und nicht stillschweigend durch das Ziel des aktiven Actors ersetzt. Verborgene Zielinformationen bleiben auch in der kompakten Kampfzeile verborgen.

Bei SL-Zugriff auf eine Spielerfigur kann dessen aktuelle Zielwahl als lesbare Ausgangsinformation dienen. Das reine Ansehen übernimmt keine fremde Foundry-Zielmarkierung. Eine Änderung durch die SL ist ihre eigene, klar bezeichnete Auswahl. Beim Ausführen wird genau diese Zielwahl an die Aktion übergeben; laufende Kampfereignisse behalten ihre ursprünglichen Ziele.

**Beispiel:** Farruk greift den Rattling an. Liandra wählt währenddessen den Bogenschützen als eigenes Ziel. Die Kampfzeile zeigt weiterhin „Farruk → Rattling“. Liandras Zielkarte zeigt „Bogenschütze“. Ein Wechsel zurück auf „Am Zug“ macht den Rattling groß sichtbar; „Dein Ziel: Bogenschütze“ bleibt klein erreichbar.

Wechselregeln:

1. **Am Zug** folgt automatisch dem nächsten Combatant.
2. **Charakterfokus** bleibt beim gewählten Charakter, auch wenn die Tickreihenfolge weiterläuft. Ein zusätzlicher Pin-Modus ist dafür nicht nötig.
3. Wird der betrachtete eigene Charakter aktiv, erscheint „Du bist dran“. Das HUD zeigt weiterhin dieselbe Figur; jetzt sind die entsprechenden Zughandlungen verfügbar.
4. Wird ein anderer eigener Charakter aktiv, bietet die Kampfzeile „Nebel ist dran · Anzeigen“. Kein unerwarteter Kontextwechsel während der Bedienung.
5. Bei Abwehr oder Unterbrechung bleibt der zuständige Charakter am Hinweis benannt. Ein Klick öffnet die passende Reaktion. Ein bereits offener Dialog behält seinen ursprünglichen Actor, Token und Vorgang.
6. Bei verborgenem aktivem Combatant lautet die Kampfzeile „Verborgener Kämpfer am Zug“. Namen und Ziele werden nicht verraten; der eigene Charakter bleibt bedienbar.
7. Ohne eigenen Charakter gibt es keinen leeren persönlichen Modus. Ein berechtigter Actor außerhalb des Kampfes bleibt über den Wähler/Bogen zugänglich. Nach Kampfende kann die persönliche Ansicht bestehen bleiben, ohne Zugsteuerung.

## Kompakte Darstellung

Beim Einklappen bleiben die Zugzeile mit eigenem Ziel sowie der laufende Vorgang sichtbar. Die persönliche Zielanzeige benennt den zugehörigen Charakter, sobald sonst eine Verwechslung möglich wäre. Ein Klick auf das eigene Ziel öffnet die persönliche Ansicht samt Zielauswahl. Lange Namen werden gekürzt und sind bei Fokus oder Hover vollständig lesbar. Der kompakte Zustand ist im FullHD-Entwurf 100 Pixel hoch.

Bei wenig Breite werden die Kontextzeilen umgebrochen; Porträts stehen kompakt nebeneinander, Aktionen darunter. Große Porträts oder zusätzliche Informationsspalten sind nicht nötig. Suche, Inventardetails und weitere Ziele erscheinen erst nach gezieltem Öffnen.

## Bezug zum aktuellen Modul und Umsetzung

Bereits vorhanden sind die Trennung von `getHudContext()` und `getPersonalHudContext()`, persönliche Bedienelemente und eine Auswahl eigener Combatants. In `view.js` stammen die großen Porträts und die Zielspalte noch aus dem aktiven Kontext; die persönliche Ansicht ersetzt nur einen Teil der Bedienelemente. Der persönliche Kandidatenpfad ist bisher für die SL ausgeschlossen und auf den laufenden Kampf begrenzt.

Die Zielauswahl wird derzeit über den Benutzer bzw. Laufzeitcontroller bezogen. Getrennte Ziele pro Figur sind deshalb eine bewusste Datenmodell-Erweiterung, keine reine Umbenennung der Zielanzeige.

Für die Umsetzung sind drei getrennte Kontexte sinnvoll:

- `turnContext`: aktiver Combatant, Kampfstatus und veröffentlichte Zielinformation.
- `inspectionContext`: Figur und Token der geöffneten HUD-Ansicht einschließlich Einsichtsrechten.
- `actionContext`: ausdrücklich autorisierte Figur, Token, Combatant und persönliche Zielauswahl für einen konkreten Befehl.

Der Befehlskontext wird beim Öffnen eines Dialogs bzw. Starten einer Aktion festgehalten und beim Ausführen erneut auf Berechtigung und Gültigkeit geprüft. Ein späterer HUD-Wechsel darf ihn nicht umleiten. Für bereits angelegte Kampfereignisse bleibt deren gespeicherter Vorgangskontext maßgeblich. Client-Fokus ist keine neue Eigentümer- oder Laufzeitcontrollerzuordnung.

Sinnvolle Reihenfolge: den permanenten Kampfereignisbereich mit stabiler Höhe entwickeln; vollständigen Fokuswechsel samt eindeutigem Porträt und Bogen anbieten; Zielkontexte voneinander lösen; danach die SL-Auswahl über alle Actors und die Fälle ohne Combatant integrieren. Der Kampfereignisbereich und der private Charakterzugriff müssen sich unabhängig aktualisieren können. Die spätere Umsetzung des Konzepts umfasst alle Schritte.

Akzeptanzkriterien sind insbesondere: eigener Zugriff während fremder Züge; SL-Fokus auf fremde Figuren; unabhängige Ziele mehrerer Figuren; keine Einsicht in verborgene Werte; unveränderte Zuordnung offener Würfeldialoge und Abwehrereignisse; korrekte Auswahl synthetischer Actors; verständliche Bedienung bei schmalem bzw. eingeklapptem HUD.
