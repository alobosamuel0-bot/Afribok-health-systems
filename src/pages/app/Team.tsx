import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Department, Role, TeamMember } from '@shared/types'
import { ROLE_LABELS, ROLES } from '@shared/types'
import { Icon } from '@/components/Icon'
import { Avatar, ErrorNote, InfoNote, Modal, PageHeader } from '@/components/ui'
import { ApiError, api } from '@/lib/api'
import { useAuth } from '@/auth/AuthProvider'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDateTime } from '@/lib/format'

export default function Team() {
  usePageTitle('Team & roles')
  const { user } = useAuth()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Role>>({})
  const [confirmDeactivate, setConfirmDeactivate] = useState<TeamMember | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({
    name: '', email: '', password: '', role: 'clinician' as Role,
    staffNumber: '', phone: '', departmentId: '',
  })

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [result, departmentResult] = await Promise.all([
        api<{ members: TeamMember[] }>('/api/team'),
        api<{ departments: Department[] }>('/api/departments'),
      ])
      setMembers(result.members)
      setDepartments(departmentResult.departments)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The team could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const activeAdmins = members.filter((member) => member.role === 'admin' && member.active).length
  const activeCount = members.filter((member) => member.active).length
  const roleCounts = useMemo(
    () =>
      ROLES.map((role) => ({
        role,
        count: members.filter((member) => member.role === role && member.active).length,
      })),
    [members],
  )

  async function patchMember(
    member: TeamMember,
    patch: { role?: Role; active?: boolean; departmentId?: string | null },
  ) {
    setSavingId(member.id)
    setError(null)
    setMessage(null)
    try {
      const result = await api<{ member: TeamMember }>(`/api/team/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      setMembers((current) => current.map((item) => (item.id === result.member.id ? result.member : item)))
      setRoleDrafts((current) => {
        const next = { ...current }
        delete next[member.id]
        return next
      })
      setMessage(`${result.member.name} updated. Existing role checks use the new access immediately.`)
      setConfirmDeactivate(null)
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'The team member could not be updated.',
      )
    } finally {
      setSavingId(null)
    }
  }

  async function createMember(event: FormEvent) {
    event.preventDefault()
    setCreating(true); setError(null); setMessage(null)
    try {
      const result = await api<{ member: TeamMember }>('/api/team', {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          staffNumber: draft.staffNumber || null,
          phone: draft.phone || null,
          departmentId: draft.departmentId || null,
        }),
      })
      setMembers((current) => [...current, result.member].sort((a, b) => a.name.localeCompare(b.name)))
      setMessage(`${result.member.name} can now sign in with their own account.`)
      setCreateOpen(false)
      setDraft({ name: '', email: '', password: '', role: 'clinician', staffNumber: '', phone: '', departmentId: '' })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The staff account could not be created.')
    } finally { setCreating(false) }
  }

  return (
    <div className="page team-page">
      <PageHeader
        eyebrow="ADMINISTRATION · ROLES"
        title="Team & roles"
        description={
          <>
            <span>{activeCount} active accounts</span>
            <span className="dot-separator" />
            <span>{activeAdmins} active administrator{activeAdmins === 1 ? '' : 's'}</span>
            <span className="dot-separator" />
            <span>Least-privilege access enforced by the server</span>
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn--solid btn--sm" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={14} /> Add staff member
            </button>
            <button type="button" className="btn btn--outline btn--sm" onClick={load} disabled={loading}>
              <Icon name="sync" size={14} /> Refresh
            </button>
          </>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {message && (
        <div className="notice notice--ok" role="status" style={{ marginBottom: 16 }}>
          <Icon name="check" size={16} />
          <span>{message}</span>
        </div>
      )}

      <div className="team-stats">
        {roleCounts.map(({ role, count }) => (
          <div className="team-stat" key={role}>
            <span>{ROLE_LABELS[role]}</span>
            <strong>{count}</strong>
          </div>
        ))}
      </div>

      <section className="panel team-panel">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">FACILITY ACCOUNTS</p>
            <h2>Clinic access</h2>
          </div>
          <span className="panel-count">{members.length}</span>
        </div>

        {loading ? (
          <div className="panel-loading">
            <span className="spinner" /> Loading team accounts…
          </div>
        ) : (
          <div className="team-list">
            <div className="team-list-head">
              <span>Member</span>
              <span>Role</span>
              <span>Department</span>
              <span>Access</span>
              <span>Last sign-in</span>
              <span>Action</span>
            </div>
            {members.map((member) => {
              const draft = roleDrafts[member.id] ?? member.role
              const changed = draft !== member.role
              const isSelf = member.id === user?.id
              return (
                <div className={`team-row ${member.active ? '' : 'is-inactive'}`} key={member.id}>
                  <div className="cell-patient">
                    <Avatar firstName={member.name.split(' ')[0]} lastName={member.name.split(' ').slice(-1)[0]} size="sm" />
                    <div>
                      <strong>
                        {member.name} {isSelf && <span className="you-tag">you</span>}
                      </strong>
                      <small>{member.email}</small>
                    </div>
                  </div>
                  <div className="team-role-cell">
                    <select
                      value={draft}
                      onChange={(event) =>
                        setRoleDrafts((current) => ({ ...current, [member.id]: event.target.value as Role }))
                      }
                      disabled={isSelf || savingId === member.id || !member.active}
                      aria-label={`Role for ${member.name}`}
                    >
                      {ROLES.map((role) => (
                        <option value={role} key={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                    {changed && (
                      <button
                        type="button"
                        className="btn btn--solid btn--xs"
                        onClick={() => patchMember(member, { role: draft })}
                        disabled={savingId === member.id}
                      >
                        {savingId === member.id ? <span className="spinner" /> : null}
                        Save role
                      </button>
                    )}
                  </div>
                  <div className="team-dept-cell">
                    <select
                      value={member.departmentId ?? ''}
                      onChange={(event) => void patchMember(member, { departmentId: event.target.value || null })}
                      disabled={!member.active || savingId === member.id || member.id === user?.id}
                      aria-label={`Department for ${member.name}`}
                    >
                      <option value="">No department</option>
                      {departments.map((department) => (
                        <option key={department.id} value={department.id}>
                          {department.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className={`tag ${member.active ? 'tag--ok' : 'tag--pending'}`}>
                      {member.active ? 'Active' : 'Deactivated'}
                    </span>
                  </div>
                  <span className="team-last">{member.lastSignInAt ? formatDateTime(member.lastSignInAt) : 'Never'}</span>
                  <div className="team-actions">
                    {member.active ? (
                      <button
                        type="button"
                        className="btn btn--outline btn--xs"
                        onClick={() => setConfirmDeactivate(member)}
                        disabled={isSelf || member.role === 'admin' && activeAdmins <= 1 || savingId === member.id}
                        title={isSelf ? 'You cannot deactivate your own account' : undefined}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--outline btn--xs"
                        onClick={() => patchMember(member, { active: true })}
                        disabled={isSelf || savingId === member.id}
                      >
                        {savingId === member.id ? <span className="spinner" /> : null}
                        Reactivate
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <p className="table-foot">
          Server-side middleware re-checks every permission. Changing a role does not require the account to sign in
          again, and deactivation revokes existing sessions.
        </p>
      </section>

      <div className="team-notes">
        <InfoNote>
          Each account should be individually provisioned and protected with facility-approved identity policies.
        </InfoNote>
        <div className="panel role-notes">
          <p className="panel-kicker">ROLE MODEL</p>
          <h3>What each role can do</h3>
          <ul className="bullet-list">
            <li><strong>Registration</strong> — search patients, register and open visits. No clinical update.</li>
            <li><strong>Nurse / clinician</strong> — check patients in, move visits into consultation and complete them.</li>
            <li><strong>Administrator</strong> — full workflow plus audit and team administration.</li>
            <li><strong>Auditor</strong> — read patients, visits and audit. Cannot change workflow records.</li>
          </ul>
          <p className="panel-footnote">
            Stage 1 has no clinical-note access to restrict. Future clinical modules must extend this permission model
            before they are enabled.
          </p>
        </div>
      </div>

      <Modal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        title="Create a staff account"
        footer={
          <>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</button>
            <button type="submit" form="staff-create-form" className="btn btn--solid btn--sm" disabled={creating}>
              {creating ? <span className="spinner" /> : <Icon name="plus" size={14} />} Create account
            </button>
          </>
        }
      >
        <form id="staff-create-form" className="platform-form" onSubmit={(event) => void createMember(event)}>
          <label>Full name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required maxLength={80} /></label>
          <label>Email (sign-in name)<input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} required maxLength={200} /></label>
          <label>Staff / payroll number<input value={draft.staffNumber} onChange={(event) => setDraft({ ...draft, staffNumber: event.target.value })} maxLength={40} /></label>
          <label>Phone<input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} maxLength={40} /></label>
          <label>Professional role<select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}>{ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></label>
          <label>Department<select value={draft.departmentId} onChange={(event) => setDraft({ ...draft, departmentId: event.target.value })}><option value="">No department</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label>Temporary password<input type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} required minLength={10} autoComplete="new-password" /><span className="field-hint">At least 10 characters. Share it through the hospital’s approved channel; the staff member should change it.</span></label>
        </form>
      </Modal>

      <Modal
        open={confirmDeactivate !== null}
        onClose={() => setConfirmDeactivate(null)}
        title={`Deactivate ${confirmDeactivate?.name ?? 'this account'}?`}
        footer={
          <>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setConfirmDeactivate(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={() => confirmDeactivate && patchMember(confirmDeactivate, { active: false })}
              disabled={savingId === confirmDeactivate?.id}
            >
              {savingId === confirmDeactivate?.id ? <span className="spinner" /> : <Icon name="lock" size={14} />}
              Deactivate account
            </button>
          </>
        }
      >
        <p className="modal-copy">
          The account will be signed out immediately and cannot sign in again. Existing audit events and records they
          created remain intact. You cannot deactivate your own account.
        </p>
      </Modal>
    </div>
  )
}
