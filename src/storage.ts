import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { request } from 'node:https'
import { parseStorageAnnouncement, validateStorageEndpointBinding } from '402-announce/storage'
import type { StorageServiceDescription } from '402-announce'
import type { NostrEvent } from 'nostr-tools/pure'
import type { DiscoveredService } from './types.js'

/** Recognise claimed storage profiles so invalid ones cannot fall back to generic paid APIs. */
export function claimsStorage(event: NostrEvent): boolean {
  if (event.tags.some(t => (t[0] === 't' && t[1] === 'forgesworn-storage-service-v1') || (t[0] === 'pmi' && t[1] === 'wildbloom-checkout'))) return true
  try { return Object.hasOwn(JSON.parse(event.content), 'storage') } catch { return false }
}

/** Keep signed storage watermarks across relay rounds without silently evicting withdrawals. */
export class StorageWatermarks {
  private entries = new Map<string, NostrEvent>()
  /** Merge a relay round without replacing valid records with invalid metadata. */
  accept(events: NostrEvent[], now = Math.floor(Date.now()/1000)): NostrEvent[] {
    const next = new Map(this.entries)
    for (const event of events) {
      if (!claimsStorage(event)) continue
      try {
        const valid = parseStorageAnnouncement(event,{now}).event
        const id = `${valid.pubkey}:${valid.tags.find(t => t[0] === 'd')![1]}`
        const prior = next.get(id)
        if (!prior || valid.created_at > prior.created_at || (valid.created_at === prior.created_at && valid.id < prior.id)) next.set(id,valid)
      } catch { /* Invalid metadata cannot become a watermark. */ }
    }
    if (next.size > 2000) throw new Error('Storage watermark limit reached.')
    this.entries = next
    return [...next.values()]
  }
}

const blocked = new BlockList()
for (const [ip, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]] as const) blocked.addSubnet(ip, bits, 'ipv4')
for (const [ip, bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const) blocked.addSubnet(ip, bits, 'ipv6')
const globalV6 = new BlockList(); globalV6.addSubnet('2000::',3,'ipv6')

/** Accept only global unicast addresses; reject mapped/NAT64/transition and special destinations. */
export function isPublicStorageAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4 ? !blocked.check(address,'ipv4')
    : family === 6 && globalV6.check(address,'ipv6') && !blocked.check(address,'ipv6')
}

/** Bounded HTTPS GET with validated DNS pinned into the socket and ordinary hostname/TLS checks. */
export async function readStorageDescription(url: string): Promise<unknown> {
  const target = new URL(url)
  if (target.protocol !== 'https:' || target.hostname.endsWith('.onion') || target.username || target.password || target.pathname !== '/services/v1' || target.search || target.hash)
    throw new Error('Unsupported storage inspection transport.')
  const signal = AbortSignal.timeout(15_000)
  const host = target.hostname.replace(/^\[|\]$/g, '')
  const addresses = await Promise.race([
    lookup(host,{all:true}),
    new Promise<never>((_,reject) => signal.addEventListener('abort',() => reject(new Error('Storage inspection timed out.')),{once:true})),
  ])
  signal.throwIfAborted()
  if (!addresses.length || addresses.length > 16 || addresses.some(a => !isPublicStorageAddress(a.address))) throw new Error('Blocked storage inspection destination.')
  const pinned = addresses[0]
  return new Promise((resolve,reject) => {
    const req = request(target,{
      method:'GET',signal,headers:{Accept:'application/json','Accept-Encoding':'identity','User-Agent':'402-indexer/storage-v1'},
      lookup: (_hostname,options,callback) => {
        if (options.all) callback(null,[pinned])
        else callback(null,pinned.address,pinned.family)
      },
    },response => {
      if (response.statusCode !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers['content-type'] ?? '') || response.headers['content-encoding']) {
        response.destroy(); reject(new Error('Invalid storage inspection response.')); return
      }
      const chunks: Buffer[] = []; let size = 0
      response.on('data',(chunk: Buffer) => {
        size += chunk.length
        if (size > 65_536) { response.destroy(new Error('Storage inspection exceeded its size limit.')); return }
        chunks.push(chunk)
      })
      response.on('error',reject)
      response.on('end',() => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new Error('Invalid storage inspection JSON.')) } })
    })
    req.on('error',reject); req.end()
  })
}

/** Inspect an explicitly discovered storage profile without a 402 challenge, quote, signer or payment. */
export async function probeStorageService(service: DiscoveredService,
  get: (url: string) => Promise<unknown> = readStorageDescription,
  now?: number): Promise<{reachable: boolean; description?: StorageServiceDescription}> {
  try {
    if (!service.storage) return {reachable:false}
    const signed = parseStorageAnnouncement(service.storage.event,{now:now ?? Math.floor(Date.now()/1000)})
    if (signed.freshness !== 'current' || signed.description.state !== 'published') return {reachable:false}
    const origin = signed.description.origins.find(o => o.startsWith('https:') && !new URL(o).hostname.endsWith('.onion'))
    if (!origin) return {reachable:false}
    const value = await get(`${origin}services/v1`)
    const description = validateStorageEndpointBinding(value,signed,origin,{now:now ?? Math.floor(Date.now()/1000)})
    return {reachable:true,description}
  } catch { return {reachable:false} }
}
