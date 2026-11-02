import { randomUUID } from 'node:crypto'
import type { AfribokDb } from './db'
import { recordAudit } from './audit'
import { ServiceError } from './repository'
import { FACILITY } from './config'
import type {
  Department,
  DeviceKind,
  Facility,
  FacilityProfile,
  HistoryFormat,
} from '../shared/types'

/**
 * Hospital onboarding (spec Part 2). The answers are stored per facility and
 * are what the workspace is actually configured from: the facility name and
 * location shown in the shell, the departments used for assignment, whether
 * Afribok supplies its own EHR, and how the offline story is presented.
 */

interface ProfileRow {
  facility_id: string
  name: string
  facility_type: string
  location: string
  address: string
  size: string
  daily_patients: number | null
  operating_days: string
  operating_hours: string
  ehr_status: FacilityProfile['ehrStatus']
  ehr_name: string | null
  ehr_vendor: string | null
  ehr_api_access: FacilityProfile['ehrApiAccess']
  ehr_read: number
  ehr_write: number
  ehr_standard: string | null
  ehr_docs: number
  ehr_contact: string | null
  history_status: FacilityProfile['historyStatus']
  history_formats: string
  history_period: FacilityProfile['historyPeriod'] | null
  walk_in_share: FacilityProfile['walkInShare']
  appointments: number
  doctors: number | null
  nurses: number | null
  has_emergency: number
  has_lab: number
  has_pharmacy: number
  has_beds: number
  internet: FacilityProfile['internet']
  local_network: number
  local_server: number
  devices: string
  step: number
  completed_at: string | null
  updated_at: string
}

interface DepartmentRow {
  id: string
  name: string
  description: string
  head_user_id: string | null
  head_name: string | null
  staff_count: number
  created_at: string
  updated_at: string
}

function parseList<T extends string>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed.filter((item) => typeof item === 'string') as T[]) : []
  } catch {
    return []
  }
}

function mapProfile(row: ProfileRow): FacilityProfile {
  return {
    facilityId: row.facility_id,
    name: row.name,
    facilityType: row.facility_type,
    location: row.location,
    address: row.address,
    size: row.size,
    dailyPatients: row.daily_patients,
    operatingDays: row.operating_days,
    operatingHours: row.operating_hours,
    ehrStatus: row.ehr_status,
    ehrName: row.ehr_name,
    ehrVendor: row.ehr_vendor,
    ehrApiAccess: row.ehr_api_access,
    ehrRead: row.ehr_read === 1,
    ehrWrite: row.ehr_write === 1,
    ehrStandard: row.ehr_standard,
    ehrDocs: row.ehr_docs === 1,
    ehrContact: row.ehr_contact,
    historyStatus: row.history_status,
    historyFormats: parseList<HistoryFormat>(row.history_formats),
    historyPeriod: row.history_period,
    walkInShare: row.walk_in_share,
    appointments: row.appointments === 1,
    doctors: row.doctors,
    nurses: row.nurses,
    hasEmergency: row.has_emergency === 1,
    hasLab: row.has_lab === 1,
    hasPharmacy: row.has_pharmacy === 1,
    hasBeds: row.has_beds === 1,
    internet: row.internet,
    localNetwork: row.local_network === 1,
    localServer: row.local_server === 1,
    devices: parseList<DeviceKind>(row.devices),
    step: row.step,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  }
}

/** Create the profile row for a facility the first time it is needed. */
function ensureRow(db: AfribokDb, facilityId: string): ProfileRow {
  const existing = db
    .prepare('SELECT * FROM facility_profile WHERE facility_id = ?')
    .get(facilityId) as ProfileRow | undefined
  if (existing) return existing

  // A new facility starts with no hospital details: the administrator supplies
  // its real name rather than inheriting a deployment placeholder.
  db.prepare(
    `INSERT INTO facility_profile (facility_id, name, location, updated_at)
     VALUES (?, '', '', ?)
     ON CONFLICT(facility_id) DO NOTHING`,
  ).run(facilityId, new Date().toISOString())
  return db
    .prepare('SELECT * FROM facility_profile WHERE facility_id = ?')
    .get(facilityId) as ProfileRow
}

export function getProfile(db: AfribokDb, facilityId: string): FacilityProfile {
  return mapProfile(ensureRow(db, facilityId))
}

/** The facility object the client uses for branding, modules and gating. */
export function facilityView(db: AfribokDb, facilityId: string): Facility {
  const profile = getProfile(db, facilityId)
  const departmentCount = (db.prepare('SELECT COUNT(*) AS count FROM departments WHERE facility_id = ?')
    .get(facilityId) as { count: number }).count
  const externalEhr = profile.ehrStatus === 'ehr' || profile.ehrStatus === 'emr' || profile.ehrStatus === 'other_digital'
  return {
    ...FACILITY,
    id: facilityId,
    name: profile.name || 'Hospital setup',
    location: profile.location || 'Location not set yet',
    onboardingComplete: profile.completedAt !== null,
    ehrIntegrationEnabled: externalEhr && profile.ehrApiAccess === 'yes',
    voiceEnabled: profile.devices.length > 0,
    setupSummary: {
      ehrStatus: profile.ehrStatus,
      ehrName: profile.ehrName,
      ehrApiAccess: profile.ehrApiAccess,
      ehrRead: profile.ehrRead,
      ehrWrite: profile.ehrWrite,
      historyStatus: profile.historyStatus,
      historyPeriod: profile.historyPeriod,
      walkInShare: profile.walkInShare,
      appointments: profile.appointments,
      hasEmergency: profile.hasEmergency,
      hasLab: profile.hasLab,
      hasPharmacy: profile.hasPharmacy,
      internet: profile.internet,
      localNetwork: profile.localNetwork,
      localServer: profile.localServer,
      devices: profile.devices,
      departmentCount,
    },
  }
}

type ProfilePatch = Partial<Omit<FacilityProfile, 'facilityId' | 'updatedAt' | 'completedAt'>>

export function updateProfile(
  db: AfribokDb,
  actor: { id: string; name: string; facilityId: string },
  patch: ProfilePatch,
): FacilityProfile {
  ensureRow(db, actor.facilityId)
  const current = getProfile(db, actor.facilityId)
  const next: FacilityProfile = { ...current, ...patch, updatedAt: new Date().toISOString() }

  db.transaction(() => {
    db.prepare(
      `UPDATE facility_profile SET
         name = ?, facility_type = ?, location = ?, address = ?, size = ?,
         daily_patients = ?, operating_days = ?, operating_hours = ?,
         ehr_status = ?, ehr_name = ?, ehr_vendor = ?, ehr_api_access = ?,
         ehr_read = ?, ehr_write = ?, ehr_standard = ?, ehr_docs = ?, ehr_contact = ?,
         history_status = ?, history_formats = ?, history_period = ?,
         walk_in_share = ?, appointments = ?, doctors = ?, nurses = ?,
         has_emergency = ?, has_lab = ?, has_pharmacy = ?, has_beds = ?,
         internet = ?, local_network = ?, local_server = ?, devices = ?,
         step = ?, updated_at = ?
       WHERE facility_id = ?`,
    ).run(
      next.name,
      next.facilityType,
      next.location,
      next.address,
      next.size,
      next.dailyPatients,
      next.operatingDays,
      next.operatingHours,
      next.ehrStatus,
      next.ehrName,
      next.ehrVendor,
      next.ehrApiAccess,
      next.ehrRead ? 1 : 0,
      next.ehrWrite ? 1 : 0,
      next.ehrStandard,
      next.ehrDocs ? 1 : 0,
      next.ehrContact,
      next.historyStatus,
      JSON.stringify(next.historyFormats),
      next.historyPeriod,
      next.walkInShare,
      next.appointments ? 1 : 0,
      next.doctors,
      next.nurses,
      next.hasEmergency ? 1 : 0,
      next.hasLab ? 1 : 0,
      next.hasPharmacy ? 1 : 0,
      next.hasBeds ? 1 : 0,
      next.internet,
      next.localNetwork ? 1 : 0,
      next.localServer ? 1 : 0,
      JSON.stringify(next.devices),
      next.step,
      next.updatedAt,
      actor.facilityId,
    )
    recordAudit(db, {
      facilityId: actor.facilityId,
      actorId: actor.id,
      actorName: actor.name,
      action: 'setup.profile_saved',
      entityType: 'facility',
      entityId: actor.facilityId,
      detail: { step: next.step, name: next.name, departments: null },
    })
  })()

  return getProfile(db, actor.facilityId)
}

export function completeSetup(
  db: AfribokDb,
  actor: { id: string; name: string; facilityId: string },
): FacilityProfile {
  const profile = getProfile(db, actor.facilityId)
  if (!profile.name.trim()) {
    throw new ServiceError('Add the hospital name before finishing setup.', 400, 'NAME_REQUIRED')
  }
  if (!profile.location.trim()) {
    throw new ServiceError('Add the hospital location before finishing setup.', 400, 'LOCATION_REQUIRED')
  }
  if (listDepartments(db, actor.facilityId).length === 0) {
    throw new ServiceError(
      'Configure at least one department before finishing setup.',
      400,
      'DEPARTMENT_REQUIRED',
    )
  }

  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(
      'UPDATE facility_profile SET completed_at = ?, step = 8, updated_at = ? WHERE facility_id = ?',
    ).run(now, now, actor.facilityId)
    recordAudit(db, {
      facilityId: actor.facilityId,
      actorId: actor.id,
      actorName: actor.name,
      action: 'setup.completed',
      entityType: 'facility',
      entityId: actor.facilityId,
      detail: {
        name: profile.name,
        facilityType: profile.facilityType,
        ehrStatus: profile.ehrStatus,
        historyStatus: profile.historyStatus,
        internet: profile.internet,
      },
      eventTime: now,
    })
  })()

  return getProfile(db, actor.facilityId)
}

export function listDepartments(db: AfribokDb, facilityId: string): Department[] {
  const rows = db
    .prepare(
      `SELECT d.*, u.name AS head_name,
              (SELECT COUNT(*) FROM users s WHERE s.department_id = d.id AND s.active = 1) AS staff_count
       FROM departments d
       LEFT JOIN users u ON u.id = d.head_user_id
       WHERE d.facility_id = ?
       ORDER BY d.name`,
    )
    .all(facilityId) as DepartmentRow[]
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    headUserId: row.head_user_id,
    headName: row.head_name,
    staffCount: row.staff_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

function assertHead(db: AfribokDb, facilityId: string, headUserId: string | null | undefined) {
  if (headUserId === undefined || headUserId === null) return null
  const user = db
    .prepare('SELECT id FROM users WHERE id = ? AND facility_id = ? AND active = 1')
    .get(headUserId, facilityId)
  if (!user) throw new ServiceError('That staff account is not active in this facility.', 400, 'BAD_HEAD')
  return headUserId
}

export function createDepartment(
  db: AfribokDb,
  actor: { id: string; name: string; facilityId: string },
  input: { name: string; description?: string; headUserId?: string | null },
): Department {
  const name = input.name.trim()
  const existing = db
    .prepare('SELECT 1 FROM departments WHERE facility_id = ? AND lower(name) = lower(?)')
    .get(actor.facilityId, name)
  if (existing) throw new ServiceError('A department with that name already exists.', 409, 'DEPARTMENT_EXISTS')

  const id = randomUUID()
  const now = new Date().toISOString()
  const headUserId = assertHead(db, actor.facilityId, input.headUserId ?? null)
  db.transaction(() => {
    db.prepare(
      `INSERT INTO departments (id, facility_id, name, description, head_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, actor.facilityId, name, (input.description ?? '').trim(), headUserId, now, now)
    recordAudit(db, {
      facilityId: actor.facilityId,
      actorId: actor.id,
      actorName: actor.name,
      action: 'department.created',
      entityType: 'department',
      entityId: id,
      detail: { name },
      eventTime: now,
    })
  })()
  const created = listDepartments(db, actor.facilityId).find((department) => department.id === id)
  if (!created) throw new ServiceError('Department could not be saved.', 500)
  return created
}

export function updateDepartment(
  db: AfribokDb,
  actor: { id: string; name: string; facilityId: string },
  departmentId: string,
  patch: { name?: string; description?: string; headUserId?: string | null },
): Department {
  const target = db
    .prepare('SELECT * FROM departments WHERE id = ? AND facility_id = ?')
    .get(departmentId, actor.facilityId) as { name: string; description: string; head_user_id: string | null } | undefined
  if (!target) throw new ServiceError('Department not found.', 404, 'DEPARTMENT_NOT_FOUND')

  const nextName = patch.name?.trim() ?? target.name
  if (!nextName) throw new ServiceError('Department name is required.', 400, 'NAME_REQUIRED')
  if (patch.name !== undefined && nextName.toLowerCase() !== target.name.toLowerCase()) {
    const clash = db
      .prepare('SELECT 1 FROM departments WHERE facility_id = ? AND lower(name) = lower(?) AND id <> ?')
      .get(actor.facilityId, nextName, departmentId)
    if (clash) throw new ServiceError('A department with that name already exists.', 409, 'DEPARTMENT_EXISTS')
  }
  const headUserId =
    patch.headUserId !== undefined ? assertHead(db, actor.facilityId, patch.headUserId) : target.head_user_id

  db.transaction(() => {
    db.prepare(
      'UPDATE departments SET name = ?, description = ?, head_user_id = ?, updated_at = ? WHERE id = ? AND facility_id = ?',
    ).run(
      nextName,
      patch.description !== undefined ? patch.description.trim() : target.description,
      headUserId,
      new Date().toISOString(),
      departmentId,
      actor.facilityId,
    )
    recordAudit(db, {
      facilityId: actor.facilityId,
      actorId: actor.id,
      actorName: actor.name,
      action: 'department.updated',
      entityType: 'department',
      entityId: departmentId,
      detail: { name: nextName },
    })
  })()

  const updated = listDepartments(db, actor.facilityId).find((department) => department.id === departmentId)
  if (!updated) throw new ServiceError('Department not found.', 404)
  return updated
}

export function deleteDepartment(
  db: AfribokDb,
  actor: { id: string; name: string; facilityId: string },
  departmentId: string,
): void {
  const target = db
    .prepare('SELECT * FROM departments WHERE id = ? AND facility_id = ?')
    .get(departmentId, actor.facilityId) as { name: string } | undefined
  if (!target) throw new ServiceError('Department not found.', 404, 'DEPARTMENT_NOT_FOUND')

  const assigned = db
    .prepare('SELECT COUNT(*) AS count FROM users WHERE department_id = ? AND active = 1')
    .get(departmentId) as { count: number }
  if (assigned.count > 0) {
    throw new ServiceError(
      'Move the staff assigned to this department first. Deleting it would leave them without a department.',
      409,
      'DEPARTMENT_HAS_STAFF',
    )
  }

  db.transaction(() => {
    db.prepare('DELETE FROM departments WHERE id = ? AND facility_id = ?').run(departmentId, actor.facilityId)
    recordAudit(db, {
      facilityId: actor.facilityId,
      actorId: actor.id,
      actorName: actor.name,
      action: 'department.deleted',
      entityType: 'department',
      entityId: departmentId,
      detail: { name: target.name },
    })
  })()
}
