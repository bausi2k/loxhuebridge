# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
und dieses Projekt hält sich an [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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