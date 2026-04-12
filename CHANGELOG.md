# Changelog

## 0.2.1 (2026-04-12)

### Bug Fixes

- bump picomatch to 4.0.4 (GHSA-3v7f-55p6-f55p) (deps)



## 0.2.0 (2026-04-12)

### Features

- add semantic-release, CI workflow, llms.txt, and fix README
- accept IETF Payment rail in event parser
- detect IETF Payment scheme (draft-ryan-httpauth-payment)
- add 165 x402 service URLs from x402.org ecosystem
- parallel probing with multi-signal detection
- add .well-known/l402 manifest detection alongside x402
- detect 402-capable services via CORS headers
- add progress logging to prober (every 50 URLs)
- smart probing with .well-known/x402.json and common API paths
- add Cashu discovery sources and expand x402/L402 seed URLs
- add registry scanner for Satring and awesome-L402 discovery
- expand seed URLs and dependency markers for x402/L402 discovery
- systemd service and env template for deployment
- orchestrator with scheduled discovery channels
- community suggestion listener for kind 1402 events
- Nostr aggregator with dedup and supersession detection
- npm dependents scanner
- GitHub scanner for L402/x402 dependency markers
- health checker probes indexed endpoints
- health lifecycle with stale and delist thresholds
- health state persistence to JSON file
- active prober for L402 and x402 detection
- config loader with env vars and JSON config files
- relay publisher with NIP-09 deletion support
- add event builder for kind 31402 Nostr events
- add event parser for kind 31402 Nostr events
- core type definitions and shared utilities
- project scaffolding

### Bug Fixes

- remove npm publishing setup — 402-indexer is a deployed service
- correct copyright to TheCryptoDonkey
- capitalise ForgeSworn in licence
- infer x402 vs l402 rail from CORS and payment headers
- update prober tests for l402 manifest check ordering
- run initial GitHub/npm scan before first probe cycle
- critical bugs found in code review


