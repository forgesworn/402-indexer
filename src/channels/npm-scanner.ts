
export interface NpmDependent {
  name: string
  repositoryUrl?: string
}

/**
 * Search npm registry for packages that depend on a given package.
 * Uses the npm search API (limited, but avoids scraping).
 */
export async function searchNpmDependents(packageName: string): Promise<NpmDependent[]> {
  const query = encodeURIComponent(packageName)
  const url = `https://registry.npmjs.org/-/v1/search?text=dependencies:${query}&size=100`

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': '402-indexer/1.0 (+https://402.pub)' },
    })
    if (!response.ok) return []

    const data = await response.json() as {
      objects?: { package: { name: string; links?: { repository?: string } } }[]
    }

    return (data.objects ?? []).map(obj => ({
      name: obj.package.name,
      repositoryUrl: obj.package.links?.repository,
    }))
  } catch {
    return []
  }
}

/** Default packages to check for dependents */
export const NPM_PACKAGES = [
  '@thecryptodonkey/toll-booth',
  '402-announce',
]

/**
 * Run a full npm scan across all tracked packages.
 * Returns repository URLs to cross-reference with GitHub scanner.
 */
export async function runNpmScan(): Promise<string[]> {
  const repoUrls = new Set<string>()

  for (const pkg of NPM_PACKAGES) {
    const deps = await searchNpmDependents(pkg)
    for (const dep of deps) {
      if (dep.repositoryUrl) repoUrls.add(dep.repositoryUrl)
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  return [...repoUrls]
}
