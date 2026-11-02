import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  Bootstrap,
  CreateEncounterPayload,
  Encounter,
  EncounterStatus,
  Facility,
  Patient,
  RegisterPatientPayload,
  SessionUser,
  SyncOperation,
  UpdateEncounterPayload,
} from '@shared/types'
import { ApiError, NetworkError, api } from '@/lib/api'
import { newHospitalNumber } from '@/lib/format'
import { mergeEncounters, mergePatients } from '@/lib/merge'
import {
  deleteLocalEncounter,
  deleteOutbox,
  getLastSyncAt,
  getLocalEncounter,
  getSyncLog,
  listLocalEncounters,
  listLocalPatients,
  listOutbox,
  putLocalEncounter,
  putLocalPatient,
  resetStuckOperations,
  saveEncounterLocally,
  saveEncounterUpdateLocally,
  saveRegistrationLocally,
  setDataOwnerId,
} from '@/lib/local-db'
import type {
  LocalEncounter,
  LocalPatient,
  OutboxEntry,
  SyncLogEntry,
  SyncReport,
} from '@/lib/local-types'
import {
  discardUnsentRegistration,
  removeRejectedOperation,
  syncOutbox,
  useServerVersion,
} from '@/lib/sync'
import { useAuth } from '@/auth/AuthProvider'

export interface RegistrationInput {
  firstName: string
  lastName: string
  otherNames: string
  sex: Patient['sex']
  dateOfBirth: string
  phone: string
  address: string
  identifierType: string
  identifierValue: string
  allergies: string
  medicalHistory: string
  currentMedications: string
  chiefComplaint: string
  departmentId: string | null
  consentRecorded: boolean
  duplicateAcknowledged: boolean
}

interface WorkspaceContextValue {
  facility: Facility
  patients: LocalPatient[]
  encounters: LocalEncounter[]
  outbox: OutboxEntry[]
  syncLog: SyncLogEntry[]
  pendingCount: number
  conflictCount: number
  online: boolean
  serverReachable: boolean | null
  syncing: boolean
  initializing: boolean
  dataError: string | null
  lastSyncAt: string | null
  registerPatient: (input: RegistrationInput) => Promise<{ patient: LocalPatient; encounter: LocalEncounter }>
  checkIn: (patientId: string, chiefComplaint: string, departmentId?: string | null, consentRecorded?: boolean) => Promise<LocalEncounter>
  updateEncounter: (
    encounterId: string,
    patch: { chiefComplaint?: string; status?: EncounterStatus },
  ) => Promise<void>
  triggerSync: () => Promise<SyncReport>
  refreshFromServer: () => Promise<void>
  resolveConflict: (entry: OutboxEntry) => Promise<void>
  discardEntry: (entry: OutboxEntry) => Promise<void>
  removeRejected: (entry: OutboxEntry) => Promise<void>
  patientName: (patientId: string) => string
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

const EMPTY_REPORT: SyncReport = { attempted: 0, applied: 0, conflicts: 0, rejected: 0 }

function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function WorkspaceProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  const { facility: authFacility, expireSession } = useAuth()
  const facility = authFacility as Facility

  const [patients, setPatients] = useState<LocalPatient[]>([])
  const [encounters, setEncounters] = useState<LocalEncounter[]>([])
  const [outbox, setOutbox] = useState<OutboxEntry[]>([])
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([])
  const [lastSyncAt, setLastSyncAtState] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [serverReachable, setServerReachable] = useState<boolean | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const syncingRef = useRef(false)
  const mountedRef = useRef(true)

  const refreshLocal = useCallback(async () => {
    const [localPatients, localEncounters, localOutbox, lastSync, logs] = await Promise.all([
      listLocalPatients(),
      listLocalEncounters(),
      listOutbox(),
      getLastSyncAt(),
      getSyncLog(),
    ])
    if (!mountedRef.current) return
    setPatients(localPatients)
    setEncounters(localEncounters)
    setOutbox(localOutbox)
    setLastSyncAtState(lastSync)
    setSyncLog(logs)
  }, [])

  const triggerSync = useCallback(async (): Promise<SyncReport> => {
    if (!navigator.onLine) {
      return { ...EMPTY_REPORT, error: 'You are offline. Changes remain queued on this device.' }
    }
    if (syncingRef.current) return EMPTY_REPORT
    syncingRef.current = true
    setSyncing(true)
    try {
      const report = await syncOutbox()
      if (report.sessionExpired) {
        expireSession()
        return report
      }
      if (report.error) {
        setServerReachable(false)
        setDataError(report.error)
      } else {
        setServerReachable(true)
        setDataError(null)
      }
      await refreshLocal()
      return report
    } catch (error) {
      const message =
        error instanceof NetworkError
          ? error.message
          : 'Local changes could not be synchronised.'
      setDataError(message)
      return { ...EMPTY_REPORT, error: message }
    } finally {
      syncingRef.current = false
      if (mountedRef.current) setSyncing(false)
    }
  }, [expireSession, refreshLocal])

  const refreshFromServer = useCallback(async () => {
    if (!navigator.onLine) {
      setServerReachable(false)
      return
    }
    try {
      const bootstrap = await api<Bootstrap>('/api/bootstrap')
      const [localPatients, localEncounters] = await Promise.all([
        listLocalPatients(),
        listLocalEncounters(),
      ])
      const mergedPatients = mergePatients(localPatients, bootstrap.patients)
      const mergedEncounters = mergeEncounters(localEncounters, bootstrap.encounters)
      await Promise.all([
        ...mergedPatients.map((patient) => putLocalPatient(patient)),
        ...mergedEncounters.map((encounter) => putLocalEncounter(encounter)),
        setDataOwnerId(user.id),
      ])
      setServerReachable(true)
      setDataError(null)
      await refreshLocal()
    } catch (error) {
      if (error instanceof NetworkError) {
        setServerReachable(false)
        setDataError('The clinic server is unreachable. You are working from this device’s local records.')
      } else if (error instanceof ApiError && error.status === 401) {
        expireSession()
      } else {
        setDataError(error instanceof Error ? error.message : 'Patient records could not be refreshed.')
      }
    }
  }, [expireSession, refreshLocal, user.id])

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    const boot = async () => {
      try {
        await resetStuckOperations()
        await setDataOwnerId(user.id)
        await refreshLocal()
      } catch (error) {
        if (!cancelled) {
          setDataError(
            error instanceof Error
              ? error.message
              : 'Local storage could not be opened. Reconnect and check browser settings.',
          )
        }
      } finally {
        if (!cancelled) setInitializing(false)
      }
      if (cancelled) return
      if (navigator.onLine) {
        await refreshFromServer()
        await triggerSync()
      }
    }
    void boot()
    return () => {
      cancelled = true
      mountedRef.current = false
    }
    // Boot is intentionally once per signed-in workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true)
      void refreshFromServer().then(() => triggerSync())
    }
    const handleOffline = () => {
      setOnline(false)
      setServerReachable(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [refreshFromServer, triggerSync])

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (navigator.onLine) void triggerSync()
    }, 30000)
    const onFocus = () => {
      if (navigator.onLine) void triggerSync()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [triggerSync])

  const registerPatient = useCallback(
    async (input: RegistrationInput) => {
      const now = new Date().toISOString()
      const patientId = crypto.randomUUID()
      const encounterId = crypto.randomUUID()
      const hospitalNumber = newHospitalNumber(patients.map((patient) => patient.hospitalNumber))
      const patient: LocalPatient = {
        id: patientId,
        hospitalNumber,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        otherNames: textOrNull(input.otherNames),
        sex: input.sex,
        dateOfBirth: textOrNull(input.dateOfBirth),
        phone: textOrNull(input.phone),
        address: textOrNull(input.address),
        identifierType: textOrNull(input.identifierType),
        identifierValue: textOrNull(input.identifierValue),
        allergies: textOrNull(input.allergies),
        medicalHistory: textOrNull(input.medicalHistory),
        currentMedications: textOrNull(input.currentMedications),
        createdAt: now,
        updatedAt: now,
        version: 1,
        synthetic: false,
        syncState: 'pending',
      }
      const encounter: LocalEncounter = {
        id: encounterId,
        patientId,
        departmentId: input.departmentId,
        departmentName: null,
        assignedClinicianId: null,
        assignedClinicianName: null,
        arrivedAt: now,
        chiefComplaint: input.chiefComplaint.trim(),
        status: 'waiting',
        consentRecorded: input.consentRecorded,
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
        version: 1,
        synthetic: false,
        triage: null,
        note: null,
        noteApprovedAt: null,
        noteApprovedBy: null,
        syncState: 'pending',
      }
      const payload: RegisterPatientPayload = {
        patient: {
          id: patientId,
          hospitalNumber,
          firstName: patient.firstName,
          lastName: patient.lastName,
          otherNames: patient.otherNames,
          sex: patient.sex,
          dateOfBirth: patient.dateOfBirth,
          phone: patient.phone,
          address: patient.address,
          identifierType: patient.identifierType,
          identifierValue: patient.identifierValue,
          allergies: patient.allergies,
          medicalHistory: patient.medicalHistory,
          currentMedications: patient.currentMedications,
          createdAt: now,
        },
        encounter: {
          id: encounterId,
          arrivedAt: now,
          chiefComplaint: encounter.chiefComplaint,
          departmentId: input.departmentId,
          consentRecorded: input.consentRecorded,
          createdAt: now,
        },
        duplicateAcknowledged: input.duplicateAcknowledged,
      }
      const operation: SyncOperation = {
        id: crypto.randomUUID(),
        type: 'register_patient',
        clientTime: now,
        payload,
      }
      const entry: OutboxEntry = {
        id: operation.id,
        operation,
        createdAt: now,
        status: 'pending',
        attempts: 0,
        label: 'Patient registration',
        patientId,
        encounterId,
      }
      await saveRegistrationLocally(patient, encounter, entry)
      await refreshLocal()
      if (navigator.onLine) void triggerSync()
      return { patient, encounter }
    },
    [patients, refreshLocal, triggerSync, user.id],
  )

  const checkIn = useCallback(
    async (patientId: string, chiefComplaint: string, departmentId: string | null = null, consentRecorded = false) => {
      const patient = patients.find((candidate) => candidate.id === patientId)
      if (!patient) throw new Error('Patient record not found on this device.')
      if (patient.syncState === 'rejected') {
        throw new Error('This patient record was rejected by the server. Resolve it in the sync centre first.')
      }
      if (patient.syncState === 'conflict') {
        throw new Error('This patient has an unresolved sync conflict. Resolve it before starting a new visit.')
      }
      const now = new Date().toISOString()
      const encounterId = crypto.randomUUID()
      const encounter: LocalEncounter = {
        id: encounterId,
        patientId,
        departmentId,
        departmentName: null,
        assignedClinicianId: null,
        assignedClinicianName: null,
        arrivedAt: now,
        chiefComplaint: chiefComplaint.trim(),
        status: 'waiting',
        consentRecorded,
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
        version: 1,
        synthetic: false,
        triage: null,
        note: null,
        noteApprovedAt: null,
        noteApprovedBy: null,
        syncState: 'pending',
      }
      const payload: CreateEncounterPayload = {
        id: encounterId,
        patientId,
        arrivedAt: now,
        chiefComplaint: encounter.chiefComplaint,
        departmentId,
        consentRecorded,
        createdAt: now,
      }
      const operation: SyncOperation = {
        id: crypto.randomUUID(),
        type: 'create_encounter',
        clientTime: now,
        payload,
      }
      const entry: OutboxEntry = {
        id: operation.id,
        operation,
        createdAt: now,
        status: 'pending',
        attempts: 0,
        label: 'New visit',
        patientId,
        encounterId,
      }
      await saveEncounterLocally(encounter, entry)
      await refreshLocal()
      if (navigator.onLine) void triggerSync()
      return encounter
    },
    [patients, refreshLocal, triggerSync, user.id],
  )

  const updateEncounter = useCallback(
    async (encounterId: string, patch: { chiefComplaint?: string; status?: EncounterStatus }) => {
      const local = encounters.find((candidate) => candidate.id === encounterId)
      if (!local) throw new Error('Visit not found on this device.')
      if (local.status === 'completed') throw new Error('Completed visits cannot be changed in this build.')
      const now = new Date().toISOString()
      const updated: LocalEncounter = {
        ...local,
        chiefComplaint: patch.chiefComplaint !== undefined ? patch.chiefComplaint.trim() : local.chiefComplaint,
        status: patch.status ?? local.status,
        updatedAt: now,
        version: local.version + 1,
        syncState: 'pending',
      }
      const payload: UpdateEncounterPayload = {
        encounterId,
        baseVersion: local.version,
        ...(patch.chiefComplaint !== undefined ? { chiefComplaint: updated.chiefComplaint } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      }
      const operation: SyncOperation = {
        id: crypto.randomUUID(),
        type: 'update_encounter',
        clientTime: now,
        payload,
      }
      const entry: OutboxEntry = {
        id: operation.id,
        operation,
        createdAt: now,
        status: 'pending',
        attempts: 0,
        label: 'Visit update',
        patientId: local.patientId,
        encounterId,
      }
      await saveEncounterUpdateLocally(updated, entry)
      await refreshLocal()
      if (navigator.onLine) void triggerSync()
    },
    [encounters, refreshLocal, triggerSync],
  )

  const resolveConflict = useCallback(
    async (entry: OutboxEntry) => {
      if (entry.operation.type === 'update_encounter') {
        if (entry.serverEncounter) {
          await useServerVersion(entry)
        } else {
          const result = await api<{ encounter: Encounter }>(
            `/api/encounters/${entry.encounterId}`,
          )
          if (result.encounter && entry.encounterId) {
            await putLocalEncounter({ ...result.encounter, syncState: 'synced' })
            await deleteOutbox(entry.id)
          }
        }
      } else if (entry.operation.type === 'create_encounter') {
        if (entry.encounterId) await deleteLocalEncounter(entry.encounterId)
        await deleteOutbox(entry.id)
      } else {
        await discardUnsentRegistration(entry)
      }
      await refreshLocal()
    },
    [refreshLocal],
  )

  const discardEntry = useCallback(
    async (entry: OutboxEntry) => {
      await resolveConflict(entry)
    },
    [resolveConflict],
  )

  const removeRejected = useCallback(
    async (entry: OutboxEntry) => {
      if (entry.operation.type === 'register_patient') {
        await discardUnsentRegistration(entry)
      } else if (entry.operation.type === 'create_encounter' && entry.encounterId) {
        const encounter = await getLocalEncounter(entry.encounterId)
        if (encounter && encounter.syncState !== 'synced') {
          await deleteLocalEncounter(entry.encounterId)
        }
        await removeRejectedOperation(entry)
      } else {
        await removeRejectedOperation(entry)
        if (entry.encounterId) {
          const encounter = await getLocalEncounter(entry.encounterId)
          if (encounter) await putLocalEncounter({ ...encounter, syncState: 'synced' })
        }
        await refreshFromServer()
      }
      await refreshLocal()
    },
    [refreshFromServer, refreshLocal],
  )

  const patientName = useCallback(
    (patientId: string) => {
      const patient = patients.find((candidate) => candidate.id === patientId)
      return patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown patient'
    },
    [patients],
  )

  const pendingCount = outbox.filter(
    (entry) => entry.status === 'pending' || entry.status === 'syncing',
  ).length
  const conflictCount = outbox.filter(
    (entry) => entry.status === 'conflict' || entry.status === 'rejected',
  ).length

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      facility,
      patients,
      encounters,
      outbox,
      syncLog,
      pendingCount,
      conflictCount,
      online,
      serverReachable,
      syncing,
      initializing,
      dataError,
      lastSyncAt,
      registerPatient,
      checkIn,
      updateEncounter,
      triggerSync,
      refreshFromServer,
      resolveConflict,
      discardEntry,
      removeRejected,
      patientName,
    }),
    [
      facility,
      patients,
      encounters,
      outbox,
      syncLog,
      pendingCount,
      conflictCount,
      online,
      serverReachable,
      syncing,
      initializing,
      dataError,
      lastSyncAt,
      registerPatient,
      checkIn,
      updateEncounter,
      triggerSync,
      refreshFromServer,
      resolveConflict,
      discardEntry,
      removeRejected,
      patientName,
    ],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return context
}
