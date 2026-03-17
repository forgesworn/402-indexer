import { describe, it, expect } from 'vitest'
import { deduplicateServices, isIndexerEvent, findSupersededIndexerEvents } from '../../src/channels/nostr-aggregator.js'
import type { NostrEvent } from 'nostr-tools/pure'

const INDEXER_PUBKEY = 'indexer-pubkey-123'

function makeEvent(pubkey: string, dTag: string, url: string, createdAt = 1710000000): NostrEvent {
  return {
    id: `${pubkey}-${dTag}`,
    pubkey,
    created_at: createdAt,
    kind: 31402,
    tags: [
      ['d', dTag],
      ['name', `Service ${dTag}`],
      ['about', 'A service'],
      ['url', url],
      ['pmi', 'l402', 'lightning'],
      ['price', 'query', '10', 'sats'],
    ],
    content: '{}',
    sig: 'sig',
  } as NostrEvent
}

describe('isIndexerEvent', () => {
  it('returns true for events from the indexer pubkey', () => {
    const event = makeEvent(INDEXER_PUBKEY, 'svc-1', 'https://api.com')
    expect(isIndexerEvent(event, INDEXER_PUBKEY)).toBe(true)
  })

  it('returns false for events from other pubkeys', () => {
    const event = makeEvent('operator-pubkey', 'svc-1', 'https://api.com')
    expect(isIndexerEvent(event, INDEXER_PUBKEY)).toBe(false)
  })
})

describe('deduplicateServices', () => {
  it('keeps newest event per pubkey + d-tag', () => {
    const events = [
      makeEvent('pub1', 'svc-a', 'https://a.com', 1000),
      makeEvent('pub1', 'svc-a', 'https://a.com', 2000),
    ]
    const result = deduplicateServices(events)
    expect(result).toHaveLength(1)
    expect(result[0].created_at).toBe(2000)
  })

  it('keeps both events from different pubkeys for same d-tag', () => {
    const events = [
      makeEvent('pub1', 'svc-a', 'https://a.com'),
      makeEvent('pub2', 'svc-a', 'https://a.com'),
    ]
    const result = deduplicateServices(events)
    expect(result).toHaveLength(2)
  })

  it('identifies URL overlap between indexer and operator events', () => {
    const events = [
      makeEvent(INDEXER_PUBKEY, 'svc-a', 'https://api.com'),
      makeEvent('operator-pub', 'my-api', 'https://api.com'),
    ]
    const result = deduplicateServices(events)
    // Both kept — the orchestrator handles NIP-09 deletion
    expect(result).toHaveLength(2)
  })

  it('finds indexer events superseded by operator self-announcements', () => {
    const events = [
      makeEvent(INDEXER_PUBKEY, 'svc-a', 'https://api.com'),
      makeEvent('operator-pub', 'my-api', 'https://api.com'),
    ]
    const superseded = findSupersededIndexerEvents(events, INDEXER_PUBKEY)
    expect(superseded).toHaveLength(1)
    expect(superseded[0].pubkey).toBe(INDEXER_PUBKEY)
  })
})
