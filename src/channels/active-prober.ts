import type { PaymentMethod, PricingEntry, ProbeResult } from '../types.js'

const DEFAULT_USER_AGENT = '402-indexer/1.0 (+https://402.pub)'
const PROBE_TIMEOUT_MS = 15_000
const COMMON_API_PATHS = ['', '/api', '/v1', '/api/v1']

/**
 * Parse an L402/LSAT challenge from a WWW-Authenticate header.
 */
export function parseL402Challenge(
  header: string,
): { rail: 'l402'; params: string[]; pricing: PricingEntry[] } | null {
  const match = header.match(/^(L402|LSAT)\s+/i)
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
 * Probe a URL for L402/x402 payment challenges.
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

    // Check CORS headers for 402 capability even on non-402 responses
    // Services with free tiers return 200 but expose WWW-Authenticate/PAYMENT-REQUIRED in CORS
    const corsExpose = response.headers.get('access-control-expose-headers') ?? ''
    const has402Cors = /www-authenticate|payment-required/i.test(corsExpose)

    if (response.status !== 402 && !has402Cors) {
      return { url, is402: false, paymentMethods: [], pricing: [], statusCode: response.status }
    }

    // If we detected via CORS but got 200, mark as a 402-capable service
    if (response.status !== 402 && has402Cors) {
      return {
        url,
        is402: true,
        paymentMethods: [{ rail: 'l402' as const, params: ['lightning'] }],
        pricing: [],
        statusCode: response.status,
      }
    }

    const paymentMethods: PaymentMethod[] = []
    const pricing: PricingEntry[] = []

    // Check for L402
    const wwwAuth = response.headers.get('www-authenticate')
    if (wwwAuth) {
      const l402 = parseL402Challenge(wwwAuth)
      if (l402) {
        paymentMethods.push({ rail: l402.rail, params: l402.params })
        pricing.push(...l402.pricing)
      }
    }

    // Check for x402
    const xPayment = response.headers.get('x-payment-required')
    if (xPayment) {
      const body = await response.text()
      const x402 = parseX402Challenge(xPayment, body)
      if (x402) {
        paymentMethods.push({ rail: x402.rail, params: x402.params })
        pricing.push(...x402.pricing)
      }
    }

    return {
      url,
      is402: paymentMethods.length > 0,
      paymentMethods,
      pricing,
      statusCode: 402,
    }
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

/**
 * Parse a .well-known/x402.json manifest to extract payment info.
 * Returns a ProbeResult if the manifest exists and is valid.
 */
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
    }
  } catch {
    return null
  }
}

/**
 * Smart probe: tries the URL directly, then .well-known/l402, then .well-known/x402.json,
 * then common API paths. Returns on first 402 hit.
 */
export async function probeService(
  url: string,
  userAgent: string = DEFAULT_USER_AGENT,
): Promise<ProbeResult> {
  // 1. Try the URL as given
  const direct = await probeUrl(url, userAgent)
  if (direct.is402) return direct

  // 2. Check .well-known/l402 manifest
  const l402Manifest = await probeWellKnownL402(url, userAgent)
  if (l402Manifest) return l402Manifest

  // 3. Check .well-known/x402.json manifest
  const manifest = await probeWellKnownX402(url, userAgent)
  if (manifest) return manifest

  // 4. Try common API paths (only if the URL is a bare domain)
  try {
    const parsed = new URL(url)
    if (parsed.pathname === '/' || parsed.pathname === '') {
      for (const path of COMMON_API_PATHS) {
        if (path === '') continue // already tried root
        const pathUrl = `${parsed.origin}${path}`
        const result = await probeUrl(pathUrl, userAgent)
        if (result.is402) return result
      }
    }
  } catch {
    // invalid URL, skip path probing
  }

  return direct
}

/**
 * Probe a batch of URLs sequentially with a delay between each.
 * Uses smart probing (direct → .well-known/x402.json → common paths).
 * Logs progress every 50 URLs.
 */
export async function probeUrls(
  urls: string[],
  userAgent?: string,
  delayMs = 500,
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = []
  let found = 0
  for (let i = 0; i < urls.length; i++) {
    const result = await probeService(urls[i], userAgent)
    results.push(result)
    if (result.is402) found++

    if ((i + 1) % 50 === 0 || i === urls.length - 1) {
      console.log(`[active-prober] progress: ${i + 1}/${urls.length} probed, ${found} services found`)
    }

    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  return results
}
