import type { z } from 'zod'
import type { AfribokDb } from './db'
import { recordAudit } from './audit'
import { findCandidates } from '../shared/match'
import type { Capacity, ClinicalNote, TriageAssessment } from '../shared/clinical'
import { can, canSeeAllDepartments } from '../shared/types'
import type {
  AuditEvent,
  DuplicateCandidate,
  Encounter,
  EncounterStatus,
  Patient,
  PerformanceReport,
  Role,
  SessionUser,
  SyncOperationInput,
  SyncResult,
  TeamMember,
} from '../shared/types'
import type {
  createEncounterPayloadSchema,
  registerPatientPayloadSchema,
  updateEncounterPayloadSchema,
} from './validation'

interface PatientRow {
  id: string
  facility_id: string
  hospital_number: string
  first_name: string
  last_name: string
  other_names: string | null
  sex: Patient['sex']
  date_of_birth: string | null
  phone: string | null
  address: string | null
  identifier_type: string | null
  identifier_value: string | null
  allergies: string | null
  medical_history: string | null
  current_medications: string | null
  version: number
  synthetic: number
  created_by: string | null
  created_at: string
  updated_at: string
}

interface EncounterRow {
  id: string
  facility_id: string
  patient_id: string
  department_id: string | null
  department_name?: string | null
  assigned_clinician_id: string | null
  assigned_clinician_name?: string | null
  arrived_at: string
  chief_complaint: string
  status: EncounterStatus
  consent_recorded: number
  version: number
  synthetic: number
  created_by: string | null
  created_at: string
  updated_at: string
  triage_json?: string | null
  triage_level?: number | null
  triage_at?: string | null
  note_json?: string | null
  note_at?: string | null
  note_approved_at?: string | null
  note_approved_by?: string | null
}

interface SyncRow {
  op_id: string
  status: 'applied' | 'conflict' | 'rejected'
  message: string | null
  result: string | null
}

export class ServiceError extends Error {
  status: number
  code: string
  candidates?: DuplicateCandidate[]

  constructor(message: string, status = 400, code = 'BAD_REQUEST', candidates?: DuplicateCandidate[]) {
    super(message)
    this.status = status
    this.code = code
    this.candidates = candidates
  }
}

export function mapPatient(row: PatientRow): Patient {
  return {
    id: row.id,
    hospitalNumber: row.hospital_number,
    firstName: row.first_name,
    lastName: row.last_name,
    otherNames: row.other_names,
    sex: row.sex,
    dateOfBirth: row.date_of_birth,
    phone: row.phone,
    address: row.address,
    identifierType: row.identifier_type,
    identifierValue: row.identifier_value,
    allergies: row.allergies,
    medicalHistory: row.medical_history,
    currentMedications: row.current_medications,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    synthetic: row.synthetic === 1,
  }
}

export function mapEncounter(row: EncounterRow): Encounter {
  return {
    id: row.id,
    patientId: row.patient_id,
    departmentId: row.department_id,
    departmentName: row.department_name ?? null,
    assignedClinicianId: row.assigned_clinician_id,
    assignedClinicianName: row.assigned_clinician_name ?? null,
    arrivedAt: row.arrived_at,
    chiefComplaint: row.chief_complaint,
    status: row.status,
    consentRecorded: row.consent_recorded === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    synthetic: row.synthetic === 1,
    triage: parseJson<TriageAssessment>(row.triage_json),
    note: parseJson<ClinicalNote>(row.note_json),
    noteApprovedAt: row.note_approved_at ?? null,
    noteApprovedBy: row.note_approved_by ?? null,
  }
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export function listPatients(db: AfribokDb, facilityId: string): Patient[] {
  const rows = db
    .prepare('SELECT * FROM patients WHERE facility_id = ? ORDER BY last_name, first_name')
    .all(facilityId) as PatientRow[]
  return rows.map(mapPatient)
}

export function listEncounters(
  db: AfribokDb,
  facilityId: string,
  limit = 400,
  departmentId?: string | null,
): Encounter[] {
  const rows = db
    .prepare(
      `SELECT e.*, d.name AS department_name, c.name AS assigned_clinician_name
       FROM encounters e
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN users c ON c.id = e.assigned_clinician_id
       WHERE e.facility_id = ?${departmentId ? ' AND e.department_id = ?' : ''}
       ORDER BY e.arrived_at DESC LIMIT ?`,
    )
    .all(...(departmentId ? [facilityId, departmentId, limit] : [facilityId, limit])) as EncounterRow[]
  return rows.map(mapEncounter)
}

/** The department boundary applied to a signed-in user's clinical data. */
export function scopeDepartmentId(user: SessionUser): string | null {
  if (canSeeAllDepartments(user.role)) return null
  return user.departmentId
}

export function canAccessEncounter(user: SessionUser, encounter: Encounter): boolean {
  if (canSeeAllDepartments(user.role)) return true
  if (!user.departmentId) return false
  return encounter.departmentId === user.departmentId
}

export function listScopedEncounters(db: AfribokDb, user: SessionUser, limit = 400): Encounter[] {
  return listEncounters(db, user.facilityId, limit, scopeDepartmentId(user))
}

export function listScopedPatients(db: AfribokDb, user: SessionUser): Patient[] {
  const scope = scopeDepartmentId(user)
  if (scope === null) return listPatients(db, user.facilityId)
  if (!scope) return []
  const rows = db
    .prepare(
      `SELECT p.* FROM patients p
       WHERE p.facility_id = ? AND EXISTS (
         SELECT 1 FROM encounters e WHERE e.patient_id = p.id AND e.department_id = ?
       )
       ORDER BY p.last_name, p.first_name`,
    )
    .all(user.facilityId, scope) as PatientRow[]
  return rows.map(mapPatient)
}

export function canAccessPatient(db: AfribokDb, user: SessionUser, patientId: string): boolean {
  const scope = scopeDepartmentId(user)
  if (scope === null) return true
  if (!scope) return false
  return Boolean(
    db
      .prepare(
        'SELECT 1 FROM encounters WHERE facility_id = ? AND patient_id = ? AND department_id = ? LIMIT 1',
      )
      .get(user.facilityId, patientId, scope),
  )
}

export function getPatient(db: AfribokDb, facilityId: string, id: string): Patient | null {
  const row = db
    .prepare('SELECT * FROM patients WHERE facility_id = ? AND id = ?')
    .get(facilityId, id) as PatientRow | undefined
  return row ? mapPatient(row) : null
}

export function getEncounter(db: AfribokDb, facilityId: string, id: string): Encounter | null {
  const row = db
    .prepare(
      `SELECT e.*, d.name AS department_name, c.name AS assigned_clinician_name
       FROM encounters e
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN users c ON c.id = e.assigned_clinician_id
       WHERE e.facility_id = ? AND e.id = ?`,
    )
    .get(facilityId, id) as EncounterRow | undefined
  return row ? mapEncounter(row) : null
}

function safeTime(value: string | undefined, now: string): string {
  if (!value) return now
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return now
  // Preserve an offline device's event time, but refuse absurd future dates.
  return parsed > Date.parse(now) + 5 * 60 * 1000 ? now : new Date(parsed).toISOString()
}

/**
 * Resolve the department a visit belongs to. The requested department must
 * belong to this facility; otherwise the staff member's own department is used,
 * then the facility's first configured department. Null is allowed only when
 * the hospital has not configured any departments yet.
 */
function resolveDepartmentId(
  db: AfribokDb,
  facilityId: string,
  requested: string | null | undefined,
): string | null {
  if (requested) {
    const found = db
      .prepare('SELECT id FROM departments WHERE id = ? AND facility_id = ?')
      .get(requested, facilityId)
    if (!found) throw new ServiceError('That department is not part of this facility.', 400, 'BAD_DEPARTMENT')
    return requested
  }
  const first = db
    .prepare('SELECT id FROM departments WHERE facility_id = ? ORDER BY name LIMIT 1')
    .get(facilityId) as { id: string } | undefined
  return first?.id ?? null
}

export function findPatientCandidates(
  db: AfribokDb,
  facilityId: string,
  input: {
    firstName: string
    lastName: string
    otherNames?: string | null
    sex: Patient['sex']
    dateOfBirth?: string | null
    phone?: string | null
    identifierValue?: string | null
    hospitalNumber?: string
  },
  excludeId?: string,
): DuplicateCandidate[] {
  const patients = listPatients(db, facilityId).filter((patient) => patient.id !== excludeId)
  return findCandidates(input, patients)
}

type RegisterPayload = z.infer<typeof registerPatientPayloadSchema>
type CreateEncounterPayload = z.infer<typeof createEncounterPayloadSchema>
type UpdateEncounterPayload = z.infer<typeof updateEncounterPayloadSchema>

interface RegistrationOutcome {
  patient: Patient
  encounter: Encounter
}

export function registerPatient(
  db: AfribokDb,
  actor: SessionUser,
  payload: RegisterPayload,
): RegistrationOutcome {
  const now = new Date().toISOString()
  const input = payload.patient
  const candidates = findPatientCandidates(db, actor.facilityId, {
    firstName: input.firstName,
    lastName: input.lastName,
    otherNames: input.otherNames,
    sex: input.sex,
    dateOfBirth: input.dateOfBirth,
    phone: input.phone,
    identifierValue: input.identifierValue,
    hospitalNumber: input.hospitalNumber,
  })

  const strong = candidates.filter((candidate) => candidate.score >= 0.8)
  if (strong.length > 0 && !payload.duplicateAcknowledged) {
    throw new ServiceError(
      'Possible existing record found. Review the candidates before creating a new patient.',
      409,
      'DUPLICATE_CANDIDATES',
      candidates,
    )
  }

  const hospitalNumberExists = db
    .prepare('SELECT 1 FROM patients WHERE facility_id = ? AND hospital_number = ?')
    .get(actor.facilityId, input.hospitalNumber)
  if (hospitalNumberExists) {
    throw new ServiceError(
      'That hospital number is already in use. Choose a different number.',
      409,
      'HOSPITAL_NUMBER_IN_USE',
      candidates,
    )
  }

  const idExists = db.prepare('SELECT 1 FROM patients WHERE id = ?').get(input.id)
  if (idExists) {
    throw new ServiceError('This patient ID already exists.', 409, 'PATIENT_EXISTS', candidates)
  }

  const created = safeTime(input.createdAt, now)
  const encounterCreated = safeTime(payload.encounter.createdAt, now)
  const arrived = safeTime(payload.encounter.arrivedAt, now)

  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO patients
        (id, facility_id, hospital_number, first_name, last_name, other_names, sex, date_of_birth,
         phone, address, identifier_type, identifier_value, allergies, medical_history, current_medications,
         version, synthetic, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
    ).run(
      input.id,
      actor.facilityId,
      input.hospitalNumber,
      input.firstName,
      input.lastName,
      input.otherNames ?? null,
      input.sex,
      input.dateOfBirth ?? null,
      input.phone ?? null,
      input.address ?? null,
      input.identifierType ?? null,
      input.identifierValue ?? null,
      input.allergies ?? null,
      input.medicalHistory ?? null,
      input.currentMedications ?? null,
      actor.id,
      created,
      created,
    )

    db.prepare(
      `INSERT INTO encounters
        (id, facility_id, patient_id, department_id, arrived_at, chief_complaint, status, consent_recorded,
         consent_at, version, synthetic, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?, 1, 0, ?, ?, ?)`,
    ).run(
      payload.encounter.id,
      actor.facilityId,
      input.id,
      resolveDepartmentId(db, actor.facilityId, payload.encounter.departmentId ?? actor.departmentId),
      arrived,
      payload.encounter.chiefComplaint,
      payload.encounter.consentRecorded ? 1 : 0,
      payload.encounter.consentRecorded ? encounterCreated : null,
      actor.id,
      encounterCreated,
      encounterCreated,
    )

    recordAudit(db, {
      facilityId: actor.facilityId,
      actorId: actor.id,
      actorName: actor.name,
      action: 'patient.created',
      entityType: 'patient',
      entityId: input.id,
      detail: {
        duplicateCandidatesReviewed: candidates.length,
        duplicateAcknowledged: payload.duplicateAcknowledged,
      },
      source: 'sync',
      eventTime: created,
    })
    recordAudit(db, {
      facilityId: actor.facilityId,
      actorId: actor.id,
      actorName: actor.name,
      action: 'encounter.created',
      entityType: 'encounter',
      entityId: payload.encounter.id,
      detail: { status: 'waiting' },
      source: 'sync',
      eventTime: encounterCreated,
    })
  })
  transaction()

  const patient = getPatient(db, actor.facilityId, input.id)
  const encounter = getEncounter(db, actor.facilityId, payload.encounter.id)
  if (!patient || !encounter) throw new ServiceError('Registration could not be completed.', 500)
  return { patient, encounter }
}

export function createEncounter(
  db: AfribokDb,
  actor: SessionUser,
  payload: CreateEncounterPayload,
): Encounter {
  const patient = getPatient(db, actor.facilityId, payload.patientId)
  if (!patient) throw new ServiceError('Patient not found.', 404, 'PATIENT_NOT_FOUND')
  if (db.prepare('SELECT 1 FROM encounters WHERE id = ?').get(payload.id)) {
    throw new ServiceError('This encounter already exists.', 409, 'ENCOUNTER_EXISTS')
  }
  const now = new Date().toISOString()
  const created = safeTime(payload.createdAt, now)
  const arrived = safeTime(payload.arrivedAt, now)

  db.transaction(() => {
    db.prepare(
      `INSERT INTO encounters
        (id, facility_id, patient_id, department_id, arrived_at, chief_complaint, status, consent_recorded,
         consent_at, version, synthetic, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?, 1, 0, ?, ?, ?)`,
    ).run(
      payload.id,
      actor.facilityId,
      payload.patientId,
      resolveDepartmentId(db, actor.facilityId, payload.departmentId ?? actor.departmentId),
      arrived,
      payload.chiefComplaint,
      payload.consentRecorded ? 1 : 0,
      payload.consentRecorded ? created : null,
      actor.id,
      created,
      created,
    )
    recordAudit(db, {
      facilityId: actor.facilityId,
      actorId: actor.id,
      actorName: actor.name,
      action: 'encounter.created',
      entityType: 'encounter',
      entityId: payload.id,
      detail: { status: 'waiting', returningPatient: true },
      source: 'sync',
      eventTime: created,
    })
  })()

  const encounter = getEncounter(db, actor.facilityId, payload.id)
  if (!encounter) throw new ServiceError('Encounter could not be created.', 500)
  return encounter
}

const STATUS_TRANSITIONS: Record<EncounterStatus, EncounterStatus[]> = {
  waiting: ['in_consultation', 'completed'],
  in_consultation: ['completed'],
  completed: [],
}

export interface EncounterUpdateOutcome {
  outcome: 'applied' | 'conflict'
  encounter?: Encounter
  serverEncounter?: Encounter
  message?: string
}

export function updateEncounter(
  db: AfribokDb,
  actor: SessionUser,
  payload: UpdateEncounterPayload,
): EncounterUpdateOutcome {
  const current = getEncounter(db, actor.facilityId, payload.encounterId)
  if (!current) {
    throw new ServiceError('Encounter not found.', 404, 'ENCOUNTER_NOT_FOUND')
  }
  if (!canAccessEncounter(actor, current)) {
    throw new ServiceError('This visit belongs to another department.', 403, 'DEPARTMENT_SCOPE')
  }
  if (current.version !== payload.baseVersion) {
    return {
      outcome: 'conflict',
      serverEncounter: current,
      message: 'This visit was changed on another session. Review both versions before continuing.',
    }
  }
  if (payload.status && payload.status !== current.status) {
    if (!STATUS_TRANSITIONS[current.status].includes(payload.status)) {
      throw new ServiceError(
        `A ${current.status.replace('_', ' ')} visit cannot move to ${payload.status.replace('_', ' ')}.`,
        409,
        'INVALID_STATUS_TRANSITION',
      )
    }
  }

  const now = new Date().toISOString()
  const fields: string[] = []
  const nextComplaint =
    payload.chiefComplaint !== undefined ? payload.chiefComplaint : current.chiefComplaint
  const nextStatus = payload.status ?? current.status
  const nextDepartment =
    payload.departmentId !== undefined
      ? resolveDepartmentId(db, actor.facilityId, payload.departmentId)
      : current.departmentId
  const nextAssignee =
    payload.assignedClinicianId !== undefined ? payload.assignedClinicianId : current.assignedClinicianId
  if (nextAssignee) {
    const assignee = db
      .prepare("SELECT id FROM users WHERE id = ? AND facility_id = ? AND active = 1 AND role IN ('clinician','nurse')")
      .get(nextAssignee, actor.facilityId)
    if (!assignee) throw new ServiceError('Choose an active clinician or nurse in this facility.', 400, 'BAD_ASSIGNEE')
  }
  if (payload.chiefComplaint !== undefined && payload.chiefComplaint !== current.chiefComplaint) {
    fields.push('chiefComplaint')
  }
  if (payload.status !== undefined && payload.status !== current.status) fields.push('status')
  if (payload.departmentId !== undefined && nextDepartment !== current.departmentId) fields.push('department')
  if (payload.assignedClinicianId !== undefined && nextAssignee !== current.assignedClinicianId) fields.push('assignee')

  db.transaction(() => {
    db.prepare(
      `UPDATE encounters
       SET chief_complaint = ?, status = ?, department_id = ?, assigned_clinician_id = ?,
           consult_started_at = CASE WHEN ? = 'in_consultation' AND consult_started_at IS NULL THEN ?
                                     ELSE consult_started_at END,
           version = version + 1, updated_at = ?
       WHERE id = ? AND facility_id = ? AND version = ?`,
    ).run(
      nextComplaint,
      nextStatus,
      nextDepartment,
      nextAssignee,
      nextStatus,
      now,
      now,
      payload.encounterId,
      actor.facilityId,
      current.version,
    )
    recordAudit(db, {
      facilityId: actor.facilityId,
      actorId: actor.id,
      actorName: actor.name,
      action: 'encounter.updated',
      entityType: 'encounter',
      entityId: payload.encounterId,
      detail: {
        fields,
        fromStatus: current.status,
        toStatus: nextStatus,
        ...(nextDepartment !== current.departmentId ? { departmentId: nextDepartment } : {}),
        ...(nextAssignee !== current.assignedClinicianId ? { assignedClinicianId: nextAssignee } : {}),
      },
      source: 'sync',
      eventTime: now,
    })
  })()

  const updated = getEncounter(db, actor.facilityId, payload.encounterId)
  if (!updated) throw new ServiceError('Encounter update failed.', 500)
  return { outcome: 'applied', encounter: updated }
}

function rejected(opId: string, message: string, candidates?: DuplicateCandidate[]): SyncResult {
  return { id: opId, status: 'rejected', message, ...(candidates ? { candidates } : {}) }
}

function applyOne(db: AfribokDb, actor: SessionUser, op: SyncOperationInput): SyncResult {
  const existing = db
    .prepare('SELECT op_id, status, message, result FROM sync_operations WHERE op_id = ?')
    .get(op.id) as SyncRow | undefined
  if (existing) {
    const previous = existing.result
      ? (JSON.parse(existing.result) as SyncResult)
      : ({ id: op.id, status: existing.status, message: existing.message ?? undefined } as SyncResult)
    return previous.status === 'applied' ? { ...previous, status: 'duplicate' } : previous
  }

  const requiredPermission =
    op.type === 'register_patient'
      ? 'patient.create'
      : op.type === 'create_encounter'
        ? 'encounter.create'
        : 'encounter.update'
  let outcome: SyncResult
  try {
    if (!can(actor.role, requiredPermission)) {
      outcome = rejected(op.id, 'Your role does not allow this operation.')
    } else if (op.type === 'register_patient') {
      const payload = op.payload as RegisterPayload
      const registration = registerPatient(db, actor, payload)
      outcome = {
        id: op.id,
        status: 'applied',
        patient: registration.patient,
        encounter: registration.encounter,
      }
    } else if (op.type === 'create_encounter') {
      const encounter = createEncounter(db, actor, op.payload as CreateEncounterPayload)
      outcome = {
        id: op.id,
        status: 'applied',
        encounter,
        patient: getPatient(db, actor.facilityId, encounter.patientId) ?? undefined,
      }
    } else {
      const update = updateEncounter(db, actor, op.payload as UpdateEncounterPayload)
      if (update.outcome === 'conflict') {
        outcome = {
          id: op.id,
          status: 'conflict',
          message: update.message,
          serverEncounter: update.serverEncounter,
        }
        recordAudit(db, {
          facilityId: actor.facilityId,
          actorId: actor.id,
          actorName: actor.name,
          action: 'sync.conflict',
          entityType: 'sync_operation',
          entityId: op.id,
          detail: { operationType: op.type },
          source: 'sync',
          eventTime: op.clientTime,
        })
      } else {
        outcome = { id: op.id, status: 'applied', encounter: update.encounter }
      }
    }
  } catch (error) {
    if (error instanceof ServiceError) {
      outcome = {
        id: op.id,
        status: error.code === 'DUPLICATE_CANDIDATES' || error.code === 'HOSPITAL_NUMBER_IN_USE'
          ? 'conflict'
          : 'rejected',
        message: error.message,
        ...(error.candidates ? { candidates: error.candidates } : {}),
      }
      recordAudit(db, {
        facilityId: actor.facilityId,
        actorId: actor.id,
        actorName: actor.name,
        action: outcome.status === 'conflict' ? 'sync.conflict' : 'sync.rejected',
        entityType: 'sync_operation',
        entityId: op.id,
        detail: { operationType: op.type, code: error.code },
        source: 'sync',
        eventTime: op.clientTime,
      })
    } else {
      throw error
    }
  }

  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO sync_operations
      (op_id, facility_id, user_id, type, payload, status, message, result, created_at, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    op.id,
    actor.facilityId,
    actor.id,
    op.type,
    JSON.stringify(op.payload),
    outcome.status === 'duplicate' ? 'applied' : outcome.status,
    outcome.message ?? null,
    JSON.stringify(outcome),
    op.clientTime,
    now,
  )

  if (outcome.status === 'applied' || outcome.status === 'duplicate') {
    recordAudit(db, {
      facilityId: actor.facilityId,
      actorId: actor.id,
      actorName: actor.name,
      action: 'sync.operation_applied',
      entityType: 'sync_operation',
      entityId: op.id,
      detail: { operationType: op.type },
      source: 'sync',
      eventTime: op.clientTime,
    })
  }
  return outcome
}

export function applySyncOperations(
  db: AfribokDb,
  actor: SessionUser,
  operations: SyncOperationInput[],
): SyncResult[] {
  const results: SyncResult[] = []
  for (const op of operations) {
    const run = db.transaction(() => applyOne(db, actor, op))
    results.push(run())
  }
  return results
}

export function listAuditEvents(db: AfribokDb, facilityId: string, limit: number): AuditEvent[] {
  const rows = db
    .prepare(
      'SELECT * FROM audit_events WHERE facility_id = ? ORDER BY recorded_at DESC, rowid DESC LIMIT ?',
    )
    .all(facilityId, limit) as Array<{
    id: string
    actor_id: string | null
    actor_name: string
    action: string
    entity_type: string
    entity_id: string | null
    detail: string | null
    source: 'server' | 'sync'
    event_time: string
    recorded_at: string
  }>
  return rows.map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    detail: row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : null,
    source: row.source,
    eventTime: row.event_time,
    recordedAt: row.recorded_at,
  }))
}

export function listTeam(db: AfribokDb, facilityId: string): TeamMember[] {
  const rows = db
    .prepare(
      `SELECT u.*, d.name AS department_name, (d.head_user_id = u.id) AS is_head
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.facility_id = ? ORDER BY u.name`,
    )
    .all(facilityId) as Array<{
    id: string
    name: string
    email: string
    role: Role
    active: number
    staff_number: string | null
    phone: string | null
    department_id: string | null
    department_name: string | null
    is_head: number
    created_at: string
    last_sign_in_at: string | null
  }>
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    staffNumber: row.staff_number,
    phone: row.phone,
    departmentId: row.department_id,
    departmentName: row.department_name,
    isDepartmentHead: row.is_head === 1,
    active: row.active === 1,
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at,
  }))
}

export function updateTeamMember(
  db: AfribokDb,
  actor: SessionUser,
  userId: string,
  patch: { role?: string; active?: boolean; departmentId?: string | null },
): TeamMember {
  if (userId === actor.id) {
    throw new ServiceError('You cannot change your own role or access.', 409, 'SELF_CHANGE')
  }
  const target = db
    .prepare('SELECT * FROM users WHERE id = ? AND facility_id = ?')
    .get(userId, actor.facilityId) as
    | { id: string; name: string; role: Role; active: number }
    | undefined
  if (!target) throw new ServiceError('Team member not found.', 404, 'USER_NOT_FOUND')

  const nextRole = (patch.role ?? target.role) as Role
  const nextActive = patch.active ?? target.active === 1
  if (patch.departmentId) {
    const department = db
      .prepare('SELECT 1 FROM departments WHERE id = ? AND facility_id = ?')
      .get(patch.departmentId, actor.facilityId)
    if (!department) throw new ServiceError('That department is not part of this facility.', 400, 'BAD_DEPARTMENT')
  }
  if (target.role === 'admin' && (nextRole !== 'admin' || !nextActive)) {
    const admins = db
      .prepare("SELECT COUNT(*) AS count FROM users WHERE facility_id = ? AND role = 'admin' AND active = 1")
      .get(actor.facilityId) as { count: number }
    if (admins.count <= 1) {
      throw new ServiceError('The facility must keep at least one active administrator.', 409, 'LAST_ADMIN')
    }
  }

  db.transaction(() => {
    db.prepare(
      'UPDATE users SET role = ?, active = ?, department_id = ? WHERE id = ? AND facility_id = ?',
    ).run(
      nextRole,
      nextActive ? 1 : 0,
      patch.departmentId === undefined ? (target as { department_id?: string | null }).department_id ?? null : patch.departmentId,
      userId,
      actor.facilityId,
    )
    if (!nextActive) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
    recordAudit(db, {
      facilityId: actor.facilityId,
      actorId: actor.id,
      actorName: actor.name,
      action: 'team.member_updated',
      entityType: 'user',
      entityId: userId,
      detail: {
        fromRole: target.role,
        toRole: nextRole,
        fromActive: target.active === 1,
        toActive: nextActive,
        ...(patch.departmentId !== undefined ? { departmentId: patch.departmentId } : {}),
      },
    })
  })()

  const member = listTeam(db, actor.facilityId).find((candidate) => candidate.id === userId)
  if (!member) throw new ServiceError('Team member not found.', 404)
  return member
}


/** Persist an AI triage assessment on an encounter and record who ran it. */
export function saveTriage(
  db: AfribokDb,
  actor: SessionUser,
  encounterId: string,
  assessment: TriageAssessment,
): Encounter {
  const encounter = getEncounter(db, actor.facilityId, encounterId)
  if (!encounter) throw new ServiceError('Visit not found.', 404, 'NOT_FOUND')

  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(
      `UPDATE encounters SET triage_json = ?, triage_level = ?, triage_at = ? WHERE id = ? AND facility_id = ?`,
    ).run(JSON.stringify(assessment), assessment.level, assessment.assessedAt, encounterId, actor.facilityId)
    recordAudit(db, {
      facilityId: actor.facilityId,
      actorId: actor.id,
      actorName: actor.name,
      action: 'triage.assessed',
      entityType: 'encounter',
      entityId: encounterId,
      detail: { level: assessment.level, model: assessment.model, redFlags: assessment.redFlags.length },
      eventTime: now,
    })
  })()

  const updated = getEncounter(db, actor.facilityId, encounterId)
  if (!updated) throw new ServiceError('Triage could not be saved.', 500)
  return updated
}

/** Persist an AI scribe note on an encounter. */
export function saveNote(
  db: AfribokDb,
  actor: SessionUser,
  encounterId: string,
  note: ClinicalNote,
): Encounter {
  const encounter = getEncounter(db, actor.facilityId, encounterId)
  if (!encounter) throw new ServiceError('Visit not found.', 404, 'NOT_FOUND')

  db.transaction(() => {
    db.prepare(
      `UPDATE encounters
       SET note_json = ?, note_at = ?, note_approved_at = NULL, note_approved_by = NULL
       WHERE id = ? AND facility_id = ?`,
    ).run(JSON.stringify(note), note.generatedAt, encounterId, actor.facilityId)
    recordAudit(db, {
      facilityId: actor.facilityId,
      actorId: actor.id,
      actorName: actor.name,
      action: 'scribe.note_saved',
      entityType: 'encounter',
      entityId: encounterId,
      detail: { model: note.model, audioSeconds: note.audioSeconds },
      eventTime: note.generatedAt,
    })
  })()

  const updated = getEncounter(db, actor.facilityId, encounterId)
  if (!updated) throw new ServiceError('Note could not be saved.', 500)
  return updated
}

const DEFAULT_CAPACITY: Capacity = {
  consultRooms: 2,
  beds: 6,
  clinicians: 2,
  equipment: [
    { name: 'Examination couch', units: 3 },
    { name: 'IV infusion stand', units: 4 },
    { name: 'Nebuliser', units: 1 },
  ],
  updatedAt: null,
}

interface CapacityRow {
  consult_rooms: number
  beds: number
  clinicians: number
  equipment: string
  updated_at: string
}

export function getCapacity(db: AfribokDb, facilityId: string): Capacity {
  const row = db.prepare('SELECT * FROM capacity WHERE facility_id = ?').get(facilityId) as
    | CapacityRow
    | undefined
  if (!row) return { ...DEFAULT_CAPACITY, equipment: [...DEFAULT_CAPACITY.equipment] }
  let equipment: Capacity['equipment'] = []
  try {
    const parsed = JSON.parse(row.equipment) as Capacity['equipment']
    if (Array.isArray(parsed)) equipment = parsed.filter((item) => item && typeof item.name === 'string')
  } catch {
    equipment = []
  }
  return {
    consultRooms: row.consult_rooms,
    beds: row.beds,
    clinicians: row.clinicians,
    equipment,
    updatedAt: row.updated_at,
  }
}

export function saveCapacity(
  db: AfribokDb,
  actor: SessionUser,
  input: Omit<Capacity, 'updatedAt'>,
): Capacity {
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO capacity (facility_id, consult_rooms, beds, clinicians, equipment, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(facility_id) DO UPDATE SET
         consult_rooms = excluded.consult_rooms,
         beds = excluded.beds,
         clinicians = excluded.clinicians,
         equipment = excluded.equipment,
         updated_at = excluded.updated_at`,
    ).run(
      actor.facilityId,
      input.consultRooms,
      input.beds,
      input.clinicians,
      JSON.stringify(input.equipment),
      now,
    )
    recordAudit(db, {
      facilityId: actor.facilityId,
      actorId: actor.id,
      actorName: actor.name,
      action: 'capacity.updated',
      entityType: 'facility',
      entityId: actor.facilityId,
      detail: {
        consultRooms: input.consultRooms,
        beds: input.beds,
        clinicians: input.clinicians,
        equipment: input.equipment.length,
      },
      eventTime: now,
    })
  })()
  return getCapacity(db, actor.facilityId)
}

export function countActiveStaff(db: AfribokDb, facilityId: string, role: 'clinician' | 'nurse'): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE facility_id = ? AND role = ? AND active = 1")
    .get(facilityId, role) as { count: number }
  return row.count
}

/** Approve a drafted note. Only an approved note may leave Afribok for an EHR. */
export function approveNote(
  db: AfribokDb,
  actor: SessionUser,
  encounterId: string,
  approved: boolean,
): Encounter {
  const encounter = getEncounter(db, actor.facilityId, encounterId)
  if (!encounter) throw new ServiceError('Visit not found.', 404, 'NOT_FOUND')
  if (!encounter.note) throw new ServiceError('Draft a note before approving it.', 409, 'NO_NOTE')
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(
      'UPDATE encounters SET note_approved_at = ?, note_approved_by = ? WHERE id = ? AND facility_id = ?',
    ).run(approved ? now : null, approved ? actor.name : null, encounterId, actor.facilityId)
    recordAudit(db, {
      facilityId: actor.facilityId,
      actorId: actor.id,
      actorName: actor.name,
      action: approved ? 'scribe.note_approved' : 'scribe.note_unapproved',
      entityType: 'encounter',
      entityId: encounterId,
      detail: { approved },
      eventTime: now,
    })
  })()
  const updated = getEncounter(db, actor.facilityId, encounterId)
  if (!updated) throw new ServiceError('The note could not be updated.', 500)
  return updated
}

/** Assign a visit to a clinician and/or move it between departments. */
export function assignEncounter(
  db: AfribokDb,
  actor: SessionUser,
  encounterId: string,
  patch: { assignedClinicianId?: string | null; departmentId?: string | null; status?: EncounterStatus },
): Encounter {
  const current = getEncounter(db, actor.facilityId, encounterId)
  if (!current) throw new ServiceError('Visit not found.', 404, 'NOT_FOUND')
  if (!canAccessEncounter(actor, current)) {
    throw new ServiceError('This visit belongs to another department.', 403, 'DEPARTMENT_SCOPE')
  }
  const outcome = updateEncounter(db, actor, {
    encounterId,
    baseVersion: current.version,
    ...(patch.assignedClinicianId !== undefined ? { assignedClinicianId: patch.assignedClinicianId } : {}),
    ...(patch.departmentId !== undefined ? { departmentId: patch.departmentId } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
  })
  if (outcome.outcome === 'conflict' || !outcome.encounter) {
    throw new ServiceError('This visit changed on another session. Refresh and try again.', 409, 'VERSION_CONFLICT')
  }
  return outcome.encounter
}

function average(values: number[]): number | null {
  const usable = values.filter((value) => Number.isFinite(value) && value >= 0)
  if (usable.length === 0) return null
  return Math.round((usable.reduce((sum, value) => sum + value, 0) / usable.length) * 10) / 10
}

function minutesBetween(later: string | null | undefined, earlier: string | null | undefined): number | null {
  if (!later || !earlier) return null
  const delta = (new Date(later).getTime() - new Date(earlier).getTime()) / 60000
  return Number.isFinite(delta) && delta >= 0 && delta <= 7 * 24 * 60 ? delta : null
}

/** Measured timings only; nothing is estimated or filled with example values. */
export function buildPerformanceReport(
  db: AfribokDb,
  facilityId: string,
  windowDays = 30,
): PerformanceReport {
  const now = new Date()
  const days = Math.max(1, Math.min(365, Math.round(windowDays)))
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString()
  const rows = db
    .prepare(
      `SELECT e.*, d.name AS department_name FROM encounters e
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE e.facility_id = ? AND e.arrived_at >= ?`,
    )
    .all(facilityId, cutoff) as Array<{
    patient_id: string
    department_id: string | null
    department_name: string | null
    status: EncounterStatus
    arrived_at: string
    created_at: string
    consult_started_at: string | null
    triage_at: string | null
    triage_level: number | null
    note_at: string | null
  }>
  const registered = (db
    .prepare('SELECT COUNT(*) AS count FROM patients WHERE facility_id = ? AND created_at >= ?')
    .get(facilityId, cutoff) as { count: number }).count
  const triaged = rows.filter((row) => row.triage_at).length
  const consulted = rows.filter((row) => row.consult_started_at).length
  const completed = rows.filter((row) => row.status === 'completed').length
  const urgentOpen = rows.filter(
    (row) => row.status !== 'completed' && row.triage_level !== null && row.triage_level <= 2,
  ).length

  const arrivalToRegistration = rows
    .map((row) => minutesBetween(row.created_at, row.arrived_at))
    .filter((value): value is number => value !== null)
  const registrationToTriage = rows
    .map((row) => minutesBetween(row.triage_at, row.created_at))
    .filter((value): value is number => value !== null)
  const triageToDoctor = rows
    .map((row) => minutesBetween(row.consult_started_at, row.triage_at))
    .filter((value): value is number => value !== null)
  const totalWait = rows
    .map((row) => minutesBetween(row.consult_started_at, row.arrived_at))
    .filter((value): value is number => value !== null)
  const documentation = rows
    .map((row) => minutesBetween(row.note_at, row.consult_started_at ?? row.triage_at ?? row.created_at))
    .filter((value): value is number => value !== null)

  const departmentIds = db
    .prepare('SELECT id, name FROM departments WHERE facility_id = ? ORDER BY name')
    .all(facilityId) as Array<{ id: string; name: string }>
  const departments = departmentIds.map((department) => {
    const relevant = rows.filter((row) => row.department_id === department.id)
    const waits = relevant
      .map((row) => minutesBetween(row.consult_started_at, row.arrived_at))
      .filter((value): value is number => value !== null)
    return {
      id: department.id,
      name: department.name,
      registered: relevant.length,
      triaged: relevant.filter((row) => row.triage_at).length,
      completed: relevant.filter((row) => row.status === 'completed').length,
      averageWaitMinutes: average(waits),
    }
  })

  const dailyMap = new Map<string, { registered: number; completed: number }>()
  for (let index = Math.min(days, 14) - 1; index >= 0; index -= 1) {
    const date = new Date(now.getTime() - index * 86_400_000).toISOString().slice(0, 10)
    dailyMap.set(date, { registered: 0, completed: 0 })
  }
  for (const row of rows) {
    const date = row.arrived_at.slice(0, 10)
    const bucket = dailyMap.get(date)
    if (bucket) {
      bucket.registered += 1
      if (row.status === 'completed') bucket.completed += 1
    }
  }

  return {
    generatedAt: now.toISOString(),
    windowDays: days,
    counts: { registered, triaged, consulted, completed, urgentOpen },
    timings: {
      arrivalToRegistrationMinutes: average(arrivalToRegistration),
      registrationToTriageMinutes: average(registrationToTriage),
      triageToDoctorMinutes: average(triageToDoctor),
      totalWaitMinutes: average(totalWait),
      documentationMinutes: average(documentation),
    },
    departments,
    daily: Array.from(dailyMap.entries()).map(([date, value]) => ({ date, ...value })),
    notes: [
      arrivalToRegistration.length < 5
        ? 'Arrival-to-registration has fewer than five measured visits; treat the average as indicative only.'
        : `Arrival-to-registration measured on ${arrivalToRegistration.length} visits.`,
      triageToDoctor.length === 0
        ? 'No visit has a recorded consultation start after triage yet, so triage-to-doctor time is unavailable.'
        : `Triage-to-doctor measured on ${triageToDoctor.length} visits.`,
      documentation.length === 0
        ? 'No clinician note has been recorded against a consultation start yet.'
        : `Documentation time measured on ${documentation.length} drafted notes.`,
    ],
  }
}
