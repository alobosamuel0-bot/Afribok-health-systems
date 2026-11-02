import type { AfribokDb } from './db'
import type { Capacity, Forecast, ForecastDay, ForecastEquipment, ForecastHour } from '../shared/clinical'
import { getCapacity } from './repository'

/**
 * Patient-outflow forecast.
 *
 * The engine learns from this clinic's own visits: arrival counts per weekday and
 * hour, how long a consultation actually takes, and the recent trend. With less
 * than three months of visits it says so instead of inventing history, and it
 * blends the clinic profile with conservative defaults until enough data exists.
 */

const DEFAULT_CONSULT_MINUTES = 15
const DEFAULT_DAILY_VISITS = 24
const BED_SHARE = 0.3
const EQUIPMENT_USAGE_SHARE = 0.4
const OPEN_HOUR = 8
const CLOSE_HOUR = 18

interface HistoryRow {
  arrived_at: string
  status: string
  updated_at: string
}

interface Profile {
  bucketMeans: Map<string, number>
  dailyMeans: Map<number, number>
  consultMinutes: number
  coverageDays: number
  encounters: number
  importedDays: number
  trendPerWeek: number
  sparse: boolean
  /** Share of the forecast that comes from this clinic's own record (0..1). */
  weight: number
}

function priorDailyVisits(date: Date): number {
  const weekend = weekdayOf(date) === 0 || weekdayOf(date) === 6
  return DEFAULT_DAILY_VISITS * (weekend ? 0.35 : 1)
}

function priorHourMean(date: Date): number {
  const hour = hourOf(date)
  if (hour < OPEN_HOUR || hour >= CLOSE_HOUR) return 0.2
  return priorDailyVisits(date) / (CLOSE_HOUR - OPEN_HOUR)
}

function keyOf(weekday: number, hour: number): string {
  return `${weekday}:${hour}`
}

function weekdayOf(date: Date): number {
  return date.getUTCDay()
}

function hourOf(date: Date): number {
  return date.getUTCHours()
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function startOfHour(date: Date): Date {
  const copy = new Date(date)
  copy.setUTCMinutes(0, 0, 0)
  return copy
}

function loadProfile(db: AfribokDb, facilityId: string, now: Date, historyDays: number): Profile {
  const cutoff = new Date(now.getTime() - historyDays * 24 * 60 * 60 * 1000).toISOString()
  const rows = db
    .prepare(
      `SELECT arrived_at, status, updated_at FROM encounters
       WHERE facility_id = ? AND arrived_at >= ? AND arrived_at <= ?
       ORDER BY arrived_at ASC`,
    )
    .all(facilityId, cutoff, now.toISOString()) as HistoryRow[]

  const counts = new Map<string, number>()
  const dailyCounts = new Map<string, number>()
  const durations: number[] = []
  const representedDays = new Set<string>()
  let firstHalf = 0
  let secondHalf = 0
  let importedDays = 0
  let importedArrivals = 0

  const windowStart = new Date(now.getTime() - historyDays * 24 * 60 * 60 * 1000)
  const mid = windowStart.getTime() + (now.getTime() - windowStart.getTime()) / 2

  for (const row of rows) {
    const arrived = new Date(row.arrived_at)
    if (Number.isNaN(arrived.getTime())) continue
    const bucketKey = keyOf(weekdayOf(arrived), hourOf(arrived))
    counts.set(bucketKey, (counts.get(bucketKey) ?? 0) + 1)
    const dayKey = arrived.toISOString().slice(0, 10)
    representedDays.add(dayKey)
    dailyCounts.set(dayKey, (dailyCounts.get(dayKey) ?? 0) + 1)

    if (row.status === 'completed') {
      const minutes = (new Date(row.updated_at).getTime() - arrived.getTime()) / 60000
      if (Number.isFinite(minutes) && minutes >= 3 && minutes <= 240) durations.push(minutes)
    }

    if (arrived.getTime() >= mid) secondHalf += 1
    else firstHalf += 1
  }

  // Imported historical records contain daily aggregates, not patient details.
  // Prefer an explicit whole-facility row over a sum of department rows and skip
  // dates that already have live encounters to avoid double-counting.
  const imported = db.prepare(`
    SELECT metric_date,
      COALESCE(MAX(CASE WHEN lower(department) = 'all departments' THEN arrivals END), SUM(arrivals)) AS arrivals
    FROM historical_metrics WHERE facility_id = ? AND metric_date >= ? AND metric_date <= ?
    GROUP BY metric_date ORDER BY metric_date
  `).all(facilityId, cutoff.slice(0, 10), now.toISOString().slice(0, 10)) as Array<{ metric_date: string; arrivals: number }>
  for (const row of imported) {
    if (representedDays.has(row.metric_date)) continue
    const arrived = new Date(`${row.metric_date}T12:00:00Z`)
    if (Number.isNaN(arrived.getTime())) continue
    const arrivals = Math.max(0, Number(row.arrivals) || 0)
    if (arrivals === 0) continue
    importedDays += 1
    importedArrivals += arrivals
    const dayKey = row.metric_date
    dailyCounts.set(dayKey, arrivals)
    // No hourly data was uploaded, so spread daily arrivals uniformly across
    // the configured daytime window; the forecast assumptions disclose this.
    const perHour = arrivals / (CLOSE_HOUR - OPEN_HOUR)
    for (let hour = OPEN_HOUR; hour < CLOSE_HOUR; hour += 1) {
      const bucket = keyOf(weekdayOf(arrived), hour)
      counts.set(bucket, (counts.get(bucket) ?? 0) + perHour)
    }
    if (arrived.getTime() >= mid) secondHalf += arrivals
    else firstHalf += arrivals
  }

  // How many distinct days of this clinic's own record exist, capped by the window.
  const earliestLive = rows.length > 0 ? new Date(rows[0].arrived_at).getTime() : now.getTime()
  const earliestImported = imported.find((row) => !representedDays.has(row.metric_date))
  const earliest = earliestImported
    ? Math.min(earliestLive, new Date(`${earliestImported.metric_date}T00:00:00Z`).getTime())
    : earliestLive
  const coverageDays = clamp(Math.round((now.getTime() - earliest) / 86_400_000), 0, historyDays)

  // Weekly means: divide each weekday-hour count by the number of that weekday in the window.
  const weeksInWindow = Math.max(1, historyDays / 7)
  const bucketMeans = new Map<string, number>()
  for (const [bucketKey, count] of counts) {
    bucketMeans.set(bucketKey, count / weeksInWindow)
  }

  const dailyMeans = new Map<number, number>()
  for (const [dayKey, count] of dailyCounts) {
    const weekday = new Date(`${dayKey}T00:00:00Z`).getUTCDay()
    dailyMeans.set(weekday, (dailyMeans.get(weekday) ?? 0) + count / weeksInWindow)
  }

  const consultMinutes =
    durations.length > 0
      ? clamp(durations.reduce((sum, value) => sum + value, 0) / durations.length, 5, 90)
      : DEFAULT_CONSULT_MINUTES

  const halfSpanWeeks = Math.max(1, historyDays / 14)
  const trendPerWeek = secondHalf / halfSpanWeeks - firstHalf / halfSpanWeeks
  const totalObserved = rows.length + importedArrivals
  const sparse = totalObserved < 8 || coverageDays < 7

  return {
    bucketMeans,
    dailyMeans,
    consultMinutes,
    coverageDays,
    encounters: totalObserved,
    importedDays,
    trendPerWeek,
    sparse,
    // A clinic earns its own profile over the first three months. Before that the
    // observed means are too thin to stand alone, so they are blended with a
    // conservative default that carries less weight as the record fills up.
    weight: sparse ? 0 : clamp(coverageDays / 90, 0, 1),
  }
}

function trendFactor(daysAhead: number, trendPerWeek: number): number {
  const weekly = trendPerWeek / Math.max(1, DEFAULT_DAILY_VISITS)
  return clamp(1 + weekly * (daysAhead / 7), 0.6, 1.6)
}

function expectedArrivalsFor(profile: Profile, date: Date, dayOffset: number): number {
  const observed = (profile.dailyMeans.get(weekdayOf(date)) ?? 0) * trendFactor(dayOffset, profile.trendPerWeek)
  const blended = (1 - profile.weight) * priorDailyVisits(date) + profile.weight * observed
  return Math.max(0, blended)
}

function hourMean(profile: Profile, date: Date, dayOffset: number): number {
  const observed =
    (profile.bucketMeans.get(keyOf(weekdayOf(date), hourOf(date))) ?? 0) *
    trendFactor(dayOffset, profile.trendPerWeek)
  const blended = (1 - profile.weight) * priorHourMean(date) + profile.weight * observed
  return Math.max(0, blended)
}

export interface ForecastOptions {
  now?: Date
  historyDays?: number
  horizonHours?: number
  capacity?: Capacity
  staffOnDuty?: number
}

export function buildForecast(
  db: AfribokDb,
  facilityId: string,
  options: ForecastOptions = {},
): Forecast {
  const now = options.now ?? new Date()
  const historyDays = clamp(options.historyDays ?? 90, 7, 1095)
  const horizonHours = clamp(options.horizonHours ?? 24, 6, 72)
  const capacity = options.capacity ?? getCapacity(db, facilityId)
  const staffOnDuty = Math.max(1, options.staffOnDuty ?? capacity.clinicians)
  const profile = loadProfile(db, facilityId, now, historyDays)

  const openRows = db
    .prepare(
      `SELECT status, arrived_at FROM encounters WHERE facility_id = ? AND status IN ('waiting','in_consultation')`,
    )
    .all(facilityId) as Array<{ status: string; arrived_at: string }>

  const waiting = openRows.filter((row) => row.status === 'waiting').length
  const inConsultation = openRows.filter((row) => row.status === 'in_consultation').length
  const oldestWait = openRows
    .filter((row) => row.status === 'waiting')
    .reduce((max, row) => Math.max(max, (now.getTime() - new Date(row.arrived_at).getTime()) / 60000), 0)

  const serviceMinutes = profile.consultMinutes
  const throughputPerHour = (staffOnDuty * 60) / serviceMinutes
  const currentWait = waiting === 0 ? 0 : Math.round((waiting / staffOnDuty) * serviceMinutes)

  // Hour-by-hour queue projection.
  const hours: ForecastHour[] = []
  let queue = waiting
  const start = startOfHour(now)
  for (let index = 0; index < horizonHours; index += 1) {
    const slot = new Date(start.getTime() + index * 60 * 60 * 1000)
    const dayOffset = Math.floor((slot.getTime() - now.getTime()) / 86_400_000)
    const arrivals = Math.max(0, hourMean(profile, slot, dayOffset))
    const seen = Math.min(queue + arrivals, throughputPerHour)
    queue = Math.max(0, queue + arrivals - throughputPerHour)
    hours.push({
      hour: slot.toISOString(),
      expectedArrivals: round(arrivals),
      expectedWaiting: round(queue),
      waitMinutes: Math.round((queue / staffOnDuty) * serviceMinutes),
      consultUtilization: round(clamp(((queue + arrivals) * serviceMinutes) / (staffOnDuty * 60), 0, 1.5), 2),
      bedDemand: round(Math.min(capacity.beds, inConsultation * BED_SHARE + queue * BED_SHARE)),
    })
    void seen
  }

  // Seven-day view with a referral signal.
  const days: ForecastDay[] = []
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const dailyCapacity = Math.max(1, Math.round(throughputPerHour * (CLOSE_HOUR - OPEN_HOUR)))
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(now.getTime() + offset * 86_400_000)
    const expectedVisits = expectedArrivalsFor(profile, day, offset)
    const utilization = expectedVisits / dailyCapacity
    const referralRecommended = utilization >= 0.9
    days.push({
      date: day.toISOString().slice(0, 10),
      weekday: weekdayNames[weekdayOf(day)],
      expectedVisits: Math.round(expectedVisits),
      capacityVisits: dailyCapacity,
      utilization: round(utilization, 2),
      staffOnDuty,
      referralRecommended,
      note: referralRecommended
        ? utilization >= 1.1
          ? 'Demand is above this clinic’s daily capacity — plan referrals or extra staff.'
          : 'Demand is close to capacity — confirm cover before the day starts.'
        : 'Within capacity — manage in house.',
    })
  }

  const todayExpected = days[0]?.expectedVisits ?? 0
  const equipment: ForecastEquipment[] = capacity.equipment.map((item) => {
    const projectedUse = round(todayExpected * EQUIPMENT_USAGE_SHARE)
    return {
      name: item.name,
      units: item.units,
      projectedUse,
      utilization: round(item.units > 0 ? projectedUse / item.units : 0, 2),
      shortfall: Math.max(0, Math.ceil(projectedUse - item.units)),
    }
  })

  const pressured = days.filter((day) => day.referralRecommended)
  const todayUtilization = days[0]?.utilization ?? 0
  const referral = {
    recommended: pressured.length > 0,
    window: pressured.length > 0 ? pressured.map((day) => day.date).join(', ') : 'None in the next 7 days',
    reason:
      pressured.length > 0
        ? `${pressured.length} day(s) are at or above capacity; the busiest is ${pressured[0].weekday} at ${Math.round((pressured[0].utilization ?? 0) * 100)}% of daily capacity.`
        : `Projected demand stays at or below ${Math.round(todayUtilization * 100)}% of capacity for the next 7 days.`,
    days: pressured.map((day) => day.date),
  }

  const history: Forecast['history'] = {
    days: historyDays,
    encounters: profile.encounters,
    coverageDays: profile.coverageDays,
    warmingUp: profile.coverageDays < 90,
    confidence:
      profile.coverageDays >= 90 && profile.encounters >= 50
        ? 'high'
        : profile.coverageDays >= 30 && profile.encounters >= 15
          ? 'medium'
          : 'low',
    note: profile.sparse
      ? 'This clinic has almost no visit history yet. The forecast uses conservative default profiles — every visit you record improves it.'
      : profile.coverageDays < 90 && profile.importedDays > 0
        ? `The clinic has ${profile.coverageDays} day(s) of visit history, including ${profile.importedDays} imported aggregate day(s). Afribok blends that history with defaults until 90 days are recorded.`
      : profile.coverageDays < 90
        ? `The clinic has ${profile.coverageDays} day(s) of visit history. Afribok blends that with defaults until 90 days are recorded.`
        : profile.importedDays > 0
          ? `Based on ${profile.encounters} arrivals across ${profile.coverageDays} days, including ${profile.importedDays} imported aggregate day(s). Imported dates with live encounters are excluded to avoid double-counting.`
          : `Based on ${profile.encounters} visits across ${profile.coverageDays} days of this clinic’s own record.`,
  }

  return {
    generatedAt: now.toISOString(),
    horizonHours,
    history,
    now: {
      waiting,
      inConsultation,
      longestWaitMinutes: Math.round(oldestWait),
      estimatedWaitMinutes: currentWait,
      // Share of clinician time already committed to the patients in the clinic.
      consultUtilization: round(
        clamp(((inConsultation + waiting) * serviceMinutes) / (staffOnDuty * 60), 0, 1.5),
        2,
      ),
      bedOccupancy: round(Math.min(1, (inConsultation * BED_SHARE) / Math.max(1, capacity.beds)), 2),
      staffOnDuty,
    },
    hours,
    days,
    equipment,
    referral,
    assumptions: [
      `Consultation time is ${Math.round(serviceMinutes)} min, measured from completed visits on this clinic’s record.`,
      `${staffOnDuty} clinician(s) on duty; daily capacity is ${dailyCapacity} visits between ${OPEN_HOUR}:00 and ${CLOSE_HOUR}:00.`,
      'Projected bed demand assumes 30% of a visit needs an observation bed.',
      'Equipment projection assumes each item is used in 40% of visits.',
      'Arrival patterns come from this clinic only — no borrowed or synthetic history is mixed in.',
      ...(profile.importedDays > 0 ? [`${profile.importedDays} imported aggregate day(s) were used; because no hourly breakdown was supplied, imported arrivals are distributed uniformly between ${OPEN_HOUR}:00 and ${CLOSE_HOUR}:00.`] : []),
    ],
    model: {
      averageConsultMinutes: round(serviceMinutes),
      arrivalsPerWeekdayHour: !profile.sparse,
      trendPerWeek: round(profile.trendPerWeek, 2),
    },
  }
}
