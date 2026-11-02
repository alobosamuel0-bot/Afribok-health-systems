import { describe, expect, it } from 'vitest'
import { TwinQueueSimulation } from '../src/scene/twin-queue'

function run(sim: TwinQueueSimulation, seconds: number, step = 0.05) {
  for (let elapsed = 0; elapsed < seconds; elapsed += step) sim.step(step)
}

describe('landing page queue simulation', () => {
  it('opens with a visible backlog on the paper lane and almost none on Afribok', () => {
    const sim = new TwinQueueSimulation()
    const snapshot = sim.snapshot()

    expect(snapshot.paper.waiting).toBeGreaterThanOrEqual(7)
    expect(snapshot.afribok.waiting).toBeLessThanOrEqual(1)
    expect(snapshot.paper.waiting - snapshot.afribok.waiting).toBeGreaterThanOrEqual(6)
    expect(snapshot.paper.inService).toBe(1)
    expect(snapshot.afribok.inService).toBe(1)
    expect(snapshot.totalArrivals).toBe(0)
    expect(snapshot.elapsed).toBe(0)
  })

  it('keeps the Afribok waiting area shorter as the same patients arrive', () => {
    const sim = new TwinQueueSimulation()
    run(sim, 12)
    const snapshot = sim.snapshot()

    expect(snapshot.totalArrivals).toBeGreaterThanOrEqual(5)
    expect(snapshot.paper.waiting).toBeGreaterThan(snapshot.afribok.waiting + 3)
    expect(snapshot.afribok.seen).toBeGreaterThan(snapshot.paper.seen)
  })

  it('restores a clean, warm-started cycle on restart', () => {
    const sim = new TwinQueueSimulation()
    run(sim, 8)
    expect(sim.agents.length).toBeGreaterThan(0)

    sim.reset(true)
    const snapshot = sim.snapshot()
    expect(snapshot.cycle).toBe(2)
    expect(snapshot.elapsed).toBe(0)
    expect(snapshot.paper.seen).toBe(0)
    expect(snapshot.afribok.seen).toBe(0)
    expect(snapshot.paper.waiting).toBeGreaterThanOrEqual(7)
    expect(sim.paused).toBe(false)
  })
})
