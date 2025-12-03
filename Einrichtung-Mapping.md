
# Einrichtung & Mapping

Nach dem Start des Containers ist die Bridge unter `http://<IP-DES-SERVERS>:8555` erreichbar.

## 1. Der Setup Wizard
Beim ersten Aufruf begrüßt dich der Assistent:
1.  **Suchen:** Die Bridge sucht im Netzwerk nach deiner Hue Bridge.
2.  **Koppeln:** Du musst den großen runden Knopf auf der Hue Bridge drücken.
3.  **Loxone:** Gib die IP deines Miniservers und den UDP-Port (Standard 7000) ein.

## 2. Das Dashboard
Hier verknüpfst du deine Loxone-Logik mit den Hue-Geräten.

### Neue Verbindung erstellen
1.  Gib links einen **eindeutigen Namen** ein (z.B. `kueche` oder `bwm_flur`). Dieser Name wird später in Loxone verwendet.
2.  Wähle rechts das **Hue Gerät** aus.
3.  Klicke auf **Speichern**.

### Tabs
* **💡 Lichter:** Hier mappst du Lampen oder Gruppen (Zonen/Räume).
* **📡 Sensoren:** Hier mappst du Bewegungsmelder, Temperatursensoren oder Helligkeitssensoren.
* **🔘 Schalter:** Hier mappst du Dimmschalter oder Tap Dials.

### 💡 Der "Alles" Befehl
Die Namen `all` und `alles` sind reserviert. Du musst sie **nicht** mappen.
Ein Befehl an `/all/0` schaltet automatisch alle gemappten Lichter aus.

* **Tipp:** Die Bridge schaltet die Lichter mit einer Verzögerung von 100ms nacheinander aus. Das schützt das Stromnetz und die Bridge vor Überlastung ("Popcorn-Effekt").
