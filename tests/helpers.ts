import { randomUUID } from 'node:crypto'
import type { AfribokDb } from '../server/db'
import { hashPassword } from '../server/auth'
import { FACILITY } from '../server/config'
import type { Role } from '../shared/types'

/** Test-only credentials. Never imported by the production server. */
export const TEST_PASSWORD = 'Afribok#2026'

export const TEST_EMAILS = {
  registration: 'registration@afribok.health',
  nurse: 'nurse@afribok.health',
  clinician: 'clinician@afribok.health',
  admin: 'admin@afribok.health',
  auditor: 'auditor@afribok.health',
} as const

const TEAM: Array<{ email: string; role: Role; name: string }> = [
  { email: TEST_EMAILS.registration, role: 'registration', name: 'Adaeze Okafor' },
  { email: TEST_EMAILS.nurse, role: 'nurse', name: 'Mariam Diallo' },
  { email: TEST_EMAILS.clinician, role: 'clinician', name: 'Dr. Chidi Balogun' },
  { email: TEST_EMAILS.admin, role: 'admin', name: 'Folake Adeyemi' },
  { email: TEST_EMAILS.auditor, role: 'auditor', name: 'Kwame Mensah' },
]

export function seedTestTeam(db: AfribokDb): void {
  const insert = db.prepare(
    `INSERT INTO users
      (id, facility_id, name, email, role, password_salt, password_hash, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(email) DO NOTHING`,
  )
  const { salt, hash } = hashPassword(TEST_PASSWORD)
  for (const account of TEAM) {
    insert.run(randomUUID(), FACILITY.id, account.name, account.email, account.role, salt, hash, new Date().toISOString())
  }
}

/**
 * Small deterministic clinical fixture for duplicate detection, queue
 * transitions and AI routes. It is only used by the automated suite.
 */
export function seedTestClinical(db: AfribokDb): void {
  const now = new Date()
  const patientId = randomUUID()
  const insertPatient = db.prepare(
    `INSERT INTO patients
      (id, facility_id, hospital_number, first_name, last_name, other_names, sex, date_of_birth,
       phone, address, identifier_type, identifier_value, version, synthetic, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?, ?)`,
  )
  const insertEncounter = db.prepare(
    `INSERT INTO encounters
      (id, facility_id, patient_id, department_id, arrived_at, chief_complaint, status, version, synthetic, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?, ?)`,
  )
  const departmentId = randomUUID()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO departments (id, facility_id, name, description, head_user_id, created_at, updated_at)
       VALUES (?, ?, 'General Outpatient', 'Test department', NULL, ?, ?)`,
    ).run(departmentId, FACILITY.id, now.toISOString(), now.toISOString())
    db.prepare("UPDATE users SET department_id = ? WHERE role IN ('nurse','clinician')").run(departmentId)
    insertPatient.run(
      patientId, FACILITY.id, 'AFB-1001', 'Amina', 'Yusuf', 'Halima', 'female', '1992-06-15',
      '0803 555 0142', 'Kubwa, Abuja', 'National ID', 'NIN-4491-8830',
      new Date(now.getTime() - 30 * 86400000).toISOString(),
      new Date(now.getTime() - 30 * 86400000).toISOString(),
    )
    const second = randomUUID()
    insertPatient.run(
      second, FACILITY.id, 'AFB-1002', 'Tunde', 'Adebayo', null, 'male', '1975-02-10',
      '0806 555 0198', 'Gwagwalada, Abuja', null, null,
      new Date(now.getTime() - 20 * 86400000).toISOString(),
      new Date(now.getTime() - 20 * 86400000).toISOString(),
    )
    insertEncounter.run(
      randomUUID(), FACILITY.id, patientId, departmentId,
      new Date(now.getTime() - 40 * 60000).toISOString(),
      'Fever for three days and general body weakness', 'waiting',
      new Date(now.getTime() - 40 * 60000).toISOString(),
      new Date(now.getTime() - 40 * 60000).toISOString(),
    )
    insertEncounter.run(
      randomUUID(), FACILITY.id, second, departmentId,
      new Date(now.getTime() - 5 * 60 * 60000).toISOString(),
      'Persistent cough for two weeks', 'completed',
      new Date(now.getTime() - 5 * 60 * 60000).toISOString(),
      new Date(now.getTime() - 4 * 60 * 60000).toISOString(),
    )
  })()
}

export function seedTestFixture(db: AfribokDb): void {
  seedTestTeam(db)
  seedTestClinical(db)
}
