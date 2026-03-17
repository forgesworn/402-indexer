import type { NostrEvent } from 'nostr-tools/pure'

const ALLOWED_PROTOCOLS = new Set(['https:', 'http:'])

export interface Suggestion {
  url: string
  description?: string
  submitterPubkey: string
  eventId: string
}

/**
 * Parse a kind 1402 community suggestion event.
 * Returns null if the event is invalid or missing a URL.
 */
export function parseSuggestionEvent(event: NostrEvent): Suggestion | null {
  const urlTag = event.tags.find(t => t[0] === 'url')
  if (!urlTag?.[1]) return null

  const rawUrl = urlTag[1]
  try {
    const parsed = new URL(rawUrl)
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null
  } catch {
    return null
  }

  const descTag = event.tags.find(t => t[0] === 'description')

  return {
    url: rawUrl,
    description: descTag?.[1],
    submitterPubkey: event.pubkey,
    eventId: event.id,
  }
}
