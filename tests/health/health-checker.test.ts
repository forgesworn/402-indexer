import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runHealthChecks } from '../../src/health/health-checker.js'
import type { DiscoveredService } from '../../src/types.js'
import type { StateStore } from '../../src/health/state-store.js'

vi.mock('../../src/channels/active-prober.js', () => ({
  probeUrl: vi.fn(),
}))

const { probeUrl } = await import('../../src/channels/active-prober.js')

function makeStore(): StateStore {
  const entries: Record<string, { failureCount: number; lastSuccess?: string; lastChecked: string }> = {}
  return {
    get: vi.fn((id: string) => entries[id]),
    getAll: vi.fn(() => entries),
    recordSuccess: vi.fn((id: string) => {
      entries[id] = { failureCount: 0, lastSuccess: new Date().toISOString(), lastChecked: new Date().toISOString() }
    }),
    recordFailure: vi.fn((id: string) => {
      const existing = entries[id]
      entries[id] = { failureCount: (existing?.failureCount ?? 0) + 1, lastChecked: new Date().toISOString() }
    }),
    save: vi.fn(),
    remove: vi.fn(),
  } as unknown as StateStore
}

function makeService(id: string, url: string): DiscoveredService {
  return {
    identifier: id,
    name: id,
    about: '',
    urls: [url],
    paymentMethods: [{ rail: 'l402', params: ['lightning'] }],
    pricing: [],
    source: 'crawl',
    status: 'active',
  }
}

describe('runHealthChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records success for healthy endpoints', async () => {
    vi.mocked(probeUrl).mockResolvedValue({
      url: 'https://ok.com',
      is402: true,
      paymentMethods: [{ rail: 'l402', params: ['lightning'] }],
      pricing: [],
      statusCode: 402,
    })

    const store = makeStore()
    const services = [makeService('svc-1', 'https://ok.com')]

    await runHealthChecks(services, store)

    expect(store.recordSuccess).toHaveBeenCalledWith('svc-1')
    expect(store.save).toHaveBeenCalled()
  })

  it('records failure for unreachable endpoints', async () => {
    vi.mocked(probeUrl).mockResolvedValue({
      url: 'https://down.com',
      is402: false,
      paymentMethods: [],
      pricing: [],
      statusCode: 0,
      error: 'ECONNREFUSED',
    })

    const store = makeStore()
    const services = [makeService('svc-1', 'https://down.com')]

    await runHealthChecks(services, store)

    expect(store.recordFailure).toHaveBeenCalledWith('svc-1')
    expect(store.save).toHaveBeenCalled()
  })
})
