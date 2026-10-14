import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import Button from './ui/Button'
import { Bell, CalendarDays, LogOut, MessageCircle, Plus, Search, Package, Volume2, VolumeX } from 'lucide-react'
import './Navbar.css'


function readNotificationSoundPreference(userId) {
  if (!userId || typeof window === 'undefined') return true
  try { return window.localStorage.getItem(`rentmate:notification-sound:${userId}`) !== 'off' } catch { return true }
}

function playNotificationTone(context) {
  try {
    const start = context.currentTime
    ;[740, 988].forEach((frequency, index) => {
      const at = start + index * 0.12
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, at)
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.075, at + 0.014)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.19)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(at)
      oscillator.stop(at + 0.2)
    })
  } catch {
    // Audio is optional; browser/device audio failures must not affect notifications.
  }
}

function notificationError(error) {
  if (error?.code === '42501') return 'You do not have access to this notification.'
  if (error?.code === '22023') return error.message || 'This return cannot be confirmed yet.'
  return error?.message || 'We could not complete that notification action. Please try again.'
}

export default function Navbar() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState('')
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationsError, setNotificationsError] = useState('')
  const [returnNotification, setReturnNotification] = useState(null)
  const [returnError, setReturnError] = useState('')
  const [confirmingReturn, setConfirmingReturn] = useState(false)
  const [toast, setToast] = useState(null)
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(() => readNotificationSoundPreference(user?.id))
  const toastTimer = useRef(null)
  const seenNotificationIds = useRef(new Set())
  const audioContextRef = useRef(null)
  const soundEnabledRef = useRef(notificationSoundEnabled)
  const pendingNotificationTone = useRef(false)
  const fullName = user?.user_metadata?.full_name || user?.email || 'Member'
  const initial = fullName.slice(0, 1).toUpperCase()

  useEffect(() => {
    seenNotificationIds.current.clear()
    pendingNotificationTone.current = false
    const enabled = readNotificationSoundPreference(user?.id)
    soundEnabledRef.current = enabled
    setNotificationSoundEnabled(enabled)
  }, [user?.id])

  useEffect(() => {
    if (!user?.id || !notificationSoundEnabled) return undefined
    const resumeAudio = () => {
      try {
        const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
        if (!AudioContextConstructor) return
        const context = audioContextRef.current || new AudioContextConstructor()
        audioContextRef.current = context
        const playPending = () => {
          if (!pendingNotificationTone.current || !soundEnabledRef.current) return
          pendingNotificationTone.current = false
          playNotificationTone(context)
        }
        if (context.state === 'running') playPending()
        else context.resume().then(playPending).catch(() => {})
      } catch {
        // Keep sound locked by the browser until a later user gesture.
      }
    }
    window.addEventListener('pointerdown', resumeAudio, true)
    window.addEventListener('keydown', resumeAudio, true)
    return () => {
      window.removeEventListener('pointerdown', resumeAudio, true)
      window.removeEventListener('keydown', resumeAudio, true)
    }
  }, [notificationSoundEnabled, user?.id])

  useEffect(() => () => {
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') audioContextRef.current.close().catch(() => {})
    audioContextRef.current = null
  }, [])

  function playBookingNotificationSound() {
    if (!soundEnabledRef.current) return
    pendingNotificationTone.current = true
    try {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
      if (!AudioContextConstructor) return
      const context = audioContextRef.current || new AudioContextConstructor()
      audioContextRef.current = context
      if (context.state === 'running') {
        pendingNotificationTone.current = false
        playNotificationTone(context)
      } else {
        context.resume().then(() => {
          if (!pendingNotificationTone.current || !soundEnabledRef.current) return
          pendingNotificationTone.current = false
          playNotificationTone(context)
        }).catch(() => {})
      }
    } catch {
      // A later user gesture will retry audio unlock if autoplay is blocked.
    }
  }

  function toggleNotificationSound() {
    const enabled = !soundEnabledRef.current
    soundEnabledRef.current = enabled
    if (!enabled) pendingNotificationTone.current = false
    setNotificationSoundEnabled(enabled)
    try { window.localStorage.setItem(`rentmate:notification-sound:${user.id}`, enabled ? 'on' : 'off') } catch { /* Preference remains available for this session. */ }
  }

  const loadNotifications = useCallback(async () => {
    if (!supabase || !user?.id) return
    const [{ data, error: listError }, { count, error: countError }] = await Promise.all([
      supabase.from('notifications').select('id, user_id, type, title, body, booking_id, is_read, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_read', false),
    ])
    if (listError) throw listError
    if (countError) throw countError
    ;(data || []).forEach((notification) => {
      if (notification.id) seenNotificationIds.current.add(notification.id)
    })
    setNotifications(data || [])
    setUnreadCount(count || 0)
    const pendingReturn = (data || []).find((notification) => notification.type === 'return_requested' && !notification.is_read)
    if (pendingReturn) setReturnNotification((current) => current || pendingReturn)
  }, [user?.id])

  useEffect(() => {
    if (!user?.id || !supabase) return undefined
    let active = true
    setNotificationsError('')
    loadNotifications().catch((loadError) => { if (active) setNotificationsError(notificationError(loadError)) })
    const channel = supabase.channel(`notifications:${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        const notification = payload.new
        if (!notification?.id || notification.user_id !== user.id || seenNotificationIds.current.has(notification.id)) return
        seenNotificationIds.current.add(notification.id)
        setNotifications((current) => [notification, ...current.filter((entry) => entry.id !== notification.id)].slice(0, 30))
        if (!notification.is_read) setUnreadCount((count) => count + 1)
        setToast(notification)
        if (notification.type === 'booking_paid' || notification.type === 'new_booking') playBookingNotificationSound()
        if (toastTimer.current) window.clearTimeout(toastTimer.current)
        toastTimer.current = window.setTimeout(() => setToast(null), 6500)
        if (notification.type === 'return_requested') {
          setReturnError('')
          setReturnNotification(notification)
        }
      }).subscribe()
    return () => {
      active = false
      supabase.removeChannel(channel)
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [user?.id, loadNotifications])

  useEffect(() => {
    if (!notificationsOpen && !returnNotification) return undefined
    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setNotificationsOpen(false)
        setReturnNotification(null)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [notificationsOpen, returnNotification])

  async function markRead(notification) {
    if (!notification || !supabase || notifications.find((entry) => entry.id === notification.id)?.is_read) return
    const { error: updateError } = await supabase.from('notifications').update({ is_read: true }).eq('id', notification.id).eq('user_id', user.id)
    if (updateError) throw updateError
    setNotifications((current) => current.map((entry) => entry.id === notification.id ? { ...entry, is_read: true } : entry))
    setUnreadCount((count) => Math.max(0, count - 1))
  }

  async function markAllRead() {
    if (!supabase || unreadCount === 0) return
    setNotificationsError('')
    const { error: updateError } = await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false)
    if (updateError) {
      setNotificationsError(notificationError(updateError))
      return
    }
    setNotifications((current) => current.map((entry) => ({ ...entry, is_read: true })))
    setUnreadCount(0)
  }

  async function openNotification(notification) {
    setNotificationsOpen(false)
    try {
      await markRead(notification)
      if (notification.type === 'return_requested') {
        setReturnError('')
        setReturnNotification(notification)
      } else if (notification.booking_id) {
        navigate(`/bookings/${notification.booking_id}`)
      }
    } catch (readError) {
      setNotificationsError(notificationError(readError))
    }
  }

  async function dismissReturn() {
    if (returnNotification) {
      try { await markRead(returnNotification) } catch (readError) { setReturnError(notificationError(readError)) }
    }
    setReturnNotification(null)
  }

  async function confirmReturn() {
    if (!returnNotification || confirmingReturn || !supabase) return
    setConfirmingReturn(true)
    setReturnError('')
    try {
      const { data, error: updateError } = await supabase.from('bookings')
        .update({ status: 'returned' })
        .eq('id', returnNotification.booking_id)
        .eq('status', 'return_requested')
        .select('id')
        .maybeSingle()
      if (updateError) throw updateError
      if (!data) throw new Error('This booking is no longer waiting for return confirmation. Refresh the page to see its latest status.')
      setReturnNotification(null)
      setToast({ title: 'Return confirmed', body: 'The renter has been notified.', booking_id: returnNotification.booking_id })
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
      toastTimer.current = window.setTimeout(() => setToast(null), 5000)
      try {
        await markRead(returnNotification)
      } catch (readError) {
        setNotificationsError(`Return confirmed. ${notificationError(readError)}`)
      }
    } catch (updateError) {
      setReturnError(notificationError(updateError))
    } finally {
      setConfirmingReturn(false)
    }
  }

  async function handleLogout() {
    setError('')
    setLoggingOut(true)
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch {
      setError('Could not sign out. Please try again.')
    } finally {
      setLoggingOut(false)
    }
  }

  return <>
    <header className={`site-navbar${location.pathname === '/' ? ' site-navbar-home' : ''}`}>
      <div className="navbar-inner">
        <Link to="/" className="brand-mark navbar-brand" aria-label="RentMate home"><span className="brand-icon" aria-hidden="true">r</span><span>rentmate<span className="brand-period">.</span></span></Link>
        <nav className="navbar-links" aria-label="Main navigation">
          <a href="/#how-it-works" className="navbar-link">How it works</a>
          <NavLink to="/items/new" className={({ isActive }) => `navbar-link${isActive ? ' is-active' : ''}`}><Plus />List an item</NavLink>
          {user && <>
            <NavLink to="/bookings" className={({ isActive }) => `navbar-link${isActive ? ' is-active' : ''}`}><CalendarDays />My Bookings</NavLink>
            <NavLink to="/messages" className={({ isActive }) => `navbar-link${isActive ? ' is-active' : ''}`}><MessageCircle />Messages</NavLink>
            <NavLink to="/my-listings" className={({ isActive }) => `navbar-link${isActive ? ' is-active' : ''}`}><Package />My Listings</NavLink>
          </>}
          <NavLink to="/browse" className={({ isActive }) => `navbar-link${isActive ? ' is-active' : ''}`}><Search />Browse</NavLink>
        </nav>
        {user ? <div className="navbar-account">
          <div className="navbar-notifications">
            <button type="button" className="navbar-bell" aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'} aria-expanded={notificationsOpen} aria-controls="notification-dropdown" onClick={() => setNotificationsOpen((open) => !open)}>
              <Bell />{unreadCount > 0 && <span className="navbar-unread-count" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </button>
            {notificationsOpen && <section className="notification-dropdown" id="notification-dropdown" aria-label="Notifications">
              <div className="notification-dropdown-heading"><div><span className="details-section-kicker">YOUR UPDATES</span><h2>Notifications</h2></div><button type="button" className="notification-mark-all" onClick={markAllRead} disabled={!unreadCount}>Mark all as read</button></div>
              <div className="notification-sound-row"><span>Booking sounds</span><button type="button" className="notification-sound-toggle" onClick={toggleNotificationSound} aria-pressed={notificationSoundEnabled} aria-label={notificationSoundEnabled ? 'Turn booking notification sounds off' : 'Turn booking notification sounds on'}>{notificationSoundEnabled ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}{notificationSoundEnabled ? 'Sound on' : 'Sound off'}</button></div>
              {notificationsError && <p className="notification-error" role="alert">{notificationsError}</p>}
              {!notifications.length ? <p className="notification-empty">You are all caught up.</p> : <ul>{notifications.map((notification) => <li key={notification.id}><button type="button" className={`notification-entry${notification.is_read ? '' : ' is-unread'}`} onClick={() => openNotification(notification)}><span className="notification-entry-title">{notification.title}</span><span className="notification-entry-body">{notification.body}</span><time dateTime={notification.created_at}>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notification.created_at))}</time></button></li>)}</ul>}
            </section>}
          </div>
          <span className="navbar-user" title={fullName}><span className="navbar-avatar" aria-hidden="true">{initial}</span><span className="navbar-user-name">{fullName}</span></span>
          <Button type="button" className="navbar-logout" loading={loggingOut} onClick={handleLogout}><LogOut /><span>Log out</span></Button>
        </div> : <div className="navbar-account public-navbar-account"><Link to="/login" className="navbar-login-link">Log in</Link><Link to="/register" className="navbar-signup-link">Sign up</Link></div>}
      </div>
      {error && <p className="navbar-error" role="alert">{error}</p>}
    </header>
    {toast && <button type="button" className="notification-toast" onClick={() => toast.booking_id && navigate(`/bookings/${toast.booking_id}`)} aria-live="polite"><span className="details-section-kicker">RENTMATE UPDATE</span><strong>{toast.title}</strong><span>{toast.body}</span>{toast.booking_id && <span className="notification-toast-dismiss">View booking</span>}</button>}
    {returnNotification && <div className="return-confirm-overlay"><section className="return-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="return-confirm-heading" aria-describedby="return-confirm-copy"><span className="details-section-kicker">HANDOVER CHECK</span><h2 id="return-confirm-heading">Confirm this return?</h2><p id="return-confirm-copy">{returnNotification.body}</p><p className="return-confirm-item">{returnNotification.title.replace('Return confirmation needed: ', '')}</p>{returnError && <p className="notification-error" role="alert">{returnError}</p>}<div className="return-confirm-actions"><button type="button" className="return-not-yet" onClick={dismissReturn} disabled={confirmingReturn}>Not yet</button><button type="button" className="return-confirm-button" onClick={confirmReturn} disabled={confirmingReturn}>{confirmingReturn ? 'Confirming...' : 'Confirm return'}</button></div></section></div>}
  </>
}
