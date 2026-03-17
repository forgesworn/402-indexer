import { Relay } from 'nostr-tools/relay'
import { verifyEvent } from 'nostr-tools/pure'
import type { NostrEvent } from 'nostr-tools/pure'
import { KIND_SERVICE_ANNOUNCEMENT } from '../types.js'

const MAX_EVENTS = 1000
const SUBSCRIBE_TIMEOUT_MS = 15_000
const CONNECT_TIMEOUT_MS = 10_000

/**
 * Check if an event was published by the indexer.
 */
export function isIndexerEvent(event: NostrEvent, indexerPubkey: string): boolean {
  return event.pubkey === indexerPubkey
}

/**
 * Deduplicate events by pubkey + d-tag, keeping the newest.
 * This is Nostr's native replaceable event semantics (NIP-33).
 */
export function deduplicateServices(events: NostrEvent[]): NostrEvent[] {
  const map = new Map<string, NostrEvent>()
  for (const event of events) {
    const dTag = event.tags.find(t => t[0] === 'd')?.[1] ?? ''
    const key = `${event.pubkey}:${dTag}`
    const existing = map.get(key)
    if (!existing || event.created_at > existing.created_at) {
      map.set(key, event)
    }
  }
  return [...map.values()]
}

/**
 * Find indexer events that have been superseded by an operator self-announcing
 * at the same URL. These should be deleted via NIP-09.
 */
export function findSupersededIndexerEvents(
  events: NostrEvent[],
  indexerPubkey: string,
): NostrEvent[] {
  // Build a set of URLs announced by non-indexer pubkeys (operators)
  const operatorUrls = new Set<string>()
  for (const event of events) {
    if (event.pubkey === indexerPubkey) continue
    for (const tag of event.tags) {
      if (tag[0] === 'url') operatorUrls.add(tag[1])
    }
  }

  // Find indexer events whose URLs are now covered by operators
  return events.filter(event => {
    if (event.pubkey !== indexerPubkey) return false
    return event.tags
      .filter(t => t[0] === 'url')
      .some(t => operatorUrls.has(t[1]))
  })
}

/**
 * Subscribe to kind 31402 events across multiple relays.
 * Returns deduplicated events after EOSE from all relays.
 */
export async function aggregateFromRelays(
  relayUrls: string[],
  timeoutMs: number = SUBSCRIBE_TIMEOUT_MS,
): Promise<NostrEvent[]> {
  const events: NostrEvent[] = []

  const results = await Promise.allSettled(
    relayUrls.map(async (url) => {
      const relay = await Promise.race([
        Relay.connect(url),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`timeout: ${url}`)), CONNECT_TIMEOUT_MS),
        ),
      ])

      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            sub.close()
            resolve()
          }, timeoutMs)

          const sub = relay.subscribe(
            [{ kinds: [KIND_SERVICE_ANNOUNCEMENT] }],
            {
              onevent: (event: NostrEvent) => {
                if (events.length < MAX_EVENTS && verifyEvent(event)) {
                  events.push(event)
                }
              },
              oneose: () => {
                clearTimeout(timer)
                sub.close()
                resolve()
              },
            },
          )

          void reject // suppress unused variable warning
        })
      } finally {
        relay.close()
      }
    }),
  )

  void results // suppress unused variable warning
  return deduplicateServices(events)
}
