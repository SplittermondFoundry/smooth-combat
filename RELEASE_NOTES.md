# Splittermond Smoother Fight 0.7.2

Version **0.7.2** behebt hängenbleibende Aktive Abwehren nach einem abgebrochenen Wurf und ergänzt die Darstellung von **Angsterfüllt** unter Splittermond 14.2.7.

## Aktive Abwehr

- Das Schließen des Wurfdialogs über **X**, **Escape** oder einen programmatischen Aufruf beendet den ausstehenden Abwehrvorgang gegen **KW und GW**. Das HUD zeigt wieder die Zauber- beziehungsweise Angriffskarte; ein zusätzlicher Wurf ist nicht mehr nötig.
- Die Korrektur erfasst auch den Wurfdialog nach der VTD-Auswahl und die Abwehr durch einen Verteidiger. Ein erneuter Versuch oder ein ausdrücklicher Verzicht auf Abwehr bleibt möglich.
- Die Erkennung unterstützt die Dialoge aus **14.2.7** sowie die verkürzten Dialogklassennamen aus **14.3.0-beta5**.
- Bereits bestätigte Würfe warten weiter auf ihr Ergebnis, auch bei langsamer Verarbeitung oder einer verzögerten Ausnahmebestätigung für Angsterfüllt. Fremde Dialoge und andere Tokens mit derselben Actor-ID beeinflussen den Vorgang nicht.

## Angsterfüllt

- Unter **Splittermond 14.2.7** erscheinen Risiko- und Standardwurf ausgegraut; der Sicherheitswurf bleibt hervorgehoben und vorausgewählt.
- Die vorhandene Bestätigung für eine Ausnahme bleibt erreichbar. Andere Systemversionen behalten ihre eigene Behandlung des Zustands.

## Aktualisierung und Kompatibilität

Die Mindestanforderungen bleiben unverändert: **Foundry VTT 14 ab Build 14.359** und **Splittermond ab 14.2.0**. Einstellungen und Weltdaten benötigen keine Migration.

Nach dem Update die Browserseiten aller Beteiligten mit **Strg+F5** neu laden. Dadurch werden auch bereits hängengebliebene lokale Abwehrvorgänge entfernt.

## Prüfung

- **722 automatisierte Tests** und zusätzlich **80 Regeltests** samt Coverage-Vorgaben in einem sauberen Export des Release-Stands erfolgreich. Regressionstests prüfen Abbruch, erfolgreiche Würfe, Ausnahmebestätigungen und die Rückkehr des HUDs zur Zauberkarte.
- Prüfung mit den lokal vorliegenden Original-Dialogklassen von **14.2.7** und **14.3.0-beta5**, letztere zusammen mit **Foundry 14.367**. Diese Prüfung verwendet eine lokale Testumgebung für den Anwendungslebenszyklus.
- Chromium-Browserprüfung mit den originalen 14.2.7-Templates und Styles: ausgegraute Buttons sowie weiterhin erreichbare Wurfbuttons bei langen Dialogen.
