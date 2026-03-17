import { describe, it, expect } from 'vitest'
import { determineStatus, shouldDelist } from '../../src/health/lifecycle.js'
import type { HealthEntry } from '../../src/types.js'

describe('determineStatus', () => {
  it('returns active when failure count is 0', () => {
    const entry: HealthEntry = {
      identifier: 'svc-1',
      failureCount: 0,
      lastSuccess: '2026-03-17T00:00:00Z',
      lastChecked: '2026-03-17T00:00:00Z',
    }
    expect(determineStatus(entry)).toBe('active')
  })

  it('returns active when failure count is below threshold', () => {
    const entry: HealthEntry = {
      identifier: 'svc-1',
      failureCount: 6,
      lastChecked: '2026-03-17T00:00:00Z',
    }
    expect(determineStatus(entry)).toBe('active')
  })

  it('returns stale after 7 consecutive failures', () => {
    const entry: HealthEntry = {
      identifier: 'svc-1',
      failureCount: 7,
      lastChecked: '2026-03-17T00:00:00Z',
    }
    expect(determineStatus(entry)).toBe('stale')
  })

  it('returns unreachable after 21 consecutive failures', () => {
    const entry: HealthEntry = {
      identifier: 'svc-1',
      failureCount: 21,
      lastChecked: '2026-03-17T00:00:00Z',
    }
    expect(determineStatus(entry)).toBe('unreachable')
  })
})

describe('shouldDelist', () => {
  it('returns false when last success is recent', () => {
    const entry: HealthEntry = {
      identifier: 'svc-1',
      failureCount: 30,
      lastSuccess: new Date().toISOString(),
      lastChecked: new Date().toISOString(),
    }
    expect(shouldDelist(entry)).toBe(false)
  })

  it('returns true after 30 days without success', () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    const entry: HealthEntry = {
      identifier: 'svc-1',
      failureCount: 30,
      lastSuccess: thirtyOneDaysAgo,
      lastChecked: new Date().toISOString(),
    }
    expect(shouldDelist(entry)).toBe(true)
  })

  it('returns true when never successfully probed and old enough', () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    const entry: HealthEntry = {
      identifier: 'svc-1',
      failureCount: 30,
      lastChecked: thirtyOneDaysAgo,
    }
    expect(shouldDelist(entry)).toBe(true)
  })
})
