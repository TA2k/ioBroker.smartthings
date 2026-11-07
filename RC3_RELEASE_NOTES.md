# SmartThings Beta 1 – RC3 Release Notes

Stand: 7. November 2026
Status: **RC3 eingefroren und geprüft; keine Produktivfreigabe**

## Kanonischer Stand

| Feld | Wert |
| --- | --- |
| Repository | `HenricTBoehm/ioBroker.smartthings` |
| Kanonischer Branch | `integration/smartthings-rc3` |
| Getesteter Code-Commit | `4a512ef3edbbb921dd185dbeae7a2087e09c1473` |
| Annotation-Tag | `beta1-rc3` (Branch-Head; enthält zusätzlich diese Dokumentation) |
| Paketversion | `0.3.0` (unverändert) |
| js-controller | `>=3.0.0` (`io-package.json`), getestet mit `7.2.5` |
| Node.js | getestet mit `22.23.4`; CI-Matrix `22.x` und `24.x` |

Die Qualitätssicherung wurde auf dem Code-Commit `4a512ef` ausgeführt. Der
Branch-Head nach dem Dokumentations-Commit enthält denselben Code; der Tag
`beta1-rc3` markiert diesen finalen Stand (`git rev-parse beta1-rc3^{}`).
`integration/smartthings-beta` und `integration/smartthings-rc3` zeigen auf
denselben Code-Stand. Es war kein zusätzlicher Merge, Rebase oder Cherry-Pick
erforderlich.

## Enthaltene Änderungen

RC3 baut auf dem unveränderten RC2-Commit
`dbd15227ca9451732d8d1d2bf7765a845893e76f` (`beta1-rc2`) auf.

- RC2 enthält die fachlich integrierten Änderungen aus PR #93, #94 und #95
  (Squash-Integration `13a964f`).
- RC3 ergänzt PR #97 (`a31f6eb031c0e6f7aa0cdaa3e5058afef4847d70`) über den
  Merge-Commit `d069ef4`.
- PR #96 und #98 verweisen auf denselben RC3-Head und sind reine
  Integrations-/Referenz-PRs.
- `master` im Fork sowie der TA2k-Upstream bleiben unverändert.

### Sicherheit und Authentifizierung

- Defensive Session-Validierung und koordinierte Token-Erneuerung.
- Single-Flight-Refresh mit begrenzten Retries und Schutz gegen konkurrierende
  HTTP-401-Recovery-Prozesse.
- Shutdown- und `AbortController`-Schutz für schwebende Requests und Retries.
- Sanitisiertes Logging ohne Token- oder Authorization-Inhalte.

### SSE und Polling

- Einheitlicher kanonischer Statuspfad (`lib/sseStatus.js`) für SSE und Polling.
- Unterstützung von Multi-Component-Geräten.
- Event-Debouncing und begrenzte parallele Statusabfragen (`maxConcurrent`).
- Polling-Fallback bei nicht verfügbarer SSE-Verbindung.
- Saubere Ressourcenfreigabe beim Shutdown; Schreibzugriffe werden nach
  Shutdown-Beginn abgefangen (`lib/writeGuard.js`).

### Befehlsverarbeitung

- Command-Allowlist (`commandStateIds`) wird ausschließlich aus der
  Capability-Erkennung aufgebaut und bei erfolgreichem Device-List-Refresh
  erneuert.
- Status-, General-, Info-, fremde Namespace- und unbekannte States lösen keine
  SmartThings-API-Kommandos aus, auch nicht bei `ack=false`.
- Statuswerte werden ausdrücklich mit `write: false` angelegt.
- Gültige Switch-, Level- und OCF-Kommandos bleiben erhalten; OCF ohne valide
  Metadaten wird sicher ignoriert.
- Ausgeschlossene Geräte erhalten keine Command-Einträge.

### Benutzeroberfläche

- Geführter Samsung-Login mit lokaler Validierung der Callback-URL.
- Zusätzlicher Reiter zur Geräteverwaltung mit Checkbox-Auswahl.
- Rückwärtskompatibilität mit `native.excludeDevices` und der bestehenden
  `exclude`-Liste.

### Datenpunkte

- `compactMode` bleibt optional und standardmäßig deaktiviert.
- Gültige Werte wie `0` und `false` bleiben erhalten.
- Vorhandene ioBroker-Objekte werden nicht automatisch gelöscht.

## Qualitätssicherung

Ausgeführt am 7. November 2026 in einem separaten Worktree auf Commit
`4a512ef`, Node.js `22.23.4`, npm `10.9.9`.

| Befehl | Ergebnis |
| --- | --- |
| `npm ci` | erfolgreich; 17 bestehende Audit-Hinweise (1 low, 9 moderate, 7 high) |
| `npm run lint` | erfolgreich, keine Fehler |
| `npm run test:js` | **96 passing**, keine übersprungenen Tests |
| `npm run test:package` | **43 passing** |
| `npm run test:unit` | **1 passing** (deprecated Platzhalter) |
| `npm run test:integration` | **2 passing**, Exit 0, js-controller `7.2.5` |
| `npm run check` | Exit 2, **108 TypeScript-Fehler** (bekannte Baseline, siehe unten) |
| `git diff --check` | sauber |

### TypeScript-Baseline

`npm run check` ist keine grüne Suite. Der unveränderte RC2-Baseline-Stand hat
**105** Fehler; RC3 hat **108**. Die drei zusätzlichen Meldungen stammen
ausschließlich aus der neuen Datei `commandRouting.test.js` und gehören zur
gleichen Kategorie wie die bestehende Baseline
(`Cannot find module 'node:assert/strict'`, `Cannot find module 'module'`,
`Cannot find name 'require'` – fehlende Node-Typdefinitionen). Es liegt keine
neue RC3-Code-Regression vor.

Die CI prüft deshalb weiterhin gezielt den eigenständigen
Sicherheits-Helper (`lib/startupSafety.js`) statt die vollständige
Legacy-Baseline zu maskieren.

### Integrität

- Keine Merge-Konfliktmarker.
- Keine übersprungenen Tests (`it.skip`/`describe.skip`).
- Keine tracked Secrets, Tokens oder Entwicklungsdateien.
- `package.json`, `package-lock.json` und `io-package.json` sind zwischen RC2
  und RC3 unverändert; keine Dependency-Änderungen.
- `crypto.txt` ist eine unveränderte Upstream-Datei aus `v0.2.0`.

## Bekanntes Verhalten und Einschränkungen

- Die Samsung-Anmeldung bleibt ein manueller Callback-Schritt; der Assistent
  validiert das Format, ersetzt aber keinen registrierten OAuth-Flow.
- `compactMode` wirkt nur auf neu verarbeitete Payloads und löscht keine
  bestehenden Objekte.
- Die vollständige TypeScript-Baseline bleibt offen (siehe oben).
- CI führt Integrationstests unter Node `22.x`/`24.x` und
  Ubuntu/Windows/macOS aus; Node `20.x` ist nicht mehr Teil der Matrix.
- Der RC3-Stand ist ein Release Candidate, keine Produktivfreigabe.

## Ausstehende Livetests

Der reale Feldtest von RC3 steht noch aus. Die reproduzierbare Checkliste liegt
in [`RC3_LIVE_TEST.md`](RC3_LIVE_TEST.md). Insbesondere offen:

- Schalt-, Dimm- und OCF-Kommandos auf realen Geräten.
- Nachweis, dass Status-Schreibzugriffe keine API-Kommandos auslösen.
- Geräteauswahl über Speichern/Neustart hinweg.
- SSE-/Polling-Verhalten und Token-Refresh im Dauerbetrieb.
- CPU-/RAM-Baseline.

## Voraussetzungen für die Installation

- ioBroker mit js-controller `>=3.0.0`; für RC3 geprüft mit `7.2.5`.
- Node.js `22.x` oder `24.x`.
- Exakter Commit `4a512ef3edbbb921dd185dbeae7a2087e09c1473`, zum Beispiel als
  GitHub-Tarball:
  `https://github.com/HenricTBoehm/ioBroker.smartthings/tarball/4a512ef3edbbb921dd185dbeae7a2087e09c1473`
- Vor der Installation eine Sicherung der ioBroker-Konfiguration erstellen.

## Rollback

1. Adapterinstanz stoppen.
2. Auf den unveränderten RC2-Commit
   `dbd15227ca9451732d8d1d2bf7765a845893e76f` (`beta1-rc2`) zurückgehen.
3. Bei Bedarf die zuvor gesicherte ioBroker-Konfiguration wiederherstellen.
4. Adapter starten und Verbindung/Status prüfen.

Der RC2-Tag `beta1-rc2` wird nicht verschoben oder überschrieben.

## Unterschied RC2 → RC3

| Bereich | RC2 (`dbd1522`) | RC3 (`4a512ef`) |
| --- | --- | --- |
| Command-Routing | Status-/Fremdstates konnten als Kommando enden | Allowlist aus Capability-Discovery; Statuswerte `write: false` |
| Regressionstests | Auth-/SSE-/Lifecycle-Tests | zusätzlich `commandRouting.test.js` (9 Tests) |
| CI-Actions | `actions/checkout@v4`, `setup-node@v4` | `@v5` |
| CI-Matrix | Node `24.x/20.x/22.x` | Node `22.x/24.x` |
| Paketversion | `0.3.0` | `0.3.0` (unverändert) |
| Dependencies | unverändert | unverändert |

## Dokumentation

- [`BETA_HANDOFF.md`](BETA_HANDOFF.md) – Herkunft, Strategie und Rückkehr zu RC2.
- [`RC3_LIVE_TEST.md`](RC3_LIVE_TEST.md) – Checkliste für den kontrollierten
  Livetest.
