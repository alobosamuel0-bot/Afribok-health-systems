import { useState } from 'react'
import { can } from '@shared/types'
import { useAuth } from '@/auth/AuthProvider'
import { useWorkspace } from '@/workspace/WorkspaceProvider'
import type { LocalEncounter } from '@/lib/local-types'
import { Modal } from './ui'
import { Icon } from './Icon'

export function EncounterActions({ encounter }: { encounter: LocalEncounter }) {
  const { updateEncounter } = useWorkspace()
  const { user } = useAuth()
  const [busy, setBusy] = useState<'start' | 'complete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmComplete, setConfirmComplete] = useState(false)

  if (!can(user?.role, 'encounter.update') || encounter.status === 'completed') return null
  const blocked = encounter.syncState === 'conflict' || encounter.syncState === 'rejected'

  async function start() {
    setBusy('start')
    setError(null)
    try {
      await updateEncounter(encounter.id, { status: 'in_consultation' })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The visit could not be updated.')
    } finally {
      setBusy(null)
    }
  }

  async function complete() {
    setBusy('complete')
    setError(null)
    try {
      await updateEncounter(encounter.id, { status: 'completed' })
      setConfirmComplete(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The visit could not be updated.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="encounter-actions">
      {encounter.status === 'waiting' && (
        <button
          type="button"
          className="btn btn--outline btn--xs"
          onClick={start}
          disabled={busy !== null || blocked}
          title={blocked ? 'Resolve this visit’s sync conflict first' : undefined}
        >
          {busy === 'start' ? <span className="spinner" /> : <Icon name="stethoscope" size={13} />}
          Start consultation
        </button>
      )}
      {encounter.status === 'in_consultation' && (
        <button
          type="button"
          className="btn btn--solid btn--xs"
          onClick={() => setConfirmComplete(true)}
          disabled={busy !== null || blocked}
          title={blocked ? 'Resolve this visit’s sync conflict first' : undefined}
        >
          <Icon name="check" size={13} />
          Complete
        </button>
      )}
      {error && <span className="encounter-action-error">{error}</span>}

      <Modal
        open={confirmComplete}
        onClose={() => setConfirmComplete(false)}
        title="Mark this visit complete?"
        footer={
          <>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setConfirmComplete(false)}>
              Keep it open
            </button>
            <button type="button" className="btn btn--solid btn--sm" onClick={complete} disabled={busy !== null}>
              {busy === 'complete' ? <span className="spinner" /> : <Icon name="check" size={14} />}
              Confirm complete
            </button>
          </>
        }
      >
        <p className="modal-copy">
          This closes the current visit for this patient. In this build a completed visit cannot be reopened.
          Clinical notes are not part of Stage 1 and nothing clinical will be inferred.
        </p>
      </Modal>
    </div>
  )
}
