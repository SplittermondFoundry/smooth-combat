# Architektur von Splittermond Smoother Fight

Diese Regeln sind für alle künftigen Änderungen verbindlich. Sie halten fachliche Änderungen lokal, schützen die Foundry-Integration und verhindern, dass erneut eine Monolith-Datei entsteht.

## Abhängigkeitsrichtung

```text
smoother-fight.js (Composition Root)
        ↓
core / features/*/api.js
        ↓
feature-interne Module
        ↓
domain / shared
```

- `scripts/smoother-fight.js` verdrahtet ausschließlich Module und registriert die beiden Foundry-Lebenszyklus-Einstiege. Dort werden keine Funktionen oder Klassen implementiert.
- `scripts/domain/**` enthält reine Berechnungen und Datenregeln. Domainmodule greifen niemals auf Foundry-, Browser- oder DOM-Globals zu.
- `scripts/features/<feature>/**` besitzt die Implementierung und den flüchtigen Zustand eines fachlichen Bereichs.
- `scripts/shared/**` enthält kleine Foundry-nahe Hilfen, die von mehreren Features benötigt werden.
- `scripts/core/**` registriert Settings, Hooks und Socketrouting und enthält keine fachlichen Regeln. Core routet Zustandsänderungen ausschließlich an Featureoperationen weiter.

Relative Importe müssen auflösbar und der gesamte Produktionscode vom in `module.json` eingetragenen Einstieg erreichbar sein. Importzyklen sind nicht erlaubt.

## Featuregrenzen

Die bestehenden Features sind:

- `active-defense`: Koordination und Zustand der Aktiven Abwehr
- `assignments`: Benutzer-, Bogen- und Tokenzuordnungen sowie deren Settings-Anwendung
- `chat`: Nachrichtenlebenszyklus, Aktionsrouting und Berechtigungen
- `combat-actions`: Angriffe, Zauber, Ticks und vorbereitete Aktionen
- `combat-events`: Gruppierung, Darstellung und Zustand der Kampfereignisse
- `feedback`: Audio- und Schadensfeedback samt persönlicher Settings-Anwendung
- `fumbles`: Erkennung, Darstellung und Anwendung von Patzerfolgen
- `hud`: Controller, Kontext, Views, View-Zustand und Sichtbarkeit
- `targeting`: Zielverwaltung und Token-Hervorhebung

Eine normale Änderung soll innerhalb eines Features bleiben und üblicherweise höchstens ein bis drei Produktionsdateien plus den zugehörigen Test berühren.

## Featureübergreifende API

Dateien desselben Features importieren einander direkt. Featuremodule importieren keine internen Dateien anderer Features. Benötigte featureübergreifende Operationen werden ausschließlich in `features/<feature>/api.js` veröffentlicht, in der Composition Root einmalig über `configureServices(...)` registriert und anschließend über die eingefrorene `services`-Fassade aufgerufen.

- Nur tatsächlich featureübergreifend benötigte Symbole werden aus `api.js` reexportiert.
- Die Composition Root darf reine Init-/Ready-Einstiege direkt importieren; ohne Featureverbraucher gehören sie nicht in die Service-Fassade.
- Lokale Helfer bleiben ohne `export` in ihrer Datei.
- Jeder konfigurierte Export muss mindestens einen `services.<name>`-Verbraucher haben.
- Dieser Verbraucher muss außerhalb des bereitstellenden Features liegen; featureinterne Aufrufe verwenden direkte Importe.
- Dynamische Zugriffe wie `services[name]` sind nicht erlaubt.
- Doppelte Servicenamen führen bereits beim Start zu einem Fehler.

Der statische ES-Modulgraph bleibt dadurch azyklisch und seine Grenzen sind unmittelbar sichtbar. Die Fassade bildet die spät gebundene Laufzeit-Zusammenarbeit der Features ab; sie ersetzt keine fachliche Zuständigkeit. Der Architekturtest kontrolliert fehlende, doppelte, interne und unbenutzte Fassadeneinträge.

## Zustand

Es gibt keinen gemeinsamen globalen Laufzeitcontainer. Flüchtiger Zustand liegt in der jeweiligen `state.js`:

- HUD-Zustand in `features/hud/state.js`
- Ziele in `features/targeting/state.js`
- Abwehr in `features/active-defense/state.js`
- Feedback in `features/feedback/state.js`
- Aktionen in `features/combat-actions/state.js`
- Kampfereignisse und Schadensworkflow in `features/combat-events/state.js`

Neue Zustände gehören in das verantwortliche Feature. Eine `state.js` darf ausschließlich innerhalb ihres besitzenden Features importiert werden. Andere Features, Core und Composition Root lesen oder verändern diesen Zustand nur über benannte Operationen der öffentlichen Feature-API.

## Benutzerzuständigkeit und Systemziele

Das Feature `assignments` trennt drei Begriffe strikt:

- Der **Assigned User** stammt dauerhaft aus direkter Token-Zuordnung, Bogen-Zuordnung oder deterministischem Foundry-OWNER-Fallback. Anwesenheit beeinflusst diese Auflösung nicht.
- Der **Runtime Controller** ist der aktive Assigned User oder ersatzweise der aktive konfigurierte Primary GM beziehungsweise deterministisch der erste andere aktive GM. Dieser Fallback wird niemals gespeichert.
- Der **Current Turn Controller** ist der Runtime Controller des aktuellen Combatants und alleinige Quelle für persönliche Zughinweise und Feedback.

HUD, Chat, Targeting, Angriffe, Zauber und Aktive Abwehr verwenden diese Resolver über die Service-Fassade. Eigene Online-/Fallback-Varianten in einzelnen Features sind nicht zulässig.

Splittermond 14.3 wertet zielabhängige Würfe über das erste Element von `game.user.targets` aus und bietet der Actor-Roll-API keinen Targetparameter. `targeting.withTemporarySystemTargets(...)` ist deshalb die einzige Stelle, die für einen Systemwurf den Targetzustand des ausführenden Clients temporär ersetzt und anschließend auch im Fehlerfall wiederherstellt.

## Stabile Laufzeitverträge

Die Schreibzugriffe für zeitgesteuerte Status-Items laufen über `shared/status-effect-compatibility.js`: Splittermond 14.2.x verwendet `startTick`, `interval` und `times`; neuere 14.3-Versionen verwenden `combatEvent`. Das registrierte `CONFIG.Item.dataModels.statuseffect.schema` entscheidet über das Format, weil frühe 14.3-Vorabversionen noch das alte Schema besitzen. Die Versionsnummer ist nur ein Fallback bei fehlendem Schema. Patzerfolgen und Kampfpositionsmarker verwenden denselben Adapter. Fachliche Dauer, Stufe, Modifier und bestehende Dokumente werden nicht migriert oder umgeschrieben.

Folgende Strukturen sind persistierte oder externe Verträge und dürfen nicht beiläufig umbenannt oder umgeformt werden:

- Setting-Schlüssel und ihre Scopes, Typen und Defaults
- Actor-, User- und ChatMessage-Flags
- Sockettypen und Payloadfelder
- Übersetzungsschlüssel
- Handlebars-Templatepfade
- CSS-Klassen, DOM-IDs und aktive `data-*`-Attribute
- der Manifest-Einstieg `scripts/smoother-fight.js`
- die benannten Exporte der reinen Fassade `scripts/combat-rules.js`

Änderungen daran benötigen eine ausdrücklich fachliche Anforderung, Migrationslogik und eigene Vertragstests.

## Views und CSS

Das vollständige HUD-Layout entsteht ausschließlich in `hud/view.js` und `combat-events/view.js`; der Controller montiert das Ergebnis. Fachspezifische DOM-Adapter für Chatkarten, Dialoge, Patzer und Token-HUD dürfen ihr lokal begrenztes Markup im verantwortlichen Feature erzeugen. Die Styles werden in dieser festen Kaskadenreihenfolge geladen:

1. `styles/themes/default.css`
2. `styles/hud.css`
3. `styles/combat-events.css`
4. `styles/settings.css`
5. `styles/responsive.css`

Der versionierte Wrapper bleibt der einzige Manifest-Einstieg. `styles/smoother-fight.css` bleibt als einzeiliger Kompatibilitäts-Wrapper für den früheren direkten Asset-Pfad erhalten. Farben, Medienpfade und Animationsdauer werden zentral in `styles/themes/default.css` deklariert. Der Asset-Vertragstest vergleicht die zusammengefügte Kaskade mit einem SHA-256-Wert. Dieser Wert wird ausschließlich zusammen mit einer ausdrücklich beabsichtigten optischen Änderung aktualisiert.

Die ausgelieferten, austauschbaren Medien liegen unter `assets/backgrounds`, `assets/icons` und `assets/audio`. Laufzeitpfade werden zentral in `core/constants.js` deklariert. Eigene Benutzerdateien werden ausschließlich als Pfade außerhalb des Modulordners gespeichert; direkte Änderungen an ausgelieferten Medien gelten nicht als persistente Konfiguration.

## Vorgehen bei Änderungen

1. Verantwortliches Feature bestimmen.
2. Reine Entscheidung oder Berechnung möglichst im Domainmodul implementieren und mit `node:test` absichern.
3. Foundry-Zugriffe in Feature/Core belassen.
4. Neue lokale Helfer nicht exportieren.
5. Neue featureübergreifende API nur bei echtem Bedarf ergänzen.
6. Persistierte Verträge und vorhandene Selektoren unverändert lassen, sofern die Anforderung keine Migration vorsieht.
7. `npm run check` ausführen.

`npm run check` ist die Definition of Done. Neben allen Verhaltens- und Vertragstests erzwingt es Syntaxprüfung aller Produktionsmodule, Erreichbarkeit, Zyklenfreiheit, Domainreinheit, Feature- und State-Kapselung, ein Dateilimit von 800 Zeilen, verwendete Imports und ausschließlich externe Verbraucher der expliziten Feature-APIs. Der Regelkern muss mindestens 95 % Zeilen-, 75 % Zweig- und 100 % Funktionsabdeckung behalten.
