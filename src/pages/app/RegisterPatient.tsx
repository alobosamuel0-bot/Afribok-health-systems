import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Department, Sex } from '@shared/types'
import { findCandidates } from '@shared/match'
import { Icon } from '@/components/Icon'
import { Avatar, PageHeader } from '@/components/ui'
import { useWorkspace } from '@/workspace/WorkspaceProvider'
import { PaperScanDialog, type ScannedFields } from '@/components/PaperScanDialog'
import { VoiceRegistrationDialog, type VoiceFields } from '@/components/VoiceRegistrationDialog'
import { api } from '@/lib/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { ageOf, plural, sexLabel } from '@/lib/format'
import type { LocalEncounter, LocalPatient } from '@/lib/local-types'

interface FormState {
  firstName: string
  lastName: string
  otherNames: string
  sex: Sex | ''
  dateOfBirth: string
  phone: string
  address: string
  identifierType: string
  identifierValue: string
  allergies: string
  medicalHistory: string
  currentMedications: string
  chiefComplaint: string
  departmentId: string
  consent: boolean
}

const EMPTY: FormState = {
  firstName: '',
  lastName: '',
  otherNames: '',
  sex: '',
  dateOfBirth: '',
  phone: '',
  address: '',
  identifierType: '',
  identifierValue: '',
  allergies: '',
  medicalHistory: '',
  currentMedications: '',
  chiefComplaint: '',
  departmentId: '',
  consent: false,
}

const ID_TYPES = ['National ID', 'Insurance number', 'Other hospital ID', 'Other identifier']

export default function RegisterPatient() {
  usePageTitle('Register patient')
  const { patients, encounters, registerPatient, online, serverReachable } = useWorkspace()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [registered, setRegistered] = useState<{ patient: LocalPatient; encounter: LocalEncounter } | null>(null)
  const duplicateRef = useRef<HTMLDivElement>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [scanNotice, setScanNotice] = useState<string | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])

  useEffect(() => {
    api<{ departments: Department[] }>('/api/departments')
      .then((result) => setDepartments(result.departments))
      .catch(() => setDepartments([]))
  }, [])
  const offline = !online || serverReachable === false

  const candidates = useMemo(() => {
    if (form.firstName.trim().length < 2 || form.lastName.trim().length < 2) return []
    return findCandidates(
      {
        firstName: form.firstName,
        lastName: form.lastName,
        otherNames: form.otherNames || null,
        sex: (form.sex || 'unknown') as Sex,
        dateOfBirth: form.dateOfBirth || null,
        phone: form.phone || null,
        identifierValue: form.identifierValue || null,
      },
      patients,
      0.58,
    )
  }, [form.firstName, form.lastName, form.otherNames, form.sex, form.dateOfBirth, form.phone, form.identifierValue, patients])

  const openVisits = encounters.filter((encounter) => encounter.status !== 'completed').length
  const syncBacklog = patients.filter((patient) => patient.syncState !== 'synced').length

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setError(null)
    setFieldError(null)
  }

  function applyVoice(fields: VoiceFields) {
    setForm((current) => ({ ...current, ...fields, sex: (fields.sex as FormState['sex']) ?? current.sex }))
    setScanNotice('Registration conversation structured. Check every field with the patient before saving.')
  }

  function applyScan(fields: ScannedFields) {
    setForm((current) => {
      const next = { ...current }
      for (const [key, value] of Object.entries(fields)) {
        if (!value) continue
        const field = key as keyof FormState
        if (field === 'sex') {
          next.sex = value as FormState['sex']
          continue
        }
        next[field] = value as never
      }
      return next
    })
    setScanNotice('Paper record read. Check every field against the original before saving.')
    setError(null)
    setFieldError(null)
  }

  function reset() {
    setForm(EMPTY)
    setAcknowledged(false)
    setRegistered(null)
    setError(null)
    setFieldError(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setFieldError(null)
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setFieldError('First name and surname are required to create a patient record.')
      return
    }
    if (!form.sex) {
      setFieldError('Record the patient’s sex as provided at registration.')
      return
    }
    if (!form.consent) {
      setFieldError('Record the patient’s consent for registration and clinical documentation.')
      return
    }
    if (candidates.length > 0 && !acknowledged) {
      setError('Possible existing records were found. Review the candidates below before creating a new patient.')
      duplicateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setSubmitting(true)
    try {
      const result = await registerPatient({
        firstName: form.firstName,
        lastName: form.lastName,
        otherNames: form.otherNames,
        sex: form.sex,
        dateOfBirth: form.dateOfBirth,
        phone: form.phone,
        address: form.address,
        identifierType: form.identifierType,
        identifierValue: form.identifierValue,
        allergies: form.allergies,
        medicalHistory: form.medicalHistory,
        currentMedications: form.currentMedications,
        chiefComplaint: form.chiefComplaint,
        departmentId: form.departmentId || null,
        consentRecorded: form.consent,
        duplicateAcknowledged: acknowledged,
      })
      setRegistered(result)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Registration could not be saved on this device.')
    } finally {
      setSubmitting(false)
    }
  }

  if (registered) {
    const patient = registered.patient
    return (
      <div className="page register-page">
        <PageHeader
          eyebrow="REGISTRATION COMPLETE"
          title="Patient added to the local queue."
          description={
            <>
              <span>Saved on this device first</span>
              <span className="dot-separator" />
              <span>{offline ? 'Will sync when the connection returns' : 'Sync has been queued'}</span>
            </>
          }
        />

        <div className="registration-success">
          <div className="success-mark">
            <Icon name="check" size={26} />
          </div>
          <div className="success-main">
            <p className="panel-kicker">PATIENT RECORD</p>
            <h2>
              {patient.firstName} {patient.otherNames ? `${patient.otherNames} ` : ''}
              {patient.lastName}
            </h2>
            <div className="success-meta">
              <span>{patient.hospitalNumber}</span>
              <span>{sexLabel(patient.sex)}</span>
              <span>{ageOf(patient)}</span>
              <span>{offline ? 'Queued on device' : 'Syncing'}</span>
            </div>
            <p className="success-copy">
              A waiting visit was opened for the presenting complaint
              {registered.encounter.chiefComplaint ? `: “${registered.encounter.chiefComplaint}”` : '.'} The local outbox
              will apply the registration and visit with an idempotent operation ID. If the server finds a likely
              duplicate, it will stop and surface the conflict rather than link records automatically.
            </p>
            <div className="success-actions">
              <Link to={`/app/patients/${patient.id}`} className="btn btn--solid btn--sm">
                Open patient record
                <Icon name="arrow-right" size={14} />
              </Link>
              <button type="button" className="btn btn--outline btn--sm" onClick={reset}>
                Register another patient
              </button>
              <Link to="/app/sync" className="btn btn--ghost-light btn--sm success-sync-link">
                View sync queue ({syncBacklog} patient{syncBacklog === 1 ? '' : 's'} awaiting)
              </Link>
            </div>
          </div>
        </div>

        <div className="registration-note-grid">
          <div className="panel mini-panel">
            <p className="panel-kicker">NEXT</p>
            <h3>What happens to this visit?</h3>
            <p>
              It is a waiting visit in the operational queue. Open the record to run triage support and record the
              consultation; the clinician still sets the priority.
            </p>
          </div>
          <div className="panel mini-panel">
            <p className="panel-kicker">SAFETY</p>
            <h3>If the patient needs urgent care</h3>
            <p>
              Do not wait for Afribok to sync. Escalate immediately using the hospital’s approved emergency pathway.
              This software is not an emergency service.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page register-page">
      <PageHeader
        eyebrow="PATIENT REGISTRATION"
        title="Register a patient."
        description={
          <>
            <span>Only names and sex are required in this configured form</span>
            <span className="dot-separator" />
            <span>{offline ? 'Saved to this device' : 'Local-first · syncs automatically'}</span>
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn--solid btn--sm" onClick={() => setScanOpen(true)}>
              <Icon name="camera" size={15} /> Scan paper record
            </button>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setVoiceOpen(true)}>
              <Icon name="mic" size={15} /> Voice-assisted registration
            </button>
            <Link to="/app/patients" className="btn btn--outline btn--sm">
              <Icon name="search" size={15} /> Find an existing patient
            </Link>
          </>
        }
      />

      <PaperScanDialog open={scanOpen} onClose={() => setScanOpen(false)} onApply={applyScan} />
      <VoiceRegistrationDialog open={voiceOpen} onClose={() => setVoiceOpen(false)} onApply={applyVoice} />

      {scanNotice && (
        <div className="notice notice--ok" role="status">
          <Icon name="check" size={16} />
          <span>{scanNotice}</span>
        </div>
      )}

      <div className="register-grid">
        <form className="panel register-form-panel" onSubmit={submit} noValidate>
          <div className="form-section">
            <div className="form-section-head">
              <span className="form-section-number">01</span>
              <div>
                <h2>Identity</h2>
                <p>Capture what is available. Do not force missing demographics to fit the form.</p>
              </div>
            </div>

            <div className="form-grid">
              <div className="field">
                <label htmlFor="firstName">
                  First name <span className="optional">required</span>
                </label>
                <input
                  id="firstName"
                  autoComplete="given-name"
                  value={form.firstName}
                  onChange={(event) => update('firstName', event.target.value)}
                  placeholder="e.g. Amina"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="lastName">
                  Surname <span className="optional">required</span>
                </label>
                <input
                  id="lastName"
                  autoComplete="family-name"
                  value={form.lastName}
                  onChange={(event) => update('lastName', event.target.value)}
                  placeholder="e.g. Yusuf"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="otherNames">
                  Other names <span className="optional">optional</span>
                </label>
                <input
                  id="otherNames"
                  value={form.otherNames}
                  onChange={(event) => update('otherNames', event.target.value)}
                  placeholder="Middle or alternate names"
                />
              </div>
              <div className="field">
                <label htmlFor="sex">
                  Sex recorded <span className="optional">required</span>
                </label>
                <select
                  id="sex"
                  value={form.sex}
                  onChange={(event) => update('sex', event.target.value as Sex | '')}
                  required
                >
                  <option value="">Select…</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                  <option value="unknown">Not recorded / decline</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="dateOfBirth">
                  Date of birth <span className="optional">optional</span>
                </label>
                <input
                  id="dateOfBirth"
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={form.dateOfBirth}
                  onChange={(event) => update('dateOfBirth', event.target.value)}
                />
                <p className="field-hint">Age is computed locally; do not guess a date of birth.</p>
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-head">
              <span className="form-section-number">02</span>
              <div>
                <h2>Contact and identifiers</h2>
                <p>Optional in this configured facility. A missing phone number must not block registration.</p>
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="phone">
                  Phone <span className="optional">optional</span>
                </label>
                <input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(event) => update('phone', event.target.value)}
                  placeholder="As provided by the patient"
                />
              </div>
              <div className="field">
                <label htmlFor="address">
                  Address <span className="optional">optional</span>
                </label>
                <input
                  id="address"
                  autoComplete="street-address"
                  value={form.address}
                  onChange={(event) => update('address', event.target.value)}
                  placeholder="Area or town"
                />
              </div>
              <div className="field">
                <label htmlFor="identifierType">
                  Identifier type <span className="optional">optional</span>
                </label>
                <select
                  id="identifierType"
                  value={form.identifierType}
                  onChange={(event) => update('identifierType', event.target.value)}
                >
                  <option value="">None</option>
                  {ID_TYPES.map((type) => (
                    <option value={type} key={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="identifierValue">
                  Identifier value <span className="optional">optional</span>
                </label>
                <input
                  id="identifierValue"
                  value={form.identifierValue}
                  onChange={(event) => update('identifierValue', event.target.value)}
                  placeholder="Only if the document is present"
                  disabled={!form.identifierType}
                />
                <p className="field-hint">Do not invent an identifier. Leave blank if it is unavailable.</p>
              </div>
              <div className="field">
                <label htmlFor="allergies">Allergies <span className="optional">optional, patient-reported</span></label>
                <input id="allergies" value={form.allergies} onChange={(event) => update('allergies', event.target.value)} placeholder="e.g. Penicillin — rash" />
              </div>
              <div className="field">
                <label htmlFor="medicalHistory">Relevant medical history <span className="optional">optional</span></label>
                <input id="medicalHistory" value={form.medicalHistory} onChange={(event) => update('medicalHistory', event.target.value)} placeholder="e.g. Hypertension since 2019" />
              </div>
              <div className="field">
                <label htmlFor="currentMedications">Current medications <span className="optional">optional</span></label>
                <input id="currentMedications" value={form.currentMedications} onChange={(event) => update('currentMedications', event.target.value)} placeholder="Only what the patient reports taking" />
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-head">
              <span className="form-section-number">03</span>
              <div>
                <h2>Current visit</h2>
                <p>Open a waiting visit. This is workflow status, not a triage category.</p>
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="departmentId">Department <span className="optional">configured by the hospital</span></label>
                <select id="departmentId" value={form.departmentId} onChange={(event) => update('departmentId', event.target.value)}>
                  <option value="">Use my assigned department</option>
                  {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select>
              </div>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={form.consent} onChange={(event) => update('consent', event.target.checked)} />
              <span>Consent for registration, clinical documentation and the hospital record has been explained and recorded.</span>
            </label>
            <div className="field">
              <label htmlFor="chiefComplaint">
                Presenting complaint <span className="optional">optional, in the patient’s words</span>
              </label>
              <textarea
                id="chiefComplaint"
                value={form.chiefComplaint}
                onChange={(event) => update('chiefComplaint', event.target.value)}
                placeholder="e.g. Fever for three days and general body weakness"
                maxLength={1000}
              />
              <p className="field-hint">
                Do not add findings, diagnoses or anything the patient did not say. Clinical notes are not captured
                in this stage.
              </p>
            </div>
          </div>

          {candidates.length > 0 && (
            <div className="duplicate-panel" ref={duplicateRef}>
              <div className="duplicate-head">
                <span className="duplicate-icon">
                  <Icon name="alert" size={17} />
                </span>
                <div>
                  <h3>{plural(candidates.length, 'possible existing record')} found.</h3>
                  <p>
                    These are deterministic name, birth-date, phone and identifier matches. They are candidates, not
                    confirmed duplicates.
                  </p>
                </div>
              </div>
              <div className="candidate-list">
                {candidates.map((candidate) => (
                  <div className="candidate" key={candidate.patient.id}>
                    <Avatar firstName={candidate.patient.firstName} lastName={candidate.patient.lastName} size="sm" />
                    <div className="candidate-main">
                      <strong>
                        {candidate.patient.firstName} {candidate.patient.lastName}
                      </strong>
                      <span>
                        {candidate.patient.hospitalNumber} · {sexLabel(candidate.patient.sex)} ·{' '}
                        {ageOf(candidate.patient)}
                      </span>
                      <div className="candidate-reasons">
                        {candidate.reasons.map((reason) => (
                          <span key={reason}>{reason}</span>
                        ))}
                      </div>
                    </div>
                    <span className="candidate-score">{Math.round(candidate.score * 100)}%</span>
                    <Link to={`/app/patients/${candidate.patient.id}`} className="btn btn--outline btn--xs">
                      Open record
                    </Link>
                  </div>
                ))}
              </div>
              <label className="checkbox duplicate-ack">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>
                  I have reviewed these records and confirmed this is a new patient. Creating a new record anyway may
                  create a duplicate.
                </span>
              </label>
            </div>
          )}

          {error && (
            <p className="inline-error" role="alert">
              <Icon name="alert" size={15} /> {error}
            </p>
          )}
          {fieldError && (
            <p className="inline-error" role="alert">
              <Icon name="alert" size={15} /> {fieldError}
            </p>
          )}

          <div className="register-submit">
            <div>
              <span className="register-submit-label">HOSPITAL NUMBER</span>
              <span className="register-submit-value">Assigned automatically on save</span>
            </div>
            <button type="submit" className="btn btn--solid" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spinner" /> Saving locally…
                </>
              ) : (
                <>
                  Register &amp; open waiting visit
                  <Icon name="arrow-right" size={16} />
                </>
              )}
            </button>
          </div>
        </form>

        <aside className="register-side">
          <div className="notice notice--warn">
            <Icon name="alert" size={16} />
            <span>
              <strong>Emergency?</strong> Follow the hospital’s emergency pathway now. Triage support is a
              suggestion for staff — it does not call for help or replace the clinician’s judgement.
            </span>
          </div>

          <div className="panel register-side-card">
            <p className="panel-kicker">THIS DEVICE</p>
            <h3>Registration status</h3>
            <dl className="side-stats">
              <div>
                <dt>Patient records</dt>
                <dd>{patients.length}</dd>
              </div>
              <div>
                <dt>Open visits</dt>
                <dd>{openVisits}</dd>
              </div>
              <div>
                <dt>Awaiting sync</dt>
                <dd>{syncBacklog}</dd>
              </div>
            </dl>
            <p className="panel-footnote">
              The record is written to this device before any network request. A failed request never discards the
              local patient.
            </p>
          </div>

          <div className="panel register-side-card">
            <p className="panel-kicker">DUPLICATE REVIEW</p>
            <h3>No silent merges.</h3>
            <p>
              Afribok scores likely matches and asks a human to look. It does not automatically merge identities, and
              an exact hospital number cannot be reassigned.
            </p>
          </div>

          <div className="register-side-note">
            <Icon name="lock" size={14} />
            <p>
              Patient data stays on this device until it syncs. Every registration and triage assessment is written
              to the clinic audit trail.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
