import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  probeUrl,
  probeService,
  probeUrls,
  probeWellKnownX402,
  checkResponseSignals,
  parseL402Challenge,
  parseX402Challenge,
  parsePaymentChallenge,
  parseLnurlcashChallenge,
} from '../../src/channels/active-prober.js'

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(status: number, headers: Record<string, string>, body = ''): Response {
  let bodyConsumed = false
  return {
    status,
    headers: new Headers(headers),
    text: () => {
      bodyConsumed = true
      return Promise.resolve(body)
    },
    json: () => {
      bodyConsumed = true
      return Promise.resolve(body ? JSON.parse(body) : {})
    },
    ok: status >= 200 && status < 300,
  } as Response
}

function lnurlcashChallenge(request: unknown): string {
  return 'lnurlcashreq1' + Buffer.from(JSON.stringify(request), 'utf8').toString('base64url')
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

  it('detects L402 in multi-scheme header where Payment comes first', () => {
    const header = 'Payment scheme="hmac-sha256", intent_type="lightning", L402 macaroon="abc", invoice="lnbc1p"'
    const result = parseL402Challenge(header)
    expect(result).not.toBeNull()
    expect(result!.rail).toBe('l402')
  })
})

describe('parsePaymentChallenge', () => {
  it('detects IETF Payment from WWW-Authenticate header', () => {
    const header = 'Payment scheme="hmac-sha256", intent_type="lightning", amount="100", currency="SAT"'
    const result = parsePaymentChallenge(header)
    expect(result).not.toBeNull()
    expect(result!.rail).toBe('payment')
    expect(result!.params).toEqual(['lightning'])
    expect(result!.pricing).toEqual([{ capability: 'default', amount: 100, currency: 'sat' }])
  })

  it('extracts cashu intent type', () => {
    const header = 'Payment scheme="hmac-sha256", intent_type="cashu", amount="50", currency="SAT"'
    const result = parsePaymentChallenge(header)
    expect(result).not.toBeNull()
    expect(result!.params).toEqual(['cashu'])
  })

  it('extracts session intent type', () => {
    const header = 'Payment scheme="hmac-sha256", intent_type="session", amount="1000", currency="SAT"'
    const result = parsePaymentChallenge(header)
    expect(result).not.toBeNull()
    expect(result!.params).toEqual(['session'])
  })

  it('defaults to lightning when intent_type is absent', () => {
    const header = 'Payment scheme="hmac-sha256", amount="100", currency="SAT"'
    const result = parsePaymentChallenge(header)
    expect(result).not.toBeNull()
    expect(result!.params).toEqual(['lightning'])
  })

  it('handles pricing without currency (defaults to sats)', () => {
    const header = 'Payment scheme="hmac-sha256", intent_type="lightning", amount="50"'
    const result = parsePaymentChallenge(header)
    expect(result!.pricing).toEqual([{ capability: 'default', amount: 50, currency: 'sats' }])
  })

  it('skips pricing when amount is missing', () => {
    const header = 'Payment scheme="hmac-sha256", intent_type="lightning"'
    const result = parsePaymentChallenge(header)
    expect(result).not.toBeNull()
    expect(result!.pricing).toEqual([])
  })

  it('detects Payment in multi-scheme header after L402', () => {
    const header = 'L402 macaroon="abc", invoice="lnbc1p", Payment scheme="hmac-sha256", intent_type="lightning"'
    const result = parsePaymentChallenge(header)
    expect(result).not.toBeNull()
    expect(result!.rail).toBe('payment')
  })

  it('returns null for non-Payment headers', () => {
    expect(parsePaymentChallenge('Basic realm="api"')).toBeNull()
    expect(parsePaymentChallenge('L402 macaroon="abc"')).toBeNull()
    expect(parsePaymentChallenge('Bearer token="xyz"')).toBeNull()
  })
})

describe('parseLnurlcashChallenge', () => {
  it('detects the rail and the accepted mints from a payment request', () => {
    const result = parseLnurlcashChallenge(lnurlcashChallenge({ a: '100', u: 'sat', m: ['mint.example', 'mint2.example'] }))
    expect(result).not.toBeNull()
    expect(result!.rail).toBe('lnurlcash')
    expect(result!.params).toEqual(['mint.example', 'mint2.example'])
    expect(result!.pricing).toEqual([])
  })

  it('accepts the spelled-out mints key', () => {
    const result = parseLnurlcashChallenge(lnurlcashChallenge({ mints: ['mint.example'] }))
    expect(result!.params).toEqual(['mint.example'])
  })

  it('accepts mints nested under methodDetails', () => {
    const result = parseLnurlcashChallenge(lnurlcashChallenge({ methodDetails: { mints: ['mint.example'] } }))
    expect(result!.params).toEqual(['mint.example'])
  })

  it('reduces mint discovery URLs to bare hosts and drops duplicates', () => {
    const result = parseLnurlcashChallenge(lnurlcashChallenge({ m: ['https://mint.example/', 'mint.example'] }))
    expect(result!.params).toEqual(['mint.example'])
  })

  it('ignores non-string and oversized mint entries', () => {
    const result = parseLnurlcashChallenge(lnurlcashChallenge({ m: [42, '', 'x'.repeat(300), 'mint.example'] }))
    expect(result!.params).toEqual(['mint.example'])
  })

  it('caps the number of mints taken from an untrusted response', () => {
    const mints = Array.from({ length: 30 }, (_, i) => `mint${i}.example`)
    const result = parseLnurlcashChallenge(lnurlcashChallenge({ m: mints }))
    expect(result!.params).toHaveLength(20)
  })

  it('still reports the rail when the challenge cannot be decoded', () => {
    const result = parseLnurlcashChallenge('lnurlcashreq1not-valid-base64url-json')
    expect(result).not.toBeNull()
    expect(result!.rail).toBe('lnurlcash')
    expect(result!.params).toEqual([])
  })

  it('still reports the rail for a value without the request prefix', () => {
    const result = parseLnurlcashChallenge('lnurlw://mint.example/withdraw?k1=abc')
    expect(result).not.toBeNull()
    expect(result!.params).toEqual([])
  })

  it('returns null for an empty header', () => {
    expect(parseLnurlcashChallenge('')).toBeNull()
    expect(parseLnurlcashChallenge('   ')).toBeNull()
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

describe('checkResponseSignals', () => {
  it('detects via 402 status code', async () => {
    const resp = mockResponse(402, {
      'www-authenticate': 'L402 macaroon="abc", invoice="lnbc1p"',
    })
    const result = await checkResponseSignals('https://api.example.com', resp)
    expect(result).not.toBeNull()
    expect(result!.is402).toBe(true)
    expect(result!.detectionMethod).toBe('status-402')
    expect(result!.paymentMethods[0].rail).toBe('l402')
  })

  it('detects IETF Payment-only endpoint', async () => {
    const resp = mockResponse(402, {
      'www-authenticate': 'Payment scheme="hmac-sha256", intent_type="lightning", amount="100", currency="SAT"',
    })
    const result = await checkResponseSignals('https://api.example.com', resp)
    expect(result).not.toBeNull()
    expect(result!.is402).toBe(true)
    expect(result!.detectionMethod).toBe('ietf-payment')
    expect(result!.paymentMethods).toHaveLength(1)
    expect(result!.paymentMethods[0].rail).toBe('payment')
    expect(result!.paymentMethods[0].params).toEqual(['lightning'])
    expect(result!.pricing[0]).toEqual({ capability: 'default', amount: 100, currency: 'sat' })
  })

  it('detects dual-scheme endpoint (L402 + IETF Payment)', async () => {
    const resp = mockResponse(402, {
      'www-authenticate': 'L402 macaroon="abc", invoice="lnbc1p", Payment scheme="hmac-sha256", intent_type="lightning"',
    })
    const result = await checkResponseSignals('https://api.example.com', resp)
    expect(result).not.toBeNull()
    expect(result!.is402).toBe(true)
    expect(result!.detectionMethod).toBe('ietf-payment')
    expect(result!.paymentMethods).toHaveLength(2)
    expect(result!.paymentMethods[0].rail).toBe('l402')
    expect(result!.paymentMethods[1].rail).toBe('payment')
  })

  it('detects an lnurlcash endpoint from the X-LNURLcash header', async () => {
    const resp = mockResponse(402, {
      'x-lnurlcash': lnurlcashChallenge({ a: '100', u: 'sat', m: ['mint.example'] }),
    })
    const result = await checkResponseSignals('https://api.example.com', resp)
    expect(result).not.toBeNull()
    expect(result!.is402).toBe(true)
    expect(result!.detectionMethod).toBe('status-402')
    expect(result!.paymentMethods).toHaveLength(1)
    expect(result!.paymentMethods[0]).toEqual({ rail: 'lnurlcash', params: ['mint.example'] })
  })

  it('detects lnurlcash alongside L402 on the same response', async () => {
    const resp = mockResponse(402, {
      'www-authenticate': 'L402 macaroon="abc", invoice="lnbc1p"',
      'x-lnurlcash': lnurlcashChallenge({ m: ['mint.example'] }),
    })
    const result = await checkResponseSignals('https://api.example.com', resp)
    expect(result!.paymentMethods).toHaveLength(2)
    expect(result!.paymentMethods.map(m => m.rail)).toEqual(['l402', 'lnurlcash'])
  })

  it('detects via CORS expose headers', async () => {
    const resp = mockResponse(200, {
      'access-control-expose-headers': 'WWW-Authenticate, PAYMENT-REQUIRED',
    })
    const result = await checkResponseSignals('https://api.example.com', resp)
    expect(result).not.toBeNull()
    expect(result!.is402).toBe(true)
    expect(result!.detectionMethod).toBe('cors-headers')
  })

  it('detects via X-Payment-Methods header', async () => {
    const resp = mockResponse(200, { 'x-payment-methods': 'lightning' })
    const result = await checkResponseSignals('https://api.example.com', resp)
    expect(result).not.toBeNull()
    expect(result!.detectionMethod).toBe('payment-headers')
  })

  it('detects via X-Pricing header', async () => {
    const resp = mockResponse(200, { 'x-pricing': '100 sats' })
    const result = await checkResponseSignals('https://api.example.com', resp)
    expect(result).not.toBeNull()
    expect(result!.detectionMethod).toBe('payment-headers')
  })

  it('detects via Accept-Payment header', async () => {
    const resp = mockResponse(200, { 'accept-payment': 'lightning' })
    const result = await checkResponseSignals('https://api.example.com', resp)
    expect(result).not.toBeNull()
    expect(result!.detectionMethod).toBe('payment-headers')
  })

  it('detects via Link header pointing to payment manifest', async () => {
    const resp = mockResponse(200, {
      'link': '</.well-known/x402.json>; rel="payment"',
    })
    const result = await checkResponseSignals('https://api.example.com', resp)
    expect(result).not.toBeNull()
    expect(result!.detectionMethod).toBe('link-header')
  })

  it('detects via HTML meta tags', async () => {
    const html = '<html><head><meta name="x402" content="enabled"></head><body></body></html>'
    const resp = mockResponse(200, { 'content-type': 'text/html' }, html)
    const result = await checkResponseSignals('https://api.example.com', resp)
    expect(result).not.toBeNull()
    expect(result!.detectionMethod).toBe('html-meta')
  })

  it('detects l402 meta tag in HTML', async () => {
    const html = '<html><head><meta name="l402" content="lightning"></head></html>'
    const resp = mockResponse(200, { 'content-type': 'text/html' }, html)
    const result = await checkResponseSignals('https://api.example.com', resp)
    expect(result).not.toBeNull()
    expect(result!.detectionMethod).toBe('html-meta')
  })

  it('detects payment meta tag in HTML', async () => {
    const html = '<html><head><meta name="payment" content="l402"></head></html>'
    const resp = mockResponse(200, { 'content-type': 'text/html' }, html)
    const result = await checkResponseSignals('https://api.example.com', resp)
    expect(result).not.toBeNull()
    expect(result!.detectionMethod).toBe('html-meta')
  })

  it('returns null when no signals found', async () => {
    const resp = mockResponse(200, {})
    const result = await checkResponseSignals('https://api.example.com', resp)
    expect(result).toBeNull()
  })

  it('detects X-Payment in CORS expose headers', async () => {
    const resp = mockResponse(200, {
      'access-control-expose-headers': 'X-Payment',
    })
    const result = await checkResponseSignals('https://api.example.com', resp)
    expect(result).not.toBeNull()
    expect(result!.detectionMethod).toBe('cors-headers')
  })

  it('detects 402 status even without parseable headers', async () => {
    const resp = mockResponse(402, {})
    const result = await checkResponseSignals('https://api.example.com', resp)
    expect(result).not.toBeNull()
    expect(result!.is402).toBe(true)
    expect(result!.detectionMethod).toBe('status-402')
    expect(result!.paymentMethods[0].rail).toBe('l402')
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
    expect(result.detectionMethod).toBe('status-402')
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
    expect(result.detectionMethod).toBe('status-402')
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
    expect(result.detectionMethod).toBe('status-402')
  })

  it('detects service via CORS headers on 200 response', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        'access-control-expose-headers': 'WWW-Authenticate, PAYMENT-REQUIRED',
      }),
    )

    const result = await probeUrl('https://freemium.example.com')
    expect(result.is402).toBe(true)
    expect(result.detectionMethod).toBe('cors-headers')
  })

  it('returns is402 false for non-402 responses', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {}))
    const result = await probeUrl('https://free.example.com')
    expect(result.is402).toBe(false)
    expect(result.detectionMethod).toBeUndefined()
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
    expect(result!.detectionMethod).toBe('well-known-x402')
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
    expect(result.detectionMethod).toBe('status-402')
  })

  it('falls back to .well-known manifests when direct probe returns non-402', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, {})) // direct probe returns 200
      .mockResolvedValueOnce(mockResponse(404, {})) // .well-known/l402 returns 404
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
    expect(result.detectionMethod).toBe('well-known-x402')
  })

  it('tries common API paths for bare domains', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, {})) // root returns 200
      .mockResolvedValueOnce(mockResponse(404, {})) // .well-known/l402 returns 404
      .mockResolvedValueOnce(mockResponse(404, {})) // .well-known/x402.json returns 404
      .mockResolvedValueOnce( // /api returns 402
        mockResponse(402, {
          'www-authenticate': 'L402 macaroon="abc", invoice="lnbc1p"',
        }),
      )

    const result = await probeService('https://api.example.com/')
    expect(result.is402).toBe(true)
    expect(result.detectionMethod).toBe('api-path-probe')
  })
})

describe('probeUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('probes URLs in parallel batches', async () => {
    const urls = Array.from({ length: 5 }, (_, i) => `https://example${i}.com`)

    // Use URL-based mock to avoid ordering issues with parallel probing
    mockFetch.mockImplementation((url: string) => {
      const urlStr = String(url)
      // example2.com returns 402
      if (urlStr.startsWith('https://example2.com') && !urlStr.includes('.well-known')) {
        return Promise.resolve(
          mockResponse(402, { 'www-authenticate': 'L402 macaroon="a", invoice="lnbc1p"' }),
        )
      }
      // .well-known paths return 404
      if (urlStr.includes('.well-known')) {
        return Promise.resolve(mockResponse(404, {}))
      }
      // Everything else returns 200
      return Promise.resolve(mockResponse(200, {}))
    })

    const results = await probeUrls(urls, undefined, 5, 0)
    expect(results).toHaveLength(5)
    const found = results.filter(r => r.is402)
    expect(found.length).toBeGreaterThanOrEqual(1)
    // The example2.com hit should be detected via 402 status
    const example2 = results.find(r => r.url.includes('example2'))
    expect(example2).toBeDefined()
    expect(example2!.is402).toBe(true)
    expect(example2!.detectionMethod).toBe('status-402')
  })

  it('handles fetch errors gracefully', async () => {
    const urls = ['https://crash.example.com']
    // probeService catches errors in probeUrl, so this still produces a result
    mockFetch.mockRejectedValue(new Error('DNS_FAILED'))

    const results = await probeUrls(urls, undefined, 20, 0)
    expect(results).toHaveLength(1)
    expect(results[0].is402).toBe(false)
    // Error is captured in probeUrl's catch, not in the outer Promise.allSettled
    expect(results[0].error).toBeDefined()
  })

  it('respects concurrency parameter', async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://test${i}.com`)

    mockFetch.mockImplementation((url: string) => {
      const urlStr = String(url)
      if (urlStr.includes('.well-known')) {
        return Promise.resolve(mockResponse(404, {}))
      }
      return Promise.resolve(mockResponse(200, {}))
    })

    const results = await probeUrls(urls, undefined, 2, 0)
    expect(results).toHaveLength(6)
  })
})
