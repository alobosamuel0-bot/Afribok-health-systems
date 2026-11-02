import { useState } from 'react'
import type { TriageAssessment } from '@shared/clinical'
import type { Encounter } from '@shared/types'
import { Icon } from '@/components/Icon'
import { ErrorNote, InfoNote } from '@/components/ui'
import { runTriage } from '@/lib/ai-client'
import { useWorkspace } from '@/workspace/WorkspaceProvider'

const LEVEL_CLASS: Record<number, string> = {
  1: 'triage-badge triage-badge--1',
  2: 'triage-badge triage-badge--2',
  3: 'triage-badge triage-badge--3',
  4: 'triage-badge triage-badge--4',
  5: 'triage-badge triage-badge--5',
}

export function TriageBadge({ level, label }: { level: number; label: string }) {
  return (
    <span className={LEVEL_CLASS[level] ?? 'triage-badge'}>
      <strong>{level}</strong> {label}
    </span>
  )
}

function AssessmentView({ triage }: { triage: TriageAssessment }) {
  return (
    <div className="triage-result">
      <div className="triage-head">
        <TriageBadge level={triage.level} label={triage.label} />
        <span className="triage-meta">
          {Math.round(triage.confidence * 100)}% confidence · {triage.model}
        </span>
      </div>

      {triage.redFlags.length > 0 && (
        <div className="triage-block triage-block--flags">
          <h4>
            <Icon name="alert" size={14} /> Danger signs found
          </h4>
          <ul>
            {triage.redFlags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="triage-columns">
        <div className="triage-block">
          <h4>Take now</h4>
          {triage.observations.length > 0 ? (
            <ul>
              {triage.observations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="cell-muted">No specific observation suggested.</p>
          )}
        </div>
        <div className="triage-block">
          <h4>Disposition</h4>
          <p>{triage.disposition || 'Not stated by the model.'}</p>
        </div>
      </div>

      {triage.reasoning && (
        <details className="triage-reasoning">
          <summary>Why this level</summary>
          <p>{triage.reasoning}</p>
        </details>
      )}
      <p className="triage-foot">
        Assessed by {triage.assessedBy} · {new Date(triage.assessedAt).toLocaleString()}. Decision support only — the
        attending clinician sets the priority.
      </p>
    </div>
  )
}

export function TriagePanel({ encounter }: { encounter: Encounter }) {
  const { refreshFromServer } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [vitals, setVitals] = useState({ temperature: '', bloodPressure: '', pulse: '', oxygen: '' })
  const [notes, setNotes] = useState('')
  const [showInputs, setShowInputs] = useState(false)

  const triage = encounter.triage

  async function assess() {
    setBusy(true)
    setError(null)
    try {
      const recorded = Object.fromEntries(
        Object.entries(vitals)
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value) as Array<[string, string]>,
      )
      await runTriage(encounter.id, { vitals: recorded, notes: notes.trim() || undefined })
      await refreshFromServer()
      setShowInputs(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Triage could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel clinical-panel">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">CLINICAL SUPPORT · TRIAGE</p>
          <h2>{triage ? 'Triage assessment' : 'No triage assessment on this visit yet'}</h2>
        </div>
        <button
          type="button"
          className="btn btn--solid btn--sm"
          onClick={() => void assess()}
          disabled={busy}
        >
          <Icon name="stethoscope" size={14} /> {busy ? 'Assessing…' : triage ? 'Re-assess' : 'Run AI triage'}
        </button>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {showInputs && !busy && (
        <div className="triage-inputs">
          <label>
            Temperature
            <input
              value={vitals.temperature}
              onChange={(event) => setVitals({ ...vitals, temperature: event.target.value })}
              placeholder="38.4 °C"
            />
          </label>
          <label>
            Blood pressure
            <input
              value={vitals.bloodPressure}
              onChange={(event) => setVitals({ ...vitals, bloodPressure: event.target.value })}
              placeholder="118/74"
            />
          </label>
          <label>
            Pulse
            <input
              value={vitals.pulse}
              onChange={(event) => setVitals({ ...vitals, pulse: event.target.value })}
              placeholder="96"
            />
          </label>
          <label>
            SpO₂
            <input
              value={vitals.oxygen}
              onChange={(event) => setVitals({ ...vitals, oxygen: event.target.value })}
              placeholder="97%"
            />
          </label>
          <label className="triage-notes">
            Anything else the clinician noted
            <textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Collapsed at the market, now alert but pale"
            />
          </label>
          <div className="triage-input-actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setShowInputs(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn--solid btn--sm" onClick={() => void assess()}>
              Assess with these observations
            </button>
          </div>
        </div>
      )}

      {!showInputs && !busy && (
        <button type="button" className="panel-link triage-add-obs" onClick={() => setShowInputs(true)}>
          Add observations before assessing <Icon name="arrow-right" size={13} />
        </button>
      )}

      {triage ? (
        <AssessmentView triage={triage} />
      ) : (
        <InfoNote>
          Triage reads the presenting complaint and any observations you add, then proposes a 1–5 urgency level with
          danger signs and the next step. It never sets the priority on its own.
        </InfoNote>
      )}
    </section>
  )
}
