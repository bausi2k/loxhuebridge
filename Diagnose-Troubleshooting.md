# Diagnose & Troubleshooting

## Der Diagnose Tab 🩺
Im Web-Dashboard findest du (wenn konfiguriert) den Tab **Diagnose**.
Hier siehst du den Gesundheitsstatus deines Zigbee-Netzwerks.

* **Grüner Punkt:** Alles OK.
* **Roter Punkt:** Verbindung zur Lampe verloren (Stromlos?) oder Batterie kritisch.
* **Sortierung:** Geräte mit Problemen oder niedrigem Batteriestand (≤ 20%) werden automatisch ganz oben angezeigt.

## Debug Modus 🐛
Im Tab **⚙️ System** kannst du den **Debug Modus** zur Laufzeit aktivieren.
Danach siehst du im Log-Fenster (unten) detaillierte Informationen:
* `IN: /kueche/100` -> Was Loxone sendet.
* `OUT -> Hue: {...}` -> Was wir an die Hue Bridge senden.

## Bekannte Fehler & Lösungen

### "Lichter reagieren verzögert / Popcorn-Effekt"
Die Bridge nutzt eine **Smart Queue**. Wenn du viele Befehle gleichzeitig sendest (z.B. "Alles Aus" ohne den `/all` Befehl zu nutzen), werden diese gepuffert, um die Hue Bridge nicht zu überlasten.
* **Lösung:** Nutze für Szenen den Befehl `/all/0` oder gruppiere Lampen in der Hue App zu einer Zone und mappe diese Zone.

### "429 HUE RATE LIMIT" im Log
Du sendest zu viele Befehle zu schnell an die Hue Bridge.
* Die loxHueBridge fängt dies ab und bremst automatisch kurz.
* Überprüfe deine Loxone Programmierung (sendet ein Baustein vielleicht in einer Endlosschleife?).
