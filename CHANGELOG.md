# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
und dieses Projekt hält sich an [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
[![Buy Me A Coffee](https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png)](https://www.buymeacoffee.com/bausi2k)

## [2.1.1] - 2026-02-16
### 🐛 Bugfixes
- **Sonoff / On-Off Fix:** Reine Schaltaktoren (ohne Dimm-Funktion) erhalten nun keine `dynamics` Parameter mehr. Das behebt Probleme mit Geräten wie dem Sonoff ZBMINIR2, die sich sonst nicht ausschalten ließen.
- **Queue Timing:** Die Einstellung `throttleTime` (Drosselung) gilt nun auch korrekt für Gruppen- und Zonen-Befehle (war vorher fest auf 1100ms).
- **Sensor Sortierung:** Im Dashboard werden Sensoren nun nach Wichtigkeit sortiert (Leere Batterie -> Aktiv -> Name).

## [2.1.0] - 2026-01-29
### 🌟 New Features
- **SD-Card Mode:** Neue Option in den Systemeinstellungen, um das Schreiben von Logs auf die Festplatte zu deaktivieren (schont SD-Karten auf Raspberry Pi). Logs werden dann nur im RAM gehalten.
- **Robustheit:** Neuer Crash-Monitor fängt kritische Fehler ab und verhindert, dass der Server bei kleineren Problemen komplett abstürzt.

### 🐛 Bugfixes
- **MQTT:** Fix für Abstürze bei leeren Benutzer/Passwort-Feldern und Endlos-Schleifen bei Authentifizierungsfehlern.
- **Datenbank:** Server startet nun auch, wenn die `logs.db` gesperrt oder beschädigt ist (Fallback auf RAM-Modus).

## [2.0.0] - 2026-01-29
### 💥 Major Changes
- **Core Engine Upgrade:** Umstellung auf **Node.js 24 LTS**.
- **Native SQLite Integration:** Logs werden nun persistent in einer lokalen SQLite-Datenbank (`data/logs.db`) gespeichert statt nur im Arbeitsspeicher.
    - *Vorteil:* Logs überleben Neustarts und ermöglichen eine Historie von Millionen Einträgen ohne RAM-Verbrauch.
    - *Performance:* Nutzung des neuen `node:sqlite` Moduls für maximale Geschwindigkeit ohne externe C++ Abhängigkeiten.
- **UI Overhaul:** Komplettes Redesign des Dashboards.
    - Auslagerung der Styles in `style.css`.
    - Neue **Filter-Leiste** für Logs (Kategorien + Volltextsuche).
    - Verbesserte **Sensor-Gruppierung** (Kontakte, Bewegung, Sonstige).
    - **Backup & Restore:** Vollständige Sicherung und Wiederherstellung der Konfiguration direkt über das Web-Interface.

### 🐛 Bugfixes
- **Grouped Lights:** Fix für fehlenden Status von Lichtgruppen (Zimmer/Zonen) nach Neustart. Der Endpunkt `grouped_light` wird nun beim Start synchronisiert.
- **Zero-Value Display:** Korrektur eines Fehlers im Frontend, bei dem Werte von `0` (z.B. Licht Aus, Keine Bewegung) fälschlicherweise als "leer" interpretiert und ausgeblendet wurden.
- **Log Formatting:** Fix für Zeilenumbrüche in der Log-Ansicht für bessere Lesbarkeit.

---
---

## [1.8.0] - 2026-01-21

### 🚀 Features
- **MQTT Support:** Die Bridge kann nun Statusänderungen (Licht, Sensoren, Taster) parallel an einen MQTT Broker senden.
    - Konfiguration im Tab "System" (Broker, Port, User, Passwort).
    - Topic-Struktur: `loxhue/<typ>/<name>/<attribut>` (z.B. `loxhue/light/kueche/bri`).
    - Ideal für die Integration in Home Assistant, ioBroker oder Node-RED.
- **Erweitertes Dashboard:**
    - **Licht-Gruppierung:** Im Tab "Lichter" werden Lampen nun übersichtlich in "Eingeschaltet" 💡 und "Ausgeschaltet" 🌑 unterteilt.
    - **Live-Info Modal:** Das Info-Icon (ℹ️) zeigt nun Live-Werte der Lampe an (Helligkeit %, Kelvin, Hex-Code), was das Debuggen massiv erleichtert.

### 🛠 Verbesserungen
- **Stabilität:** Beinhaltet alle Fixes aus v1.7.x (Watchdog gegen Verbindungsabbrüche, Queue-Drosselung).
- **UI:** Neuer Toggle-Switch im System-Tab, um MQTT global an- oder abzuschalten.

---

## [1.7.3] - 2026-01-20

### 🛡️ Stabilität
- **EventStream Watchdog:** Behebt das Problem ("Zombie Connection"), bei dem nach längerer Laufzeit (10-14 Tage) keine Sensor-Updates mehr empfangen wurden.
    - Der neue Watchdog prüft auf eingehende Daten (inkl. Hue Heartbeats).
    - Bei Stille (>60s) wird die Verbindung proaktiv getrennt und neu aufgebaut.

### 🚀 Features
- **Configurable Throttling:** Die Drosselung der Befehls-Queue ist nun im System-Tab einstellbar (0ms - 1000ms).
    - Ermöglicht Power-Usern, die Reaktionsgeschwindigkeit zu erhöhen oder bei Verbindungsproblemen (Error 429) konservativer zu agieren.
    - Standardwert: 100ms.

---

## [1.7.2] - 2025-12-15

### 🐛 Bugfixes
- **Button Event Cache Fix:** Behebt ein Problem, bei dem wiederholte Tastendrücke (z.B. zweimaliges Drücken für "An" und "Aus") von der internen Cache-Logik verschluckt wurden, da sich der Status-Text (z.B. `short_release`) nicht geändert hatte.
    - **Jetzt:** Events von Tastern (`button`) und Drehreglern (`rotary`) umgehen nun den Cache und senden **immer** ein UDP-Paket an Loxone, auch wenn der Wert identisch zum vorherigen ist.
    - Sensoren (Temp, Motion, Lux) werden weiterhin dedupliziert, um das Netzwerk nicht zu fluten.

---

## [1.7.1] - 2025-12-15

### 🛡️ Global Rate Limiting
- **Traffic Queue:** Implementierung einer globalen Warteschlange, um Fehler bei der Hue Bridge ("429 Too Many Requests") zu verhindern.
    - Befehle für Einzel-Lichter werden auf max. 8-10 pro Sekunde begrenzt.
    - Befehle für Gruppen/Zonen werden auf max. 1 pro Sekunde begrenzt.
    - Loxone kann nun "feuern" so schnell es will (z.B. Szenen), die Bridge arbeitet alles sauber nacheinander ab.

### 🛠 Fixes & Verbesserungen
- **Smart Button Logic:** Taster-Events werden nun sauber gefiltert (`short_release` & `long_press`), um Fehlschaltungen zu vermeiden.
- **Rotary (Drehregler):** Sendet nun `cw` (rechts) und `ccw` (links) als Text für einfachere Einbindung in Loxone.
- **Discovery:** Tap Dial Switch wird nun vollständig erkannt (4 Tasten + Drehring separat).

---

## [1.7.0] - 2025-12-12

### 🚀 Major Features
- **Tap Dial Switch Support:** Der Philips Hue Tap Dial Switch wird nun vollständig unterstützt!
    - Alle 4 Tasten werden als einzelne Geräte erkannt.
    - Der Drehring (Rotary) wird als eigenes Gerät erkannt.
- **Smart Button Logic:** Taster-Events werden nun gefiltert:
    - Nur noch `short_release` (Klick) und `long_press` (Halten) werden an Loxone gesendet.
    - Irrelevante Events wie `initial_press` oder `repeat` werden unterdrückt, um Traffic zu sparen.
- **Rotary Logic:** Der Drehring sendet nun `cw` (Clockwise) und `ccw` (Counter-Clockwise) als Text an Loxone. Das ermöglicht das direkte Anbinden an `V+` und `V-` Eingänge von Dimmern.

### 🛠 Verbesserungen
- **XML Export:** Der Input-Generator erstellt nun automatisch digitale Eingänge für Drehregler (CW/CCW).
- **Stabilität:** `dotenv` Dependency entfernt und `package.json` Laderoutine abgesichert (verhindert Abstürze in Docker-Umgebungen).
- **UI:** Verbesserte Log-Darstellung mit Kategorien (Light, Sensor, Button).

---

## [1.6.3] - 2025-12-08

### 🛠 Bugfixes & Kompatibilität
- **3rd-Party Controller Fix:** Bei einer eingestellten Transitionszeit von `0ms` wird das `dynamics`-Objekt nun komplett aus dem Befehl entfernt (statt `duration: 0` zu senden).
    - Dies behebt Probleme mit günstigen Zigbee-Controllern, die bei `duration: 0` abstürzen oder den Befehl ignorieren.
    - Das Licht nutzt in diesem Fall das Standard-Fading des Controllers.

---

## [1.6.1] - 2025-12-03

### 🛠 Verbesserungen
- **UI Fix:** Layout-Korrektur beim Hinweis für den "All"-Befehl (Text überlappte mit Eingabefeld).
- **Styling:** Abstände in der Verbindungs-Karte optimiert.

---

## [1.6.0] - 2025-12-03

### 🚀 Features
- **Loxone Sync (Rückkanal für Lichter):** Neues Opt-In Feature im Dashboard (Tab "Lichter").
    - Ermöglicht es, den Status von Lichtern (An/Aus, Helligkeit) per UDP an Loxone zu senden, wenn diese extern (z.B. via Hue App, Alexa, Dimmschalter) geschaltet wurden.
    - Perfekt für den Eingang `Stat` am EIB-Taster Baustein, um die Visualisierung synchron zu halten.
    - Standardmäßig deaktiviert, um Netzwerk-Traffic gering zu halten.

### 🛠 Verbesserungen
- **UI Fixes:** Korrektur beim Laden der Transition-Time (0ms wurde fälschlicherweise als 400ms interpretiert).
- **Icon Cleanup:** Beim Speichern von Mappings werden Icons (💡, 🏠, etc.) im Namen nun zuverlässiger entfernt.

---

## [1.5.1] - 2025-12-03

### ⚡ Optimierungen
- **Smart "All" Logic:** Der Befehl `/all/0` nutzt nun eine **fixe Verzögerung von 100ms** zwischen den Lampen (statt abhängig von der Transition Time). Dies garantiert eine sichere Entlastung der Bridge und des Stromnetzes, unabhängig von Benutzereinstellungen.
- **Transition Fix:** Bei "Alles"-Befehlen wird die Übergangszeit (Transition) temporär auf 0ms gesetzt, damit das Ausschalten sofort sichtbar ist, während die Schleife läuft.
- **Queue Stability:** Rückkehr zur stabilen "1-Slot-Buffer" Logik für die Befehlswarteschlange, um Seiteneffekte bei schnellen Schaltvorgängen zu vermeiden.

---

## [1.5.0] - 2025-12-02

### 🚀 Features
- **Diagnose Tab:** Neuer Tab im Dashboard zeigt den Gesundheitsstatus des Zigbee-Netzwerks (Verbindungsstatus, MAC-Adresse, Zuletzt gesehen) und den Batteriestatus aller Geräte.
- **Smart "All" Command:** Der Befehl `/all/0` (oder `/alles/0`) schaltet nun alle gemappten Lichter nacheinander mit einem Sicherheitsabstand von 100ms. Dies schützt die Bridge vor Überlastung und erzeugt einen angenehmen "Wellen-Effekt".

### ⚡ Optimierungen
- **Queue Logic:** Verbesserte Warteschlange für Lichtbefehle. Verhindert das Verschlucken von schnellen Ein/Aus-Schaltvorgängen (Hybrid Queue).
- **Logging:** Zeitstempel im Log sind nun präzise (Millisekunden) und im 24h-Format. Rate-Limit Fehler (429) werden sauber abgefangen.

---

## [1.4.0] - 2025-12-02

### ⚡ Optimierungen (Logic & Performance)
- **Zero-Latency Switching:** Reine Schaltbefehle (Ein/Aus) ignorieren nun die eingestellte Übergangszeit und schalten sofort (0ms), um eine spürbare Verzögerung zu vermeiden.
- **Stable Queue:** Die Warteschlange wurde stabilisiert ("1-Slot-Buffer"). Dies verhindert das Verschlucken von schnellen Schaltfolgen (An -> Aus -> An), behält aber die "Last-Wins"-Logik für flüssiges Dimmen bei.

### 🛡️ Stabilität
- **Rate Limit Handling (429):** Fehlercode 429 ("Too Many Requests") der Hue Bridge wird nun abgefangen und als Warnung geloggt, anstatt den Log mit HTML-Fehlerseiten zu fluten.
- **Error Throttling:** Bei Fehlern wird eine kurze Wartezeit (100ms) eingefügt, um die Bridge nicht weiter zu belasten.

### 📝 Logging
- **Präzise Zeitstempel:** Logs enthalten nun Millisekunden (`HH:MM:SS.mmm`) für genaueres Debugging von Timing-Problemen.
- **24h Format:** Zeitstempel werden nun erzwungen im deutschen 24h-Format ausgegeben.

---

## [1.3.0] - 2025-12-01

### 🚀 Neu (Features)
- **Smart Lighting:**
    - **Transition Time:** Einstellbare Überblendzeit (0-500ms) im System-Tab für weichere Lichtwechsel.
    - **Command Queueing:** Verhindert "Stottern" bei schnellen Slider-Bewegungen (Loxone -> Hue). Befehle werden gepuffert.
    - **RGB Fallback:** Sendet Loxone Farben an eine reine Warmweiß-Lampe, berechnet die Bridge nun automatisch die passende Farbtemperatur (Wärme basierend auf Rot/Blau-Anteil).
    - **Capabilities:** Die Bridge liest die physikalischen Kelvin-Grenzen der Lampen aus und skaliert Loxone-Werte exakt auf diesen Bereich.
- **UI & DX:**
    - **Color Dot:** Farbiger Punkt in der Liste zeigt den aktuellen Status der Lampe.
    - **Device Details:** Info-Button (ℹ️) zeigt technische Daten (Modell, Farbraum, Kelvin-Range) im Overlay.
    - **Export Filter:** Im Export-Dialog können nun gezielt einzelne Geräte per Checkbox ausgewählt werden.

### 🛠 Verbesserungen
- **Backend:** `server.js` nutzt nun zentrales Config-Management für Transition Time.
- **Frontend:** Optimierte Dropdowns (keine bereits gemappten Geräte mehr sichtbar).
- **Docker:** Healthcheck und Pfad-Optimierungen.

---

## [1.1.0] - 2025-11-27

### 🚀 Neu (Features)
- **UI Dashboard:**
    - Live-Werte: Anzeige von Temperatur, Lux, Batteriestand (<20% = 🚨) und Schaltzustand direkt in der Liste.
    - Color Dot: Farbiger Indikator zeigt die aktuelle Lichtfarbe an (berechnet aus XY/Mirek).
    - Selection Mode: Gezielter XML-Export von ausgewählten Geräten via Checkboxen.
    - Unique Name Check: Warnung beim Überschreiben von bestehenden Mappings.
- **Hardware Support:**
    - **Rotary Support:** Volle Unterstützung für den Hue Tap Dial Switch (Drehring sendet relative Werte).
- **Technical:**
    - **Initial Sync:** Lädt beim Start sofort alle aktuellen Zustände der Lampen.
    - **Smart Fallback:** Automatische Umrechnung von RGB zu Warmweiß für Lampen, die keine Farbe unterstützen (Berechnung der "Wärme" aus Rot/Blau-Anteil).
    - **Filtered XML:** XML-Export berücksichtigt jetzt die Auswahl im UI.

### 🐛 Fehlerbehebungen (Fixes)
- Behoben: Falsche Darstellung im Dropdown bei bereits zugeordneten Geräten.
- Behoben: Checkbox-Status Verlust bei Live-Updates (durch Modal-Overlay gelöst).
- Behoben: Slash `/` wurde bei Sensoren im Export-Overlay fälschlicherweise angezeigt.

---

## [1.0.0] - 2025-11-27

### 🎉 Initial Release
- **Core:** Bidirektionale Kommunikation (Loxone HTTP -> Hue / Hue SSE -> Loxone UDP).
- **Docker:** Robustes Setup mit `data/` Ordner Persistence und Host-Network Support.
- **Setup:** Automatischer Wizard zur Erkennung der Bridge und Konfiguration von Loxone IP/Ports.
- **UI:** Modernes Dashboard mit 4 Tabs (Lichter, Sensoren, Schalter, System) und Dark Mode.
- **Integration:** XML-Template Generator für Loxone Config (Inputs/Outputs).
- **Logging:** Runtime Debug-Toggle und In-Memory Log-Buffer im UI.