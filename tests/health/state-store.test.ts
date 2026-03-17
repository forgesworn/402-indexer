import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StateStore } from '../../src/health/state-store.js'

const TEST_PATH = join(tmpdir(), `402-indexer-test-${Date.now()}.json`)

describe('StateStore', () => {
  afterEach(() => {
    if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH)
  })

  it('creates empty state when file does not exist', () => {
    const store = new StateStore(TEST_PATH)
    expect(store.getAll()).toEqual({})
  })

  it('loads existing state from file', () => {
    const existing = {
      entries: {
        'svc-1': { identifier: 'svc-1', failureCount: 3, lastChecked: '2026-03-17T00:00:00Z' },
      },
    }
    writeFileSync(TEST_PATH, JSON.stringify(existing))

    const store = new StateStore(TEST_PATH)
    const entry = store.get('svc-1')
    expect(entry?.failureCount).toBe(3)
  })

  it('records a success', () => {
    const store = new StateStore(TEST_PATH)
    store.recordSuccess('svc-1')

    const entry = store.get('svc-1')!
    expect(entry.failureCount).toBe(0)
    expect(entry.lastSuccess).toBeDefined()
  })

  it('records a failure and increments count', () => {
    const store = new StateStore(TEST_PATH)
    store.recordFailure('svc-1')
    store.recordFailure('svc-1')
    store.recordFailure('svc-1')

    expect(store.get('svc-1')!.failureCount).toBe(3)
  })

  it('resets failure count on success', () => {
    const store = new StateStore(TEST_PATH)
    store.recordFailure('svc-1')
    store.recordFailure('svc-1')
    store.recordSuccess('svc-1')

    expect(store.get('svc-1')!.failureCount).toBe(0)
  })

  it('persists state to file', () => {
    const store = new StateStore(TEST_PATH)
    store.recordSuccess('svc-1')
    store.save()

    const store2 = new StateStore(TEST_PATH)
    expect(store2.get('svc-1')).toBeDefined()
  })

  it('removes an entry', () => {
    const store = new StateStore(TEST_PATH)
    store.recordSuccess('svc-1')
    store.remove('svc-1')
    expect(store.get('svc-1')).toBeUndefined()
  })

  it('handles corrupted file gracefully', () => {
    writeFileSync(TEST_PATH, 'not json!!!')
    const store = new StateStore(TEST_PATH)
    expect(store.getAll()).toEqual({})
  })
})
