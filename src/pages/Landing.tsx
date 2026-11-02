import { lazy, Suspense, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '@/components/Brand'
import { Icon } from '@/components/Icon'
import { QueueSimulation } from '@/components/QueueSimulation'
import { SavannaFallback } from '@/components/SavannaFallback'
import { useReveal } from '@/hooks/useReveal'
import { AFRICA_PATH, AFRICA_VIEWBOX } from '@/data/africa'
import { SceneBoundary, useDocumentVisible, useOnScreen, useWebGLAvailable } from '@/scene/scene-support'

const SavannaScene = lazy(() => import('@/scene/SavannaScene'))

function LandingHero() {
  const heroRef = useRef<HTMLElement>(null)
  const onScreen = useOnScreen(heroRef, '0px')
  const documentVisible = useDocumentVisible()
  const webgl = useWebGLAvailable()
  const active = onScreen && documentVisible

  return (
    <section className="hero" ref={heroRef} aria-labelledby="hero-title">
      <SavannaFallback />
      {webgl && (
        <SceneBoundary fallback={null}>
          <Suspense fallback={null}>
            <div className="hero-canvas">{active && <SavannaScene active={active} />}</div>
          </Suspense>
        </SceneBoundary>
      )}
      <div className="hero-shade" />
      <div className="grain" />

      <header className="landing-nav">
        <Brand variant="light" />
        <nav className="landing-links" aria-label="Primary">
          <a href="#problem">Why Afribok</a>
          <a href="#simulation">Queue simulation</a>
          <a href="#built">Build status</a>
        </nav>
        <Link to="/login" className="btn btn--light btn--sm landing-nav-cta">
          Clinic sign-in
          <Icon name="arrow-up-right" size={15} />
        </Link>
      </header>

      <div className="hero-inner">
        <div className="hero-copy">
          <p className="hero-kicker">
            <span className="hero-kicker-line" />
            AFRIBOK · VERTEX AUTOMATIONS
          </p>
          <h1 id="hero-title">
            <span>Care that</span>
            <em>keeps moving.</em>
          </h1>
          <p className="hero-lead">
            An offline-first clinical workspace for African public hospitals. Built around the work already
            happening in the ward — so the network is never the reason a patient waits.
          </p>
          <div className="hero-actions">
            <Link to="/login" className="btn btn--ember">
              Enter the clinic
              <Icon name="arrow-right" size={17} />
            </Link>
            <a href="#simulation" className="btn btn--light">
              See the queue move
              <Icon name="play" size={14} />
            </a>
          </div>
          <div className="hero-trust">
            <span>OFFLINE-FIRST CLINICAL WORKSPACE</span>
            <span className="hero-trust-dot" />
            <span>LOCAL-FIRST RECORDS</span>
            <span className="hero-trust-dot" />
            <span>OFFLINE-FIRST</span>
          </div>
        </div>

        <aside className="hero-aside" aria-label="About this scene">
          <span className="hero-aside-index">01 / SAVANNA</span>
          <p>
            A living scene, rendered in your browser. No stock footage. No borrowed landscapes.
          </p>
          <div className="hero-aside-rule" />
          <span className="hero-aside-meta">WebGL · procedural · 60 fps target</span>
        </aside>
      </div>

      <div className="hero-foot">
        <span>AFRIBOK · CLINICAL WORKFLOW, UNINTERRUPTED</span>
        <a href="#problem" className="hero-scroll">
          <span>Scroll to begin</span>
          <span className="hero-scroll-line" />
        </a>
        <span className="hero-foot-right">AFRIBOK · CARE THAT KEEPS MOVING</span>
      </div>
    </section>
  )
}

export default function Landing() {
  useReveal()

  return (
    <div className="landing">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <LandingHero />

      <main id="main">
        <section className="manifesto" id="problem" aria-labelledby="manifesto-title">
          <div className="container">
            <div className="section-top">
              <p className="eyebrow">THE POINT</p>
              <span className="section-index">01 / THE POINT</span>
            </div>
            <div className="manifesto-head">
              <h2 id="manifesto-title" data-reveal>
                Every avoidable minute in a queue is a minute <em>taken from care.</em>
              </h2>
              <div className="manifesto-intro" data-reveal data-reveal-delay="1">
                <p>
                  The delays are ordinary. A paper file that must be found. A name written again. A record that
                  cannot be reached because the signal dropped.
                </p>
                <p>
                  Afribok begins with those minutes — not with a promise to replace the people doing the work.
                </p>
              </div>
            </div>

            <div className="principles">
              <article className="principle" data-reveal>
                <span className="principle-number">01</span>
                <div>
                  <h3>Workflow before software.</h3>
                  <p>
                    Registration stays registration. Afribok fits the steps a hospital already uses, rather than
                    inventing another desk, another queue or another form to fill.
                  </p>
                </div>
              </article>
              <article className="principle" data-reveal data-reveal-delay="1">
                <span className="principle-number">02</span>
                <div>
                  <h3>Offline is the default.</h3>
                  <p>
                    Records, check-in and the audit trail are written to the device first. Sync is a background
                    job with retries — never a condition for care.
                  </p>
                </div>
              </article>
              <article className="principle" data-reveal data-reveal-delay="2">
                <span className="principle-number">03</span>
                <div>
                  <h3>A human stays in charge.</h3>
                  <p>
                    Afribok can surface, suggest and remember. It does not auto-merge patients, invent clinical
                    facts, or make the final clinical decision.
                  </p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="sim-section" id="simulation" aria-labelledby="simulation-title">
          <div className="container">
            <div className="section-top section-top--light">
              <p className="eyebrow eyebrow--light">LIVE 3D SIMULATION</p>
              <span className="section-index">02 / THE QUEUE</span>
            </div>
            <div className="sim-head">
              <h2 id="simulation-title" data-reveal>
                Watch what
                <br />
                <em>a queue costs.</em>
              </h2>
              <div className="sim-intro" data-reveal data-reveal-delay="1">
                <p>
                  Two clinics. The same arrivals, the same people, the same care area. Both start with a morning
                  backlog; the only difference is how the front desk works.
                </p>
                <p className="sim-intro-note">
                  One lane keeps paperwork. The other uses Afribok&apos;s local-first check-in. Watch the waiting
                  area respond.
                </p>
              </div>
            </div>

            <div data-reveal data-reveal-delay="1">
              <QueueSimulation />
            </div>
          </div>
        </section>

        <section className="africa-section" id="continent" aria-labelledby="africa-title">
          <div className="container africa-grid">
            <div className="africa-copy" data-reveal>
              <div className="section-top section-top--plain">
                <p className="eyebrow">BUILT FOR THE CONTINENT</p>
                <span className="section-index">03 / THE CONTEXT</span>
              </div>
              <h2 id="africa-title">
                A continent-sized problem.
                <br />
                <em>A ward-sized place to start.</em>
              </h2>
              <p className="africa-lead">
                Afribok is designed for the hospital that exists today: paper records, intermittent power,
                shared devices, busy registration areas and an existing hospital system that is not going
                anywhere.
              </p>

              <ul className="africa-features">
                <li>
                  <span className="feature-index">01</span>
                  <div>
                    <h3>Records that stay.</h3>
                    <p>
                      Patient search, registration and visits work from local storage. The server catches up when
                      there is a connection.
                    </p>
                  </div>
                </li>
                <li>
                  <span className="feature-index">02</span>
                  <div>
                    <h3>Identity with a pause.</h3>
                    <p>
                      Possible duplicate records are scored and shown to staff. Afribok never merges two patients
                      automatically.
                    </p>
                  </div>
                </li>
                <li>
                  <span className="feature-index">03</span>
                  <div>
                    <h3>A trail that survives.</h3>
                    <p>
                      Who created or changed a record, and when, is written to an audit trail with idempotent sync
                      operation IDs.
                    </p>
                  </div>
                </li>
                <li>
                  <span className="feature-index">04</span>
                  <div>
                    <h3>Nothing invented.</h3>
                    <p>
                      This stage captures identity, visits and presenting complaints. Clinical AI, triage and
                      automation are visibly switched off rather than faked.
                    </p>
                  </div>
                </li>
              </ul>
            </div>

            <div className="africa-visual" data-reveal data-reveal-delay="1">
              <div className="map-frame">
                <span className="map-label map-label--top">AFRICA / 54 COUNTRIES</span>
                <span className="map-label map-label--bottom">NATURAL EARTH · 1:50M</span>
                <svg
                  className="africa-map"
                  viewBox={AFRICA_VIEWBOX}
                  role="img"
                  aria-label="Illustrated outline of the African continent"
                >
                  <defs>
                    <pattern id="africa-dots" width="1.5" height="1.5" patternUnits="userSpaceOnUse">
                      <circle cx="0.55" cy="0.55" r="0.26" fill="#bd5731" opacity="0.72" />
                    </pattern>
                    <linearGradient id="africa-wash" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#e9c79b" stopOpacity="0.34" />
                      <stop offset="0.55" stopColor="#c2774d" stopOpacity="0.16" />
                      <stop offset="1" stopColor="#2f5d49" stopOpacity="0.18" />
                    </linearGradient>
                    <filter id="africa-glow" x="-30%" y="-30%" width="160%" height="160%">
                      <feGaussianBlur stdDeviation="1.4" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <path d={AFRICA_PATH} fill="url(#africa-wash)" stroke="none" />
                  <path d={AFRICA_PATH} fill="url(#africa-dots)" stroke="none" opacity="0.9" />
                  <path
                    d={AFRICA_PATH}
                    fill="none"
                    stroke="#9b4c2c"
                    strokeWidth="0.35"
                    opacity="0.55"
                    filter="url(#africa-glow)"
                  />
                </svg>
                <div className="map-orbit map-orbit--one" />
                <div className="map-orbit map-orbit--two" />
                <p className="map-caption">
                  The map is an illustration, not a coverage claim. Afribok has not yet been deployed in a
                  hospital.
                </p>
              </div>
              <div className="map-quote">
                <span className="map-quote-mark">“</span>
                <p>
                  Software should not turn a network outage into a clinical one.
                </p>
                <span className="map-quote-by">AFRIBOK DESIGN PRINCIPLE</span>
              </div>
            </div>
          </div>
        </section>

        <section className="build-section" id="built" aria-labelledby="build-title">
          <div className="container">
            <div className="section-top section-top--light">
              <p className="eyebrow eyebrow--light">THE HONEST BUILD</p>
              <span className="section-index">04 / THE BUILD</span>
            </div>
            <div className="build-head">
              <h2 id="build-title" data-reveal>
                A working foundation.
                <br />
                <em>Not a theatre set.</em>
              </h2>
              <p data-reveal data-reveal-delay="1">
                Afribok is being built in stages. The sections below distinguish what runs today from what is
                designed, from what cannot honestly be switched on without clinician-approved protocols.
              </p>
            </div>

            <div className="build-grid">
              <article className="build-column build-column--live" data-reveal>
                <div className="build-column-head">
                  <span className="status-pulse" />
                  <h3>Working now</h3>
                  <span className="build-stage">STAGE 1</span>
                </div>
                <ul>
                  <li>Clinic email and password sign-in</li>
                  <li>Local-first patient search and registration</li>
                  <li>Returning-patient check-in and visits</li>
                  <li>Duplicate candidates, reviewed by staff</li>
                  <li>Role-scoped access and session handling</li>
                  <li>Audit trail for changes and sync events</li>
                  <li>Offline outbox with retries and conflict states</li>
                  <li>SQLite server store + device-local mirror</li>
                </ul>
              </article>

              <article className="build-column" data-reveal data-reveal-delay="1">
                <div className="build-column-head">
                  <span className="status-ring" />
                  <h3>In the queue</h3>
                  <span className="build-stage">NOT BUILT YET</span>
                </div>
                <ul>
                  <li>Voice-assisted registration</li>
                  <li>Speech transcription and clinical scribe</li>
                  <li>Paper-record photography and OCR</li>
                  <li>Document review and source preservation</li>
                  <li>EHR and hospital-system adapters</li>
                  <li>Demand forecasting and operational analytics</li>
                </ul>
                <p className="build-small">
                  These modules are not exposed as buttons. The roadmap inside the workspace tracks them openly.
                </p>
              </article>

              <article className="build-column" data-reveal data-reveal-delay="2">
                <div className="build-column-head">
                  <span className="status-ring status-ring--clay" />
                  <h3>Governance-gated</h3>
                  <span className="build-stage">CLINICAL REVIEW</span>
                </div>
                <ul>
                  <li>Danger-sign escalation and triage support</li>
                  <li>Clinical rules engine and thresholds</li>
                  <li>AI-influenced clinical documentation</li>
                  <li>Write-back into live hospital records</li>
                  <li>Real-patient pilot deployment</li>
                </ul>
                <p className="build-small">
                  Afribok is not a medical device, is not clinically validated and must not be used for care in
                  this build.
                </p>
              </article>
            </div>

            <div className="build-cta">
              <div>
                <p className="eyebrow eyebrow--light">THE LIVE WORKSPACE</p>
                <h3>Walk the Stage 1 workflow yourself.</h3>
                <p>Registration, returning patients, offline queue, audit and role-based access. Built for secure clinic workflows.</p>
              </div>
              <Link to="/login" className="btn btn--ember">
                Enter the clinic
                <Icon name="arrow-right" size={17} />
              </Link>
            </div>
          </div>
        </section>

        <section className="closing" aria-labelledby="closing-title">
          <div className="container closing-inner">
            <div data-reveal>
              <p className="eyebrow">AFRIBOK · VERTEX AUTOMATIONS</p>
              <h2 id="closing-title">
                The first minute should not depend
                <br />
                on the network.
              </h2>
            </div>
            <div className="closing-actions" data-reveal data-reveal-delay="1">
              <Link to="/login" className="btn btn--solid">
                Sign in to the clinic
                <Icon name="lock" size={15} />
              </Link>
              <p>Clinic accounts use an email and password. Use the credentials issued by your facility.</p>
            </div>
          </div>
        </section>
      </main>
<footer className="landing-footer">
        <div className="container footer-inner">
          <Brand variant="light" compact />
          <div className="footer-meta">
            <span>VERTEX AUTOMATIONS · 2026</span>
            <span>AFRIBOK · CARE THAT KEEPS MOVING</span>
            <Link to="/login">Clinic sign-in</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}