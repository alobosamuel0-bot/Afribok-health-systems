export type Role = 'registration' | 'nurse' | 'clinician' | 'admin' | 'auditor'

export type Sex = 'female' | 'male' | 'other' | 'unknown'

export type EncounterStatus = 'waiting' | 'in_consultation' | 'completed'

export type Permission =
  | 'dashboard.read'
  | 'patient.read'
  | 'patient.create'
  | 'encounter.read'
  | 'encounter.create'
  | 'encounter.update'
  | 'audit.read'
  | 'team.manage'

export const ROLE_LABELS: Record<Role, string> = {
  registration: 'Registration officer',
  nurse: 'Nurse / triage',
  clinician: 'Clinician',
  admin: 'Facility administrator',
  auditor: 'Auditor',
}

export const ROLES = Object.keys(ROLE_LABELS) as Role[]

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  registration: [
    'dashboard.read',
    'patient.read',
    'patient.create',
    'encounter.read',
    'encounter.create',
  ],
  nurse: [
    'dashboard.read',
    'patient.read',
    'encounter.read',
    'encounter.create',
    'encounter.update',
  ],
  clinician: [
    'dashboard.read',
    'patient.read',
    'encounter.read',
    'encounter.create',
    'encounter.update',
  ],
  admin: [
    'dashboard.read',
    'patient.read',
    'patient.create',
    'encounter.read',
    'encounter.create',
    'encounter.update',
    'audit.read',
    'team.manage',
  ],
  auditor: ['dashboard.read', 'patient.read', 'encounter.read', 'audit.read'],
}

export function can(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export function permissionsFor(role: Role): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])]
}

/**
 * Clinical data is department-scoped. A clinician or nurse sees their own
 * department; registration, administrators and auditors have a facility-wide
 * operational view. The server uses the same rule before returning any record.
 */
export function canSeeAllDepartments(role: Role | undefined): boolean {
  return role === 'admin' || role === 'auditor' || role === 'registration'
}

export interface SessionUser {
  id: string
  name: string
  email: string
  role: Role
  facilityId: string
  facilityName: string
  departmentId: string | null
  departmentName: string | null
  staffNumber: string | null
}

export type EhrStatus = 'ehr' | 'emr' | 'other_digital' | 'paper' | 'none'
export type ConnectionAnswer = 'yes' | 'no' | 'unknown'
export type HistoryStatus = 'yes' | 'no' | 'partial'
export type HistoryFormat = 'paper' | 'ehr' | 'excel' | 'csv' | 'word' | 'other'
export type HistoryPeriod =
  | '3_6_months'
  | '6_12_months'
  | '1_2_years'
  | '2_3_years'
  | 'over_3_years'
export type WalkInShare = 'most' | 'some' | 'few'
export type InternetQuality = 'reliable' | 'unstable' | 'none'
export type DeviceKind = 'desktop' | 'tablet' | 'smartphone'

/** The hospital answers collected by the mandatory onboarding cards. */
export interface FacilityProfile {
  facilityId: string
  name: string
  facilityType: string
  location: string
  address: string
  size: string
  dailyPatients: number | null
  operatingDays: string
  operatingHours: string
  ehrStatus: EhrStatus
  ehrName: string | null
  ehrVendor: string | null
  ehrApiAccess: ConnectionAnswer
  ehrRead: boolean
  ehrWrite: boolean
  ehrStandard: string | null
  ehrDocs: boolean
  ehrContact: string | null
  historyStatus: HistoryStatus
  historyFormats: HistoryFormat[]
  historyPeriod: HistoryPeriod | null
  walkInShare: WalkInShare
  appointments: boolean
  doctors: number | null
  nurses: number | null
  hasEmergency: boolean
  hasLab: boolean
  hasPharmacy: boolean
  hasBeds: boolean
  internet: InternetQuality
  localNetwork: boolean
  localServer: boolean
  devices: DeviceKind[]
  step: number
  completedAt: string | null
  updatedAt: string
}

export interface Department {
  id: string
  name: string
  description: string
  headUserId: string | null
  headName: string | null
  staffCount: number
  createdAt: string
  updatedAt: string
}

export interface Facility {
  id: string
  name: string
  location: string
  mode: 'LIVE'
  onboardingComplete: boolean
  registrationFields: {
    dateOfBirth: 'required' | 'optional'
    phone: 'required' | 'optional'
    address: 'required' | 'optional'
    nationalIdentifier: 'required' | 'optional'
  }
  enabledModules: string[]
  triageEnabled: boolean
  voiceEnabled: boolean
  ehrIntegrationEnabled: boolean
  /** Non-sensitive setup answers used to tailor module status in the workspace. */
  setupSummary?: {
    ehrStatus: EhrStatus
    ehrName: string | null
    ehrApiAccess: ConnectionAnswer
    ehrRead: boolean
    ehrWrite: boolean
    historyStatus: HistoryStatus
    historyPeriod: HistoryPeriod | null
    walkInShare: WalkInShare
    appointments: boolean
    hasEmergency: boolean
    hasLab: boolean
    hasPharmacy: boolean
    internet: InternetQuality
    localNetwork: boolean
    localServer: boolean
    devices: DeviceKind[]
    departmentCount: number
  }
}

export interface Patient {
  id: string
  hospitalNumber: string
  firstName: string
  lastName: string
  otherNames: string | null
  sex: Sex
  dateOfBirth: string | null
  phone: string | null
  address: string | null
  identifierType: string | null
  identifierValue: string | null
  allergies: string | null
  medicalHistory: string | null
  currentMedications: string | null
  createdAt: string
  updatedAt: string
  version: number
  synthetic: boolean
}

export interface Encounter {
  id: string
  patientId: string
  departmentId: string | null
  departmentName: string | null
  assignedClinicianId: string | null
  assignedClinicianName: string | null
  arrivedAt: string
  chiefComplaint: string
  status: EncounterStatus
  consentRecorded: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
  version: number
  synthetic: boolean
  triage: import('./clinical').TriageAssessment | null
  note: import('./clinical').ClinicalNote | null
  noteApprovedAt: string | null
  noteApprovedBy: string | null
}

export interface DuplicateCandidate {
  patient: Patient
  score: number
  reasons: string[]
}

export interface AuditEvent {
  id: string
  actorId: string | null
  actorName: string
  action: string
  entityType: string
  entityId: string | null
  detail: Record<string, unknown> | null
  source: 'server' | 'sync'
  eventTime: string
  recordedAt: string
}

export interface TeamMember {
  id: string
  name: string
  email: string
  role: Role
  staffNumber: string | null
  phone: string | null
  departmentId: string | null
  departmentName: string | null
  isDepartmentHead: boolean
  active: boolean
  createdAt: string
  lastSignInAt: string | null
}

export type SyncOperationType = 'register_patient' | 'create_encounter' | 'update_encounter'

export interface SyncOperationInput {
  id: string
  type: SyncOperationType
  clientTime: string
  payload: unknown
}

export type SyncResultStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected'

export interface SyncResult {
  id: string
  status: SyncResultStatus
  message?: string
  patient?: Patient
  encounter?: Encounter
  serverEncounter?: Encounter
  candidates?: DuplicateCandidate[]
}

export interface Bootstrap {
  user: SessionUser
  facility: Facility
  departments: Department[]
  patients: Patient[]
  encounters: Encounter[]
  serverTime: string
}

export interface PatientInput {
  id: string
  hospitalNumber: string
  firstName: string
  lastName: string
  otherNames?: string | null
  sex: Sex
  dateOfBirth?: string | null
  phone?: string | null
  address?: string | null
  identifierType?: string | null
  identifierValue?: string | null
  allergies?: string | null
  medicalHistory?: string | null
  currentMedications?: string | null
  createdAt?: string
}

export interface EncounterInput {
  id: string
  arrivedAt: string
  chiefComplaint: string
  departmentId?: string | null
  consentRecorded?: boolean
  createdAt?: string
}

export interface RegisterPatientPayload {
  patient: PatientInput
  encounter: EncounterInput
  duplicateAcknowledged: boolean
}

export interface CreateEncounterPayload {
  id: string
  patientId: string
  arrivedAt: string
  chiefComplaint: string
  departmentId?: string | null
  consentRecorded?: boolean
  createdAt?: string
}

export interface UpdateEncounterPayload {
  encounterId: string
  baseVersion: number
  chiefComplaint?: string
  status?: EncounterStatus
  assignedClinicianId?: string | null
  departmentId?: string | null
}

export type SyncOperation =
  | {
      id: string
      type: 'register_patient'
      clientTime: string
      payload: RegisterPatientPayload
    }
  | {
      id: string
      type: 'create_encounter'
      clientTime: string
      payload: CreateEncounterPayload
    }
  | {
      id: string
      type: 'update_encounter'
      clientTime: string
      payload: UpdateEncounterPayload
    }

/** Measured operational timings. Values are null until enough events exist. */
export interface PerformanceReport {
  generatedAt: string
  windowDays: number
  counts: {
    registered: number
    triaged: number
    consulted: number
    completed: number
    urgentOpen: number
  }
  timings: {
    arrivalToRegistrationMinutes: number | null
    registrationToTriageMinutes: number | null
    triageToDoctorMinutes: number | null
    totalWaitMinutes: number | null
    documentationMinutes: number | null
  }
  departments: Array<{
    id: string | null
    name: string
    registered: number
    triaged: number
    completed: number
    averageWaitMinutes: number | null
  }>
  daily: Array<{ date: string; registered: number; completed: number }>
  notes: string[]
}
