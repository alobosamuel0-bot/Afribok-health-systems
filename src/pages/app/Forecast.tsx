import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Capacity, Forecast } from '@shared/clinical'
import { can } from '@shared/types'
import { Icon } from '@/components/Icon'
import { ErrorNote, InfoNote, PageHeader } from '@/components/ui'
import { useAuth } from '@/auth/AuthProvider'
import { usePageTitle } from '@/hooks/usePageTitle'
import { fetchForecast, saveCapacity } from '@/lib/ai-client'

const HISTORY_OPTIONS = [
  { value: 90, label: '90 days' },
  { value: 365, label: '12 months' },
  { value: 1095, label: '3 years' },
]

const HORIZON_OPTIONS = [
  { value: 8, label: 'Next 8 hours' },
  { value: 24, label: 'Next 24 hours' },
  { value: 48, label: 'Next 48 hours' },
]

function hourLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export default function ForecastPage() {
  usePageTitle('Outflow forecast')
  const { user } = useAuth()
  const [historyDays, setHistoryDays] = useState(90)
  const [horizonHours, setHorizonHours] = useState(24)
  const [forecast, setForecast] = useState<Forecast | null>(null)
  const [capacity, setCapacity] = useState<Capacity | null>(null)
  const [draft, setDraft] = useState<Omit<Capacity, 'updatedAt'> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const canEditCapacity = can(user?.role, 'team.manage')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchForecast(historyDays, horizonHours)
      setForecast(result.forecast)
      setCapacity(result.capacity)
      setDraft({
        consultRooms: result.capacity.consultRooms,
        beds: result.capacity.beds,
        clinicians: result.capacity.clinicians,
        equipment: result.capacity.equipment,
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The forecast could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [historyDays, horizonHours])

  useEffect(() => {
    void load()
  }, [load])

  const peak = useMemo(() => {
    if (!forecast) return 1
    return Math.max(1, ...forecast.hours.map((hour) => hour.expectedArrivals))
  }, [forecast])

  async function persistCapacity() {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      const next = await saveCapacity(draft)
      setCapacity(next)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Capacity could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page forecast-page">
      <PageHeader
        eyebrow="OPERATIONS · OUTFLOW"
        title="Patient outflow forecast"
        description={
          <>
            <span>Learned from this clinic’s own visits</span>
            <span className="dot-separator" />
            <span>Hourly queue, staffing, beds, equipment and referral days</span>
          </>
        }
        actions={
          <div className="forecast-selectors">
            <select value={historyDays} onChange={(event) => setHistoryDays(Number(event.target.value))}>
              {HISTORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  History: {option.label}
                </option>
              ))}
            </select>
            <select value={horizonHours} onChange={(event) => setHorizonHours(Number(event.target.value))}>
              {HORIZON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && !forecast && <div className="panel forecast-loading">Reading the clinic’s visit history…</div>}

      {forecast && (
        <>
          <div className="forecast-kpis">
            <div className="forecast-kpi">
              <span>Waiting now</span>
              <strong>{forecast.now.waiting}</strong>
              <small>{forecast.now.inConsultation} in consultation</small>
            </div>
            <div className="forecast-kpi">
              <span>Estimated wait</span>
              <strong>{forecast.now.estimatedWaitMinutes} min</strong>
              <small>Longest waiting {forecast.now.longestWaitMinutes} min</small>
            </div>
            <div className="forecast-kpi">
              <span>Consult utilisation</span>
              <strong>{Math.round(forecast.now.consultUtilization * 100)}%</strong>
              <small>{forecast.now.staffOnDuty} clinician(s) on duty</small>
            </div>
            <div className={`forecast-kpi ${forecast.referral.recommended ? 'forecast-kpi--alert' : 'forecast-kpi--ok'}`}>
              <span>Referral pressure</span>
              <strong>{forecast.referral.recommended ? 'Plan referrals' : 'Manage in house'}</strong>
              <small>{forecast.referral.reason}</small>
            </div>
          </div>

          <div className="forecast-grid">
            <section className="panel">
              <div className="panel-head panel-head--tight">
                <div>
                  <p className="panel-kicker">HOURLY PROJECTION</p>
                  <h2>Arrivals and queue over the next {forecast.horizonHours} hours</h2>
                </div>
                <span className="forecast-peak">Peak {peak.toFixed(1)}/hour</span>
              </div>
              <div className="forecast-chart" role="img" aria-label="Hourly expected arrivals and waiting patients">
                {forecast.hours.map((hour) => (
                  <div className="forecast-bar" key={hour.hour}>
                    <div className="forecast-bar-track">
                      <div
                        className="forecast-bar-arrivals"
                        style={{ height: `${Math.max(3, (hour.expectedArrivals / peak) * 100)}%` }}
                        title={`${hour.expectedArrivals} expected arrivals`}
                      />
                      <div
                        className="forecast-bar-waiting"
                        style={{ height: `${Math.max(0, Math.min(100, (hour.expectedWaiting / Math.max(1, peak * 2)) * 100))}%` }}
                        title={`${hour.expectedWaiting} waiting`}
                      />
                    </div>
                    <span>{hourLabel(hour.hour)}</span>
                  </div>
                ))}
              </div>
              <div className="forecast-legend">
                <span><i className="legend-arrivals" /> Expected arrivals</span>
                <span><i className="legend-waiting" /> Projected queue</span>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head panel-head--tight">
                <div>
                  <p className="panel-kicker">THIS WEEK</p>
                  <h2>Days that need referrals or extra cover</h2>
                </div>
              </div>
              <div className="forecast-days">
                {forecast.days.map((day) => (
                  <div className={`forecast-day${day.referralRecommended ? ' is-pressured' : ''}`} key={day.date}>
                    <div>
                      <strong>{day.weekday}</strong>
                      <small>{dayLabel(day.date)}</small>
                    </div>
                    <div className="forecast-day-bar">
                      <span style={{ width: `${Math.min(100, day.utilization * 100)}%` }} />
                    </div>
                    <div className="forecast-day-numbers">
                      <strong>{day.expectedVisits}</strong>
                      <small>of {day.capacityVisits}</small>
                    </div>
                    <span className={`forecast-day-tag${day.referralRecommended ? ' is-alert' : ''}`}>
                      {Math.round(day.utilization * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head panel-head--tight">
                <div>
                  <p className="panel-kicker">BEDS &amp; EQUIPMENT</p>
                  <h2>Projected use for the rest of today</h2>
                </div>
              </div>
              <div className="forecast-resource">
                <span>Observation beds</span>
                <div className="forecast-meters">
                  <div className="forecast-meter">
                    <span style={{ width: `${Math.min(100, forecast.now.bedOccupancy * 100)}%` }} />
                  </div>
                  <strong>{Math.round(forecast.now.bedOccupancy * 100)}%</strong>
                </div>
                <small>{capacity?.beds ?? 0} beds configured</small>
              </div>
              {forecast.equipment.length === 0 && <p className="cell-muted">No equipment configured yet.</p>}
              {forecast.equipment.map((item) => (
                <div className="forecast-resource" key={item.name}>
                  <span>{item.name}</span>
                  <div className="forecast-meters">
                    <div className="forecast-meter">
                      <span style={{ width: `${Math.min(100, item.utilization * 100)}%` }} />
                    </div>
                    <strong>{Math.round(item.utilization * 100)}%</strong>
                  </div>
                  <small>
                    {item.projectedUse} uses against {item.units} unit(s)
                    {item.shortfall > 0 ? ` · short by ${item.shortfall}` : ''}
                  </small>
                </div>
              ))}
            </section>

            <section className="panel">
              <div className="panel-head panel-head--tight">
                <div>
                  <p className="panel-kicker">HOW THIS IS BUILT</p>
                  <h2>History and confidence</h2>
                </div>
                <span className={`tag tag--${forecast.history.confidence === 'low' ? 'warn' : 'ok'}`}>
                  {forecast.history.confidence} confidence
                </span>
              </div>
              <p className="forecast-note">{forecast.history.note}</p>
              <dl className="forecast-facts">
                <div>
                  <dt>Visits in window</dt>
                  <dd>{forecast.history.encounters}</dd>
                </div>
                <div>
                  <dt>Days of history</dt>
                  <dd>{forecast.history.coverageDays}</dd>
                </div>
                <div>
                  <dt>Average consultation</dt>
                  <dd>{forecast.model.averageConsultMinutes} min</dd>
                </div>
                <div>
                  <dt>Weekly trend</dt>
                  <dd>{forecast.model.trendPerWeek > 0 ? '+' : ''}{forecast.model.trendPerWeek} visits</dd>
                </div>
              </dl>
              <ul className="forecast-assumptions">
                {forecast.assumptions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {forecast.history.warmingUp && (
                <InfoNote tone="warn">
                  This clinic has {forecast.history.coverageDays} day(s) of history. Afribok keeps improving the
                  forecast until 90 days are recorded, then it runs on the clinic’s own pattern alone.
                </InfoNote>
              )}
            </section>
          </div>

          <section className="panel">
            <div className="panel-head panel-head--tight">
              <div>
                <p className="panel-kicker">CLINIC CAPACITY</p>
                <h2>Rooms, beds, clinicians and equipment</h2>
              </div>
              {saved && <span className="tag tag--ok">Saved</span>}
            </div>
            {draft && (
              <div className="capacity-form">
                <label>
                  Consultation rooms
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={draft.consultRooms}
                    disabled={!canEditCapacity}
                    onChange={(event) => setDraft({ ...draft, consultRooms: Number(event.target.value) })}
                  />
                </label>
                <label>
                  Observation beds
                  <input
                    type="number"
                    min={0}
                    max={200}
                    value={draft.beds}
                    disabled={!canEditCapacity}
                    onChange={(event) => setDraft({ ...draft, beds: Number(event.target.value) })}
                  />
                </label>
                <label>
                  Clinicians on duty
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={draft.clinicians}
                    disabled={!canEditCapacity}
                    onChange={(event) => setDraft({ ...draft, clinicians: Number(event.target.value) })}
                  />
                </label>
                <div className="capacity-equipment">
                  <span>Equipment</span>
                  {draft.equipment.map((item, index) => (
                    <div className="capacity-equipment-row" key={`${item.name}-${index}`}>
                      <input
                        value={item.name}
                        disabled={!canEditCapacity}
                        onChange={(event) => {
                          const next = [...draft.equipment]
                          next[index] = { ...item, name: event.target.value }
                          setDraft({ ...draft, equipment: next })
                        }}
                      />
                      <input
                        type="number"
                        min={0}
                        max={200}
                        value={item.units}
                        disabled={!canEditCapacity}
                        onChange={(event) => {
                          const next = [...draft.equipment]
                          next[index] = { ...item, units: Number(event.target.value) }
                          setDraft({ ...draft, equipment: next })
                        }}
                      />
                    </div>
                  ))}
                </div>
                {canEditCapacity && (
                  <div className="capacity-actions">
                    <button
                      type="button"
                      className="btn btn--outline btn--sm"
                      onClick={() =>
                        setDraft({ ...draft, equipment: [...draft.equipment, { name: '', units: 1 }] })
                      }
                    >
                      <Icon name="plus" size={14} /> Add equipment
                    </button>
                    <button
                      type="button"
                      className="btn btn--solid btn--sm"
                      onClick={() => void persistCapacity()}
                      disabled={saving}
                    >
                      {saving ? 'Saving…' : 'Save capacity'}
                    </button>
                  </div>
                )}
              </div>
            )}
            <p className="page-footnote">
              Forecasts describe expected workload, not clinical outcomes. On a day flagged for referral, the clinician
              still decides who needs transfer.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
