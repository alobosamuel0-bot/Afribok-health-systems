import { useEffect, useState, type ChangeEvent } from 'react'
import { ApiError, api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { PageHeader } from '@/components/ui'
import { usePageTitle } from '@/hooks/usePageTitle'

type ImportRow = { id: string; fileName: string; rowCount: number; skippedCount: number; createdAt: string }
type Metric = { date: string; department: string; arrivals: number; triaged: number; completed: number; waiting: number }
type Quality = { days: number; arrivals: number; fromDate: string | null; toDate: string | null }

export default function History() {
  usePageTitle('Historical operations data')
  const [imports, setImports] = useState<ImportRow[]>([])
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [quality, setQuality] = useState<Quality | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    const data = await api<{ imports: ImportRow[]; metrics: Metric[]; quality: Quality }>('/api/history')
    setImports(data.imports); setMetrics(data.metrics); setQuality(data.quality)
  }
  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : 'History could not be loaded.')).finally(() => setLoading(false)) }, [])
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    setError(''); setNotice('')
    const next = event.target.files?.[0] ?? null
    if (next && next.size > 450_000) { setFile(null); setError('Choose a CSV smaller than 450 KB.'); return }
    setFile(next)
  }
  async function importFile() {
    if (!file) return
    setError(''); setNotice(''); setSaving(true)
    try {
      const csv = await file.text()
      const result = await api<{ importedRows: number; skippedRows: number; note: string }>('/api/history/import', {
        method: 'POST', body: JSON.stringify({ fileName: file.name, csv }),
      })
      setNotice(`${result.importedRows} aggregate row(s) imported; ${result.skippedRows} skipped. ${result.note}`)
      setFile(null)
      await load()
    } catch (caught) { setError(caught instanceof ApiError || caught instanceof Error ? caught.message : 'Import failed. No aggregate data was changed.') }
    finally { setSaving(false) }
  }
  return (
    <div className="page platform-page">
      <PageHeader eyebrow="PREDICTIVE ENGINE · HISTORY" title="Bring in historical operations" description={<span>Import aggregate daily counts to strengthen the forecast. Records are validated before saving, and individual patient data is not accepted by this tool.</span>} />
      <div className="notice notice--warn" role="note"><Icon name="shield" size={16} /><span><strong>Aggregate data only.</strong> CSV columns containing patient names, identifiers, phone numbers, addresses, diagnoses, or complaints are rejected. Do not upload identifiable patient records here.</span></div>
      {error && <div className="notice notice--warn platform-notice" role="alert"><Icon name="alert" size={15} />{error}</div>}
      {notice && <div className="notice notice--ok platform-notice" role="status"><Icon name="check" size={15} />{notice}</div>}
      <section className="metric-grid history-metrics">
        <article className="metric-card"><span>IMPORTED DAYS</span><strong>{quality?.days ?? '—'}</strong><small>Department/date aggregates</small></article>
        <article className="metric-card"><span>RECORDED ARRIVALS</span><strong>{quality?.arrivals ?? '—'}</strong><small>Across accepted imports</small></article>
        <article className="metric-card"><span>HISTORY WINDOW</span><strong>{quality?.fromDate ? `${quality.fromDate} – ${quality.toDate}` : 'No data yet'}</strong><small>Source range present</small></article>
      </section>
      <div className="platform-grid">
        <section className="panel history-import-panel">
          <div className="panel-head"><div><p className="panel-kicker">CSV IMPORT</p><h2>Operational summary file</h2></div><span className="integration-status">MAX 450 KB</span></div>
          <div className="history-template"><strong>Required columns</strong><code>date, arrivals</code><span>Optional: department, triaged, completed, waiting</span><small>Dates: YYYY-MM-DD or DD/MM/YYYY · Counts must be non-negative whole numbers.</small></div>
          <label className="history-file">Choose a CSV file<input type="file" accept=".csv,text/csv" onChange={(event) => void choose(event)} /></label>
          {file && <div className="selected-file"><Icon name="document" size={16} /><span>{file.name}</span><small>{(file.size / 1024).toFixed(0)} KB</small></div>}
          <button className="btn btn--solid btn--sm" type="button" onClick={() => void importFile()} disabled={!file || saving}>{saving ? <span className="spinner" /> : <Icon name="arrow-up-right" size={14} />} Validate and import</button>
          <p className="field-hint">Imports are auditable and update aggregate counts by date and department. If a later file contains the same department/date, the newer counts replace that aggregate row rather than being added twice.</p>
        </section>
        <section className="panel">
          <div className="panel-head"><div><p className="panel-kicker">PREDICTIVE ENGINE</p><h2>Forecast data quality</h2></div><span className="integration-status">{quality?.days ? `${quality.days} records` : 'Warming up'}</span></div>
          <p className="assistant-muted">Imported daily counts are kept separate from patient records. Forecasts should show the data period and uncertainty; uploaded data is not assumed complete or reliable solely because it exists.</p>
          <div className="history-data-quality"><span>Imported dates</span><strong>{quality?.fromDate && quality?.toDate ? `${quality.fromDate} to ${quality.toDate}` : 'None'}</strong></div>
          <div className="history-data-quality"><span>Latest upload</span><strong>{imports[0] ? new Date(imports[0].createdAt).toLocaleString() : 'None'}</strong></div>
        </section>
      </div>
      <section className="panel platform-events">
        <div className="panel-head"><div><p className="panel-kicker">AUDITABLE IMPORTS</p><h2>Recent files</h2></div></div>
        {loading ? <p className="assistant-muted">Loading…</p> : imports.length === 0 ? <p className="assistant-muted">No operational history imported yet. The hospital can still build its own record from day one.</p> : <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Uploaded</th><th>File</th><th>Rows imported</th><th>Rows skipped</th></tr></thead><tbody>{imports.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString()}</td><td>{item.fileName}</td><td>{item.rowCount}</td><td>{item.skippedCount}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="panel platform-events">
        <div className="panel-head"><div><p className="panel-kicker">RECENT AGGREGATES</p><h2>Department history</h2></div></div>
        {metrics.length === 0 ? <p className="assistant-muted">No aggregate metrics available.</p> : <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Date</th><th>Department</th><th>Arrivals</th><th>Triaged</th><th>Completed</th><th>Waiting</th></tr></thead><tbody>{metrics.slice(0, 60).map((metric, index) => <tr key={`${metric.date}-${metric.department}-${index}`}><td>{metric.date}</td><td>{metric.department}</td><td>{metric.arrivals}</td><td>{metric.triaged}</td><td>{metric.completed}</td><td>{metric.waiting}</td></tr>)}</tbody></table></div>}
      </section>
    </div>
  )
}
