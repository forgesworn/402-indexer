import { readFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'
import { parseServiceEvent } from '../src/event-parser.js'
import { deduplicateServices } from '../src/channels/nostr-aggregator.js'
import { probeStorageService, isPublicStorageAddress, StorageWatermarks } from '../src/storage.js'
import { buildServiceEvent } from '../src/publisher/event-builder.js'
import type { NostrEvent } from 'nostr-tools/pure'

const now = 1800000300
function fixture(name: string) {
  return JSON.parse(readFileSync(`node_modules/402-announce/fixtures/storage-v1/${name}.json`, 'utf8'))
}
const event = (name: string): NostrEvent => fixture(name).signed_event
describe('public storage discovery', () => {
  it('recognises the actual checkout protocol and free mirror service', () => {
    const paid = parseServiceEvent(event('paid'), now)!
    expect(paid.paymentMethods.map(p => p.rail)).toEqual(['wildbloom-checkout', 'wildbloom-checkout'])
    expect(paid.storage!.description.checkout!.protocol).toBe('wildbloom-checkout-v1')
    const free = parseServiceEvent(event('free'), now)!
    expect(free.paymentMethods).toEqual([])
    expect(free.pricing[0].amount).toBe(0)
    expect(free.storage!.description.services[0].type).toBe('free-mirror')
  })
  it('rejects a cryptographically signed invalid profile without a generic fallback', () => {
    expect(parseServiceEvent(event('reject-misleading-price'), now)).toBeNull()
  })
  it('keeps withdrawal and expiry before availability filtering; invalid newer content cannot replace valid', () => {
    expect(deduplicateServices([event('combined'),event('withdrawn')], now)[0].id).toBe(event('withdrawn').id)
    const expired = parseServiceEvent(event('expired'), now)!
    expect(expired.storage!.freshness).toBe('expired')
    const invalid = {...event('combined'),created_at:now,content:'{}'}
    expect(deduplicateServices([event('combined'),invalid], now)).toEqual([event('combined')])
  })
  it('uses the lowest id for equal timestamps', () => {
    const a = {...event('combined'),id:'a',tags:[['d','generic']],content:'{}'}
    const b = {...a,id:'b'}
    expect(deduplicateServices([b,a], now)[0].id).toBe('a')
  })
  it('retains withdrawals across omitted relay rounds and refuses re-signing as an indexer', () => {
    const cache = new StorageWatermarks()
    cache.accept([event('combined'),event('withdrawn')],now)
    expect(cache.accept([event('combined')],now).map(e => e.id)).toEqual([event('withdrawn').id])
    expect(() => buildServiceEvent('01'.repeat(32),parseServiceEvent(event('paid'),now)!)).toThrow(/original signature/)
  })
  it('inspects only services/v1, binds identity and treats a full service as reachable', async () => {
    const service = parseServiceEvent(event('combined'), now)!
    const get = vi.fn(async () => fixture('full').description)
    const result = await probeStorageService(service, get, now)
    expect(result.reachable).toBe(true)
    expect(result.description!.services.every(s => s.availability === 'full')).toBe(true)
    expect(get).toHaveBeenCalledExactlyOnceWith('https://storage.example/services/v1')
    const wrong = {...fixture('combined').description, service_pubkey:'0'.repeat(64)}
    expect((await probeStorageService(service, async () => wrong, now)).reachable).toBe(false)
  })
  it('does not inspect expired, withdrawn or onion services through direct HTTP', async () => {
    const get = vi.fn()
    for (const name of ['expired','withdrawn','free-onion'])
      expect((await probeStorageService(parseServiceEvent(event(name), now)!, get, now)).reachable).toBe(false)
    expect(get).not.toHaveBeenCalled()
  })
  it('rejects private, special and transition DNS destinations', () => {
    for (const ip of ['127.0.0.1','10.0.0.1','100.64.0.1','192.0.2.1','224.0.0.1','::1','::ffff:8.8.8.8','64:ff9b::808:808','2001:db8::1','2002:808:808::1','fc00::1'])
      expect(isPublicStorageAddress(ip), ip).toBe(false)
    for (const ip of ['8.8.8.8','2606:4700:4700::1111']) expect(isPublicStorageAddress(ip)).toBe(true)
  })
})
