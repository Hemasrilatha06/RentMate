import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'

function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/auth/callback')) return '/'
  try {
    const parsed = new URL(value, window.location.origin)
    return parsed.origin === window.location.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : '/'
  } catch {
    return '/'
  }
}

export default function AuthCallbackPage() {
  const navigate = useNavigate()
  const { loading: authLoading } = useAuth()
  const handled = useRef(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (handled.current || authLoading) return
    handled.current = true

    async function finishSignIn() {
      if (!supabase) {
        setError('Authentication is not configured. Please contact the site owner.')
        return
      }
      const query = new URLSearchParams(window.location.search)
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const providerError = query.get('error_description') || query.get('error') || hash.get('error_description') || hash.get('error')
      if (providerError) {
        setError('Google sign-in could not be completed. Please try again.')
        return
      }

      try {
        // Supabase Auth processes the OAuth return when the existing client loads.
        // Reading the session here avoids a second code exchange or auth client.
        const { data, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        if (!data.session?.user) {
          setError('We could not confirm your Google session. Please try signing in again.')
          return
        }
        const destination = safeReturnPath(sessionStorage.getItem('rentmate.auth.returnTo'))
        sessionStorage.removeItem('rentmate.auth.returnTo')
        navigate(destination, { replace: true })
      } catch {
        setError('Google sign-in could not be completed. Please try again.')
      }
    }

    finishSignIn()
  }, [authLoading, navigate])

  if (error) return <AuthLayout mode="login">
    <div className="form-heading"><h2>Sign-in needs another try.</h2><p>{error}</p></div>
    <Link className="button submit-button" to="/login">Back to sign in</Link>
  </AuthLayout>

  return <div className="route-loading" role="status" aria-live="polite">Completing Google sign-in…</div>
}
