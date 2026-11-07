# SmartThings Beta 1 – RC3 Handoff

Stand: 7. November 2026
Status: **RC3 eingefroren und geprüft; keine Produktivfreigabe**

## Kanonischer Stand

| Feld | Wert |
| --- | --- |
| Branch | `integration/smartthings-rc3` |
| Getesteter Code-Commit | `4a512ef3edbbb921dd185dbeae7a2087e09c1473` |
| Tag | `beta1-rc3` (Branch-Head inkl. Dokumentation) |
| Paketversion | `0.3.0` (unverändert) |

`integration/smartthings-beta` und `integration/smartthings-rc3` zeigen auf
denselben Code-Stand; es war kein zusätzlicher Merge, Rebase oder Cherry-Pick nötig.
Details zu Funktionen, Tests und Rollback: [`RC3_RELEASE_NOTES.md`](RC3_RELEASE_NOTES.md).
Livetest-Checkliste: [`RC3_LIVE_TEST.md`](RC3_LIVE_TEST.md).

## Herkunft

- RC2-Basis: `dbd15227ca9451732d8d1d2bf7765a845893e76f` (`beta1-rc2` bleibt unverändert).
- Eigenständiger Fix: [TA2k/ioBroker.smartthings #97](https://github.com/TA2k/ioBroker.smartthings/pull/97), Head `a31f6eb031c0e6f7aa0cdaa3e5058afef4847d70`.
- RC3 integriert die Änderungen fachlich in die sichere RC2-Architektur, nicht durch vollständiges Ersetzen von `main.js` mit der #97-Version.
- Originale Einzel-PRs #93, #94, #95 und #97 bleiben separat; der integrierte Draft ist #96.
- `master` im Fork und bei TA2k bleibt unangetastet.

## RC3-Änderungen

1. Nur beim Capability-Discovery angelegte und registrierte Befehls-States dürfen SmartThings-API-Kommandos auslösen.
2. `status`, `general`, `info`, fremde Namespaces und unbekannte States werden ignoriert, selbst wenn `ack=false`.
3. Die Command-Allowlist wird bei erfolgreichem Device-List-Refresh erneuert; ausgeschlossene Geräte erhalten keine Command-Einträge.
4. Gültige Switch-, Level- und OCF-Kommandos bleiben erhalten; OCF ohne Metadaten wird sicher ignoriert.
5. Der kanonische SSE-/Polling-Statusparser schreibt Statuswerte ausdrücklich mit `write: false`.
6. RC2-Schutzmaßnahmen bleiben erhalten: `requestApi` mit AbortController, Token-Generation und 401-Recovery, Shutdown-Guards, sanitisierte Logs.
7. Neue Command-Routing-Regressionstests aus #97, angepasst an den gemeinsamen Statuspfad, plus Schutztests für Shutdown/ungültige Autorisierung.
8. CI: `actions/checkout@v5`, `actions/setup-node@v5`, Node.js 22/24, Ubuntu/Windows/macOS; bestehende Sicherheits-/Integrationstests bleiben erhalten.

## Validation und offene Nachweise

- RC3 wurde eigenständig auf Commit `4a512ef` geprüft (Node `22.23.4`, npm `10.9.9`):
  `npm run lint` erfolgreich, `npm run test:js` 96 passing, `npm run test:package`
  43 passing, `npm run test:unit` 1 passing (deprecated Platzhalter),
  `npm run test:integration` 2 passing (Exit 0, js-controller `7.2.5`),
  `git diff --check` sauber.
- `npm run check` bleibt eine bekannte Baseline: RC2 105 vs. RC3 108
  TypeScript-Fehler. Die drei zusätzlichen Meldungen stammen aus
  `commandRouting.test.js` und sind fehlende Node-Typdefinitionen derselben
  Kategorie wie die bestehende Baseline – keine RC3-Code-Regression.
- Fokus des Praxistests: keine API-Kommandos beim Schreiben von Statuswerten,
  funktionierendes Schalten/Dimmen und OCF, SSE-/Polling-Updates,
  Geräteauswahl nach Save/Restart sowie Token-Refresh.
- Der reale RC2-Test vom 6. November beobachtete Adapterstart, Wiederverwendung
  der Sitzung, 20 Geräte und sichtbare Geräteauswahl. Das ist **kein
  RC3-Feldtest**; der RC3-Livetest steht gemäß `RC3_LIVE_TEST.md` noch aus.
- Kein automatischer Release und keine Änderung an der npm-Paketversion `0.3.0`.

## Upstream-Strategie

PR #97 kann als eigenständiger Fix überprüft werden. PR #96 ist eine überlappende Integrationsreferenz und darf nicht zusätzlich zu den Einzel-PRs blind gemergt werden. Entscheidung über inkrementelles Mergen oder integrierten Merge liegt beim Maintainer.

## Lokale Rückkehr auf RC2

Der unveränderte RC2-Commit ist `dbd15227ca9451732d8d1d2bf7765a845893e76f`.
Vor Installation eine ioBroker-Konfigurationssicherung erstellen. Eine
produktive Instanz nicht ungeprüft parallel betreiben. Die vollständige
Rollback-Anleitung steht in [`RC3_RELEASE_NOTES.md`](RC3_RELEASE_NOTES.md).
