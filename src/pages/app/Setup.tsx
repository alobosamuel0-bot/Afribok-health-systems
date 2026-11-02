import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  Department,
  DeviceKind,
  FacilityProfile,
  HistoryFormat,
  HistoryPeriod,
  TeamMember,
} from '@shared/types'
import { ROLE_LABELS, can } from '@shared/types'
import { useAuth } from '@/auth/AuthProvider'
import { ApiError, api } from '@/lib/api'
import { Brand } from '@/components/Brand'
import { Icon } from '@/components/Icon'
import { ErrorNote, Modal } from '@/components/ui'
import { usePageTitle } from '@/hooks/usePageTitle'

const STEPS = [
  { n: 1, chip: 'Hospital', kicker: 'CARD 1 · HOSPITAL INFORMATION', title: 'Tell us about the hospital' },
  { n: 2, chip: 'Departments', kicker: 'CARD 2 · DEPARTMENT CONFIGURATION', title: 'Which departments are available?' },
  { n: 3, chip: 'Records', kicker: 'CARD 3 · EHR / EMR STATUS', title: 'Do you already use an electronic record system?' },
  { n: 4, chip: 'History', kicker: 'CARD 4 · HISTORICAL DATA', title: 'What historical data exists today?' },
  { n: 5, chip: 'Operations', kicker: 'CARD 5 · VOLUME AND OPERATIONS', title: 'How does the hospital run day to day?' },
  { n: 6, chip: 'Staff', kicker: 'CARD 6 · STAFF AND USER SETUP', title: 'Who will use Afribok?' },
  { n: 7, chip: 'Environment', kicker: 'CARD 7 · OFFLINE AND TECHNICAL', title: 'How should the workspace run here?' },
  { n: 8, chip: 'Review', kicker: 'CARD 8 · REVIEW AND CONFIRMATION', title: 'Check the answers before you begin' },
]

const FACILITY_TYPES = [
  'Primary health centre',
  'Clinic',
  'General hospital',
  'Teaching hospital',
  'Specialist hospital',
  'Private practice',
  'Other',
]

const FORMAT_OPTIONS: Array<{ value: HistoryFormat; label: string }> = [
  { value: 'paper', label: 'Paper records' },
  { value: 'ehr', label: 'Existing EHR / EMR' },
  { value: 'excel', label: 'Excel' },
  { value: 'csv', label: 'CSV' },
  { value: 'word', label: 'Word documents' },
  { value: 'other', label: 'Other digital records' },
]

const PERIOD_OPTIONS: Array<{ value: HistoryPeriod; label: string }> = [
  { value: '3_6_months', label: 'Three to six months' },
  { value: '6_12_months', label: 'Six to twelve months' },
  { value: '1_2_years', label: 'One to two years' },
  { value: '2_3_years', label: 'Two to three years' },
  { value: 'over_3_years', label: 'More than three years' },
]

const DEVICE_OPTIONS: Array<{ value: DeviceKind; label: string; hint: string }> = [
  { value: 'desktop', label: 'Desktop computers', hint: 'Reception, records office, consulting rooms' },
  { value: 'tablet', label: 'Tablets', hint: 'Bedside and ward rounds, shared at reception' },
  { value: 'smartphone', label: 'Smartphones', hint: 'Community and on-call staff' },
]

function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null
}

interface Draft {
  name: string
  facilityType: string
  location: string
  address: string
  size: string
  dailyPatients: number | null
  operatingDays: string
  operatingHours: string
  ehrStatus: FacilityProfile['ehrStatus']
  ehrName: string
  ehrVendor: string
  ehrApiAccess: FacilityProfile['ehrApiAccess']
  ehrRead: boolean
  ehrWrite: boolean
  ehrStandard: string
  ehrDocs: boolean
  ehrContact: string
  historyStatus: FacilityProfile['historyStatus']
  historyFormats: HistoryFormat[]
  historyPeriod: HistoryPeriod | null
  walkInShare: FacilityProfile['walkInShare']
  appointments: boolean
  doctors: number | null
  nurses: number | null
  hasEmergency: boolean
  hasLab: boolean
  hasPharmacy: boolean
  hasBeds: boolean
  internet: FacilityProfile['internet']
  localNetwork: boolean
  localServer: boolean
  devices: DeviceKind[]
}

function draftFrom(profile: FacilityProfile): Draft {
  return {
    name: profile.name,
    facilityType: profile.facilityType,
    location: profile.location,
    address: profile.address,
    size: profile.size,
    dailyPatients: profile.dailyPatients,
    operatingDays: profile.operatingDays,
    operatingHours: profile.operatingHours,
    ehrStatus: profile.ehrStatus,
    ehrName: profile.ehrName ?? '',
    ehrVendor: profile.ehrVendor ?? '',
    ehrApiAccess: profile.ehrApiAccess,
    ehrRead: profile.ehrRead,
    ehrWrite: profile.ehrWrite,
    ehrStandard: profile.ehrStandard ?? '',
    ehrDocs: profile.ehrDocs,
    ehrContact: profile.ehrContact ?? '',
    historyStatus: profile.historyStatus,
    historyFormats: profile.historyFormats,
    historyPeriod: profile.historyPeriod,
    walkInShare: profile.walkInShare,
    appointments: profile.appointments,
    doctors: profile.doctors,
    nurses: profile.nurses,
    hasEmergency: profile.hasEmergency,
    hasLab: profile.hasLab,
    hasPharmacy: profile.hasPharmacy,
    hasBeds: profile.hasBeds,
    internet: profile.internet,
    localNetwork: profile.localNetwork,
    localServer: profile.localServer,
    devices: profile.devices,
  }
}

function Field({
  label,
  hint,
  wide,
  children,
}: {
  label: string
  hint?: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={`setup-field ${wide ? 'setup-field--wide' : ''}`}>
      <span className="setup-field-label">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

function CheckRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="setup-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

export default function Setup() {
  usePageTitle('Hospital setup')
  const { user, signOut, refreshSession } = useAuth()
  const navigate = useNavigate()
  const canManage = can(user?.role, 'team.manage')

  const [draft, setDraft] = useState<Draft | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [complete, setComplete] = useState(false)
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [deptName, setDeptName] = useState('')
  const [deptDescription, setDeptDescription] = useState('')
  const [deptHead, setDeptHead] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Department | null>(null)
  const [assigningId, setAssigningId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const result = await api<{ profile: FacilityProfile; departments: Department[]; complete: boolean }>(
          '/api/setup',
        )
        if (cancelled) return
        setDraft(draftFrom(result.profile))
        setDepartments(result.departments)
        setComplete(result.complete)
        setStep(result.complete ? 8 : Math.min(8, Math.max(1, result.profile.step)))
        if (canManage) {
          const teamResult = await api<{ members: TeamMember[] }>('/api/team')
          if (!cancelled) setTeam(teamResult.members)
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Setup could not be loaded.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [canManage])

  const current = STEPS[step - 1]
  const done = useMemo(() => Math.round(((Math.min(step, 8) - (complete ? 0 : 1)) / 7) * 100), [step, complete])

  function update(patch: Partial<Draft>) {
    setDraft((value) => (value ? { ...value, ...patch } : value))
  }

  function toggleList<T extends string>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
  }

  async function persist(extra: Record<string, unknown> = {}) {
    if (!draft) return
    await api<{ profile: FacilityProfile }>('/api/setup', {
      method: 'PATCH',
      body: JSON.stringify({
        ...draft,
        ehrName: draft.ehrName || null,
        ehrVendor: draft.ehrVendor || null,
        ehrStandard: draft.ehrStandard || null,
        ehrContact: draft.ehrContact || null,
        ...extra,
      }),
    })
  }

  function validateStep(): string | null {
    if (!draft) return 'Setup is still loading.'
    if (step === 1) {
      if (draft.name.trim().length < 2) return 'Enter the name of the hospital or clinic.'
      if (draft.location.trim().length < 2) return 'Enter the town, city or district the hospital is in.'
    }
    if (step === 2 && departments.length === 0) {
      return 'Add at least one department. Triage, registration and staff assignment all use these departments.'
    }
    return null
  }

  async function next() {
    const problem = validateStep()
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setSaving(true)
    try {
      await persist({ step: Math.min(8, step + 1) })
      setStep((value) => Math.min(8, value + 1))
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The answer could not be saved. Check the connection.')
    } finally {
      setSaving(false)
    }
  }

  function back() {
    setError(null)
    setStep((value) => Math.max(1, value - 1))
  }

  async function addDepartment() {
    setError(null)
    if (deptName.trim().length < 2) {
      setError('Give the department a name.')
      return
    }
    setSaving(true)
    try {
      const result = await api<{ department: Department }>('/api/departments', {
        method: 'POST',
        body: JSON.stringify({
          name: deptName.trim(),
          description: deptDescription.trim(),
          headUserId: deptHead || null,
        }),
      })
      setDepartments((list) => [...list, result.department].sort((a, b) => a.name.localeCompare(b.name)))
      setDeptName('')
      setDeptDescription('')
      setDeptHead('')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The department could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDeleteDepartment() {
    if (!pendingDelete) return
    setSaving(true)
    setError(null)
    try {
      await api<void>(`/api/departments/${pendingDelete.id}`, { method: 'DELETE' })
      setDepartments((list) => list.filter((item) => item.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The department could not be removed.')
      setPendingDelete(null)
    } finally {
      setSaving(false)
    }
  }

  async function assignDepartment(member: TeamMember, departmentId: string) {
    setAssigningId(member.id)
    setError(null)
    try {
      const result = await api<{ member: TeamMember }>(`/api/team/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ departmentId: departmentId || null }),
      })
      setTeam((list) => list.map((item) => (item.id === result.member.id ? result.member : item)))
      setDepartments(await api<{ departments: Department[] }>('/api/departments').then((r) => r.departments))
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The assignment could not be saved.')
    } finally {
      setAssigningId(null)
    }
  }

  async function finish() {
    const problem = validateStep()
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await persist({ step: 8 })
      await api('/api/setup/complete', { method: 'POST' })
      await refreshSession()
      navigate('/app', { replace: true })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Setup could not be completed. Check the connection.')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="setup-shell">
        <div className="setup-loading">
          <span className="spinner" /> Opening hospital setup…
        </div>
      </div>
    )
  }

  if (!canManage || !draft) {
    return (
      <div className="setup-shell">
        <header className="setup-top">
          <Brand variant="dark" />
        </header>
        <main className="setup-main">
          <section className="setup-card setup-waiting">
            <span className="setup-waiting-icon">
              <Icon name="shield" size={22} />
            </span>
            <p className="setup-kicker">HOSPITAL SETUP</p>
            <h1>An administrator needs to finish setup.</h1>
            <p>
              This hospital's workspace has not been configured yet. An account with administrator access must answer
              the setup cards before clinical work can start here. Your account will open the workspace as soon as
              that is done.
            </p>
            <div className="setup-actions">
              <button type="button" className="btn btn--outline btn--sm" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="setup-shell">
      <header className="setup-top">
        <Brand variant="dark" />
        <div className="setup-top-meta">
          <span>{user?.name}</span>
          <button type="button" className="btn btn--outline btn--xs" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <div className="setup-progress" aria-hidden="true">
        <span style={{ width: `${complete ? 100 : Math.max(6, done)}%` }} />
      </div>

      <main className="setup-main">
        <nav className="setup-chips" aria-label="Setup steps">
          {STEPS.map((item) => (
            <button
              key={item.n}
              type="button"
              className={`setup-chip ${item.n === step ? 'is-active' : ''} ${item.n < step ? 'is-done' : ''}`}
              onClick={() => {
                if (item.n <= step || complete) setStep(item.n)
              }}
              disabled={item.n > step && !complete}
            >
              <span>{item.n < step ? <Icon name="check" size={11} /> : item.n}</span>
              {item.chip}
            </button>
          ))}
        </nav>

        <section className="setup-card" aria-labelledby="setup-title">
          <p className="setup-kicker">{current.kicker}</p>
          <h1 id="setup-title">{current.title}</h1>

          {error && (
            <div style={{ marginBottom: 16 }}>
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}

          {step === 1 && (
            <div className="setup-grid">
              <Field label="Hospital or clinic name" wide>
                <input
                  type="text"
                  value={draft.name}
                  maxLength={120}
                  onChange={(event) => update({ name: event.target.value })}
                  placeholder="e.g. Garki General Hospital"
                />
              </Field>
              <Field label="Type of facility">
                <select value={draft.facilityType} onChange={(event) => update({ facilityType: event.target.value })}>
                  <option value="">Select a type</option>
                  {FACILITY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Town, city or district" hint="Used on the workspace header and in reports.">
                <input
                  type="text"
                  value={draft.location}
                  maxLength={120}
                  onChange={(event) => update({ location: event.target.value })}
                  placeholder="e.g. Abuja, Nigeria"
                />
              </Field>
              <Field label="Street address" wide>
                <input
                  type="text"
                  value={draft.address}
                  maxLength={240}
                  onChange={(event) => update({ address: event.target.value })}
                  placeholder="e.g. 14 Ahmadu Bello Way"
                />
              </Field>
              <Field label="Approximate size" hint="Beds, consulting rooms, or a short description.">
                <input
                  type="text"
                  value={draft.size}
                  maxLength={120}
                  onChange={(event) => update({ size: event.target.value })}
                  placeholder="e.g. 40 beds, 6 consulting rooms"
                />
              </Field>
              <Field label="Patients seen on a typical day" hint="An estimate is fine. Leave blank if unknown.">
                <input
                  type="number"
                  min={0}
                  value={draft.dailyPatients ?? ''}
                  onChange={(event) => update({ dailyPatients: numberOrNull(event.target.value) })}
                  placeholder="e.g. 120"
                />
              </Field>
              <Field label="Operating days">
                <input
                  type="text"
                  value={draft.operatingDays}
                  maxLength={120}
                  onChange={(event) => update({ operatingDays: event.target.value })}
                  placeholder="e.g. Monday to Saturday"
                />
              </Field>
              <Field label="Operating hours">
                <input
                  type="text"
                  value={draft.operatingHours}
                  maxLength={120}
                  onChange={(event) => update({ operatingHours: event.target.value })}
                  placeholder="e.g. 08:00 – 18:00, emergency 24 hours"
                />
              </Field>
            </div>
          )}

          {step === 2 && (
            <>
              <p className="setup-lede">
                These departments become the department options across Afribok — registration, triage, staff
                assignment and the predictive engine. You can add, rename or remove them later.
              </p>

              {departments.length === 0 ? (
                <div className="setup-empty">
                  <Icon name="team" size={18} />
                  <p>No departments yet. Add the first one below.</p>
                </div>
              ) : (
                <ul className="setup-dept-list">
                  {departments.map((department) => (
                    <li key={department.id} className="setup-dept-row">
                      <div>
                        <strong>{department.name}</strong>
                        <small>
                          {department.staffCount} {department.staffCount === 1 ? 'staff member' : 'staff members'}
                          {department.headName ? ` · Head: ${department.headName}` : ''}
                          {department.description ? ` · ${department.description}` : ''}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="btn btn--outline btn--xs"
                        onClick={() => setPendingDelete(department)}
                        disabled={saving}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="setup-add">
                <p className="setup-subhead">Add a department</p>
                <div className="setup-grid">
                  <Field label="Department name">
                    <input
                      type="text"
                      value={deptName}
                      maxLength={80}
                      onChange={(event) => setDeptName(event.target.value)}
                      placeholder="e.g. Emergency"
                    />
                  </Field>
                  <Field label="Department head" hint="Optional. Staff must already have an account.">
                    <select value={deptHead} onChange={(event) => setDeptHead(event.target.value)}>
                      <option value="">Not assigned yet</option>
                      {team
                        .filter((member) => member.active)
                        .map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name} · {ROLE_LABELS[member.role]}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Description" wide hint="Optional — what the department handles.">
                    <input
                      type="text"
                      value={deptDescription}
                      maxLength={240}
                      onChange={(event) => setDeptDescription(event.target.value)}
                      placeholder="e.g. Walk-in emergencies and stabilisation"
                    />
                  </Field>
                </div>
                <button type="button" className="btn btn--outline btn--sm" onClick={() => void addDepartment()} disabled={saving}>
                  <Icon name="check" size={14} /> Add department
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="setup-lede">
                Afribok can connect to an existing system where that system allows it, or provide its own electronic
                patient record. Integration depends on the capabilities and permissions of the system you already use.
              </p>
              <div className="setup-options">
                {[
                  { value: 'ehr', label: 'Yes, we use an EHR' },
                  { value: 'emr', label: 'Yes, we use an EMR' },
                  { value: 'other_digital', label: 'We use another digital hospital record system' },
                  { value: 'paper', label: 'No, our records are primarily paper-based' },
                  { value: 'none', label: 'We have no digital patient-record system' },
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`setup-option ${draft.ehrStatus === option.value ? 'is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="ehr-status"
                      checked={draft.ehrStatus === option.value}
                      onChange={() => update({ ehrStatus: option.value as Draft['ehrStatus'] })}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>

              {(draft.ehrStatus === 'ehr' || draft.ehrStatus === 'emr' || draft.ehrStatus === 'other_digital') && (
                <div className="setup-grid setup-section">
                  <Field label="System name">
                    <input
                      type="text"
                      value={draft.ehrName}
                      maxLength={120}
                      onChange={(event) => update({ ehrName: event.target.value })}
                      placeholder="e.g. OpenMRS"
                    />
                  </Field>
                  <Field label="Vendor or provider">
                    <input
                      type="text"
                      value={draft.ehrVendor}
                      maxLength={120}
                      onChange={(event) => update({ ehrVendor: event.target.value })}
                      placeholder="e.g. OpenMRS community"
                    />
                  </Field>
                  <Field label="Does the vendor provide API access?">
                    <select
                      value={draft.ehrApiAccess}
                      onChange={(event) => update({ ehrApiAccess: event.target.value as Draft['ehrApiAccess'] })}
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                      <option value="unknown">Not sure</option>
                    </select>
                  </Field>
                  <Field label="Supported standard, if known">
                    <input
                      type="text"
                      value={draft.ehrStandard}
                      maxLength={120}
                      onChange={(event) => update({ ehrStandard: event.target.value })}
                      placeholder="e.g. FHIR R4, HL7 v2, vendor REST API"
                    />
                  </Field>
                  <Field label="Authorised technical contact">
                    <input
                      type="text"
                      value={draft.ehrContact}
                      maxLength={160}
                      onChange={(event) => update({ ehrContact: event.target.value })}
                      placeholder="Name, phone or email"
                    />
                  </Field>
                  <div className="setup-checklist">
                    <CheckRow
                      checked={draft.ehrRead}
                      onChange={(next) => update({ ehrRead: next })}
                      label="It can read patient records"
                      hint="Afribok may pull demographics, history and results."
                    />
                    <CheckRow
                      checked={draft.ehrWrite}
                      onChange={(next) => update({ ehrWrite: next })}
                      label="It can write or update patient records"
                      hint="Approved notes can be sent back. Nothing unreviewed is written."
                    />
                    <CheckRow
                      checked={draft.ehrDocs}
                      onChange={(next) => update({ ehrDocs: next })}
                      label="We have the technical documentation"
                    />
                  </div>
                  <div className="setup-note setup-field--wide">
                    <Icon name="info" size={15} />
                    <span>
                      The connection stays <strong>pending</strong> in EHR &amp; integration until it is configured
                      and tested with your vendor. Until then Afribok's own patient records remain the source of
                      truth.
                    </span>
                  </div>
                </div>
              )}

              {(draft.ehrStatus === 'paper' || draft.ehrStatus === 'none') && (
                <div className="setup-note">
                  <Icon name="document" size={15} />
                  <span>
                    Afribok will provide the patient record: registration, visit history, triage assessments and
                    approved clinical notes are stored here and stay linked to the patient.
                  </span>
                </div>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <p className="setup-lede">
                The predictive engine uses past activity to forecast inflow, outflow and demand. Historical records
                are never assumed to be complete just because they exist.
              </p>
              <div className="setup-options">
                {[
                  { value: 'yes', label: 'Yes, we have at least three months of data' },
                  { value: 'partial', label: 'We have some historical information, but it is incomplete' },
                  { value: 'no', label: 'No historical records available' },
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`setup-option ${draft.historyStatus === option.value ? 'is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="history-status"
                      checked={draft.historyStatus === option.value}
                      onChange={() => update({ historyStatus: option.value as Draft['historyStatus'] })}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>

              {draft.historyStatus !== 'no' && (
                <div className="setup-section">
                  <p className="setup-subhead">What format is it stored in?</p>
                  <div className="setup-checklist setup-checklist--grid">
                    {FORMAT_OPTIONS.map((option) => (
                      <CheckRow
                        key={option.value}
                        checked={draft.historyFormats.includes(option.value)}
                        onChange={() =>
                          update({ historyFormats: toggleList(draft.historyFormats, option.value) })
                        }
                        label={option.label}
                      />
                    ))}
                  </div>
                  <div className="setup-grid setup-section">
                    <Field label="Approximate period available">
                      <select
                        value={draft.historyPeriod ?? ''}
                        onChange={(event) =>
                          update({ historyPeriod: (event.target.value || null) as HistoryPeriod | null })
                        }
                      >
                        <option value="">Select a period</option>
                        {PERIOD_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="setup-note">
                    <Icon name="info" size={15} />
                    <span>
                      Paper and spreadsheet history can be loaded through the predictive engine's import tools. Until
                      enough reliable data exists, the engine labels its confidence instead of promising accuracy.
                    </span>
                  </div>
                </div>
              )}

              {draft.historyStatus === 'no' && (
                <div className="setup-note">
                  <Icon name="chart" size={15} />
                  <span>
                    Afribok will start recording activity from day one. Preliminary forecasts appear once enough
                    reliable history has built up.
                  </span>
                </div>
              )}
            </>
          )}

          {step === 5 && (
            <div className="setup-grid">
              <Field label="Are most patients walk-ins?">
                <select
                  value={draft.walkInShare}
                  onChange={(event) => update({ walkInShare: event.target.value as Draft['walkInShare'] })}
                >
                  <option value="most">Most patients are walk-ins</option>
                  <option value="some">A mix of walk-ins and appointments</option>
                  <option value="few">Mostly booked appointments</option>
                </select>
              </Field>
              <Field label="Doctors available" hint="Approximate is fine.">
                <input
                  type="number"
                  min={0}
                  value={draft.doctors ?? ''}
                  onChange={(event) => update({ doctors: numberOrNull(event.target.value) })}
                  placeholder="e.g. 8"
                />
              </Field>
              <Field label="Nurses available" hint="Approximate is fine.">
                <input
                  type="number"
                  min={0}
                  value={draft.nurses ?? ''}
                  onChange={(event) => update({ nurses: numberOrNull(event.target.value) })}
                  placeholder="e.g. 21"
                />
              </Field>
              <div className="setup-checklist setup-field--wide">
                <CheckRow
                  checked={draft.appointments}
                  onChange={(next) => update({ appointments: next })}
                  label="The hospital runs an appointment system"
                />
                <CheckRow
                  checked={draft.hasEmergency}
                  onChange={(next) => update({ hasEmergency: next })}
                  label="There is an emergency department"
                />
                <CheckRow
                  checked={draft.hasLab}
                  onChange={(next) => update({ hasLab: next })}
                  label="There is a laboratory"
                />
                <CheckRow
                  checked={draft.hasPharmacy}
                  onChange={(next) => update({ hasPharmacy: next })}
                  label="There is a pharmacy"
                />
                <CheckRow
                  checked={draft.hasBeds}
                  onChange={(next) => update({ hasBeds: next })}
                  label="There are inpatient beds"
                />
              </div>
            </div>
          )}

          {step === 6 && (
            <>
              <p className="setup-lede">
                Every staff member should have their own account — no shared logins. New staff can create an account
                from the sign-in page; an administrator then sets the role and department here or in Team &amp; roles.
              </p>
              {team.length === 0 ? (
                <div className="setup-empty">
                  <Icon name="team" size={18} />
                  <p>No staff accounts yet.</p>
                </div>
              ) : (
                <ul className="setup-dept-list">
                  {team.map((member) => (
                    <li key={member.id} className="setup-dept-row setup-staff-row">
                      <div>
                        <strong>
                          {member.name}
                          {!member.active && <span className="tag tag--pending" style={{ marginLeft: 8 }}>deactivated</span>}
                        </strong>
                        <small>
                          {member.email} · {ROLE_LABELS[member.role]}
                        </small>
                      </div>
                      <select
                        value={member.departmentId ?? ''}
                        onChange={(event) => void assignDepartment(member, event.target.value)}
                        disabled={!member.active || assigningId === member.id || member.id === user?.id}
                        aria-label={`Department for ${member.name}`}
                      >
                        <option value="">No department</option>
                        {departments.map((department) => (
                          <option key={department.id} value={department.id}>
                            {department.name}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              )}
              <div className="setup-note">
                <Icon name="shield" size={15} />
                <span>
                  Roles are enforced on the server: a registration officer cannot update clinical records, and an
                  auditor can only read. Administrator access is granted by an existing administrator.
                </span>
              </div>
            </>
          )}

          {step === 7 && (
            <>
              <p className="setup-lede">
                These answers decide how this hospital is deployed. Afribok always keeps working offline on the device;
                the answers below decide whether a local server is part of the plan.
              </p>
              <div className="setup-options">
                {[
                  { value: 'reliable', label: 'Reliable internet most of the day' },
                  { value: 'unstable', label: 'Internet is available but drops frequently' },
                  { value: 'none', label: 'No dependable internet connection' },
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`setup-option ${draft.internet === option.value ? 'is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="internet"
                      checked={draft.internet === option.value}
                      onChange={() => update({ internet: option.value as Draft['internet'] })}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>

              <div className="setup-section">
                <p className="setup-subhead">Devices staff will use</p>
                <div className="setup-checklist setup-checklist--grid">
                  {DEVICE_OPTIONS.map((option) => (
                    <CheckRow
                      key={option.value}
                      checked={draft.devices.includes(option.value)}
                      onChange={() => update({ devices: toggleList(draft.devices, option.value) })}
                      label={option.label}
                      hint={option.hint}
                    />
                  ))}
                </div>
              </div>

              <div className="setup-checklist setup-section">
                <CheckRow
                  checked={draft.localNetwork}
                  onChange={(next) => update({ localNetwork: next })}
                  label="The hospital has an internal local network"
                />
                <CheckRow
                  checked={draft.localServer}
                  onChange={(next) => update({ localServer: next })}
                  label="There is a local server or clinic computer that can hold the shared database"
                  hint="Lets several devices share records without internet."
                />
              </div>

              <div className="setup-note">
                <Icon name="wifi-off" size={15} />
                <span>
                  {draft.internet === 'reliable'
                    ? 'Records sync as soon as they are saved, and the device keeps a working copy in case the connection drops.'
                    : 'Records are saved on each device first and sync when a connection returns — nothing waits on the network to be usable.'}
                </span>
              </div>
            </>
          )}

          {step === 8 && (
            <>
              <p className="setup-lede">
                Review the answers. Everything here can be edited later by an administrator in Hospital setup.
              </p>
              <dl className="setup-review">
                <div>
                  <dt>Hospital</dt>
                  <dd>
                    {draft.name || '—'}
                    {draft.facilityType ? ` · ${draft.facilityType}` : ''}
                    <small>{draft.location || 'Location not set'}</small>
                    {draft.address && <small>{draft.address}</small>}
                  </dd>
                </div>
                <div>
                  <dt>Departments</dt>
                  <dd>
                    {departments.length === 0
                      ? 'None configured'
                      : departments.map((department) => department.name).join(', ')}
                  </dd>
                </div>
                <div>
                  <dt>Electronic records</dt>
                  <dd>
                    {draft.ehrStatus === 'none'
                      ? 'Afribok will provide the patient record'
                      : draft.ehrStatus === 'paper'
                        ? 'Paper-based; Afribok will provide the patient record'
                        : `${draft.ehrName || 'Existing system'}${draft.ehrApiAccess === 'yes' ? ' · API access reported' : ' · API access not confirmed'}`}
                    {draft.ehrStatus !== 'none' && draft.ehrStatus !== 'paper' && (
                      <small>
                        {draft.ehrRead ? 'Read' : 'No read'} · {draft.ehrWrite ? 'Write' : 'No write'}
                      </small>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Historical data</dt>
                  <dd>
                    {draft.historyStatus === 'no'
                      ? 'None — builds history from day one'
                      : `${draft.historyStatus === 'partial' ? 'Incomplete' : 'Available'}${
                          draft.historyFormats.length > 0
                            ? ` · ${draft.historyFormats
                                .map((format) => FORMAT_OPTIONS.find((option) => option.value === format)?.label ?? format)
                                .join(', ')}`
                            : ''
                        }`}
                    {draft.historyPeriod && (
                      <small>{PERIOD_OPTIONS.find((option) => option.value === draft.historyPeriod)?.label}</small>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Operations</dt>
                  <dd>
                    {draft.dailyPatients !== null ? `About ${draft.dailyPatients} patients a day` : 'Daily volume not given'}
                    <small>
                      {draft.doctors !== null ? `${draft.doctors} doctors` : 'Doctors not given'} ·{' '}
                      {draft.nurses !== null ? `${draft.nurses} nurses` : 'Nurses not given'}
                    </small>
                    <small>
                      {[
                        draft.hasEmergency ? 'Emergency' : null,
                        draft.hasLab ? 'Laboratory' : null,
                        draft.hasPharmacy ? 'Pharmacy' : null,
                        draft.hasBeds ? 'Inpatient beds' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'No additional services marked'}
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Staff accounts</dt>
                  <dd>
                    {team.filter((member) => member.active).length} active
                    <small>
                      {team.filter((member) => member.departmentId).length} assigned to a department
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Environment</dt>
                  <dd>
                    {draft.internet === 'reliable'
                      ? 'Reliable internet'
                      : draft.internet === 'unstable'
                        ? 'Intermittent internet'
                        : 'Offline-first deployment'}
                    <small>
                      {draft.devices.length > 0
                        ? draft.devices
                            .map((device) => DEVICE_OPTIONS.find((option) => option.value === device)?.label ?? device)
                            .join(', ')
                        : 'No devices selected'}
                      {draft.localServer ? ' · local server' : ''}
                    </small>
                  </dd>
                </div>
              </dl>

              <div className="setup-note">
                <Icon name="check" size={15} />
                <span>
                  Finishing creates the hospital workspace from these answers, applies the department list and opens
                  the dashboard. Only an administrator can change them afterwards.
                </span>
              </div>
            </>
          )}

          <div className="setup-actions">
            {step > 1 && (
              <button type="button" className="btn btn--outline btn--sm" onClick={back} disabled={saving}>
                <Icon name="arrow-left" size={14} /> Back
              </button>
            )}
            <span className="setup-step-count">
              Step {step} of 8
              {complete ? ' · already completed' : ''}
            </span>
            {step < 8 ? (
              <button type="button" className="btn btn--solid btn--sm" onClick={() => void next()} disabled={saving}>
                {saving ? <span className="spinner" /> : null}
                Save and continue <Icon name="arrow-right" size={14} />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--solid btn--sm"
                onClick={() => void finish()}
                disabled={saving}
              >
                {saving ? <span className="spinner" /> : <Icon name="check" size={14} />}
                {complete ? 'Re-save and open dashboard' : 'Finish setup and open dashboard'}
              </button>
            )}
          </div>
        </section>

        <p className="setup-foot">
          Answers are stored on this hospital's server and used to configure the workspace. Only administrators can
          change them.
        </p>
      </main>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={`Remove ${pendingDelete?.name ?? 'this department'}?`}
        footer={
          <>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setPendingDelete(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={() => void confirmDeleteDepartment()}
              disabled={saving}
            >
              Remove department
            </button>
          </>
        }
      >
        <p className="modal-copy">
          Departments with active staff assigned cannot be removed. Move those staff to another department first.
        </p>
      </Modal>
    </div>
  )
}
