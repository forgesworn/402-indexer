import { describe, it, expect, vi, beforeEach } from 'vitest'
import { searchGitHubForDeps, extractUrlsFromReadme } from '../../src/channels/github-scanner.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('extractUrlsFromReadme', () => {
  it('extracts https URLs from markdown', () => {
    const readme = `
# My API
Deploy at https://api.myservice.com/v1
Also check https://staging.myservice.com
    `
    const urls = extractUrlsFromReadme(readme)
    expect(urls).toContain('https://api.myservice.com/v1')
    expect(urls).toContain('https://staging.myservice.com')
  })

  it('ignores github.com and npm URLs', () => {
    const readme = `
Source: https://github.com/user/repo
Install: https://www.npmjs.com/package/foo
API: https://api.real.com
    `
    const urls = extractUrlsFromReadme(readme)
    expect(urls).not.toContain('https://github.com/user/repo')
    expect(urls).not.toContain('https://www.npmjs.com/package/foo')
    expect(urls).toContain('https://api.real.com')
  })

  it('returns empty array for readme with no URLs', () => {
    expect(extractUrlsFromReadme('# No URLs here')).toEqual([])
  })
})

describe('searchGitHubForDeps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('searches for dependency markers and returns repo URLs', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        items: [
          { repository: { full_name: 'user/repo1', html_url: 'https://github.com/user/repo1' } },
          { repository: { full_name: 'user/repo2', html_url: 'https://github.com/user/repo2' } },
        ],
      }),
    })

    const repos = await searchGitHubForDeps('@thecryptodonkey/toll-booth')
    expect(repos).toHaveLength(2)
    expect(repos[0].fullName).toBe('user/repo1')
  })

  it('handles rate limiting gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ 'retry-after': '60' }),
    })

    const repos = await searchGitHubForDeps('@thecryptodonkey/toll-booth')
    expect(repos).toEqual([])
  })
})
