# loxHueBridge 🇦🇹

[![Buy Me A Coffee](https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png)](https://www.buymeacoffee.com/bausi2k)

**loxHueBridge** ist eine bidirektionale Schnittstelle zwischen dem **Loxone Miniserver**, der **Philips Hue Bridge (V2 / API)** und optional **MQTT**.

Sie ermöglicht eine extrem schnelle, lokale Steuerung ohne Cloud-Verzögerung und nutzt die moderne Hue Event-Schnittstelle (SSE), um Statusänderungen in Echtzeit an Loxone (UDP) und MQTT Broker zurückzumelden.

## 🚀 Features V2.2.0

* **Smart Setup:** Automatische Suche der Hue Bridge und Pairing per Web-Interface.
* **Live Dashboard:** Echtzeit-Anzeige aller Lichter (mit Live-Werten für Kelvin/Hex/Dim), Sensoren und Batterieständen.
* **Smart Mapping:** Einfache Zuordnung per "Klick & Wähl".
* **Persistent Logging (SQLite):** Dank nativer SQLite-Datenbank bleiben Logs auch nach Neustarts erhalten und sind extrem performant durchsuchbar (Volltextsuche & Filter).
* **Backup & Restore:** Lade deine komplette Konfiguration inkl. Mappings als Backup herunter und stelle sie bei Bedarf wieder her.
* **Loxone Integration:**
    * **Steuern:** Schalten, Dimmen, Warmweiß & RGB (via Virtueller Ausgang).
    * **Empfangen:** Bewegung, Taster, Helligkeit, Temperatur, Batterie (via UDP Eingang).
* **MQTT Support:** Sendet alle Statusänderungen parallel an einen MQTT Broker (z.B. für Home Assistant, ioBroker).
* **Stabilität:** Integrierter Watchdog überwacht die Verbindung und eine intelligente Queue verhindert Überlastung der Bridge (Error 429).
* 🎛️ **Individuelle Geräte-Steuerung:** Detaillierte Einstellungen pro Gerät direkt im UI (z. B. Deaktivieren von Überblendzeiten/Dynamics für Drittanbieter-Relais).
* 📊 **Smartes Dashboard:** Live-Status aller Geräte, Batteriewarnungen und komfortable System-Konfiguration per Web-Interface.

---

## 📋 Voraussetzungen

* Philips Hue Bridge (V2, eckiges Modell)
* Loxone Miniserver
* Ein Server für Docker (z.B. Raspberry Pi, Synology, Unraid)
* *Nur bei manueller Installation:* Node.js 24+

---

## 🛠 Installation (Empfohlen: Docker)

Du musst keinen Code mehr bauen. Du brauchst nur Docker und eine `docker-compose.yml`.

1.  **Ordner erstellen:**
    Erstelle einen Ordner (z.B. `loxhuebridge`) auf deinem Server.

2.  **Datei erstellen:**
    Erstelle darin eine `docker-compose.yml` mit folgendem Inhalt:

    ```yaml
    services:
      loxhuebridge:
        image: ghcr.io/bausi2k/loxhuebridge:latest
        container_name: loxhuebridge
        restart: always
        network_mode: "host"
        environment:
          - TZ=Europe/Vienna
        volumes:
          - ./data:/app/data
    ```

3.  **Starten:**
    ```bash
    docker compose up -d
    ```
    *Der Ordner `data` wird automatisch erstellt und enthält deine Konfiguration (`config.json`), Mappings (`mapping.json`) und die Log-Datenbank (`logs.db`).*

4.  **Setup:**
    Öffne `http://<DEINE-IP>:8555` für den Einrichtungsassistenten.

---

## 🛠 Manuelle Installation (Experten)

Falls du kein Docker nutzen möchtest, benötigst du **Node.js 24** (oder neuer), da wir das native SQLite-Modul nutzen.

```bash
git clone [https://github.com/bausi2k/loxhuebridge.git](https://github.com/bausi2k/loxhuebridge.git)
cd loxhuebridge
npm install
node server.js

```

---

## 📡 MQTT Integration

Die Bridge kann Statuswerte parallel an einen MQTT Broker senden.
Die Konfiguration erfolgt im Web-Interface unter dem Tab **"System"**.

**Topic Struktur:**
`prefix/typ/name/attribut`

**Beispiele:**
| Gerät | Topic | Wert (Beispiel) |
|---|---|---|
| **Licht (Ein/Aus)** | `loxhue/light/kueche/on` | `1` / `0` |
| **Licht (Helligkeit)** | `loxhue/light/kueche/bri` | `50.5` |
| **Sensor (Bewegung)** | `loxhue/sensor/flur/motion` | `1` / `0` |
| **Sensor (Temp)** | `loxhue/sensor/bad/temp` | `21.5` |
| **Taster (Event)** | `loxhue/button/taster1/button` | `short_release` |

---

## 🔌 Integration in Loxone (Smart Import)

Anstatt Befehle manuell einzutippen, kannst du deine konfigurierte loxHueBridge direkt in Loxone importieren.

### Schritt 1: Vorlagen exportieren

1. Öffne das **loxHueBridge Dashboard** (`http://<IP>:8555`).
2. Klicke auf **"Auswählen / Exportieren"** (oben rechts bei "Aktiv").
3. Wähle alle Geräte aus, die du in Loxone haben möchtest.
4. Klicke auf **"📥 XML"**.
* Mach das einmal im Tab **💡 Lichter** (speichert `lox_outputs.xml`).
* Mach das einmal im Tab **📡 Sensoren** (speichert `lox_inputs.xml`).



### Schritt 2: Vorlagen in Loxone Config importieren

1. Öffne **Loxone Config**.
2. Klicke im Menüband oben auf den Tab **Miniserver**.
3. Klicke auf den Button **Gerätevorlagen** und wähle **Vorlage importieren...**.
4. Wähle die eben heruntergeladene XML-Datei aus.
5. Wiederhole das für beide Dateien (Inputs und Outputs).

### Schritt 3: Geräte anlegen

**Für Lichter (Virtuelle Ausgänge):**

1. Klicke im Peripheriebaum auf **Virtuelle Ausgänge**.
2. Klicke oben im Menüband auf **Vordefinierte Geräte**.
3. Wähle im Dropdown **LoxHueBridge Lights**.
4. Ein neuer Virtueller Ausgang mit all deinen Lampen wird erstellt.

**Für Sensoren (Virtuelle UDP Eingänge):**

1. Klicke im Peripheriebaum auf **Virtuelle UDP Eingänge**.
2. Klicke oben im Menüband auf **Vordefinierte Geräte**.
3. Wähle im Dropdown **LoxHueBridge Sensors**.
4. Ein neuer UDP-Eingang mit all deinen Sensoren wird erstellt.
* *Hinweis:* Kontrolliere, ob der **UDP Empfangsport** (Standard 7000) mit deiner loxHueBridge Einstellung übereinstimmt.



---

## 💡 Manuelle Konfiguration (Referenz)

**Lichter (Virtueller Ausgang):**
Adresse: `http://<IP-DER-BRIDGE>:8555`

| Funktion | Befehl bei EIN / Analog | Erklärung |
| --- | --- | --- |
| **Ausschalten** | `/kueche/<v>` | Schaltet aus (Wert 0) |
| **Dimmen** | `/kueche/<v>` | Werte 2-100 % |
| **Warmweiß** | `/kueche/<v>` | Smart Actuator Logik (z.B. `201002700`) |
| **RGB** | `/kueche/<v>` | RGB Logik (R + G*1000 + B*1000000) |

**Sensoren (UDP Eingang):**
Port: 7000 (Standard)

| Typ | Befehlserkennung |
| --- | --- |
| **Bewegung** | `hue.bwm_flur.motion \v` |
| **Helligkeit** | `hue.bwm_flur.lux \v` |
| **Temperatur** | `hue.bwm_flur.temp \v` |
| **Taster (Klick)** | `hue.taster.button short_release` |
| **Taster (Lang)** | `hue.taster.button long_press` |
| **Drehring (Rechts)** | `hue.dial.rotary cw` |
| **Drehring (Links)** | `hue.dial.rotary ccw` |

---

## 🤝 Credits

**#kiassisted** 🤖
This project was created with the assistance of AI.
Code architecture, logic, and documentation support provided by Gemini.

---

<a href="https://www.buymeacoffee.com/bausi2k" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

