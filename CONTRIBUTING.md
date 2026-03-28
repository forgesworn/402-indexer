# Contributing

## Setup

```bash
git clone https://github.com/forgesworn/402-indexer.git
cd 402-indexer
pnpm install
```

Requires Node.js >= 20 and pnpm.

## Development

| Command | Purpose |
|---------|---------|
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm test` | Run all 166 tests via Vitest |
| `pnpm lint` | Type-check without emitting |
| `pnpm start` | Run the indexer (requires `INDEXER_SECRET_KEY`) |

Run a single test file:

```bash
npx vitest run tests/channels/active-prober.test.ts
```

## Making Changes

1. Create a branch: `git checkout -b feat/short-description` (or `fix/`, `docs/`, `refactor/`)
2. Make your changes.
3. Ensure all tests pass: `pnpm test`
4. Ensure type-checking passes: `pnpm lint`
5. Commit using conventional commits: `feat: add new detection signal`
   - `feat:` — new feature (triggers minor version bump)
   - `fix:` — bug fix (triggers patch version bump)
   - `docs:` — documentation only
   - `refactor:` — no behaviour change
6. Open a pull request against `main`.

## Code Style

- **British English** in all prose and comments (colour, initialise, behaviour)
- **ESM-only** — the project uses `"type": "module"` throughout
- **TDD** — write a failing test first, then implement
- All public functions should have JSDoc comments
- Use `nostr-tools` for all Nostr event handling

## Project Structure

```
src/
  types.ts                     # Core types and kind constants
  config.ts                    # Environment variables + JSON config loading
  event-parser.ts              # Parse kind 31402 events to DiscoveredService
  utils.ts                     # Shared utilities (hexToBytes)
  orchestrator.ts              # CLI entry point — starts all channels
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
tests/                         # Mirrors src/ structure, 15 test files
config/                        # relays.json, seed-urls.json, x402-seeds.json
deploy/                        # systemd service file + .env.example
```

## Adding a New Discovery Channel

1. Create `src/channels/your-channel.ts` with a function that returns discovered URLs
2. Add tests in `tests/channels/your-channel.test.ts`
3. Wire it into `src/orchestrator.ts` using `scheduleTask()`
4. Update `CLAUDE.md` structure section and `llms-full.txt`

## Adding a New Detection Signal

1. Add the signal name to the `DetectionMethod` union in `src/types.ts`
2. Implement detection logic in `src/channels/active-prober.ts` (inside `checkResponseSignals`)
3. Add tests in `tests/channels/active-prober.test.ts`
4. Update `llms.txt` and `llms-full.txt` detection method lists
