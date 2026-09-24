# 402-indexer

Nostr-native crawler that discovers L402 and x402 paid APIs and publishes
kind 31402 service announcements. It runs as a persistent background process:
operators run 402-indexer, clients such as 402-mcp and 402.pub consume the
results.

## Commands

```bash
pnpm install       # Install dependencies
pnpm build         # Compile TypeScript to dist/
pnpm test          # Run all tests (Vitest)
pnpm run lint      # Type-check without emitting (tsc --noEmit)
pnpm run typecheck # Same as lint
pnpm start         # Run the indexer (requires INDEXER_SECRET_KEY)
```

Run a single test file:

```bash
npx vitest run tests/channels/active-prober.test.ts
```

## Structure

```
src/
  types.ts                     # Core types and kind constants
  utils.ts                     # Shared utilities (hexToBytes)
  event-parser.ts              # Parse kind 31402 events to DiscoveredService
  config.ts                    # Environment variables + JSON config loading
  orchestrator.ts              # CLI entry point, starts all channels
  channels/
    active-prober.ts           # HTTP probe for 402 headers and signals
    nostr-aggregator.ts        # Subscribe to kind 31402 across relays
    github-scanner.ts          # GitHub API search for L402/x402 repos
    npm-scanner.ts             # npm dependents scan
    registry-scanner.ts        # Satring, awesome-L402, x402.org, Cashu registries
    community-listener.ts      # Kind 1402 suggestion events from users
  publisher/
    event-builder.ts           # Build kind 31402 from DiscoveredService
    relay-publisher.ts         # Sign, publish, and NIP-09 delete events
  health/
    state-store.ts             # JSON file persistence for health state
    health-checker.ts          # Daily endpoint verification
    lifecycle.ts               # active/stale/unreachable/delist transitions
tests/                         # Mirrors src/ structure
config/                        # relays.json, seed-urls.json, x402-seeds.json
deploy/                        # systemd service file + .env.example
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INDEXER_SECRET_KEY` | Yes | none | 64-char hex Nostr secret key for signing published events |
| `GITHUB_TOKEN` | No | none | GitHub API token for the `github-scanner` channel |
| `HEALTH_STATE_PATH` | No | `health-state.json` | Path to the health check state file |

Relay URLs and seed URLs are loaded from `config/relays.json`,
`config/seed-urls.json` and `config/x402-seeds.json`.

## Conventions

- British English in prose and comments: colour, initialise, behaviour, licence.
- pnpm for package management.
- ESM-only: `"type": "module"` throughout.
- TDD: write a failing test first, then implement.
- Conventional commits (`type: description`); no `Co-Authored-By` lines.
- All public functions should have JSDoc comments.
- Use `nostr-tools` for all Nostr event handling.

## Adding a new discovery channel

1. Create `src/channels/your-channel.ts` with a function that returns discovered URLs.
2. Add tests in `tests/channels/your-channel.test.ts`.
3. Wire it into `src/orchestrator.ts` using `scheduleTask()`.
4. Update this file's structure section and `llms-full.txt`.

## Adding a new detection signal

1. Add the signal name to the `DetectionMethod` union in `src/types.ts`.
2. Implement detection logic in `src/channels/active-prober.ts`.
3. Add tests in `tests/channels/active-prober.test.ts`.
4. Update `llms.txt` and `llms-full.txt` detection method lists.

## Pitfalls

- `INDEXER_SECRET_KEY` must be a 64-character hex string or `loadConfig()` throws.
- The Nostr aggregator channel deletes the indexer's own duplicate event via
  NIP-09 when it sees an operator self-announcement for the same service.
