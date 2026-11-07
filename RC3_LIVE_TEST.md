# SmartThings Beta 1 – RC3 Livetest

Stand: 7. November 2026
Geprüfter Stand: Branch `integration/smartthings-rc3`, Commit
`4a512ef3edbbb921dd185dbeae7a2087e09c1473`, Tag `beta1-rc3`.

> Dieses Dokument ist eine Checkliste. Es wurden **keine** Installation, keine
> SmartThings-Kommandos und keine Änderungen an der produktiven
> ioBroker-Installation ausgeführt. Alle Schritte erfolgen kontrolliert durch
> den Betreiber.

## 0. Vorbereitung

- [ ] Zugriff auf die ioBroker-Administration und die Host-Shell.
- [ ] Bestehende Adapterinstanz und relevante Objekte dokumentieren
      (Screenshot oder Export).
- [ ] Sicherung der ioBroker-Konfiguration anlegen (z. B. Backup des
      ioBroker-Datenverzeichnisses).
- [ ] Sicherung der SmartThings-Adapterkonfiguration notieren
      (Token/Callback werden nicht in dieses Dokument geschrieben).
- [ ] Freies Zeitfenster wählen, in dem ein kurzer Ausfall der
      SmartThings-Integration akzeptabel ist.

## 1. Installation des exakt geprüften Commits

- [ ] Adapterquelle exakt auf Commit
      `4a512ef3edbbb921dd185dbeae7a2087e09c1473` festlegen, z. B. über den
      GitHub-Tarball:
      `https://github.com/HenricTBoehm/ioBroker.smartthings/tarball/4a512ef3edbbb921dd185dbeae7a2087e09c1473`
- [ ] Installation über die ioBroker-Adminoberfläche (Adapter aus URL
      installieren) oder den vorgesehenen Installationsweg des Betreibers.
- [ ] Sicherstellen, dass die installierte Version `0.3.0` meldet.
- [ ] Adapter-Log auf Startfehler prüfen.

## 2. Adapterstart und Sitzungswiederverwendung

- [ ] Adapterinstanz starten.
- [ ] Prüfen, ob eine bestehende Samsung-Sitzung wiederverwendet wird, ohne
      neue Anmeldung.
- [ ] Prüfen, ob `info.connection` bei erfolgreicher Verbindung `true` wird.
- [ ] Falls keine gültige Sitzung vorhanden ist: geführten Login verwenden und
      Callback-URL validieren.
- [ ] Keine Tokens, Callback-URLs oder Sessiondaten in Logs/Screenshots
      veröffentlichen.

## 3. Geräteerkennung und Geräteauswahl

- [ ] Geräteerkennung abwarten; erwartete Geräteanzahl mit der Sicherung
      vergleichen.
- [ ] Reiter zur Geräteverwaltung öffnen.
- [ ] Checkbox-Auswahl setzen bzw. ändern.
- [ ] Bestehende `native.excludeDevices`-Einträge auf Rückwärtskompatibilität
      prüfen.
- [ ] Auswahl speichern.
- [ ] Adapter neu starten.
- [ ] Prüfen, ob die Geräteauswahl nach dem Neustart erhalten bleibt.
- [ ] Prüfen, ob ausgeschlossene Geräte keine Command-States erhalten.

## 4. SSE-/Polling-Statusaktualisierung

- [ ] Statusänderung an einem realen Gerät auslösen (z. B. Tür/Fenster oder
      Bewegung).
- [ ] Prüfen, ob der Status zeitnah in den ioBroker-States erscheint.
- [ ] SSE-Pfad und Polling-Fallback getrennt beobachten, falls konfigurierbar.
- [ ] Multi-Component-Gerät prüfen (mehrere Capabilities unter demselben
      Gerät).
- [ ] Adapter neu starten und prüfen, ob Ressourcen sauber freigegeben und
      erneut aufgebaut werden.

## 5. Schalt- und Dimmbefehle

- [ ] Ein/Aus an einem geeigneten Schaltgerät senden.
- [ ] Dimmen auf einen Zwischenwert senden.
- [ ] Prüfen, ob der reale Gerätezustand dem Kommando folgt.
- [ ] Prüfen, ob der Status anschließend korrekt zurückgemeldet wird.
- [ ] Ungültige/unbekannte States dürfen keinen API-Request auslösen.

## 6. OCF-Kommandos

- [ ] Nur falls ein geeignetes OCF-Testgerät vorhanden ist: OCF-Kommando
      auslösen.
- [ ] Prüfen, ob das Kommando den erwarteten Gerätezustand setzt.
- [ ] Prüfen, ob OCF-Writes ohne valide Metadaten sicher ignoriert werden.

## 7. Nachweis: Statusschreibzugriffe lösen keine Kommandos aus

- [ ] Einen Status-State (Namespace `status`, `general`, `info`) versuchsweise
      mit `ack=false` beschreiben.
- [ ] Im Adapter-Log und im SmartThings-Konto prüfen, dass **kein**
      Gerätekommando ausgelöst wurde.
- [ ] Prüfen, dass ein unbekannter State ebenfalls kein Kommando auslöst.
- [ ] Ergebnis mit Zeitstempel dokumentieren.

## 8. `compactMode` und Ausnahmeliste

- [ ] `compactMode` aktivieren und einen Zyklus abwarten.
- [ ] Prüfen, dass `0` und `false` erhalten bleiben.
- [ ] Prüfen, dass leere Werte nicht fälschlich als gültige Werte erscheinen.
- [ ] Bestehende `exclude`-Liste prüfen; ausgeschlossene Werte dürfen nicht
      neu angelegt werden.
- [ ] Prüfen, dass vorhandene Objekte nicht automatisch gelöscht werden.
- [ ] `compactMode` wieder auf den gewünschten Endzustand setzen.

## 9. CPU-/RAM-Baseline

- [ ] Nach Stabilisierung des Adapterstarts CPU- und RAM-Verbrauch notieren
      (Zeitpunkt, Laufzeit, Prozess).
- [ ] Nach 15–30 Minuten Dauerbetrieb erneut messen.
- [ ] Auffällige Dauerlast oder Speicherwachstum dokumentieren.
- [ ] Werte mit der RC2-Baseline vergleichen, sofern vorhanden.

## 10. Rollback

- [ ] Adapterinstanz stoppen.
- [ ] Auf RC2-Commit `dbd15227ca9451732d8d1d2bf7765a845893e76f`
      (`beta1-rc2`) zurückgehen.
- [ ] Falls nötig, gesicherte ioBroker-Konfiguration wiederherstellen.
- [ ] Adapter starten und Verbindung/Status prüfen.
- [ ] Rollback-Ergebnis dokumentieren.

## Ergebnisprotokoll

| Schritt | Ergebnis | Bemerkung |
| --- | --- | --- |
| Installation/Version |  |  |
| Sitzung wiederverwendet |  |  |
| Geräteerkennung |  |  |
| Auswahl nach Neustart |  |  |
| SSE-/Polling-Status |  |  |
| Schalten/Dimmen |  |  |
| OCF |  |  |
| Status-Write ohne Kommando |  |  |
| `compactMode`/`exclude` |  |  |
| CPU/RAM-Baseline |  |  |
| Rollback |  |  |
