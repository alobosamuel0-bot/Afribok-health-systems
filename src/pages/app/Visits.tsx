import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { can, type EncounterStatus } from '@shared/types'
import { Icon } from '@/components/Icon'
import { Avatar, EmptyState, PageHeader, StatusTag, SyncTag } from '@/components/ui'
import { EncounterActions } from '@/components/EncounterActions'
import { TriageBadge } from '@/components/TriagePanel'
import { useAuth } from '@/auth/AuthProvider'
import { useWorkspace } from '@/workspace/WorkspaceProvider'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDateTime, waitingFor, isSameLocalDay, plural } from '@/lib/format'

type Filter = 'all' | EncounterStatus

const TABS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'in_consultation', label: 'In consultation' },
  { key: 'completed', label: 'Completed' },
]

const STATUS_ORDER: Record<EncounterStatus, number> = {
  waiting: 0,
  in_consultation: 1,
  completed: 2,
}

export default function Visits() {
  usePageTitle('Visits')
  const { user } = useAuth()
  const { encounters, patients } = useWorkspace()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const patientById = useMemo(() => new Map(patients.map((patient) => [patient.id, patient])), [patients])

  const counts = useMemo(
    () => ({
      waiting: encounters.filter((encounter) => encounter.status === 'waiting').length,
      in_consultation: encounters.filter((encounter) => encounter.status === 'in_consultation').length,
      completed: encounters.filter((encounter) => encounter.status === 'completed').length,
    }),
    [encounters],
  )

  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return encounters
      .filter((encounter) => {
        if (filter !== 'all' && encounter.status !== filter) return false
        if (!normalized) return true
        const patient = patientById.get(encounter.patientId)
        return [patient?.firstName, patient?.lastName, patient?.hospitalNumber, encounter.chiefComplaint]
          .join(' ')
          .toLowerCase()
          .includes(normalized)
      })
      .sort((a, b) => {
        const status = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        if (status !== 0) return status
        if (a.status === 'completed') return b.arrivedAt.localeCompare(a.arrivedAt)
        return a.arrivedAt.localeCompare(b.arrivedAt)
      })
  }, [encounters, filter, query, patientById])

  const todayVisits = encounters.filter((encounter) => isSameLocalDay(encounter.arrivedAt)).length
  const activeCount = counts.waiting + counts.in_consultation

  return (
    <div className="page visits-page">
      <PageHeader
        eyebrow="OPERATIONS · VISITS"
        title="Visits"
        description={
          <>
            <span>{plural(activeCount, 'open visit')}</span>
            <span className="dot-separator" />
            <span>{todayVisits} arrived today</span>
            <span className="dot-separator" />
            <span>Operational order · triage shown where recorded</span>
          </>
        }
        actions={
          can(user?.role, 'patient.create') ? (
            <Link to="/app/register" className="btn btn--solid btn--sm">
              <Icon name="plus" size={15} /> Register patient
            </Link>
          ) : undefined
        }
      />

      <div className="visit-summary">
        <button type="button" className="visit-summary-card" onClick={() => setFilter('waiting')}>
          <span>Waiting</span>
          <strong>{counts.waiting}</strong>
          <small>in the operational queue</small>
        </button>
        <button type="button" className="visit-summary-card" onClick={() => setFilter('in_consultation')}>
          <span>In consultation</span>
          <strong>{counts.in_consultation}</strong>
          <small>open clinical visits</small>
        </button>
        <button type="button" className="visit-summary-card" onClick={() => setFilter('completed')}>
          <span>Completed</span>
          <strong>{counts.completed}</strong>
          <small>across the local record</small>
        </button>
        <div className="visit-summary-card visit-summary-card--static">
          <span>Today</span>
          <strong>{todayVisits}</strong>
          <small>visits recorded today</small>
        </div>
      </div>

      <div className="visits-toolbar">
        <div className="filter-tabs" role="group" aria-label="Filter visits">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={filter === tab.key ? 'is-active' : ''}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
              {tab.key === 'all' && <span>{encounters.length}</span>}
              {tab.key !== 'all' && <span>{counts[tab.key]}</span>}
            </button>
          ))}
        </div>
        <div className="visits-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder="Filter by patient or complaint"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Filter visits"
          />
        </div>
      </div>

      <section className="panel visits-panel" aria-live="polite">
        {rows.length === 0 ? (
          <EmptyState
            icon={query ? 'search' : 'encounters'}
            title={query ? 'No visits match this filter.' : filter === 'all' ? 'No visits recorded yet.' : 'No visits with this status.'}
            copy={
              query
                ? 'Try another patient name or clear the text filter.'
                : 'Visits appear here after a patient is registered or checked in for a return visit.'
            }
            action={
              query ? (
                <button type="button" className="btn btn--outline btn--sm" onClick={() => setQuery('')}>
                  Clear filter
                </button>
              ) : can(user?.role, 'patient.create') ? (
                <Link to="/app/register" className="btn btn--solid btn--sm">
                  Register a patient
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="data-table visits-table" role="table" aria-label="Visits">
            <div className="data-head" role="row">
              <span role="columnheader">Patient</span>
              <span role="columnheader">Presenting complaint</span>
              <span role="columnheader">Arrived</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Local state</span>
              <span role="columnheader">Action</span>
            </div>
            {rows.map((encounter) => {
              const patient = patientById.get(encounter.patientId)
              if (!patient) return null
              return (
                <div className="data-row visit-row" role="row" key={encounter.id}>
                  <div className="cell-patient" role="cell">
                    <Avatar firstName={patient.firstName} lastName={patient.lastName} size="sm" />
                    <div>
                      <Link to={`/app/patients/${patient.id}`} className="row-link">
                        {patient.firstName} {patient.lastName}
                      </Link>
                      <small>{patient.hospitalNumber}</small>
                    </div>
                  </div>
                  <p className="cell-complaint" role="cell">
                    {encounter.chiefComplaint || <span className="cell-muted">Not recorded</span>}
                  </p>
                  <span role="cell">
                    <span className="cell-stack">
                      <strong>{formatDateTime(encounter.arrivedAt)}</strong>
                      {encounter.status !== 'completed' && <small>{waitingFor(encounter.arrivedAt)} waiting</small>}
                    </span>
                  </span>
                  <div role="cell" className="cell-status-stack">
                    <StatusTag status={encounter.status} />
                    {encounter.triage && (
                      <TriageBadge level={encounter.triage.level} label={encounter.triage.label} />
                    )}
                  </div>
                  <div role="cell" className="cell-status">
                    <SyncTag state={encounter.syncState} />
                    {encounter.syncState === 'synced' && <span className="cell-muted">Synced</span>}
                  </div>
                  <div role="cell">
                    <EncounterActions encounter={encounter} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {encounters.length > 0 && (
        <p className="page-footnote">
          This worklist stays in arrival order. Where a triage assessment exists it is shown beside the visit; the
          clinician still sets the priority.
        </p>
      )}
    </div>
  )
}
