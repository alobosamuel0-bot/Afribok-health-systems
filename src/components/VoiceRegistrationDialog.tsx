import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { ErrorNote, Modal } from '@/components/ui'
import { structureRegistration, type RegistrationExtraction } from '@/lib/ai-client'
import { encodeRecording, recorderSupported, startRecording, type RecordingSession } from '@/lib/audio'

export type VoiceFields = Partial<{
  firstName: string
  lastName: string
  otherNames: string
  sex: string
  dateOfBirth: string
  phone: string
  address: string
  chiefComplaint: string
  allergies: string
  medicalHistory: string
  currentMedications: string
}>

const LABELS: Record<string, string> = {
  firstName: 'First name', lastName: 'Last name', otherNames: 'Other names', sex: 'Sex',
  dateOfBirth: 'Date of birth', phone: 'Phone', address: 'Address',
  chiefComplaint: 'Presenting complaint', allergies: 'Allergies',
  medicalHistory: 'Medical history', currentMedications: 'Current medications',
}

function seconds(value: number): string {
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

export function VoiceRegistrationDialog({
  open,
  onClose,
  onApply,
}: {
  open: boolean
  onClose: () => void
  onApply: (fields: VoiceFields) => void
}) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [result, setResult] = useState<RegistrationExtraction | null>(null)
  const sessionRef = useRef<RecordingSession | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!open) {
      sessionRef.current?.cancel()
      sessionRef.current = null
      if (timerRef.current) window.clearInterval(timerRef.current)
      setRecording(false); setElapsed(0); setBusy(false); setError(null); setTranscript(''); setResult(null)
    }
  }, [open])

  async function begin() {
    setError(null)
    try {
      const session = await startRecording()
      sessionRef.current = session
      setRecording(true); setElapsed(0)
      timerRef.current = window.setInterval(() => setElapsed((value) => value + 1), 1000)
    } catch {
      setError('Microphone access was refused. Paste the conversation transcript instead.')
    }
  }

  async function stopAndStructure() {
    const session = sessionRef.current
    if (!session) return
    if (timerRef.current) window.clearInterval(timerRef.current)
    setRecording(false); sessionRef.current = null; setBusy(true); setError(null)
    try {
      const { blob } = await session.stop()
      const audio = await encodeRecording(blob)
      setResult(await structureRegistration({ audio }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The conversation could not be structured.')
    } finally { setBusy(false) }
  }

  async function structureText() {
    if (transcript.trim().length < 10) return
    setBusy(true); setError(null)
    try {
      setResult(await structureRegistration({ transcript }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The transcript could not be structured.')
    } finally { setBusy(false) }
  }

  function apply() {
    if (!result) return
    const fields: VoiceFields = {}
    for (const [key, entry] of Object.entries(result.fields)) {
      if (!entry.value || !(key in LABELS)) continue
      if (key === 'sex') {
        const value = entry.value.toLowerCase()
        fields.sex = value.startsWith('f') ? 'female' : value.startsWith('m') ? 'male' : 'other'
        continue
      }
      fields[key as keyof VoiceFields] = entry.value
    }
    onApply(fields)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Register by voice"
      footer={
        <>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>Close</button>
          <button type="button" className="btn btn--solid btn--sm" onClick={apply} disabled={!result}>
            <Icon name="check" size={14} /> Use these details
          </button>
        </>
      }
    >
      <p className="modal-lead">
        Record the registration conversation with consent, or paste a transcript. Afribok fills the form; a person
        checks every field against what the patient actually said before saving.
      </p>
      <div className="voice-record-row">
        {recording ? (
          <>
            <span className="scribe-live"><span className="scribe-dot" /> Recording {seconds(elapsed)}</span>
            <button type="button" className="btn btn--solid btn--sm" onClick={() => void stopAndStructure()}>
              <Icon name="check" size={14} /> Stop &amp; structure
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--solid btn--sm" onClick={() => void begin()} disabled={busy || !recorderSupported()}>
            <Icon name="mic" size={14} /> {busy ? 'Structuring…' : 'Record conversation'}
          </button>
        )}
        {!recorderSupported() && <span className="cell-muted">This browser cannot record audio; paste the transcript.</span>}
      </div>
      <div className="scribe-transcript">
        <textarea rows={4} value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Nurse: What is your name?&#10;Patient: My name is Amina Yusuf, I am 34…" />
        <button type="button" className="btn btn--outline btn--sm" onClick={() => void structureText()} disabled={busy || transcript.trim().length < 10}>
          Structure transcript
        </button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {result && (
        <div className="voice-result">
          <div className="scan-summary">
            <span className="tag tag--ok">{result.model}</span>
            <span className="scan-overall">{result.warnings.length} warning(s)</span>
          </div>
          <ul className="scan-fields">
            {Object.entries(result.fields).filter(([key]) => key in LABELS).map(([key, entry]) => (
              <li key={key}>
                <span className="scan-field-label">{LABELS[key]}</span>
                <span className="scan-field-value">{entry.value ?? <em>not stated</em>}</span>
                <span className={`scan-confidence ${entry.confidence >= 0.75 ? 'scan-confidence--high' : entry.confidence >= 0.45 ? 'scan-confidence--medium' : 'scan-confidence--low'}`}>
                  {Math.round(entry.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
          {result.warnings.length > 0 && (
            <div className="notice notice--warn"><Icon name="alert" size={15} /><span>{result.warnings.join(' · ')}</span></div>
          )}
        </div>
      )}
    </Modal>
  )
}
