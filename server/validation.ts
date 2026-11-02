import { z } from 'zod'
import { MAX_SYNC_BATCH } from './config'
import { ROLES } from '../shared/types'

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(max).nullable().optional(),
  )

const isoDateTime = z.string().refine(
  (value) => /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value)),
  'Must be an ISO date-time',
)

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    const today = new Date()
    return !Number.isNaN(parsed.getTime()) && parsed <= today && parsed.getUTCFullYear() >= 1900
  }, 'Date of birth must be a valid past date')

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
})

export const createAccountSchema = z.object({
  name: z.string().trim().min(2, 'Enter the full name').max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
  // Administrators are promoted by an existing administrator in Team & roles;
  // a public form must never be able to grant itself full access.
  role: z.enum(['registration', 'nurse', 'clinician', 'auditor']).default('registration'),
})

export const patientInputSchema = z.object({
  id: z.string().uuid(),
  hospitalNumber: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers and hyphens only'),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  otherNames: optionalText(80),
  sex: z.enum(['female', 'male', 'other', 'unknown']),
  dateOfBirth: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    dateOnly.nullable().optional(),
  ),
  phone: optionalText(40),
  address: optionalText(240),
  identifierType: optionalText(40),
  identifierValue: optionalText(80),
  allergies: optionalText(1000),
  medicalHistory: optionalText(2000),
  currentMedications: optionalText(1000),
  createdAt: isoDateTime.optional(),
})

const encounterBodySchema = z.object({
  id: z.string().uuid(),
  arrivedAt: isoDateTime,
  chiefComplaint: z.string().trim().max(1000).default(''),
  departmentId: z.string().uuid().nullable().optional(),
  consentRecorded: z.boolean().optional().default(false),
  createdAt: isoDateTime.optional(),
})

export const registerPatientPayloadSchema = z.object({
  patient: patientInputSchema,
  encounter: encounterBodySchema,
  duplicateAcknowledged: z.boolean().optional().default(false),
})

export const createEncounterPayloadSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  arrivedAt: isoDateTime,
  chiefComplaint: z.string().trim().max(1000).default(''),
  departmentId: z.string().uuid().nullable().optional(),
  consentRecorded: z.boolean().optional().default(false),
  createdAt: isoDateTime.optional(),
})

export const updateEncounterPayloadSchema = z
  .object({
    encounterId: z.string().uuid(),
    baseVersion: z.number().int().min(0),
    chiefComplaint: z.string().trim().max(1000).optional(),
    status: z.enum(['waiting', 'in_consultation', 'completed']).optional(),
    assignedClinicianId: z.string().uuid().nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (value) =>
      value.chiefComplaint !== undefined ||
      value.status !== undefined ||
      value.assignedClinicianId !== undefined ||
      value.departmentId !== undefined,
    { message: 'Provide a complaint, status, department or assignee change' },
  )

const operationBase = {
  id: z.string().uuid(),
  clientTime: isoDateTime,
}

export const syncRequestSchema = z.object({
  operations: z
    .array(
      z.discriminatedUnion('type', [
        z.object({
          ...operationBase,
          type: z.literal('register_patient'),
          payload: registerPatientPayloadSchema,
        }),
        z.object({
          ...operationBase,
          type: z.literal('create_encounter'),
          payload: createEncounterPayloadSchema,
        }),
        z.object({
          ...operationBase,
          type: z.literal('update_encounter'),
          payload: updateEncounterPayloadSchema,
        }),
      ]),
    )
    .min(1)
    .max(MAX_SYNC_BATCH),
})

export const teamCreateSchema = z.object({
  name: z.string().trim().min(2, 'Enter the staff member\u2019s full name').max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
  role: z.enum(ROLES as [string, ...string[]]),
  staffNumber: z.string().trim().max(40).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
})

export const noteApprovalSchema = z.object({
  approved: z.boolean(),
})

export const assignmentSchema = z
  .object({
    assignedClinicianId: z.string().uuid().nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
    status: z.enum(['waiting', 'in_consultation', 'completed']).optional(),
  })
  .refine(
    (value) =>
      value.assignedClinicianId !== undefined ||
      value.departmentId !== undefined ||
      value.status !== undefined,
    { message: 'Nothing to change' },
  )

export const teamPatchSchema = z
  .object({
    role: z.enum(ROLES as [string, ...string[]]).optional(),
    active: z.boolean().optional(),
    departmentId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (value) => value.role !== undefined || value.active !== undefined || value.departmentId !== undefined,
    { message: 'Nothing to change' },
  )

const trimmedOptionalText = (max: number) => z.string().trim().max(max).optional()

/** Partial update of the hospital onboarding answers; each step saves as it is left. */
export const setupPatchSchema = z
  .object({
    name: trimmedOptionalText(120),
    facilityType: trimmedOptionalText(80),
    location: trimmedOptionalText(120),
    address: trimmedOptionalText(240),
    size: trimmedOptionalText(120),
    dailyPatients: z.number().int().min(0).max(100000).nullable().optional(),
    operatingDays: trimmedOptionalText(120),
    operatingHours: trimmedOptionalText(120),
    ehrStatus: z.enum(['ehr', 'emr', 'other_digital', 'paper', 'none']).optional(),
    ehrName: trimmedOptionalText(120).nullable(),
    ehrVendor: trimmedOptionalText(120).nullable(),
    ehrApiAccess: z.enum(['yes', 'no', 'unknown']).optional(),
    ehrRead: z.boolean().optional(),
    ehrWrite: z.boolean().optional(),
    ehrStandard: trimmedOptionalText(120).nullable(),
    ehrDocs: z.boolean().optional(),
    ehrContact: trimmedOptionalText(160).nullable(),
    historyStatus: z.enum(['yes', 'no', 'partial']).optional(),
    historyFormats: z
      .array(z.enum(['paper', 'ehr', 'excel', 'csv', 'word', 'other']))
      .max(7)
      .optional(),
    historyPeriod: z
      .enum(['3_6_months', '6_12_months', '1_2_years', '2_3_years', 'over_3_years'])
      .nullable()
      .optional(),
    walkInShare: z.enum(['most', 'some', 'few']).optional(),
    appointments: z.boolean().optional(),
    doctors: z.number().int().min(0).max(500).nullable().optional(),
    nurses: z.number().int().min(0).max(2000).nullable().optional(),
    hasEmergency: z.boolean().optional(),
    hasLab: z.boolean().optional(),
    hasPharmacy: z.boolean().optional(),
    hasBeds: z.boolean().optional(),
    internet: z.enum(['reliable', 'unstable', 'none']).optional(),
    localNetwork: z.boolean().optional(),
    localServer: z.boolean().optional(),
    devices: z.array(z.enum(['desktop', 'tablet', 'smartphone'])).max(3).optional(),
    step: z.number().int().min(1).max(8).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to save' })

export const departmentCreateSchema = z.object({
  name: z.string().trim().min(2, 'Name the department').max(80),
  description: z.string().trim().max(240).optional().default(''),
  headUserId: z.string().uuid().nullable().optional(),
})

export const departmentUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(240).optional(),
    headUserId: z.string().uuid().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to change' })

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
    .join('; ')
}

export const capacitySchema = z.object({
  consultRooms: z.number().int().min(1).max(50),
  beds: z.number().int().min(0).max(200),
  clinicians: z.number().int().min(1).max(60),
  equipment: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(80),
        units: z.number().int().min(0).max(200),
      }),
    )
    .max(12),
})

export const forecastQuerySchema = z.object({
  horizonHours: z.coerce.number().int().min(6).max(72).default(24),
  historyDays: z.coerce.number().int().min(7).max(1095).default(90),
})

export const triageRequestSchema = z.object({
  encounterId: z.string().uuid(),
  notes: z.string().trim().max(1500).optional(),
  vitals: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
})

export const scribeRequestSchema = z.object({
  encounterId: z.string().uuid(),
  audioBase64: z.string().max(12_000_000).optional(),
  mimeType: z.string().max(60).optional(),
  audioSeconds: z.number().min(0).max(600).optional(),
  transcript: z.string().max(12000).optional(),
  notes: z.string().max(2000).optional(),
})

export const ocrRequestSchema = z.object({
  imageBase64: z.string().min(32).max(12_000_000),
  mimeType: z.string().max(60).optional(),
})
