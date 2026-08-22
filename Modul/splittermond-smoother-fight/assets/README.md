# Austauschbare Medien

Diese Dateien sind die mitgelieferten Standards von Smoother Fight. Ihre stabilen, sprechenden Namen erleichtern eigene Medienpakete.

## Hintergründe

- `backgrounds/hud-dark.jpg`: HUD und dunkles Theme
- `backgrounds/hud-light.jpg`: HUD, helles Theme und Einstellungsfenster

Eigene Hintergrunddateien werden unter **Moduleinstellungen → Darstellung und Medien** ausgewählt.

## Ereignisicons

- `icons/active-defense.svg`: Aktive Abwehr
- `icons/damage.svg`: erlittener Schaden
- `icons/damage-blocked.svg`: vollständig abgewehrter Schaden
- `icons/spell.svg`: Zauber
- `icons/ranged.svg`: Fernkampfangriff
- `icons/turn.svg`: eigener Zug

Für ein vollständiges eigenes Icon-Set werden diese sechs Dateien mit unveränderten Namen in einen Ordner im Foundry-Datenverzeichnis kopiert. Anschließend wird dieser Ordner unter **Darstellung und Medien** ausgewählt. Die SVGs werden als Masken eingefärbt; einfarbige, deckende Formen funktionieren deshalb am besten.

## Audiosignale

- `audio/shield.wav`: Schutzakkord
- `audio/impact.wav`: dunkler Einschlag
- `audio/blocked.wav`: abgewehrter Treffer
- `audio/arcane.wav`: arkanes Signal
- `audio/shot.wav`: Fernkampfsignal
- `audio/turn.wav`: Zugsignal

Eigene Audiodateien werden je Ereignis unter **Audiohinweise** ausgewählt. Die Standard-WAVs lassen sich im Entwicklungsprojekt mit `npm run assets:audio` reproduzierbar neu erzeugen.

## Updatesicherheit

Die mitgelieferten Dateien nicht direkt bearbeiten: Foundry ersetzt den Modulordner bei einem Update. Eigene Medien gehören außerhalb des Modulordners in das Foundry-Datenverzeichnis und werden über die beiden Einstellungsdialoge referenziert.
