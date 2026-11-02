import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { LocalEncounter, LocalPatient, OutboxEntry, SessionSnapshot, SyncLogEntry } from './local-types'

interface AfribokDb extends DBSchema {
  patients: {
    key: string
    value: LocalPatient
    indexes: { 'by-name': string }
  }
  encounters: {
    key: string
    value: LocalEncounter
    indexes: { 'by-patient': string; 'by-status': string }
  }
  outbox: {
    key: string
    value: OutboxEntry
    indexes: { 'by-status': string; 'by-created': string }
  }
  meta: {
    key: string
    value: unknown
  }
}

const DB_NAME = 'afribok-local'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<AfribokDb>> | null = null

export class LocalStorageUnavailable extends Error {
  constructor() {
    super('This device could not open local storage. Offline work is unavailable; reconnect and check browser storage settings.')
    this.name = 'LocalStorageUnavailable'
  }
}

function getDb(): Promise<IDBPDatabase<AfribokDb>> {
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') return Promise.reject(new LocalStorageUnavailable())
    dbPromise = openDB<AfribokDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('patients')) {
          const store = db.createObjectStore('patients', { keyPath: 'id' })
          store.createIndex('by-name', 'lastName')
        }
        if (!db.objectStoreNames.contains('encounters')) {
          const store = db.createObjectStore('encounters', { keyPath: 'id' })
          store.createIndex('by-patient', 'patientId')
          store.createIndex('by-status', 'status')
        }
        if (!db.objectStoreNames.contains('outbox')) {
          const store = db.createObjectStore('outbox', { keyPath: 'id' })
          store.createIndex('by-status', 'status')
          store.createIndex('by-created', 'createdAt')
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta')
        }
      },
      blocked() {
        console.warn('[afribok] local database upgrade blocked by another tab')
      },
    }).catch((error) => {
      dbPromise = null
      throw error
    })
  }
  return dbPromise
}

export async function listLocalPatients(): Promise<LocalPatient[]> {
  const db = await getDb()
  const rows = await db.getAll('patients')
  return rows.sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`),
  )
}

export async function getLocalPatient(id: string): Promise<LocalPatient | undefined> {
  return (await getDb()).get('patients', id)
}

export async function putLocalPatient(patient: LocalPatient): Promise<void> {
  await (await getDb()).put('patients', patient)
}

export async function deleteLocalPatient(id: string): Promise<void> {
  await (await getDb()).delete('patients', id)
}

export async function listLocalEncounters(): Promise<LocalEncounter[]> {
  const db = await getDb()
  const rows = await db.getAll('encounters')
  return rows.sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt))
}

export async function getLocalEncounter(id: string): Promise<LocalEncounter | undefined> {
  return (await getDb()).get('encounters', id)
}

export async function putLocalEncounter(encounter: LocalEncounter): Promise<void> {
  await (await getDb()).put('encounters', encounter)
}

export async function deleteLocalEncounter(id: string): Promise<void> {
  await (await getDb()).delete('encounters', id)
}

export async function saveRegistrationLocally(
  patient: LocalPatient,
  encounter: LocalEncounter,
  entry: OutboxEntry,
): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['patients', 'encounters', 'outbox'], 'readwrite')
  await Promise.all([
    tx.objectStore('patients').put(patient),
    tx.objectStore('encounters').put(encounter),
    tx.objectStore('outbox').put(entry),
  ])
  await tx.done
}

export async function saveEncounterLocally(
  encounter: LocalEncounter,
  entry: OutboxEntry,
): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['encounters', 'outbox'], 'readwrite')
  await Promise.all([
    tx.objectStore('encounters').put(encounter),
    tx.objectStore('outbox').put(entry),
  ])
  await tx.done
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  const db = await getDb()
  const rows = await db.getAll('outbox')
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function saveEncounterUpdateLocally(
  encounter: LocalEncounter,
  entry: OutboxEntry,
): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['encounters', 'outbox'], 'readwrite')
  await Promise.all([
    tx.objectStore('encounters').put(encounter),
    tx.objectStore('outbox').put(entry),
  ])
  await tx.done
}

export async function putOutbox(entry: OutboxEntry): Promise<void> {
  await (await getDb()).put('outbox', entry)
}

export async function deleteOutbox(id: string): Promise<void> {
  await (await getDb()).delete('outbox', id)
}

export async function resetStuckOperations(): Promise<void> {
  const db = await getDb()
  const stuck = await db.getAllFromIndex('outbox', 'by-status', 'syncing')
  const tx = db.transaction('outbox', 'readwrite')
  for (const entry of stuck) {
    await tx.store.put({ ...entry, status: 'pending' })
  }
  await tx.done
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await getDb()).get('meta', key) as Promise<T | undefined>
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await getDb()).put('meta', value, key)
}

export async function deleteMeta(key: string): Promise<void> {
  await (await getDb()).delete('meta', key)
}

export async function getDataOwnerId(): Promise<string | undefined> {
  return getMeta<string>('dataOwnerId')
}

export async function setDataOwnerId(userId: string): Promise<void> {
  await setMeta('dataOwnerId', userId)
}

export async function clearDataOwnerId(): Promise<void> {
  await deleteMeta('dataOwnerId')
}

export async function getSessionSnapshot(): Promise<SessionSnapshot | undefined> {
  return getMeta<SessionSnapshot>('session')
}

export async function saveSessionSnapshot(snapshot: SessionSnapshot): Promise<void> {
  await setMeta('session', snapshot)
}

export async function clearSessionSnapshot(): Promise<void> {
  await deleteMeta('session')
}

export async function getSyncLog(): Promise<SyncLogEntry[]> {
  return (await getMeta<SyncLogEntry[]>('syncLog')) ?? []
}

export async function addSyncLog(entry: SyncLogEntry): Promise<void> {
  const existing = await getSyncLog()
  await setMeta('syncLog', [entry, ...existing].slice(0, 20))
}

export async function getLastSyncAt(): Promise<string | null> {
  return (await getMeta<string>('lastSyncAt')) ?? null
}

export async function setLastSyncAt(value: string): Promise<void> {
  await setMeta('lastSyncAt', value)
}

/** Removes all clinical data, outbox entries and cached audit information. */
export async function clearClinicalData(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['patients', 'encounters', 'outbox', 'meta'], 'readwrite')
  await Promise.all([
    tx.objectStore('patients').clear(),
    tx.objectStore('encounters').clear(),
    tx.objectStore('outbox').clear(),
    tx.objectStore('meta').delete('auditCache'),
    tx.objectStore('meta').delete('lastSyncAt'),
    tx.objectStore('meta').delete('syncLog'),
    tx.objectStore('meta').delete('lastBootstrapAt'),
    tx.objectStore('meta').delete('session'),
  ])
  await tx.done
}
