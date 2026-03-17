import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_DIR = join(__dirname, '..', 'config')

export interface IndexerConfig {
  secretKey: string
  githubToken?: string
  seedUrls: string[]
  subscribeRelays: string[]
  publishRelays: string[]
  probeIntervalMs: number
  scanIntervalMs: number
  healthCheckIntervalMs: number
  healthStatePath: string
  userAgent: string
}

export function loadConfig(): IndexerConfig {
  const secretKey = process.env.INDEXER_SECRET_KEY
  if (!secretKey) {
    throw new Error('INDEXER_SECRET_KEY environment variable is required')
  }
  if (!/^[0-9a-f]{64}$/i.test(secretKey)) {
    throw new Error('INDEXER_SECRET_KEY must be a 64-character hex string')
  }

  let seedUrls: string[] = []
  // Load all seed URL files from config directory
  for (const seedFile of ['seed-urls.json', 'x402-seeds.json']) {
    try {
      const urls = JSON.parse(readFileSync(join(CONFIG_DIR, seedFile), 'utf-8'))
      if (Array.isArray(urls)) seedUrls.push(...urls)
    } catch {
      // Seed file not found — skip
    }
  }
  // Deduplicate
  seedUrls = [...new Set(seedUrls)]

  let relayConfig = { subscribe: [] as string[], publish: [] as string[] }
  try {
    relayConfig = JSON.parse(readFileSync(join(CONFIG_DIR, 'relays.json'), 'utf-8'))
  } catch {
    // No relays configured
  }

  return {
    secretKey,
    githubToken: process.env.GITHUB_TOKEN,
    seedUrls,
    subscribeRelays: relayConfig.subscribe,
    publishRelays: relayConfig.publish,
    probeIntervalMs: 24 * 60 * 60 * 1000,       // 24 hours
    scanIntervalMs: 7 * 24 * 60 * 60 * 1000,     // 7 days
    healthCheckIntervalMs: 24 * 60 * 60 * 1000,   // 24 hours
    healthStatePath: process.env.HEALTH_STATE_PATH ?? 'health-state.json',
    userAgent: '402-indexer/1.0 (+https://402.pub)',
  }
}
