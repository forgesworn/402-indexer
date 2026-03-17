import { finalizeEvent } from 'nostr-tools/pure'
import type { VerifiedEvent } from 'nostr-tools/pure'
import type { DiscoveredService } from '../types.js'
import { KIND_SERVICE_ANNOUNCEMENT } from '../types.js'
import { hexToBytes } from '../utils.js'

export function buildServiceEvent(secretKeyHex: string, service: DiscoveredService): VerifiedEvent {
  const tags: string[][] = [
    ['d', service.identifier],
    ['name', service.name],
    ['about', service.about],
  ]

  for (const url of service.urls) {
    tags.push(['url', url])
  }

  for (const pm of service.paymentMethods) {
    tags.push(['pmi', pm.rail, ...pm.params])
  }

  for (const p of service.pricing) {
    tags.push(['price', p.capability, String(p.amount), p.currency])
  }

  tags.push(['source', service.source])

  if (service.verified) {
    tags.push(['verified', service.verified])
  }

  tags.push(['status', service.status])

  if (service.topics) {
    for (const topic of service.topics) {
      tags.push(['t', topic])
    }
  }

  const contentObj: Record<string, unknown> = {}
  if (service.capabilities && service.capabilities.length > 0) {
    contentObj['capabilities'] = service.capabilities
  }

  const skBytes = hexToBytes(secretKeyHex)
  try {
    return finalizeEvent(
      {
        kind: KIND_SERVICE_ANNOUNCEMENT,
        tags,
        content: JSON.stringify(contentObj),
        created_at: Math.floor(Date.now() / 1000),
      },
      skBytes,
    )
  } finally {
    skBytes.fill(0)
  }
}
