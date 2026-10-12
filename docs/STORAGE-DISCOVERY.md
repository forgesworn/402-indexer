# Public storage profiles

The shared `forgesworn-storage-service-v1` kind 31402 extension covers paid
Wildbloom storage and public free mirror shelter. Parser validation uses pinned
`402-announce` 2.3.0: signed key/listing/origin binding, closed schema, full
prices/revisions/policies, enabled checkout rails and expiry. The paid flow is
`wildbloom-checkout-v1`, not an L402, x402 or Cashu HTTP challenge. Free shelter
accepts authorised mirrors with best-effort evictable retention; it gives no
direct upload allowance to unknown users.

Latest valid records are selected before availability/expiry filtering, with
the lowest event ID breaking equal timestamps. The running aggregator retains
up to 2,000 signed storage watermarks across relay rounds and refuses growth
beyond that bound rather than evicting withdrawals. Restart clears this memory;
a relay can omit a newer record from a fresh process. These watermarks are
operator claims, not independent uptime or retention evidence.

The orchestrator collects these claims separately from crawled APIs. It never
signs them under the indexer's key or lets them delete a different paid API at
the same origin. It does not add their URLs to ordinary API probes.

By default no storage node is inspected. Explicitly set
`INDEXER_STORAGE_HEALTH=true` to include them in the existing health schedule.
Inspection makes one unsigned `GET /services/v1` to an advertised public HTTPS
origin. It binds the response's service key and listing identifier to the signed
event. All DNS addresses must be public; the validated address is pinned into
the socket while TLS verifies the original hostname. The whole operation has
a 15-second deadline, 64 KiB body limit, required JSON MIME type and no redirects,
credentials, quotes, signing or payments. Onion-only services are not inspected;
there is no direct DNS or clearnet fallback. A valid full/paused description is
reachable even though it is not accepting a new purchase. Health observations
are private indexer state keyed by service key plus listing, not new public
operator announcements.

Validation includes the shared signed fixtures, semantic reject cases,
withdrawal omission/replay, replacement ties, no re-signing, free/paid semantics,
key binding, full capacity and mocked HTTP/DNS pinning, mixed private/public
DNS rejection, redirects, JSON and body bounds. This is controlled transport
evidence, not real operator/Tor/payment acceptance.
