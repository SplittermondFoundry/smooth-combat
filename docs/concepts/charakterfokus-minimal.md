# Kleine Erweiterung: Charakterwahl im bestehenden HUD

Stand: 14. September 2026. Konzeptgrundlage nach der Rückmeldung, das bestehende HUD grundsätzlich beizubehalten. Die Umsetzung liegt inzwischen im lokalen Branch `codex/character-focus`; siehe [Funktionsvorschau und Rückkehr](../character-focus-preview.md). Die Foundry-Installation ist unverändert.

## Umfang

Das vorhandene HUD behält Aufbau, Position, Farben, große Porträts, Bewegung, Aktionsmenüs und Kampfereignisse. Ergänzt werden eine auswählbare eigene bzw. SL-Figur, eine kleine zweite Charakter-/Zielkarte bei unterschiedlichen Tokens und eine eindeutige Zuordnung der Befehle. Der frühere Entwurf mit neuer Kontextnavigation, eigener dauerhafter Ereignisleiste, festen 296 Pixeln Gesamthöhe und zusätzlichen Reitern wird nicht weiterverfolgt.

## Gestapelte Karten

Links stehen die Rollen **Gerade aktiv** und **Dein Charakter**, rechts **Primärziel** und **Dein Ziel**. Bei SL-Zugriff auf eine andere Figur heißt die persönliche Rolle **SL-Auswahl**. Zielüberschriften nennen die Bezugsfigur, etwa „Primärziel · Geistervarg“ und „Dein Ziel · Peritus“.

Je Seite bleibt eine große Karte im bisherigen Format von 172 × 246 Pixeln erhalten. Eine zweite, abweichende Figur erscheint mit Bild und Namen als 172 × 72 Pixel große Karte; dazwischen liegen 6 Pixel Abstand. Die Rollen bleiben in fester Reihenfolge: persönlich oben, aktiv bzw. Primärziel unten. Der gerade bediente Charakter und sein zugehöriges Ziel erhalten die große Karte. Beim Umschalten wechseln lediglich die Größen und Inhalte, nicht die Reihenfolge der Rollen. Die Charakterwahl ist standardmäßig aktiv und lässt sich pro Client ausschalten.

Sind aktiver und persönlich gewählter Token identisch, erscheint eine einzige große Karte mit „Gerade aktiv + dein Charakter“ bzw. „Gerade aktiv + SL-Auswahl“. Sind die Ziele identisch, erscheint eine einzige Karte mit „Primärziel + dein Ziel“. Beide Zusammenführungen erfolgen unabhängig voneinander.

Verglichen wird die **Token-UUID einschließlich Szene**, nicht der Anzeigename und nicht allein die Actor-ID. Zwei Tokens desselben Actors sind zwei verschiedene Figuren im Kampf. Ohne Szenentoken wird die Actor-UUID nur für den persönlichen Zugriff verwendet; daraus entsteht keine Gleichheit mit einem aktiven Kampftoken.

Die großen Karten verwenden die bisherigen Originalbilder. Die kleinen Karten enthalten einen Bildbereich von 48 × 48 Pixeln. Werte und Ressourcen erscheinen nur bei ausreichenden Sichtrechten. Die Vorschau verwendet aus der vorhandenen Aufnahme ausgeschnittene Bilder; deren begrenzte Qualität und die beispielhaften Werte sind keine Vorgabe für die Umsetzung.

## Umschalten und Charakterwahl

Ein Klick auf die Kopfzeile bzw. den auswählbaren Bildbereich der linken Karte macht diese Figur zum Bedienkontext. Der vorhandene Bogenknopf öffnet weiterhin den zugehörigen vollständigen Systembogen. Ein kleiner Pfeil bei „Dein Charakter“ bzw. „SL-Auswahl“ öffnet die Auswahl. Spieler erhalten ihre berechtigten Figuren, die SL alle Actors, mit konkreter Tokenauswahl, falls mehrere Instanzen vorhanden sind. Bei nur einer eigenen Figur entfällt ein überflüssiger Auswahlpfeil.

Eine kleine Angabe **„Bedienung: [Name]“** in der bestehenden Kopfzeile macht die Zuordnung ausdrücklich sichtbar. Die Zuganzeige daneben benennt weiterhin den tatsächlich aktiven Token. Ein bewusster Wechsel schließt offene Auswahlmenüs. Bereits geöffnete Würfeldialoge behalten ihren ursprünglichen Befehlskontext.

Die persönliche Auswahl bleibt bei Tickwechseln erhalten. Die Auswahl „Gerade aktiv“ folgt dem Kampf. Die Kamera, Foundrys aktiver Combatant und fremde Benutzerziele ändern sich durch das Umschalten nicht. Ein Klick auf eine Zielkarte öffnet deren erlaubte Informationen, ohne den Bedienkontext auf das Ziel umzulenken.

Persönliche Zielwahl und Zugriff der SL bleiben pro Benutzer und gewähltem Token getrennt vom Ziel des aktuellen Zuges. Es wird keine Zielwahl eines anderen Benutzers überschrieben. Ohne Ziel erscheint der entsprechende bisherige Leerzustand. Verborgene Ziele verraten weder Namen noch Bilder. Ein Actor ohne Szenentoken bietet Bogen und erlaubte Actor-Aktionen; tokenabhängige Entfernung und Kampfsteuerung nennen den fehlenden Token als Grund.

## Bestehende Menüs und Ausführung

Fertigkeiten, Angriffe, Zauber und Aktive Abwehr bleiben in der vorhandenen Aktionszeile. Ihre vollständigen Listen klappen wie bisher auf und scrollen innerhalb des Menüs. Favoriten, Standardangriffe, Vorbereitung, bestehende Ausrüstungsschalter und die Handlungsübersicht bleiben erhalten. Es gibt keinen neuen Ausrüstungsreiter als Bestandteil dieser kleinen Erweiterung.

Die Menüs lesen den Bedienkontext. Inventar, Meisterschaften, Notizen und weitere Angaben bleiben zusätzlich über den vollständigen Bogen erreichbar. Personenbezogene Bewegung, Tickänderungen und Befehle müssen den ausgewählten Empfänger eindeutig verwenden und weiterhin ihre bisherigen Berechtigungs- und Regelprüfungen durchlaufen. Ein bloßer Kontextwechsel ist keine Handlung.

Während eines laufenden Kampfes gilt zusätzlich:

| Zugriff | Ausgewählter Token ist nicht aktiv |
| --- | --- |
| Fertigkeiten anzeigen und erlaubte Proben ausführen | Weiter verfügbar |
| Nahkampfangriffe | Vorhandene Regeln und Berechtigungen gelten weiter; keine neue pauschale Zugsperre |
| Zauber und Fernkampfangriffe ansehen | Vollständig verfügbar |
| Zauber oder Fernkampfangriff neu beginnen/vorbereiten | Gesperrt; Hinweis „Nur im eigenen Zug starten“ |
| Aktive Abwehr | Für zulässige Reaktionen verfügbar, auch außerhalb des Zuges |

Die zusätzliche Startsperre gilt ebenfalls bei normalem SL-Zugriff auf eine andere Figur. Die Menüs selbst bleiben geöffnet und bedienbar; nur die ausführenden Start-/Vorbereitungsbefehle sind deaktiviert. Bestehende Regeln für bereits vorbereitete Aktionen und deren Auslösung werden dadurch nicht pauschal ersetzt. Außerhalb eines laufenden Kampfes gelten die bisherigen Möglichkeiten.

Die Startsperre gehört in den tatsächlichen Ausführungspfad, nicht allein in die Darstellung des Buttons. Beim Start werden Token, aktiver Combatant und Berechtigung erneut geprüft. Identischer Actor bei unterschiedlichem Token genügt nicht. Dieselbe Prüfung muss greifen, wenn sich der aktive Token während eines geöffneten Menüs ändert.

## Den Kampf verfolgen

Die bestehende Zugzeile, die kleine Karte des aktiven Tokens, dessen Primärziel und der vorhandene Bereich **Kampfereignisse** bleiben auf den tatsächlichen Kampf bezogen. Dieser Bereich wird durch den Charakterwechsel nicht gefiltert, ersetzt oder auf den betrachteten Actor umgelenkt. Bestehende Chat- und Ereigniskarten werden nicht neu gestaltet.

Der laufende Vorgang bleibt in der bestehenden Ereignisliste sichtbar; sein zusammengeklappter Eintrag kann den ausstehenden Schritt nennen, beispielsweise „Geistervarg → Söldner · Aktive Abwehr läuft“. Das ist eine kleine Ergänzung der vorhandenen Ereignisüberschrift. Es entsteht keine zweite Ereignisleiste. Eine ausstehende Reaktion benennt stets den richtigen Empfänger und Vorgang. Das Öffnen eines Menüs darf Suche, Scrollposition und Eingaben nicht durch Kampfaktualisierungen zurücksetzen.

Das bisherige Auf-/Zuklappen von Ereignisdetails und seine variable Höhe bleiben erhalten. Die Platzersparnis wird daher nicht mit der festen Höhe des verworfenen Entwurfs begründet. Ein minimiertes HUD behält seinen bisherigen Grundaufbau; diese Vorschau untersucht den ausgeklappten Zustand.

## FullHD-Vergleich und Grenzen der Vorschau

Grundlage ist dieselbe echte Foundry-Aufnahme mit 1920 × 1080 Pixeln. Unter „Istzustand“ wird sie unverändert gezeigt. Die neue Ansicht ergänzt beispielhafte Figuren, Zielwahl, Bedienung und einen laufenden Vorgang. Ihre Werte sind keine Behauptung über die tatsächliche Welt. Auch bei Auswahl der Spielerrolle bleibt das Hintergrundbild eine SL-Aufnahme.

- HUD-Mitte: weiterhin rund **864 × 340 Pixel**, bei **x = 411, y = 730** für die gezeigten geschlossenen Ereignisse.
- Große Seitenkarte: weiterhin **172 × 246 Pixel**, Unterkante y = 1070.
- Bei verschiedenen Figuren: Seitenstapel **172 × 324 Pixel**, Oberkante y = 746.
- Die bestehende Zielauswahl oberhalb der rechten Karten wandert bei einem zweiten Ziel um 78 Pixel nach oben; damit liegt sie bei y = 712. Es werden keine zwei vollständigen 246 Pixel hohen Porträts aufeinander gestapelt.
- Bei zwei unterschiedlichen Figuren und Zielen entstehen insgesamt rund **26.800 zusätzliche überdeckte Pixel**, etwa **1,3 % des FullHD-Bildschirms**. Die mittlere Kartenfläche oberhalb des HUDs wird nicht durch eine neue breite Leiste beansprucht. Bei identischen Paaren entfällt der jeweilige Zusatz.

Die Vorschau demonstriert den Rollenwechsel, unabhängiges Zusammenführen der Karten, SL-Auswahl, geöffnete lange Listen und die Startsperre. Bogen-, Würfel-, Tick- und Bewegungsbefehle sind Platzhalter; sie verändern keine Foundry-Daten. Der Rollenwähler und die Beispielauswahl oberhalb des Bildes gehören zur Vergleichsansicht, nicht zum vorgeschlagenen HUD.

## Prüfung vor einer späteren Übernahme

Zu prüfen sind insbesondere: keine doppelte Karte bei identischem Token; zwei Karten bei unterschiedlichen Tokens desselben Actors; keine unberechtigten Bilder/Werte; stabile persönliche Auswahl während fremder Züge; unabhängige persönliche Ziele; unveränderte Kampfereignisse; erlaubte Aktive Abwehr außerhalb des Zuges; gesperrter neuer Zauber-/Fernkampfstart außerhalb des eigenen Zuges einschließlich SL-Zugriff; erneute Prüfung beim Start nach zwischenzeitlichem Tickwechsel.

Die Umsetzung ist durch einen lokalen Entwicklungsbranch, den Ausgangstag `codex/hud-before-character-focus-20260914`, eine vollständige Sicherung des installierten Moduls und getrennte Browser-Testdaten abgesichert.
