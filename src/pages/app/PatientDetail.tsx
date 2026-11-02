import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { can, type EncounterStatus } from '@shared/types'
import { Icon } from '@/components/Icon'
import { Avatar, EmptyState, InfoNote, Modal, PageHeader, StatusTag, SyncTag } from '@/components/ui'
import { EncounterActions } from '@/components/EncounterActions'
import { TriagePanel, TriageBadge } from '@/components/TriagePanel'
import { ScribePanel } from '@/components/ScribePanel'
import { useAuth } from '@/auth/AuthProvider'
import { useWorkspace } from '@/workspace/WorkspaceProvider'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'
import {
  ageOf,
  formatDate,
  formatDateTime,
  sexLabel,
  waitingFor,
} from '@/lib/format'

export default function PatientDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { encounters, checkIn, patients: allPatients, refreshFromServer } = useWorkspace()
  const patient = allPatients.find((candidate) => candidate.id === id)
  usePageTitle(patient ? `${patient.firstName} ${patient.lastName}` : 'Patient')
  const [visitOpen, setVisitOpen] = useState(false)
  const [complaint, setComplaint] = useState('')
  const [identityConfirmed, setIdentityConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [ehrBusy, setEhrBusy] = useState(false)

  if (!patient) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="PATIENT RECORD"
          title="Record not found on this device."
          description={<span>The patient may exist on another device or may not have been synced yet.</span>}
          actions={
            <Link to="/app/patients" className="btn btn--outline btn--sm">
              <Icon name="arrow-left" size={14} /> Back to patients
            </Link>
          }
        />
        <div className="panel">
          <EmptyState
            icon="search"
            title="Nothing in the local index."
            copy="Afribok searches the records held on this device. Use the sync centre to refresh from the server, or search a different name."
            action={
              <Link to="/app/sync" className="btn btn--solid btn--sm">
                Open sync centre
              </Link>
            }
          />
        </div>
      </div>
    )
  }

  const patientEncounters = encounters
    .filter((encounter) => encounter.patientId === patient.id)
    .sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt))
  const openEncounter = patientEncounters.find((encounter) => encounter.status !== 'completed')
  const currentEncounter = openEncounter ?? patientEncounters[0]
  const canCreateVisit = can(user?.role, 'encounter.create')
  const blocked = patient.syncState === 'conflict' || patient.syncState === 'rejected'
  const latestCompleted = patientEncounters.filter((encounter) => encounter.status === 'completed').length

  async function pullFromEhr() {
    if (!patient) return
    setEhrBusy(true); setError(null)
    try {
      const result = await api<{ patient: typeof patient; changes: Record<string, string> }>(`/api/ehr/patients/${patient.id}/pull`, { method: 'POST', body: '{}' })
      await refreshFromServer()
      setBanner(Object.keys(result.changes).length > 0
        ? `External EHR read: updated ${Object.keys(result.changes).join(', ')}. Review the record.`
        : 'External EHR read: the external record matched this patient; no field changed.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The external EHR could not be read.')
    } finally { setEhrBusy(false) }
  }

  async function submitVisit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!patient) return
    if (!identityConfirmed) {
      setError('Confirm the patient’s identity using your facility’s approved process before opening a visit.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await checkIn(patient.id, complaint)
      setVisitOpen(false)
      setComplaint('')
      setIdentityConfirmed(false)
      setBanner('A new waiting visit was opened and saved to this device.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The visit could not be opened.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page patient-detail">
      <div className="breadcrumb">
        <Link to="/app/patients">
          <Icon name="arrow-left" size={13} /> Patients
        </Link>
        <span>/</span>
        <span>Patient record</span>
      </div>

      <PageHeader
        eyebrow="PATIENT RECORD"
        title={`${patient.firstName} ${patient.lastName}`}
        description={
          <>
            <span>{patient.hospitalNumber}</span>
            <span className="dot-separator" />
            <span>{openEncounter ? `Open visit · ${openEncounter.status.replace('_', ' ')}` : 'No open visit'}</span>
          </>
        }
        actions={
          <>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => void pullFromEhr()} disabled={ehrBusy}>
            <Icon name="cloud" size={14} /> {ehrBusy ? 'Reading…' : 'Pull from EHR'}
          </button>
          {canCreateVisit ? (
            <button
              type="button"
              className="btn btn--solid btn--sm"
              onClick={() => {
                setError(null)
                setVisitOpen(true)
              }}
              disabled={blocked}
              title={blocked ? 'Resolve the sync issue for this patient first' : undefined}
            >
              <Icon name="plus" size={15} />
              {openEncounter ? 'Open visit exists' : 'New visit / check in'}
            </button>
          ) : undefined}
          </>
        }
      />

      {banner && (
        <div className="notice notice--ok" role="status" style={{ marginBottom: 16 }}>
          <Icon name="check" size={16} />
          <span>{banner}</span>
          <Link to="/app/visits">View worklist</Link>
        </div>
      )}

      {openEncounter && (
        <div className="open-visit-strip">
          <span className="open-visit-pulse" />
          <div>
            <strong>Open visit currently {openEncounter.status === 'waiting' ? 'waiting' : 'in consultation'}</strong>
            <span>
              Arrived {formatDateTime(openEncounter.arrivedAt)} · {waitingFor(openEncounter.arrivedAt)} in the workspace
            </span>
          </div>
          <div className="open-visit-actions">
            {openEncounter.triage && (
              <TriageBadge level={openEncounter.triage.level} label={openEncounter.triage.label} />
            )}
            <SyncTag state={openEncounter.syncState} />
            <EncounterActions encounter={openEncounter} />
          </div>
        </div>
      )}

      <div className="patient-detail-grid">
        <section className="panel patient-profile">
          <div className="profile-head">
            <Avatar firstName={patient.firstName} lastName={patient.lastName} size="lg" />
            <div>
              <p className="panel-kicker">LONGITUDINAL IDENTITY</p>
              <h2>
                {patient.firstName} {patient.otherNames ? `${patient.otherNames} ` : ''}
                {patient.lastName}
              </h2>
              <div className="profile-tags">
                <SyncTag state={patient.syncState} />
                <span className="tag">{sexLabel(patient.sex)}</span>
              </div>
            </div>
          </div>

          <dl className="profile-grid">
            <div>
              <dt>Hospital number</dt>
              <dd className="mono-value">{patient.hospitalNumber}</dd>
            </div>
            <div>
              <dt>Date of birth</dt>
              <dd>{patient.dateOfBirth ? `${formatDate(patient.dateOfBirth)} · ${ageOf(patient)}` : 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Sex recorded</dt>
              <dd>{sexLabel(patient.sex)}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{patient.phone || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>{patient.address || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Identifier</dt>
              <dd>
                {patient.identifierValue
                  ? `${patient.identifierType ?? 'Identifier'} · ${patient.identifierValue}`
                  : 'Not recorded'}
              </dd>
            </div>
            <div>
              <dt>First captured</dt>
              <dd>{formatDateTime(patient.createdAt)}</dd>
            </div>
            <div>
              <dt>Record version</dt>
              <dd>v{patient.version} · local-first</dd>
            </div>
          </dl>

          <div className="profile-foot">
            <p>
              Identity data is stored on this device and queued for the server. Changing demographics is not part of
              this build; a correction should follow the facility’s own records process.
            </p>
          </div>
        </section>

        <aside className="patient-side">
          <div className="panel patient-side-card">
            <p className="panel-kicker">THIS VISIT</p>
            <h3>{currentEncounter ? currentEncounter.chiefComplaint || 'No complaint recorded' : 'No visit open'}</h3>
            <p>
              {currentEncounter
                ? `Arrived ${formatDateTime(currentEncounter.arrivedAt)} · ${currentEncounter.status.replace('_', ' ')}.`
                : 'Start a visit before running triage or drafting a note.'}
            </p>
            <Link to="/app/performance" className="panel-link">
              Measured performance <Icon name="arrow-right" size={13} />
            </Link>
          </div>

          <div className="notice notice--warn">
            <Icon name="alert" size={16} />
            <span>
              <strong>Triage is support, not a decision.</strong> If the patient has danger signs, use the hospital’s
              emergency pathway now — do not wait for the assessment or for the app to sync.
            </span>
          </div>

          {latestCompleted > 0 && (
            <div className="panel patient-side-card">
              <p className="panel-kicker">RETURNING PATIENT</p>
              <h3>{latestCompleted} completed {latestCompleted === 1 ? 'visit' : 'visits'} on record.</h3>
              <p>
                Prior visits keep their presenting complaint, triage level and any note drafted during that visit.
              </p>
            </div>
          )}
        </aside>
      </div>

      {currentEncounter && (
        <div className="clinical-grid">
          <TriagePanel encounter={currentEncounter} />
          <ScribePanel encounter={currentEncounter} />
        </div>
      )}

      <section className="panel visit-timeline-panel">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">VISIT HISTORY</p>
            <h2>Care encounters</h2>
          </div>
          <span className="panel-count">{patientEncounters.length}</span>
        </div>

        {patientEncounters.length === 0 ? (
          <EmptyState
            compact
            icon="encounters"
            title="No visits recorded."
            copy="This patient has an identity record but no encounter on this device yet."
            action={
              canCreateVisit ? (
                <button type="button" className="btn btn--solid btn--sm" onClick={() => setVisitOpen(true)}>
                  Open the first visit
                </button>
              ) : undefined
            }
          />
        ) : (
          <ol className="timeline">
            {patientEncounters.map((encounter) => (
              <li className="timeline-item" key={encounter.id}>
                <span className={`timeline-dot timeline-dot--${encounter.status}`} />
                <div className="timeline-main">
                  <div className="timeline-head">
                    <div>
                      <span className="timeline-date">{formatDateTime(encounter.arrivedAt)}</span>
                      <StatusTag status={encounter.status as EncounterStatus} />
                      <SyncTag state={encounter.syncState} />
                    </div>
                    <span className="timeline-version">v{encounter.version}</span>
                  </div>
                  <p className="timeline-complaint">
                    {encounter.chiefComplaint || <span className="cell-muted">No presenting complaint recorded.</span>}
                  </p>
                  <div className="timeline-foot">
                    <span>Arrived {formatDateTime(encounter.arrivedAt)}</span>
                    <span>·</span>
                    <span>{waitingFor(encounter.arrivedAt)} in workspace</span>
                  </div>
                  <EncounterActions encounter={encounter} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <Modal
        open={visitOpen}
        onClose={() => !saving && setVisitOpen(false)}
        title={`Check in ${patient.firstName} ${patient.lastName}`}
        footer={
          <>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setVisitOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" form="new-visit-form" className="btn btn--solid btn--sm" disabled={saving}>
              {saving ? <span className="spinner" /> : <Icon name="plus" size={14} />}
              Open waiting visit
            </button>
          </>
        }
      >
        <form id="new-visit-form" onSubmit={submitVisit} className="new-visit-form">
          <InfoNote tone="warn">
            Confirm identity through your facility’s approved process. Afribok does not verify identity from a
            photograph, a name alone or an AI match.
          </InfoNote>
          <div className="visit-identity">
            <Avatar firstName={patient.firstName} lastName={patient.lastName} />
            <div>
              <strong>
                {patient.firstName} {patient.lastName}
              </strong>
              <span>
                {patient.hospitalNumber} · {sexLabel(patient.sex)} · {ageOf(patient)}
              </span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="visitComplaint">
              Presenting complaint <span className="optional">optional, in the patient’s words</span>
            </label>
            <textarea
              id="visitComplaint"
              value={complaint}
              onChange={(event) => setComplaint(event.target.value)}
              placeholder="What has brought the patient in today?"
              maxLength={1000}
              autoFocus
            />
            <p className="field-hint">Only record what the patient or their escort actually states.</p>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={identityConfirmed}
              onChange={(event) => setIdentityConfirmed(event.target.checked)}
            />
            <span>I confirmed this is the correct returning patient using the facility’s approved identity process.</span>
          </label>
          {error && (
            <p className="inline-error" role="alert">
              <Icon name="alert" size={15} /> {error}
            </p>
          )}
        </form>
      </Modal>
    </div>
  )
}
