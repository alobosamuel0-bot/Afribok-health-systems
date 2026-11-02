import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { can } from '@shared/types'
import { Icon } from '@/components/Icon'
import { Avatar, EmptyState, PageHeader } from '@/components/ui'
import { TriageBadge } from '@/components/TriagePanel'
import { useAuth } from '@/auth/AuthProvider'
import { useWorkspace } from '@/workspace/WorkspaceProvider'
import { usePageTitle } from '@/hooks/usePageTitle'
import { runTriage } from '@/lib/ai-client'
import { ageOf, waitingFor } from '@/lib/format'

const BATCH_SIZES = [3, 5, 10, 20, 30, 50, 100]

type RowState = 'queued' | 'running' | 'done' | 'error' | 'emergency'

export default function Triage() {
  usePageTitle('AI triage')
  const { user } = useAuth()
  const { encounters, patients, refreshFromServer } = useWorkspace()
  const [batchSize, setBatchSize] = useState(5)
  const [running, setRunning] = useState(false)
  const [states, setStates] = useState<Record<string, RowState>>({})
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const patientById = useMemo(() => new Map(patients.map((patient) => [patient.id, patient])), [patients])
  const queue = encounters
    .filter((encounter) => encounter.status === 'waiting')
    .sort((a, b) => {
      const levelA = a.triage?.level ?? 9
      const levelB = b.triage?.level ?? 9
      if (levelA !== levelB) return levelA - levelB
      return a.arrivedAt.localeCompare(b.arrivedAt)
    })
  const selected = queue.slice(0, batchSize)
  const untriaged = queue.filter((encounter) => !encounter.triage)
  const urgent = queue.filter((encounter) => encounter.triage && encounter.triage.level <= 2)

  async function startBatch() {
    if (running || selected.length === 0) return
    setError('')
    setRunning(true)
    const next: Record<string, RowState> = {}
    for (const encounter of selected) next[encounter.id] = 'queued'
    setStates(next)
    for (const encounter of selected) {
      setStates((current) => ({ ...current, [encounter.id]: 'running' }))
      try {
        const result = await runTriage(encounter.id)
        const level = result.assessment.level
        setStates((current) => ({ ...current, [encounter.id]: level <= 2 ? 'emergency' : 'done' }))
        setMessages((current) => ({ ...current, [encounter.id]: result.assessment.disposition }))
        if (level <= 2) {
          // The escalation is shown the moment this patient returns; it is not
          // held back until the rest of the batch finishes.
          setError(`Urgent review: ${patientById.get(encounter.patientId)?.firstName ?? 'Patient'} ${patientById.get(encounter.patientId)?.lastName ?? ''} scored level ${level}. Escalate now through the hospital emergency pathway.`)
        }
      } catch (caught) {
        setStates((current) => ({ ...current, [encounter.id]: 'error' }))
        setMessages((current) => ({
          ...current,
          [encounter.id]: caught instanceof Error ? caught.message : 'Triage failed for this patient.',
        }))
      }
    }
    await refreshFromServer()
    setRunning(false)
  }

  return (
    <div className="page triage-page">
      <PageHeader
        eyebrow="WORKFLOW 02 · AI TRIAGE"
        title="Batch triage"
        description={
          <>
            <span>{queue.length} waiting</span>
            <span className="dot-separator" />
            <span>{untriaged.length} not yet triaged</span>
            <span className="dot-separator" />
            <span>{urgent.length} urgent review</span>
          </>
        }
        actions={
          <Link to="/app/visits" className="btn btn--outline btn--sm">
            <Icon name="encounters" size={14} /> Visit queue
          </Link>
        }
      />

      {!can(user?.role, 'encounter.update') && (
        <div className="notice notice--warn" role="note">
          <Icon name="lock" size={16} />
          <span>Your role can view the queue but cannot run triage. A nurse, clinician or administrator can start a batch.</span>
        </div>
      )}

      <section className="panel triage-batch-panel">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">BATCH CONFIGURATION</p>
            <h2>Process walk-ins together</h2>
            <p className="panel-sub">Choose 3 to 100 patients. Each result is attached to its own visit as soon as it returns; emergency signs are surfaced immediately.</p>
          </div>
          <span className="integration-status">{selected.length} selected</span>
        </div>
        <div className="triage-batch-controls">
          <label>
            Batch size
            <select value={batchSize} onChange={(event) => setBatchSize(Number(event.target.value))} disabled={running}>
              {BATCH_SIZES.map((size) => <option key={size} value={size}>{size} patients</option>)}
            </select>
          </label>
          <button type="button" className="btn btn--solid" onClick={() => void startBatch()} disabled={running || selected.length === 0 || !can(user?.role, 'encounter.update')}>
            {running ? <span className="spinner" /> : <Icon name="spark" size={15} />}
            {running ? 'Processing batch…' : `Run triage for ${selected.length} patient${selected.length === 1 ? '' : 's'}`}
          </button>
        </div>
        {error && (
          <div className="notice notice--warn" role="alert">
            <Icon name="alert" size={16} /><span>{error}</span>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">TRIAGE QUEUE</p>
            <h2>Waiting patients</h2>
          </div>
          <span className="panel-count">{queue.length}</span>
        </div>
        {queue.length === 0 ? (
          <EmptyState icon="check" title="No patient is waiting." copy="Register a walk-in or check in a returning patient to build the triage queue." />
        ) : (
          <div className="platform-table-wrap">
            <table className="platform-table">
              <thead>
                <tr><th>Patient</th><th>Department</th><th>Complaint</th><th>Waiting</th><th>Triage</th><th>Batch status</th></tr>
              </thead>
              <tbody>
                {queue.map((encounter) => {
                  const patient = patientById.get(encounter.patientId)
                  const state = states[encounter.id]
                  return (
                    <tr key={encounter.id} className={state === 'emergency' ? 'triage-row--emergency' : ''}>
                      <td>
                        <div className="cell-patient">
                          <Avatar firstName={patient?.firstName ?? '?'} lastName={patient?.lastName ?? ''} size="sm" />
                          <div>
                            <Link to={`/app/patients/${encounter.patientId}`} className="row-link">
                              {patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown patient'}
                            </Link>
                            <small>{patient?.hospitalNumber} {patient ? `· ${ageOf(patient)}` : ''}</small>
                          </div>
                        </div>
                      </td>
                      <td>{encounter.departmentName ?? 'Not assigned'}</td>
                      <td className="cell-complaint">{encounter.chiefComplaint || 'Not recorded'}</td>
                      <td>{waitingFor(encounter.arrivedAt)}</td>
                      <td>{encounter.triage ? <TriageBadge level={encounter.triage.level} label={encounter.triage.label} /> : <span className="cell-muted">Not triaged</span>}</td>
                      <td>
                        {state ? <span className={`batch-state batch-state--${state}`}>{state === 'emergency' ? 'EMERGENCY — escalate' : state}</span> : <span className="cell-muted">—</span>}
                        {messages[encounter.id] && <small className="batch-message">{messages[encounter.id]}</small>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
