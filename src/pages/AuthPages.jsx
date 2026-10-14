import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { useAuth } from '../context/AuthContext'
import { ArrowRight, ArrowUpRight, LockKeyhole } from 'lucide-react'

function GoogleLogo() {
  return <svg aria-hidden="true" className="google-logo" viewBox="0 0 48 48">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 4)" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.4-4.55H24v9.02h12.9c-.58 2.96-2.26 5.48-4.75 7.18l7.73 6C44.38 38.04 46.98 31.93 46.98 24.55Z" />
    <path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.9 23.9 0 0 0 0 21.56l7.98-6.19Z" transform="translate(0 4)" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.14 1.45-4.87 2.3-8.17 2.3-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
  </svg>
}

function GoogleSignInButton({ returnTo, onError, onLoadingChange, disabled }) {
  const { signInWithGoogle } = useAuth()
  const [loading, setLoading] = useState(false)

  async function handleGoogleSignIn() {
    setLoading(true)
    onLoadingChange(true)
    onError('')
    try {
      sessionStorage.setItem('rentmate.auth.returnTo', returnTo)
      await signInWithGoogle()
    } catch (err) {
      sessionStorage.removeItem('rentmate.auth.returnTo')
      const message = (err?.message || '').toLowerCase()
      onError(message.includes('provider is not enabled') || message.includes('unsupported provider')
        ? 'Google sign-in is not enabled for this Supabase project yet.'
        : friendlyError(err))
      setLoading(false)
      onLoadingChange(false)
    }
  }

  return <button type="button" className="google-signin-button" onClick={handleGoogleSignIn} disabled={disabled || loading} aria-busy={loading}>
    {loading ? <span className="google-button-spinner" aria-hidden="true" /> : <GoogleLogo />}
    <span>{loading ? 'Connecting to Google…' : 'Continue with Google'}</span>
  </button>
}

function requestedPath(location) {
  const from = location.state?.from
  const path = from ? `${from.pathname || '/'}${from.search || ''}${from.hash || ''}` : '/'
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/auth/callback') ? path : '/'
}

function friendlyError(error) {
  const message = (error?.message || '').toLowerCase()
  if (message.includes('already registered') || message.includes('already been registered') || message.includes('user already exists')) return 'That email already has an account. Try signing in instead.'
  if (message.includes('invalid login') || message.includes('invalid credentials')) return 'That email and password don’t match. Give it another try.'
  if (message.includes('weak password') || message.includes('at least')) return 'Choose a stronger password with at least 6 characters.'
  if (message.includes('email not confirmed')) return 'Please verify your email before signing in.'
  return error?.message || 'Something went wrong. Please try again.'
}

function PasswordInput({ id, label, value, onChange, autoComplete }) {
  const [visible, setVisible] = useState(false)
  return <Input id={id} label={label} type={visible ? 'text' : 'password'} value={value} onChange={onChange} autoComplete={autoComplete} required minLength={6} trailing={<button className="password-toggle" type="button" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? 'Hide' : 'Show'}</button>} />
}

export function LoginPage() {
  const { login, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  if (!authLoading && user) return <Navigate to={requestedPath(location)} replace />

  async function handleSubmit(event) {
    event.preventDefault(); setError('')
    if (password.length < 6) { setError('Your password needs at least 6 characters.'); return }
    setLoading(true)
    try { await login({ email: email.trim(), password }); navigate(location.state?.from?.pathname || '/', { replace: true }) }
    catch (err) { setError(friendlyError(err)) }
    finally { setLoading(false) }
  }

  return <AuthLayout mode="login">
    <div className="form-heading"><h2>Welcome back</h2><p>Sign in to continue to your RentMate account.</p></div>
    <GoogleSignInButton returnTo={requestedPath(location)} onError={setError} onLoadingChange={setGoogleLoading} disabled={loading} />
    <div className="auth-divider" aria-hidden="true"><span>or sign in with email</span></div>
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <Input id="email" label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required />
      <PasswordInput id="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      {error && <p className="form-error" role="alert"><span aria-hidden="true">!</span>{error}</p>}
      <Button type="submit" loading={loading} disabled={googleLoading} className="submit-button">Sign in <ArrowUpRight size={17} /></Button>
    </form>
    <p className="switch-auth">New to RentMate? <Link to="/register">Create an account <ArrowRight size={15} /></Link></p>
    <div className="form-note"><span className="note-lock"><LockKeyhole /></span> Your account is private and secure.</div>
  </AuthLayout>
}

export function RegisterPage() {
  const { register, user, loading: authLoading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  if (!authLoading && user) return <Navigate to={requestedPath(location)} replace />

  async function handleSubmit(event) {
    event.preventDefault(); setError(''); setNotice('')
    if (!fullName.trim()) { setError('Please enter your full name.'); return }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter a valid email address to continue.'); return }
    if (password.length < 6) { setError('Choose a password with at least 6 characters.'); return }
    if (password !== confirmPassword) { setError('Those passwords don’t match yet.'); return }
    setLoading(true)
    try {
      const result = await register({ fullName: fullName.trim(), email: email.trim(), password })
      if (!result.session) setNotice('You’re almost there! Check your inbox for a verification link, then come back to sign in.')
      else navigate('/', { replace: true })
    } catch (err) { setError(friendlyError(err)) }
    finally { setLoading(false) }
  }

  return <AuthLayout mode="register">
    <div className="form-heading"><h2>Create your account</h2><p>Join RentMate to borrow nearby or list items to rent.</p></div>
    <GoogleSignInButton returnTo={requestedPath(location)} onError={setError} onLoadingChange={setGoogleLoading} disabled={loading} />
    <div className="auth-divider" aria-hidden="true"><span>or sign up with email</span></div>
    <form className="auth-form register-form" onSubmit={handleSubmit} noValidate>
      <Input id="fullName" label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" placeholder="How should we call you?" required />
      <Input id="email" label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required />
      <PasswordInput id="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      <PasswordInput id="confirmPassword" label="Confirm password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
      {error && <p className="form-error" role="alert"><span aria-hidden="true">!</span>{error}</p>}
      {notice && <p className="form-success" role="status">{notice}</p>}
      <Button type="submit" loading={loading} disabled={googleLoading} className="submit-button">Create account <ArrowUpRight size={17} /></Button>
    </form>
    <p className="switch-auth">Already have an account? <Link to="/login">Sign in <ArrowRight size={15} /></Link></p>
    <div className="form-note"><span className="note-lock"><LockKeyhole /></span> Your account information stays private.</div>
  </AuthLayout>
}

