import { describe, it, expect } from 'vitest'
import { generateSecretKey } from 'nostr-tools/pure'
import { bytesToHex } from 'nostr-tools/utils'
import { buildServiceEvent } from '../../src/publisher/event-builder.js'
import { parseServiceEvent } from '../../src/event-parser.js'
import type { DiscoveredService } from '../../src/types.js'
import { KIND_SERVICE_ANNOUNCEMENT } from '../../src/types.js'

function makeSecretKeyHex(): string {
  return bytesToHex(generateSecretKey())
}

/** Minimal valid DiscoveredService */
function makeService(overrides: Partial<DiscoveredService> = {}): DiscoveredService {
  return {
    identifier: 'test-service',
    name: 'Test Service',
    about: 'A test API',
    urls: ['https://api.example.com'],
    paymentMethods: [{ rail: 'l402', params: [] }],
    pricing: [{ capability: 'basic', amount: 100, currency: 'SAT' }],
    source: 'self',
    status: 'active',
    ...overrides,
  }
}

describe('buildServiceEvent', () => {
  describe('event shape', () => {
    it('produces a kind 31402 event', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService())
      expect(event.kind).toBe(KIND_SERVICE_ANNOUNCEMENT)
      expect(event.kind).toBe(31402)
    })

    it('has a valid signature (verifyEvent passes)', async () => {
      const { verifyEvent } = await import('nostr-tools/pure')
      const event = buildServiceEvent(makeSecretKeyHex(), makeService())
      expect(verifyEvent(event)).toBe(true)
    })

    it('sets created_at to a recent unix timestamp', () => {
      const before = Math.floor(Date.now() / 1000)
      const event = buildServiceEvent(makeSecretKeyHex(), makeService())
      const after = Math.floor(Date.now() / 1000)
      expect(event.created_at).toBeGreaterThanOrEqual(before)
      expect(event.created_at).toBeLessThanOrEqual(after)
    })

    it('sets pubkey to the derived public key', () => {
      const sk = generateSecretKey()
      const skHex = bytesToHex(sk)
      const event = buildServiceEvent(skHex, makeService())
      expect(event.pubkey).toHaveLength(64)
      expect(event.pubkey).toMatch(/^[0-9a-f]+$/)
    })
  })

  describe('required tags', () => {
    it('includes d tag with the identifier', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({ identifier: 'my-api' }))
      const dTag = event.tags.find(t => t[0] === 'd')
      expect(dTag).toEqual(['d', 'my-api'])
    })

    it('includes name tag', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({ name: 'My API' }))
      const nameTag = event.tags.find(t => t[0] === 'name')
      expect(nameTag).toEqual(['name', 'My API'])
    })

    it('includes about tag', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({ about: 'Description here' }))
      const aboutTag = event.tags.find(t => t[0] === 'about')
      expect(aboutTag).toEqual(['about', 'Description here'])
    })
  })

  describe('url tags', () => {
    it('includes a url tag for each URL', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({
        urls: ['https://api1.example.com', 'https://api2.example.com'],
      }))
      const urlTags = event.tags.filter(t => t[0] === 'url')
      expect(urlTags).toEqual([
        ['url', 'https://api1.example.com'],
        ['url', 'https://api2.example.com'],
      ])
    })

    it('includes no url tags when urls array is empty', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({ urls: [] }))
      const urlTags = event.tags.filter(t => t[0] === 'url')
      expect(urlTags).toHaveLength(0)
    })
  })

  describe('pmi tags', () => {
    it('includes a pmi tag for l402 with no extra params', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({
        paymentMethods: [{ rail: 'l402', params: [] }],
      }))
      const pmiTags = event.tags.filter(t => t[0] === 'pmi')
      expect(pmiTags).toEqual([['pmi', 'l402']])
    })

    it('includes a pmi tag for x402 with params', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({
        paymentMethods: [
          { rail: 'x402', params: ['base-sepolia', 'USDC', '0xReceiver'] },
        ],
      }))
      const pmiTags = event.tags.filter(t => t[0] === 'pmi')
      expect(pmiTags).toEqual([['pmi', 'x402', 'base-sepolia', 'USDC', '0xReceiver']])
    })

    it('includes multiple pmi tags for multiple payment methods', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({
        paymentMethods: [
          { rail: 'l402', params: [] },
          { rail: 'cashu', params: [] },
        ],
      }))
      const pmiTags = event.tags.filter(t => t[0] === 'pmi')
      expect(pmiTags).toHaveLength(2)
      expect(pmiTags[0]).toEqual(['pmi', 'l402'])
      expect(pmiTags[1]).toEqual(['pmi', 'cashu'])
    })
  })

  describe('price tags', () => {
    it('includes a price tag for each pricing entry', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({
        pricing: [
          { capability: 'basic', amount: 100, currency: 'SAT' },
          { capability: 'premium', amount: 500, currency: 'SAT' },
        ],
      }))
      const priceTags = event.tags.filter(t => t[0] === 'price')
      expect(priceTags).toEqual([
        ['price', 'basic', '100', 'SAT'],
        ['price', 'premium', '500', 'SAT'],
      ])
    })
  })

  describe('source, verified and status tags', () => {
    it('includes a source tag', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({ source: 'crawl' }))
      const sourceTag = event.tags.find(t => t[0] === 'source')
      expect(sourceTag).toEqual(['source', 'crawl'])
    })

    it('includes a status tag', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({ status: 'stale' }))
      const statusTag = event.tags.find(t => t[0] === 'status')
      expect(statusTag).toEqual(['status', 'stale'])
    })

    it('includes a verified tag when provided', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({
        verified: '2024-06-01T12:00:00Z',
      }))
      const verifiedTag = event.tags.find(t => t[0] === 'verified')
      expect(verifiedTag).toEqual(['verified', '2024-06-01T12:00:00Z'])
    })

    it('omits verified tag when not provided', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({ verified: undefined }))
      const verifiedTag = event.tags.find(t => t[0] === 'verified')
      expect(verifiedTag).toBeUndefined()
    })
  })

  describe('topic tags', () => {
    it('includes t tags for each topic', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({
        topics: ['ai', 'llm', 'image'],
      }))
      const tTags = event.tags.filter(t => t[0] === 't')
      expect(tTags).toEqual([['t', 'ai'], ['t', 'llm'], ['t', 'image']])
    })

    it('omits t tags when topics is undefined', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({ topics: undefined }))
      const tTags = event.tags.filter(t => t[0] === 't')
      expect(tTags).toHaveLength(0)
    })

    it('omits t tags when topics is an empty array', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({ topics: [] }))
      const tTags = event.tags.filter(t => t[0] === 't')
      expect(tTags).toHaveLength(0)
    })
  })

  describe('content field', () => {
    it('encodes capabilities in content JSON when provided', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({
        capabilities: ['image-generation', 'transcription'],
      }))
      const parsed = JSON.parse(event.content) as Record<string, unknown>
      expect(parsed['capabilities']).toEqual(['image-generation', 'transcription'])
    })

    it('produces empty object content when no capabilities', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({ capabilities: undefined }))
      expect(event.content).toBe('{}')
    })

    it('produces empty object content when capabilities is empty array', () => {
      const event = buildServiceEvent(makeSecretKeyHex(), makeService({ capabilities: [] }))
      expect(event.content).toBe('{}')
    })
  })

  describe('roundtrip: build → parse', () => {
    it('parses back to an equivalent DiscoveredService', () => {
      const service: DiscoveredService = {
        identifier: 'roundtrip-service',
        name: 'Roundtrip Service',
        about: 'Tests roundtrip fidelity',
        urls: ['https://rt.example.com', 'https://rt2.example.com'],
        paymentMethods: [
          { rail: 'l402', params: [] },
          { rail: 'x402', params: ['base', 'USDC', '0xABC'] },
        ],
        pricing: [
          { capability: 'search', amount: 50, currency: 'SAT' },
          { capability: 'generate', amount: 200, currency: 'SAT' },
        ],
        source: 'github',
        verified: '2025-01-15T08:00:00Z',
        status: 'active',
        topics: ['ai', 'search'],
        capabilities: ['full-text-search', 'semantic-search'],
      }

      const event = buildServiceEvent(makeSecretKeyHex(), service)
      const parsed = parseServiceEvent(event)

      expect(parsed).not.toBeNull()
      expect(parsed!.identifier).toBe(service.identifier)
      expect(parsed!.name).toBe(service.name)
      expect(parsed!.about).toBe(service.about)
      expect(parsed!.urls).toEqual(service.urls)
      expect(parsed!.paymentMethods).toEqual(service.paymentMethods)
      expect(parsed!.pricing).toEqual(service.pricing)
      expect(parsed!.source).toBe(service.source)
      expect(parsed!.verified).toBe(service.verified)
      expect(parsed!.status).toBe(service.status)
      expect(parsed!.topics).toEqual(service.topics)
      expect(parsed!.capabilities).toEqual(service.capabilities)
    })

    it('roundtrip preserves minimal service', () => {
      const service: DiscoveredService = {
        identifier: 'minimal',
        name: 'Minimal Service',
        about: '',
        urls: [],
        paymentMethods: [],
        pricing: [],
        source: 'self',
        status: 'active',
      }

      const event = buildServiceEvent(makeSecretKeyHex(), service)
      const parsed = parseServiceEvent(event)

      expect(parsed).not.toBeNull()
      expect(parsed!.identifier).toBe('minimal')
      expect(parsed!.name).toBe('Minimal Service')
      expect(parsed!.about).toBe('')
      expect(parsed!.urls).toEqual([])
      expect(parsed!.paymentMethods).toEqual([])
      expect(parsed!.pricing).toEqual([])
      expect(parsed!.source).toBe('self')
      expect(parsed!.status).toBe('active')
      expect(parsed!.topics).toBeUndefined()
      expect(parsed!.capabilities).toBeUndefined()
    })
  })
})
