import { describe, it, expect, vi } from 'vitest'
import { scheduleTask } from '../src/orchestrator.js'

describe('scheduleTask', () => {
  it('runs immediately then schedules at interval', async () => {
    vi.useFakeTimers()
    const fn = vi.fn().mockResolvedValue(undefined)

    const stop = scheduleTask('test', fn, 10_000)

    // Should run immediately
    await vi.advanceTimersByTimeAsync(0)
    expect(fn).toHaveBeenCalledTimes(1)

    // Should run again after interval
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fn).toHaveBeenCalledTimes(2)

    stop()
    vi.useRealTimers()
  })
})
