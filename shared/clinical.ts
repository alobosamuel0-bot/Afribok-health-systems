import { z } from 'zod'

/** Clinical support contracts shared by the API, the store and the workspace UI. */

export const TRIAGE_LABELS = {
  1: 'Immediate',
  2: 'Very urgent',
  3: 'Urgent',
  4: 'Standard',
  5: 'Non-urgent',
} as const

export type TriageLevel = 1 | 2 | 3 | 4 | 5

export interface TriageAssessment {
  level: TriageLevel
  label: string
  redFlags: string[]
  observations: string[]
  disposition: string
  reasoning: string
  confidence: number
  assessedAt: string
  assessedBy: string
  model: string
}

export const triageModelSchema = z.object({
  level: z.number().int().min(1).max(5),
  redFlags: z.array(z.string().max(300)).max(12).default([]),
  observations: z.array(z.string().max(300)).max(12).default([]),
  disposition: z.string().max(300).default(''),
  reasoning: z.string().max(1200).default(''),
  confidence: z.number().min(0).max(1).default(0.5),
})

export type OcrFieldKey =
  | 'firstName'
  | 'lastName'
  | 'otherNames'
  | 'sex'
  | 'dateOfBirth'
  | 'phone'
  | 'address'
  | 'hospitalNumber'
  | 'identifierType'
  | 'identifierValue'
  | 'chiefComplaint'
  | 'allergies'
  | 'medicalHistory'
  | 'currentMedications'

export const OCR_FIELD_KEYS: OcrFieldKey[] = [
  'firstName',
  'lastName',
  'otherNames',
  'sex',
  'dateOfBirth',
  'phone',
  'address',
  'hospitalNumber',
  'identifierType',
  'identifierValue',
  'chiefComplaint',
  'allergies',
  'medicalHistory',
  'currentMedications',
]

export interface OcrFieldValue {
  value: string | null
  confidence: number
}

export interface OcrExtraction {
  legible: boolean
  documentType: string
  fields: Record<OcrFieldKey, OcrFieldValue>
  confidence: number
  warnings: string[]
  rawText: string
  model: string
  processedAt: string
}

export const ocrModelSchema = z.object({
  legible: z.boolean().default(true),
  documentType: z.string().max(120).default('paper record'),
  fields: z
    .record(
      z.string(),
      z.object({
        value: z.union([z.string().max(400), z.null()]).default(null),
        confidence: z.number().min(0).max(1).default(0),
      }),
    )
    .default({}),
  confidence: z.number().min(0).max(1).default(0),
  warnings: z.array(z.string().max(300)).max(12).default([]),
  rawText: z.string().max(6000).default(''),
})

export interface ClinicalNote {
  transcript: string
  subjective: string
  objective: string
  assessment: string
  plan: string
  followUp: string
  patientReported: string[]
  clinicianObserved: string[]
  warnings: string[]
  audioSeconds: number
  model: string
  generatedAt: string
  generatedBy: string
}

export const noteModelSchema = z.object({
  transcript: z.string().max(12000).default(''),
  subjective: z.string().max(3000).default(''),
  objective: z.string().max(3000).default(''),
  assessment: z.string().max(3000).default(''),
  plan: z.string().max(3000).default(''),
  followUp: z.string().max(1500).default(''),
  patientReported: z.array(z.string().max(500)).max(20).default([]),
  clinicianObserved: z.array(z.string().max(500)).max(20).default([]),
  warnings: z.array(z.string().max(400)).max(12).default([]),
})

export interface ForecastHour {
  hour: string
  expectedArrivals: number
  expectedWaiting: number
  waitMinutes: number
  consultUtilization: number
  bedDemand: number
}

export interface ForecastDay {
  date: string
  weekday: string
  expectedVisits: number
  capacityVisits: number
  utilization: number
  staffOnDuty: number
  referralRecommended: boolean
  note: string
}

export interface ForecastEquipment {
  name: string
  units: number
  projectedUse: number
  utilization: number
  shortfall: number
}

export interface ForecastHistory {
  days: number
  encounters: number
  coverageDays: number
  warmingUp: boolean
  confidence: 'low' | 'medium' | 'high'
  note: string
}

export interface Forecast {
  generatedAt: string
  horizonHours: number
  history: ForecastHistory
  now: {
    waiting: number
    inConsultation: number
    longestWaitMinutes: number
    estimatedWaitMinutes: number
    consultUtilization: number
    bedOccupancy: number
    staffOnDuty: number
  }
  hours: ForecastHour[]
  days: ForecastDay[]
  equipment: ForecastEquipment[]
  referral: {
    recommended: boolean
    window: string
    reason: string
    days: string[]
  }
  assumptions: string[]
  model: {
    averageConsultMinutes: number
    arrivalsPerWeekdayHour: boolean
    trendPerWeek: number
  }
}

export interface Capacity {
  consultRooms: number
  beds: number
  clinicians: number
  equipment: Array<{ name: string; units: number }>
  updatedAt: string | null
}
