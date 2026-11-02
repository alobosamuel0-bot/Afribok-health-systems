import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { COOKIE_NAME, FACILITY, SESSION_HOURS } from './config'
import { getProfile } from './setup'
import type { AfribokDb } from './db'
import type { Role, SessionUser } from '../shared/types'
import { can, type Permission } from '../shared/types'

export interface UserRow {
  id: string
  facility_id: string
  name: string
  email: string
  role: Role
  password_salt: string
  password_hash: string
  active: number
  staff_number: string | null
  phone: string | null
  department_id: string | null
  department_name?: string | null
  created_at: string
  last_sign_in_at: string | null
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      afribokUser?: SessionUser
      afribokSessionHash?: string
    }
  }
}

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return { salt, hash }
}

export function verifyPassword(password: string, salt: string, expectedHex: string): boolean {
  try {
    const actual = scryptSync(password, salt, 64)
    const expected = Buffer.from(expectedHex, 'hex')
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function findUserByEmail(db: AfribokDb, email: string): UserRow | undefined {
  return db
    .prepare(
      `SELECT u.*, d.name AS department_name FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.email = ?`,
    )
    .get(email.trim().toLowerCase()) as UserRow | undefined
}

export function publicUser(row: UserRow, facilityName?: string): SessionUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    facilityId: row.facility_id,
    facilityName: facilityName ?? FACILITY.name,
    departmentId: row.department_id ?? null,
    departmentName: row.department_name ?? null,
    staffNumber: row.staff_number ?? null,
  }
}

export function createSession(db: AfribokDb, userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000)
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString())
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(hashToken(token), userId, now.toISOString(), expires.toISOString())
  return { token, expiresAt: expires.toISOString() }
}

export function deleteSession(db: AfribokDb, tokenHash: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
}

export function deleteAllSessionsForUser(db: AfribokDb, userId: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

export function sessionCookieOptions(expiresAt: string) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    expires: new Date(expiresAt),
  }
}

export function clearCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
  }
}

export function authenticate(db: AfribokDb) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[COOKIE_NAME] as string | undefined
    if (!token) {
      res.status(401).json({ error: 'Sign in to continue.' })
      return
    }
    const tokenHash = hashToken(token)
    const row = db
      .prepare(
        `SELECT u.*, s.expires_at, d.name AS department_name FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE s.token_hash = ?`,
      )
      .get(tokenHash) as (UserRow & { expires_at: string }) | undefined
    if (!row || row.active !== 1 || row.expires_at <= new Date().toISOString()) {
      deleteSession(db, tokenHash)
      res.clearCookie(COOKIE_NAME, clearCookieOptions())
      res.status(401).json({ error: 'Your session has expired. Sign in again.' })
      return
    }
    req.afribokUser = publicUser(row, getProfile(db, row.facility_id).name)
    req.afribokSessionHash = tokenHash
    next()
  }
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.afribokUser || !can(req.afribokUser.role, permission)) {
      res.status(403).json({ error: 'Your role does not allow this action.' })
      return
    }
    next()
  }
}
