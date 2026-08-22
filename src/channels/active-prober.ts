import type { DetectionMethod, PaymentMethod, PricingEntry, ProbeResult } from '../types.js'

const DEFAULT_USER_AGENT = '402-indexer/1.0 (+https://402.pub)'
const PROBE_TIMEOUT_MS = 15_000
const COMMON_API_PATHS = ['/api', '/v1', '/api/v1']

/**
 * Parse an L402/LSAT challenge from a WWW-Authenticate header.
 * Supports multi-scheme headers (RFC 7235) where L402/LSAT may not be first.
 */
export function parseL402Challenge(
  header: string,
): { rail: 'l402'; params: string[]; pricing: PricingEntry[] } | null {
  const match = header.match(/(?:^|,\s*)(L402|LSAT)\s+/i)
  if (!match) return null

  // Extract invoice to try to determine price (best-effort)
  // Full BOLT-11 decoding is out of scope for the indexer — we just detect the rail
  return {
    rail: 'l402',
    params: ['lightning'],
    pricing: [],
  }
}

/**
 * Parse an IETF Payment challenge from a WWW-Authenticate header.
 * Detects the HTTP Authentication Payment scheme (draft-ryan-httpauth-payment).
 * Supports multi-scheme headers where Payment may appear alongside L402.
 */
export function parsePaymentChallenge(
  header: string,
): { rail: 'payment'; params: string[]; pricing: PricingEntry[] } | null {
  // Match 'Payment' as an auth scheme — may appear after other schemes in the header
  const match = header.match(/(?:^|,\s*)Payment\s+/i)
  if (!match) return null

  // Extract intent_type — determines the underlying payment rail
  const intentMatch = header.match(/intent_type="([^"]+)"/i)
  const intentType = intentMatch?.[1] ?? 'lightning'

  // Extract pricing from challenge parameters (best-effort)
  const pricing: PricingEntry[] = []
  const amountMatch = header.match(/amount="([^"]+)"/i)
  const currencyMatch = header.match(/currency="([^"]+)"/i)
  if (amountMatch) {
    const amount = parseFloat(amountMatch[1])
    if (Number.isFinite(amount) && amount > 0) {
      pricing.push({
        capability: 'default',
        amount,
        currency: currencyMatch?.[1]?.toLowerCase() ?? 'sats',
      })
    }
  }

  return {
    rail: 'payment',
    params: [intentType],
    pricing,
  }
}

/** Prefix of an LNURLcash payment request carried in an X-LNURLcash challenge. */
const LNURLCASH_REQUEST_PREFIX = 'lnurlcashreq1'

/** Guard rails on values taken from an untrusted 402 response. */
const MAX_MINT_HOSTS = 20
const MAX_MINT_HOST_LENGTH = 256

/** Reduce a mint entry to a bare host so it matches how announcements list mints. */
function normaliseMintHost(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let host = value.trim()
  if (host.length === 0 || host.length > MAX_MINT_HOST_LENGTH) return null
  if (/[\u0000-\u001f\u007f]/.test(host)) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
    try {
      host = new URL(host).host
    } catch {
      return null
    }
  }
  host = host.replace(/\/+$/, '')
  return host.length > 0 ? host : null
}

/** Pull the accepted mint hosts out of a decoded LNURLcash request object. */
function mintsFromRequest(request: unknown): string[] {
  if (typeof request !== 'object' || request === null) return []
  const record = request as Record<string, unknown>
  const details = record.methodDetails as Record<string, unknown> | undefined
  // 'm' is the compact wire key; 'mints' and 'methodDetails.mints' are the
  // spelled-out forms, accepted so a challenge from either shape still indexes.
  const candidate = record.m ?? record.mints ?? (typeof details === 'object' && details !== null ? details.mints : undefined)
  if (!Array.isArray(candidate)) return []
  const hosts: string[] = []
  for (const entry of candidate) {
    const host = normaliseMintHost(entry)
    if (host && !hosts.includes(host)) hosts.push(host)
    if (hosts.length >= MAX_MINT_HOSTS) break
  }
  return hosts
}

/**
 * Parse an LNURLcash challenge from an X-LNURLcash header.
 * The value is a payment request: the 'lnurlcashreq1' prefix followed by
 * base64url JSON naming the mints whose bearer notes the service accepts.
 * The header alone is enough to detect the rail; the mints are best-effort,
 * and the price is left to the announcement rather than guessed here.
 */
export function parseLnurlcashChallenge(
  headerValue: string,
): { rail: 'lnurlcash'; params: string[]; pricing: PricingEntry[] } | null {
  const value = headerValue.trim()
  if (value.length === 0) return null

  let params: string[] = []
  if (value.toLowerCase().startsWith(LNURLCASH_REQUEST_PREFIX)) {
    const encoded = value.slice(LNURLCASH_REQUEST_PREFIX.length)
    try {
      const json = Buffer.from(encoded, 'base64url').toString('utf8')
      params = mintsFromRequest(JSON.parse(json))
    } catch {
      // An undecodable challenge still tells us the rail is on offer
      params = []
    }
  }

  return { rail: 'lnurlcash', params, pricing: [] }
}

/**
 * Parse an x402 challenge from response headers and body.
 */
export function parseX402Challenge(
  headerValue: string,
  body: string,
): { rail: 'x402'; params: string[]; pricing: PricingEntry[] } | null {
  if (!headerValue.toLowerCase().includes('x402')) return null

  try {
    const parsed = JSON.parse(body)
    const x402 = parsed?.x402
    if (!x402?.receiver || !x402?.network) return null

    const pricing: PricingEntry[] = []
    if (typeof x402.amount_usd === 'number') {
      pricing.push({ capability: 'default', amount: x402.amount_usd, currency: 'usd' })
    }

    return {
      rail: 'x402',
      params: [x402.network, x402.asset ?? 'usdc', x402.receiver],
      pricing,
    }
  } catch {
    return null
  }
}

/**
 * Check a single response for ALL 402 signals in one pass.
 * Returns the first detection or null if no signals found.
 */
export async function checkResponseSignals(
  url: string,
  response: Response,
): Promise<ProbeResult | null> {
  const paymentMethods: PaymentMethod[] = []
  const pricing: PricingEntry[] = []
  let detectionMethod: DetectionMethod | undefined

  // Signal 1: HTTP 402 status with L402/x402 headers
  if (response.status === 402) {
    detectionMethod = 'status-402'

    const wwwAuth = response.headers.get('www-authenticate')
    if (wwwAuth) {
      // Check for L402/LSAT scheme
      const l402 = parseL402Challenge(wwwAuth)
      if (l402) {
        paymentMethods.push({ rail: l402.rail, params: l402.params })
        pricing.push(...l402.pricing)
      }

      // Check for IETF Payment scheme (draft-ryan-httpauth-payment)
      const payment = parsePaymentChallenge(wwwAuth)
      if (payment) {
        paymentMethods.push({ rail: payment.rail, params: payment.params })
        pricing.push(...payment.pricing)
        detectionMethod = 'ietf-payment'
      }
    }

    const xLnurlcash = response.headers.get('x-lnurlcash')
    if (xLnurlcash) {
      const lnurlcash = parseLnurlcashChallenge(xLnurlcash)
      if (lnurlcash) {
        paymentMethods.push({ rail: lnurlcash.rail, params: lnurlcash.params })
        pricing.push(...lnurlcash.pricing)
      }
    }

    const xPayment = response.headers.get('x-payment-required')
    if (xPayment) {
      const body = await response.text()
      const x402 = parseX402Challenge(xPayment, body)
      if (x402) {
        paymentMethods.push({ rail: x402.rail, params: x402.params })
        pricing.push(...x402.pricing)
      }
    }

    // Even without parseable headers, a 402 status is a strong signal
    if (paymentMethods.length === 0) {
      paymentMethods.push({ rail: 'l402', params: ['lightning'] })
    }

    return { url, is402: true, paymentMethods, pricing, statusCode: 402, detectionMethod }
  }

  // Signal 2: CORS headers exposing payment capability
  const corsExpose = response.headers.get('access-control-expose-headers') ?? ''
  const corsAllow = response.headers.get('access-control-allow-headers') ?? ''
  const allCors = `${corsExpose} ${corsAllow}`.toLowerCase()
  if (/www-authenticate|payment-required|x-payment/i.test(allCors)) {
    // Determine rail from CORS header signals:
    // X-Payment, X-Payment-Required, PAYMENT-REQUIRED → x402
    // WWW-Authenticate alone → l402
    // Both → both rails
    const hasX402Signal = /x-payment|payment-required|payment-response/i.test(allCors)
    const hasL402Signal = /www-authenticate/i.test(allCors)
    const methods: PaymentMethod[] = []
    if (hasX402Signal) methods.push({ rail: 'x402', params: [] })
    if (hasL402Signal) methods.push({ rail: 'l402', params: ['lightning'] })
    if (methods.length === 0) methods.push({ rail: 'l402', params: ['lightning'] })

    return {
      url,
      is402: true,
      paymentMethods: methods,
      pricing: [],
      statusCode: response.status,
      detectionMethod: 'cors-headers',
    }
  }

  // Signal 3: Payment-related response headers on any status
  const xPaymentMethods = response.headers.get('x-payment-methods')
  const xPricing = response.headers.get('x-pricing')
  const acceptPayment = response.headers.get('accept-payment')
  if (xPaymentMethods || xPricing || acceptPayment) {
    // Infer rail from header names — X-Payment-* is x402 convention
    const rail = xPaymentMethods ? 'x402' as const : 'l402' as const
    return {
      url,
      is402: true,
      paymentMethods: [{ rail, params: rail === 'l402' ? ['lightning'] : [] }],
      pricing: [],
      statusCode: response.status,
      detectionMethod: 'payment-headers',
    }
  }

  // Signal 4: Link header pointing to payment manifest
  const linkHeader = response.headers.get('link') ?? ''
  if (/\.well-known\/x402\.json|\.well-known\/l402/.test(linkHeader) && /rel="?payment"?/.test(linkHeader)) {
    return {
      url,
      is402: true,
      paymentMethods: [{ rail: 'l402' as const, params: ['lightning'] }],
      pricing: [],
      statusCode: response.status,
      detectionMethod: 'link-header',
    }
  }

  // Signal 5: HTML meta tags for payment in HTML responses
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/html')) {
    // Read first 4KB of HTML — enough for <head> meta tags
    const body = await response.text()
    const head = body.slice(0, 4096)
    if (/<meta\s[^>]*name=["'](x402|l402|payment)["']/i.test(head)) {
      return {
        url,
        is402: true,
        paymentMethods: [{ rail: 'l402' as const, params: ['lightning'] }],
        pricing: [],
        statusCode: response.status,
        detectionMethod: 'html-meta',
      }
    }
  }

  return null
}

/**
 * Probe a URL for L402/x402 payment challenges via multiple signals.
 */
export async function probeUrl(
  url: string,
  userAgent: string = DEFAULT_USER_AGENT,
): Promise<ProbeResult> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

    const response = await fetch(url, {
      headers: { 'User-Agent': userAgent },
      signal: controller.signal,
      redirect: 'follow',
    })
    clearTimeout(timeout)

    const signalResult = await checkResponseSignals(url, response)
    if (signalResult) return signalResult

    return { url, is402: false, paymentMethods: [], pricing: [], statusCode: response.status }
  } catch (err) {
    return {
      url,
      is402: false,
      paymentMethods: [],
      pricing: [],
      statusCode: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** x402 manifest at .well-known/x402.json */
export interface X402Manifest {
  resources?: {
    url?: string
    price?: number | string
    network?: string
    asset?: string
    receiver?: string
    description?: string
  }[]
}

/**
 * Parse a .well-known/x402.json manifest to extract payment info.
 * Returns a ProbeResult if the manifest exists and is valid.
 */
export async function probeWellKnownX402(
  baseUrl: string,
  userAgent: string = DEFAULT_USER_AGENT,
): Promise<ProbeResult | null> {
  try {
    const origin = new URL(baseUrl).origin
    const manifestUrl = `${origin}/.well-known/x402.json`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

    const response = await fetch(manifestUrl, {
      headers: { 'User-Agent': userAgent },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!response.ok) return null

    const manifest = await response.json() as X402Manifest
    if (!manifest.resources?.length) return null

    const paymentMethods: PaymentMethod[] = []
    const pricing: PricingEntry[] = []
    const firstResource = manifest.resources[0]

    if (firstResource.network && firstResource.receiver) {
      paymentMethods.push({
        rail: 'x402',
        params: [
          firstResource.network,
          firstResource.asset ?? 'usdc',
          firstResource.receiver,
        ],
      })
    }

    for (const resource of manifest.resources) {
      if (resource.price !== undefined && resource.url) {
        pricing.push({
          capability: resource.description ?? resource.url,
          amount: typeof resource.price === 'number' ? resource.price : parseFloat(String(resource.price)),
          currency: 'usd',
        })
      }
    }

    if (paymentMethods.length === 0) return null

    return {
      url: firstResource.url ?? baseUrl,
      is402: true,
      paymentMethods,
      pricing,
      statusCode: 200,
      detectionMethod: 'well-known-x402',
    }
  } catch {
    return null
  }
}

/** L402 manifest at .well-known/l402 (satgate format) */
export interface L402Manifest {
  name?: string
  description?: string
  endpoints?: { path?: string; method?: string; description?: string }[]
  pricing?: { unit?: string; currency?: string; default?: { perThousandTokens?: number }; models?: Record<string, unknown> }
  payment?: { methods?: string[] }
  capabilities?: Record<string, unknown>
}

/**
 * Probe .well-known/l402 manifest for L402 service discovery.
 */
export async function probeWellKnownL402(
  baseUrl: string,
  userAgent: string = DEFAULT_USER_AGENT,
): Promise<ProbeResult | null> {
  try {
    const origin = new URL(baseUrl).origin
    const manifestUrl = `${origin}/.well-known/l402`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

    const response = await fetch(manifestUrl, {
      headers: { 'User-Agent': userAgent },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!response.ok) return null

    const manifest = await response.json() as L402Manifest
    if (!manifest.name && !manifest.endpoints?.length) return null

    const paymentMethods: PaymentMethod[] = []
    const pricing: PricingEntry[] = []

    // Determine payment rails from manifest
    const methods = manifest.payment?.methods ?? []
    if (methods.includes('lightning') || methods.length === 0) {
      paymentMethods.push({ rail: 'l402', params: ['lightning'] })
    }
    if (methods.includes('cashu')) {
      paymentMethods.push({ rail: 'cashu', params: [] })
    }
    if (paymentMethods.length === 0) {
      paymentMethods.push({ rail: 'l402', params: ['lightning'] })
    }

    // Extract pricing from manifest
    if (manifest.pricing?.default?.perThousandTokens) {
      pricing.push({
        capability: manifest.endpoints?.[0]?.description ?? manifest.name ?? 'default',
        amount: manifest.pricing.default.perThousandTokens,
        currency: manifest.pricing.currency?.toLowerCase() ?? 'sats',
      })
    }

    return {
      url: manifest.endpoints?.[0]?.path
        ? `${origin}${manifest.endpoints[0].path}`
        : baseUrl,
      is402: true,
      paymentMethods,
      pricing,
      statusCode: 200,
      detectionMethod: 'well-known-l402',
    }
  } catch {
    return null
  }
}

/**
 * Smart probe: checks the URL for all signals in one request, then tries
 * .well-known manifests only if the initial request found nothing,
 * then common API paths as a last resort.
 */
export async function probeService(
  url: string,
  userAgent: string = DEFAULT_USER_AGENT,
): Promise<ProbeResult> {
  // 1. Try the URL as given — checks ALL signals from a single response
  const direct = await probeUrl(url, userAgent)
  if (direct.is402) return direct

  // 2. Check .well-known manifests in parallel
  const [l402Manifest, x402Manifest] = await Promise.allSettled([
    probeWellKnownL402(url, userAgent),
    probeWellKnownX402(url, userAgent),
  ])

  if (l402Manifest.status === 'fulfilled' && l402Manifest.value) {
    return l402Manifest.value
  }
  if (x402Manifest.status === 'fulfilled' && x402Manifest.value) {
    return x402Manifest.value
  }

  // 3. Try common API paths (only if the URL is a bare domain)
  try {
    const parsed = new URL(url)
    if (parsed.pathname === '/' || parsed.pathname === '') {
      for (const path of COMMON_API_PATHS) {
        const pathUrl = `${parsed.origin}${path}`
        const result = await probeUrl(pathUrl, userAgent)
        if (result.is402) {
          return { ...result, detectionMethod: 'api-path-probe' }
        }
      }
    }
  } catch {
    // invalid URL, skip path probing
  }

  return direct
}

/**
 * Probe a batch of URLs in parallel batches with a delay between batches.
 * Much faster than sequential probing — 543 URLs in ~2 minutes instead of 20+.
 */
export async function probeUrls(
  urls: string[],
  userAgent?: string,
  concurrency = 20,
  batchDelayMs = 500,
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = []
  let found = 0

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency)
    const batchResults = await Promise.allSettled(
      batch.map(url => probeService(url, userAgent)),
    )

    for (let j = 0; j < batchResults.length; j++) {
      const settled = batchResults[j]
      if (settled.status === 'fulfilled') {
        const result = settled.value
        results.push(result)
        if (result.is402) {
          found++
          console.log(`[active-prober] found: ${result.url} (${result.detectionMethod ?? 'unknown'})`)
        }
      } else {
        results.push({
          url: batch[j],
          is402: false,
          paymentMethods: [],
          pricing: [],
          statusCode: 0,
          error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
        })
      }
    }

    const probed = Math.min(i + concurrency, urls.length)
    console.log(`[active-prober] progress: ${probed}/${urls.length} probed, ${found} services found`)

    // Delay between batches to avoid overwhelming targets
    if (i + concurrency < urls.length && batchDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, batchDelayMs))
    }
  }

  return results
}
