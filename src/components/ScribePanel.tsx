import { useEffect, useRef, useState } from 'react'
import type { Encounter } from '@shared/types'
import { Icon } from '@/components/Icon'
import { ErrorNote, InfoNote } from '@/components/ui'
import { draftClinicalNote } from '@/lib/ai-client'
import { api } from '@/lib/api'
import { useAuth } from '@/auth/AuthProvider'
import { encodeRecording, recorderSupported, startRecording, type RecordingSession } from '@/lib/audio'
import { useWorkspace } from '@/workspace/WorkspaceProvider'

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function ScribePanel({ encounter }: { encounter: Encounter }) {
  const { refreshFromServer } = useWorkspace()
  const { user } = useAuth()
  const [approving, setApproving] = useState(false)
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [showTranscript, setShowTranscript] = useState(false)
  const sessionRef = useRef<RecordingSession | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      sessionRef.current?.cancel()
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [])

  async function beginRecording() {
    setError(null)
    try {
      const session = await startRecording()
      sessionRef.current = session
      setRecording(true)
      setSeconds(0)
      timerRef.current = window.setInterval(() => setSeconds((value) => value + 1), 1000)
    } catch {
      setError('Microphone access was refused. You can paste the consultation transcript instead.')
      setShowTranscript(true)
    }
  }

  async function generateFromAudio() {
    const session = sessionRef.current
    if (!session) return
    if (timerRef.current) window.clearInterval(timerRef.current)
    setRecording(false)
    sessionRef.current = null
    setBusy(true)
    setError(null)
    try {
      const { blob } = await session.stop()
      const audio = await encodeRecording(blob)
      await draftClinicalNote({ encounterId: encounter.id, audio })
      await refreshFromServer()
      setSeconds(0)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The note could not be generated.')
    } finally {
      setBusy(false)
    }
  }

  async function generateFromText() {
    setBusy(true)
    setError(null)
    try {
      await draftClinicalNote({ encounterId: encounter.id, transcript })
      await refreshFromServer()
      setTranscript('')
      setShowTranscript(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The note could not be generated.')
    } finally {
      setBusy(false)
    }
  }

  async function setApproval(approved: boolean) {
    setApproving(true)
    setApprovalError(null)
    try {
      await api(`/api/encounters/${encounter.id}/note/approve`, {
        method: 'POST', body: JSON.stringify({ approved }),
      })
      await refreshFromServer()
    } catch (caught) {
      setApprovalError(caught instanceof Error ? caught.message : 'The note approval could not be saved.')
    } finally { setApproving(false) }
  }

  async function sendToEhr() {
    setApproving(true)
    setApprovalError(null)
    try {
      const result = await api<{ message: string }>(`/api/ehr/encounters/${encounter.id}/push-note`, {
        method: 'POST', body: '{}',
      })
      setApprovalError(result.message ?? 'The approved note was written to the external EHR.')
    } catch (caught) {
      setApprovalError(caught instanceof Error ? caught.message : 'The note could not be written to the external EHR.')
    } finally { setApproving(false) }
  }

  function stopWithoutNote() {
    sessionRef.current?.cancel()
    sessionRef.current = null
    if (timerRef.current) window.clearInterval(timerRef.current)
    setRecording(false)
    setSeconds(0)
  }

  const note = encounter.note

  return (
    <section className="panel clinical-panel">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">CLINICAL SUPPORT · SCRIBE</p>
          <h2>{note ? 'Consultation note' : 'Draft the consultation note'}</h2>
        </div>
        {!recording && (
          <button type="button" className="btn btn--outline btn--sm" onClick={() => setShowTranscript((value) => !value)}>
            <Icon name="document" size={14} /> {showTranscript ? 'Hide transcript' : 'Paste transcript'}
          </button>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="scribe-controls">
        {recording ? (
          <>
            <span className="scribe-live">
              <span className="scribe-dot" /> Recording {formatSeconds(seconds)}
            </span>
            <button type="button" className="btn btn--solid btn--sm" onClick={() => void generateFromAudio()}>
              <Icon name="check" size={14} /> Stop &amp; draft note
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={stopWithoutNote}>
              Discard
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--solid btn--sm"
            onClick={() => void beginRecording()}
            disabled={busy || !recorderSupported()}
          >
            <Icon name="mic" size={14} /> {busy ? 'Drafting…' : note ? 'Record another note' : 'Record consultation'}
          </button>
        )}
        {!recorderSupported() && (
          <span className="cell-muted">This browser cannot record audio — paste the transcript instead.</span>
        )}
      </div>

      {showTranscript && !recording && (
        <div className="scribe-transcript">
          <textarea
            rows={5}
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            placeholder="Clinician: What brings you in today?&#10;Patient: Fever for three days and body weakness…"
          />
          <button
            type="button"
            className="btn btn--solid btn--sm"
            onClick={() => void generateFromText()}
            disabled={busy || transcript.trim().length < 10}
          >
            Draft from transcript
          </button>
        </div>
      )}

      {note ? (
        <div className="note-result">
          <div className="note-meta">
            <span>{note.model}</span>
            <span>{new Date(note.generatedAt).toLocaleString()}</span>
            <span>{note.generatedBy}</span>
            {note.audioSeconds > 0 && <span>{formatSeconds(note.audioSeconds)} recorded</span>}
          </div>

          {note.warnings.length > 0 && (
            <div className="notice notice--warn">
              <Icon name="alert" size={16} />
              <span>{note.warnings.join(' · ')}</span>
            </div>
          )}

          <div className="note-sections">
            {(
              [
                ['Subjective', note.subjective],
                ['Objective', note.objective],
                ['Assessment', note.assessment],
                ['Plan', note.plan],
                ['Follow-up', note.followUp],
              ] as Array<[string, string]>
            ).map(([label, body]) => (
              <div className="note-section" key={label}>
                <h4>{label}</h4>
                <p>{body || <span className="cell-muted">Not documented.</span>}</p>
              </div>
            ))}
          </div>

          {(note.patientReported.length > 0 || note.clinicianObserved.length > 0) && (
            <div className="triage-columns">
              <div className="triage-block">
                <h4>Patient reported</h4>
                <ul>
                  {note.patientReported.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="triage-block">
                <h4>Clinician observed</h4>
                <ul>
                  {note.clinicianObserved.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {note.transcript && (
            <details className="triage-reasoning">
              <summary>Transcript</summary>
              <p>{note.transcript}</p>
            </details>
          )}

          <div className="note-approval">
            {encounter.noteApprovedAt ? (
              <div className="notice notice--ok"><Icon name="check" size={15} /><span>Approved by {encounter.noteApprovedBy} on {new Date(encounter.noteApprovedAt).toLocaleString()}. This is the version used for the record and any EHR write-back.</span></div>
            ) : (
              <div className="notice notice--warn"><Icon name="alert" size={15} /><span>Draft only. A clinician must review and approve before this note becomes part of the record.</span></div>
            )}
            {approvalError && <p className="inline-error" role="status"><Icon name="info" size={14} /> {approvalError}</p>}
            {(user?.role === 'clinician' || user?.role === 'admin') && (
              <div className="platform-actions">
                <button type="button" className="btn btn--solid btn--sm" onClick={() => void setApproval(!encounter.noteApprovedAt)} disabled={approving}>
                  {approving ? <span className="spinner" /> : <Icon name="check" size={14} />}
                  {encounter.noteApprovedAt ? 'Withdraw approval' : 'Approve clinical note'}
                </button>
                {encounter.noteApprovedAt && (
                  <button type="button" className="btn btn--outline btn--sm" onClick={() => void sendToEhr()} disabled={approving}>
                    <Icon name="arrow-up-right" size={14} /> Send approved note to EHR
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="triage-foot">
            Drafted from the recording. A clinician reviews and signs this note before it becomes part of the record.
          </p>
        </div>
      ) : (
        <InfoNote>
          Record the consultation (up to three minutes) and Afribok drafts a SOAP note, keeping what the patient said
          separate from what the clinician observed.
        </InfoNote>
      )}
    </section>
  )
}
