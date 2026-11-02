import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { EmptyState, Modal, PageHeader } from '@/components/ui'
import { useWorkspace } from '@/workspace/WorkspaceProvider'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDateTime, plural } from '@/lib/format'
import type { OutboxEntry } from '@/lib/local-types'
import type { SyncReport } from '@/lib/local-types'

const OP_LABELS: Record<OutboxEntry['operation']['type'], string> = {
  register_patient: 'Patient registration',
  create_encounter: 'New visit',
  update_encounter: 'Visit update',
}

export default function SyncCentre() {
  usePageTitle('Sync centre')
  const {
    outbox,
    syncLog,
    pendingCount,
    conflictCount,
    online,
    serverReachable,
    syncing,
    lastSyncAt,
    triggerSync,
    resolveConflict,
    discardEntry,
    removeRejected,
    patients,
  } = useWorkspace()
  const [result, setResult] = useState<SyncReport | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState<OutboxEntry | null>(null)
  const offline = !online || serverReachable === false
  const queued = outbox.filter((entry) => entry.status === 'pending' || entry.status === 'syncing')
  const review = outbox.filter((entry) => entry.status === 'conflict' || entry.status === 'rejected')

  async function syncNow() {
    setActionError(null)
    setResult(null)
    const report = await triggerSync()
    setResult(report)
  }

  async function runAction(entry: OutboxEntry, action: 'use-server' | 'discard' | 'remove') {
    setBusyId(entry.id)
    setActionError(null)
    try {
      if (action === 'use-server') await resolveConflict(entry)
      if (action === 'discard') await discardEntry(entry)
      if (action === 'remove') await removeRejected(entry)
      setConfirmDiscard(null)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'The local change could not be resolved.')
    } finally {
      setBusyId(null)
    }
  }

  const pendingNames = (entry: OutboxEntry) => {
    const patient = entry.patientId ? patients.find((candidate) => candidate.id === entry.patientId) : undefined
    return patient ? `${patient.firstName} ${patient.lastName} · ${patient.hospitalNumber}` : null
  }

  return (
    <div className="page sync-page">
      <PageHeader
        eyebrow="OFFLINE-FIRST · OUTBOX"
        title="Sync centre"
        description={
          <>
            <span>{offline ? 'Operating from this device' : 'Connected to the clinic server'}</span>
            <span className="dot-separator" />
            <span>{lastSyncAt ? `Last sync ${formatDateTime(lastSyncAt)}` : 'No completed sync yet'}</span>
          </>
        }
        actions={
          <button
            type="button"
            className="btn btn--solid btn--sm"
            onClick={syncNow}
            disabled={syncing || !online}
            title={!online ? 'Reconnect before syncing' : undefined}
          >
            {syncing ? <span className="spinner" /> : <Icon name="sync" size={15} />}
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        }
      />

      {result && (
        <div
          className={`notice ${result.error ? 'notice--warn' : result.conflicts > 0 || result.rejected > 0 ? 'notice--warn' : 'notice--ok'}`}
          role="status"
          style={{ marginBottom: 16 }}
        >
          <Icon name={result.error ? 'alert' : 'check'} size={16} />
          <span>
            {result.error
              ? result.error
              : result.attempted === 0
                ? 'There are no queued changes to send.'
                : `${result.applied} change(s) applied · ${result.conflicts} conflict(s) · ${result.rejected} rejected.`}
          </span>
        </div>
      )}

      {actionError && (
        <div className="notice notice--danger" role="alert" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={16} />
          <span>{actionError}</span>
        </div>
      )}

      <section className="sync-status-grid">
        <div className={`sync-status-card ${offline ? 'is-offline' : 'is-ok'}`}>
          <span className="sync-status-icon">
            <Icon name={offline ? 'wifi-off' : 'wifi'} size={18} />
          </span>
          <p className="panel-kicker">CONNECTION</p>
          <h2>{offline ? 'Offline mode' : 'Server reachable'}</h2>
          <p>{offline ? 'New work is stored locally and queued.' : 'The server can accept the local outbox.'}</p>
        </div>
        <div className="sync-status-card">
          <span className="sync-status-icon">
            <Icon name="cloud" size={18} />
          </span>
          <p className="panel-kicker">QUEUED</p>
          <h2>{pendingCount}</h2>
          <p>{pendingCount === 0 ? 'No local changes are waiting.' : `${plural(pendingCount, 'change')} waiting to be applied.`}</p>
        </div>
        <div className={`sync-status-card ${review.length > 0 ? 'is-warn' : ''}`}>
          <span className="sync-status-icon">
            <Icon name="alert" size={18} />
          </span>
          <p className="panel-kicker">NEEDS REVIEW</p>
          <h2>{conflictCount}</h2>
          <p>{conflictCount === 0 ? 'No conflicts or rejections.' : 'A human decision is required.'}</p>
        </div>
        <div className="sync-status-card">
          <span className="sync-status-icon">
            <Icon name="clock" size={18} />
          </span>
          <p className="panel-kicker">LAST SUCCESS</p>
          <h2 className="sync-status-time">{lastSyncAt ? formatDateTime(lastSyncAt) : 'Never'}</h2>
          <p>Retries use the same operation IDs.</p>
        </div>
      </section>

      <div className="sync-grid">
        <section className="panel sync-outbox-panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">LOCAL OUTBOX</p>
              <h2>Changes on this device</h2>
            </div>
            <span className="panel-count">{queued.length + review.length}</span>
          </div>

          {outbox.length === 0 ? (
            <EmptyState
              compact
              icon="check"
              title="The outbox is empty."
              copy="Every registration and visit change on this device has been sent to the server. Local records remain available if the connection drops again."
              action={
                <button type="button" className="btn btn--outline btn--sm" onClick={syncNow} disabled={offline || syncing}>
                  <Icon name="sync" size={14} /> Check again
                </button>
              }
            />
          ) : (
            <div className="outbox-list">
              {outbox.map((entry) => {
                const name = pendingNames(entry)
                const isConflict = entry.status === 'conflict'
                const isRejected = entry.status === 'rejected'
                return (
                  <article className="outbox-item" key={entry.id}>
                    <span className={`outbox-state outbox-state--${entry.status}`}>
                      <Icon
                        name={entry.status === 'pending' || entry.status === 'syncing' ? 'cloud' : 'alert'}
                        size={14}
                      />
                    </span>
                    <div className="outbox-main">
                      <div className="outbox-head">
                        <strong>{OP_LABELS[entry.operation.type]}</strong>
                        <span className={`tag ${isConflict ? 'tag--warn' : isRejected ? 'tag--danger' : 'tag--pending'}`}>
                          {entry.status === 'pending'
                            ? 'Queued'
                            : entry.status === 'syncing'
                              ? 'Syncing'
                              : entry.status === 'conflict'
                                ? 'Conflict'
                                : 'Rejected'}
                        </span>
                      </div>
                      <span className="outbox-meta">
                        {name ?? 'Related patient record'}
                        {' · '}created {formatDateTime(entry.createdAt)}
                        {' · '}attempt {entry.attempts}
                      </span>
                      {entry.lastError && <p className="outbox-error">{entry.lastError}</p>}
                      {entry.serverEncounter && (
                        <div className="outbox-conflict-box">
                          <span>
                            Server version: <strong>{entry.serverEncounter.status.replace('_', ' ')}</strong> · v
                            {entry.serverEncounter.version}
                          </span>
                          <span>Updated {formatDateTime(entry.serverEncounter.updatedAt)}</span>
                        </div>
                      )}
                      {entry.candidates && entry.candidates.length > 0 && (
                        <div className="outbox-conflict-box">
                          <span>Probable existing record:</span>
                          {entry.candidates.slice(0, 3).map((candidate) => (
                            <span key={candidate.patient.id}>
                              <strong>
                                {candidate.patient.firstName} {candidate.patient.lastName}
                              </strong>{' '}
                              · {candidate.patient.hospitalNumber} · {Math.round(candidate.score * 100)}% candidate
                              score
                            </span>
                          ))}
                        </div>
                      )}
                      {(isConflict || isRejected) && (
                        <div className="outbox-actions">
                          {isConflict && entry.operation.type === 'update_encounter' && (
                            <button
                              type="button"
                              className="btn btn--outline btn--xs"
                              onClick={() => runAction(entry, 'use-server')}
                              disabled={busyId === entry.id || (offline && !entry.serverEncounter)}
                            >
                              Keep server version
                            </button>
                          )}
                          {isConflict && entry.operation.type !== 'update_encounter' && (
                            <button
                              type="button"
                              className="btn btn--danger btn--xs"
                              onClick={() => setConfirmDiscard(entry)}
                              disabled={busyId === entry.id}
                            >
                              Discard local draft
                            </button>
                          )}
                          {isRejected && (
                            <button
                              type="button"
                              className="btn btn--danger btn--xs"
                              onClick={() => runAction(entry, 'remove')}
                              disabled={busyId === entry.id}
                            >
                              {entry.operation.type === 'register_patient' ? 'Discard rejected draft' : 'Remove & refresh'}
                            </button>
                          )}
                          {entry.patientId && patients.some((patient) => patient.id === entry.patientId) && (
                            <Link to={`/app/patients/${entry.patientId}`} className="btn btn--ghost-light btn--xs">
                              Open local record
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <aside className="sync-side">
          <section className="panel sync-log-panel">
            <div className="panel-head panel-head--tight">
              <div>
                <p className="panel-kicker">RECENT ACTIVITY</p>
                <h2>Sync log</h2>
              </div>
            </div>
            {syncLog.length === 0 ? (
              <p className="panel-footnote">No sync attempts have been recorded on this device yet.</p>
            ) : (
              <ol className="sync-log">
                {syncLog.slice(0, 8).map((log, index) => (
                  <li key={`${log.at}-${index}`}>
                    <span className={`log-dot ${log.conflicts > 0 || log.rejected > 0 || log.applied === 0 ? 'is-warn' : ''}`} />
                    <div>
                      <strong>{log.message}</strong>
                      <span>{formatDateTime(log.at)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="panel sync-info-panel">
            <p className="panel-kicker">HOW THE OUTBOX WORKS</p>
            <h2>Designed for interruption.</h2>
            <ul className="bullet-list">
              <li>Each offline change becomes an immutable operation with a UUID.</li>
              <li>Retries reuse the same ID, so the server returns the original result instead of duplicating a patient.</li>
              <li>Clinical changes are not last-write-wins. Version mismatches become conflicts for human review.</li>
              <li>A failed request never deletes the local record.</li>
            </ul>
          </section>

          <section className="panel sync-limits">
            <p className="panel-kicker">KNOWN LIMITS</p>
            <h2>What this build does not solve.</h2>
            <ul className="bullet-list">
              <li>The browser cache is per device. Clearing site data removes unsynced work.</li>
              <li>A fully disconnected device cannot share records until a path to the server exists.</li>
              <li>Multi-device conflict policy, read-access auditing and production key management are not complete.</li>
              <li>This workspace is configured for one facility.</li>
            </ul>
            <Link to="/app/roadmap" className="panel-link">
              Full build and safety notes <Icon name="arrow-right" size={13} />
            </Link>
          </section>
        </aside>
      </div>

      <Modal
        open={confirmDiscard !== null}
        onClose={() => setConfirmDiscard(null)}
        title="Discard this local draft?"
        footer={
          <>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setConfirmDiscard(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={() => confirmDiscard && runAction(confirmDiscard, 'discard')}
              disabled={busyId === confirmDiscard?.id}
            >
              {busyId === confirmDiscard?.id ? <span className="spinner" /> : <Icon name="close" size={14} />}
              Discard draft
            </button>
          </>
        }
      >
        <p className="modal-copy">
          This deletes the un-synced local patient or visit and its queued operation. It does not touch the server. If
          the conflict points to an existing patient, open that record and check the patient in there instead.
        </p>
        {confirmDiscard?.candidates?.[0] && (
          <div className="notice" style={{ marginTop: 14 }}>
            <Icon name="patients" size={16} />
            <span>
              Probable existing patient: {confirmDiscard.candidates[0].patient.firstName}{' '}
              {confirmDiscard.candidates[0].patient.lastName} ({confirmDiscard.candidates[0].patient.hospitalNumber})
            </span>
          </div>
        )}
      </Modal>
    </div>
  )
}
