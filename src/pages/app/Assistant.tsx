import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { PageHeader } from '@/components/ui'
import { useAuth } from '@/auth/AuthProvider'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useWorkspace } from '@/workspace/WorkspaceProvider'

type Conversation = { id: string; title: string; createdAt: string; updatedAt: string }
type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }
const QUICK = [
  'How many patients are waiting right now?',
  'How many patients still need triage?',
  'Summarise today’s activity.',
  'What is the expected demand tomorrow?',
]

export default function Assistant() {
  usePageTitle('AI Assistant')
  const { user } = useAuth()
  const { patients } = useWorkspace()
  const [patientId, setPatientId] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversationId, setConversationId] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sourceNote, setSourceNote] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  async function refreshList() {
    const result = await api<{ conversations: Conversation[] }>('/api/assistant/conversations')
    setConversations(result.conversations)
  }
  async function openConversation(id: string) {
    setError('')
    setConversationId(id)
    if (!id) { setMessages([]); return }
    try {
      const result = await api<{ messages: Message[] }>(`/api/assistant/conversations/${encodeURIComponent(id)}`)
      setMessages(result.messages)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Conversation could not be opened.')
    }
  }
  useEffect(() => { void refreshList().catch((caught) => setError(caught instanceof Error ? caught.message : 'Assistant unavailable.')) }, [])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy])

  async function send(event?: FormEvent, value?: string) {
    event?.preventDefault()
    const text = (value ?? draft).trim()
    if (!text || busy) return
    setError('')
    setBusy(true)
    setDraft('')
    const provisional: Message = { id: `local-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() }
    setMessages((current) => [...current, provisional])
    try {
      const response = await api<{ conversationId: string; answer: string; createdAt: string; privacy: string }>(
        '/api/assistant/message', { method: 'POST', body: JSON.stringify({ conversationId: conversationId || undefined, message: text, patientId: patientId || undefined }) },
      )
      setConversationId(response.conversationId)
      setSourceNote(response.privacy)
      setMessages((current) => [...current, { id: `assistant-${Date.now()}`, role: 'assistant', content: response.answer, createdAt: response.createdAt }])
      await refreshList()
    } catch (caught) {
      setMessages((current) => current.filter((item) => item.id !== provisional.id))
      setDraft(text)
      setError(caught instanceof ApiError || caught instanceof Error ? caught.message : 'Message could not be sent.')
    } finally { setBusy(false) }
  }
  async function startNew() {
    setConversationId('')
    setMessages([])
    setError('')
    setSourceNote('')
  }
  async function removeConversation(id: string) {
    try {
      await api(`/api/assistant/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (conversationId === id) await startNew()
      await refreshList()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Conversation could not be removed.') }
  }

  return (
    <div className="page platform-page">
      <PageHeader
        eyebrow="PERMISSION-AWARE OPERATIONS"
        title="Afribok Assistant"
        description={<span>Ask about the live queue, triage workload, today’s activity, or operational forecasts. Answers are scoped to {user?.facilityName ?? 'your facility'}.</span>}
        actions={<button type="button" className="btn btn--outline btn--sm" onClick={() => void startNew()}><Icon name="plus" size={15} /> New conversation</button>}
      />
      <div className="notice notice--warn assistant-privacy" role="note">
        <Icon name="shield" size={16} />
        <span><strong>Permission-aware access.</strong> Select a patient only if you are authorised to open their record. Afribok checks your role and department before any record is supplied to the model. Draft notes are excluded; only approved notes are clinical record. The Assistant does not diagnose or recommend treatment.</span>
      </div>
      <div className="assistant-layout">
        <aside className="panel assistant-history">
          <div className="panel-head"><div><p className="panel-kicker">PRIVATE TO YOU</p><h2>Conversations</h2></div></div>
          {conversations.length === 0 ? <p className="assistant-muted">Your private questions will appear here.</p> : conversations.map((item) => (
            <div className={`assistant-thread${conversationId === item.id ? ' is-active' : ''}`} key={item.id}>
              <button type="button" className="assistant-thread-open" onClick={() => void openConversation(item.id)}>{item.title}</button>
              <button type="button" className="assistant-thread-delete" onClick={() => void removeConversation(item.id)} aria-label={`Delete conversation ${item.title}`}><Icon name="close" size={13} /></button>
            </div>
          ))}
          <p className="assistant-muted assistant-history-foot">Only your account can access these conversation records.</p>
        </aside>
        <section className="panel assistant-chat" aria-label="Assistant conversation">
          <div className="assistant-chat-head"><span className="assistant-orb"><Icon name="spark" size={18} /></span><div><strong>Permission-aware assistant</strong><span>{user?.departmentName ? `${user.departmentName} context` : 'Facility context'} · {patientId ? 'selected patient record' : 'no patient selected'}</span></div></div>
          <div className="assistant-messages" aria-live="polite">
            {messages.length === 0 ? (
              <div className="assistant-empty"><span className="assistant-orb assistant-orb--large"><Icon name="spark" size={24} /></span><h2>How can I help your team?</h2><p>Ask an operational question, or choose a patient to ask about their authorised record. Your conversation is private to your account.</p><div className="assistant-quick-prompts">{QUICK.map((prompt) => <button type="button" key={prompt} onClick={() => void send(undefined, prompt)}>{prompt}<Icon name="arrow-right" size={13} /></button>)}</div></div>
            ) : messages.map((message) => <article key={message.id} className={`assistant-message assistant-message--${message.role}`}><span className="assistant-message-role">{message.role === 'user' ? 'YOU' : 'AFRIBOK'}</span><p>{message.content}</p></article>)}
            {busy && <div className="assistant-message assistant-message--assistant"><span className="assistant-message-role">AFRIBOK</span><p className="assistant-thinking"><span /><span /><span /></p></div>}
            <div ref={bottom} />
          </div>
          {error && <div className="notice notice--warn assistant-error" role="alert"><Icon name="alert" size={15} />{error}</div>}
          <form className="assistant-composer" onSubmit={(event) => void send(event)}>
            <label className="assistant-patient-select">
              <span>Patient context</span>
              <select value={patientId} onChange={(event) => setPatientId(event.target.value)}>
                <option value="">No patient — operational questions only</option>
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>{patient.firstName} {patient.lastName} · {patient.hospitalNumber}</option>
                ))}
              </select>
            </label>
            <label className="sr-only" htmlFor="assistant-message">Ask an operational question</label>
            <textarea id="assistant-message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1200} rows={2} placeholder="Ask about your queue, triage workload, or forecast…" disabled={busy} />
            <button type="submit" className="btn btn--solid btn--sm" disabled={busy || !draft.trim()}>{busy ? <span className="spinner" /> : <Icon name="arrow-right" size={15} />} Send</button>
          </form>
          <p className="assistant-source-note">{sourceNote || 'No patient record is supplied unless you select one you are authorised to open.'}</p>
        </section>
      </div>
    </div>
  )
}
