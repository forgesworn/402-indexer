# 402-indexer

**Nostr:** [`npub1mgvlrnf5hm9yf0n5mf9nqmvarhvxkc6remu5ec3vf8r0txqkuk7su0e7q2`](https://njump.me/npub1mgvlrnf5hm9yf0n5mf9nqmvarhvxkc6remu5ec3vf8r0txqkuk7su0e7q2)

Nostr-native crawler that discovers L402 and x402 paid APIs and publishes [kind 31402](https://github.com/forgesworn/402-announce) events for decentralised service discovery.

## What it does

The indexer finds paid APIs across multiple channels and announces them on Nostr so clients like [402-mcp](https://github.com/forgesworn/402-mcp) and the [402.pub](https://402.pub) directory can discover them.

### Discovery channels

- **Active prober** — HTTP probe for `WWW-Authenticate: L402` and `402 Payment Required` headers
- **Nostr aggregator** — Subscribe to existing kind 31402 events across relays
- **GitHub scanner** — Search GitHub for repos using L402/x402 patterns
- **npm scanner** — Find packages depending on toll-booth, aperture, and other L402 libraries
- **Community listener** — Accept kind 1402 suggestion events from users

### Health monitoring

Discovered services are verified daily. Endpoints that become unreachable are marked stale and eventually delisted, keeping the directory accurate.

## Usage

```bash
# Install
pnpm install

# Build and run
pnpm build
pnpm start
```

## Configuration

The indexer reads from JSON files in `config/` and environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INDEXER_SECRET_KEY` | Yes | -- | 64-char hex Nostr secret key for signing events |
| `GITHUB_TOKEN` | No | -- | GitHub API token for GitHub scanner channel |
| `HEALTH_STATE_PATH` | No | `health-state.json` | Path to health check state file |

Relay URLs and seed URLs are loaded from `config/relays.json`, `config/seed-urls.json`, and `config/x402-seeds.json`.

## Part of the 402 ecosystem

| Package | Purpose |
|---------|---------|
| [toll-booth](https://github.com/forgesworn/toll-booth) | L402 middleware — gate any API behind Lightning |
| [402-announce](https://github.com/forgesworn/402-announce) | Publish kind 31402 service announcements |
| [402-mcp](https://github.com/forgesworn/402-mcp) | AI agents discover, pay for, and consume 402 APIs |
| [402.pub](https://402.pub) | Live service directory |
| **402-indexer** | Crawl and index paid APIs (this repo) |

## Part of the ForgeSworn Toolkit

[ForgeSworn](https://forgesworn.dev) builds open-source cryptographic identity, payments, and coordination tools for Nostr.

| Library | What it does |
|---------|-------------|
| [nsec-tree](https://github.com/forgesworn/nsec-tree) | Deterministic sub-identity derivation |
| [ring-sig](https://github.com/forgesworn/ring-sig) | SAG/LSAG ring signatures on secp256k1 |
| [range-proof](https://github.com/forgesworn/range-proof) | Pedersen commitment range proofs |
| [canary-kit](https://github.com/forgesworn/canary-kit) | Coercion-resistant spoken verification |
| [spoken-token](https://github.com/forgesworn/spoken-token) | Human-speakable verification tokens |
| [toll-booth](https://github.com/forgesworn/toll-booth) | L402 payment middleware |
| [geohash-kit](https://github.com/forgesworn/geohash-kit) | Geohash toolkit with polygon coverage |
| [nostr-attestations](https://github.com/forgesworn/nostr-attestations) | NIP-VA verifiable attestations |
| [dominion](https://github.com/forgesworn/dominion) | Epoch-based encrypted access control |
| [nostr-veil](https://github.com/forgesworn/nostr-veil) | Privacy-preserving Web of Trust |

## Licence

MIT
