#!/usr/bin/env node
import { loadConfig } from './config.js'
import { probeUrls } from './channels/active-prober.js'
import { aggregateFromRelays, findSupersededIndexerEvents } from './channels/nostr-aggregator.js'
import { runGitHubScan } from './channels/github-scanner.js'
import { runNpmScan } from './channels/npm-scanner.js'
import { parseSuggestionEvent } from './channels/community-listener.js'
import { StateStore } from './health/state-store.js'
import { runHealthChecks } from './health/health-checker.js'
import { determineStatus, shouldDelist } from './health/lifecycle.js'
import { buildServiceEvent } from './publisher/event-builder.js'
import { publishEvent, deleteEvent } from './publisher/relay-publisher.js'
import { KIND_COMMUNITY_SUGGESTION } from './types.js'
import type { DiscoveredService } from './types.js'
import { Relay } from 'nostr-tools/relay'
import { verifyEvent, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from 'nostr-tools/pure'
import { hexToBytes } from './utils.js'

/**
 * Schedule a task to run immediately, then at a fixed interval.
 * Returns a stop function.
 */
export function scheduleTask(
  name: string,
  fn: () => Promise<void>,
  intervalMs: number,
): () => void {
  let timer: ReturnType<typeof setInterval> | undefined

  const run = async () => {
    try {
      await fn()
    } catch (err) {
      console.error(`[${name}] error:`, err)
    }
  }

  // Run immediately
  run()
  timer = setInterval(run, intervalMs)

  return () => {
    if (timer) clearInterval(timer)
  }
}

/**
 * Derive a unique identifier from a URL, incorporating the path.
 */
function identifierFromUrl(url: string): string {
  const parsed = new URL(url)
  const path = parsed.pathname.replace(/^\/|\/$/g, '').replace(/\//g, '-')
  const host = parsed.hostname.replace(/\./g, '-')
  return path ? `${host}-${path}` : host
}

async function main(): Promise<void> {
  const config = loadConfig()
  const store = new StateStore(config.healthStatePath)
  const indexedServices: Map<string, DiscoveredService> = new Map()
  // Track indexer event IDs for NIP-09 deletion
  const indexerEventIds: Map<string, string> = new Map()
  // Derive indexer pubkey from secret key for NIP-09 dedup
  const indexerPubkey = getPublicKey(hexToBytes(config.secretKey))

  console.log('402-indexer starting...')
  console.log(`  Seed URLs: ${config.seedUrls.length}`)
  console.log(`  Subscribe relays: ${config.subscribeRelays.length}`)
  console.log(`  Publish relays: ${config.publishRelays.length}`)

  // Active probing: seed URLs + discovered URLs
  const probeList = new Set(config.seedUrls)

  // --- Channel 1: Active Probing ---
  const stopProbe = scheduleTask('active-prober', async () => {
    console.log(`[active-prober] probing ${probeList.size} URLs...`)
    const results = await probeUrls([...probeList], config.userAgent)

    for (const result of results) {
      if (!result.is402) continue

      const identifier = identifierFromUrl(result.url)
      const service: DiscoveredService = {
        identifier,
        name: new URL(result.url).hostname,
        about: `402 service discovered at ${result.url}`,
        urls: [result.url],
        paymentMethods: result.paymentMethods,
        pricing: result.pricing,
        source: 'crawl',
        verified: new Date().toISOString(),
        status: 'active',
      }

      const event = buildServiceEvent(config.secretKey, service)
      const pubResult = await publishEvent(event, config.publishRelays)
      console.log(`[active-prober] published ${identifier}: ${pubResult.accepted} accepted, ${pubResult.failed} failed`)

      indexedServices.set(identifier, service)
      indexerEventIds.set(identifier, event.id)
      store.recordSuccess(identifier)
    }

    store.save()
  }, config.probeIntervalMs)

  // --- Channel 2: GitHub + npm scanning ---
  const stopScan = scheduleTask('github-npm-scan', async () => {
    console.log('[github-npm-scan] scanning...')
    const githubUrls = await runGitHubScan(config.githubToken)
    const npmUrls = await runNpmScan()

    for (const url of [...githubUrls, ...npmUrls]) {
      probeList.add(url)
    }

    console.log(`[github-npm-scan] probe list now has ${probeList.size} URLs`)
  }, config.scanIntervalMs)

  // --- Channel 3: Nostr aggregation ---
  const stopAggregator = scheduleTask('nostr-aggregator', async () => {
    console.log(`[nostr-aggregator] subscribing to ${config.subscribeRelays.length} relays...`)
    const events = await aggregateFromRelays(config.subscribeRelays)
    console.log(`[nostr-aggregator] received ${events.length} events`)

    // Check for indexer events superseded by operator self-announcements
    const superseded = findSupersededIndexerEvents(events, indexerPubkey)
    for (const sup of superseded) {
      console.log(`[nostr-aggregator] deleting superseded indexer event ${sup.id}`)
      await deleteEvent(config.secretKey, sup.id, config.publishRelays)
    }
  }, config.probeIntervalMs)

  // --- Channel 4: Community suggestions (kind 1402) ---
  // Subscribe persistently to kind 1402 events
  const communityCleanup: (() => void)[] = []
  for (const url of config.subscribeRelays.slice(0, 5)) {
    try {
      const relay = await Relay.connect(url)
      const sub = relay.subscribe(
        [{ kinds: [KIND_COMMUNITY_SUGGESTION] }],
        {
          onevent: async (event: NostrEvent) => {
            if (!verifyEvent(event)) return
            const suggestion = parseSuggestionEvent(event)
            if (!suggestion) return
            console.log(`[community] suggestion received: ${suggestion.url}`)
            probeList.add(suggestion.url)
          },
        },
      )
      communityCleanup.push(() => { sub.close(); relay.close() })
    } catch (err) {
      console.error(`[community] failed to connect to ${url}:`, err)
    }
  }

  // --- Channel 5: Health checks + lifecycle ---
  const stopHealth = scheduleTask('health-checker', async () => {
    const services = [...indexedServices.values()]
    if (services.length === 0) return

    console.log(`[health-checker] checking ${services.length} services...`)
    await runHealthChecks(services, store, config.userAgent)

    // Apply lifecycle transitions
    for (const [id, service] of indexedServices) {
      const entry = store.get(id)
      if (!entry) continue

      const newStatus = determineStatus(entry)
      if (newStatus !== service.status) {
        console.log(`[health-checker] ${id}: ${service.status} → ${newStatus}`)
        service.status = newStatus
        // Republish with updated status
        const event = buildServiceEvent(config.secretKey, service)
        await publishEvent(event, config.publishRelays)
        indexerEventIds.set(id, event.id)
      }

      if (shouldDelist(entry)) {
        console.log(`[health-checker] delisting ${id} (unreachable for 30+ days)`)
        const eventId = indexerEventIds.get(id)
        if (eventId) {
          await deleteEvent(config.secretKey, eventId, config.publishRelays)
        }
        indexedServices.delete(id)
        indexerEventIds.delete(id)
        store.remove(id)
      }
    }

    store.save()
  }, config.healthCheckIntervalMs)

  // Handle shutdown
  const shutdown = () => {
    console.log('402-indexer shutting down...')
    stopProbe()
    stopScan()
    stopAggregator()
    stopHealth()
    for (const cleanup of communityCleanup) cleanup()
    store.save()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

// Only run main when executed directly (not imported in tests)
const isDirectRun = process.argv[1]?.endsWith('orchestrator.js')
if (isDirectRun) {
  main().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
}
