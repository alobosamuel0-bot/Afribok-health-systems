import type {
  DuplicateCandidate,
  Encounter,
  Facility,
  Patient,
  SessionUser,
  SyncOperation,
} from '@shared/types'

export type RecordSyncState = 'synced' | 'pending' | 'conflict' | 'rejected'

export interface LocalPatient extends Patient {
  syncState: RecordSyncState
}

export interface LocalEncounter extends Encounter {
  syncState: RecordSyncState
}

export type OutboxStatus = 'pending' | 'syncing' | 'conflict' | 'rejected'

export interface OutboxEntry {
  id: string
  operation: SyncOperation
  createdAt: string
  status: OutboxStatus
  attempts: number
  lastError?: string
  label: string
  patientId?: string
  encounterId?: string
  serverEncounter?: Encounter
  candidates?: DuplicateCandidate[]
}

export interface SessionSnapshot {
  user: SessionUser
  facility: Facility
  expiresAt: string
  savedAt: string
}

export interface SyncLogEntry {
  at: string
  attempted: number
  applied: number
  conflicts: number
  rejected: number
  message: string
}

export interface SyncReport {
  attempted: number
  applied: number
  conflicts: number
  rejected: number
  error?: string
  sessionExpired?: boolean
}
