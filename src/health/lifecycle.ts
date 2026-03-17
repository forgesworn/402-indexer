import type { HealthEntry, ServiceStatus } from '../types.js'

const STALE_THRESHOLD = 7
const UNREACHABLE_THRESHOLD = 21
const DELIST_DAYS = 30

/**
 * Determine the status of a service based on its health entry.
 */
export function determineStatus(entry: HealthEntry): ServiceStatus {
  if (entry.failureCount >= UNREACHABLE_THRESHOLD) return 'unreachable'
  if (entry.failureCount >= STALE_THRESHOLD) return 'stale'
  return 'active'
}

/**
 * Whether a service should be delisted (event deleted) due to prolonged unreachability.
 * Returns true if no successful probe in the last 30 days.
 */
export function shouldDelist(entry: HealthEntry): boolean {
  const referenceDate = entry.lastSuccess ?? entry.lastChecked
  if (!referenceDate) return false

  const daysSince = (Date.now() - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24)
  return daysSince > DELIST_DAYS
}
