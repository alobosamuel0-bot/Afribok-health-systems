import type { Encounter, SyncResult } from '@shared/types'
import { ApiError, NetworkError, api } from './api'
import {
  addSyncLog,
  deleteLocalEncounter,
  deleteLocalPatient,
  deleteOutbox,
  getLocalEncounter,
  getLocalPatient,
  listOutbox,
  putLocalEncounter,
  putLocalPatient,
  putOutbox,
  setLastSyncAt,
} from './local-db'
import type { LocalEncounter, OutboxEntry, SyncReport } from './local-types'

let activeSync: Promise<SyncReport> | null = null

function emptyReport(): SyncReport {
  return { attempted: 0, applied: 0, conflicts: 0, rejected: 0 }
}

export function syncOutbox(): Promise<SyncReport> {
  if (activeSync) return activeSync
  activeSync = runSync().finally(() => {
    activeSync = null
  })
  return activeSync
}

async function runSync(): Promise<SyncReport> {
  const all = await listOutbox()
  const pending = all.filter((entry) => entry.status === 'pending')
  if (pending.length === 0) return emptyReport()

  const report: SyncReport = { attempted: pending.length, applied: 0, conflicts: 0, rejected: 0 }
  for (const entry of pending) {
    await putOutbox({ ...entry, status: 'syncing' })
  }

  let response: { results: SyncResult[]; serverTime: string }
  try {
    response = await api<{ results: SyncResult[]; serverTime: string }>('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ operations: pending.map((entry) => entry.operation) }),
    })
  } catch (error) {
    for (const entry of pending) {
      const current = (await listOutbox()).find((candidate) => candidate.id === entry.id)
      if (!current) continue
      await putOutbox({
        ...current,
        status: 'pending',
        attempts: current.attempts + 1,
        lastError: error instanceof Error ? error.message : 'Sync failed',
      })
    }
    const message =
      error instanceof NetworkError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Synchronisation failed.'
    await addSyncLog({
      at: new Date().toISOString(),
      attempted: pending.length,
      applied: 0,
      conflicts: 0,
      rejected: 0,
      message,
    })
    return {
      ...report,
      error: message,
      sessionExpired: error instanceof ApiError && error.status === 401,
    }
  }

  const results = new Map(response.results.map((result) => [result.id, result]))
  for (const entry of pending) {
    const result = results.get(entry.id)
    if (!result) {
      const current = (await listOutbox()).find((candidate) => candidate.id === entry.id)
      if (current) {
        await putOutbox({
          ...current,
          status: 'pending',
          attempts: current.attempts + 1,
          lastError: 'The server did not return a result for this change.',
        })
      }
      continue
    }

    if (result.status === 'applied' || result.status === 'duplicate') {
      if (result.patient) {
        await putLocalPatient({ ...result.patient, syncState: 'synced' })
      }
      if (result.encounter) {
        await putLocalEncounter({ ...result.encounter, syncState: 'synced' })
      }
      await deleteOutbox(entry.id)
      report.applied += 1
      continue
    }

    if (result.status === 'conflict') {
      await putOutbox({
        ...entry,
        status: 'conflict',
        lastError: result.message || 'This change conflicts with the server record.',
        serverEncounter: result.serverEncounter,
        candidates: result.candidates,
      })
      await markRecord(entry, 'conflict')
      report.conflicts += 1
      continue
    }

    await putOutbox({
      ...entry,
      status: 'rejected',
      lastError: result.message || 'The server rejected this change.',
    })
    await markRecord(entry, 'rejected')
    report.rejected += 1
  }

  if (report.applied > 0) await setLastSyncAt(response.serverTime)
  const message =
    report.conflicts > 0 || report.rejected > 0
      ? `${report.applied} synced · ${report.conflicts} conflict(s) · ${report.rejected} rejected`
      : `${report.applied} change(s) synced`
  await addSyncLog({
    at: new Date().toISOString(),
    attempted: report.attempted,
    applied: report.applied,
    conflicts: report.conflicts,
    rejected: report.rejected,
    message,
  })
  return report
}

async function markRecord(entry: OutboxEntry, state: 'conflict' | 'rejected'): Promise<void> {
  if (entry.patientId) {
    const patient = await getLocalPatient(entry.patientId)
    if (patient) await putLocalPatient({ ...patient, syncState: state })
  }
  if (entry.encounterId) {
    const encounter = await getLocalEncounter(entry.encounterId)
    if (encounter) await putLocalEncounter({ ...encounter, syncState: state })
  }
}

export async function useServerVersion(entry: OutboxEntry): Promise<void> {
  if (entry.serverEncounter) {
    const server: LocalEncounter = { ...entry.serverEncounter, syncState: 'synced' }
    await putLocalEncounter(server)
  }
  await deleteOutbox(entry.id)
}

export async function discardUnsentRegistration(entry: OutboxEntry): Promise<void> {
  // Only used for a locally-created registration that the server refused. It is
  // never used to delete a record that has been accepted by the server.
  if (entry.operation.type !== 'register_patient') return
  const { patient, encounter } = entry.operation.payload
  const localPatient = await getLocalPatient(patient.id)
  if (localPatient?.syncState !== 'synced') {
    await deleteLocalPatient(patient.id)
    await deleteLocalEncounter(encounter.id)
  }
  await deleteOutbox(entry.id)
}

export async function removeRejectedOperation(entry: OutboxEntry): Promise<void> {
  await deleteOutbox(entry.id)
}

export function serverEncounterLabel(encounter: Encounter | undefined): string {
  if (!encounter) return ''
  return `${encounter.status.replace('_', ' ')} · version ${encounter.version}`
}
