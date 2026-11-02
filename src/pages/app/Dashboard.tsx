import { Link } from 'react-router-dom'
import { can } from '@shared/types'
import { Icon, type IconName } from '@/components/Icon'
import { Avatar, EmptyState, MeterRow, PageHeader, StatusTag, SyncTag } from '@/components/ui'
import { EncounterActions } from '@/components/EncounterActions'
import { TriageBadge } from '@/components/TriagePanel'
import { useAuth } from '@/auth/AuthProvider'
import { useWorkspace } from '@/workspace/WorkspaceProvider'
import { usePageTitle } from '@/hooks/usePageTitle'
import {
  ageOf,
  formatDateTime,
  isSameLocalDay,
  plural,
  waitingFor,
} from '@/lib/format'

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function Dashboard() {
  usePageTitle('Dashboard')
  const { user } = useAuth()
  const { patients, encounters, facility, pendingCount, conflictCount, lastSyncAt, online, serverReachable, syncing } =
    useWorkspace()

  const patientById = new Map(patients.map((patient) => [patient.id, patient]))
  const active = encounters
    .filter((encounter) => encounter.status !== 'completed')
    .sort((a, b) => {
      const levelA = a.triage?.level ?? 9
      const levelB = b.triage?.level ?? 9
      if (levelA !== levelB) return levelA - levelB
      return a.arrivedAt.localeCompare(b.arrivedAt)
    })
  const activeEncounters = encounters.filter((encounter) => encounter.status !== 'completed')
  const waiting = activeEncounters.filter((encounter) => encounter.status === 'waiting').length
  const inConsultation = activeEncounters.filter((encounter) => encounter.status === 'in_consultation').length
  const registeredToday = patients.filter((patient) => isSameLocalDay(patient.createdAt)).length
  const completedToday = encounters.filter(
    (encounter) => encounter.status === 'completed' && isSameLocalDay(encounter.arrivedAt),
  ).length
  const todayTotal = waiting + inConsultation + completedToday
  const triagedToday = encounters.filter(
    (encounter) => encounter.triage && isSameLocalDay(encounter.triage.assessedAt),
  ).length
  const highUrgency = activeEncounters.filter(
    (encounter) => encounter.triage && encounter.triage.level <= 2,
  ).length
  const conflicts = conflictCount
  const offline = !online || serverReachable === false
  const firstName = user?.name.replace(/^Dr\.?\s+/i, '').split(' ')[0] ?? ''
  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date())

  return (
    <div className="page dashboard">
      <PageHeader
        eyebrow={`${facility.name} · ${facility.mode}`}
        title={`${greeting()}, ${firstName}.`}
        description={
          <>
            <span>{dateLabel}</span>
            <span className="dot-separator" />
            <span>{active.length > 0 ? `${plural(active.length, 'open visit')} in the workspace` : 'No open visits right now'}</span>
            {offline && (
              <>
                <span className="dot-separator" />
                <span className="inline-status">
                  <Icon name="wifi-off" size={13} /> Local mode
                </span>
              </>
            )}
          </>
        }
        actions={
          <>
            <Link to="/app/patients" className="btn btn--outline btn--sm">
              <Icon name="search" size={15} />
              Find a patient
            </Link>
            {can(user?.role, 'patient.create') && (
              <Link to="/app/register" className="btn btn--solid btn--sm">
                <Icon name="plus" size={15} />
                Register patient
              </Link>
            )}
          </>
        }
      />

      {conflicts > 0 && (
        <Link to="/app/sync" className="dashboard-alert">
          <span className="dashboard-alert-icon">
            <Icon name="alert" size={17} />
          </span>
          <span>
            <strong>{plural(conflicts, 'change')} need your review.</strong> A sync conflict or rejection is waiting in
            the sync centre.
          </span>
          <Icon name="arrow-right" size={16} />
        </Link>
      )}

      {patients.length === 0 && encounters.length === 0 && (
        <div className="dashboard-onboarding">
          <EmptyState
            icon="patients"
            title="This device has no patient records yet."
            copy="Register a patient to begin the registration, visit and offline sync workflow."
            action={
              can(user?.role, 'patient.create') ? (
                <Link to="/app/register" className="btn btn--solid btn--sm">
                  Register a patient
                </Link>
              ) : (
                <Link to="/app/predictive" className="btn btn--outline btn--sm">
                  Open predictive engine
                </Link>
              )
            }
          />
        </div>
      )}

      <section className="stat-grid" aria-label="Today at a glance">
        <article className="stat-card stat-card--accent">
          <span className="stat-label">Waiting now</span>
          <strong className="stat-value">{waiting}</strong>
          <span className="stat-foot">{waiting > 0 ? 'Operational count · not triage' : 'No one in the waiting area'}</span>
          <span className="stat-mark">
            <Icon name="clock" size={18} />
          </span>
        </article>
        <article className="stat-card">
          <span className="stat-label">In consultation</span>
          <strong className="stat-value">{inConsultation}</strong>
          <span className="stat-foot">{inConsultation > 0 ? 'Open clinical visits' : 'No active consultations'}</span>
          <span className="stat-mark">
            <Icon name="stethoscope" size={18} />
          </span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Registered today</span>
          <strong className="stat-value">{registeredToday}</strong>
          <span className="stat-foot">Records created on this device</span>
          <span className="stat-mark">
            <Icon name="patients" size={18} />
          </span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Completed today</span>
          <strong className="stat-value">{completedToday}</strong>
          <span className="stat-foot">Visits started and closed today</span>
          <span className="stat-mark">
            <Icon name="check" size={18} />
          </span>
        </article>
      </section>

      <section className="dashboard-workflows" aria-labelledby="dashboard-workflows-title">
        <div className="dashboard-workflows-head">
          <div>
            <p className="panel-kicker">YOUR HOSPITAL WORKSPACE</p>
            <h2 id="dashboard-workflows-title">Clinical workflows</h2>
            <p>Module status reflects this hospital’s onboarding answers and your account permissions.</p>
          </div>
          {can(user?.role, 'team.manage') && (
            <Link to="/setup" className="panel-link">Review hospital setup <Icon name="arrow-right" size={13} /></Link>
          )}
        </div>
        <div className="dashboard-module-grid">
          <WorkflowCard
            number="01" icon="camera" title="OCR & patient intake"
            description="Scan a paper record, review extracted fields, and register or check in a patient."
            status={can(user?.role, 'patient.create') ? 'Ready · local-first registration' : 'Patient search only · registration restricted'}
            to={can(user?.role, 'patient.create') ? '/app/register' : '/app/patients'}
          />
          <WorkflowCard
            number="02" icon="wave" title="AI triage"
            description="Review a visit’s complaint and recorded observations; the attending clinician sets priority."
            status={can(user?.role, 'encounter.update') ? `${waiting} waiting · authorised clinical workflow` : 'Read-only access · clinical action restricted'}
            to="/app/visits"
          />
          <WorkflowCard
            number="03" icon="mic" title="AI medical scribe"
            description="Draft a structured note from a consultation recording or transcript, then review before saving."
            status={can(user?.role, 'encounter.update') ? 'Available on a patient visit' : 'Clinician or nurse permission required'}
            to={can(user?.role, 'encounter.update') && active[0] ? `/app/patients/${active[0].patientId}` : '/app/visits'}
          />
          <WorkflowCard
            number="04" icon="chart" title="Predictive engine"
            description="View queue, demand, staffing and capacity forecasts with assumptions and confidence."
            status={facility.setupSummary?.historyStatus === 'yes'
              ? `Historical data declared${facility.setupSummary.historyPeriod ? ` · ${facility.setupSummary.historyPeriod.replaceAll('_', ' ')}` : ''}`
              : facility.setupSummary?.historyStatus === 'partial' ? 'Partial history declared · forecast remains cautious' : 'No history declared · warming up from recorded visits'}
            to="/app/outflow"
          />
          <WorkflowCard
            number="05" icon="document" title="EHR integration & management"
            description={facility.setupSummary && !['ehr', 'emr', 'other_digital'].includes(facility.setupSummary.ehrStatus)
              ? 'Onboarding reports paper/no external EHR. Afribok’s local digital patient record remains available.'
              : `System reported: ${facility.setupSummary?.ehrName || facility.setupSummary?.ehrStatus || 'not configured'} · API access ${facility.setupSummary?.ehrApiAccess || 'unknown'} · read ${facility.setupSummary?.ehrRead ? 'yes' : 'no'} · write ${facility.setupSummary?.ehrWrite ? 'yes' : 'no'}.`}
            status={can(user?.role, 'team.manage')
              ? facility.ehrIntegrationEnabled ? 'API access reported · connector still requires validation' : 'No validated external connection · admin controls setup'
              : 'Administrator-managed · no patient exchange is active'}
            to={can(user?.role, 'team.manage') ? '/app/ehr' : undefined}
          />
          <WorkflowCard
            number="06" icon="spark" title="AI Assistant"
            description="Ask about aggregate queue, triage workload, daily activity and forecasts. Patient details are excluded from AI requests."
            status="Available · operational metrics only"
            to="/app/assistant"
          />
        </div>
        <p className="dashboard-workflows-note"><Icon name="info" size={13} /> Onboarding records the hospital’s reported environment; it does not itself validate an EHR, clinical protocol, or historical dataset.</p>
      </section>

      <div className="dashboard-grid">
        <section className="panel queue-panel" aria-labelledby="active-queue-title">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">OPERATIONAL WORKLIST</p>
              <h2 id="active-queue-title">Active visits</h2>
            </div>
            <div className="panel-head-meta">
              <span className="live-label">
                <span className={`live-dot ${offline ? 'is-offline' : ''}`} />
                {offline ? 'Local' : 'Live'}
              </span>
              <Link to="/app/visits" className="panel-link">
                All visits <Icon name="arrow-right" size={13} />
              </Link>
            </div>
          </div>
          <p className="panel-sub">Oldest first. This is an operational queue, not a clinical priority order.</p>

          {active.length === 0 ? (
            <EmptyState
              compact
              icon="check"
              title="The active queue is clear."
              copy="New visits will appear here as soon as a patient is registered or checked in."
            />
          ) : (
            <div className="queue-list">
              {active.slice(0, 8).map((encounter) => {
                const patient = patientById.get(encounter.patientId)
                if (!patient) return null
                return (
                  <article className={`queue-row${encounter.triage && encounter.triage.level <= 2 ? ' queue-row--emergency' : ''}`} key={encounter.id}>
                    <Avatar firstName={patient.firstName} lastName={patient.lastName} />
                    <div className="queue-identity">
                      <Link to={`/app/patients/${patient.id}`} className="queue-name">
                        {patient.firstName} {patient.lastName}
                      </Link>
                      <span className="queue-meta">
                        {patient.hospitalNumber} · {ageOf(patient)} · {patient.sex === 'unknown' ? 'Sex not recorded' : patient.sex}
                      </span>
                      <span className="queue-meta queue-meta--dept">
                        {encounter.departmentName ?? 'No department'} · {encounter.assignedClinicianName ? `Dr ${encounter.assignedClinicianName}` : 'Unassigned'}
                      </span>
                    </div>
                    <div className="queue-complaint">
                      <span className="queue-complaint-label">Presenting complaint</span>
                      <p>{encounter.chiefComplaint || 'Not recorded yet'}</p>
                    </div>
                    <div className="queue-wait">
                      <span className="queue-wait-time">{waitingFor(encounter.arrivedAt)}</span>
                      <span className="queue-wait-label">since {formatDateTime(encounter.arrivedAt).split(', ')[1] ?? formatDateTime(encounter.arrivedAt)}</span>
                    </div>
                    <div className="queue-status">
                      {encounter.triage ? <TriageBadge level={encounter.triage.level} label={encounter.triage.label} /> : <span className="tag tag--pending">Awaiting triage</span>}
                      <StatusTag status={encounter.status} />
                      <SyncTag state={encounter.syncState} />
                    </div>
                    <EncounterActions encounter={encounter} />
                  </article>
                )
              })}
            </div>
          )}
          {active.length > 8 && (
            <Link to="/app/visits" className="queue-more">
              + {active.length - 8} more open visits
            </Link>
          )}
        </section>

        <aside className="dashboard-side">
          <section className="panel flow-panel">
            <div className="panel-head panel-head--tight">
              <div>
                <p className="panel-kicker">TODAY</p>
                <h2>Flow at a glance</h2>
              </div>
              <span className="panel-count">{todayTotal}</span>
            </div>
            <div className="meter-list">
              <MeterRow label="Waiting" value={waiting} max={Math.max(todayTotal, 1)} tone="#c57c47" />
              <MeterRow label="In consultation" value={inConsultation} max={Math.max(todayTotal, 1)} tone="#6c8a72" />
              <MeterRow label="Completed" value={completedToday} max={Math.max(todayTotal, 1)} tone="#9e9a87" />
            </div>
            <p className="panel-footnote">
              Counts reflect visits recorded in this workspace today. Afribok does not adjust for staffing or clinical
              acuity.
            </p>
          </section>

          <section className={`panel sync-card sync-card--${offline ? 'offline' : conflicts > 0 ? 'warn' : 'ok'}`}>
            <div className="panel-head panel-head--tight">
              <div>
                <p className="panel-kicker">SYNCHRONISATION</p>
                <h2>{offline ? 'Working offline' : syncing ? 'Syncing changes' : conflicts > 0 ? 'Review needed' : 'Up to date'}</h2>
              </div>
              <span className="sync-orb">
                <Icon name={offline ? 'wifi-off' : conflicts > 0 ? 'alert' : 'cloud'} size={18} />
              </span>
            </div>
            <div className="sync-card-stats">
              <span>
                <strong>{pendingCount}</strong>
                <small>queued</small>
              </span>
              <span>
                <strong>{conflicts}</strong>
                <small>to review</small>
              </span>
            </div>
            <p className="panel-footnote">
              {lastSyncAt ? `Last successful sync ${formatDateTime(lastSyncAt)}.` : 'No successful sync on this device yet.'}
            </p>
            <Link to="/app/sync" className="panel-link">
              Open sync centre <Icon name="arrow-right" size={13} />
            </Link>
          </section>

          <section className="panel ai-on-card">
            <span className="ai-off-icon">
              <Icon name="spark" size={18} />
            </span>
            <p className="panel-kicker">CLINICAL SUPPORT</p>
            <h2>
              {highUrgency > 0
                ? `${highUrgency} open ${highUrgency === 1 ? 'visit needs' : 'visits need'} urgent review.`
                : triagedToday > 0
                  ? `${triagedToday} triaged today.`
                  : 'Triage, scribe, paper capture and forecast are live.'}
            </h2>
            <p>
              Triage reads the complaint and observations, the scribe drafts the note from the consultation, and the
              outflow forecast projects the next hours. Every output is a suggestion a clinician reviews.
            </p>
            <div className="ai-on-links">
              <Link to="/app/outflow" className="panel-link">
                Outflow forecast <Icon name="arrow-right" size={13} />
              </Link>
              <Link to="/app/performance" className="panel-link">
                Measured performance <Icon name="arrow-right" size={13} />
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function WorkflowCard({
  number,
  icon,
  title,
  description,
  status,
  to,
}: {
  number: string
  icon: IconName
  title: string
  description: string
  status: string
  to?: string
}) {
  const content = (
    <>
      <span className="workflow-card-top"><span>{number} / MODULE</span><Icon name={icon} size={17} /></span>
      <strong className="workflow-card-title">{title}</strong>
      <span className="workflow-card-copy">{description}</span>
      <span className="workflow-card-status">{status}</span>
      <span className="workflow-card-action">{to ? 'Open workflow' : 'Role-restricted'} {to && <Icon name="arrow-right" size={13} />}</span>
    </>
  )
  return to
    ? <Link className="workflow-card" to={to}>{content}</Link>
    : <article className="workflow-card workflow-card--locked" aria-label={`${title}: ${status}`}>{content}</article>
}
