import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import {
  SceneBoundary,
  useDocumentVisible,
  useOnScreen,
  useWebGLAvailable,
} from '@/scene/scene-support'
import { TwinQueueSimulation, type SimSnapshot } from '@/scene/twin-queue'

const QueueSimulationScene = lazy(() => import('@/scene/QueueSimulationScene'))

function initialSnapshot(sim: TwinQueueSimulation): SimSnapshot {
  return sim.snapshot()
}

export function QueueSimulation() {
  const [sim] = useState(() => new TwinQueueSimulation())
  const [stats, setStats] = useState<SimSnapshot>(() => initialSnapshot(sim))
  const [paused, setPaused] = useState(false)
  const [hasPlayed, setHasPlayed] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const onScreen = useOnScreen(stageRef, '120px')
  const documentVisible = useDocumentVisible()
  const webgl = useWebGLAvailable()
  const active = onScreen && documentVisible

  useEffect(() => {
    if (active) setHasPlayed(true)
  }, [active])

  // The simulation advances on a wall-clock loop, independent of render frame
  // rate. The 3D scene is a view over this state, so a slow GPU or a missing
  // WebGL context never changes the simulation's outcome. The cap only guards
  // against a long stall or a sleeping tab, not ordinary slow frames.
  useEffect(() => {
    let last = performance.now()
    const interval = window.setInterval(() => {
      const now = performance.now()
      const delta = Math.min((now - last) / 1000, 0.75)
      last = now
      if (active) sim.step(delta)
      setStats(sim.snapshot())
    }, 33)
    return () => window.clearInterval(interval)
  }, [active, sim])

  const togglePaused = () => {
    sim.paused = !sim.paused
    setPaused(sim.paused)
    setStats(sim.snapshot())
  }

  const restart = () => {
    sim.reset(true)
    sim.paused = false
    setPaused(false)
    setStats(sim.snapshot())
  }

  const paperStatus = stats.paper.waiting >= 8 ? 'Queue building' : stats.paper.waiting > 2 ? 'Slow moving' : 'Moving'
  const afribokStatus = stats.afribok.waiting >= 8 ? 'Queue building' : stats.afribok.waiting > 2 ? 'Slow moving' : 'Moving'
  const progress = Math.round(stats.cycleProgress * 100)
  const difference = useMemo(
    () => stats.paper.waiting - stats.afribok.waiting,
    [stats.paper.waiting, stats.afribok.waiting],
  )

  return (
    <div className="sim-shell">
      <div
        className="sim-stage"
        ref={stageRef}
        data-sim-active={String(active)}
        data-sim-elapsed={stats.elapsed.toFixed(1)}
        data-sim-arrivals={stats.totalArrivals}
        data-sim-webgl={String(webgl)}
      >
        <div className="sim-scene-bg" />
        <div className="sim-vignette" />
        {webgl ? (
          <SceneBoundary fallback={null}>
            <Suspense fallback={null}>
              <div className={`sim-canvas ${hasPlayed ? 'is-visible' : ''}`}>
                {active && <QueueSimulationScene sim={sim} />}
              </div>
            </Suspense>
          </SceneBoundary>
        ) : (
          <div className="sim-no-webgl">
            <Icon name="info" size={16} />
            3D rendering is unavailable in this browser. The simulation is still running in the counters.
          </div>
        )}

        <div className="sim-hud">
          <div className="sim-lane sim-lane--paper">
            <div className="sim-lane-top">
              <span className="sim-lane-label">PAPER &amp; QUEUES</span>
              <span className={`sim-state ${stats.paper.waiting >= 8 ? 'sim-state--busy' : ''}`}>
                <span className="sim-state-dot" />
                {paperStatus}
              </span>
            </div>
            <div className="sim-lane-numbers">
              <span>
                <strong>{stats.paper.waiting}</strong>
                <small>still waiting</small>
              </span>
              <span>
                <strong>{stats.paper.seen}</strong>
                <small>seen</small>
              </span>
            </div>
            <div className="sim-meter">
              <span style={{ width: `${Math.min(100, stats.paper.waiting * 5)}%` }} />
            </div>
          </div>

          <div className="sim-lane sim-lane--afribok">
            <div className="sim-lane-top">
              <span className="sim-lane-label">AFRIBOK CHECK-IN</span>
              <span className={`sim-state sim-state--ok ${stats.afribok.waiting >= 8 ? 'sim-state--busy' : ''}`}>
                <span className="sim-state-dot" />
                {afribokStatus}
              </span>
            </div>
            <div className="sim-lane-numbers">
              <span>
                <strong>{stats.afribok.waiting}</strong>
                <small>still waiting</small>
              </span>
              <span>
                <strong>{stats.afribok.seen}</strong>
                <small>seen</small>
              </span>
            </div>
            <div className="sim-meter sim-meter--ok">
              <span style={{ width: `${Math.min(100, stats.afribok.waiting * 5)}%` }} />
            </div>
          </div>
        </div>

        <div className="sim-gap" data-sim-gap={Math.max(0, difference)}>
          <strong>{Math.max(0, difference)}</strong>
          <span>
            fewer waiting
            <br />
            with Afribok
          </span>
        </div>

        <div className="sim-bottom">
          <div className="sim-controls">
            <button
              type="button"
              className="sim-control"
              onClick={togglePaused}
              aria-label={paused ? 'Resume simulation' : 'Pause simulation'}
            >
              <Icon name={paused ? 'play' : 'pause'} size={15} />
              {paused ? 'Play' : 'Pause'}
            </button>
            <button type="button" className="sim-control" onClick={restart}>
              <Icon name="restart" size={15} />
              Restart
            </button>
            <span className="sim-cycle">
              Cycle {stats.cycle} · {Math.min(59, Math.floor(stats.elapsed))}s · same arrivals ·{' '}
              {stats.totalArrivals}/24
            </span>
          </div>
          <div className="sim-progress" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <div className="sim-foot">
        <p>
          <strong>Illustrative simulation.</strong> Both lanes start with a typical morning backlog and receive the
          same 24 simulated arrivals. Registration and consultation times are illustrative inputs — not measured
          hospital data or a claim about Afribok&apos;s impact.
        </p>
        <span className="sim-legend">
          <span className="sim-legend-dot sim-legend-dot--paper" /> paper workflow
          <span className="sim-legend-dot sim-legend-dot--afribok" /> Afribok workflow
        </span>
      </div>
    </div>
  )
}
