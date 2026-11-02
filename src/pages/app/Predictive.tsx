import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { ErrorNote, PageHeader } from '@/components/ui'
import { api } from '@/lib/api'
import { fetchForecast } from '@/lib/ai-client'
import type { Forecast } from '@shared/clinical'
import { useAuth } from '@/auth/AuthProvider'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDateTime } from '@/lib/format'

interface Card {
  key: string
  title: string
  department: string
  period: string
  value: number | string | null
  unit: string
  available: boolean
  lastUpdated: string
  historyUsed: string
  quality: string
  note: string
}

export default function Predictive() {
  usePageTitle('Predictive engine')
  const { facility } = useAuth()
  const [cards, setCards] = useState<Card[]>([])
  const [forecast, setForecast] = useState<Forecast | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      api<{ cards: Card[] }>('/api/predictions?historyDays=90'),
      fetchForecast(90, 24),
    ])
      .then(([prediction, forecastResult]) => {
        setCards(prediction.cards)
        setForecast(forecastResult.forecast)
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Predictions could not be loaded.'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="page predictive-page">
      <PageHeader
        eyebrow="WORKFLOW 04 · PREDICTIVE ENGINE"
        title="Operational demand forecast"
        description={
          <>
            <span>Inflow, outflow, departmental demand and workload</span>
            <span className="dot-separator" />
            <span>Confidence shown on every card</span>
          </>
        }
        actions={<Link to="/app/history" className="btn btn--outline btn--sm"><Icon name="arrow-up-right" size={14} /> Import history</Link>}
      />

      <section className="panel predictive-onboarding">
        <div>
          <p className="panel-kicker">PREDICTIVE ENGINE ONBOARDING</p>
          <h2>Does the hospital have at least three months of operational history?</h2>
          <p>
            Onboarding recorded: <strong>{facility?.setupSummary?.historyStatus === 'yes' ? 'history declared' : facility?.setupSummary?.historyStatus === 'partial' ? 'partial history declared' : 'no history declared'}</strong>.
            If the data is paper-based, use the paper/voice extraction on the history page; Excel, CSV and Word summaries are supported. If there is no history, Afribok starts recording from day one and labels preliminary forecasts as low confidence.
          </p>
        </div>
        <div className="predictive-onboarding-actions">
          <Link to="/app/history" className="btn btn--solid btn--sm"><Icon name="arrow-up-right" size={14} /> Bring in historical data</Link>
          <Link to="/app/outflow" className="btn btn--outline btn--sm">Hourly outflow detail</Link>
        </div>
      </section>

      {error && <ErrorNote>{error}</ErrorNote>}
      {loading ? (
        <div className="workspace-loading"><span className="spinner" /> Building predictions from recorded data…</div>
      ) : (
        <>
          <section className="prediction-grid" aria-label="Prediction cards">
            {cards.map((card) => (
              <article className={`prediction-card prediction-card--${card.quality}`} key={card.key}>
                <div className="prediction-card-head">
                  <span className="prediction-title">{card.title}</span>
                  <span className={`prediction-quality prediction-quality--${card.quality}`}>{card.quality}</span>
                </div>
                <span className="prediction-department">{card.department} · {card.period}</span>
                <strong className="prediction-value">
                  {card.available && card.value !== null
                    ? <>{card.value} <small>{card.unit}</small></>
                    : <span className="prediction-unavailable">Not enough recorded data</span>}
                </strong>
                <dl className="prediction-meta">
                  <div><dt>Historical data</dt><dd>{card.historyUsed}</dd></div>
                  <div><dt>Last updated</dt><dd>{formatDateTime(card.lastUpdated)}</dd></div>
                </dl>
                <p className="prediction-note">{card.note}</p>
              </article>
            ))}
          </section>

          {forecast && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">NEXT 7 DAYS</p>
                  <h2>Expected visits and capacity</h2>
                </div>
                <span className={`integration-status integration-status--${forecast.history.confidence === 'high' ? 'tested' : forecast.history.confidence === 'medium' ? 'configured' : 'error'}`}>
                  {forecast.history.confidence} confidence
                </span>
              </div>
              <div className="platform-table-wrap">
                <table className="platform-table">
                  <thead><tr><th>Day</th><th>Expected visits</th><th>Capacity</th><th>Utilisation</th><th>Signal</th></tr></thead>
                  <tbody>
                    {forecast.days.map((day) => (
                      <tr key={day.date}>
                        <td>{day.weekday} · {day.date}</td>
                        <td>{day.expectedVisits}</td>
                        <td>{day.capacityVisits}</td>
                        <td>{Math.round(day.utilization * 100)}%</td>
                        <td>{day.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="panel-footnote">{forecast.history.note}</p>
              <ul className="bullet-list prediction-assumptions">
                {forecast.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
