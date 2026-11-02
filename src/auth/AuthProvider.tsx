import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ApiError, NetworkError, api } from '@/lib/api'
import type { Facility, Role, SessionUser } from '@shared/types'
import {
  clearClinicalData,
  clearDataOwnerId,
  clearSessionSnapshot,
  getDataOwnerId,
  getSessionSnapshot,
  saveSessionSnapshot,
  setDataOwnerId,
} from '@/lib/local-db'

interface LoginResponse {
  user: SessionUser
  facility: Facility
  expiresAt: string
}

interface AuthContextValue {
  user: SessionUser | null
  facility: Facility | null
  status: 'loading' | 'authenticated' | 'unauthenticated'
  offlineSession: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (input: { name: string; email: string; password: string; role: Role }) => Promise<void>
  signOut: () => Promise<void>
  refreshSession: () => Promise<void>
  expireSession: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const FALLBACK_FACILITY: Facility = {
  id: 'afribok-clinic',
  name: 'Afribok Clinic',
  location: 'Configured facility',
  mode: 'LIVE',
  onboardingComplete: true,
  registrationFields: {
    dateOfBirth: 'optional',
    phone: 'optional',
    address: 'optional',
    nationalIdentifier: 'optional',
  },
  enabledModules: ['patients', 'encounters', 'offline_sync', 'audit', 'team'],
  triageEnabled: false,
  voiceEnabled: false,
  ehrIntegrationEnabled: false,
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [facility, setFacility] = useState<Facility | null>(null)
  const [status, setStatus] = useState<AuthContextValue['status']>('loading')
  const [offlineSession, setOfflineSession] = useState(false)
  const checkedRef = useRef(false)

  const applyLocalSession = useCallback(async () => {
    try {
      const snapshot = await getSessionSnapshot()
      if (!snapshot || new Date(snapshot.expiresAt).getTime() <= Date.now()) {
        setUser(null)
        setFacility(null)
        setStatus('unauthenticated')
        return false
      }
      setUser(snapshot.user)
      setFacility(snapshot.facility ?? FALLBACK_FACILITY)
      setOfflineSession(true)
      setStatus('authenticated')
      return true
    } catch {
      setStatus('unauthenticated')
      return false
    }
  }, [])

  const verifyOnline = useCallback(async () => {
    try {
      const result = await api<{ user: SessionUser; facility: Facility }>('/api/me')
      const existing = await getSessionSnapshot().catch(() => undefined)
      const expiresAt =
        existing && new Date(existing.expiresAt).getTime() > Date.now()
          ? existing.expiresAt
          : new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
      try {
        const owner = await getDataOwnerId()
        if (owner && owner !== result.user.id) {
          await clearClinicalData()
        }
        await setDataOwnerId(result.user.id)
        await saveSessionSnapshot({
          user: result.user,
          facility: result.facility,
          expiresAt,
          savedAt: new Date().toISOString(),
        })
      } catch {
        // Local persistence can be unavailable without blocking online use.
      }
      setUser(result.user)
      setFacility(result.facility)
      setOfflineSession(false)
      setStatus('authenticated')
    } catch (error) {
      if (error instanceof NetworkError) {
        await applyLocalSession()
      } else {
        try {
          await clearSessionSnapshot()
        } catch {
          // ignore local storage failures
        }
        setUser(null)
        setFacility(null)
        setStatus('unauthenticated')
      }
    }
  }, [applyLocalSession])

  useEffect(() => {
    if (checkedRef.current) return
    checkedRef.current = true
    void verifyOnline()
  }, [verifyOnline])

  useEffect(() => {
    const onOnline = () => {
      if (!user) void verifyOnline()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [user, verifyOnline])

  const applySession = useCallback(async (result: LoginResponse) => {
    try {
      const owner = await getDataOwnerId()
      if (owner && owner !== result.user.id) {
        await clearClinicalData()
      }
      await setDataOwnerId(result.user.id)
      await saveSessionSnapshot({
        user: result.user,
        facility: result.facility,
        expiresAt: result.expiresAt,
        savedAt: new Date().toISOString(),
      })
    } catch {
      // The online session still works; offline continuity is unavailable.
    }
    setUser(result.user)
    setFacility(result.facility)
    setOfflineSession(false)
    setStatus('authenticated')
  }, [])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await api<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      await applySession(result)
    },
    [applySession],
  )

  const signUp = useCallback(
    async (input: { name: string; email: string; password: string; role: Role }) => {
      const result = await api<LoginResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      await applySession(result)
    },
    [applySession],
  )

  const signOut = useCallback(async () => {
    try {
      await api<void>('/api/auth/logout', { method: 'POST' })
    } catch {
      // Local sign-out must never be blocked by the network.
    }
    try {
      await clearClinicalData()
      await clearDataOwnerId()
      await clearSessionSnapshot()
    } catch {
      // ignore storage failures
    }
    setUser(null)
    setFacility(null)
    setOfflineSession(false)
    setStatus('unauthenticated')
  }, [])

  /** Re-read the facility after setup, so the gate lifts without a new sign-in. */
  const refreshSession = useCallback(async () => {
    try {
      const result = await api<{ user: SessionUser; facility: Facility }>('/api/me')
      setUser(result.user)
      setFacility(result.facility)
      const snapshot = await getSessionSnapshot().catch(() => undefined)
      if (snapshot) {
        await saveSessionSnapshot({
          ...snapshot,
          user: result.user,
          facility: result.facility,
          savedAt: new Date().toISOString(),
        }).catch(() => undefined)
      }
    } catch {
      // Offline: the in-memory session stays as it is.
    }
  }, [])

  const expireSession = useCallback(() => {
    void clearSessionSnapshot().catch(() => undefined)
    setUser(null)
    setFacility(null)
    setOfflineSession(false)
    setStatus('unauthenticated')
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, facility, status, offlineSession, signIn, signUp, signOut, refreshSession, expireSession }),
    [user, facility, status, offlineSession, signIn, signUp, signOut, refreshSession, expireSession],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}

export function isApiAuthError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}
