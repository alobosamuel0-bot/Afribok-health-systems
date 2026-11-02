import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Brand, BrandMark } from '@/components/Brand'
import { Icon } from '@/components/Icon'
import { SavannaFallback } from '@/components/SavannaFallback'
import { useAuth } from '@/auth/AuthProvider'
import { ApiError } from '@/lib/api'

export default function Login() {
  const { signIn, status } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (status === 'authenticated') navigate('/app', { replace: true })
  }, [status, navigate])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
      navigate('/app', { replace: true })
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message)
      } else {
        setError('The clinic server could not be reached. First sign-in on a device needs a connection.')
      }
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <aside className="auth-visual" aria-hidden="true">
        <SavannaFallback login />
        <div className="auth-visual-top">
          <Brand variant="light" />
          <Link to="/" className="auth-back">
            <Icon name="arrow-left" size={14} />
            Overview
          </Link>
        </div>
        <div className="auth-visual-copy">
          <p className="eyebrow eyebrow--light">AFRIBOK · CLINICAL WORKSPACE</p>
          <h2>
            The first minute
            <br />
            should not depend
            <br />
            <em>on the network.</em>
          </h2>
          <p>
            A local-first clinic workspace, built around the reality of African public hospitals: paper,
            interruptions, shared devices and unreliable connectivity.
          </p>
        </div>
        <div className="auth-visual-foot">
          <span>
            <Icon name="wifi-off" size={13} /> Works offline after first sign-in
          </span>
          <span>
            <Icon name="shield" size={13} /> Secure facility access
          </span>
        </div>
      </aside>

      <main className="auth-form-side">
        <div className="auth-mobile-brand">
          <Brand variant="dark" />
        </div>

        <div className="auth-form-wrap">
          <div className="auth-heading">
            <p className="eyebrow">CLINIC ACCESS</p>
            <h1>Sign in to your clinic.</h1>
            <p>
              Use the clinic email and password issued to your facility.
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="email">Clinic email</label>
              <div className="input-with-icon">
                <Icon name="mail" size={16} />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  placeholder="name@clinic.org"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                                      }}
                  required
                  aria-invalid={Boolean(error) || undefined}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="input-with-icon">
                <Icon name="lock" size={16} />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                                      }}
                  required
                  aria-invalid={Boolean(error) || undefined}
                />
                <button
                  type="button"
                  className="input-action"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Icon name={showPassword ? 'eye-off' : 'eye'} size={16} />
                </button>
              </div>
            </div>

            {error && (
              <p className="auth-error" role="alert">
                <Icon name="alert" size={15} />
                {error}
              </p>
            )}

            <button type="submit" className="btn btn--solid auth-submit" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spinner" /> Signing in…
                </>
              ) : (
                <>
                  Sign in to the workspace
                  <Icon name="arrow-right" size={16} />
                </>
              )}
            </button>

            <p className="auth-session-note">
              <Icon name="clock" size={12} />
              Sessions expire after 12 hours. Sync any queued changes before signing out.
            </p>

            <p className="auth-switch">
              New to this clinic? <Link to="/register">Create an account</Link>
            </p>
          </form>

          <div className="auth-legal">
            <BrandMark size={20} />
            <p>
              Afribok keeps clinic workflows moving across unreliable connections. <Link to="/">Return to overview</Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
