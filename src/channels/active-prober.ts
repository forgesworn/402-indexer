import type { PaymentMethod, PricingEntry, ProbeResult } from '../types.js'

const DEFAULT_USER_AGENT = '402-indexer/1.0 (+https://402.pub)'
const PROBE_TIMEOUT_MS = 15_000

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

    if (response.status !== 402) {
      return { url, is402: false, paymentMethods: [], pricing: [], statusCode: response.status }
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
 * Probe a batch of URLs sequentially with a delay between each.
 */
export async function probeUrls(
  urls: string[],
  userAgent?: string,
  delayMs = 1000,
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = []
  for (const url of urls) {
    results.push(await probeUrl(url, userAgent))
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  return results
}
