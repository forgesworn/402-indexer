import { describe, it, expect, vi, beforeEach } from 'vitest'
import { searchNpmDependents } from '../../src/channels/npm-scanner.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('searchNpmDependents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('finds packages depending on a given package', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        objects: [
          { package: { name: 'my-api', links: { repository: 'https://github.com/user/my-api' } } },
        ],
      }),
    })

    const deps = await searchNpmDependents('@thecryptodonkey/toll-booth')
    expect(deps).toHaveLength(1)
    expect(deps[0].name).toBe('my-api')
  })

  it('returns empty array on API failure', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 })
    const deps = await searchNpmDependents('@thecryptodonkey/toll-booth')
    expect(deps).toEqual([])
  })
})
