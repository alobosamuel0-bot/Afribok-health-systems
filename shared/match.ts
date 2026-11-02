import type { DuplicateCandidate, Patient, Sex } from './types'

export function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizePhone(value: string | null | undefined): string {
  if (!value) return ''
  const digits = value.replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]
}

export function nameSimilarity(a: string, b: string): number {
  const left = normalizeName(a)
  const right = normalizeName(b)
  if (!left || !right) return 0
  if (left === right) return 1
  const distance = levenshtein(left, right)
  const longest = Math.max(left.length, right.length)
  let score = 1 - distance / longest
  if (left.includes(right) || right.includes(left)) score = Math.max(score, 0.82)
  return score
}

export interface MatchSubject {
  firstName: string
  lastName: string
  otherNames?: string | null
  sex: Sex
  dateOfBirth?: string | null
  phone?: string | null
  identifierValue?: string | null
  hospitalNumber?: string
}

/**
 * Deterministic candidate scoring. It never merges records: the caller must
 * show candidates to a human. An exact hospital identifier is the only basis
 * for a very strong match.
 */
export function scoreCandidate(
  subject: MatchSubject,
  candidate: Patient,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0

  if (
    subject.identifierValue?.trim() &&
    candidate.identifierValue?.trim() &&
    subject.identifierValue.trim().toLowerCase() === candidate.identifierValue.trim().toLowerCase()
  ) {
    return { score: 1, reasons: ['Same national / hospital identifier'] }
  }

  const last = nameSimilarity(subject.lastName, candidate.lastName)
  const first = nameSimilarity(subject.firstName, candidate.firstName)
  if (last >= 0.88) {
    score += 0.3
    reasons.push('Matching surname')
  } else {
    score += last * 0.18
  }
  if (first >= 0.88) {
    score += 0.25
    reasons.push('Matching first name')
  } else {
    score += first * 0.12
  }

  const dobA = subject.dateOfBirth || ''
  const dobB = candidate.dateOfBirth || ''
  if (dobA && dobB) {
    if (dobA === dobB) {
      score += 0.22
      reasons.push('Same date of birth')
    } else {
      score -= 0.1
      reasons.push('Different date of birth')
    }
  }

  const phoneA = normalizePhone(subject.phone)
  const phoneB = normalizePhone(candidate.phone)
  if (phoneA && phoneB) {
    if (phoneA === phoneB) {
      score += 0.18
      reasons.push('Same phone number')
    } else {
      score -= 0.04
    }
  }

  if (subject.sex !== 'unknown' && candidate.sex === subject.sex) {
    score += 0.05
    reasons.push('Same recorded sex')
  }

  if (
    subject.hospitalNumber &&
    candidate.hospitalNumber &&
    subject.hospitalNumber.toLowerCase() === candidate.hospitalNumber.toLowerCase()
  ) {
    score = 1
    reasons.push('Same hospital number')
  }

  return { score: Math.max(0, Math.min(1, score)), reasons }
}

export function findCandidates(
  subject: MatchSubject,
  patients: Patient[],
  threshold = 0.6,
): DuplicateCandidate[] {
  return patients
    .map((patient) => {
      const { score, reasons } = scoreCandidate(subject, patient)
      return { patient, score: Math.round(score * 100) / 100, reasons }
    })
    .filter((candidate) => candidate.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}
