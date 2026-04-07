# Kind 31402 Consumer Guide

This guide is for developers building clients that consume kind 31402 service announcement events published by 402-indexer (or by operators using 402-announce).

## What is kind 31402?

Kind 31402 is a replaceable Nostr event that announces a paid API endpoint. The `d` tag is the stable identifier; replacing events with the same `d` tag updates the service record. 402-indexer publishes these events continuously as it discovers and health-checks services.

Consumers include:

- **402-mcp** — AI agent client that discovers, pays, and consumes 402 APIs autonomously
- **402.pub** — Live directory that streams kind 31402 events from relays
- Custom agents and dashboards

---

## Subscribing to kind 31402 events

Using `nostr-tools`:

```typescript
import { Relay } from 'nostr-tools/relay'
import { parseServiceEvent } from '402-indexer/dist/event-parser.js'

const relay = await Relay.connect('wss://relay.damus.io')

const sub = relay.subscribe(
  [{ kinds: [31402] }],
  {
    onevent(event) {
      const service = parseServiceEvent(event)
      if (!service) return
      console.log(service.name, service.urls, service.paymentMethods)
    },
  }
)
```

To filter to only active L402 services:

```typescript
[{ kinds: [31402], '#pmi': ['l402'] }]
```

To filter by topic:

```typescript
[{ kinds: [31402], '#t': ['ai', 'image-generation'] }]
```

---

## Event structure

A kind 31402 event from 402-indexer looks like this:

```json
{
  "kind": 31402,
  "pubkey": "<indexer-or-operator-pubkey>",
  "created_at": 1744123456,
  "tags": [
    ["d", "api-example-com"],
    ["name", "Example API"],
    ["about", "Pay-per-request image generation API"],
    ["url", "https://api.example.com/v1/generate"],
    ["pmi", "l402"],
    ["pmi", "x402"],
    ["price", "generate", "10", "SAT"],
    ["source", "crawl"],
    ["status", "active"],
    ["verified", "2026-04-07T12:00:00.000Z"],
    ["t", "ai"],
    ["t", "image-generation"]
  ],
  "content": "{\"capabilities\":[]}",
  "id": "<event-id>",
  "sig": "<signature>"
}
```

---

## Tag reference

| Tag | Cardinality | Description |
|-----|-------------|-------------|
| `d` | 1 | Stable identifier (hostname or hostname-path). Used to replace previous announcements for the same service. |
| `name` | 1 | Human-readable service name |
| `about` | 0–1 | Service description |
| `url` | 1–10 | Endpoint URLs (transport addresses) |
| `pmi` | 0–N | Payment method info: `["pmi", "<rail>", ...params]`. Rail is one of `l402`, `x402`, `cashu`, `xcashu`, `payment`. |
| `price` | 0–N | Per-capability pricing: `["price", "<capability>", "<amount>", "<currency>"]`. Amount is in smallest unit (satoshis, cents). |
| `source` | 1 | How the service was discovered: `crawl`, `github`, `submit`, or `self` |
| `status` | 1 | Health status: `active`, `stale`, or `unreachable` |
| `verified` | 0–1 | ISO 8601 timestamp of last successful probe |
| `t` | 0–N | Topic tags for filtering |

---

## Health status lifecycle

402-indexer updates the `status` tag as it monitors services:

| Status | Meaning |
|--------|---------|
| `active` | Endpoint responding and returning 402 challenges |
| `stale` | 3+ consecutive probe failures |
| `unreachable` | 7+ consecutive failures |

Services unreachable for 30+ days are delisted via a NIP-09 deletion event. Clients should honour deletion events and remove the service from their index.

---

## Operator self-announcements

Operators who publish their own kind 31402 events (via 402-announce or toll-booth) take precedence. 402-indexer detects these via the Nostr aggregator channel and removes its own duplicate entry for the same endpoint using NIP-09.

Clients can identify operator-published events by checking `source == "self"`.

---

## Parsing with the event-parser module

If you depend on `402-indexer` as a library:

```typescript
import { parseServiceEvent } from '402-indexer/dist/event-parser.js'
import type { DiscoveredService } from '402-indexer/dist/types.js'

function handleEvent(rawEvent: NostrEvent): void {
  const service: DiscoveredService | null = parseServiceEvent(rawEvent)
  if (!service) return  // malformed or wrong kind

  if (service.status !== 'active') return  // skip stale/unreachable

  for (const pm of service.paymentMethods) {
    console.log(`Rail: ${pm.rail}`)
  }
}
```

`parseServiceEvent` returns `null` for non-31402 events and for events missing required tags (`d`, `name`).

---

## Kind 1402 — Community suggestions

Users can submit URLs they believe are paid APIs by publishing a kind 1402 event:

```json
{
  "kind": 1402,
  "tags": [
    ["u", "https://api.example.com/v1/endpoint"]
  ],
  "content": "This API charges per request using L402",
  "pubkey": "<user-pubkey>",
  "...": "..."
}
```

402-indexer's community listener subscribes to these, verifies the signature, and adds the URL to its probe list. The URL is then independently verified before any kind 31402 event is published.

---

## Relay configuration

402-indexer publishes to the relays in `config/relays.json` (publish array). Common relays carrying kind 31402 events:

- `wss://relay.damus.io`
- `wss://nos.lol`
- `wss://relay.nostr.band`

Subscribe to multiple relays and deduplicate by event `id` to maximise coverage.
