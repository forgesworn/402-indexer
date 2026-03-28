# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in 402-indexer, please report it responsibly.

**Email:** security@forgesworn.dev

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We aim to acknowledge reports within 48 hours and provide a fix or mitigation within 7 days for critical issues.

## Scope

402-indexer is a deployed service (not an npm library). Security concerns include:

- **Secret key handling** — the `INDEXER_SECRET_KEY` environment variable contains a Nostr signing key
- **Nostr event verification** — all incoming events are verified via `nostr-tools/pure` before processing
- **HTTP probing** — the crawler makes outbound HTTP requests; SSRF protections should be considered
- **Community suggestions** — kind 1402 events are signature-verified before URLs are added to the probe list

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x | Yes |

## Security Hardening

The included systemd service file (`deploy/402-indexer.service`) applies:
- `NoNewPrivileges=true`
- `ProtectSystem=strict`
- `ProtectHome=true`
- Restricted write paths (health state file only)
