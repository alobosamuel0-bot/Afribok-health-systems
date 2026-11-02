import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { can, ROLE_LABELS } from '@shared/types'
import { Brand, BrandMark } from '@/components/Brand'
import { Icon, type IconName } from '@/components/Icon'
import { Avatar, Modal } from '@/components/ui'
import { useAuth } from '@/auth/AuthProvider'
import { useWorkspace } from './WorkspaceProvider'
import { formatDate, formatDateTime, plural } from '@/lib/format'

const NAV: Array<{
  to: string
  label: string
  icon: IconName
  permission?: 'audit.read' | 'team.manage'
  end?: boolean
}> = [
  { to: '/app', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/app/patients', label: 'Patients', icon: 'patients' },
  { to: '/app/visits', label: 'Visits', icon: 'encounters' },
  { to: '/app/triage', label: 'AI triage', icon: 'wave' },
  { to: '/app/predictive', label: 'Predictive engine', icon: 'chart' },
  { to: '/app/assistant', label: 'AI Assistant', icon: 'spark' },
  { to: '/app/performance', label: 'Performance', icon: 'dashboard' },
  { to: '/app/sync', label: 'Sync centre', icon: 'sync' },
  { to: '/app/ehr', label: 'EHR & integrations', icon: 'document', permission: 'team.manage' },
  { to: '/app/history', label: 'History import', icon: 'chart', permission: 'team.manage' },
  { to: '/app/audit', label: 'Audit trail', icon: 'audit', permission: 'audit.read' },
  { to: '/app/team', label: 'Team & roles', icon: 'team', permission: 'team.manage' },
  { to: '/setup', label: 'Hospital setup', icon: 'shield', permission: 'team.manage' },
]

export function WorkspaceLayout() {
  const { user, signOut } = useAuth()
  const workspace = useWorkspace()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  if (!user) return null

  const facility = workspace.facility
  const offline = !workspace.online || workspace.serverReachable === false
  const pending = workspace.pendingCount + workspace.conflictCount
  const syncLabel = workspace.syncing
    ? 'Syncing'
    : workspace.conflictCount > 0
      ? `${workspace.conflictCount} to review`
      : workspace.pendingCount > 0
        ? `${workspace.pendingCount} queued`
        : offline
          ? 'Offline'
          : 'Synced'
  const syncTone = workspace.conflictCount > 0 ? 'warn' : workspace.pendingCount > 0 ? 'pending' : offline ? 'offline' : 'ok'

  async function confirmSignOut() {
    setSigningOut(true)
    try {
      await signOut()
      navigate('/login', { replace: true })
    } finally {
      setSigningOut(false)
    }
  }

  const sidebar = (
    <aside className={`sidebar ${drawerOpen ? 'is-open' : ''}`} aria-label="Workspace navigation">
      <div className="sidebar-top">
        <Brand to="/app" variant="light" compact />
        <button
          type="button"
          className="sidebar-close"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close navigation"
        >
          <Icon name="close" size={18} />
        </button>
      </div>

      <div className="facility-card">
        <span className="facility-mark">
          <BrandMark size={24} />
        </span>
        <div>
          <strong>{facility.name}</strong>
          <span>{facility.mode} facility</span>
        </div>
        <span className="facility-live" title="Facility online" />
      </div>

      <nav className="sidebar-nav">
        <span className="nav-label">Workspace</span>
        {NAV.slice(0, 6).map((item) => (
          <SidebarLink
            key={item.to}
            item={item}
            badge={item.to === '/app/sync' && pending > 0 ? (workspace.conflictCount > 0 ? '!' : String(workspace.pendingCount)) : undefined}
            badgeTone={workspace.conflictCount > 0 ? 'danger' : 'neutral'}
          />
        ))}
        <span className="nav-label nav-label--spaced">Governance</span>
        {NAV.slice(6).map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className={`sidebar-sync sidebar-sync--${syncTone}`}>
          <div className="sidebar-sync-head">
            <span className="sync-dot" />
            <span>{offline ? 'Working offline' : workspace.syncing ? 'Synchronising' : 'Local-first records'}</span>
          </div>
          <p>
            {workspace.lastSyncAt
              ? `Last sync ${formatDateTime(workspace.lastSyncAt)}`
              : 'No completed sync yet'}
          </p>
          <Link to="/app/sync">Open sync centre</Link>
        </div>

        <div className="sidebar-user">
          <Avatar firstName={user.name.split(' ')[0]} lastName={user.name.split(' ').slice(-1)[0]} size="sm" />
          <div className="sidebar-user-copy">
            <strong>{user.name}</strong>
            <span>{ROLE_LABELS[user.role]}</span>
          </div>
          <button type="button" className="sidebar-signout" onClick={() => setSignOutOpen(true)} aria-label="Sign out">
            <Icon name="logout" size={16} />
          </button>
        </div>
      </div>
    </aside>
  )

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-main">
        Skip to content
      </a>
      {sidebar}
      {drawerOpen && <button type="button" className="sidebar-scrim" onClick={() => setDrawerOpen(false)} aria-label="Close navigation" />}

      <div className="workspace-main">
        <header className="topbar">
          <button
            type="button"
            className="mobile-menu"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
          >
            <Icon name="menu" size={19} />
          </button>

          <div className="topbar-context">
            <span className="topbar-facility">{facility.name}</span>
            <span className="topbar-sep" />
            <span className="topbar-date">{formatDate(new Date().toISOString())}</span>
          </div>

          <div className="topbar-actions">
            <Link
              to="/app/sync"
              className={`sync-pill sync-pill--${syncTone}`}
              aria-label={`${syncLabel}. Open sync centre.`}
            >
              <span className={`sync-dot ${workspace.syncing ? 'sync-dot--spin' : ''}`} />
              <span>{syncLabel}</span>
            </Link>
            <span className="topbar-user">
              <Avatar firstName={user.name.split(' ')[0]} lastName={user.name.split(' ').slice(-1)[0]} size="sm" />
            </span>
          </div>
        </header>

        <div className="global-banners">

          {offline && (
            <div className="app-banner app-banner--offline" role="status">
              <Icon name="wifi-off" size={16} />
              <span>
                <strong>Offline mode.</strong> New records and visit updates are saved on this device
                {workspace.pendingCount > 0 ? ` (${plural(workspace.pendingCount, 'change')} queued)` : ''} and will sync
                when the connection returns.
              </span>
              <Link to="/app/sync">Details</Link>
            </div>
          )}

          {workspace.conflictCount > 0 && (
            <div className="app-banner app-banner--conflict" role="alert">
              <Icon name="alert" size={16} />
              <span>
                <strong>{plural(workspace.conflictCount, 'change')} need review.</strong> One or more records could
                not be applied by the server.
              </span>
              <Link to="/app/sync">Review now</Link>
            </div>
          )}

          {workspace.dataError && !offline && workspace.conflictCount === 0 && (
            <div className="app-banner app-banner--conflict" role="status">
              <Icon name="info" size={16} />
              <span>{workspace.dataError}</span>
            </div>
          )}
        </div>

        {workspace.initializing ? (
          <div className="workspace-loading">
            <span className="spinner" />
            Loading this device’s local records…
          </div>
        ) : (
          <main className="workspace-content" id="workspace-main">
            <Outlet />
          </main>
        )}

        <footer className="workspace-foot">
          <span>AFRIBOK · CLINICAL WORKSPACE</span>
          <span>Local-first records · {formatDate(new Date().toISOString())}</span>
          <span>{can(user.role, 'audit.read') ? 'Audit access' : 'Role-scoped access'} · Session {ROLE_LABELS[user.role]}</span>
        </footer>
      </div>

      <Modal
        open={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        title="Sign out of this device?"
        footer={
          <>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setSignOutOpen(false)}>
              Stay signed in
            </button>
            <button type="button" className="btn btn--danger btn--sm" onClick={confirmSignOut} disabled={signingOut}>
              {signingOut ? <span className="spinner" /> : <Icon name="logout" size={14} />}
              Sign out &amp; clear device data
            </button>
          </>
        }
      >
        <p className="modal-copy">
          Signing out removes the local clinical cache from this browser. The server keeps anything that has already
          synced.
        </p>
        {pending > 0 ? (
          <div className="notice notice--warn" style={{ marginTop: 14 }}>
            <Icon name="alert" size={16} />
            <span>
              <strong>{plural(pending, 'unsynced change')} will be discarded.</strong> Sync from the{' '}
              <Link to="/app/sync" onClick={() => setSignOutOpen(false)}>
                sync centre
              </Link>{' '}
              before signing out if you need them.
            </span>
          </div>
        ) : (
          <div className="notice" style={{ marginTop: 14 }}>
            <Icon name="info" size={16} />
            <span>All local changes have been sent to the server. Signing out clears the device copy.</span>
          </div>
        )}
      </Modal>
    </div>
  )
}

function SidebarLink({
  item,
  badge,
  badgeTone,
}: {
  item: (typeof NAV)[number]
  badge?: string
  badgeTone?: 'danger' | 'neutral'
}) {
  const { user } = useAuth()
  if (item.permission && !can(user?.role, item.permission)) return null
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
    >
      <span className="nav-icon">
        <Icon name={item.icon} size={17} />
      </span>
      <span>{item.label}</span>
      {badge && <span className={`nav-badge nav-badge--${badgeTone ?? 'neutral'}`}>{badge}</span>}
    </NavLink>
  )
}
