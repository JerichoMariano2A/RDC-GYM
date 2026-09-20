import React, { useEffect, useState, useRef, useCallback } from 'react'

const API = import.meta.env.VITE_API_BASE || 'https://rdc-gym-backend-z2di.onrender.com'

function peso(amount) {
  return `\u20B1${Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatScanTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' })
}

function daysUntilExpiry(expires) {
  if (!expires) return null
  const end = new Date(`${expires}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((end - today) / 86400000)
}

function formatExpiry(expires) {
  if (!expires) return '—'
  const d = new Date(`${expires}T00:00:00`)
  if (isNaN(d.getTime())) return expires
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function MembershipStatus({ payload }) {
  const p = payload || {}
  const balance = Number(p.balance) || 0
  const hasCoaching = !!(p.coaching && p.coaching !== 'none')
  const isInstallment = p.paymentPlan && p.paymentPlan !== 'full'
  return (
    <div className="client-display-status">
      <div className="client-display-status-title">Membership Status</div>
      <div className="client-display-status-grid">
        <div className="client-display-status-item">
          <span className="client-display-status-label">Name</span>
          <span className="client-display-status-value">{p.name || '—'}</span>
        </div>
        <div className="client-display-status-item">
          <span className="client-display-status-label">Type</span>
          <span className="client-display-status-value">{p.type || '—'}</span>
        </div>
        <div className="client-display-status-item">
          <span className="client-display-status-label">Date of Subscription</span>
          <span className="client-display-status-value">{p.subscribed || '—'}</span>
        </div>
        <div className="client-display-status-item">
          <span className="client-display-status-label">Subscription Expiration</span>
          <span className="client-display-status-value">{p.expires || '—'}</span>
        </div>
        <div className="client-display-status-item">
          <span className="client-display-status-label">Status</span>
          <span className={`client-display-status-chip ${String(p.status || '').toLowerCase() === 'active' ? 'client-display-status-chip--active' : ''}`}>
            {p.status || 'Active'}
          </span>
        </div>
        <div className="client-display-status-item">
          <span className="client-display-status-label">Coaching Sessions Progress</span>
          <span className="client-display-status-value">
            {hasCoaching ? (p.coachingLabel || '—') : 'N/A'}
          </span>
        </div>
        <div className="client-display-status-item client-display-status-item--balance">
          <span className="client-display-status-label">Balance</span>
          <span className={`client-display-status-value ${balance > 0 ? 'client-display-status-balance--due' : ''}`}>
            {isInstallment
              ? (balance > 0 ? `${peso(balance)} due` : 'Settled')
              : (balance > 0 ? `${peso(balance)} unpaid` : 'Settled')}
          </span>
        </div>
      </div>
    </div>
  )
}

function ResultCard({ event, style }) {
  const action = event.action || 'error'
  const payload = event.payload || {}
  const name = payload.name || event.member_name || ''
  const scanTime = formatScanTime(event.created_at)
  const status = String(payload.status || 'active').toLowerCase() === 'active'
    ? 'Active'
    : payload.status || 'Active'
  const expiry = payload.expires
  const daysLeft = daysUntilExpiry(expiry)
  const showReminder = daysLeft !== null && daysLeft >= 0 && daysLeft <= 3

  if (action === 'denied') {
    return (
      <div className="client-display-card" style={{ background: style?.bg }}>
        <div className="client-display-card-icon">{style?.icon}</div>
        <div className="client-display-card-label">{style?.label}</div>
        <div className="client-display-card-text">Fingerprint not recognized</div>
        <div className="client-display-card-sub">Please try again or visit the front desk.</div>
      </div>
    )
  }

  if (action === 'expired' || action === 'error') {
    return (
      <div className="client-display-card" style={{ background: style?.bg }}>
        <div className="client-display-card-icon">{style?.icon}</div>
        <div className="client-display-card-label">{style?.label}</div>
        <div className="client-display-card-text">Please contact the front desk</div>
        {action === 'expired' && <div className="client-display-card-sub">Your membership has expired.</div>}
      </div>
    )
  }

  const isCheckout = action === 'checkout'
  return (
    <div className="client-display-card" style={{ background: style?.bg }}>
      <div className="client-display-card-icon">{style?.icon}</div>
      <div className="client-display-card-label">{style?.label}</div>
      {name && <div className="client-display-card-name">Welcome, {name}!</div>}
      <div className="client-display-card-row">
        <span className="client-display-card-statusline">
          {isCheckout ? 'Check-out Successful' : 'Check-in Successful'}
        </span>
        {scanTime && <span className="client-display-card-time">{scanTime}</span>}
      </div>
      <div className="client-display-card-membership">
        <span className={`client-display-status-chip ${status === 'Active' ? 'client-display-status-chip--active' : ''}`}>
          {status}
        </span>
        <span className="client-display-card-expiry">Expires: {formatExpiry(expiry)}</span>
      </div>
      {showReminder && (
        <div className="client-display-card-reminder">
          <span style={{ color: '#fde047' }}>{'\u26A0'}</span> Your membership expires in {daysLeft === 0 ? 'today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'}`}. Please visit the front desk for renewal.
        </div>
      )}
      <div className="client-display-card-greeting">
        {isCheckout ? 'Thank you! See you next time.' : 'Have a great workout! \uD83D\uDCAA'}
      </div>
    </div>
  )
}

export default function ClientDisplay() {
  const [event, setEvent] = useState(null)
  const [showEvent, setShowEvent] = useState(false)
  const [membersInside, setMembersInside] = useState(0)
  const [nonMembersInside, setNonMembersInside] = useState(0)
  const [currentTime, setCurrentTime] = useState(new Date())
  const lastEventId = useRef(null)
  const clearTimer = useRef(null)
  const lastGrantedAt = useRef(0)

  const fetchEvent = useCallback(async () => {
    try {
      const res = await fetch(`${API}/data/client-display`)
      const data = await res.json()
      if (!data) return
      if (data.members_inside != null) {
        setMembersInside(Number(data.members_inside) || 0)
      }
      if (data.non_members_inside != null) {
        setNonMembersInside(Number(data.non_members_inside) || 0)
      }
      if (!data.id || data.id === lastEventId.current) return
      lastEventId.current = data.id

      // A granted scan (check-in/out) owns the screen for a few seconds.
      // Ignore denied/error events that trail it so the welcome background
      // is restored instead of being stuck on "ACCESS DENIED".
      if ((data.action === 'denied' || data.action === 'error') && Date.now() - lastGrantedAt.current < 6000) return

      if (data.action === 'checkin' || data.action === 'checkout') {
        lastGrantedAt.current = Date.now()
      }
      setEvent(data)
      setShowEvent(true)
      clearTimeout(clearTimer.current)
      clearTimer.current = setTimeout(() => {
        setShowEvent(false)
        setTimeout(() => setEvent(null), 600)
      }, 5000)
    } catch {}
  }, [])

  useEffect(() => {
    const timer = setInterval(fetchEvent, 2000)
    return () => clearInterval(timer)
  }, [fetchEvent])

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    document.documentElement.style.overflow = 'hidden'
    return () => { document.documentElement.style.overflow = '' }
  }, [])

  const timeText = currentTime.toLocaleTimeString('en-PH', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const dateText = currentTime.toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const action = event ? (event.action || 'error') : null
  const style = action
    ? {
        checkin: { bg: 'linear-gradient(135deg, #065f46, #047857)', icon: '\u2713', label: 'ACCESS GRANTED' },
        checkout: { bg: 'linear-gradient(135deg, #1e40af, #2563eb)', icon: '\u2713', label: 'CHECK-OUT SUCCESSFUL' },
        denied: { bg: 'linear-gradient(135deg, #991b1b, #dc2626)', icon: '\u2717', label: 'ACCESS DENIED' },
        expired: { bg: 'linear-gradient(135deg, #92400e, #d97706)', icon: '\u2717', label: 'MEMBERSHIP EXPIRED' },
        error: { bg: 'linear-gradient(135deg, #991b1b, #dc2626)', icon: '\u2717', label: 'ERROR' },
      }[action]
    : null

  return (
    <div className="client-display">
      <div className="client-display-topbar">
        <div className="client-display-clock">
          <div className="client-display-time">{timeText}</div>
          <div className="client-display-date">{dateText}</div>
        </div>
        <div className="client-display-side">
          <div className="client-display-info-panel">
            <div className="client-display-info-panel-label">GYM HOURS</div>
            <div className="client-display-info-panel-value">6:00 AM–10:00 PM</div>
          </div>
          <div className="client-display-info-panel">
            <div className="client-display-info-panel-label">MEMBERS INSIDE</div>
            <div className="client-display-info-panel-value client-display-info-panel-value--blue">{membersInside}</div>
          </div>
          <div className="client-display-info-panel">
            <div className="client-display-info-panel-label">WALK-INS INSIDE</div>
            <div className="client-display-info-panel-value client-display-info-panel-value--blue">{nonMembersInside}</div>
          </div>
        </div>
      </div>

      <div className="client-display-center">
        {!event && (
          <div className="client-display-welcome">
            <img src="/logo.png" alt="RDC Gym" className="client-display-logo" />
            <h1>Welcome to RDC Gym!</h1>
            <p>Place your finger on the scanner to check in</p>
            <div className="client-display-scan-hint">
              <div className="client-display-fingerprint-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="56" height="56">
                  <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4" />
                  <path d="M5 19.5C5.5 18 6 15 6 12c0-3.5 2.5-6 6-6 1.7 0 3.2.7 4.2 1.8" />
                  <path d="M10 12c0-1.1.9-2 2-2 .6 0 1.1.3 1.5.7" />
                  <path d="M12 16c-2.2 0-4 1.8-4 4 0 1.1.9 2 2 2s2-.9 2-2" />
                </svg>
              </div>
              <span>SCAN YOUR FINGERPRINT</span>
            </div>
          </div>
        )}

        {event && (
          <div
            className={`client-display-center-inner ${showEvent ? 'client-display-center-inner--visible' : 'client-display-center-inner--hiding'}`}
          >
            <ResultCard event={event} style={style} />
            {event.action !== 'denied' && event.action !== 'expired' && event.action !== 'error' && (
              <MembershipStatus payload={event.payload} />
            )}
          </div>
        )}
      </div>

      <div className="client-display-footer">
        <p>Please scan to enter</p>
      </div>
    </div>
  )
}
