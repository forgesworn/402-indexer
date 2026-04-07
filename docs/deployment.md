# Deployment Guide

402-indexer runs as a persistent background process. It requires a Nostr signing key and network access to Nostr relays, GitHub (optional), and the URLs it probes.

---

## Requirements

- Node.js >= 20
- pnpm
- A 64-char hex Nostr secret key (`INDEXER_SECRET_KEY`)
- Outbound HTTP/S access to probe URLs and Nostr relays

---

## Quick start

```bash
git clone https://github.com/forgesworn/402-indexer.git
cd 402-indexer
pnpm install
pnpm build

export INDEXER_SECRET_KEY=<your-64-char-hex-nostr-secret-key>
pnpm start
```

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INDEXER_SECRET_KEY` | Yes | — | 64-char hex Nostr secret key. Used to sign kind 31402 and NIP-09 events. |
| `GITHUB_TOKEN` | No | — | GitHub personal access token. Enables the GitHub scanner channel. Without it the scanner is rate-limited to 60 requests/hour. |
| `HEALTH_STATE_PATH` | No | `health-state.json` | Path to the health check state file. Must be writable. |

Generate a Nostr key pair with `nostr-tools` or `nak`:

```bash
npx nak keygen
```

---

## Configuration files

All config files live in `config/`:

**`config/relays.json`** — relay lists:

```json
{
  "subscribe": [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.nostr.band"
  ],
  "publish": [
    "wss://relay.damus.io",
    "wss://nos.lol"
  ]
}
```

**`config/seed-urls.json`** — seed URLs for the active prober on startup:

```json
["https://api.example.com/v1/generate", "https://paid.service.dev/search"]
```

**`config/x402-seeds.json`** — x402-specific seed URLs (same format).

---

## Systemd (Linux server)

A systemd unit is provided at `deploy/402-indexer.service`. Copy and adapt:

```bash
# Copy files
sudo cp -r . /opt/402-indexer
sudo cp deploy/402-indexer.service /etc/systemd/system/

# Create a dedicated user
sudo useradd --system --no-create-home indexer

# Create the env file (copy and edit the example)
sudo cp deploy/.env.example /opt/402-indexer/.env
sudo nano /opt/402-indexer/.env   # set INDEXER_SECRET_KEY at minimum

# Set ownership
sudo chown -R indexer:indexer /opt/402-indexer

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable 402-indexer
sudo systemctl start 402-indexer
sudo journalctl -u 402-indexer -f
```

The unit applies these security hardening options:

- `NoNewPrivileges=true`
- `ProtectSystem=strict`
- `ProtectHome=true`
- Write access restricted to the health state file path

---

## Docker Compose

No official image is published yet. Build and run locally:

```yaml
# docker-compose.yml
services:
  402-indexer:
    build: .
    restart: unless-stopped
    environment:
      - INDEXER_SECRET_KEY=${INDEXER_SECRET_KEY}
      - GITHUB_TOKEN=${GITHUB_TOKEN}
      - HEALTH_STATE_PATH=/data/health-state.json
    volumes:
      - ./config:/app/config:ro
      - indexer-data:/data

volumes:
  indexer-data:
```

You will need to add a `Dockerfile`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
CMD ["node", "dist/orchestrator.js"]
```

---

## Health check state

The indexer persists health state to a JSON file (`health-state.json` by default). This file records:

- Last successful probe timestamp per service
- Consecutive failure count
- Last check timestamp

Keep this file on a persistent volume. Losing it causes the indexer to reset all failure counts, which delays stale/unreachable transitions but is not catastrophic.

---

## Log output

On startup:

```
402-indexer starting...
  Seed URLs: 42
  Subscribe relays: 5
  Publish relays: 3
[startup] running initial GitHub/npm scan to populate probe list...
[startup] probe list populated: 87 URLs
[startup] probe list after registry scan: 102 URLs
[active-prober] probing 102 URLs...
[active-prober] published api-example-com (well-known-l402): 3 accepted, 0 failed
```

---

## Connecting to 402.pub

Once running, the indexer publishes kind 31402 events to configured relays. The 402.pub directory subscribes to those same relays and will pick up your indexed services automatically within minutes.

To verify your events are published:

```bash
npx nak req -k 31402 wss://relay.damus.io | head -20
```
