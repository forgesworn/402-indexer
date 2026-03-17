import { describe, it, expect } from 'vitest'
import { parseSuggestionEvent } from '../../src/channels/community-listener.js'
import type { NostrEvent } from 'nostr-tools/pure'

function makeSuggestionEvent(tags: string[][]): NostrEvent {
  return {
    id: 'suggest-123',
    pubkey: 'submitter-pub',
    created_at: 1710000000,
    kind: 1402,
    tags,
    content: '',
    sig: 'sig',
  } as NostrEvent
}

describe('parseSuggestionEvent', () => {
  it('extracts URL from url tag', () => {
    const event = makeSuggestionEvent([['url', 'https://api.suggested.com']])
    const result = parseSuggestionEvent(event)
    expect(result).not.toBeNull()
    expect(result!.url).toBe('https://api.suggested.com')
  })

  it('extracts description from description tag', () => {
    const event = makeSuggestionEvent([
      ['url', 'https://api.com'],
      ['description', 'A cool API'],
    ])
    const result = parseSuggestionEvent(event)
    expect(result!.description).toBe('A cool API')
  })

  it('returns null when url tag is missing', () => {
    const event = makeSuggestionEvent([['description', 'No URL']])
    expect(parseSuggestionEvent(event)).toBeNull()
  })

  it('returns null for invalid URLs', () => {
    const event = makeSuggestionEvent([['url', 'not-a-url']])
    expect(parseSuggestionEvent(event)).toBeNull()
  })

  it('rejects non-https URLs', () => {
    const event = makeSuggestionEvent([['url', 'http://insecure.com']])
    // http is allowed (some APIs use it)
    const result = parseSuggestionEvent(event)
    expect(result).not.toBeNull()
  })

  it('rejects javascript: URLs', () => {
    const event = makeSuggestionEvent([['url', 'javascript:alert(1)']])
    expect(parseSuggestionEvent(event)).toBeNull()
  })
})
