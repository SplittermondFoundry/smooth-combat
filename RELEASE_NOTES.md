# Splittermond Smoother Fight 0.7.3

Version **0.7.3** behebt Kompatibilitätsfehler mit Splittermond 14.3.1 bei Splitterpunkteinsatz, Abwehr- und Patzerschaden sowie Bonus-Lebenspunkten. Die Unterstützung für 14.2.7 bleibt erhalten.

## Splitterpunkte und Chatkarten

- Nach Aktiver Abwehr oder einem verteidigungsseitigen Splitterpunkt-/Resonanzbonus bleibt die Erfolgsgradgrenze in neu berechneten Angriffskarten erhalten. Ein anschließender Splitterpunkteinsatz erzeugt keinen `NaN`-Fehler mehr.
- Begrenzte und ungelernte Proben beachten ihre Grenze auch bei einem Triumph.
- Angriffs- und Zauberkarten lassen sich auch ohne verfügbaren Kampf darstellen, einschließlich der Initialisierung beim Modulstart. Zugeordnete Schadenskarten werden weiterhin erkannt.

## Schaden und Bonus-Lebenspunkte

- Betäubungsschaden aus Aktiver Abwehr und Patzer-Eigenschaden verwenden die passende Kosten-Schnittstelle für 14.2.7 beziehungsweise 14.3.1.
- Verbrauchte Bonus-Lebenspunkte zählen bei Schadensfeedback und Unterbrechungsprüfungen vollständig mit: 7 Schaden bei 5 Bonus-Lebenspunkten werden als 7 Schaden erkannt.
- Neue, entfernte oder in ihrer Stärke veränderte Bonus-Effekte gelten nicht als Schaden.
- Nach einem Fehler mit bereits verbrauchten Bonus-Lebenspunkten verhindert die Anwendungssperre einen versehentlichen doppelten Abzug.

## Aktualisierung und Kompatibilität

Die Mindestanforderungen bleiben unverändert: **Foundry VTT 14 ab Build 14.359** und **Splittermond ab 14.2.0**. Die Live-Prüfung erfolgte mit Foundry **14.367** und Splittermond **14.3.1**; die Kompatibilität mit **14.2.7** wurde anhand des Systemcodes und automatisierter Tests abgesichert.

Einstellungen und Weltdaten benötigen keine Migration. Die Korrektur der Erfolgsgradgrenze gilt für neu berechnete Karten; alte Chatkarten werden nicht nachträglich umgeschrieben. Nach dem Update die Browserseiten aller Beteiligten mit **Strg+F5** neu laden.

## Prüfung

- **2.328 automatisierte Tests** und zusätzlich **93 Regeltests** samt Coverage-Vorgaben erfolgreich.
- Live-Test in der Testwelt: alle **8 Kompatibilitätsprüfungen** bestanden, darunter Abwehr- und Patzerschaden, vollständige und teilweise Bonusabsorption, deaktivierte Effekte sowie Vorbereitungs- und Status-Timer-Adapter.
- Erfolgsgradkorrektur mit echten Systemwürfen und anschließendem Splitterpunkteinsatz geprüft.
