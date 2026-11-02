import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { can } from '@shared/types'
import { Icon } from '@/components/Icon'
import { Avatar, EmptyState, PageHeader, StatusTag, SyncTag } from '@/components/ui'
import { useAuth } from '@/auth/AuthProvider'
import { useWorkspace } from '@/workspace/WorkspaceProvider'
import { usePageTitle } from '@/hooks/usePageTitle'
import { ageOf, formatDateTime, sexLabel } from '@/lib/format'
import type { LocalEncounter, LocalPatient } from '@/lib/local-types'

type Filter = 'all' | 'open' | 'sync'

export default function Patients() {
  usePageTitle('Patients')
  const { user } = useAuth()
  const { patients, encounters, online, serverReachable } = useWorkspace()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const encountersByPatient = useMemo(() => {
    const map = new Map<string, LocalEncounter[]>()
    for (const encounter of encounters) {
      const list = map.get(encounter.patientId) ?? []
      list.push(encounter)
      map.set(encounter.patientId, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt))
    }
    return map
  }, [encounters])

  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const digits = query.replace(/\D/g, '')
    return patients
      .map((patient: LocalPatient) => {
        const patientEncounters = encountersByPatient.get(patient.id) ?? []
        const open = patientEncounters.find((encounter) => encounter.status !== 'completed')
        return { patient, latest: patientEncounters[0], open }
      })
      .filter(({ patient, open }) => {
        if (filter === 'open' && !open) return false
        if (filter === 'sync' && patient.syncState === 'synced') return false
        if (!normalized) return true
        const haystack = [
          patient.firstName,
          patient.lastName,
          patient.otherNames ?? '',
          patient.hospitalNumber,
          patient.phone ?? '',
          patient.identifierValue ?? '',
        ]
          .join(' ')
          .toLowerCase()
        if (haystack.includes(normalized)) return true
        return digits.length >= 4 && (patient.phone ?? '').replace(/\D/g, '').includes(digits)
      })
  }, [patients, encountersByPatient, query, filter])

  const openPatients = patients.filter((patient) =>
    (encountersByPatient.get(patient.id) ?? []).some((encounter) => encounter.status !== 'completed'),
  ).length
  const syncPatients = patients.filter((patient) => patient.syncState !== 'synced').length
  const offline = !online || serverReachable === false

  return (
    <div className="page patients-page">
      <PageHeader
        eyebrow="PATIENT INDEX"
        title="Patients"
        description={
          <>
            <span>
              {patients.length} {patients.length === 1 ? 'record' : 'records'} on this device
            </span>
            <span className="dot-separator" />
            <span>{offline ? 'Local index · server refresh pending' : 'Local index · server-connected'}</span>
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

      <div className="patient-toolbar">
        <div className="patient-search">
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder="Search name, hospital number, phone or identifier"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search patients"
          />
          {query && (
            <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
        <div className="filter-tabs" role="group" aria-label="Filter patients">
          <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>
            All <span>{patients.length}</span>
          </button>
          <button type="button" className={filter === 'open' ? 'is-active' : ''} onClick={() => setFilter('open')}>
            Open visit <span>{openPatients}</span>
          </button>
          <button type="button" className={filter === 'sync' ? 'is-active' : ''} onClick={() => setFilter('sync')}>
            Needs sync <span>{syncPatients}</span>
          </button>
        </div>
      </div>

      <section className="panel patient-table-panel" aria-live="polite">
        {rows.length === 0 ? (
          <EmptyState
            icon={query ? 'search' : 'patients'}
            title={query ? 'No matching patients.' : filter !== 'all' ? 'No patients in this view.' : 'No patient records yet.'}
            copy={
              query
                ? 'Try a shorter name, a hospital number, or a phone number. Search runs entirely on this device.'
                : filter !== 'all'
                  ? 'Change the filter or register a new visit for an existing patient.'
                  : 'Register a patient to begin the Stage 1 workflow. Real patient information must not be entered.'
            }
            action={
              !query && filter === 'all' && can(user?.role, 'patient.create') ? (
                <Link to="/app/register" className="btn btn--outline btn--sm">
                  Register a patient
                </Link>
              ) : query ? (
                <button type="button" className="btn btn--outline btn--sm" onClick={() => setQuery('')}>
                  Clear search
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="data-table patient-table" role="table" aria-label="Patient records">
              <div className="data-head" role="row">
                <span role="columnheader">Patient</span>
                <span role="columnheader">ID</span>
                <span role="columnheader">Sex / age</span>
                <span role="columnheader">Contact</span>
                <span role="columnheader">Last visit</span>
                <span role="columnheader">Status</span>
                <span aria-hidden="true" />
              </div>
              {rows.map(({ patient, latest, open }) => (
                <Link
                  className="data-row patient-row"
                  to={`/app/patients/${patient.id}`}
                  role="row"
                  key={patient.id}
                >
                  <div className="cell-patient" role="cell">
                    <Avatar firstName={patient.firstName} lastName={patient.lastName} />
                    <div>
                      <strong>
                        {patient.firstName} {patient.lastName}
                      </strong>
                      {patient.otherNames && <small>{patient.otherNames}</small>}
                    </div>
                  </div>
                  <span className="cell-mono" role="cell">
                    {patient.hospitalNumber}
                  </span>
                  <span role="cell">
                    {sexLabel(patient.sex)} <span className="cell-muted">· {ageOf(patient)}</span>
                  </span>
                  <span role="cell">
                    {patient.phone || <span className="cell-muted">Not recorded</span>}
                  </span>
                  <span role="cell">
                    {latest ? (
                      <>
                        {formatDateTime(latest.arrivedAt)}
                        {open && <span className="cell-open">Open visit</span>}
                      </>
                    ) : (
                      <span className="cell-muted">No visits</span>
                    )}
                  </span>
                  <div className="cell-status" role="cell">
                    {open ? <StatusTag status={open.status} /> : latest ? <StatusTag status="completed" /> : null}
                    <SyncTag state={patient.syncState} />
                  </div>
                  <span className="cell-arrow" aria-hidden="true">
                    <Icon name="chevron-right" size={15} />
                  </span>
                </Link>
              ))}
            </div>
            <p className="table-foot">
              Showing {rows.length} of {patients.length}. Search and sort run locally; the server is not queried for
              each keystroke.
            </p>
          </>
        )}
      </section>
    </div>
  )
}
