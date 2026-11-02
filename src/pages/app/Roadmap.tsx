import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { InfoNote, PageHeader } from '@/components/ui'
import { usePageTitle } from '@/hooks/usePageTitle'

const STAGES = [
  {
    number: '01',
    title: 'Foundation',
    status: 'Live',
    tone: 'live',
    copy:
      'Clinic sign-in, role-scoped access, local patient index, registration, returning-patient check-in, visit status, audit trail and an idempotent offline outbox.',
  },
  {
    number: '02',
    title: 'Triage support',
    status: 'Live',
    tone: 'live',
    copy:
      'Reads the presenting complaint plus any recorded observations and returns a 1–5 urgency level, danger signs, the observations to take and the next step. The level is a suggestion saved to the visit; the attending clinician sets the priority.',
  },
  {
    number: '03',
    title: 'Clinical scribe',
    status: 'Live',
    tone: 'live',
    copy:
      'Records the consultation in the browser, transcribes it and drafts a SOAP note that keeps patient-reported statements separate from clinician observations. Every note is reviewed before it is used.',
  },
  {
    number: '04',
    title: 'Paper record capture',
    status: 'Live',
    tone: 'live',
    copy:
      'Photograph a paper card or register page from the phone camera. Fields are extracted with per-field confidence and warnings, then a staff member confirms each value before registration.',
  },
  {
    number: '05',
    title: 'Outflow forecast',
    status: 'Live',
    tone: 'live',
    copy:
      'Learns this clinic’s arrival pattern from its own visits and optional aggregate daily-history CSV imports, then projects the next hours, the coming week, staffing, beds, equipment and the days that need referrals. Imported history is disclosed and evenly distributed over opening hours because no hourly breakdown is available.',
  },
  {
    number: '06',
    title: 'EHR integration',
    status: 'Configuration / test only',
    tone: 'next',
    copy:
      'An administrator can record an endpoint, encrypt an optional bearer credential and test FHIR metadata/REST reachability. This does not read patient data or write back; those capabilities require a vendor-specific connector, hospital approval and validation.',
  },
  {
    number: '07',
    title: 'Operations Assistant & history import',
    status: 'Live · aggregate only',
    tone: 'live',
    copy:
      'The Assistant answers queue, triage-workload, daily-activity and forecast questions using aggregate facility counts. Patient-level records are excluded from model requests; conversations are private to the signed-in user. Administrators may import aggregate CSV history for the forecast.',
  },
  {
    number: '08',
    title: 'Supervised pilot',
    status: 'Not started',
    tone: 'gated',
    copy:
      'Workflow discovery, staff training, DPIA/legal review, clinical validation of the triage thresholds, incident response, baseline measurement and a recovery-tested installation.',
  },
]

const STAGE_TONE: Record<string, string> = {
  live: 'tag tag--ok',
  next: 'tag tag--pending',
  gated: 'tag tag--warn',
}

export default function Roadmap() {
  usePageTitle('Build & limits')

  return (
    <div className="page roadmap-page">
      <PageHeader
        eyebrow="OPEN BUILD NOTES"
        title="Build & limits"
        description={
          <>
            <span>Clinical support live</span>
            <span className="dot-separator" />
            <span>Foundation + triage, scribe, OCR, forecast, aggregate Assistant</span>
            <span className="dot-separator" />
            <span>Updated with this build</span>
          </>
        }
        actions={
          <Link to="/app/sync" className="btn btn--outline btn--sm">
            <Icon name="sync" size={14} /> Sync limits
          </Link>
        }
      />

      <div className="roadmap-hero">
        <div>
          <p className="panel-kicker">INTENDED USE</p>
          <h2>Clinical support is live; the safety case is not.</h2>
          <p>
            Triage, the scribe, paper-record capture and the outflow forecast all run on this deployment and write to
            the audit trail. None of them has been clinically validated: thresholds, prompts and forecasts need local
            review, a supervised pilot and a measured baseline before they can carry weight in patient care.
          </p>
        </div>
        <div className="roadmap-hero-badge">
          <Icon name="shield" size={22} />
          <strong>LIVE</strong>
          <span>clinical support</span>
        </div>
      </div>

      <div className="roadmap-facts">
        <div className="roadmap-fact">
          <span>Runtime</span>
          <strong>React + Three.js</strong>
          <p>Web app served by a Node service on this server.</p>
        </div>
        <div className="roadmap-fact">
          <span>Local store</span>
          <strong>IndexedDB</strong>
          <p>Patient records and the outbox remain on the device.</p>
        </div>
        <div className="roadmap-fact">
          <span>Server store</span>
          <strong>SQLite + WAL</strong>
          <p>Server-side roles, audit events and idempotent sync.</p>
        </div>
        <div className="roadmap-fact">
          <span>External AI</span>
          <strong>Google Gemini</strong>
          <p>
            The complaint, recorded audio and photographed paper records are sent to the Gemini API for triage, the
            scribe and OCR. Nothing is sent to an analytics service.
          </p>
        </div>
      </div>

      <section className="roadmap-section">
        <div className="roadmap-section-head">
          <p className="panel-kicker">THE ROADMAP</p>
          <h2>What is real, what is next, what is gated.</h2>
        </div>
        <div className="stage-list">
          {STAGES.map((stage) => (
            <article className={`stage-item stage-item--${stage.tone}`} key={stage.number}>
              <span className="stage-number">{stage.number}</span>
              <div className="stage-body">
                <div className="stage-title-row">
                  <h3>{stage.title}</h3>
                  <span className={STAGE_TONE[stage.tone]}>{stage.status}</span>
                </div>
                <p>{stage.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="roadmap-two-col">
        <section className="panel roadmap-card">
          <p className="panel-kicker">IMPLEMENTED</p>
          <h2>What you can exercise now</h2>
          <ul className="check-list">
            <li>Create and search local patient records without internet.</li>
            <li>Review duplicate candidates before creating a record.</li>
            <li>Open, progress and complete visits with version checks.</li>
            <li>Queue writes in a browser outbox and retry them idempotently.</li>
            <li>Resolve version conflicts by accepting the server record or discarding an unsynced draft.</li>
            <li>Inspect audit events for workflow and sync mutations.</li>
            <li>Sign in with five distinct roles and verify permission boundaries.</li>
            <li>Change roles and deactivate accounts as an administrator.</li>
          </ul>
        </section>

        <section className="panel roadmap-card">
          <p className="panel-kicker">NOT IMPLEMENTED</p>
          <h2>What is deliberately absent</h2>
          <ul className="cross-list">
            <li>Clinically validated triage thresholds or a locally approved triage protocol.</li>
            <li>Prescriptions, medication orders, results or order entry.</li>
            <li>External EHR patient reads, data mapping, automated sync, or FHIR write-back.</li>
            <li>Patient-level conversational AI retrieval; the Assistant is aggregate-only.</li>
            <li>Automatic referrals — the forecast flags the day, staff decide.</li>
            <li>Offline AI: triage, OCR and the scribe need a connection to the model.</li>
            <li>Production backup, disaster recovery, retention policy and key rotation/custody.</li>
            <li>Multi-device conflict resolution beyond human review.</li>
          </ul>
        </section>
      </div>

      <section className="panel roadmap-security">
        <div className="roadmap-security-head">
          <div>
            <p className="panel-kicker">SECURITY &amp; DATA</p>
            <h2>Implemented controls and honest gaps.</h2>
          </div>
          <span className="roadmap-security-icon">
            <Icon name="lock" size={22} />
          </span>
        </div>
        <div className="security-grid">
          <div>
            <h3>In place</h3>
            <ul className="bullet-list">
              <li>HTTP-only same-site session cookies; sessions expire after 12 hours.</li>
              <li>Scrypt password hashing with unique salts; no plaintext credentials stored.</li>
              <li>Every API permission check is repeated on the server, not just hidden in the UI.</li>
              <li>Login rate limiting and an origin check for state-changing requests.</li>
              <li>Sign-out clears the local clinical cache from the browser.</li>
              <li>Audit detail excludes clinical narrative by design.</li>
              <li>A restrictive Content-Security-Policy and no third-party scripts.</li>
            </ul>
          </div>
          <div>
            <h3>Not production-ready</h3>
            <ul className="bullet-list">
              <li>Clinical AI output is not a validated device output and must be reviewed by a clinician.</li>
              <li>Local encryption-at-rest, device provisioning and key rotation are not implemented.</li>
              <li>Backup, restore drills, disaster recovery and retention policy are absent.</li>
              <li>Data-protection review (including applicable Nigerian law) has not been completed.</li>
              <li>Clinical validation, staff training, incident response and legal agreements are prerequisites.</li>
              <li>Accounts must be individually provisioned and protected before use with patient data.</li>
            </ul>
          </div>
        </div>
      </section>

      <div className="roadmap-footer">
        <InfoNote tone="warn">
          A convincing interface is not evidence of clinical safety. Do not present this build as an approved triage
          system, a validated medical device or a replacement for hospital policy.
        </InfoNote>
        <Link to="/app/sync" className="btn btn--outline btn--sm">
          Review sync behaviour <Icon name="arrow-right" size={14} />
        </Link>
      </div>
    </div>
  )
}
