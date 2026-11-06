# SmartThings Beta 1 – RC3 Handoff

Stand: 6. November 2026  
Status: **RC3-Integration zur Prüfung; keine Produktivfreigabe**

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

- Die früheren CI-Ergebnisse von RC2 und #97 gelten **nicht** automatisch für den RC3-Merge-Commit.
- RC3 muss eigenständig Lint, JS-Regressionen, Package-, Unit- und Integrationstests erfolgreich bestehen.
- Fokus des Praxistests: keine API-Kommandos beim Schreiben von Statuswerten, funktionierendes Schalten/Dimmen und OCF, SSE-/Polling-Updates, Geräteauswahl nach Save/Restart sowie Token-Refresh.
- Die vollständige Projekt-TypeScript-Baseline ist weiterhin separat offen; gezielte Sicherheits-Typprüfung bleibt Teil der CI.
- Der reale RC2-Test vom 6. November beobachtete Adapterstart, Wiederverwendung der Sitzung, 20 Geräte und sichtbare Geräteauswahl. Das ist **kein RC3-Feldtest**.
- Kein automatischer Release und keine Änderung an der npm-Paketversion `0.3.0`.

## Upstream-Strategie

PR #97 kann als eigenständiger Fix überprüft werden. PR #96 ist eine überlappende Integrationsreferenz und darf nicht zusätzlich zu den Einzel-PRs blind gemergt werden. Entscheidung über inkrementelles Mergen oder integrierten Merge liegt beim Maintainer.

## Lokale Rückkehr auf RC2

Der unveränderte RC2-Commit ist `dbd15227ca9451732d8d1d2bf7765a845893e76f`. Vor Installation eine ioBroker-Konfigurationssicherung erstellen. Eine produktive Instanz nicht ungeprüft parallel betreiben.
