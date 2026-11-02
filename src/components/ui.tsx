import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { EncounterStatus, Permission, Role } from '@shared/types'
import { can } from '@shared/types'
import { useAuth } from '@/auth/AuthProvider'
import { initials, ENCOUNTER_STATUS_LABELS } from '@/lib/format'
import type { RecordSyncState } from '@/lib/local-types'
import { Icon, type IconName } from './Icon'

export function Avatar({
  firstName,
  lastName,
  size = 'md',
}: {
  firstName: string
  lastName: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const seed = `${firstName}${lastName}`.split('').reduce((total, char) => total + char.charCodeAt(0), 0)
  const palettes = [
    ['#f0dfc7', '#7c4b2c'],
    ['#e2e8d9', '#405a42'],
    ['#ecd9cf', '#8c432d'],
    ['#e4ded1', '#5c5340'],
    ['#dbe4e1', '#35574e'],
  ]
  const [background, color] = palettes[seed % palettes.length]
  return (
    <span
      className={`avatar avatar--${size}`}
      style={{ background, color }}
      aria-hidden="true"
    >
      {initials(firstName, lastName)}
    </span>
  )
}

export function StatusTag({ status }: { status: EncounterStatus }) {
  return (
    <span className={`status-tag status-tag--${status}`}>
      <span className="status-tag-dot" />
      {ENCOUNTER_STATUS_LABELS[status]}
    </span>
  )
}

export function SyncTag({ state }: { state: RecordSyncState }) {
  if (state === 'synced') return null
  const labels: Record<Exclude<RecordSyncState, 'synced'>, string> = {
    pending: 'Waiting to sync',
    conflict: 'Sync conflict',
    rejected: 'Sync rejected',
  }
  const tagClass =
    state === 'pending' ? 'tag tag--pending' : state === 'conflict' ? 'tag tag--warn' : 'tag tag--danger'
  return (
    <span className={tagClass}>
      <Icon name={state === 'pending' ? 'cloud' : 'alert'} size={11} />
      {labels[state]}
    </span>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <div className="page-description">{description}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function EmptyState({
  icon = 'document',
  title,
  copy,
  action,
  compact = false,
}: {
  icon?: IconName
  title: string
  copy: string
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={`empty-state ${compact ? 'empty-state--compact' : ''}`}>
      <span className="empty-icon">
        <Icon name={icon} size={20} />
      </span>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="notice notice--danger" role="alert">
      <Icon name="alert" size={16} />
      <span>{children}</span>
    </div>
  )
}

export function InfoNote({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'ok' }) {
  return (
    <div className={`notice ${tone === 'warn' ? 'notice--warn' : tone === 'ok' ? 'notice--ok' : ''}`}>
      <Icon name={tone === 'warn' ? 'alert' : tone === 'ok' ? 'check' : 'info'} size={16} />
      <span>{children}</span>
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      focusable?.focus()
    }, 30)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = originalOverflow
      previouslyFocused.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={panelRef}
        className={`modal-panel ${wide ? 'modal-panel--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
            <Icon name="close" size={17} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  )
}

export function PermissionGate({
  permission,
  children,
}: {
  permission: Permission
  children: ReactNode
}) {
  const { user } = useAuth()
  if (!can(user?.role, permission)) {
    return (
      <div className="access-denied">
        <span className="access-denied-icon">
          <Icon name="lock" size={22} />
        </span>
        <h1>This area is restricted.</h1>
        <p>Your role does not include access to this part of the workspace. Ask your facility administrator if you need it.</p>
        <Link to="/app" className="btn btn--outline btn--sm">
          Return to dashboard
        </Link>
      </div>
    )
  }
  return <>{children}</>
}

export function RoleTag({ role }: { role: Role }) {
  return <span className="role-tag">{role.replace('_', ' ')}</span>
}

export function MeterRow({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="meter-row">
      <div className="meter-row-head">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="meter-track">
        <span style={{ width: `${percent}%`, background: tone }} />
      </div>
    </div>
  )
}
