import type { NostrEvent } from 'nostr-tools/pure'
import type { DiscoveredService, PaymentMethod, PaymentRail, PricingEntry, EventSource, ServiceStatus } from './types.js'
import { isValidEventSource, isValidStatus } from './types.js'
import { parseStorageAnnouncement } from '402-announce/storage'
import { claimsStorage } from './storage.js'

const VALID_RAILS: ReadonlySet<string> = new Set(['l402', 'x402', 'cashu', 'xcashu', 'lnurlcash', 'payment'])

function getTagValue(tags: string[][], key: string): string | undefined {
  const tag = tags.find(t => t[0] === key)
  return tag?.[1]
}

function getAllTagValues(tags: string[][], key: string): string[] {
  return tags.filter(t => t[0] === key).map(t => t[1])
}

function getAllTags(tags: string[][], key: string): string[][] {
  return tags.filter(t => t[0] === key)
}

/** Parse public announcements; storage claims require shared signature and closed-schema validation. */
export function parseServiceEvent(event: NostrEvent, now = Math.floor(Date.now()/1000)): DiscoveredService | null {
  if (claimsStorage(event)) {
    try {
      const storage = parseStorageAnnouncement(event,{now})
      const d = storage.description
      return {identifier:d.identifier,name:d.name,about:d.about,urls:d.origins,
        paymentMethods:event.tags.filter(t => t[0] === 'pmi').map(t => ({rail:'wildbloom-checkout',params:t.slice(2)})),
        pricing:d.services.map(s => ({capability:s.id,amount:s.type === 'paid-storage' ? s.price_msat/1000 : 0,currency:'sats'})),
        source:'self',status:storage.freshness === 'current' && d.state === 'published' ? 'active' : 'stale',
        pubkey:event.pubkey,topics:event.tags.filter(t => t[0] === 't').map(t => t[1]),storage}
    } catch { return null }
  }
  const { tags, pubkey, content } = event

  const identifier = getTagValue(tags, 'd')
  const name = getTagValue(tags, 'name')

  if (!identifier || !name) return null

  const about = getTagValue(tags, 'about') ?? ''
  const urls = getAllTagValues(tags, 'url')

  const pmiTags = getAllTags(tags, 'pmi')
  const paymentMethods: PaymentMethod[] = pmiTags
    .filter(t => t.length >= 2 && VALID_RAILS.has(t[1]))
    .map(t => ({ rail: t[1] as PaymentRail, params: t.slice(2) }))

  const priceTags = getAllTags(tags, 'price')
  const pricing: PricingEntry[] = priceTags
    .filter(t => t.length >= 4)
    .map(t => ({ capability: t[1], amount: parseFloat(t[2]), currency: t[3] }))
    .filter(p => Number.isFinite(p.amount))

  const sourceRaw = getTagValue(tags, 'source')
  const source: EventSource = sourceRaw && isValidEventSource(sourceRaw) ? sourceRaw : 'self'

  const statusRaw = getTagValue(tags, 'status')
  const status: ServiceStatus = statusRaw && isValidStatus(statusRaw) ? statusRaw : 'active'

  const verified = getTagValue(tags, 'verified')

  const topics = getAllTagValues(tags, 't')

  let capabilities: unknown[] | undefined
  try {
    const parsed = JSON.parse(content) as unknown
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>
      if (Array.isArray(obj['capabilities'])) {
        capabilities = obj['capabilities'] as unknown[]
      }
    }
  } catch {
    // ignore invalid JSON
  }

  return {
    identifier,
    name,
    about,
    urls,
    paymentMethods,
    pricing,
    source,
    verified,
    status,
    pubkey,
    topics: topics.length > 0 ? topics : undefined,
    capabilities,
  }
}
