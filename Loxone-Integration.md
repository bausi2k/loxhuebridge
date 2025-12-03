# Integration in Loxone

Du hast zwei Möglichkeiten: Den komfortablen Import (empfohlen) oder die manuelle Einrichtung.

## Variante A: Smart Import (Empfohlen) 🏆

1.  Gehe im Web-Dashboard auf den Tab **⚙️ System**.
2.  Klicke bei "Aktive Verbindungen" auf **"Auswählen / Exportieren"**.
3.  Wähle die gewünschten Geräte aus (oder alle).
4.  Klicke auf **"📥 XML"**.
    * Wiederhole das für Lichter (erzeugt `lox_outputs.xml`) und Sensoren (erzeugt `lox_inputs.xml`).

**In Loxone Config:**
1.  Gehe zum Reiter **Miniserver** -> **Gerätevorlagen** -> **Vorlage importieren**.
2.  Importiere die XML-Dateien.
3.  Erstelle nun unter "Virtuelle Ausgänge" bzw. "Virtuelle UDP Eingänge" ein neues Gerät aus der Vorlage (**Vordefinierte Geräte** im Menüband).

---

## Variante B: Manuelle Einrichtung

### Lichter steuern (Virtueller Ausgang)
Adresse: `http://<IP-DER-BRIDGE>:8555`

| Befehl | Syntax | Beschreibung |
|---|---|---|
| Ein/Aus | `/name/1` bzw. `/name/0` | Schaltet hart (0ms Transition bei reinem Schaltbefehl). |
| Dimmen | `/name/<v>` | Werte 2-100%. |
| Warmweiß | `/name/<v>` | Nutzt Loxone Smart Actuator Logik (z.B. `201002700`). |
| Farbe | `/name/<v>` | Nutzt Loxone RGB Logik. |

**⚠️ WICHTIG: Analogmerker verwenden!**
Verbinde den Ausgang deines Lichtbausteins **immer** zuerst mit einem **Analogmerker** und diesen dann mit dem Virtuellen Ausgangsbefehl. Loxone sendet bei direkter Verbindung oft unsaubere Impuls-Werte, die zu Fehlfunktionen führen können.

**⚠️ WICHTIG: Lumitech verwenden!**
Wenn du Lampen hast, die RGB **und** Warmweiß können, stelle den Ausgangstyp am Lichtbaustein auf **"Lumitech"**. Vermeide "RGB", da Loxone sonst versucht, Weiß aus Farben zu mischen (schlechtes Licht). Die Bridge erkennt Lumitech automatisch.

---

### Sensoren empfangen (Virtueller UDP Eingang)
Empfangsport: `7000` (oder dein eingestellter Port).

Die Befehlserkennung folgt dem Muster: `hue.<dein_name>.<typ> \v`

| Typ | Befehl | Werte |
|---|---|---|
| **Bewegung** | `hue.flur.motion \v` | 1 (Bewegung), 0 (Keine) |
| **Helligkeit** | `hue.flur.lux \v` | Lux-Wert |
| **Temperatur** | `hue.flur.temp \v` | Grad Celsius |
| **Batterie** | `hue.flur.bat \v` | 0-100% |
| **Taster** | `hue.taster.button \v` | `initial_press`, `short_release`, `long_press` |
| **Drehring** | `hue.dial.rotary \v` | Relative Schritte (z.B. `15` oder `-20`) |

