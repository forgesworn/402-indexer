import { probeUrl } from '../channels/active-prober.js'
import type { StateStore } from './state-store.js'
import type { DiscoveredService } from '../types.js'
import { probeStorageService } from '../storage.js'

/**
 * Run health checks on all indexed services.
 * Probes the first URL of each service and records success/failure.
 */
export async function runHealthChecks(
  services: DiscoveredService[],
  store: StateStore,
  userAgent?: string,
): Promise<void> {
  for (const service of services) {
    const identity = service.storage ? `${service.pubkey}:${service.identifier}` : service.identifier
    const url = service.urls[0]
    if (!url) continue

    const reachable = service.storage ? (await probeStorageService(service)).reachable : (await probeUrl(url, userAgent)).is402
    if (reachable) {
      store.recordSuccess(identity)
    } else {
      store.recordFailure(identity)
    }
  }

  store.save()
}
