import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/app'
import { closeDatabase, openDatabase, type AfribokDb } from '../server/db'
import { TEST_PASSWORD, seedTestTeam } from './helpers'

let db: AfribokDb
let app: ReturnType<typeof createApp>

beforeEach(() => {
  db = openDatabase(':memory:')
  seedTestTeam(db)
  app = createApp({ db, seed: false, serveFrontend: false })
})

afterEach(() => {
  closeDatabase(db)
})

async function signIn(email: string) {
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD })
  expect(response.status).toBe(200)
  return agent
}

describe('hospital onboarding', () => {
  it('starts an unconfigured facility with an incomplete profile and no departments', async () => {
    const admin = await signIn('admin@afribok.health')
    const response = await admin.get('/api/setup')
    expect(response.status).toBe(200)
    expect(response.body.complete).toBe(false)
    expect(response.body.departments).toEqual([])
    expect(response.body.profile.completedAt).toBeNull()
    expect(response.body.profile.step).toBe(1)

    const me = await admin.get('/api/me')
    expect(me.body.facility.onboardingComplete).toBe(false)
  })

  it('persists the answers and serves them back to every signed-in user', async () => {
    const admin = await signIn('admin@afribok.health')
    const saved = await admin.patch('/api/setup').send({
      name: 'Garki General Hospital',
      facilityType: 'General hospital',
      location: 'Abuja, Nigeria',
      dailyPatients: 140,
      ehrStatus: 'emr',
      ehrName: 'OpenMRS',
      ehrApiAccess: 'yes',
      ehrRead: true,
      ehrWrite: false,
      historyStatus: 'partial',
      historyFormats: ['paper', 'excel'],
      historyPeriod: '6_12_months',
      internet: 'unstable',
      devices: ['desktop', 'tablet'],
      step: 3,
    })
    expect(saved.status).toBe(200)
    expect(saved.body.profile.name).toBe('Garki General Hospital')
    expect(saved.body.profile.historyFormats).toEqual(['paper', 'excel'])
    expect(saved.body.profile.devices).toEqual(['desktop', 'tablet'])
    expect(saved.body.profile.step).toBe(3)

    const nurse = await signIn('nurse@afribok.health')
    const readBack = await nurse.get('/api/setup')
    expect(readBack.status).toBe(200)
    expect(readBack.body.profile.name).toBe('Garki General Hospital')
    expect(readBack.body.profile.ehrRead).toBe(true)
    expect(readBack.body.profile.ehrWrite).toBe(false)

    // The facility view the shell renders follows the stored answers.
    const me = await nurse.get('/api/me')
    expect(me.body.user.facilityName).toBe('Garki General Hospital')
    expect(me.body.facility.name).toBe('Garki General Hospital')
    expect(me.body.facility.location).toBe('Abuja, Nigeria')
    expect(me.body.facility.setupSummary).toMatchObject({
      ehrStatus: 'emr',
      ehrName: 'OpenMRS',
      ehrApiAccess: 'yes',
      ehrRead: true,
      ehrWrite: false,
      historyStatus: 'partial',
      historyPeriod: '6_12_months',
      internet: 'unstable',
      devices: ['desktop', 'tablet'],
    })
    expect(me.body.facility.ehrIntegrationEnabled).toBe(true)
  })

  it('refuses to finish setup without a hospital name or a department', async () => {
    const admin = await signIn('admin@afribok.health')
    const noName = await admin.post('/api/setup/complete')
    expect(noName.status).toBe(400)
    expect(noName.body.code).toBe('NAME_REQUIRED')

    await admin.patch('/api/setup').send({ name: 'Kuje Clinic', location: 'Kuje, Abuja' })
    const noDepartment = await admin.post('/api/setup/complete')
    expect(noDepartment.status).toBe(400)
    expect(noDepartment.body.code).toBe('DEPARTMENT_REQUIRED')
  })

  it('creates departments, rejects duplicates and completes the workspace', async () => {
    const admin = await signIn('admin@afribok.health')
    await admin.patch('/api/setup').send({ name: 'Kuje Clinic', location: 'Kuje, Abuja' })

    const created = await admin.post('/api/departments').send({
      name: 'Emergency',
      description: 'Walk-in emergencies',
    })
    expect(created.status).toBe(201)
    expect(created.body.department.name).toBe('Emergency')

    const duplicate = await admin.post('/api/departments').send({ name: 'emergency' })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.code).toBe('DEPARTMENT_EXISTS')

    const second = await admin.post('/api/departments').send({ name: 'Paediatrics' })
    expect(second.status).toBe(201)

    const done = await admin.post('/api/setup/complete')
    expect(done.status).toBe(200)
    expect(done.body.profile.completedAt).toBeTruthy()
    expect(done.body.facility.onboardingComplete).toBe(true)

    const me = await admin.get('/api/me')
    expect(me.body.facility.onboardingComplete).toBe(true)
    expect(me.body.facility.name).toBe('Kuje Clinic')

    const departments = await admin.get('/api/departments')
    expect(departments.body.departments.map((item: { name: string }) => item.name)).toEqual([
      'Emergency',
      'Paediatrics',
    ])
  })

  it('keeps onboarding changes to administrators while everyone can read them', async () => {
    const clinician = await signIn('clinician@afribok.health')
    expect((await clinician.get('/api/setup')).status).toBe(200)
    expect((await clinician.patch('/api/setup').send({ name: 'Hijacked Clinic' })).status).toBe(403)
    expect((await clinician.post('/api/departments').send({ name: 'Surgery' })).status).toBe(403)
    expect((await clinician.post('/api/setup/complete')).status).toBe(403)
    expect((await clinician.get('/api/team')).status).toBe(403)
  })

  it('assigns staff to departments and protects a department that still has staff', async () => {
    const admin = await signIn('admin@afribok.health')
    const created = await admin.post('/api/departments').send({ name: 'Paediatrics' })
    const departmentId = created.body.department.id as string

    const team = await admin.get('/api/team')
    const nurse = team.body.members.find((member: { email: string }) => member.email === 'nurse@afribok.health')
    expect(nurse).toBeTruthy()

    const assigned = await admin.patch(`/api/team/${nurse.id}`).send({ departmentId })
    expect(assigned.status).toBe(200)
    expect(assigned.body.member.departmentId).toBe(departmentId)
    expect(assigned.body.member.departmentName).toBe('Paediatrics')

    const departments = await admin.get('/api/departments')
    expect(departments.body.departments[0].staffCount).toBe(1)

    const blocked = await admin.delete(`/api/departments/${departmentId}`)
    expect(blocked.status).toBe(409)
    expect(blocked.body.code).toBe('DEPARTMENT_HAS_STAFF')

    await admin.patch(`/api/team/${nurse.id}`).send({ departmentId: null })
    const removed = await admin.delete(`/api/departments/${departmentId}`)
    expect(removed.status).toBe(204)

    const after = await admin.get('/api/departments')
    expect(after.body.departments).toEqual([])
  })
})
