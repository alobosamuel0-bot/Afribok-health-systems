import { randomUUID } from 'node:crypto'
import type { AfribokDb } from './db'

export interface AuditInput {
  facilityId: string
  actorId: string | null
  actorName: string
  action: string
  entityType: string
  entityId?: string | null
  detail?: Record<string, unknown> | null
  source?: 'server' | 'sync'
  eventTime?: string
}

/**
 * Audit rows intentionally hold identifiers and workflow facts, never names,
 * complaints, transcripts or other clinical narrative.
 */
export function recordAudit(db: AfribokDb, input: AuditInput): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO audit_events
      (id, facility_id, actor_id, actor_name, action, entity_type, entity_id, detail, source, event_time, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.facilityId,
    input.actorId,
    input.actorName,
    input.action,
    input.entityType,
    input.entityId ?? null,
    input.detail ? JSON.stringify(input.detail) : null,
    input.source ?? 'server',
    input.eventTime ?? now,
    now,
  )
}
