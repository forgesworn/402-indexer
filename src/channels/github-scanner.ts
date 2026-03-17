
const IGNORED_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'npmjs.com',
  'www.npmjs.com',
  'registry.npmjs.org',
  'docs.github.com',
  'stackoverflow.com',
])

export interface GitHubRepo {
  fullName: string
  htmlUrl: string
}

/**
 * Extract potential API URLs from a README, filtering out known non-API hosts.
 */
export function extractUrlsFromReadme(content: string): string[] {
  const urlRegex = /https?:\/\/[^\s"'<>\])(,]+/g
  const matches = content.match(urlRegex) ?? []
  return matches.filter(url => {
    try {
      const hostname = new URL(url).hostname
      return !IGNORED_HOSTS.has(hostname)
    } catch {
      return false
    }
  })
}

/**
 * Search GitHub code search for repos depending on a given package.
 */
export async function searchGitHubForDeps(
  packageName: string,
  token?: string,
): Promise<GitHubRepo[]> {
  const query = encodeURIComponent(`"${packageName}" filename:package.json`)
  const url = `https://api.github.com/search/code?q=${query}&per_page=50`

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': '402-indexer/1.0 (+https://402.pub)',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const response = await fetch(url, { headers })
    if (!response.ok) return []

    const data = await response.json() as { items?: { repository?: { full_name: string; html_url: string } }[] }
    const seen = new Set<string>()
    const repos: GitHubRepo[] = []

    for (const item of data.items ?? []) {
      const repo = item.repository
      if (!repo || seen.has(repo.full_name)) continue
      seen.add(repo.full_name)
      repos.push({ fullName: repo.full_name, htmlUrl: repo.html_url })
    }

    return repos
  } catch {
    return []
  }
}

/**
 * Fetch a repo's README and extract potential API URLs.
 */
export async function extractUrlsFromRepo(
  fullName: string,
  token?: string,
): Promise<string[]> {
  const url = `https://api.github.com/repos/${fullName}/readme`
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3.raw',
    'User-Agent': '402-indexer/1.0 (+https://402.pub)',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const response = await fetch(url, { headers })
    if (!response.ok) return []
    const content = await response.text()
    return extractUrlsFromReadme(content)
  } catch {
    return []
  }
}

/** Default dependency markers to search for */
export const DEPENDENCY_MARKERS = [
  '@thecryptodonkey/toll-booth',
  '402-announce',
  '@coinbase/x402',
  'x402-js',
  'lsat-js',
  'lnurl',
  'aperture',
]

/**
 * Run a full GitHub scan across all dependency markers.
 * Returns a deduplicated list of URLs to probe.
 */
export async function runGitHubScan(token?: string): Promise<string[]> {
  const allUrls = new Set<string>()

  for (const marker of DEPENDENCY_MARKERS) {
    const repos = await searchGitHubForDeps(marker, token)
    for (const repo of repos) {
      const urls = await extractUrlsFromRepo(repo.fullName, token)
      for (const url of urls) {
        allUrls.add(url)
      }
    }
    // Respect rate limits
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  return [...allUrls]
}
