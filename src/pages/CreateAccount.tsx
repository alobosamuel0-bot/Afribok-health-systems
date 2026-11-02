import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Role } from '@shared/types'
import { ROLE_LABELS } from '@shared/types'
import { Brand } from '@/components/Brand'
import { Icon } from '@/components/Icon'
import { SavannaFallback } from '@/components/SavannaFallback'
import { useAuth } from '@/auth/AuthProvider'
import { ApiError } from '@/lib/api'

const SIGNUP_ROLES: Role[] = ['registration', 'nurse', 'clinician', 'auditor']

export default function CreateAccount() {
  const { signUp, status } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('registration')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (status === 'authenticated') navigate('/app', { replace: true })
  }, [status, navigate])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (password.length < 10) {
      setError('Use at least 10 characters for the password.')
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setSubmitting(true)
    try {
      await signUp({ name: name.trim(), email: email.trim(), password, role })
      navigate('/app', { replace: true })
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'The clinic server could not be reached. Creating an account needs a connection.',
      )
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
            One account,
            <br />
            every device
            <br />
            <em>in the clinic.</em>
          </h2>
          <p>
            The account is stored on the clinic server, not just this browser. After the first sign-in the
            workspace keeps working offline on this device.
          </p>
        </div>
        <div className="auth-visual-foot">
          <span>
            <Icon name="shield" size={13} /> Role checked on every request
          </span>
          <span>
            <Icon name="clock" size={13} /> Sessions expire after 12 hours
          </span>
        </div>
      </aside>

      <main className="auth-form-side">
        <div className="auth-mobile-brand">
          <Brand variant="dark" />
        </div>

        <div className="auth-form-wrap">
          <div className="auth-heading">
            <p className="eyebrow">NEW ACCOUNT</p>
            <h1>Create your clinic account.</h1>
            <p>The account is saved in the clinic database, so it works from any device afterwards.</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="name">Full name</label>
              <div className="input-with-icon">
                <Icon name="team" size={16} />
                <input
                  id="name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  placeholder="Adaeze Okafor"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  minLength={2}
                />
              </div>
            </div>

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
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="role">Your role</label>
              <select
                id="role"
                name="role"
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                {SIGNUP_ROLES.map((value) => (
                  <option value={value} key={value}>
                    {ROLE_LABELS[value]}
                  </option>
                ))}
              </select>
              <p className="field-help">
                Administrator access is granted later by an existing administrator in Team &amp; roles.
              </p>
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="input-with-icon">
                <Icon name="lock" size={16} />
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 10 characters"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={10}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="confirm-password">Confirm password</label>
              <div className="input-with-icon">
                <Icon name="lock" size={16} />
                <input
                  id="confirm-password"
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Repeat the password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  required
                  minLength={10}
                />
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
                  <span className="spinner" /> Creating the account…
                </>
              ) : (
                <>
                  Create account and sign in
                  <Icon name="arrow-right" size={16} />
                </>
              )}
            </button>

            <p className="auth-switch">
              Already have an account? <Link to="/login">Sign in</Link>
            </p>
          </form>
        </div>
      </main>
    </div>
  )
}
