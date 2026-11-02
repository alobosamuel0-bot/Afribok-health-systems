import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Router, type Request, type Response } from 'express'
import type { AfribokDb } from './db'
import type { GeminiClient } from './gemini'
import { buildForecast } from './forecast'
import { recordAudit } from './audit'
import { requirePermission } from './auth'
import {
  canAccessEncounter,
  canAccessPatient,
  getEncounter,
  getPatient,
  listScopedEncounters,
  listScopedPatients,
  ServiceError,
} from './repository'
import type { Encounter, Patient, SessionUser } from '../shared/types'
import { canSeeAllDepartments } from '../shared/types'

function fail(message: string, status = 400, code = 'BAD_REQUEST'): never {
  throw new ServiceError(message, status, code)
}

function actorOf(req: Request): SessionUser {
  return req.afribokUser as SessionUser
}

function jsonError(error: unknown, res: Response): void {
  if (error instanceof ServiceError) {
    res.status(error.status).json({ error: error.message, code: error.code })
    return
  }
  console.error('[platform]', error)
  res.status(500).json({ error: 'The requested operation could not be completed.' })
}

function utcDayStart(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString()
}

interface OperationsSnapshot {
  todayRegistrations: number
  todayArrivals: number
  waiting: number
  inConsultation: number
  completedToday: number
  awaitingTriage: number
  urgent: number
  longestWaitMinutes: number
}

export function operationsSnapshot(db: AfribokDb, facilityId: string): OperationsSnapshot {
  const start = utcDayStart()
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM patients WHERE facility_id = ? AND created_at >= ?) AS today_registrations,
      (SELECT COUNT(*) FROM encounters WHERE facility_id = ? AND arrived_at >= ?) AS today_arrivals,
      (SELECT COUNT(*) FROM encounters WHERE facility_id = ? AND status = 'waiting') AS waiting,
      (SELECT COUNT(*) FROM encounters WHERE facility_id = ? AND status = 'in_consultation') AS in_consultation,
      (SELECT COUNT(*) FROM encounters WHERE facility_id = ? AND status = 'completed' AND updated_at >= ?) AS completed_today,
      (SELECT COUNT(*) FROM encounters WHERE facility_id = ? AND status = 'waiting' AND triage_level IS NULL) AS awaiting_triage,
      (SELECT COUNT(*) FROM encounters WHERE facility_id = ? AND status <> 'completed' AND triage_level <= 2) AS urgent
  `).get(
    facilityId, start, facilityId, start, facilityId, facilityId, facilityId, start, facilityId, facilityId,
  ) as {
    today_registrations: number; today_arrivals: number; waiting: number; in_consultation: number
    completed_today: number; awaiting_triage: number; urgent: number
  }
  const oldest = db.prepare(`
    SELECT MIN(arrived_at) AS oldest FROM encounters WHERE facility_id = ? AND status = 'waiting'
  `).get(facilityId) as { oldest: string | null }
  const wait = oldest.oldest ? Math.max(0, Math.round((Date.now() - new Date(oldest.oldest).getTime()) / 60_000)) : 0
  return {
    todayRegistrations: counts.today_registrations,
    todayArrivals: counts.today_arrivals,
    waiting: counts.waiting,
    inConsultation: counts.in_consultation,
    completedToday: counts.completed_today,
    awaitingTriage: counts.awaiting_triage,
    urgent: counts.urgent,
    longestWaitMinutes: wait,
  }
}

function scopedSnapshot(db: AfribokDb, user: SessionUser): OperationsSnapshot {
  const encounters = listScopedEncounters(db, user, 1000)
  const day = utcDayStart()
  const open = encounters.filter((encounter) => encounter.status !== 'completed')
  const waiting = open.filter((encounter) => encounter.status === 'waiting')
  const oldest = waiting.reduce(
    (max, encounter) => Math.max(max, (Date.now() - new Date(encounter.arrivedAt).getTime()) / 60000),
    0,
  )
  return {
    todayRegistrations: listScopedPatients(db, user).filter((patient) => patient.createdAt >= day).length,
    todayArrivals: encounters.filter((encounter) => encounter.arrivedAt >= day).length,
    waiting: waiting.length,
    inConsultation: open.filter((encounter) => encounter.status === 'in_consultation').length,
    completedToday: encounters.filter(
      (encounter) => encounter.status === 'completed' && encounter.updatedAt >= day,
    ).length,
    awaitingTriage: waiting.filter((encounter) => !encounter.triage).length,
    urgent: open.filter((encounter) => encounter.triage && encounter.triage.level <= 2).length,
    longestWaitMinutes: Math.round(oldest),
  }
}

/**
 * Permission-aware patient context. Retrieval happens before the model is
 * called; the model never receives a record the signed-in user cannot open.
 * Only approved notes are treated as clinical record.
 */
function patientContext(db: AfribokDb, user: SessionUser, patientId: string) {
  const patient = getPatient(db, user.facilityId, patientId)
  if (!patient || !canAccessPatient(db, user, patientId)) return null
  const encounters = listScopedEncounters(db, user, 400).filter(
    (encounter) => encounter.patientId === patientId,
  )
  const clinical = user.role !== 'registration'
  const approved = encounters.filter((encounter) => encounter.note && encounter.noteApprovedAt)
  return {
    patient: {
      hospitalNumber: patient.hospitalNumber,
      name: `${patient.firstName} ${patient.lastName}`,
      sex: patient.sex,
      dateOfBirth: patient.dateOfBirth,
      phone: patient.phone,
      address: patient.address,
      allergies: clinical ? patient.allergies : null,
      medicalHistory: clinical ? patient.medicalHistory : null,
      currentMedications: clinical ? patient.currentMedications : null,
    },
    visits: clinical
      ? encounters.slice(0, 8).map((encounter) => ({
          date: encounter.arrivedAt,
          department: encounter.departmentName,
          status: encounter.status,
          complaint: encounter.chiefComplaint,
          triage: encounter.triage
            ? {
                level: encounter.triage.level,
                label: encounter.triage.label,
                redFlags: encounter.triage.redFlags,
                assessedAt: encounter.triage.assessedAt,
              }
            : null,
          approvedNote: encounter.note && encounter.noteApprovedAt
            ? {
                subjective: encounter.note.subjective,
                objective: encounter.note.objective,
                assessment: encounter.note.assessment,
                plan: encounter.note.plan,
                followUp: encounter.note.followUp,
                approvedBy: encounter.noteApprovedBy,
                approvedAt: encounter.noteApprovedAt,
              }
            : null,
          draftNoteExcluded: Boolean(encounter.note && !encounter.noteApprovedAt),
        }))
      : [],
    approvedNoteCount: approved.length,
    clinical,
    scope: canSeeAllDepartments(user.role)
      ? 'facility-wide'
      : user.departmentName ?? 'no department assigned',
  }
}

function fallbackAnswer(
  intent: string,
  snapshot: OperationsSnapshot,
  forecast: ReturnType<typeof buildForecast> | undefined,
  context: ReturnType<typeof patientContext>,
): string {
  if (context) {
    const c = context
    const lines = [
      `${c.patient.name} (${c.patient.hospitalNumber}) · ${c.patient.sex}${c.patient.dateOfBirth ? ` · born ${c.patient.dateOfBirth}` : ''}.`,
    ]
    if (c.clinical) {
      lines.push(`Allergies: ${c.patient.allergies?.trim() || 'none recorded'}.`)
      lines.push(`Medical history: ${c.patient.medicalHistory?.trim() || 'none recorded'}.`)
      lines.push(`Current medications: ${c.patient.currentMedications?.trim() || 'none recorded'}.`)
      if (c.visits.length === 0) lines.push('No visit is recorded in your authorised scope.')
      else {
        const visit = c.visits[0]
        lines.push(`Latest visit: ${new Date(visit.date).toLocaleString()} · ${visit.department ?? 'no department'} · ${visit.status.replace('_', ' ')} · complaint: ${visit.complaint || 'not recorded'}.`)
        lines.push(visit.triage ? `Triage: level ${visit.triage.level} (${visit.triage.label}) with ${visit.triage.redFlags.length} red flag(s).` : 'No triage assessment recorded.')
        lines.push(visit.approvedNote ? `Approved note assessment: ${visit.approvedNote.assessment || 'not stated'}. Plan: ${visit.approvedNote.plan || 'not stated'}.` : visit.draftNoteExcluded ? 'A draft note exists but is not approved, so it is excluded.' : 'No approved clinical note recorded.')
      }
    } else {
      lines.push('Your registration role can see identity and visit status, not clinical history or notes.')
    }
    return lines.join(' ')
  }
  if (intent === 'queue') return `${snapshot.waiting} patient(s) are waiting in your authorised scope and ${snapshot.inConsultation} are in consultation. The longest wait is about ${snapshot.longestWaitMinutes} minute(s). This is an operational count, not a clinical priority decision.`
  if (intent === 'triage') return `${snapshot.awaitingTriage} waiting patient(s) have no triage assessment; ${snapshot.urgent} open visit(s) have urgency level 1 or 2. A clinician must review and set the priority.`
  if (intent === 'today') return `Today: ${snapshot.todayRegistrations} record(s) created, ${snapshot.todayArrivals} visit(s) arrived, ${snapshot.completedToday} completed. ${snapshot.inConsultation} patient(s) are being seen.`
  if (intent === 'forecast' && forecast) return `The forecast estimates ${forecast.days[0]?.expectedVisits ?? 0} visit(s) today and ${forecast.days[1]?.expectedVisits ?? 0} tomorrow. Confidence is ${forecast.history.confidence}; ${forecast.history.note}`
  if (intent === 'patient_data') return 'Select a patient from the patient picker above to ask about their patient record. I will not search patient records from a name in free text.'
  return 'I can answer operational questions about your queue, triage workload, today’s activity and forecasts, and patient-level questions for a patient you select and are authorised to open.'
}

function assistantIntent(message: string): 'queue' | 'triage' | 'today' | 'forecast' | 'patient_data' | 'unsupported' {
  const q = message.toLowerCase()
  if (/patient (?:record|history|name|number|id)|patient's|allerg|diagnos|history|record|prescri|medication|treatment|phone|hospital number/.test(q)) return 'patient_data'
  if (/forecast|predict|tomorrow|demand|expected/.test(q)) return 'forecast'
  if (/triage|urgent|urgency|untriaged/.test(q)) return 'triage'
  if (/register|arriv|today|attended|completed|consultation/.test(q)) return 'today'
  if (/wait|queue|longest|waiting/.test(q)) return 'queue'
  return 'unsupported'
}

export function staticAnswer(intent: string, s: OperationsSnapshot, forecast?: ReturnType<typeof buildForecast>): string {
  if (intent === 'queue') return `There are ${s.waiting} patient(s) waiting and ${s.inConsultation} in consultation. The longest current wait is about ${s.longestWaitMinutes} minute(s). This is a live operational count, not a clinical priority decision.`
  if (intent === 'triage') return `${s.awaitingTriage} waiting patient(s) have no recorded triage assessment; ${s.urgent} open visit(s) have an AI urgency level of 1 or 2. A clinician must review and set the operational priority.`
  if (intent === 'today') return `Today: ${s.todayRegistrations} new record(s) created, ${s.todayArrivals} visit(s) arrived, and ${s.completedToday} visit(s) completed. ${s.inConsultation} patient(s) are currently being seen.`
  if (intent === 'forecast' && forecast) return `The current forecast estimates ${forecast.days[0]?.expectedVisits ?? 0} visit(s) today and ${forecast.days[1]?.expectedVisits ?? 0} tomorrow. There are ${forecast.now.waiting} waiting now. Confidence is ${forecast.history.confidence}; ${forecast.history.note}`
  if (intent === 'patient_data') return 'For identifiable patient details, open the patient record and use the authorised clinical workflow. This Assistant currently answers aggregate operational questions only; it does not retrieve patient-level clinical data.'
  return 'I can answer operational questions about the current queue, triage workload, today’s activity, and the forecast. Try asking “How many are waiting?” or “What is the expected demand tomorrow?”'
}

export function createAssistantRouter({ db, gemini }: { db: AfribokDb; gemini: GeminiClient }): Router {
  const router = Router()
  router.get('/conversations', requirePermission('dashboard.read'), (req, res) => {
    const user = actorOf(req)
    const conversations = db.prepare(`
      SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
      FROM assistant_conversations WHERE facility_id = ? AND user_id = ?
      ORDER BY updated_at DESC LIMIT 30
    `).all(user.facilityId, user.id)
    res.json({ conversations })
  })
  router.get('/conversations/:id', requirePermission('dashboard.read'), (req, res) => {
    const user = actorOf(req)
    const conversation = db.prepare(`
      SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
      FROM assistant_conversations WHERE id = ? AND facility_id = ? AND user_id = ?
    `).get(String(req.params.id), user.facilityId, user.id)
    if (!conversation) return res.status(404).json({ error: 'Conversation not found.' })
    const messages = db.prepare(`
      SELECT id, role, content, created_at AS createdAt FROM assistant_messages
      WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 100
    `).all(String(req.params.id))
    res.json({ conversation, messages })
  })
  router.delete('/conversations/:id', requirePermission('dashboard.read'), (req, res) => {
    const user = actorOf(req)
    const result = db.prepare('DELETE FROM assistant_conversations WHERE id = ? AND facility_id = ? AND user_id = ?')
      .run(String(req.params.id), user.facilityId, user.id)
    if (result.changes === 0) return res.status(404).json({ error: 'Conversation not found.' })
    res.status(204).end()
  })
  router.post('/message', requirePermission('dashboard.read'), async (req, res) => {
    try {
      const user = actorOf(req)
      const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1200) : ''
      const patientId = typeof req.body?.patientId === 'string' ? req.body.patientId : ''
      if (message.length < 2) fail('Write an operational question first.')
      const context = patientId ? patientContext(db, user, patientId) : null
      if (patientId && !context) fail('That patient is not available in your authorised scope.', 404, 'NOT_FOUND')
      let id = typeof req.body?.conversationId === 'string' ? req.body.conversationId : ''
      let isNew = false
      if (id) {
        const owned = db.prepare('SELECT id FROM assistant_conversations WHERE id = ? AND facility_id = ? AND user_id = ?')
          .get(id, user.facilityId, user.id)
        if (!owned) fail('Conversation not found.', 404, 'NOT_FOUND')
      } else {
        id = randomUUID()
        isNew = true
        const now = new Date().toISOString()
        db.prepare('INSERT INTO assistant_conversations (id, facility_id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, user.facilityId, user.id, message.slice(0, 64), now, now)
      }
      const createdAt = new Date().toISOString()
      db.prepare('INSERT INTO assistant_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), id, 'user', message, createdAt)
      const intent = assistantIntent(message)
      const snapshot = scopedSnapshot(db, user)
      const forecast = intent === 'forecast' || context ? buildForecast(db, user.facilityId, { horizonHours: 48 }) : undefined
      let answer = fallbackAnswer(intent, snapshot, forecast, context)
      let usedAi = false
      if (gemini.configured && (context || intent !== 'unsupported')) {
        try {
          // Permission checks have already run. Only the authorised context below is
          // supplied; draft notes and other departments are excluded before this call.
          const completion = await gemini.generate({
            system: `You are Afribok’s clinical operations assistant for ${user.name} (${user.role}).
Rules:
- Answer only from the supplied context. If the context does not contain the answer, say so.
- Never invent patient details, findings, diagnoses, drug doses or numbers.
- Do not make an independent diagnosis or issue treatment. The attending clinician remains responsible.
- Draft notes are not part of the record; if marked excluded, do not infer their content.
- Keep the answer concise and state the authorised scope.`,
            temperature: 0.1,
            maxOutputTokens: 500,
            parts: [{
              text: JSON.stringify({
                question: message,
                category: intent,
                authorisedScope: context?.scope ?? (canSeeAllDepartments(user.role) ? 'facility-wide' : user.departmentName ?? 'no department'),
                patient: context,
                operations: context ? null : snapshot,
                forecast: forecast ? {
                  today: forecast.days[0]?.expectedVisits,
                  tomorrow: forecast.days[1]?.expectedVisits,
                  confidence: forecast.history.confidence,
                  dataNote: forecast.history.note,
                } : null,
              }),
            }],
          })
          if (completion.text.trim()) { answer = completion.text.trim().slice(0, 2200); usedAi = true }
        } catch {
          // Deterministic, database-derived answer remains available when AI is offline.
        }
      }
      const answeredAt = new Date().toISOString()
      db.prepare('INSERT INTO assistant_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), id, 'assistant', answer, answeredAt)
      db.prepare('UPDATE assistant_conversations SET updated_at = ? WHERE id = ? AND user_id = ?')
        .run(answeredAt, id, user.id)
      recordAudit(db, {
        facilityId: user.facilityId, actorId: user.id, actorName: user.name,
        action: patientId ? 'assistant.patient_query' : 'assistant.operational_query',
        entityType: 'assistant_conversation', entityId: id,
        detail: {
          category: intent,
          newConversation: isNew,
          ...(patientId ? { patientId } : {}),
          scope: canSeeAllDepartments(user.role) ? 'facility-wide' : user.departmentName ?? 'no department',
        },
      })
      res.json({
        conversationId: id,
        answer,
        createdAt: answeredAt,
        source: usedAi ? 'permission_aware_ai' : 'local_authorised_data',
        privacy: patientId
          ? 'Only the authorised record for the selected patient was supplied to the model; draft notes were excluded.'
          : 'Only aggregate operational counts within your department scope were supplied to the model. Patient-level records are not sent unless you select a patient.',
      })
    } catch (error) { jsonError(error, res) }
  })
  return router
}

interface EhrRow {
  facility_id: string; vendor: string; standard: string; endpoint_url: string
  read_enabled: number; write_enabled: number; approved_write_enabled: number
  auth_token_ciphertext: string | null
  status: string; last_test_at: string | null; last_error: string | null
  last_sync_at: string | null
  created_at: string; updated_at: string
}

function getEncryptionKey(): Buffer {
  const env = process.env.AFRIBOK_EHR_ENCRYPTION_KEY
  if (env && /^[0-9a-fA-F]{64}$/.test(env)) return Buffer.from(env, 'hex')
  const keyPath = resolve(process.env.AFRIBOK_EHR_KEY_FILE || './data/ehr-integration.key')
  if (existsSync(keyPath)) {
    const key = readFileSync(keyPath)
    if (key.length !== 32) throw new Error('EHR integration key file must contain 32 bytes.')
    return key
  }
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 })
  const key = randomBytes(32)
  writeFileSync(keyPath, key, { mode: 0o600, flag: 'wx' })
  chmodSync(keyPath, 0o600)
  return key
}

function encryptSecret(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`
}

function decryptSecret(value: string | null): string | null {
  if (!value) return null
  const [ivText, tagText, encryptedText] = value.split('.')
  if (!ivText || !tagText || !encryptedText) throw new Error('Stored EHR credential is not valid.')
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivText, 'base64'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64')), decipher.final()]).toString('utf8')
}

function publicEhr(row: EhrRow | undefined) {
  if (!row) return null
  return {
    vendor: row.vendor, standard: row.standard, endpointUrl: row.endpoint_url,
    readEnabled: row.read_enabled === 1, writeEnabled: row.write_enabled === 1,
    hasCredential: Boolean(row.auth_token_ciphertext), status: row.status,
    lastTestAt: row.last_test_at, lastError: row.last_error, lastSyncAt: row.last_sync_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
    capabilities: {
      metadataTest: true,
      patientRead: row.standard === 'FHIR_R4' && row.status === 'tested' && row.read_enabled === 1,
      approvedWriteBack: row.standard === 'FHIR_R4' && row.status === 'tested' && row.write_enabled === 1,
    },
  }
}

function validEndpoint(raw: string): URL {
  let url: URL
  try { url = new URL(raw) } catch { return fail('Enter a valid EHR endpoint URL.') }
  if (url.username || url.password || url.hash) fail('Endpoint URLs cannot contain credentials or fragments.')
  const localHost = url.hostname === 'localhost' || url.hostname.endsWith('.local') ||
    /^127\./.test(url.hostname) || /^10\./.test(url.hostname) || /^192\.168\./.test(url.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) {
    fail('Use HTTPS for remote EHR endpoints. HTTP is allowed only for a local hospital-network host.')
  }
  return url
}

function logEhrEvent(db: AfribokDb, user: SessionUser, action: string, success: boolean, detail: Record<string, unknown>) {
  db.prepare('INSERT INTO ehr_events (id, facility_id, actor_id, action, success, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), user.facilityId, user.id, action, success ? 1 : 0, JSON.stringify(detail), new Date().toISOString())
  recordAudit(db, {
    facilityId: user.facilityId, actorId: user.id, actorName: user.name,
    action: `ehr.${action}`, entityType: 'ehr_integration',
    detail: { success, ...detail },
  })
}

function requireTestedIntegration(
  db: AfribokDb,
  user: SessionUser,
  capability: 'read' | 'write',
): EhrRow {
  const row = db.prepare('SELECT * FROM ehr_integrations WHERE facility_id = ?').get(user.facilityId) as
    | EhrRow
    | undefined
  if (!row) fail('No EHR/EMR connector is configured for this hospital.', 404, 'EHR_NOT_CONFIGURED')
  if (row.status !== 'tested') fail('The connector must pass its endpoint test before data exchange is allowed.', 409, 'EHR_NOT_TESTED')
  if (row.standard !== 'FHIR_R4') fail('This operation requires the tested FHIR R4 connector.', 409, 'EHR_STANDARD_UNSUPPORTED')
  if (capability === 'read' && row.read_enabled !== 1) fail('Read access was not approved for this connector.', 403, 'EHR_READ_DISABLED')
  if (capability === 'write' && row.write_enabled !== 1) fail('Approved write-back was not enabled for this connector.', 403, 'EHR_WRITE_DISABLED')
  return row
}

async function fhirRequest(
  row: EhrRow,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const token = decryptSecret(row.auth_token_ciphertext)
  const base = row.endpoint_url.replace(/\/$/, '')
  const headers: Record<string, string> = {
    accept: 'application/fhir+json, application/json',
    ...(init.body ? { 'content-type': 'application/fhir+json' } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
  const response = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(15_000),
    redirect: 'manual',
  })
  if (response.status >= 300 && response.status < 400) {
    throw new ServiceError('The EHR endpoint redirected; redirects are blocked for credential safety.', 502, 'EHR_REDIRECT')
  }
  const text = await response.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { status: response.status, body }
}

function remotePatientFrom(resource: Record<string, unknown>): {
  firstName?: string
  lastName?: string
  otherNames?: string
  sex?: Patient['sex']
  dateOfBirth?: string
  phone?: string
  address?: string
  identifierValue?: string
} {
  const names = Array.isArray(resource.name) ? resource.name as Array<Record<string, unknown>> : []
  const name = names.find((item) => item.use === 'official') ?? names[0] ?? {}
  const given = Array.isArray(name.given) ? (name.given as string[]).filter(Boolean) : []
  const family = typeof name.family === 'string' ? name.family : ''
  const telecom = Array.isArray(resource.telecom) ? resource.telecom as Array<Record<string, unknown>> : []
  const phone = telecom.find((item) => item.system === 'phone' && typeof item.value === 'string')?.value as string | undefined
  const addresses = Array.isArray(resource.address) ? resource.address as Array<Record<string, unknown>> : []
  const address = addresses[0]
    ? [
        ...(Array.isArray(addresses[0].line) ? addresses[0].line as string[] : []),
        typeof addresses[0].city === 'string' ? addresses[0].city : '',
        typeof addresses[0].state === 'string' ? addresses[0].state : '',
      ].filter(Boolean).join(', ')
    : undefined
  const identifiers = Array.isArray(resource.identifier) ? resource.identifier as Array<Record<string, unknown>> : []
  const identifierValue = identifiers.find((item) => typeof item.value === 'string')?.value as string | undefined
  const gender = resource.gender
  const sex: Patient['sex'] | undefined = gender === 'female' || gender === 'male' || gender === 'other'
    ? gender : gender === 'unknown' ? 'unknown' : undefined
  return {
    firstName: given[0],
    lastName: family || given[given.length - 1],
    otherNames: given.slice(1).join(' ') || undefined,
    sex,
    dateOfBirth: typeof resource.birthDate === 'string' ? resource.birthDate.slice(0, 10) : undefined,
    phone,
    address: address || undefined,
    identifierValue,
  }
}

function approvedNoteText(encounter: Encounter): string {
  const note = encounter.note
  if (!note) return ''
  return [
    `Afribok clinical note — approved by ${encounter.noteApprovedBy ?? 'clinician'}`,
    `Visit: ${encounter.id} · ${encounter.arrivedAt} · ${encounter.departmentName ?? 'department not recorded'}`,
    `Presenting complaint: ${encounter.chiefComplaint || 'not recorded'}`,
    '', `Subjective: ${note.subjective || 'not documented'}`,
    `Objective: ${note.objective || 'not documented'}`,
    `Assessment: ${note.assessment || 'not documented'}`,
    `Plan: ${note.plan || 'not documented'}`,
    `Follow-up: ${note.followUp || 'not documented'}`,
  ].join('\n')
}

function saveEhrLink(
  db: AfribokDb,
  user: SessionUser,
  input: {
    patientId: string
    encounterId?: string | null
    resourceType: string
    resourceId: string
    direction: 'read' | 'write'
    status: 'synced' | 'failed' | 'conflict'
    detail?: Record<string, unknown>
  },
) {
  const now = new Date().toISOString()
  // Delete first rather than relying on an ON CONFLICT target. This keeps the
  // mapping idempotent across SQLite versions and always leaves one visible row.
  db.prepare('DELETE FROM ehr_links WHERE facility_id = ? AND resource_type = ? AND resource_id = ?')
    .run(user.facilityId, input.resourceType, input.resourceId)
  db.prepare(`INSERT INTO ehr_links
    (id, facility_id, patient_id, encounter_id, resource_type, resource_id, direction, status, detail, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      randomUUID(), user.facilityId, input.patientId, input.encounterId ?? null,
      input.resourceType, input.resourceId, input.direction, input.status,
      JSON.stringify(input.detail ?? {}), now, now,
    )
}

export function createEhrRouter({ db }: { db: AfribokDb }): Router {
  const router = Router()
  router.get('/integration', requirePermission('team.manage'), (req, res) => {
    const user = actorOf(req)
    const row = db.prepare('SELECT * FROM ehr_integrations WHERE facility_id = ?').get(user.facilityId) as EhrRow | undefined
    const rawEvents = db.prepare('SELECT action, success, detail, created_at AS createdAt FROM ehr_events WHERE facility_id = ? ORDER BY created_at DESC LIMIT 20')
      .all(user.facilityId) as Array<{ action: string; success: number; detail: string; createdAt: string }>
    const events = rawEvents.map((event) => ({ ...event, detail: JSON.parse(event.detail || '{}') as Record<string, unknown> }))
    res.json({ integration: publicEhr(row), events })
  })
  router.put('/integration', requirePermission('team.manage'), (req, res) => {
    try {
      const user = actorOf(req)
      const vendor = typeof req.body?.vendor === 'string' ? req.body.vendor.trim().slice(0, 120) : ''
      const standard = String(req.body?.standard ?? 'FHIR_R4')
      const endpointUrl = typeof req.body?.endpointUrl === 'string' ? req.body.endpointUrl.trim().slice(0, 1000) : ''
      const readEnabled = req.body?.readEnabled === true
      const writeEnabled = req.body?.writeEnabled === true
      const token = typeof req.body?.credential === 'string' ? req.body.credential.trim().slice(0, 2000) : ''
      if (!vendor) fail('Enter the EHR/EMR vendor or system name.')
      if (!['FHIR_R4', 'HL7_V2', 'REST'].includes(standard)) fail('Select FHIR R4, HL7 v2, or REST.')
      const endpoint = validEndpoint(endpointUrl)
      if (!endpointUrl) fail('Enter the approved endpoint URL.')
      if (writeEnabled && !readEnabled) fail('Enable approved read access before requesting write-back.')
      const now = new Date().toISOString()
      const existing = db.prepare('SELECT * FROM ehr_integrations WHERE facility_id = ?').get(user.facilityId) as EhrRow | undefined
      const credentialCipher = token ? encryptSecret(token) : existing?.auth_token_ciphertext ?? null
      db.prepare(`INSERT INTO ehr_integrations
        (facility_id, vendor, standard, endpoint_url, read_enabled, write_enabled, auth_token_ciphertext, status, last_test_at, last_error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'configured', NULL, NULL, ?, ?)
        ON CONFLICT(facility_id) DO UPDATE SET vendor=excluded.vendor, standard=excluded.standard,
        endpoint_url=excluded.endpoint_url, read_enabled=excluded.read_enabled, write_enabled=excluded.write_enabled,
        auth_token_ciphertext=excluded.auth_token_ciphertext, status='configured', last_test_at=NULL,
        last_error=NULL, updated_at=excluded.updated_at`)
        .run(user.facilityId, vendor, standard, endpoint.toString().replace(/\/$/, ''), readEnabled ? 1 : 0, writeEnabled ? 1 : 0, credentialCipher, now, now)
      logEhrEvent(db, user, 'configuration_saved', true, { standard, readRequested: readEnabled, writeRequested: writeEnabled, endpointHost: endpoint.host })
      const row = db.prepare('SELECT * FROM ehr_integrations WHERE facility_id = ?').get(user.facilityId) as EhrRow
      res.json({ integration: publicEhr(row), message: 'Configuration saved. Test the endpoint before treating the connector as active.' })
    } catch (error) { jsonError(error, res) }
  })
  router.post('/integration/test', requirePermission('team.manage'), async (req, res) => {
    const user = actorOf(req)
    const row = db.prepare('SELECT * FROM ehr_integrations WHERE facility_id = ?').get(user.facilityId) as EhrRow | undefined
    if (!row) return res.status(404).json({ error: 'Configure an EHR/EMR endpoint before testing it.' })
    let success = false
    let detail = ''
    try {
      const url = validEndpoint(row.endpoint_url)
      if (row.standard === 'HL7_V2') {
        detail = 'HL7 v2 is usually transported over MLLP through an approved interface engine; an HTTP-only test is not valid. This connector remains unverified.'
      } else {
        const token = decryptSecret(row.auth_token_ciphertext)
        const target = row.standard === 'FHIR_R4' ? new URL(`${url.toString().replace(/\/$/, '')}/metadata`) : url
        const headers: Record<string, string> = { accept: row.standard === 'FHIR_R4' ? 'application/fhir+json, application/json' : 'application/json' }
        if (token) headers.authorization = `Bearer ${token}`
        const response = await fetch(target, { method: 'GET', headers, signal: AbortSignal.timeout(10_000), redirect: 'manual' })
        if (response.status >= 300 && response.status < 400) throw new Error('Endpoint redirected; redirects are blocked for credential safety.')
        if (!response.ok) throw new Error(`Endpoint returned HTTP ${response.status}.`)
        if (row.standard === 'FHIR_R4') {
          const body = await response.json() as { resourceType?: string; fhirVersion?: string }
          if (!['CapabilityStatement', 'Conformance'].includes(body.resourceType ?? '')) throw new Error('The endpoint did not return a FHIR CapabilityStatement.')
          detail = `FHIR endpoint responded${body.fhirVersion ? ` (FHIR ${body.fhirVersion})` : ''}. This confirms metadata access only; patient read/write has not been validated.`
        } else detail = 'REST endpoint responded to an HTTP check. Resource access and data mapping remain unverified.'
        success = true
      }
    } catch (error) {
      detail = error instanceof Error ? error.message.slice(0, 300) : 'Connection test failed.'
    }
    const now = new Date().toISOString()
    db.prepare('UPDATE ehr_integrations SET status = ?, last_test_at = ?, last_error = ?, updated_at = ? WHERE facility_id = ?')
      .run(success ? 'tested' : 'error', now, success ? null : detail, now, user.facilityId)
    logEhrEvent(db, user, 'connection_test', success, { standard: row.standard, message: detail })
    const updated = db.prepare('SELECT * FROM ehr_integrations WHERE facility_id = ?').get(user.facilityId) as EhrRow
    res.json({ integration: publicEhr(updated), success, message: detail })
  })
  router.post('/integration/pause', requirePermission('team.manage'), (req, res) => {
    const user = actorOf(req)
    const row = db.prepare('SELECT * FROM ehr_integrations WHERE facility_id = ?').get(user.facilityId) as EhrRow | undefined
    if (!row) return res.status(404).json({ error: 'No EHR connector is configured.' })
    const now = new Date().toISOString()
    db.prepare("UPDATE ehr_integrations SET status = 'paused', updated_at = ? WHERE facility_id = ?").run(now, user.facilityId)
    logEhrEvent(db, user, 'connector_paused', true, { standard: row.standard })
    res.json({ integration: publicEhr(db.prepare('SELECT * FROM ehr_integrations WHERE facility_id = ?').get(user.facilityId) as EhrRow) })
  })
  router.post('/integration/resume', requirePermission('team.manage'), (req, res) => {
    const user = actorOf(req)
    const row = db.prepare('SELECT * FROM ehr_integrations WHERE facility_id = ?').get(user.facilityId) as EhrRow | undefined
    if (!row) return res.status(404).json({ error: 'No EHR connector is configured.' })
    const now = new Date().toISOString()
    const status = row.last_test_at ? 'tested' : 'configured'
    db.prepare('UPDATE ehr_integrations SET status = ?, last_error = NULL, updated_at = ? WHERE facility_id = ?')
      .run(status, now, user.facilityId)
    logEhrEvent(db, user, 'connector_resumed', true, { standard: row.standard })
    res.json({ integration: publicEhr(db.prepare('SELECT * FROM ehr_integrations WHERE facility_id = ?').get(user.facilityId) as EhrRow) })
  })
  router.delete('/integration', requirePermission('team.manage'), (req, res) => {
    const user = actorOf(req)
    const row = db.prepare('SELECT * FROM ehr_integrations WHERE facility_id = ?').get(user.facilityId) as EhrRow | undefined
    if (!row) return res.status(404).json({ error: 'No EHR connector is configured.' })
    db.prepare('DELETE FROM ehr_integrations WHERE facility_id = ?').run(user.facilityId)
    logEhrEvent(db, user, 'connector_disconnected', true, { vendor: row.vendor, mappedLinksKept: true })
    res.status(204).end()
  })
  router.get('/sync', requirePermission('team.manage'), (req, res) => {
    const user = actorOf(req)
    const links = db.prepare(`SELECT id, patient_id AS patientId, encounter_id AS encounterId,
      resource_type AS resourceType, resource_id AS resourceId, direction, status, detail,
      created_at AS createdAt, updated_at AS updatedAt FROM ehr_links
      WHERE facility_id = ? ORDER BY updated_at DESC LIMIT 50`).all(user.facilityId) as Array<Record<string, unknown>>
    const events = db.prepare('SELECT action, success, detail, created_at AS createdAt FROM ehr_events WHERE facility_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(user.facilityId) as Array<{ action: string; success: number; detail: string; createdAt: string }>
    res.json({
      links: links.map((link) => ({ ...link, detail: JSON.parse(String(link.detail ?? '{}')) })),
      events: events.map((event) => ({ ...event, detail: JSON.parse(event.detail || '{}') })),
      pending: links.filter((link) => link.status !== 'synced').length,
      failed: links.filter((link) => link.status === 'failed').length,
      conflicts: links.filter((link) => link.status === 'conflict').length,
    })
  })
  router.post('/patients/:id/pull', requirePermission('patient.read'), async (req, res) => {
    try {
      const user = actorOf(req)
      const patient = getPatient(db, user.facilityId, String(req.params.id))
      if (!patient || !canAccessPatient(db, user, patient.id)) return res.status(404).json({ error: 'Patient not found in your authorised scope.' })
      const row = requireTestedIntegration(db, user, 'read')
      const result = await fhirRequest(row, `/Patient?identifier=${encodeURIComponent(patient.identifierValue || patient.hospitalNumber)}`)
      if (result.status !== 200) fail(`The external EHR returned HTTP ${result.status} for this patient.`, 502, 'EHR_READ_FAILED')
      const bundle = result.body as { entry?: Array<{ resource?: Record<string, unknown> }> } | null
      const remote = bundle?.entry?.map((entry) => entry.resource).find((resource) => resource?.resourceType === 'Patient') as Record<string, unknown> | undefined
      if (!remote) fail('No matching patient was found in the external EHR. Nothing was changed.', 404, 'EHR_PATIENT_NOT_FOUND')
      const mapped = remotePatientFrom(remote)
      const changes: Record<string, string> = {}
      const next = {
        firstName: mapped.firstName || patient.firstName,
        lastName: mapped.lastName || patient.lastName,
        otherNames: mapped.otherNames ?? patient.otherNames,
        sex: mapped.sex ?? patient.sex,
        dateOfBirth: mapped.dateOfBirth ?? patient.dateOfBirth,
        phone: mapped.phone ?? patient.phone,
        address: mapped.address ?? patient.address,
        identifierValue: mapped.identifierValue ?? patient.identifierValue,
      }
      for (const key of Object.keys(next) as Array<keyof typeof next>) {
        if (String(next[key] ?? '') !== String(patient[key] ?? '')) changes[key] = String(next[key] ?? '')
      }
      const updated = db.prepare(`UPDATE patients SET first_name = ?, last_name = ?, other_names = ?, sex = ?, date_of_birth = ?,
        phone = ?, address = ?, identifier_value = ?, identifier_type = COALESCE(identifier_type, 'External EHR identifier'),
        version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ?`)
        .run(next.firstName, next.lastName, next.otherNames, next.sex, next.dateOfBirth, next.phone, next.address,
          next.identifierValue, new Date().toISOString(), patient.id, user.facilityId)
      if (updated.changes !== 1) fail('The external patient record could not be written to this patient. Nothing was saved.', 500, 'EHR_WRITE_FAILED')
      saveEhrLink(db, user, {
        patientId: patient.id, encounterId: null, resourceType: 'Patient',
        resourceId: String(remote.id ?? patient.hospitalNumber), direction: 'read', status: 'synced',
        detail: { vendor: row.vendor, changes: Object.keys(changes) },
      })
      db.prepare('UPDATE ehr_integrations SET last_sync_at = ?, updated_at = ? WHERE facility_id = ?')
        .run(new Date().toISOString(), new Date().toISOString(), user.facilityId)
      recordAudit(db, {
        facilityId: user.facilityId, actorId: user.id, actorName: user.name,
        action: 'ehr.patient_read', entityType: 'patient', entityId: patient.id,
        detail: { vendor: row.vendor, changedFields: Object.keys(changes) },
      })
      logEhrEvent(db, user, 'patient_read', true, { patientId: patient.id, changedFields: Object.keys(changes) })
      res.json({ patient: getPatient(db, user.facilityId, patient.id), changes, remoteResourceId: remote.id })
    } catch (error) { jsonError(error, res) }
  })
  router.post('/encounters/:id/push-note', requirePermission('encounter.update'), async (req, res) => {
    try {
      const user = actorOf(req)
      if (user.role !== 'clinician' && user.role !== 'admin') {
        return res.status(403).json({ error: 'Only a clinician or administrator can approve and send a clinical note.' })
      }
      const encounter = getEncounter(db, user.facilityId, String(req.params.id))
      if (!encounter || !canAccessEncounter(user, encounter)) return res.status(404).json({ error: 'Visit not found in your authorised scope.' })
      if (!encounter.note || !encounter.noteApprovedAt) {
        return res.status(409).json({ error: 'The clinical note must be drafted and approved before it can be written to an external EHR.' })
      }
      const existing = db.prepare("SELECT * FROM ehr_links WHERE facility_id = ? AND resource_type = 'DocumentReference' AND resource_id = ?")
        .get(user.facilityId, encounter.id) as { status: string; detail: string } | undefined
      if (existing?.status === 'synced') {
        return res.json({ alreadySynced: true, message: 'This approved note was already written to the external EHR; no duplicate was sent.' })
      }
      const row = requireTestedIntegration(db, user, 'write')
      const patient = getPatient(db, user.facilityId, encounter.patientId)
      if (!patient) return res.status(404).json({ error: 'Patient not found.' })
      const lookup = await fhirRequest(row, `/Patient?identifier=${encodeURIComponent(patient.identifierValue || patient.hospitalNumber)}`)
      const bundle = lookup.body as { entry?: Array<{ resource?: Record<string, unknown> }> } | null
      const remotePatient = bundle?.entry?.map((entry) => entry.resource).find((resource) => resource?.resourceType === 'Patient') as Record<string, unknown> | undefined
      if (!remotePatient?.id) {
        return res.status(409).json({ error: 'This patient is not mapped in the external EHR. Pull or register the patient there before writing a note.' })
      }
      const document = {
        resourceType: 'DocumentReference',
        status: 'current',
        description: 'Afribok approved clinical note',
        identifier: [{ system: 'urn:afribok:encounter', value: encounter.id }],
        subject: { reference: `Patient/${remotePatient.id}` },
        date: encounter.note.generatedAt,
        author: [{ display: encounter.noteApprovedBy ?? user.name }],
        content: [{ attachment: {
          contentType: 'text/plain',
          title: 'Approved clinical note',
          data: Buffer.from(approvedNoteText(encounter), 'utf8').toString('base64'),
        } }],
      }
      const written = await fhirRequest(row, '/DocumentReference', { method: 'POST', body: document })
      if (written.status === 409 || written.status === 412) {
        saveEhrLink(db, user, { patientId: patient.id, encounterId: encounter.id, resourceType: 'DocumentReference', resourceId: encounter.id, direction: 'write', status: 'conflict', detail: { httpStatus: written.status } })
        logEhrEvent(db, user, 'note_write_conflict', false, { encounterId: encounter.id, httpStatus: written.status })
        return res.status(409).json({ error: 'The external EHR reported a conflict. The note was not overwritten; review both records.' })
      }
      if (written.status < 200 || written.status >= 300) {
        saveEhrLink(db, user, { patientId: patient.id, encounterId: encounter.id, resourceType: 'DocumentReference', resourceId: encounter.id, direction: 'write', status: 'failed', detail: { httpStatus: written.status } })
        logEhrEvent(db, user, 'note_write_failed', false, { encounterId: encounter.id, httpStatus: written.status })
        return res.status(502).json({ error: `The external EHR rejected the note (HTTP ${written.status}). Nothing is marked as written.` })
      }
      const remoteId = (written.body as { id?: string } | null)?.id ?? encounter.id
      saveEhrLink(db, user, { patientId: patient.id, encounterId: encounter.id, resourceType: 'DocumentReference', resourceId: encounter.id, direction: 'write', status: 'synced', detail: { remoteId, httpStatus: written.status } })
      db.prepare('UPDATE ehr_integrations SET last_sync_at = ?, updated_at = ? WHERE facility_id = ?')
        .run(new Date().toISOString(), new Date().toISOString(), user.facilityId)
      recordAudit(db, { facilityId: user.facilityId, actorId: user.id, actorName: user.name, action: 'ehr.note_written', entityType: 'encounter', entityId: encounter.id, detail: { remoteId, approvedBy: encounter.noteApprovedBy } })
      logEhrEvent(db, user, 'note_written', true, { encounterId: encounter.id, remoteId })
      res.json({ synced: true, remoteId, message: 'The approved note was written to the external EHR as a DocumentReference.' })
    } catch (error) { jsonError(error, res) }
  })
  return router
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1 }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"' && cell.length === 0) quoted = true
    else if (char === ',') { row.push(cell.trim()); cell = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell.trim()); cell = ''
      if (row.some((item) => item.length > 0)) rows.push(row)
      row = []
    } else cell += char
  }
  row.push(cell.trim())
  if (row.some((item) => item.length > 0)) rows.push(row)
  if (quoted) fail('The CSV ends inside a quoted field.')
  return rows
}

function toIsoDate(value: string): string | null {
  const v = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const date = new Date(`${v}T00:00:00Z`)
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== v ? null : v
  }
  const uk = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (uk) {
    const month = Number(uk[2]), day = Number(uk[1]), year = Number(uk[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
    return date.toISOString().slice(0, 10)
  }
  return null
}

function aggregateInteger(value: string | undefined, label: string, required = false): number {
  if (!value && !required) return 0
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0 || number > 1_000_000) fail(`Invalid ${label} value in the operational CSV.`)
  return number
}

export function createHistoryRouter({ db }: { db: AfribokDb }): Router {
  const router = Router()
  router.get('/', requirePermission('dashboard.read'), (req, res) => {
    const user = actorOf(req)
    const imports = db.prepare(`SELECT id, file_name AS fileName, row_count AS rowCount, skipped_count AS skippedCount, created_at AS createdAt
      FROM history_imports WHERE facility_id = ? ORDER BY created_at DESC LIMIT 20`).all(user.facilityId)
    const metrics = db.prepare(`SELECT metric_date AS date, department, SUM(arrivals) AS arrivals, SUM(triaged) AS triaged,
      SUM(completed) AS completed, SUM(waiting) AS waiting FROM historical_metrics WHERE facility_id = ?
      GROUP BY metric_date, department ORDER BY metric_date DESC LIMIT 180`).all(user.facilityId)
    const quality = db.prepare(`SELECT COUNT(*) AS days, COALESCE(SUM(arrivals),0) AS arrivals,
      MIN(metric_date) AS fromDate, MAX(metric_date) AS toDate FROM historical_metrics WHERE facility_id = ?`).get(user.facilityId)
    res.json({ imports, metrics, quality })
  })
  router.post('/import', requirePermission('team.manage'), (req, res) => {
    try {
      const user = actorOf(req)
      const text = typeof req.body?.csv === 'string' ? req.body.csv : ''
      const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName.replace(/[\\/\0]/g, '').slice(0, 120) : 'operational-history.csv'
      if (!text.trim()) fail('Select a CSV containing aggregate operational data.')
      if (Buffer.byteLength(text, 'utf8') > 450_000) fail('CSV must be smaller than 450 KB for this import route.', 413, 'TOO_LARGE')
      const rows = parseCsv(text)
      if (rows.length < 2) fail('Include a header row and at least one data row.')
      if (rows.length > 10_001) fail('Import at most 10,000 aggregate rows at a time.', 413, 'TOO_MANY_ROWS')
      const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'))
      if (headers.some((h) => /patient|name|phone|identifier|diagnos|complaint|address|birth/.test(h))) {
        fail('This importer accepts aggregate operational data only. Remove all patient-identifying or clinical columns before uploading.')
      }
      const dateIndex = headers.indexOf('date')
      const arrivalsIndex = headers.indexOf('arrivals')
      if (dateIndex < 0 || arrivalsIndex < 0) fail('CSV needs at least these columns: date, arrivals. Optional: department, triaged, completed, waiting.')
      const deptIndex = headers.indexOf('department'), triagedIndex = headers.indexOf('triaged')
      const completedIndex = headers.indexOf('completed'), waitingIndex = headers.indexOf('waiting')
      const now = new Date().toISOString()
      const importId = randomUUID()
      let imported = 0, skipped = 0
      const parsed: Array<{ id: string; department: string; date: string; arrivals: number; triaged: number; completed: number; waiting: number }> = []
      for (const row of rows.slice(1)) {
        if (row.length !== headers.length) { skipped += 1; continue }
        const date = toIsoDate(row[dateIndex] ?? '')
        if (!date) { skipped += 1; continue }
        try {
          const department = (deptIndex >= 0 ? row[deptIndex] : '')?.trim().slice(0, 100) || 'All departments'
          parsed.push({
            id: randomUUID(), department, date,
            arrivals: aggregateInteger(row[arrivalsIndex], 'arrivals', true),
            triaged: aggregateInteger(triagedIndex >= 0 ? row[triagedIndex] : undefined, 'triaged'),
            completed: aggregateInteger(completedIndex >= 0 ? row[completedIndex] : undefined, 'completed'),
            waiting: aggregateInteger(waitingIndex >= 0 ? row[waitingIndex] : undefined, 'waiting'),
          })
        } catch { skipped += 1 }
      }
      if (parsed.length === 0) fail('No valid aggregate rows were found; nothing was imported.')
      db.transaction(() => {
        db.prepare('INSERT INTO history_imports (id, facility_id, uploaded_by, file_name, row_count, skipped_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(importId, user.facilityId, user.id, fileName || 'operational-history.csv', parsed.length, skipped, now)
        const insert = db.prepare(`INSERT INTO historical_metrics (id, facility_id, import_id, department, metric_date, arrivals, triaged, completed, waiting, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(facility_id, department, metric_date) DO UPDATE SET
          import_id=excluded.import_id, arrivals=excluded.arrivals, triaged=excluded.triaged,
          completed=excluded.completed, waiting=excluded.waiting, created_at=excluded.created_at`)
        for (const item of parsed) {
          insert.run(item.id, user.facilityId, importId, item.department, item.date, item.arrivals, item.triaged, item.completed, item.waiting, now)
          imported += 1
        }
        recordAudit(db, { facilityId: user.facilityId, actorId: user.id, actorName: user.name,
          action: 'history.aggregate_imported', entityType: 'history_import', entityId: importId,
          detail: { rows: imported, skipped, fileName } })
      })()
      res.status(201).json({ importId, importedRows: imported, skippedRows: skipped, note: 'Aggregate operational data only; no patient-level records were imported.' })
    } catch (error) { jsonError(error, res) }
  })
  return router
}
