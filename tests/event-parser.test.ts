import { describe, it, expect } from 'vitest'
import type { NostrEvent } from 'nostr-tools/pure'
import { parseServiceEvent } from '../src/event-parser.js'

/** Minimal valid event skeleton — override fields as needed */
function makeEvent(overrides: Partial<NostrEvent> & { tags?: string[][] }): NostrEvent {
  return {
    id: 'aabbccdd',
    pubkey: 'deadbeef',
    created_at: 1700000000,
    kind: 31402,
    tags: overrides.tags ?? [],
    content: overrides.content ?? '{}',
    sig: '00',
    ...overrides,
  } as NostrEvent
}

describe('parseServiceEvent', () => {
  describe('required fields', () => {
    it('returns null when d tag is missing', () => {
      const event = makeEvent({ tags: [['name', 'My Service']] })
      expect(parseServiceEvent(event)).toBeNull()
    })

    it('returns null when name tag is missing', () => {
      const event = makeEvent({ tags: [['d', 'my-service']] })
      expect(parseServiceEvent(event)).toBeNull()
    })

    it('returns null when both d and name tags are missing', () => {
      const event = makeEvent({ tags: [] })
      expect(parseServiceEvent(event)).toBeNull()
    })
  })

  describe('complete event parsing', () => {
    it('parses a complete event correctly', () => {
      const event = makeEvent({
        pubkey: 'cafebabe',
        tags: [
          ['d', 'my-service'],
          ['name', 'My Service'],
          ['about', 'A paid API'],
          ['url', 'https://api.example.com'],
          ['pmi', 'l402'],
          ['price', 'basic', '100', 'SAT'],
          ['source', 'self'],
          ['status', 'active'],
          ['t', 'ai'],
        ],
        content: '{}',
      })

      const result = parseServiceEvent(event)
      expect(result).not.toBeNull()
      expect(result!.identifier).toBe('my-service')
      expect(result!.name).toBe('My Service')
      expect(result!.about).toBe('A paid API')
      expect(result!.urls).toEqual(['https://api.example.com'])
      expect(result!.paymentMethods).toEqual([{ rail: 'l402', params: [] }])
      expect(result!.pricing).toEqual([{ capability: 'basic', amount: 100, currency: 'SAT' }])
      expect(result!.source).toBe('self')
      expect(result!.status).toBe('active')
      expect(result!.pubkey).toBe('cafebabe')
      expect(result!.topics).toEqual(['ai'])
    })
  })

  describe('payment method (pmi) parsing', () => {
    it('parses an l402 pmi with no extra params', () => {
      const event = makeEvent({
        tags: [['d', 'svc'], ['name', 'Svc'], ['pmi', 'l402']],
      })
      const result = parseServiceEvent(event)
      expect(result!.paymentMethods).toEqual([{ rail: 'l402', params: [] }])
    })

    it('parses an x402 pmi with params', () => {
      const event = makeEvent({
        tags: [
          ['d', 'svc'],
          ['name', 'Svc'],
          ['pmi', 'x402', 'base-sepolia', 'USDC', '0xReceiverAddress'],
        ],
      })
      const result = parseServiceEvent(event)
      expect(result!.paymentMethods).toEqual([
        { rail: 'x402', params: ['base-sepolia', 'USDC', '0xReceiverAddress'] },
      ])
    })

    it('parses multiple payment rails', () => {
      const event = makeEvent({
        tags: [
          ['d', 'svc'],
          ['name', 'Svc'],
          ['pmi', 'l402'],
          ['pmi', 'cashu'],
          ['pmi', 'xcashu', 'some-param'],
        ],
      })
      const result = parseServiceEvent(event)
      expect(result!.paymentMethods).toHaveLength(3)
      expect(result!.paymentMethods[0]).toEqual({ rail: 'l402', params: [] })
      expect(result!.paymentMethods[1]).toEqual({ rail: 'cashu', params: [] })
      expect(result!.paymentMethods[2]).toEqual({ rail: 'xcashu', params: ['some-param'] })
    })

    it('ignores pmi tags with invalid rails', () => {
      const event = makeEvent({
        tags: [
          ['d', 'svc'],
          ['name', 'Svc'],
          ['pmi', 'lightning'],
          ['pmi', 'l402'],
        ],
      })
      const result = parseServiceEvent(event)
      expect(result!.paymentMethods).toHaveLength(1)
      expect(result!.paymentMethods[0].rail).toBe('l402')
    })
  })

  describe('price tag parsing', () => {
    it('parses multiple price tags', () => {
      const event = makeEvent({
        tags: [
          ['d', 'svc'],
          ['name', 'Svc'],
          ['price', 'basic', '100', 'SAT'],
          ['price', 'premium', '500', 'SAT'],
          ['price', 'query', '1', 'USD'],
        ],
      })
      const result = parseServiceEvent(event)
      expect(result!.pricing).toHaveLength(3)
      expect(result!.pricing[0]).toEqual({ capability: 'basic', amount: 100, currency: 'SAT' })
      expect(result!.pricing[1]).toEqual({ capability: 'premium', amount: 500, currency: 'SAT' })
      expect(result!.pricing[2]).toEqual({ capability: 'query', amount: 1, currency: 'USD' })
    })

    it('ignores price tags with invalid amounts', () => {
      const event = makeEvent({
        tags: [
          ['d', 'svc'],
          ['name', 'Svc'],
          ['price', 'basic', 'not-a-number', 'SAT'],
          ['price', 'valid', '50', 'SAT'],
        ],
      })
      const result = parseServiceEvent(event)
      expect(result!.pricing).toHaveLength(1)
      expect(result!.pricing[0].capability).toBe('valid')
    })

    it('ignores price tags with fewer than 4 elements', () => {
      const event = makeEvent({
        tags: [
          ['d', 'svc'],
          ['name', 'Svc'],
          ['price', 'basic', '100'],
        ],
      })
      const result = parseServiceEvent(event)
      expect(result!.pricing).toHaveLength(0)
    })
  })

  describe('url parsing', () => {
    it('parses multiple url tags', () => {
      const event = makeEvent({
        tags: [
          ['d', 'svc'],
          ['name', 'Svc'],
          ['url', 'https://api1.example.com'],
          ['url', 'https://api2.example.com'],
        ],
      })
      const result = parseServiceEvent(event)
      expect(result!.urls).toEqual([
        'https://api1.example.com',
        'https://api2.example.com',
      ])
    })

    it('returns empty urls array when no url tags present', () => {
      const event = makeEvent({ tags: [['d', 'svc'], ['name', 'Svc']] })
      const result = parseServiceEvent(event)
      expect(result!.urls).toEqual([])
    })
  })

  describe('defaults', () => {
    it('defaults source to self when tag is absent', () => {
      const event = makeEvent({ tags: [['d', 'svc'], ['name', 'Svc']] })
      const result = parseServiceEvent(event)
      expect(result!.source).toBe('self')
    })

    it('defaults source to self when tag value is invalid', () => {
      const event = makeEvent({
        tags: [['d', 'svc'], ['name', 'Svc'], ['source', 'unknown']],
      })
      const result = parseServiceEvent(event)
      expect(result!.source).toBe('self')
    })

    it('defaults status to active when tag is absent', () => {
      const event = makeEvent({ tags: [['d', 'svc'], ['name', 'Svc']] })
      const result = parseServiceEvent(event)
      expect(result!.status).toBe('active')
    })

    it('defaults status to active when tag value is invalid', () => {
      const event = makeEvent({
        tags: [['d', 'svc'], ['name', 'Svc'], ['status', 'deleted']],
      })
      const result = parseServiceEvent(event)
      expect(result!.status).toBe('active')
    })

    it('defaults about to empty string when tag is absent', () => {
      const event = makeEvent({ tags: [['d', 'svc'], ['name', 'Svc']] })
      const result = parseServiceEvent(event)
      expect(result!.about).toBe('')
    })
  })

  describe('optional fields', () => {
    it('parses a valid source tag', () => {
      const event = makeEvent({
        tags: [['d', 'svc'], ['name', 'Svc'], ['source', 'crawl']],
      })
      const result = parseServiceEvent(event)
      expect(result!.source).toBe('crawl')
    })

    it('parses a valid status tag', () => {
      const event = makeEvent({
        tags: [['d', 'svc'], ['name', 'Svc'], ['status', 'stale']],
      })
      const result = parseServiceEvent(event)
      expect(result!.status).toBe('stale')
    })

    it('parses verified tag', () => {
      const event = makeEvent({
        tags: [
          ['d', 'svc'],
          ['name', 'Svc'],
          ['verified', '2024-01-01T00:00:00Z'],
        ],
      })
      const result = parseServiceEvent(event)
      expect(result!.verified).toBe('2024-01-01T00:00:00Z')
    })

    it('leaves verified undefined when absent', () => {
      const event = makeEvent({ tags: [['d', 'svc'], ['name', 'Svc']] })
      const result = parseServiceEvent(event)
      expect(result!.verified).toBeUndefined()
    })

    it('parses topic tags', () => {
      const event = makeEvent({
        tags: [
          ['d', 'svc'],
          ['name', 'Svc'],
          ['t', 'ai'],
          ['t', 'llm'],
          ['t', 'image'],
        ],
      })
      const result = parseServiceEvent(event)
      expect(result!.topics).toEqual(['ai', 'llm', 'image'])
    })

    it('leaves topics undefined when no t tags present', () => {
      const event = makeEvent({ tags: [['d', 'svc'], ['name', 'Svc']] })
      const result = parseServiceEvent(event)
      expect(result!.topics).toBeUndefined()
    })

    it('includes the pubkey from the event', () => {
      const event = makeEvent({ pubkey: 'mypubkey123', tags: [['d', 'svc'], ['name', 'Svc']] })
      const result = parseServiceEvent(event)
      expect(result!.pubkey).toBe('mypubkey123')
    })
  })

  describe('capabilities from content', () => {
    it('parses capabilities array from content JSON', () => {
      const event = makeEvent({
        tags: [['d', 'svc'], ['name', 'Svc']],
        content: JSON.stringify({ capabilities: ['image-generation', 'text-to-speech'] }),
      })
      const result = parseServiceEvent(event)
      expect(result!.capabilities).toEqual(['image-generation', 'text-to-speech'])
    })

    it('leaves capabilities undefined when content has no capabilities key', () => {
      const event = makeEvent({
        tags: [['d', 'svc'], ['name', 'Svc']],
        content: JSON.stringify({ other: 'data' }),
      })
      const result = parseServiceEvent(event)
      expect(result!.capabilities).toBeUndefined()
    })

    it('leaves capabilities undefined when capabilities is not an array', () => {
      const event = makeEvent({
        tags: [['d', 'svc'], ['name', 'Svc']],
        content: JSON.stringify({ capabilities: 'not-an-array' }),
      })
      const result = parseServiceEvent(event)
      expect(result!.capabilities).toBeUndefined()
    })

    it('gracefully handles invalid content JSON', () => {
      const event = makeEvent({
        tags: [['d', 'svc'], ['name', 'Svc']],
        content: 'not valid json {{{',
      })
      const result = parseServiceEvent(event)
      expect(result).not.toBeNull()
      expect(result!.capabilities).toBeUndefined()
    })

    it('gracefully handles empty content string', () => {
      const event = makeEvent({
        tags: [['d', 'svc'], ['name', 'Svc']],
        content: '',
      })
      const result = parseServiceEvent(event)
      expect(result).not.toBeNull()
      expect(result!.capabilities).toBeUndefined()
    })
  })
})
