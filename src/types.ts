/** How a service was discovered */
export type EventSource = 'crawl' | 'github' | 'submit' | 'self'

const VALID_SOURCES: ReadonlySet<string> = new Set(['crawl', 'github', 'submit', 'self'])

export function isValidEventSource(s: string): s is EventSource {
  return VALID_SOURCES.has(s)
}

/** Current health status of an indexed service */
export type ServiceStatus = 'active' | 'stale' | 'unreachable'

const VALID_STATUSES: ReadonlySet<string> = new Set(['active', 'stale', 'unreachable'])

export function isValidStatus(s: string): s is ServiceStatus {
  return VALID_STATUSES.has(s)
}

/** Payment method identifier — matches tag[1] of a pmi tag */
export type PaymentRail = 'l402' | 'x402' | 'cashu' | 'xcashu' | 'lnurlcash' | 'payment'

/** A structured payment method from a pmi tag */
export interface PaymentMethod {
  rail: PaymentRail
  /**
   * Additional positional elements (e.g. network, asset, receiver for x402;
   * the accepted mint hosts for lnurlcash)
   */
  params: string[]
}

/** Per-capability pricing */
export interface PricingEntry {
  capability: string
  amount: number
  currency: string
}

/** A discovered or self-announced service */
export interface DiscoveredService {
  /** Nostr d-tag identifier */
  identifier: string
  /** Service name */
  name: string
  /** Service description */
  about: string
  /** Transport URLs (1–10) */
  urls: string[]
  /** Payment methods supported */
  paymentMethods: PaymentMethod[]
  /** Per-capability pricing */
  pricing: PricingEntry[]
  /** How the service was discovered */
  source: EventSource
  /** Last successful verification (ISO 8601) */
  verified?: string
  /** Current health status */
  status: ServiceStatus
  /** Nostr pubkey of the event author */
  pubkey?: string
  /** Topic tags */
  topics?: string[]
  /** Capability metadata (from event content) */
  capabilities?: unknown[]
}

/** How a 402 service was detected during probing */
export type DetectionMethod =
  | 'status-402'
  | 'ietf-payment'
  | 'cors-headers'
  | 'well-known-l402'
  | 'well-known-x402'
  | 'payment-headers'
  | 'html-meta'
  | 'link-header'
  | 'api-path-probe'

/** Result of an HTTP probe against a URL */
export interface ProbeResult {
  url: string
  /** Whether the endpoint returned a 402 challenge */
  is402: boolean
  /** Detected payment rails */
  paymentMethods: PaymentMethod[]
  /** Extracted pricing (if parseable from challenge) */
  pricing: PricingEntry[]
  /** Raw response status code */
  statusCode: number
  /** Error message if probe failed */
  error?: string
  /** Which signal triggered detection (when is402 is true) */
  detectionMethod?: DetectionMethod
}

/** Health state for a single indexed service, persisted to JSON */
export interface HealthEntry {
  /** Service identifier (d-tag) */
  identifier: string
  /** Number of consecutive probe failures */
  failureCount: number
  /** ISO 8601 timestamp of last successful probe */
  lastSuccess?: string
  /** ISO 8601 timestamp of last probe attempt */
  lastChecked: string
}

/** Full health state file */
export interface HealthState {
  entries: Record<string, HealthEntry>
}

/** Kind constants */
export const KIND_SERVICE_ANNOUNCEMENT = 31402
export const KIND_COMMUNITY_SUGGESTION = 1402
export const KIND_DELETION = 5
