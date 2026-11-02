import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { PageHeader } from '@/components/ui'
import { usePageTitle } from '@/hooks/usePageTitle'

type Integration = {
  vendor: string; standard: 'FHIR_R4' | 'HL7_V2' | 'REST'; endpointUrl: string
  readEnabled: boolean; writeEnabled: boolean; hasCredential: boolean; status: string
  lastTestAt: string | null; lastError: string | null; updatedAt: string
  capabilities: { metadataTest: boolean; patientRead: boolean; approvedWriteBack: boolean }
}
type Event = { action: string; success: number; detail: Record<string, unknown>; createdAt: string }
const labelStatus: Record<string, string> = { not_configured: 'Not configured', configured: 'Configured · not tested', tested: 'Metadata test passed', error: 'Test failed', paused: 'Paused' }

export default function Ehr() {
  usePageTitle('EHR & integrations')
  const [integration, setIntegration] = useState<Integration | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [vendor, setVendor] = useState('')
  const [standard, setStandard] = useState<Integration['standard']>('FHIR_R4')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [credential, setCredential] = useState('')
  const [readEnabled, setReadEnabled] = useState(false)
  const [writeEnabled, setWriteEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    const result = await api<{ integration: Integration | null; events: Event[] }>('/api/ehr/integration')
    setIntegration(result.integration)
    setEvents(result.events)
    if (result.integration) {
      setVendor(result.integration.vendor)
      setStandard(result.integration.standard)
      setEndpointUrl(result.integration.endpointUrl)
      setReadEnabled(result.integration.readEnabled)
      setWriteEnabled(result.integration.writeEnabled)
    }
  }
  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : 'EHR settings unavailable.')).finally(() => setLoading(false)) }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    setError(''); setNotice(''); setSaving(true)
    try {
      const result = await api<{ integration: Integration; message: string }>('/api/ehr/integration', {
        method: 'PUT', body: JSON.stringify({ vendor, standard, endpointUrl, readEnabled, writeEnabled, credential }),
      })
      setIntegration(result.integration); setCredential(''); setNotice(result.message); await load()
    } catch (caught) { setError(caught instanceof ApiError || caught instanceof Error ? caught.message : 'Settings could not be saved.') }
    finally { setSaving(false) }
  }
  async function testConnection() {
    setError(''); setNotice(''); setTesting(true)
    try {
      const result = await api<{ integration: Integration; success: boolean; message: string }>('/api/ehr/integration/test', { method: 'POST', body: '{}' })
      setIntegration(result.integration); setNotice(result.message); await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Connection test failed.') }
    finally { setTesting(false) }
  }
  async function pause() {
    setError(''); setNotice('')
    try { const result = await api<{ integration: Integration }>('/api/ehr/integration/pause', { method: 'POST', body: '{}' }); setIntegration(result.integration); setNotice('Connector paused. No EHR data exchange is running.') ; await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Connector could not be paused.') }
  }
  async function resume() {
    setError(''); setNotice('')
    try { const result = await api<{ integration: Integration }>('/api/ehr/integration/resume', { method: 'POST', body: '{}' }); setIntegration(result.integration); setNotice('Connector resumed. It keeps its last tested endpoint status.') ; await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Connector could not be resumed.') }
  }
  async function disconnect() {
    setError(''); setNotice('')
    try {
      await api('/api/ehr/integration', { method: 'DELETE' })
      setIntegration(null); setVendor(''); setEndpointUrl(''); setCredential(''); setReadEnabled(false); setWriteEnabled(false)
      setNotice('Connector disconnected and its stored credential removed. Mapping history remains in the audit log.')
      await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Connector could not be disconnected.') }
  }

  return (
    <div className="page platform-page">
      <PageHeader eyebrow="EHR MANAGEMENT" title="Connect the hospital record system" description={<span>Configure a connector, test endpoint availability, and keep integration status visible. Afribok’s own patient and encounter records remain available when there is no external EHR.</span>} />
      <div className="notice notice--warn" role="note"><Icon name="shield" size={16} /><span><strong>Honest connector status.</strong> A successful check confirms metadata or HTTP reachability only. Patient reads, mapping, sync, and approved write-back are not active until a specific vendor connector is implemented and validated with that hospital.</span></div>
      {error && <div className="notice notice--warn platform-notice" role="alert"><Icon name="alert" size={15} />{error}</div>}
      {notice && <div className="notice notice--ok platform-notice" role="status"><Icon name="check" size={15} />{notice}</div>}
      <div className="platform-grid">
        <section className="panel ehr-form-panel">
          <div className="panel-head"><div><p className="panel-kicker">EXTERNAL RECORDS</p><h2>Connector setup</h2></div><span className={`integration-status integration-status--${integration?.status ?? 'not_configured'}`}>{labelStatus[integration?.status ?? 'not_configured']}</span></div>
          {loading ? <p className="assistant-muted">Loading integration settings…</p> : (
            <form className="platform-form" onSubmit={(event) => void save(event)}>
              <label>System or vendor name<input value={vendor} onChange={(event) => setVendor(event.target.value)} maxLength={120} required placeholder="e.g. Hospital EHR / vendor" /></label>
              <label>Integration standard<select value={standard} onChange={(event) => setStandard(event.target.value as Integration['standard'])}><option value="FHIR_R4">FHIR R4</option><option value="HL7_V2">HL7 v2 (interface engine)</option><option value="REST">Vendor REST API</option></select></label>
              <label>Approved endpoint URL<input type="url" value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} maxLength={1000} required placeholder="https://ehr.example.org/fhir/R4" /></label>
              <label>Bearer credential (optional)<input type="password" value={credential} onChange={(event) => setCredential(event.target.value)} maxLength={2000} autoComplete="new-password" placeholder={integration?.hasCredential ? 'Saved securely; leave blank to keep current credential' : 'Paste only an approved integration token'} /></label>
              <p className="field-hint">Credentials are encrypted at rest on this server and never returned to the browser. Use HTTPS for remote systems; HTTP is accepted only for a local hospital-network host.</p>
              <label className="platform-checkbox"><input type="checkbox" checked={readEnabled} onChange={(event) => setReadEnabled(event.target.checked)} /><span><strong>Read access approved by the hospital</strong><small>Enables patient demographic lookups through the tested FHIR R4 connector.</small></span></label>
              <label className="platform-checkbox"><input type="checkbox" checked={writeEnabled} onChange={(event) => setWriteEnabled(event.target.checked)} /><span><strong>Approved write-back to the external EHR</strong><small>Only a clinician-approved note can be written, as a FHIR DocumentReference. Drafts are never sent.</small></span></label>
              <div className="platform-actions"><button className="btn btn--solid btn--sm" type="submit" disabled={saving}>{saving ? <span className="spinner" /> : <Icon name="check" size={14} />} Save configuration</button>{integration && <button className="btn btn--outline btn--sm" type="button" onClick={() => void testConnection()} disabled={testing}>{testing ? <span className="spinner" /> : <Icon name="sync" size={14} />} Test endpoint</button>}</div>
            </form>
          )}
        </section>
        <section className="panel ehr-status-panel">
          <div className="panel-head"><div><p className="panel-kicker">CAPABILITIES</p><h2>What is available</h2></div></div>
          <div className="capability-row"><span className="capability-mark is-ready"><Icon name="check" size={14} /></span><div><strong>Afribok patient record</strong><small>Local patient profiles and visits are active.</small></div><em>Available</em></div>
          <div className="capability-row"><span className={`capability-mark ${integration?.status === 'tested' ? 'is-ready' : ''}`}><Icon name={integration?.status === 'tested' ? 'check' : 'clock'} size={14} /></span><div><strong>Endpoint metadata test</strong><small>Checks a FHIR CapabilityStatement or REST HTTP response.</small></div><em>{integration?.status === 'tested' ? 'Tested' : 'Not verified'}</em></div>
          <div className="capability-row"><span className={`capability-mark ${integration?.capabilities.patientRead ? 'is-ready' : ''}`}><Icon name={integration?.capabilities.patientRead ? 'check' : 'clock'} size={14} /></span><div><strong>External patient read</strong><small>FHIR Patient search mapped into the selected patient record.</small></div><em>{integration?.capabilities.patientRead ? 'Available' : 'Not enabled'}</em></div>
          <div className="capability-row"><span className={`capability-mark ${integration?.capabilities.approvedWriteBack ? 'is-ready' : ''}`}><Icon name={integration?.capabilities.approvedWriteBack ? 'check' : 'clock'} size={14} /></span><div><strong>Approved write-back</strong><small>Clinician-approved notes only, with duplicate protection.</small></div><em>{integration?.capabilities.approvedWriteBack ? 'Available' : 'Not enabled'}</em></div>
          <div className="capability-row"><span className="capability-mark"><Icon name="clock" size={14} /></span><div><strong>External patient read</strong><small>Requires vendor resource mapping, consent, and validation.</small></div><em>Pending</em></div>
          <div className="capability-row"><span className="capability-mark"><Icon name="lock" size={14} /></span><div><strong>Approved write-back</strong><small>Clinical entries must be reviewed by an authorised professional first.</small></div><em>Pending</em></div>
          {integration?.status === 'error' && integration.lastError && <div className="notice notice--warn"><Icon name="alert" size={15} /><span>{integration.lastError}</span></div>}
          <div className="platform-actions">
            {integration && integration.status !== 'paused' && <button className="btn btn--outline btn--sm" type="button" onClick={() => void pause()}><Icon name="pause" size={14} /> Pause connector</button>}
            {integration?.status === 'paused' && <button className="btn btn--solid btn--sm" type="button" onClick={() => void resume()}><Icon name="sync" size={14} /> Resume connector</button>}
            {integration && <button className="btn btn--danger btn--sm" type="button" onClick={() => void disconnect()}><Icon name="close" size={14} /> Disconnect &amp; remove credential</button>}
          </div>
        </section>
      </div>
      <section className="panel platform-events">
        <div className="panel-head"><div><p className="panel-kicker">AUDITABLE OPERATIONS</p><h2>Recent connector activity</h2></div></div>
        {events.length === 0 ? <p className="assistant-muted">No connector activity yet.</p> : <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Time</th><th>Action</th><th>Result</th><th>Details</th></tr></thead><tbody>{events.map((event, index) => <tr key={`${event.createdAt}-${index}`}><td>{new Date(event.createdAt).toLocaleString()}</td><td>{event.action.replaceAll('_', ' ')}</td><td><span className={`integration-status ${event.success ? 'integration-status--tested' : 'integration-status--error'}`}>{event.success ? 'Success' : 'Needs attention'}</span></td><td>{String(event.detail.message ?? event.detail.standard ?? 'Configuration changed')}</td></tr>)}</tbody></table></div>}
      </section>
    </div>
  )
}
