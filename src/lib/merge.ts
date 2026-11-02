import type { Encounter, Patient } from '@shared/types'
import type { LocalEncounter, LocalPatient } from './local-types'

const UNSYNCED = new Set(['pending', 'conflict', 'rejected'])

/**
 * Server records are authoritative only for records this device considers
 * synced. Pending or conflicted local edits are preserved, never overwritten.
 */
export function mergePatients(local: LocalPatient[], server: Patient[]): LocalPatient[] {
  const byId = new Map(local.map((patient) => [patient.id, patient]))
  for (const remote of server) {
    const existing = byId.get(remote.id)
    if (!existing) {
      byId.set(remote.id, { ...remote, syncState: 'synced' })
    } else if (!UNSYNCED.has(existing.syncState)) {
      byId.set(remote.id, { ...remote, syncState: 'synced' })
    }
  }
  return [...byId.values()]
}

export function mergeEncounters(local: LocalEncounter[], server: Encounter[]): LocalEncounter[] {
  const byId = new Map(local.map((encounter) => [encounter.id, encounter]))
  for (const remote of server) {
    const existing = byId.get(remote.id)
    if (!existing) {
      byId.set(remote.id, { ...remote, syncState: 'synced' })
    } else if (!UNSYNCED.has(existing.syncState)) {
      byId.set(remote.id, { ...remote, syncState: 'synced' })
    }
  }
  return [...byId.values()]
}
