# Splittermond Smoother Fight 0.6.3

Dieses Update ergänzt **Zauber identifizieren** in der Handlungsübersicht und behebt ausbleibende Abschlüsse von Bewegungen und kontinuierlichen Handlungen in Splittermond **14.2.7 und 14.3.x**.

## Zauber identifizieren

- Die Handlung öffnet eine Arkane-Kunde-Probe und kostet bei ausgeführter Probe zwei Ticks als sofortige Reaktion. Beim Abbrechen werden keine Ticks verbraucht.
- Die Schwierigkeit lässt sich frei eintragen oder mit Buttons für Grad 0–5 auf **15 + dreifachen Zaubergrad** setzen.
- Bei **Zauber bereits fertig gewirkt** erscheinen Auswahl und Hinweistext zum negativen Umstand (−2, −4 oder −6). Beim Abwählen wird der Bereich wieder ausgeblendet.
- Während des Wirkens kann das Weglassen von Gesten oder Formel mit **−3** berücksichtigt werden. Fehlen beide Komponenten, verhindert der Dialog den Identifikationsversuch während des Wirkens.
- Die Modifikatoren gelten nur für diese Probe. Der Chat zeigt passende Hinweise für alle fünf Ergebnisstufen, ausschließlich zur Zauberidentifikation. Private und blinde Würfe sowie verborgene Schwierigkeiten werden berücksichtigt.
- Dialog und Ergebnistexte stehen auf Deutsch und Englisch bereit.

## Fehlerbehebungen

- Bewegungen erreichen ihre fälligen Zwischenpunkte und die Zielposition auch dann, wenn Splittermond mehrere Combatants auf demselben Tick durch Nachkommastellen sortiert. Auch bereits gespeicherte Bewegungspläne werden korrekt ausgewertet.
- Kontinuierliche Handlungen, einschließlich **Gegenstand verwenden**, schließen beim vorgesehenen eigenen Zug ab. Gleichzeitige Statusänderungen werden nacheinander verarbeitet, damit ein Abschluss während eines noch laufenden Speichervorgangs nicht verloren geht.
- Ein Fehler bei einem Token verhindert nicht mehr, dass die fälligen Bewegungen und Handlungen der übrigen Tokens verarbeitet werden. Der Fehler bleibt in der Konsole sichtbar.
- Die Korrekturen gelten für **14.2.7 und 14.3.x**. Die Spieler–SL-Kommunikationskorrektur aus [0.6.2](https://github.com/SplittermondFoundry/smooth-combat/releases/tag/v0.6.2) ist weiterhin enthalten.

## Prüfung und Kompatibilität

- `npm run check`: 714 automatisierte Tests sowie 79 zusätzliche Prüfungen des Regelkerns mit Coverage-Vorgaben.
- Die Bewegungs- und Handlungsabschlüsse wurden zusätzlich mit den originalen Kampfklassen von Splittermond **14.2.7** sowie **14.3.0-alpha1 bis alpha5 und beta1** in einer lokalen Testumgebung geprüft. Dies ersetzt keinen Test auf dem betroffenen Live-Server.
- Der deutsche und englische Identifikationsdialog wurde im Browser mit Foundry-Styles geprüft, einschließlich Gradbuttons, ein- und ausgeblendeter Umstände sowie der Übergabe von Schwierigkeit und Modifikator.
- Die Voraussetzungen bleiben unverändert: Foundry VTT 14 ab Build **14.359** und Splittermond ab **14.2.0**.

## Update

Das Modul über Foundrys Modulverwaltung aktualisieren und die Welt anschließend neu starten. Danach sollen Spielleitung und Spieler ihre Browserseiten neu laden. Einstellungen und Weltdaten müssen nicht migriert werden.
