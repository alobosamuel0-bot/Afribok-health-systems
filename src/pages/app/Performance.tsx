import { useEffect, useState } from 'react'
import type { PerformanceReport } from '@shared/types'
import { ErrorNote, MeterRow, PageHeader } from '@/components/ui'
import { api } from '@/lib/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDateTime } from '@/lib/format'

function minutes(value: number | null): string {
  if (value === null) return 'Not enough data'
  if (value < 60) return `${Math.round(value)} min`
  return `${Math.floor(value / 60)}h ${Math.round(value % 60)}m`
}

export default function Performance() {
  usePageTitle('Performance')
  const [report, setReport] = useState<PerformanceReport | null>(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    api<{ performance: PerformanceReport }>(`/api/performance?days=${days}`)
      .then((result) => setReport(result.performance))
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Performance data could not be loaded.'))
      .finally(() => setLoading(false))
  }, [days])

  return (
    <div className="page performance-page">
      <PageHeader
        eyebrow="MEASUREMENT · OPERATIONAL PERFORMANCE"
        title="Measured, not claimed"
        description={<span>Every figure below comes from timestamps recorded in this hospital’s visits. Missing data is shown as unavailable.</span>}
        actions={
          <label className="performance-window">
            Window
            <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
        }
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading || !report ? (
        <div className="workspace-loading"><span className="spinner" /> Reading recorded timestamps…</div>
      ) : (
        <>
          <section className="stat-grid">
            <article className="stat-card"><span className="stat-label">Registered</span><strong className="stat-value">{report.counts.registered}</strong><span className="stat-foot">Patient records created</span></article>
            <article className="stat-card"><span className="stat-label">Triaged</span><strong className="stat-value">{report.counts.triaged}</strong><span className="stat-foot">Visits with an assessment</span></article>
            <article className="stat-card"><span className="stat-label">Consulted</span><strong className="stat-value">{report.counts.consulted}</strong><span className="stat-foot">Consultation started</span></article>
            <article className="stat-card"><span className="stat-label">Completed</span><strong className="stat-value">{report.counts.completed}</strong><span className="stat-foot">Closed visits</span></article>
            <article className="stat-card stat-card--accent"><span className="stat-label">Urgent open</span><strong className="stat-value">{report.counts.urgentOpen}</strong><span className="stat-foot">Triage level 1–2, not completed</span></article>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div><p className="panel-kicker">WAITING-TIME STATISTICS</p><h2>Recorded across {report.windowDays} days</h2></div>
              <span className="integration-status">{formatDateTime(report.generatedAt)}</span>
            </div>
            <div className="performance-timings">
              <div><span>Arrival → registration</span><strong>{minutes(report.timings.arrivalToRegistrationMinutes)}</strong></div>
              <div><span>Registration → triage</span><strong>{minutes(report.timings.registrationToTriageMinutes)}</strong></div>
              <div><span>Triage → doctor</span><strong>{minutes(report.timings.triageToDoctorMinutes)}</strong></div>
              <div><span>Total wait</span><strong>{minutes(report.timings.totalWaitMinutes)}</strong></div>
              <div><span>Doctor documentation</span><strong>{minutes(report.timings.documentationMinutes)}</strong></div>
            </div>
            <ul className="bullet-list">
              {report.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </section>

          <div className="platform-grid">
            <section className="panel">
              <div className="panel-head"><div><p className="panel-kicker">DAILY FLOW</p><h2>Registered and completed</h2></div></div>
              <div className="performance-daily">
                {report.daily.map((day) => (
                  <div className="performance-day" key={day.date}>
                    <span>{day.date.slice(5)}</span>
                    <MeterRow label="Registered" value={day.registered} max={Math.max(1, ...report.daily.map((item) => item.registered))} tone="#c57c47" />
                    <MeterRow label="Completed" value={day.completed} max={Math.max(1, ...report.daily.map((item) => item.registered))} tone="#6c8a72" />
                  </div>
                ))}
              </div>
            </section>
            <section className="panel">
              <div className="panel-head"><div><p className="panel-kicker">DEPARTMENT WORKLOAD</p><h2>Authorised operational view</h2></div></div>
              {report.departments.length === 0 ? <p className="assistant-muted">No departments configured.</p> : (
                <div className="platform-table-wrap">
                  <table className="platform-table">
                    <thead><tr><th>Department</th><th>Visits</th><th>Triaged</th><th>Completed</th><th>Average wait</th></tr></thead>
                    <tbody>
                      {report.departments.map((department) => (
                        <tr key={department.id ?? department.name}>
                          <td>{department.name}</td><td>{department.registered}</td><td>{department.triaged}</td>
                          <td>{department.completed}</td><td>{minutes(department.averageWaitMinutes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="panel-footnote">Baseline comparison becomes available once the hospital records a full period before and after deployment. Afribok does not invent a baseline.</p>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
