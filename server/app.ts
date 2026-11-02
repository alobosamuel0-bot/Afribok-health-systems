import express, { type NextFunction, type Request, type Response } from 'express'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AfribokDb } from './db'
import {
  authenticate,
  clearCookieOptions,
  createSession,
  deleteSession,
  findUserByEmail,
  hashPassword,
  hashToken,
  publicUser,
  requirePermission,
  sessionCookieOptions,
  verifyPassword,
} from './auth'
import { BUILD_STAGE, COOKIE_NAME, FACILITY, SESSION_HOURS } from './config'
import { seedFacility } from './seed'
import { GeminiClient } from './gemini'
import { createAiRouter } from './ai'
import { createAssistantRouter, createEhrRouter, createHistoryRouter } from './platform'
import { buildForecast } from './forecast'
import { countActiveStaff, getCapacity, saveCapacity } from './repository'
import {
  completeSetup,
  createDepartment,
  deleteDepartment,
  facilityView,
  getProfile,
  listDepartments,
  updateDepartment,
  updateProfile,
} from './setup'
import { recordAudit } from './audit'
import {
  applySyncOperations,
  approveNote,
  assignEncounter,
  buildPerformanceReport,
  canAccessEncounter,
  canAccessPatient,
  getEncounter,
  getPatient,
  listAuditEvents,
  listScopedEncounters,
  listScopedPatients,
  listTeam,
  ServiceError,
  updateTeamMember,
} from './repository'
import {
  assignmentSchema,
  auditQuerySchema,
  capacitySchema,
  createAccountSchema,
  departmentCreateSchema,
  departmentUpdateSchema,
  forecastQuerySchema,
  formatZodError,
  loginSchema,
  noteApprovalSchema,
  setupPatchSchema,
  syncRequestSchema,
  teamCreateSchema,
  teamPatchSchema,
} from './validation'
import type { SessionUser, SyncOperationInput } from '../shared/types'

export interface AppOptions {
  db: AfribokDb
  seed?: boolean
  serveFrontend?: boolean
  ai?: GeminiClient
}

interface Attempt {
  count: number
  resetAt: number
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 12
const SIGNUP_WINDOW_MS = 60 * 60 * 1000
const SIGNUP_MAX_PER_WINDOW = 8

export function createApp({ db, seed = true, serveFrontend = true, ai }: AppOptions) {
  if (seed) seedFacility(db)
  const gemini = ai ?? new GeminiClient()

  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  const loginAttempts = new Map<string, Attempt>()
  const signupAttempts = new Map<string, Attempt>()

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()')
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    )
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store')
    next()
  })

  app.use(cookieParser())
  const smallJson = express.json({ limit: '512kb' })
  app.use((req, res, next) => (req.path.startsWith('/api/ai/') ? next() : smallJson(req, res, next)))

  app.use((req, res, next) => {
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next()
    const origin = req.get('origin')
    if (!origin) return next()
    try {
      const parsed = new URL(origin)
      const host = req.get('host')
      const allowed = new Set(
        (process.env.ALLOWED_ORIGINS || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      )
      if (parsed.host !== host && !allowed.has(origin)) {
        res.status(403).json({ error: 'Request origin is not allowed.' })
        return
      }
    } catch {
      res.status(403).json({ error: 'Invalid request origin.' })
      return
    }
    next()
  })

  const auth = authenticate(db)

  // AI routes carry photographs and recordings, so they parse their own larger
  // JSON bodies. They must be mounted after `auth`: every handler needs the
  // signed-in user for its permission check.
  app.use('/api/ai', auth, createAiRouter({ db, gemini }))
  app.use('/api/assistant', auth, createAssistantRouter({ db, gemini }))
  app.use('/api/ehr', auth, createEhrRouter({ db }))
  app.use('/api/history', auth, createHistoryRouter({ db }))

  app.get('/api/health', (_req, res) => {
    const check = db.prepare('SELECT 1 AS ok').get() as { ok: number }
    res.json({
      status: check.ok === 1 ? 'ok' : 'degraded',
      stage: BUILD_STAGE,
      facility: facilityView(db, FACILITY.id).name,
      mode: FACILITY.mode,
      ai: gemini.describe(),
      time: new Date().toISOString(),
    })
  })

  app.post('/api/auth/login', (req, res) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Enter a valid clinic email and password.' })
      return
    }
    const email = parsed.data.email
    const key = `${req.ip}|${email}`
    const now = Date.now()
    const attempt = loginAttempts.get(key)
    if (attempt && attempt.resetAt > now && attempt.count >= LOGIN_MAX_ATTEMPTS) {
      const minutes = Math.ceil((attempt.resetAt - now) / 60000)
      res.status(429).json({ error: `Too many attempts. Try again in ${minutes} minute(s).` })
      return
    }

    const user = findUserByEmail(db, email)
    const valid = user && user.active === 1 && verifyPassword(parsed.data.password, user.password_salt, user.password_hash)
    if (!user || !valid) {
      const current = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + LOGIN_WINDOW_MS }
      current.count += 1
      loginAttempts.set(key, current)
      if (loginAttempts.size > 5000) loginAttempts.clear()
      recordAudit(db, {
        facilityId: FACILITY.id,
        actorId: null,
        actorName: 'Unauthenticated',
        action: 'auth.sign_in_failed',
        entityType: 'session',
        detail: { reason: 'invalid_credentials' },
      })
      res.status(401).json({ error: 'Email or password is incorrect.' })
      return
    }

    loginAttempts.delete(key)
    const session = createSession(db, user.id)
    db.prepare('UPDATE users SET last_sign_in_at = ? WHERE id = ?').run(new Date().toISOString(), user.id)
    recordAudit(db, {
      facilityId: user.facility_id,
      actorId: user.id,
      actorName: user.name,
      action: 'auth.signed_in',
      entityType: 'session',
      detail: { role: user.role },
    })
    const facility = facilityView(db, user.facility_id)
    res.cookie(COOKIE_NAME, session.token, sessionCookieOptions(session.expiresAt))
    res.json({
      user: publicUser(user, facility.name),
      facility,
      expiresAt: session.expiresAt,
      sessionHours: SESSION_HOURS,
    })
  })

  app.post('/api/auth/register', (req, res) => {
    const parsed = createAccountSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) })
      return
    }

    const now = Date.now()
    const ip = req.ip || 'unknown'
    const attempt = signupAttempts.get(ip)
    if (attempt && attempt.resetAt > now && attempt.count >= SIGNUP_MAX_PER_WINDOW) {
      const minutes = Math.ceil((attempt.resetAt - now) / 60000)
      res
        .status(429)
        .json({ error: `Too many accounts created from this network. Try again in ${minutes} minute(s).` })
      return
    }

    if (findUserByEmail(db, parsed.data.email)) {
      res.status(409).json({
        error: 'An account already exists for this email. Sign in instead.',
        code: 'EMAIL_TAKEN',
      })
      return
    }

    const id = randomUUID()
    const createdAt = new Date().toISOString()
    const { salt, hash } = hashPassword(parsed.data.password)
    // The first account on a real deployment is the hospital administrator and
    // must complete onboarding. Later self-service accounts keep the public
    // role choices and are promoted by an existing administrator.
    const existingUsers = (
      db.prepare('SELECT COUNT(*) AS count FROM users WHERE facility_id = ?').get(FACILITY.id) as {
        count: number
      }
    ).count
    const role = existingUsers === 0 ? 'admin' : parsed.data.role
    db.prepare(
      `INSERT INTO users
        (id, facility_id, name, email, role, password_salt, password_hash, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(id, FACILITY.id, parsed.data.name, parsed.data.email, role, salt, hash, createdAt)

    const user = findUserByEmail(db, parsed.data.email)
    if (!user) {
      res.status(500).json({ error: 'The account could not be saved. Nothing was changed.' })
      return
    }

    const current = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + SIGNUP_WINDOW_MS }
    current.count += 1
    signupAttempts.set(ip, current)
    if (signupAttempts.size > 5000) signupAttempts.clear()

    const session = createSession(db, user.id)
    db.prepare('UPDATE users SET last_sign_in_at = ? WHERE id = ?').run(createdAt, user.id)
    recordAudit(db, {
      facilityId: user.facility_id,
      actorId: user.id,
      actorName: user.name,
      action: 'auth.account_created',
      entityType: 'user',
      entityId: user.id,
      detail: { role: user.role, firstAccount: existingUsers === 0 },
    })
    const facility = facilityView(db, user.facility_id)
    res.cookie(COOKIE_NAME, session.token, sessionCookieOptions(session.expiresAt))
    res.status(201).json({
      user: publicUser(user, facility.name),
      facility,
      expiresAt: session.expiresAt,
      sessionHours: SESSION_HOURS,
    })
  })

  app.post('/api/auth/logout', (req, res) => {
    const token = req.cookies?.[COOKIE_NAME] as string | undefined
    if (token) {
      const tokenHash = hashToken(token)
      const session = db
        .prepare(
          `SELECT u.id, u.name, u.facility_id FROM sessions s
           JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
        )
        .get(tokenHash) as { id: string; name: string; facility_id: string } | undefined
      deleteSession(db, tokenHash)
      if (session) {
        recordAudit(db, {
          facilityId: session.facility_id,
          actorId: session.id,
          actorName: session.name,
          action: 'auth.signed_out',
          entityType: 'session',
        })
      }
    }
    res.clearCookie(COOKIE_NAME, clearCookieOptions())
    res.status(204).end()
  })

  app.get('/api/me', auth, (req, res) => {
    const user = req.afribokUser as SessionUser
    res.json({ user, facility: facilityView(db, user.facilityId) })
  })

  app.get('/api/bootstrap', auth, requirePermission('patient.read'), (req, res) => {
    const user = req.afribokUser as SessionUser
    res.json({
      user,
      facility: facilityView(db, user.facilityId),
      departments: listDepartments(db, user.facilityId),
      patients: listScopedPatients(db, user),
      encounters: listScopedEncounters(db, user, 400),
      serverTime: new Date().toISOString(),
    })
  })

  app.get('/api/patients', auth, requirePermission('patient.read'), (req, res) => {
    const user = req.afribokUser as SessionUser
    const query = String(req.query.q ?? '').trim().slice(0, 80).toLowerCase()
    const patients = listScopedPatients(db, user)
    if (!query) {
      res.json({ patients: patients.slice(0, 50) })
      return
    }
    const compact = query.replace(/\s/g, '')
    res.json({
      patients: patients
        .filter((patient) =>
          `${patient.firstName} ${patient.lastName}`.toLowerCase().includes(query) ||
          patient.hospitalNumber.toLowerCase().includes(query) ||
          (patient.phone ?? '').replace(/\s/g, '').includes(compact),
        )
        .slice(0, 50),
    })
  })

  app.get('/api/patients/:id', auth, requirePermission('patient.read'), (req, res) => {
    const user = req.afribokUser as SessionUser
    const patient = getPatient(db, user.facilityId, String(req.params.id))
    if (!patient || !canAccessPatient(db, user, patient.id)) {
      res.status(404).json({ error: 'Patient not found.' })
      return
    }
    const encounters = listScopedEncounters(db, user, 400).filter(
      (encounter) => encounter.patientId === patient.id,
    )
    res.json({ patient, encounters })
  })

  app.get('/api/encounters', auth, requirePermission('encounter.read'), (req, res) => {
    const user = req.afribokUser as SessionUser
    const status = typeof req.query.status === 'string' ? req.query.status : null
    const encounters = listScopedEncounters(db, user, 400).filter(
      (encounter) => !status || encounter.status === status,
    )
    res.json({ encounters })
  })

  app.get('/api/encounters/:id', auth, requirePermission('encounter.read'), (req, res) => {
    const user = req.afribokUser as SessionUser
    const encounter = getEncounter(db, user.facilityId, String(req.params.id))
    if (!encounter || !canAccessEncounter(user, encounter)) {
      res.status(404).json({ error: 'Encounter not found.' })
      return
    }
    res.json({ encounter })
  })

  app.post('/api/sync', auth, (req, res) => {
    const parsed = syncRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) })
      return
    }
    const user = req.afribokUser as SessionUser
    const results = applySyncOperations(
      db,
      user,
      parsed.data.operations as SyncOperationInput[],
    )
    res.json({ results, serverTime: new Date().toISOString() })
  })

  app.get('/api/forecast', auth, requirePermission('dashboard.read'), (req, res) => {
    const parsed = forecastQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) })
      return
    }
    const user = req.afribokUser as SessionUser
    const capacity = getCapacity(db, user.facilityId)
    const staffOnDuty = Math.max(
      capacity.clinicians,
      countActiveStaff(db, user.facilityId, 'clinician') + countActiveStaff(db, user.facilityId, 'nurse') > 0
        ? countActiveStaff(db, user.facilityId, 'clinician') + countActiveStaff(db, user.facilityId, 'nurse')
        : capacity.clinicians,
    )
    res.json({
      forecast: buildForecast(db, user.facilityId, {
        historyDays: parsed.data.historyDays,
        horizonHours: parsed.data.horizonHours,
        capacity,
        staffOnDuty,
      }),
      capacity,
    })
  })

  app.get('/api/capacity', auth, requirePermission('dashboard.read'), (req, res) => {
    const user = req.afribokUser as SessionUser
    res.json({ capacity: getCapacity(db, user.facilityId) })
  })

  app.put('/api/capacity', auth, requirePermission('team.manage'), (req, res) => {
    const parsed = capacitySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) })
      return
    }
    const user = req.afribokUser as SessionUser
    res.json({ capacity: saveCapacity(db, user, parsed.data) })
  })

  app.get('/api/audit', auth, requirePermission('audit.read'), (req, res) => {
    const parsed = auditQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) })
      return
    }
    const user = req.afribokUser as SessionUser
    res.json({ events: listAuditEvents(db, user.facilityId, parsed.data.limit) })
  })

  app.get('/api/setup', auth, (req, res) => {
    const user = req.afribokUser as SessionUser
    res.json({
      profile: getProfile(db, user.facilityId),
      departments: listDepartments(db, user.facilityId),
      complete: facilityView(db, user.facilityId).onboardingComplete,
    })
  })

  app.patch('/api/setup', auth, requirePermission('team.manage'), (req, res) => {
    const parsed = setupPatchSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) })
      return
    }
    const user = req.afribokUser as SessionUser
    res.json({ profile: updateProfile(db, user, parsed.data) })
  })

  app.post('/api/setup/complete', auth, requirePermission('team.manage'), (req, res) => {
    const user = req.afribokUser as SessionUser
    try {
      const profile = completeSetup(db, user)
      res.json({ profile, facility: facilityView(db, user.facilityId) })
    } catch (error) {
      if (error instanceof ServiceError) {
        res.status(error.status).json({ error: error.message, code: error.code })
        return
      }
      throw error
    }
  })

  app.get('/api/departments', auth, (req, res) => {
    const user = req.afribokUser as SessionUser
    res.json({ departments: listDepartments(db, user.facilityId) })
  })

  app.post('/api/departments', auth, requirePermission('team.manage'), (req, res) => {
    const parsed = departmentCreateSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) })
      return
    }
    const user = req.afribokUser as SessionUser
    try {
      res.status(201).json({ department: createDepartment(db, user, parsed.data) })
    } catch (error) {
      if (error instanceof ServiceError) {
        res.status(error.status).json({ error: error.message, code: error.code })
        return
      }
      throw error
    }
  })

  app.patch('/api/departments/:id', auth, requirePermission('team.manage'), (req, res) => {
    const parsed = departmentUpdateSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) })
      return
    }
    const user = req.afribokUser as SessionUser
    try {
      res.json({ department: updateDepartment(db, user, String(req.params.id), parsed.data) })
    } catch (error) {
      if (error instanceof ServiceError) {
        res.status(error.status).json({ error: error.message, code: error.code })
        return
      }
      throw error
    }
  })

  app.delete('/api/departments/:id', auth, requirePermission('team.manage'), (req, res) => {
    const user = req.afribokUser as SessionUser
    try {
      deleteDepartment(db, user, String(req.params.id))
      res.status(204).end()
    } catch (error) {
      if (error instanceof ServiceError) {
        res.status(error.status).json({ error: error.message, code: error.code })
        return
      }
      throw error
    }
  })

  app.post('/api/encounters/:id', auth, requirePermission('encounter.update'), (req, res) => {
    const parsed = assignmentSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) })
      return
    }
    const user = req.afribokUser as SessionUser
    try {
      const encounter = assignEncounter(db, user, String(req.params.id), parsed.data)
      res.json({ encounter })
    } catch (error) {
      if (error instanceof ServiceError) {
        res.status(error.status).json({ error: error.message, code: error.code })
        return
      }
      throw error
    }
  })

  app.post('/api/encounters/:id/note/approve', auth, requirePermission('encounter.update'), (req, res) => {
    const parsed = noteApprovalSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) })
      return
    }
    const user = req.afribokUser as SessionUser
    if (user.role !== 'clinician' && user.role !== 'admin') {
      res.status(403).json({ error: 'Only a clinician or administrator can approve a clinical note.' })
      return
    }
    try {
      const encounter = approveNote(db, user, String(req.params.id), parsed.data.approved)
      res.json({ encounter })
    } catch (error) {
      if (error instanceof ServiceError) {
        res.status(error.status).json({ error: error.message, code: error.code })
        return
      }
      throw error
    }
  })

  app.get('/api/performance', auth, requirePermission('dashboard.read'), (req, res) => {
    const user = req.afribokUser as SessionUser
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30))
    res.json({ performance: buildPerformanceReport(db, user.facilityId, days) })
  })

  app.get('/api/predictions', auth, requirePermission('dashboard.read'), (req, res) => {
    const user = req.afribokUser as SessionUser
    const historyDays = Math.min(1095, Math.max(7, Number(req.query.historyDays) || 90))
    const capacity = getCapacity(db, user.facilityId)
    const forecast = buildForecast(db, user.facilityId, { historyDays, horizonHours: 48, capacity })
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const departments = db
      .prepare(
        `SELECT d.id, d.name,
           (SELECT COUNT(*) FROM encounters e WHERE e.department_id = d.id AND e.arrived_at >= ?) AS visits,
           (SELECT COUNT(*) FROM encounters e WHERE e.department_id = d.id AND e.status <> 'completed') AS open
         FROM departments d WHERE d.facility_id = ? ORDER BY d.name`,
      )
      .all(cutoff, user.facilityId) as Array<{ id: string; name: string; visits: number; open: number }>
    const totalDepartmentVisits = departments.reduce((sum, department) => sum + department.visits, 0)
    const tomorrow = forecast.days[1]?.expectedVisits ?? 0
    const completed30 = (db
      .prepare(
        "SELECT COUNT(*) AS count FROM encounters WHERE facility_id = ? AND status = 'completed' AND updated_at >= ?",
      )
      .get(user.facilityId, cutoff) as { count: number }).count
    const notes7 = (db
      .prepare(
        'SELECT COUNT(*) AS count FROM encounters WHERE facility_id = ? AND note_at >= ?',
      )
      .get(user.facilityId, new Date(Date.now() - 7 * 86_400_000).toISOString()) as { count: number })
      .count
    const clinicians = countActiveStaff(db, user.facilityId, 'clinician')
    const nurses = countActiveStaff(db, user.facilityId, 'nurse')
    const profile = facilityView(db, user.facilityId)
    const common = {
      lastUpdated: forecast.generatedAt,
      historyUsed: `${forecast.history.coverageDays} day(s) · ${forecast.history.encounters} arrival(s)`,
      quality: forecast.history.confidence,
      note: forecast.history.note,
    }
    const cards = [
      {
        key: 'inflow', title: 'Patient inflow', department: 'All departments', period: 'Next 7 days',
        value: forecast.days.reduce((sum, day) => sum + day.expectedVisits, 0), unit: 'expected visits',
        available: true, ...common,
      },
      {
        key: 'outflow', title: 'Patient outflow', department: 'All departments', period: 'Daily average, last 30 days',
        value: Math.round((completed30 / 30) * 10) / 10, unit: 'completed visits/day',
        available: completed30 > 0, ...common,
        note: completed30 > 0 ? common.note : 'No completed visits in the last 30 days, so outflow cannot be measured yet.',
      },
      {
        key: 'waiting', title: 'Waiting-time pattern', department: 'All departments', period: 'Right now',
        value: forecast.now.longestWaitMinutes, unit: 'minutes longest wait', available: true, ...common,
        note: `${forecast.now.waiting} waiting · estimated next wait ${forecast.now.estimatedWaitMinutes} min.`,
      },
      {
        key: 'staff', title: 'Staff workload', department: 'All departments', period: 'Current open visits',
        value: clinicians + nurses > 0 ? Math.round((forecast.now.waiting + forecast.now.inConsultation) / (clinicians + nurses) * 10) / 10 : null,
        unit: 'open visits per clinician/nurse', available: clinicians + nurses > 0, ...common,
        note: `${clinicians} clinician(s), ${nurses} nurse(s); ${notes7} note(s) drafted in 7 days.`,
      },
      {
        key: 'laboratory', title: 'Laboratory workload', department: 'Laboratory', period: 'Recorded order data',
        value: null, unit: 'orders', available: false, ...common,
        quality: 'insufficient',
        note: profile.setupSummary?.hasLab
          ? 'A laboratory is configured, but Afribok does not yet record laboratory orders, so no workload forecast is claimed.'
          : 'No laboratory was configured during onboarding.',
      },
      {
        key: 'pharmacy', title: 'Pharmacy workload', department: 'Pharmacy', period: 'Recorded dispensing data',
        value: null, unit: 'prescriptions', available: false, ...common,
        quality: 'insufficient',
        note: profile.setupSummary?.hasPharmacy
          ? 'A pharmacy is configured, but dispensing events are not recorded yet, so no workload forecast is claimed.'
          : 'No pharmacy was configured during onboarding.',
      },
      ...departments.map((department) => ({
        key: `department-${department.id}`,
        title: 'Departmental demand',
        department: department.name,
        period: 'Tomorrow',
        value: department.visits > 0 && totalDepartmentVisits > 0
          ? Math.round((tomorrow * department.visits / totalDepartmentVisits) * 10) / 10
          : null,
        unit: 'expected visits',
        available: department.visits > 0,
        ...common,
        quality: department.visits >= 15 ? common.quality : 'low',
        note: department.visits > 0
          ? `${department.visits} visit(s) in 30 days · ${department.open} open now. Share of facility demand applied to tomorrow’s forecast.`
          : 'No visits recorded in this department in the last 30 days.',
      })),
    ]
    res.json({ generatedAt: forecast.generatedAt, history: forecast.history, cards, forecast })
  })

  app.get('/api/team', auth, requirePermission('team.manage'), (req, res) => {
    const user = req.afribokUser as SessionUser
    res.json({ members: listTeam(db, user.facilityId) })
  })

  app.post('/api/team', auth, requirePermission('team.manage'), (req, res) => {
    const parsed = teamCreateSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) })
      return
    }
    const user = req.afribokUser as SessionUser
    if (findUserByEmail(db, parsed.data.email)) {
      res.status(409).json({ error: 'An account already exists for this email.', code: 'EMAIL_TAKEN' })
      return
    }
    if (parsed.data.departmentId) {
      const department = db
        .prepare('SELECT 1 FROM departments WHERE id = ? AND facility_id = ?')
        .get(parsed.data.departmentId, user.facilityId)
      if (!department) {
        res.status(400).json({ error: 'That department is not part of this facility.' })
        return
      }
    }
    const id = randomUUID()
    const { salt, hash } = hashPassword(parsed.data.password)
    try {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO users
            (id, facility_id, name, email, role, staff_number, phone, department_id,
             password_salt, password_hash, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        ).run(
          id, user.facilityId, parsed.data.name, parsed.data.email, parsed.data.role,
          parsed.data.staffNumber || null, parsed.data.phone || null,
          parsed.data.departmentId ?? null, salt, hash, new Date().toISOString(),
        )
        recordAudit(db, {
          facilityId: user.facilityId, actorId: user.id, actorName: user.name,
          action: 'team.member_created', entityType: 'user', entityId: id,
          detail: { role: parsed.data.role, departmentId: parsed.data.departmentId ?? null },
        })
      })()
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (/UNIQUE/i.test(message)) {
        res.status(409).json({ error: 'That email or staff number is already in use.' })
        return
      }
      throw error
    }
    const member = listTeam(db, user.facilityId).find((candidate) => candidate.id === id)
    res.status(201).json({ member })
  })

  app.patch('/api/team/:id', auth, requirePermission('team.manage'), (req, res) => {
    const parsed = teamPatchSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) })
      return
    }
    const user = req.afribokUser as SessionUser
    try {
      const member = updateTeamMember(db, user, String(req.params.id), parsed.data)
      res.json({ member })
    } catch (error) {
      if (error instanceof ServiceError) {
        res.status(error.status).json({ error: error.message, code: error.code })
        return
      }
      throw error
    }
  })

  app.all('/api/*splat', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' })
  })

  if (serveFrontend) {
    const dist = resolve(process.cwd(), 'dist')
    if (existsSync(dist)) {
      app.use(
        express.static(dist, {
          index: false,
          setHeaders: (res, path) => {
            if (path.endsWith('index.html') || path.endsWith('sw.js') || path.endsWith('.webmanifest')) {
              res.setHeader('Cache-Control', 'no-cache')
            } else if (path.includes(`${resolve(dist, 'assets')}`)) {
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
            }
          },
        }),
      )
      app.use((req, res, next) => {
        if (req.method !== 'GET' || !req.accepts('html')) return next()
        res.setHeader('Cache-Control', 'no-cache')
        res.sendFile(resolve(dist, 'index.html'))
      })
      app.use((_req, res) => {
        res.status(404).send('Not found')
      })
    } else {
      app.get('/', (_req, res) => {
        res
          .status(503)
          .type('text/plain')
          .send('Afribok frontend is not built yet. Run npm run build, then npm start.')
      })
    }
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ServiceError) {
      res.status(error.status).json({
        error: error.message,
        code: error.code,
        ...(error.candidates ? { candidates: error.candidates } : {}),
      })
      return
    }
    console.error('[server] unhandled error:', error instanceof Error ? error.message : error)
    res.status(500).json({ error: 'An unexpected server error occurred. Nothing was saved.' })
  })

  return app
}
