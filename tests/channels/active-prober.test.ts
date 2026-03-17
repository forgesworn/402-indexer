import { describe, it, expect, vi, beforeEach } from 'vitest'
import { probeUrl, probeService, probeWellKnownX402, parseL402Challenge, parseX402Challenge } from '../../src/channels/active-prober.js'

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(status: number, headers: Record<string, string>, body = ''): Response {
  return {
    status,
    headers: new Headers(headers),
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(body ? JSON.parse(body) : {}),
    ok: status >= 200 && status < 300,
  } as Response
}

describe('parseL402Challenge', () => {
  it('detects L402 from WWW-Authenticate header', () => {
    const result = parseL402Challenge('L402 macaroon="abc123", invoice="lnbc1..."')
    expect(result).not.toBeNull()
    expect(result!.rail).toBe('l402')
  })

  it('detects LSAT from WWW-Authenticate header', () => {
    const result = parseL402Challenge('LSAT macaroon="abc123", invoice="lnbc1..."')
    expect(result).not.toBeNull()
    expect(result!.rail).toBe('l402')
  })

  it('returns null for non-L402 headers', () => {
    expect(parseL402Challenge('Basic realm="api"')).toBeNull()
    expect(parseL402Challenge('Bearer')).toBeNull()
  })
})

describe('parseX402Challenge', () => {
  it('detects x402 from X-Payment-Required header', () => {
    const body = JSON.stringify({
      x402: {
        receiver: '0xabc',
        network: 'base',
        asset: 'usdc',
        amount_usd: 1,
      },
    })
    const result = parseX402Challenge('x402', body)
    expect(result).not.toBeNull()
    expect(result!.rail).toBe('x402')
    expect(result!.params).toEqual(['base', 'usdc', '0xabc'])
    expect(result!.pricing).toEqual([{ capability: 'default', amount: 1, currency: 'usd' }])
  })

  it('returns null when body has no x402 field', () => {
    expect(parseX402Challenge('x402', '{}')).toBeNull()
  })
})

describe('probeUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detects L402 service from 402 response', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(402, {
        'www-authenticate': 'L402 macaroon="abc", invoice="lnbc1ptest"',
      }),
    )

    const result = await probeUrl('https://api.example.com/test')
    expect(result.is402).toBe(true)
    expect(result.paymentMethods[0].rail).toBe('l402')
  })

  it('detects x402 service from 402 response', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(
        402,
        { 'x-payment-required': 'x402' },
        JSON.stringify({
          x402: { receiver: '0xabc', network: 'base', asset: 'usdc', amount_usd: 1 },
        }),
      ),
    )

    const result = await probeUrl('https://x402.example.com/test')
    expect(result.is402).toBe(true)
    expect(result.paymentMethods[0].rail).toBe('x402')
  })

  it('detects multi-rail service (L402 + x402)', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(
        402,
        {
          'www-authenticate': 'L402 macaroon="abc", invoice="lnbc1p"',
          'x-payment-required': 'x402',
        },
        JSON.stringify({
          x402: { receiver: '0xdef', network: 'base', asset: 'usdc', amount_usd: 2 },
        }),
      ),
    )

    const result = await probeUrl('https://multi.example.com')
    expect(result.is402).toBe(true)
    expect(result.paymentMethods).toHaveLength(2)
  })

  it('returns is402 false for non-402 responses', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {}))
    const result = await probeUrl('https://free.example.com')
    expect(result.is402).toBe(false)
  })

  it('handles network errors', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await probeUrl('https://down.example.com')
    expect(result.is402).toBe(false)
    expect(result.error).toBe('ECONNREFUSED')
  })

  it('sends correct user agent', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {}))
    await probeUrl('https://api.example.com', '402-indexer/1.0 (+https://402.pub)')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': '402-indexer/1.0 (+https://402.pub)',
        }),
      }),
    )
  })
})

describe('probeWellKnownX402', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detects x402 service from .well-known/x402.json manifest', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { 'content-type': 'application/json' }, JSON.stringify({
        resources: [{
          url: 'https://api.example.com/chat',
          price: 0.01,
          network: 'base',
          asset: 'usdc',
          receiver: '0xabc123',
          description: 'AI chat endpoint',
        }],
      })),
    )

    const result = await probeWellKnownX402('https://api.example.com')
    expect(result).not.toBeNull()
    expect(result!.is402).toBe(true)
    expect(result!.paymentMethods[0].rail).toBe('x402')
    expect(result!.paymentMethods[0].params).toEqual(['base', 'usdc', '0xabc123'])
    expect(result!.pricing[0].amount).toBe(0.01)
  })

  it('returns null when manifest does not exist', async () => {
    mockFetch.mockResolvedValue(mockResponse(404, {}))
    const result = await probeWellKnownX402('https://no-manifest.com')
    expect(result).toBeNull()
  })

  it('returns null when manifest has no resources', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, {}, JSON.stringify({ resources: [] })),
    )
    const result = await probeWellKnownX402('https://empty.com')
    expect(result).toBeNull()
  })
})

describe('probeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns direct probe result when URL returns 402', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(402, {
        'www-authenticate': 'L402 macaroon="abc", invoice="lnbc1ptest"',
      }),
    )

    const result = await probeService('https://api.example.com/endpoint')
    expect(result.is402).toBe(true)
    expect(result.paymentMethods[0].rail).toBe('l402')
  })

  it('falls back to .well-known/x402.json when direct probe returns non-402', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, {})) // direct probe returns 200
      .mockResolvedValueOnce( // .well-known/x402.json returns manifest
        mockResponse(200, {}, JSON.stringify({
          resources: [{
            url: 'https://api.example.com/paid',
            price: 0.05,
            network: 'base',
            asset: 'usdc',
            receiver: '0xdef456',
          }],
        })),
      )

    const result = await probeService('https://api.example.com/')
    expect(result.is402).toBe(true)
    expect(result.paymentMethods[0].rail).toBe('x402')
  })

  it('tries common API paths for bare domains', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, {})) // root returns 200
      .mockResolvedValueOnce(mockResponse(404, {})) // .well-known returns 404
      .mockResolvedValueOnce( // /api returns 402
        mockResponse(402, {
          'www-authenticate': 'L402 macaroon="abc", invoice="lnbc1p"',
        }),
      )

    const result = await probeService('https://api.example.com/')
    expect(result.is402).toBe(true)
  })
})
