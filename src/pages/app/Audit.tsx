import { useEffect, useMemo, useState } from 'react'
import type { AuditEvent } from '@shared/types'
import { Icon } from '@/components/Icon'
import { EmptyState, InfoNote, PageHeader } from '@/components/ui'
import { api, NetworkError } from '@/lib/api'
import { getMeta, setMeta } from '@/lib/local-db'
import { useWorkspace } from '@/workspace/WorkspaceProvider'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDateTime } from '@/lib/format'

interface AuditCache {
  events: AuditEvent[]
  fetchedAt: string
}

const ACTION_LABELS: Record<string, string> = {
  'auth.signed_in': 'Signed in',
  'auth.signed_out': 'Signed out',
  'auth.sign_in_failed': 'Failed sign-in',
  'patient.created': 'Patient created',
  'encounter.created': 'Visit opened',
  'encounter.updated': 'Visit updated',
  'sync.operation_applied': 'Sync operation applied',
  'sync.conflict': 'Sync conflict recorded',
  'sync.rejected': 'Sync rejected',
  'team.member_updated': 'Team member updated',
  'triage.assessed': 'Triage assessed',
  'scribe.note_saved': 'Scribe note drafted',
  'capacity.updated': 'Capacity updated',
}

const ACTION_GROUPS = ['All actions', 'Authentication', 'Patients', 'Visits', 'Clinical support', 'Sync', 'Team']

function groupFor(action: string): string {
  if (action.startsWith('auth.')) return 'Authentication'
  if (action.startsWith('patient.')) return 'Patients'
  if (action.startsWith('encounter.')) return 'Visits'
  if (action.startsWith('sync.')) return 'Sync'
  if (action.startsWith('team.')) return 'Team'
  if (action.startsWith('triage.') || action.startsWith('scribe.') || action.startsWith('capacity.')) return 'Clinical support'
  return 'All actions'
}

function detailText(detail: Record<string, unknown> | null): string {
  if (!detail) return '—'
  return Object.entries(detail)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => {
      const label = key.replace(/([A-Z])/g, ' $1').toLowerCase()
      return `${label}: ${Array.isArray(value) ? value.join(', ') : String(value)}`
    })
    .join(' · ')
}

export default function Audit() {
  usePageTitle('Audit trail')
  const { online, serverReachable } = useWorkspace()
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('All actions')
  const offline = !online || serverReachable === false

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const result = await api<{ events: AuditEvent[] }>('/api/audit?limit=150')
        if (cancelled) return
        setEvents(result.events)
        setCachedAt(new Date().toISOString())
        await setMeta('auditCache', { events: result.events, fetchedAt: new Date().toISOString() })
      } catch (caught) {
        if (cancelled) return
        const cached = await getMeta<AuditCache>('auditCache')
        if (cached) {
          setEvents(cached.events)
          setCachedAt(cached.fetchedAt)
        }
        if (caught instanceof NetworkError) {
          setError('The clinic server is unreachable. Showing the last audit snapshot cached on this device.')
        } else if (caught instanceof Error) {
          setError(caught.message)
        } else {
          setError('The audit trail could not be loaded.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return events.filter((event) => {
      if (group !== 'All actions' && groupFor(event.action) !== group) return false
      if (!normalized) return true
      return [event.actorName, event.action, event.entityType, event.entityId, detailText(event.detail)]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    })
  }, [events, group, query])

  return (
    <div className="page audit-page">
      <PageHeader
        eyebrow="GOVERNANCE · AUDIT"
        title="Audit trail"
        description={
          <>
            <span>{events.length} recent events</span>
            <span className="dot-separator" />
            <span>{cachedAt ? `Snapshot ${formatDateTime(cachedAt)}` : 'Waiting for first load'}</span>
            <span className="dot-separator" />
            <span>Identifiers and workflow facts only</span>
          </>
        }
      />

      <div className="audit-notice">
        <InfoNote>
          Audit details intentionally exclude names, complaints, transcripts and other clinical narrative. Read-access
          auditing is not implemented in Stage 1; this trail covers authentication, workflow changes, sync events and
          team administration.
        </InfoNote>
      </div>

      {error && (
        <div className="notice notice--warn" role="status" style={{ marginBottom: 16 }}>
          <Icon name={offline ? 'wifi-off' : 'info'} size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="audit-toolbar">
        <div className="visits-search audit-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder="Search actor, action or entity"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search audit events"
          />
        </div>
        <div className="filter-tabs" role="group" aria-label="Filter audit events">
          {ACTION_GROUPS.map((item) => (
            <button
              type="button"
              key={item}
              className={group === item ? 'is-active' : ''}
              onClick={() => setGroup(item)}
            >
              {item.replace(' actions', '')}
            </button>
          ))}
        </div>
      </div>

      <section className="panel audit-panel">
        {loading ? (
          <div className="panel-loading">
            <span className="spinner" /> Loading audit events…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="audit"
            title={events.length === 0 ? 'No audit events yet.' : 'No events match this filter.'}
            copy={
              events.length === 0
                ? 'Sign-ins, patient registrations, visit changes and sync events will appear here.'
                : 'Try a different action group or clear the search.'
            }
            action={
              query || group !== 'All actions' ? (
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={() => {
                    setQuery('')
                    setGroup('All actions')
                  }}
                >
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="data-table audit-table" role="table" aria-label="Audit events">
            <div className="data-head" role="row">
              <span role="columnheader">Recorded</span>
              <span role="columnheader">Actor</span>
              <span role="columnheader">Action</span>
              <span role="columnheader">Entity</span>
              <span role="columnheader">Detail</span>
              <span role="columnheader">Source</span>
            </div>
            {filtered.map((event) => (
              <div className="data-row audit-row" role="row" key={event.id}>
                <span role="cell" className="audit-time">
                  {formatDateTime(event.recordedAt)}
                </span>
                <span role="cell">{event.actorName}</span>
                <span role="cell">
                  <span className={`audit-action audit-action--${groupFor(event.action).toLowerCase()}`}>
                    {ACTION_LABELS[event.action] ?? event.action}
                  </span>
                </span>
                <span role="cell" className="cell-mono">
                  {event.entityType}
                  {event.entityId ? ` · ${event.entityId.slice(0, 8)}…` : ''}
                </span>
                <span role="cell" className="audit-detail">
                  {detailText(event.detail)}
                </span>
                <span role="cell">
                  <span className={`tag ${event.source === 'sync' ? 'tag--pending' : 'tag--ok'}`}>{event.source}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {cachedAt && (
          <p className="table-foot">
            {offline
              ? 'Cached snapshot — reconnect to refresh the live audit trail.'
              : 'Loaded from the clinic server. Retry after any sync conflict to see the recorded resolution.'}
          </p>
        )}
      </section>
    </div>
  )
}
