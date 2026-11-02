import { useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/auth/AuthProvider'
import { Brand, BrandMark } from '@/components/Brand'
import { PermissionGate } from '@/components/ui'
import { WorkspaceProvider } from '@/workspace/WorkspaceProvider'
import { WorkspaceLayout } from '@/workspace/WorkspaceLayout'
import Landing from '@/pages/Landing'
import Login from '@/pages/Login'
import CreateAccount from '@/pages/CreateAccount'
import Dashboard from '@/pages/app/Dashboard'
import Patients from '@/pages/app/Patients'
import PatientDetail from '@/pages/app/PatientDetail'
import RegisterPatient from '@/pages/app/RegisterPatient'
import Visits from '@/pages/app/Visits'
import SyncCentre from '@/pages/app/SyncCentre'
import Audit from '@/pages/app/Audit'
import Team from '@/pages/app/Team'
import Predictive from '@/pages/app/Predictive'
import Performance from '@/pages/app/Performance'
import Triage from '@/pages/app/Triage'
import ForecastPage from '@/pages/app/Forecast'
import Setup from '@/pages/app/Setup'
import Assistant from '@/pages/app/Assistant'
import Ehr from '@/pages/app/Ehr'
import History from '@/pages/app/History'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])
  return null
}

function BootScreen({ label = 'Opening the clinic workspace…' }: { label?: string }) {
  return (
    <div className="boot-screen">
      <div className="boot-brand">
        <BrandMark size={48} />
        <span className="boot-word">AFRIBOK</span>
      </div>
      <div className="boot-line">
        <span />
      </div>
      <p>{label}</p>
    </div>
  )
}

function ProtectedRoute({
  children,
  allowIncomplete = false,
}: {
  children: ReactNode
  allowIncomplete?: boolean
}) {
  const { status, user, facility } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <BootScreen />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  // Hospital onboarding is mandatory: no dashboard until the cards are answered.
  if (!allowIncomplete && facility && !facility.onboardingComplete && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />
  }
  return <>{children}</>
}

function WorkspaceRoutes() {
  const { user } = useAuth()
  if (!user) return null
  return (
    <WorkspaceProvider key={user.id} user={user}>
      <WorkspaceLayout />
    </WorkspaceProvider>
  )
}

function NotFound() {
  return (
    <div className="not-found">
      <Brand variant="light" />
      <div className="not-found-copy">
        <p className="eyebrow eyebrow--light">404 / NOT FOUND</p>
        <h1>This page is not in the record.</h1>
        <p>The address may have changed. Return to the overview or sign in to the clinic workspace.</p>
        <div className="not-found-actions">
          <a href="/" className="btn btn--light btn--sm">
            Return to overview
          </a>
          <a href="/login" className="btn btn--ember btn--sm">
            Clinic sign-in
          </a>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<CreateAccount />} />
          <Route
            path="/setup"
            element={
              <ProtectedRoute allowIncomplete>
                <Setup />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <WorkspaceRoutes />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="patients" element={<Patients />} />
            <Route path="patients/:id" element={<PatientDetail />} />
            <Route
              path="register"
              element={
                <PermissionGate permission="patient.create">
                  <RegisterPatient />
                </PermissionGate>
              }
            />
            <Route path="visits" element={<Visits />} />
            <Route path="triage" element={<Triage />} />
            <Route path="predictive" element={<Predictive />} />
            <Route path="outflow" element={<ForecastPage />} />
            <Route path="performance" element={<Performance />} />
            <Route path="assistant" element={<Assistant />} />
            <Route path="ehr" element={<PermissionGate permission="team.manage"><Ehr /></PermissionGate>} />
            <Route path="history" element={<PermissionGate permission="team.manage"><History /></PermissionGate>} />
            <Route path="sync" element={<SyncCentre />} />
            <Route
              path="audit"
              element={
                <PermissionGate permission="audit.read">
                  <Audit />
                </PermissionGate>
              }
            />
            <Route
              path="team"
              element={
                <PermissionGate permission="team.manage">
                  <Team />
                </PermissionGate>
              }
            />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
