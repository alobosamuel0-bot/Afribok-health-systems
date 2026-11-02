import { useEffect, useRef, useState } from 'react'
import type { OcrExtraction } from '@shared/clinical'
import { Icon } from '@/components/Icon'
import { ErrorNote, Modal } from '@/components/ui'
import { extractPaperRecord } from '@/lib/ai-client'

export type ScannedFields = Partial<{
  firstName: string
  lastName: string
  otherNames: string
  sex: string
  dateOfBirth: string
  phone: string
  address: string
  hospitalNumber: string
  identifierType: string
  identifierValue: string
  chiefComplaint: string
}>

const FIELD_LABELS: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  otherNames: 'Other names',
  sex: 'Sex',
  dateOfBirth: 'Date of birth',
  phone: 'Phone',
  address: 'Address',
  hospitalNumber: 'Hospital number',
  identifierType: 'Identifier type',
  identifierValue: 'Identifier value',
  chiefComplaint: 'Presenting complaint',
}

function confidenceTone(confidence: number): string {
  if (confidence >= 0.75) return 'scan-confidence scan-confidence--high'
  if (confidence >= 0.45) return 'scan-confidence scan-confidence--medium'
  return 'scan-confidence scan-confidence--low'
}

export function PaperScanDialog({
  open,
  onClose,
  onApply,
}: {
  open: boolean
  onClose: () => void
  onApply: (fields: ScannedFields) => void
}) {
  const [extraction, setExtraction] = useState<OcrExtraction | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setExtraction(null)
      setPreview(null)
      setBusy(false)
      setError(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }, [open])

  async function scan(file: File) {
    setBusy(true)
    setError(null)
    setExtraction(null)
    try {
      setPreview(URL.createObjectURL(file))
      const result = await extractPaperRecord(file)
      setExtraction(result)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The paper record could not be read.')
    } finally {
      setBusy(false)
    }
  }

  function apply() {
    if (!extraction) return
    const fields: ScannedFields = {}
    for (const [key, entry] of Object.entries(extraction.fields)) {
      if (!entry.value) continue
      if (!(key in FIELD_LABELS)) continue
      if (key === 'sex') {
        const value = entry.value.toLowerCase()
        fields.sex = value.startsWith('f') ? 'female' : value.startsWith('m') ? 'male' : 'unknown'
        continue
      }
      fields[key as keyof ScannedFields] = entry.value
    }
    onApply(fields)
    onClose()
  }

  const entries = extraction
    ? Object.entries(extraction.fields).filter(([key]) => key in FIELD_LABELS)
    : []
  const filled = entries.filter(([, entry]) => Boolean(entry.value))

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Read a paper record"
      footer={
        <>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn--solid btn--sm"
            onClick={apply}
            disabled={!extraction || filled.length === 0}
          >
            <Icon name="check" size={14} /> Use these details
          </button>
        </>
      }
    >
      <p className="modal-lead">
        Photograph the paper card or register page. Afribok reads it and fills the form — a person still checks every
        field before the record is saved.
      </p>

      <div className="scan-grid">
        <div className="scan-capture">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            id="paper-record-input"
            className="visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void scan(file)
            }}
          />
          <label htmlFor="paper-record-input" className={`scan-drop${busy ? ' is-busy' : ''}`}>
            {preview ? (
              <img src={preview} alt="Paper record preview" className="scan-preview" />
            ) : (
              <>
                <Icon name="camera" size={26} />
                <strong>{busy ? 'Reading the record…' : 'Take a photo or choose an image'}</strong>
                <small>Blurred and skewed photos are handled — low-confidence fields are flagged.</small>
              </>
            )}
          </label>
          {preview && (
            <label htmlFor="paper-record-input" className="btn btn--outline btn--sm scan-retake">
              <Icon name="camera" size={14} /> {busy ? 'Reading…' : 'Take another'}
            </label>
          )}
        </div>

        <div className="scan-result" aria-live="polite">
          {error && <ErrorNote>{error}</ErrorNote>}
          {!error && !extraction && (
            <p className="scan-hint">
              The extraction appears here with a confidence for each field, so an unclear digit is visible rather than
              silently assumed.
            </p>
          )}
          {extraction && (
            <>
              <div className="scan-summary">
                <span className={`tag ${extraction.legible ? 'tag--ok' : 'tag--warn'}`}>
                  {extraction.legible ? 'Legible' : 'Partly unreadable'}
                </span>
                <span className="scan-doc">{extraction.documentType}</span>
                <span className="scan-overall">{Math.round(extraction.confidence * 100)}% overall</span>
              </div>
              <ul className="scan-fields">
                {entries.map(([key, entry]) => (
                  <li key={key}>
                    <span className="scan-field-label">{FIELD_LABELS[key]}</span>
                    <span className="scan-field-value">{entry.value ?? <em>not readable</em>}</span>
                    <span className={confidenceTone(entry.confidence)}>
                      {Math.round(entry.confidence * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
              {extraction.warnings.length > 0 && (
                <div className="notice notice--warn">
                  <Icon name="alert" size={16} />
                  <span>{extraction.warnings.join(' · ')}</span>
                </div>
              )}
              {extraction.rawText && (
                <details className="scan-raw">
                  <summary>Text seen on the record</summary>
                  <pre>{extraction.rawText}</pre>
                </details>
              )}
              <p className="scan-model">
                Read with {extraction.model} at {new Date(extraction.processedAt).toLocaleTimeString()}. Confirm every
                field with the patient or the original document.
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
