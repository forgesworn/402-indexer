import { readFileSync, writeFileSync } from 'node:fs'
import type { HealthEntry, HealthState } from '../types.js'

/**
 * Persists health check state (failure counts, timestamps) to a JSON file.
 * Survives process restarts.
 */
export class StateStore {
  private state: HealthState
  private readonly path: string

  constructor(path: string) {
    this.path = path
    this.state = this.load()
  }

  private load(): HealthState {
    try {
      const raw = readFileSync(this.path, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed?.entries && typeof parsed.entries === 'object') {
        return parsed as HealthState
      }
      return { entries: {} }
    } catch {
      return { entries: {} }
    }
  }

  get(identifier: string): HealthEntry | undefined {
    return this.state.entries[identifier]
  }

  getAll(): Record<string, HealthEntry> {
    return this.state.entries
  }

  recordSuccess(identifier: string): void {
    const now = new Date().toISOString()
    this.state.entries[identifier] = {
      identifier,
      failureCount: 0,
      lastSuccess: now,
      lastChecked: now,
    }
  }

  recordFailure(identifier: string): void {
    const now = new Date().toISOString()
    const existing = this.state.entries[identifier]
    this.state.entries[identifier] = {
      identifier,
      failureCount: (existing?.failureCount ?? 0) + 1,
      lastSuccess: existing?.lastSuccess,
      lastChecked: now,
    }
  }

  remove(identifier: string): void {
    delete this.state.entries[identifier]
  }

  save(): void {
    writeFileSync(this.path, JSON.stringify(this.state, null, 2))
  }
}
