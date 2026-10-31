# ioBroker Refrigerator Door Statistics

Eigenständiges ioBroker-JavaScript, das Türöffnungen und deren Dauer pro Tag ermittelt.

## Funktionen

- Anzahl und gesamte Dauer der Türöffnungen des aktuellen Tages
- aktuelle, letzte und längste Öffnungsdauer
- persistenter Zustand über Skript- und ioBroker-Neustarts
- korrekte Aufteilung einer über Mitternacht geöffneten Tür
- automatische Anlage aller benötigten `0_userdata`-Datenpunkte

## Voraussetzungen

- ioBroker JavaScript-Adapter
- Türkontakt-Datenpunkt mit den Werten `open` und `closed`

Das Skript wurde mit einem SmartThings-Kühlschrank entwickelt, funktioniert aber auch mit anderen passenden Kontaktsensoren.

## Installation

1. Unter **Skripte** ein neues JavaScript anlegen.
2. Den Inhalt von [`fridge-door-statistics.js`](fridge-door-statistics.js) einfügen.
3. `SOURCE_ID` auf den eigenen Türkontakt setzen.
4. Optional `ROOT_ID` anpassen.
5. Speichern und starten.

```javascript
const SOURCE_ID = 'smartthings.0.DEVICE_ID.status.cooler.contactSensor.contact.value';
```

## Erzeugte Datenpunkte

Standardmäßig unter `0_userdata.0.Kuehlschrank.Tuer`:

| Datenpunkt | Bedeutung |
|---|---|
| `day` | aktueller Statistiktag |
| `isOpen` | Tür derzeit offen |
| `openSince` | Öffnungsbeginn in Millisekunden |
| `currentOpenSeconds` | Dauer der laufenden Öffnung |
| `lastOpenSeconds` | Dauer der letzten Öffnung |
| `todayOpenSeconds` | gesamte Öffnungsdauer heute |
| `todayOpenCount` | Anzahl der Öffnungen heute |
| `todayLongestOpenSeconds` | längste Öffnung heute |
| `lastClosedAt` | letzter Schließzeitpunkt |

`todayCompletedOpenSeconds` ist ein interner Rechenwert.

## Historisierung

Für Tagesauswertungen empfiehlt sich die Historisierung von `todayOpenSeconds`, `todayOpenCount` und `todayLongestOpenSeconds` mit History, InfluxDB oder SQL. Die Tageswerte werden um Mitternacht zurückgesetzt, wodurch der Historienadapter den Tagesendstand festhalten kann.

## Hinweise

- Frühere Öffnungen können nicht rückwirkend rekonstruiert werden.
- Gezählt werden nur tatsächliche Zustandswechsel.
- Das Skript steuert den Kühlschrank nicht und schreibt nur unter `ROOT_ID`.

## Lizenz

MIT

