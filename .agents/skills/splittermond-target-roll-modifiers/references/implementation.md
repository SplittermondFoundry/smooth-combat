# Implementierungsanleitung: zielgebundene temporäre Würfelmodifikatoren

## Zweck und Referenzimplementierung

Diese Anleitung beschreibt den bewährten Ablauf, mit dem ein Merkmal des aktuellen Ziels genau eine Probe beeinflusst, als benannter und bereits aktivierter Modifikator im Splittermond-Würfeldialog erscheint und danach keine weiteren Proben kontaminiert.

Maßgebliche Dateien im aktuellen Projekt:

- `Modul/splittermond-smoother-fight/scripts/features/combat-actions/spell-target-modifier.js`
- `Modul/splittermond-smoother-fight/scripts/features/combat-actions/system-roll-modifier-interceptor.js`
- `Modul/splittermond-smoother-fight/scripts/shared/temporary-selectable-modifier.js`
- `Modul/splittermond-smoother-fight/scripts/shared/temporary-roll-modifiers.js`
- `Modul/splittermond-smoother-fight/scripts/features/combat-actions/actions.js`
- `Modul/splittermond-smoother-fight/scripts/features/targeting/targeting.js`
- `tests/spell-target-modifier.test.mjs`
- `tests/system-roll-modifier-interceptor.test.mjs`

Prüfe diese Dateien vor jeder Erweiterung erneut. Insbesondere nach einem Update des Splittermond-Systems muss verifiziert werden, an welcher Stelle `skill.selectableModifier` in eigenständige Dialogdaten kopiert wird.

## Ablauf im Überblick

```text
Native Action-Bar / Bogen / Systemmakro
  -> Actor.rollAttack/rollSpell-Interceptor
  -> erstes aktuelles game.user.targets-Ziel bestimmen
  -> Zielmerkmal rein lesend erkennen und Auswahl-ID registrieren

HUD-Aktion
  -> Live-Runtime-Kontext bestimmen
  -> Primärziel mit withTemporarySystemTargets(...) als Systemziel einsetzen
  -> bereits vorbereitete Optionen einmalig markieren

Beide Pfade
  -> ursprüngliches actor.rollSpell/rollAttack(..., rollOptions)
     -> private HUD-Kennzeichnung ist bereits entfernt
     -> gewrappter skill.roll erkennt genau seine Auswahl-ID
     -> temporären auswählbaren Modifikator installieren
     -> originalen skill.roll aufrufen
        -> Splittermond kopiert selectableModifier in die Dialogdaten
     -> temporären Modifikator und Auswahl-ID sofort entfernen
  -> Dialog bleibt mit seiner eigenen Kopie offen
  -> äußeres finally räumt auch frühe Fehler- und Abbruchpfade auf
```

Der zentrale Unterschied lautet: Der Modifikator lebt nicht so lange wie der Dialog. Er lebt nur während des synchronen Abschnitts, in dem Splittermond die Dialogdaten aus der Modifier-Collection aufbaut.

## 1. Immer dasselbe aktuelle Ziel wie Splittermond verwenden

Splittermond 14.3 besitzt an `Actor.rollAttack` und `Actor.rollSpell` keinen Targetparameter. Die eigentliche Probe verwendet stattdessen das erste Element von `game.user.targets`. Der zentrale Actor-Interceptor muss deshalb unmittelbar beim Aufruf genau dieses erste Element lesen. Verwende dort nicht eine separat gespeicherte Primärzielreferenz, weil sie bei Mehrfachzielen von dem Ziel abweichen könnte, dessen Schwierigkeit das System berechnet.

Eine HUD-Aktion aktualisiert ihren Action-Kontext zuvor über `liveRuntimeActionContext(context)` und setzt das daraus ermittelte Primärziel ausschließlich für die Dauer des Systemaufrufs mit `services.withTemporarySystemTargets(...)` ein. Dadurch sehen Actor-Interceptor und Splittermond dasselbe Ziel. Nach dem Aufruf stellt der Target-Helfer die vorherige Auswahl auch bei Abbruch und Fehler wieder her.

Erst innerhalb dieser aktuellen Zielumgebung darf die Effektprüfung erfolgen. Falls der betreffende Probentyp ein Ziel verlangt und keines vorhanden ist, beende den HUD-Ablauf vor jeder Registrierung oder Modifier-Installation. Native Systemwürfe ohne Ziel dürfen weiterhin stattfinden; zielabhängige Modifikatoren bleiben dann leer, während rein eigene Modifikatoren weiterhin gelten können.

## 2. Die richtige Effektquelle prüfen

Die Splittermond-v14-Datenmodelle unterscheiden drei relevante Quellen:

| Fachlicher Typ | Collection | Aktivitätsprüfung | Hinweise |
| --- | --- | --- | --- |
| Zustand | `target.actor.items` mit `item.type === "statuseffect"` | Das eingebettete Item selbst repräsentiert den vorhandenen Zustand. Prüfe zusätzlich `system.level > 0`, wenn die Regel eine positive Stufe verlangt. | Zustände besitzen in dieser Systemversion kein allgemeines `system.active`-Feld. |
| Zaubereffekt | `target.actor.items` mit `item.type === "spelleffect"` | `item.system.active === true` | Ein nur vorhandener, aber deaktivierter Zaubereffekt darf nicht zählen. |
| Foundry Active Effect | Für direkt eingebettete Effekte `target.actor.effects`; für alle tatsächlich angewandten beziehungsweise transferierten Effekte gegebenenfalls `target.actor.appliedEffects` | mindestens `effect.disabled !== true`, `effect.isSuppressed !== true` und `effect.duration?.expired !== true` | Entscheide bewusst, ob nur direkte oder auch von Items übertragene Effekte gelten. Durchsuche nicht beide Collections unkontrolliert, sonst entstehen Doppelzählungen. |

Collections können je nach Test und Foundry-Kontext als Array, `Collection`, `Map`, `contents` oder Iterable vorliegen. Verwende eine kleine Konvertierungsfunktion wie `collectionValues`, statt Arraymethoden direkt vorauszusetzen.

### Namen robust vergleichen

Normalisiere Namen vor dem Vergleich mindestens mit:

1. `String(value ?? "")`
2. Unicode-Normalisierung `NFKD`
3. Entfernung kombinierender Zeichen (`\p{Mark}`), falls Umlautvarianten gleich behandelt werden sollen
4. `trim()`
5. `toLocaleLowerCase("de")`

Verwende anschließend fachlich enge Muster. Ein Effekt namens „Kleiner Magieschutzlos“ darf beispielsweise nicht als „Kleiner Magieschutz“ gelten. Wenn mehrere Varianten existieren, sammle erst alle Treffer, bestimme danach die stärkste oder fachlich vorrangige Variante und gib genau einen Modifikator zurück.

Die Erkennungsfunktion bleibt rein lesend und liefert entweder `null` oder einen Datensatz wie `{ name, amount, source }`. Sie installiert selbst keinen Modifikator.

## 3. Einen Modifikator für genau einen Roll vorbereiten

Installiere `installSystemRollModifierInterceptor()` einmal während `ready`. Der Interceptor wrappt die öffentlichen Methoden des konfigurierten `CONFIG.Actor.documentClass.prototype`, nicht einzelne Actor-Instanzen. Damit laufen Action-Bar, Charakterbogen, Systemmakros und direkte `actor.rollAttack`-/`actor.rollSpell`-Aufrufe durch dieselbe Vorbereitung.

Der Actor-Wrapper ermittelt Angriff beziehungsweise Zauber anhand der übergebenen ID, liest das aktuelle Systemziel, berechnet die fachlichen Modifikatoren und ruft erst danach die unveränderte Systemmethode mit vorbereiteten Optionen auf. Er muss `async` sein und sein äußeres Cleanup in `finally` nach Abschluss der originalen Actor-Methode ausführen: Splittermond kann vor dem Eintritt in `skill.roll` selbst asynchrone Arbeit wie `makeSnapshot()` ausführen.

Hat eine HUD-Aktion ihre Optionen bereits gemeinsam mit anderen HUD-spezifischen Modifikatoren vorbereitet, kennzeichnet sie dieses konkrete Optionsobjekt mit `markTargetModifiersPrepared(...)`. Der Actor-Wrapper konsumiert und entfernt die private Kennzeichnung, überspringt nur seine erneute fachliche Vorbereitung und ruft die originale Systemmethode mit den bereinigten Optionen auf. Die Kennzeichnung darf das System niemals erreichen. Dieser Pfad verhindert Doppelzählungen, ohne die bestehende Auswahl-ID zu ersetzen.

Die Prepare-Funktion gibt stets ein einheitliches Ergebnis zurück:

```js
{
    cleanup,
    modifier,
    rollOptions,
    usesNamedModifier,
}
```

Ohne Treffer bleiben die Optionen unverändert und `cleanup` ist eine leere Funktion. Mit Treffer wird eine eindeutige Auswahl-ID erzeugt und zusammen mit dem Modifikator-Datensatz für das konkrete `skill` registriert.

Verwende dafür einen `WeakMap`, dessen Schlüssel das konkrete Skill-Objekt ist. Der Zustand pro Skill enthält:

- die originale `roll`-Funktion einschließlich des ursprünglichen Property-Descriptors,
- genau eine Wrapper-Funktion,
- eine `Map` aus eindeutiger Auswahl-ID und Roll-Datensatz.

Die Auswahl-ID wird als private Option durch `actor.rollSpell`, `actor.rollAttack` oder den jeweiligen Systemaufruf bis zu `skill.roll(options)` transportiert. Der Wrapper darf nur reagieren, wenn diese ID in seiner eigenen Entry-Map existiert. Andere Rolls laufen unverändert durch dieselbe Wrapper-Funktion. Diese Auswahl-ID ist unabhängig von der nur bis zur Actor-Grenze lebenden HUD-Kennzeichnung.

## 4. Modifier genau während des Dialog-Snapshots installieren

Im Wrapper geschieht die eigentliche Installation erst unmittelbar vor dem Aufruf der originalen `skill.roll`-Funktion:

1. Private Auswahl-ID aus den Optionen lesen und den zugehörigen Datensatz auflösen.
2. Die private Option aus der weitergereichten Optionskopie entfernen.
3. `installTemporarySelectableModifier(...)` mit Modifier-Manager, Skill-ID als Gruppe, stabiler Record-ID, Anzeigename und Zahlenwert aufrufen.
4. Bei erfolgreicher Installation den Anzeigenamen eindeutig zu `preSelectedModifier` hinzufügen.
5. Die originale `skill.roll`-Funktion mit den kopierten Optionen aufrufen.
6. Im unmittelbaren `finally` den temporären Modifier entfernen und die Auswahl-ID freigeben.

Das `try/finally` im Wrapper darf absichtlich **nicht** auf das Promise des Dialogs warten:

```js
try {
    return originalRoll.call(this, nextOptions);
} finally {
    cleanupModifier?.();
    releaseSelection();
}
```

In der gegenwärtigen Splittermond-Version liest `prepareRollDialog` die Collection `skill.selectableModifier` und baut daraus vor dem ersten asynchron relevanten Dialogwartepunkt eine separate Liste. Nach Rückkehr von `originalRoll` kann der globale Eintrag deshalb sofort verschwinden, während der Dialog seine eigene Kopie weiterhin anzeigt.

Würde der Wrapper stattdessen `await originalRoll(...)` verwenden, bliebe der Modifier bis zum Bestätigen oder Abbrechen des Dialogs global installiert. Währenddessen könnte eine zweite Probe gegen ein anderes Ziel denselben Eintrag sehen. Diese Form ist daher verboten.

Wenn ein späteres Systemupdate die Modifier-Collection erst nach einem asynchronen Schritt liest, darf dieses Timing nicht blind beibehalten werden. Ermittle dann einen neuen, eindeutig nach dem Dialog-Snapshot liegenden Hook und aktualisiere Anleitung und Regressionstests gemeinsam.

## 5. Temporären auswählbaren Modifier korrekt erzeugen

Verwende den bestehenden Helfer `installTemporarySelectableModifier` statt direkt in `actor.modifier._modifier` zu schreiben.

Wichtige Eigenschaften des Helfers:

- Die Gruppe ist gewöhnlich `skill.id`; der Map-Schlüssel wird kleingeschrieben.
- Der Zahlenwert muss denselben Expression-Prototyp besitzen wie Systemmodifikatoren. Der Helfer ermittelt eine vorhandene Expression-Vorlage und erzeugt mit `Object.create(prototype)` ein kompatibles Objekt mit eigenem `amount`.
- `modifierManager.add` hatte zwischen Systemvarianten unterschiedliche Parameterpositionen für `selectable`. Der Helfer prüft das tatsächlich erzeugte Objekt und versucht bei Bedarf die alternative Signatur.
- Ein eindeutiges Marker-Attribut identifiziert das exakt eingefügte Modifier-Objekt.
- Cleanup entfernt per Objektidentität und ist idempotent.
- Referenzzählung verhindert, dass überlappende Verwendungen desselben Record-Schlüssels einander zu früh entfernen.

Wenn keine kompatible Expression-Vorlage, kein beschreibbarer Roll-Wrapper oder kein geeigneter Modifier-Manager vorhanden ist, addiere den Wert ausschließlich zu `rollOptions.modifier`. Entferne in diesem Fallback den nicht existierenden Namen aus `preSelectedModifier`, damit keine scheinbar aktive, aber wirkungslose Auswahl entsteht.

## 6. Äußere Absicherung des vollständigen Roll-Pfads

Jeder Pfad, der `prepareTemporaryRollModifiers(...)` aufruft, benötigt ein äußeres `finally`, weil Fehler auftreten können, bevor das System den gewrappten `skill.roll` überhaupt erreicht. Bei nativen Aufrufen übernimmt dies der Actor-Interceptor:

```js
const preparedRoll = prepareTargetRollOptions(item, currentSystemTarget(), rollOptions);
try {
    return await originalActorRoll.call(actor, item.id, preparedRoll.rollOptions);
} finally {
    preparedRoll.cleanup();
}
```

Eine HUD-Aktion, die bereits kombinierte Optionen vorbereitet, behält ihr eigenes `finally` und markiert die Optionen nur für den Actor-Interceptor:

```js
const preparedRoll = prepareTargetRollOptions(item, context.target, rollOptions);
try {
    return await services.withTemporarySystemTargets(
        [context.target],
        () => context.actor.rollSpell(
            item.id,
            markTargetModifiersPrepared(preparedRoll.rollOptions),
        ),
    );
} finally {
    preparedRoll.cleanup();
}
```

Dieses Cleanup gibt eine noch nicht verbrauchte Auswahl-ID frei und stellt die originale `skill.roll`-Property wieder her, sobald keine weiteren Entries existieren. Die Wiederherstellung erfolgt nur, wenn weiterhin der eigene Wrapper installiert ist; eine zwischenzeitliche Änderung durch System oder anderes Modul darf nicht überschrieben werden.

Das äußere Cleanup muss bei allen Ergebnissen laufen: erfolgreicher Wurf, abgebrochener Dialog (`false`), Exception, fehlgeschlagener Target-Swap oder ein Systempfad, der `skill.roll` gar nicht aufruft.

## 7. Parallelität und Zielisolation

Folgende Regeln verhindern Leaks zwischen offenen Dialogen:

- Jede Prepare-Operation erhält eine neue Auswahl-ID.
- Die Auswahl-ID wird ausschließlich über die Optionen des zugehörigen Rolls transportiert.
- Ein Wrapper kann mehrere offene Entries verwalten, aber jeder Aufruf konsumiert nur seine eigene ID.
- Nach Eintritt in die originale Roll-Funktion existiert der temporäre Modifier nur bis zu deren unmittelbarer Rückkehr, nicht bis zur Promise-Auflösung.
- Der Wrapper wird erst entfernt, wenn seine Entry-Map leer ist.
- Modifier werden niemals allgemein nach Name, Gruppe oder Betrag gelöscht.
- Das aktuelle Ziel wird vor jeder Probe neu aufgelöst. Der Abschluss eines älteren Rolls darf keine neuere Auswahl oder Aktion bereinigen.

## 8. Berechtigungen und Geheimhaltung

In der derzeit eingesetzten Foundry-v14-Version kann ein normaler Spieler bei geladenen Actors beziehungsweise sichtbaren Token auf `target.actor.items` zugreifen, auch ohne Observerrecht. Das reicht für die lokale Erkennung von Zuständen und Zaubereffekten.

Behandle diese Lesbarkeit nicht als Sicherheitsgarantie oder Geheimhaltungsmechanismus. Ein benannter Modifikator verrät dem Spieler den Effekt ohnehin. Soll eine Wirkung verborgen bleiben, muss ein aktiver GM die Auswertung autoritativ durchführen und dem Spieler nur das zulässige Ergebnis übermitteln.

## 9. Erforderliche Regressionstests

Ergänze für jede neue Effektregel mindestens folgende beobachtbare Fälle:

1. Nur der richtige Dokumenttyp und nur ein tatsächlich aktiver Treffer erzeugen den Modifier.
2. Gleichnamige inaktive Zaubereffekte sowie deaktivierte, unterdrückte oder abgelaufene Active Effects zählen nicht.
3. Namensvarianten werden wie gefordert erkannt; ähnliche, aber fremde Namen werden abgewiesen.
4. Bei mehreren Varianten gewinnt die festgelegte Variante und es erscheint genau ein Modifier.
5. Der Modifier existiert beim synchronen Eintritt in die originale `skill.roll`-Funktion, ist auswählbar und vorausgewählt.
6. Direkt nach Rückkehr von `skill.roll` ist der Modifier aus dem Manager entfernt und die originale Roll-Funktion wiederhergestellt, auch wenn das Dialog-Promise noch offen ist.
7. Während ein geschützter Dialog offen ist, startet eine Probe gegen ein ungeschütztes zweites Ziel ohne den alten Modifier.
8. Dialogabbruch und Exception hinterlassen weder Modifier noch Wrapper oder Entry.
9. Zwei überlappende vorbereitete Rolls werden anhand ihrer Auswahl-IDs getrennt und räumen nur den eigenen Zustand auf.
10. Der numerische Fallback addiert auf einen bereits vorhandenen `rollOptions.modifier`, ohne einen falschen Namen vorauszuwählen.
11. Der vollständige HUD-Pfad verwendet das beim Klick aktuelle Ziel, setzt es transaktional als Systemziel ein und reicht die vorbereiteten Optionen ohne Doppelanwendung bis zum Systemroll durch.
12. Direkte `Actor.rollAttack`- und `Actor.rollSpell`-Aufrufe – stellvertretend für Action-Bar, Charakterbogen und Systemmakros – verwenden das erste aktuelle Systemziel und erhalten dieselben Modifikatoren wie der HUD-Pfad.
13. Die private Kennzeichnung eines bereits vorbereiteten HUD-Wurfs wird vor der originalen Actor-Methode entfernt; eine wiederholte Installation des Actor-Interceptors erzeugt keinen zweiten Wrapper.

Tests dürfen nicht nur interne Maps prüfen. Sie müssen den für den Benutzer sichtbaren Vertrag abbilden: richtiger Name, richtiger Betrag, vorausgewählt, nur im zugehörigen Dialog und danach ohne Seiteneffekt.

## 10. Fertigstellungskriterien

Die Änderung ist erst abgeschlossen, wenn:

- Effektquelle und Aktivitätssemantik zur installierten Splittermond-Version passen,
- die benannte Dialoganzeige und der numerische Fallback funktionieren,
- sämtliche Cleanup-Pfade idempotent sind,
- ein offener oder abgebrochener Dialog ein späteres Ziel nachweislich nicht beeinflusst,
- die fokussierten Tests und bei Shared-Code-Änderungen die vollständige Prüfung erfolgreich laufen,
- neue Benutzertexte lokalisiert sind und das Changelog bei einer funktionsrelevanten Änderung ergänzt wurde.
