import { probeUrl } from '../channels/active-prober.js'
import type { StateStore } from './state-store.js'
import type { DiscoveredService } from '../types.js'

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
    const url = service.urls[0]
    if (!url) continue

    const result = await probeUrl(url, userAgent)
    if (result.is402) {
      store.recordSuccess(service.identifier)
    } else {
      store.recordFailure(service.identifier)
    }
  }

  store.save()
}
