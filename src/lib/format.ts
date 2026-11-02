import type { EncounterStatus, Patient } from '@shared/types'

export function initials(first: string, last: string): string {
  return `${first.trim().charAt(0)}${last.trim().charAt(0)}`.toUpperCase()
}

export function ageOf(patient: Pick<Patient, 'dateOfBirth'>): string {
  if (!patient.dateOfBirth) return 'Age unknown'
  const dob = new Date(`${patient.dateOfBirth}T00:00:00Z`)
  if (Number.isNaN(dob.getTime())) return 'Age unknown'
  const now = new Date()
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  const month = now.getUTCMonth() - dob.getUTCMonth()
  if (month < 0 || (month === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1
  return `${age} yrs`
}

export function fullName(patient: Pick<Patient, 'firstName' | 'lastName' | 'otherNames'>): string {
  return [patient.firstName, patient.otherNames, patient.lastName].filter(Boolean).join(' ')
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(date)
}

export function waitingFor(value: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(value).getTime()) / 60000))
  if (minutes < 1) return 'just arrived'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`
}

export function isSameLocalDay(value: string, compare = new Date()): boolean {
  const date = new Date(value)
  return (
    date.getFullYear() === compare.getFullYear() &&
    date.getMonth() === compare.getMonth() &&
    date.getDate() === compare.getDate()
  )
}

export const ENCOUNTER_STATUS_LABELS: Record<EncounterStatus, string> = {
  waiting: 'Waiting',
  in_consultation: 'In consultation',
  completed: 'Completed',
}

export function sexLabel(value: Patient['sex']): string {
  if (value === 'female') return 'Female'
  if (value === 'male') return 'Male'
  if (value === 'other') return 'Other'
  return 'Not recorded'
}

const HOSPITAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function newHospitalNumber(existing: Iterable<string>): string {
  const used = new Set(existing)
  for (let attempt = 0; attempt < 30; attempt++) {
    const random = crypto.getRandomValues(new Uint8Array(6))
    const suffix = [...random].map((byte) => HOSPITAL_ALPHABET[byte % HOSPITAL_ALPHABET.length]).join('')
    const candidate = `AFB-${suffix}`
    if (!used.has(candidate)) return candidate
  }
  return `AFB-${Date.now().toString(36).toUpperCase().slice(-6)}`
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
