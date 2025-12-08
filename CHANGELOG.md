# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
und dieses Projekt hält sich an [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
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