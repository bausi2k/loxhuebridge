# Installation via Docker

Die Bridge wird als Docker-Container bereitgestellt. Das ist der sicherste und einfachste Weg.

## Voraussetzungen
* Ein Server mit Docker & Docker Compose (z.B. Raspberry Pi, Synology NAS, Unraid, Linux VM).
* Eine Philips Hue Bridge (eckiges Modell V2).
* Einen Loxone Miniserver.

## Schritt 1: Ordner erstellen
Erstelle auf deinem Server einen Ordner, z.B. `loxhuebridge`.

## Schritt 2: docker-compose.yml
Erstelle in diesem Ordner eine Datei `docker-compose.yml` mit folgendem Inhalt:

```yaml
services:
  loxhuebridge:
    image: ghcr.io/bausi2k/loxhuebridge:latest
    container_name: loxhuebridge
    restart: always
    # WICHTIG für Linux/Raspberry Pi: Host Mode für korrekte UDP Kommunikation
    network_mode: "host"
    environment:
      - TZ=Europe/Vienna
    volumes:
      # Hier werden deine Einstellungen gespeichert
      - ./data:/app/data
````

## Schritt 3: Starten

Führe im Terminal in diesem Ordner aus:

```bash
docker compose up -d
```

-----

## 💻 Spezialfall: Mac & Windows (Docker Desktop)

Der oben genannte `network_mode: "host"` funktioniert unter macOS und Windows Docker Desktop oft nicht korrekt (Container ist unter localhost nicht erreichbar).

**Lösung für lokale Tests:**
Erstelle zusätzlich eine Datei `docker-compose.override.yml`:

```yaml
services:
  loxhuebridge:
    network_mode: "bridge"
    ports:
      - "8555:8555"
```

Startet dann neu mit `docker compose up -d`. Beachte, dass UDP-Rückmeldungen an Loxone in diesem Modus durch Firewalls blockiert sein könnten. Für den **Produktivbetrieb** empfehlen wir Linux/Raspberry Pi.
