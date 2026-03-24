# CLAUDE.md — 402-indexer

Nostr-native crawler that discovers L402 and x402 paid APIs and publishes kind 31402 events.

## Commands

```bash
pnpm build        # Build
pnpm test         # Run all tests
pnpm lint         # Type check
pnpm start        # Run the indexer
```

## Structure

```
src/
  types.ts                     # Core types
  utils.ts                     # Shared utilities (hexToBytes)
  event-parser.ts              # Parse kind 31402 → DiscoveredService
  channels/
    active-prober.ts           # HTTP probe for 402 headers
    nostr-aggregator.ts        # Subscribe to kind 31402 across relays
    github-scanner.ts          # GitHub API search
    npm-scanner.ts             # npm dependents scan
    community-listener.ts      # Kind 1402 suggestion listener
  publisher/
    event-builder.ts           # Build kind 31402 from DiscoveredService
    relay-publisher.ts         # Sign + publish + NIP-09 delete
  health/
    state-store.ts             # JSON file persistence for health state
    health-checker.ts          # Daily endpoint verification
    lifecycle.ts               # Stale/unreachable/delist transitions
  orchestrator.ts              # CLI entry point, starts all channels
  config.ts                    # Env vars + config file loading
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INDEXER_SECRET_KEY` | Yes | — | 64-char hex Nostr secret key for signing published events |
| `GITHUB_TOKEN` | No | — | GitHub API token for `github-scanner` channel |
| `HEALTH_STATE_PATH` | No | `health-state.json` | Path to health check state persistence file |

Relay URLs and seed URLs are loaded from JSON files in `config/` (`relays.json`, `seed-urls.json`, `x402-seeds.json`).

## Testing

```bash
pnpm test                                    # all tests
npx vitest run src/path/to/file.test.ts      # single test file
```

## Conventions

- **British English** — colour, initialise, behaviour, licence
- **pnpm** for package management
- **ESM-only** — `"type": "module"`
- **Git:** commit messages use `type: description` format
- **Git:** Do NOT include `Co-Authored-By` lines
- **TDD** — write failing test first, then implement
