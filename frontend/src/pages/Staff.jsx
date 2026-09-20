import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  logout,
  createClient,
  createMembership,
  editMembership,
  deleteMembership,
  fetchRealtimeClients,
  fetchMemberships,
  fetchReports,
  checkoutClient,
  collectClientPayment,
  setMembershipStatus,
  fetchFingerprintStatus,
  connectFingerprint,
  disconnectFingerprint,
  enrollFingerprint,
  requestDoorEnroll,
  fetchEnrollStatus,
  removeFingerprint,
  startFingerprintScan,
  stopFingerprintScan,
  createFingerprintEventSource,
  incrementCoachingSession,
  undoCoachingSession,
  collectMembershipBalance,
  incrementClientSession,
  undoClientSession,
  collectClientBalance,
} from '../services/auth'
import Sidebar from '../components/Sidebar'
import ProfileMenu from '../components/ProfileMenu'
import RealtimeQueue from '../components/RealtimeQueue'
import { daysUntilExpiry, isMemberType, peso, todayISO } from '../utils/format'
import {
  MEMBERSHIP_JOIN_FEE,
  DEFAULT_TYPE_PRICES,
  DEFAULT_COACHING_RATES,
  addMonthsISO,
  applyPaymentPlan,
  coachingLineLabel,
  computeQuote,
  membershipLineLabel,
  monthsBetween,
  normalizeCoaching,
} from '../utils/pricing'

const staffItems = [
  { label: 'Dashboard' },
  { label: 'Input' },
  { label: 'Memberships' },
]

const paymentStatusOptions = [
  { label: 'Paid', value: 'Paid' },
  { label: 'Unpaid', value: 'Not Paid' },
]

const memberTypeOptions = [
  { label: 'Session', value: 'Member - Session' },
  { label: 'Monthly', value: 'Member - Monthly' },
]

const nonMemberTypeOptions = [
  { label: 'Session', value: 'Non-Member - Session' },
  { label: 'Session – Student', value: 'Non-Member - Student' },
  { label: 'Monthly', value: 'Non-Member - Monthly' },
]

// Enrollment live-feedback helpers
const ENROLL_STEP_LABEL = {
  waiting: 'Waiting for finger...',
  capture1: '1st capture',
  lift: 'Lift finger',
  capture2: '2nd capture',
  matching: 'Verifying match...',
  done: 'Saved',
  timeout: 'Timed out',
  nomatch: 'No match',
  error: 'Error',
}

function enrollQualityColor(q) {
  if (q >= 70) return '#16a34a'
  if (q >= 45) return '#d97706'
  return '#ef4444'
}

const coachingOptions = [
  { label: 'No Coaching', value: 'none' },
  { label: 'Daily Coaching', value: 'daily' },
  { label: 'Monthly Coaching', value: 'monthly' },
]

const paymentPlanOptions = [
  { label: 'Full Payment', value: 'full' },
  { label: 'Installment (½ now, ½ later)', value: 'installment' },
]

function buildReceiptItems(type, quote, isMember) {
  const items = []
  if (quote.membershipFee > 0) items.push({ label: 'Membership Fee', amount: quote.membershipFee })
  items.push({ label: membershipLineLabel(type, quote, isMember), amount: quote.membershipTypePrice })
  if (quote.coachingTotal > 0) items.push({ label: coachingLineLabel(quote), amount: quote.coachingTotal })
  return items
}

function QuoteCalculator({ type, quote, payment, isMember }) {
  return (
    <div className="calc-panel" aria-live="polite">
      <div className="calc-title">Total Amount to Pay</div>
      {quote.membershipFee > 0 && (
        <div className="calc-row">
          <span>Membership Fee</span>
          <span>{peso(quote.membershipFee)}</span>
        </div>
      )}
      <div className="calc-row">
        <span>{membershipLineLabel(type, quote, isMember)}</span>
        <span>{peso(quote.membershipTypePrice)}</span>
      </div>
      {quote.coachingTotal > 0 && (
        <div className="calc-row">
          <span>
            {coachingLineLabel(quote)}
            <span className="calc-sub">
              {peso(quote.coachingRate)}{quote.coachingType === 'daily' ? '/session' : '/month'}{quote.coachingType === 'monthly' ? ` × ${quote.coachingUnits} month${quote.coachingUnits === 1 ? '' : 's'}` : ''}
            </span>
          </span>
          <span>{peso(quote.coachingTotal)}</span>
        </div>
      )}
      <div className="calc-row calc-total">
        <span>Total</span>
        <span>{peso(quote.total)}</span>
      </div>
      <div className="calc-row calc-due">
        <span>Amount Due Now</span>
        <span>{peso(payment.amountDueNow)}</span>
      </div>
      {payment.balance > 0 && (
        <div className="calc-row calc-balance">
          <span>Balance (coaching installment)</span>
          <span>{peso(payment.balance)}</span>
        </div>
      )}
    </div>
  )
}

export default function Staff() {
  const [activePage, setActivePage] = useState('Dashboard')
  const [currentTime, setCurrentTime] = useState(new Date())
  const [clientName, setClientName] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('Paid')
  const [nonMemberType, setNonMemberType] = useState('Non-Member - Session')
  const [clientTypePrice, setClientTypePrice] = useState(DEFAULT_TYPE_PRICES['Non-Member - Session'])
  const [clientCoachingRate, setClientCoachingRate] = useState(DEFAULT_COACHING_RATES.daily.regular)
  const [searchTerm, setSearchTerm] = useState('')
  const [membershipFilter, setMembershipFilter] = useState('All')
  const [realtimeClients, setRealtimeClients] = useState([])
  const [memberships, setMemberships] = useState([])
  const [reports, setReports] = useState({ totalCheckIns: 0, totalCheckOuts: 0, activeMembers: 0 })
  const [newMemberName, setNewMemberName] = useState('')
  const [newMemberType, setNewMemberType] = useState('Member - Session')
  const [newMemberSubscribed, setNewMemberSubscribed] = useState(todayISO())
  const [newMemberExpires, setNewMemberExpires] = useState(addMonthsISO(todayISO(), 1))
  const [newMemberCoaching, setNewMemberCoaching] = useState('none')
  const [newMemberSessions, setNewMemberSessions] = useState(1)
  const [newMemberIsStudent, setNewMemberIsStudent] = useState(false)
  const [newMemberPlan, setNewMemberPlan] = useState('full')
  const [newMemberFee, setNewMemberFee] = useState(MEMBERSHIP_JOIN_FEE)
  const [newMemberTypePrice, setNewMemberTypePrice] = useState(DEFAULT_TYPE_PRICES['Member - Session'])
  const [newMemberTypeQuantity, setNewMemberTypeQuantity] = useState(1)
  const [newMemberCoachingRate, setNewMemberCoachingRate] = useState(DEFAULT_COACHING_RATES.daily.regular)
  const [clientCoaching, setClientCoaching] = useState('none')
  const [clientSessions, setClientSessions] = useState(1)
  const [clientIsStudent, setClientIsStudent] = useState(false)
  const [clientPlan, setClientPlan] = useState('full')
  const [clientPaymentMethod, setClientPaymentMethod] = useState('Cash')
  const [memberPaymentMethod, setMemberPaymentMethod] = useState('Cash')
  const [clientSessionThreshold, setClientSessionThreshold] = useState(15)
  const [newMemberSessionThreshold, setNewMemberSessionThreshold] = useState(15)
  const [confirmModal, setConfirmModal] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editingMembership, setEditingMembership] = useState(null)
  const [statusMessage, setStatusMessage] = useState(null)
  const [inputMode, setInputMode] = useState('choose')
  const [fpStatus, setFpStatus] = useState({ connected: false, scanning: false, enrolling: null, driverAvailable: false })
  const [fpPort, setFpPort] = useState('COM5')
  const [fpSensorType, setFpSensorType] = useState('AS608')
  const [fpBaudRate, setFpBaudRate] = useState('')
  const [fpFeedback, setFpFeedback] = useState(null)
  const [enrollingMemberId, setEnrollingMemberId] = useState(null)
  const [fpEnrollModal, setFpEnrollModal] = useState(null)
  const enrollPollRef = useRef(null)
  const fpSseRef = useRef(null)
  const navigate = useNavigate()

  async function loadRealtimeClients() {
    try {
      const data = await fetchRealtimeClients()
      setRealtimeClients(data)
    } catch (err) {
      console.error(err)
    }
  }

  async function loadMemberships() {
    try {
      const data = await fetchMemberships({ query: searchTerm, type: membershipFilter })
      setMemberships(data)
    } catch (err) {
      console.error(err)
    }
  }

  async function loadReports() {
    try {
      const data = await fetchReports()
      setReports(data)
    } catch (err) {
      console.error(err)
    }
  }

  async function loadFingerprintStatus() {
    try {
      const data = await fetchFingerprintStatus()
      setFpStatus(data)
      if (data.sensorType) setFpSensorType(data.sensorType)
      if (data.connected && !fpSseRef.current) setupFpSse()
    } catch (err) {
      console.error(err)
    }
  }

  async function handleConnectFingerprint() {
    try {
      setStatusMessage('Connecting to fingerprint device...')
      const result = await connectFingerprint(fpPort, { sensorType: fpSensorType, baudRate: fpBaudRate || undefined })
      if (result.sensorType) setFpSensorType(result.sensorType)
      await loadFingerprintStatus()
      setStatusMessage(`Fingerprint device connected (${result.sensorType || 'sensor'} at ${result.baudRate || '57600'} baud)`)
      setupFpSse()
    } catch (err) {
      console.error(err)
      setStatusMessage('Failed to connect to fingerprint device. Check the port and sensor type.')
    }
  }

  function setupFpSse() {
    try {
      if (fpSseRef.current) fpSseRef.current.close()
      const sse = createFingerprintEventSource()
      fpSseRef.current = sse

      sse.addEventListener('finger-detected', (e) => {
        setFpFeedback({ type: 'detected', message: 'Finger detected on sensor!' })
        setTimeout(() => setFpFeedback(null), 3000)
      })
      sse.addEventListener('image-captured', (e) => {
        setFpFeedback({ type: 'captured', message: 'Image captured successfully!' })
      })
      sse.addEventListener('image-processed', (e) => {
        setFpFeedback({ type: 'processed', message: 'Image processed...' })
      })
      sse.addEventListener('match', (e) => {
        const data = JSON.parse(e.data)
        setFpFeedback({ type: 'match', message: `Match found! Member ID: ${data.templateId}` })
      })
      sse.addEventListener('no-match', (e) => {
        setFpFeedback({ type: 'nomatch', message: 'No match found. Fingerprint not registered.' })
      })
      sse.addEventListener('scan-result', (e) => {
        const data = JSON.parse(e.data)
        if (data.action === 'checkin') {
          setFpFeedback({ type: 'match', message: `${data.name} checked in successfully!` })
        } else if (data.action === 'checkout') {
          setFpFeedback({ type: 'match', message: `${data.name} checked out. Time spent: ${data.duration}` })
        } else if (data.action === 'denied') {
          setFpFeedback({ type: 'error', message: `Access Denied — ${data.error || 'Fingerprint not recognized'}` })
        } else if (data.error) {
          setFpFeedback({ type: 'error', message: data.error })
        }
        setTimeout(() => setFpFeedback(null), 5000)
      })
      sse.addEventListener('enroll-start', (e) => {
        setFpFeedback({ type: 'enrolling', message: 'Place finger on sensor (1st capture)' })
      })
      sse.addEventListener('enroll-step', (e) => {
        const data = JSON.parse(e.data)
        if (data.step === 1) setFpFeedback({ type: 'enrolling', message: 'Place finger on sensor (1st capture)' })
        if (data.step === 2) setFpFeedback({ type: 'enrolling', message: 'Lift finger, then place again (2nd capture)' })
      })
      sse.addEventListener('enroll-done', (e) => {
        const data = JSON.parse(e.data)
        if (data.success) setFpFeedback({ type: 'success', message: 'Enrollment successful!' })
        else setFpFeedback({ type: 'error', message: `Enrollment failed: ${data.error || 'Unknown error'}` })
      })
      sse.addEventListener('connected', () => loadFingerprintStatus())
      sse.addEventListener('disconnected', () => {
        setFpFeedback(null)
        loadFingerprintStatus()
      })
      sse.addEventListener('status', (e) => {
        const data = JSON.parse(e.data)
        setFpStatus(data)
        if (data.sensorType) setFpSensorType(data.sensorType)
      })
    } catch (err) {
      console.error('Failed to setup fingerprint SSE:', err)
    }
  }

  async function handleDisconnectFingerprint() {
    try {
      await disconnectFingerprint()
      if (fpSseRef.current) {
        fpSseRef.current.close()
        fpSseRef.current = null
      }
      await loadFingerprintStatus()
      setFpFeedback(null)
      setStatusMessage('Fingerprint device disconnected')
    } catch (err) {
      console.error(err)
    }
  }

  async function handleEnrollFingerprint(member) {
    setFpEnrollModal({ memberId: member.id, memberName: member.name, status: 'enrolling', receiptData: null, from: 'membership' })

    if (fpStatus.connected) {
      setStatusMessage(`Enrolling ${member.name}'s fingerprint on the ${fpStatus.sensorType || 'fingerprint'} sensor. Place their finger on the sensor twice.`)
      await startUsbEnrollment(member.id, 'membership')
    } else {
      setStatusMessage(`Enrolling ${member.name}'s fingerprint. Press their finger on the door sensor (R307) twice.`)
      startDoorEnrollment(member.id, 'membership')
    }
  }

  async function startUsbEnrollment(memberId, from) {
    if (!memberId) return
    setFpEnrollModal(prev => prev ? { ...prev, status: 'enrolling', from: from || prev.from } : prev)

    try {
      const result = await enrollFingerprint(memberId)
      if (result.success) {
        setFpEnrollModal(prev => prev ? { ...prev, status: 'success' } : prev)
        setFpFeedback({ type: 'success', message: 'Enrollment successful!' })
        loadMemberships()
      } else {
        const error = result.error
        setFpEnrollModal(prev => prev ? { ...prev, status: 'error', error } : prev)
        setFpFeedback({ type: 'error', message: `Enrollment failed: ${error}` })
      }
    } catch (err) {
      console.error(err)
      setFpEnrollModal(prev => prev ? { ...prev, status: 'error', error: err.response?.data?.error || 'Failed to enroll fingerprint' } : prev)
    }
  }

  // Queue a door enrollment for the member shown in fpEnrollModal, then poll
  // the backend until the ESP32 reports the result (success, or a failure
  // reason such as "no_match" = the two fingerprint presses did not match).
  async function startDoorEnrollment(memberId, from) {
    if (!memberId) return
    setFpEnrollModal(prev => prev ? { ...prev, status: 'enrolling', from: from || prev.from } : prev)

    try {
      await requestDoorEnroll(memberId)
    } catch (err) {
      console.error(err)
      setFpEnrollModal(prev => prev ? { ...prev, status: 'error', error: err.response?.data?.error || 'Failed to queue fingerprint enrollment' } : prev)
      return
    }

    clearInterval(enrollPollRef.current)
    enrollPollRef.current = setInterval(async () => {
      try {
        const data = await fetchEnrollStatus(memberId)
        const jobStatus = data.job?.status
        if (jobStatus === 'done') {
          clearInterval(enrollPollRef.current)
          enrollPollRef.current = null
          setFpEnrollModal(prev => prev ? { ...prev, status: 'success' } : prev)
          loadMemberships()
        } else if (jobStatus === 'failed') {
          clearInterval(enrollPollRef.current)
          enrollPollRef.current = null
          const reason = data.job?.reason
          const error = reason === 'no_match'
            ? 'The two fingerprint scans did not match. Please press the same finger twice and try again.'
            : reason === 'timeout'
              ? 'No fingerprint was captured within the time limit. Press the finger firmly on the sensor.'
              : 'The fingerprint could not be enrolled. Please try again.'
          setFpEnrollModal(prev => prev ? { ...prev, status: 'error', error } : prev)
        } else {
          // Live progress while job is pending/claimed by ESP32
          const { step, quality, message } = data.job || {}
          if (step || quality != null || message) {
            setFpEnrollModal(prev => {
              if (!prev || prev.status !== 'enrolling') return prev
              return { ...prev, progress: { step, quality, message } }
            })
          }
        }
      } catch (err) {
        console.error(err)
      }
    }, 1000)
  }

  async function handleRemoveFingerprint(member) {
    if (!window.confirm(`Remove fingerprint for ${member.name}?`)) return
    try {
      await removeFingerprint(member.id)
      setStatusMessage(`Fingerprint removed for ${member.name}`)
      setFpFeedback({ type: 'success', message: `Fingerprint removed for ${member.name}` })
      setTimeout(() => setFpFeedback(null), 3000)
      loadMemberships()
    } catch (err) {
      console.error(err)
      setStatusMessage('Failed to remove fingerprint')
      setFpFeedback({ type: 'error', message: 'Failed to remove fingerprint' })
    }
  }

  async function handleToggleScan() {
    if (fpStatus.scanning) {
      await stopFingerprintScan()
      setStatusMessage('Fingerprint scanning stopped')
    } else {
      if (!fpStatus.connected) {
        setStatusMessage('Connect the fingerprint device first')
        return
      }
      await startFingerprintScan()
      setStatusMessage('Fingerprint scanning started — members can now check in/out')
    }
    loadFingerprintStatus()
  }

  function openClientDisplay() {
    const w = 900
    const h = 700
    const left = (screen.width - w) / 2
    const top = (screen.height - h) / 2
    window.open('/client', 'ClientDisplay', `width=${w},height=${h},left=${left},top=${top}`)
  }

  function resetNonMemberForm() {
    setClientName('')
    setNonMemberType('Non-Member - Session')
    setPaymentStatus('Paid')
    setClientCoaching('none')
    setClientSessions(1)
    setClientIsStudent(false)
    setClientPlan('full')
    setClientTypePrice(DEFAULT_TYPE_PRICES['Non-Member - Session'])
    setClientCoachingRate(DEFAULT_COACHING_RATES.daily.regular)
    setClientSessionThreshold(15)
  }

  function handleClientStudentChange(next) {
    setClientIsStudent(next)
    setNonMemberType(prev => {
      if (next && prev === 'Non-Member - Session') return 'Non-Member - Student'
      if (!next && prev === 'Non-Member - Student') return 'Non-Member - Session'
      return prev
    })
  }

  function openNonMemberConfirm() {
    if (!clientName.trim()) {
      setStatusMessage('Enter the client name first')
      return
    }
    const paid = paymentStatus === 'Paid'
    const dueNow = paid ? nonMemberPayment.amountDueNow : 0
    const balance = paid ? nonMemberPayment.balance : nonMemberQuote.total
    const lines = [
      { label: 'Client Name', value: clientName.trim() },
      { label: 'Non-Member Type', value: nonMemberType.replace('Non-Member - ', '') },
      { label: 'Coaching', value: nonMemberQuote.coachingType === 'none' ? 'None' : coachingLineLabel(nonMemberQuote) },
      { label: 'Student Rate', value: clientIsStudent ? 'Yes' : 'No' },
      { label: 'Payment Status', value: paymentStatus === 'Paid' ? 'Paid' : 'Not Paid' },
      ...buildReceiptItems(nonMemberType, nonMemberQuote, false).map(item => ({ label: item.label, value: peso(item.amount), money: true })),
      { label: 'Total Amount to Pay', value: peso(nonMemberQuote.total), strong: true },
      { label: 'Amount Due Now', value: peso(dueNow) },
      { label: 'Balance After Payment', value: peso(balance) },
    ]
    setConfirmModal({
      kind: 'non-member',
      title: 'Confirm Non-Member Registration',
      subtitle: 'Review the walk-in details below before timing in.',
      lines,
    })
  }

  function openMemberConfirm() {
    if (!newMemberName.trim()) {
      setStatusMessage('Enter a name for the new member')
      return
    }
    if (!newMemberSubscribed || !newMemberExpires) {
      setStatusMessage('Select both Subscribed On and Expires On dates')
      return
    }
    const lines = [
      { label: 'Member Name', value: newMemberName.trim() },
      { label: 'Membership Type', value: newMemberType.replace('Member - ', '') },
      { label: 'Coaching', value: memberQuote.coachingType === 'none' ? 'None' : coachingLineLabel(memberQuote) },
      { label: 'Student Rate', value: newMemberIsStudent ? 'Yes' : 'No' },
      { label: 'Subscribed On', value: newMemberSubscribed },
      { label: 'Expires On', value: `${newMemberExpires} (${memberQuote.months} month${memberQuote.months === 1 ? '' : 's'})` },
      ...buildReceiptItems(newMemberType, memberQuote, true).map(item => ({ label: item.label, value: peso(item.amount), money: true })),
      { label: 'Total Amount to Pay', value: peso(memberQuote.total), strong: true },
      { label: 'Amount Due Now', value: peso(memberPayment.amountDueNow) },
      { label: 'Balance After Payment', value: peso(memberPayment.balance) },
    ]
    setConfirmModal({
      kind: 'member',
      title: editingMembership ? 'Confirm Member Update' : 'Confirm New Member',
      subtitle: editingMembership
        ? `Review the changes for ${newMemberName.trim()} before saving.`
        : 'Review the membership details before creating the record.',
      lines,
    })
  }

  async function confirmRegistration() {
    if (!confirmModal || saving) return
    setSaving(true)
    try {
      if (confirmModal.kind === 'non-member') {
        const paid = paymentStatus === 'Paid'
        const saved = await createClient({
          name: clientName.trim(),
          type: nonMemberType,
          payment: paymentStatus,
          coaching: clientCoaching,
          isStudent: clientIsStudent,
          sessions: clientSessions,
          paymentPlan: clientPlan,
          typePrice: clientTypePrice,
          coachingRate: clientCoaching !== 'none' ? clientCoachingRate : undefined,
          paymentMethod: clientPaymentMethod,
          sessionThreshold: clientCoaching !== 'none' && clientPlan === 'installment' ? clientSessionThreshold : undefined,
        })
        setReceipt({
          title: 'Official Receipt',
          number: `WALK-IN-${String(saved.id).padStart(6, '0')}`,
          issuedAt: new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }),
          customer: saved.name,
          isStudent: clientIsStudent,
          items: buildReceiptItems(nonMemberType, nonMemberQuote, false),
          total: nonMemberQuote.total,
          amountPaid: paid ? nonMemberPayment.amountDueNow : 0,
          balance: paid ? nonMemberPayment.balance : nonMemberQuote.total,
          note: !paid
            ? 'Payment status: NOT PAID — kindly collect before the session ends.'
            : paid && nonMemberPayment.plan === 'installment'
              ? `Coaching on installment — settle the ${peso(nonMemberPayment.balance)} balance after ${clientSessionThreshold} coaching sessions.`
              : null,
          period: null,
        })
        setStatusMessage(`Non-member registered and timed in. Total: ${peso(nonMemberQuote.total)}.`)
        resetNonMemberForm()
        loadRealtimeClients()
      } else {
        const payload = {
          name: newMemberName.trim(),
          type: newMemberType,
          subscribed_on: newMemberSubscribed,
          expires_on: newMemberExpires,
          coaching: newMemberCoaching,
          isStudent: newMemberIsStudent,
          sessions: newMemberSessions,
          paymentPlan: newMemberPlan,
          status: editingMembership?.status || 'active',
          membershipFee: newMemberFee,
          typePrice: newMemberTypePrice,
          coachingRate: newMemberCoaching !== 'none' ? newMemberCoachingRate : undefined,
          paymentMethod: memberPaymentMethod,
          sessionThreshold: newMemberSessionThreshold,
          typeQuantity: newMemberTypeQuantity,
        }
        let saved
        if (editingMembership) {
          saved = await editMembership(editingMembership.id, payload)
        } else {
          saved = await createMembership(payload)
        }
        const receiptData = {
          title: editingMembership ? 'Membership Update Receipt' : 'Official Receipt',
          number: `MB-${String(saved.id).padStart(6, '0')}`,
          issuedAt: new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }),
          customer: saved.name,
          isStudent: newMemberIsStudent,
          items: buildReceiptItems(newMemberType, memberQuote, true),
          total: memberQuote.total,
          amountPaid: memberPayment.amountDueNow,
          balance: memberPayment.balance,
          note: memberPayment.plan === 'installment'
            ? `Coaching on installment — settle the ${peso(memberPayment.balance)} balance after ${newMemberSessionThreshold} coaching sessions.`
            : null,
          period: `Subscribed On: ${saved.subscribed}   •   Expires On: ${saved.expires}`,
        }
        handleCancelEdit()
        setInputMode('choose')
        loadMemberships()
        loadReports()
        if (!editingMembership) {
          setConfirmModal(null)
          setFpEnrollModal({ memberId: saved.id, memberName: saved.name, status: 'enrolling', receiptData, from: 'registration' })
          startDoorEnrollment(saved.id, 'registration')
        } else {
          setReceipt(receiptData)
          setStatusMessage(`${editingMembership ? 'Member updated' : 'Member added'} successfully. Total: ${peso(memberQuote.total)}.`)
          setConfirmModal(null)
        }
      }
    } catch (err) {
      console.error(err)
      setStatusMessage(err.response?.data?.error || 'Failed to save registration')
    } finally {
      setSaving(false)
      setConfirmModal(null)
    }
  }

  function handleFpEnrollComplete() {
    if (!fpEnrollModal) return
    const { receiptData, status, from } = fpEnrollModal
    if (from === 'registration' && receiptData) {
      const note = status === 'enrolling'
        ? 'Fingerprint enrollment was skipped. You can enroll later from the Memberships tab.'
        : status === 'error'
          ? `Fingerprint enrollment failed: ${fpEnrollModal.error}. You can retry from the Memberships tab.`
          : null
      setReceipt(note ? { ...receiptData, note } : receiptData)
      setStatusMessage(status === 'success'
        ? 'Member added and fingerprint enrolled successfully.'
        : status === 'error' ? 'Member added, but fingerprint enrollment failed.' : 'Member added successfully.')
    } else {
      setStatusMessage(status === 'success'
        ? `Fingerprint enrolled for ${fpEnrollModal.memberName}.`
        : status === 'error'
          ? `Fingerprint enrollment failed for ${fpEnrollModal.memberName}.`
          : `Fingerprint enrollment skipped for ${fpEnrollModal.memberName}.`)
    }
    clearInterval(enrollPollRef.current)
    enrollPollRef.current = null
    setFpEnrollModal(null)
  }

  async function handleLogSession(member) {
    try {
      const updated = await incrementCoachingSession(member.id)
      setStatusMessage(`Session logged for ${member.name}: ${updated.coachingSessionsUsed}/${updated.coachingSessionThreshold}`)
      loadMemberships()
    } catch (err) {
      console.error(err)
      setStatusMessage(err.response?.data?.error || 'Failed to log session')
    }
  }

  async function handleUndoSession(member) {
    if ((Number(member.coachingSessionsUsed) || 0) <= 0) return setStatusMessage('No sessions to undo.')
    try {
      const updated = await undoCoachingSession(member.id)
      setStatusMessage(`Session reverted for ${member.name}: ${updated.coachingSessionsUsed}/${updated.coachingSessionThreshold}`)
      loadMemberships()
    } catch (err) {
      console.error(err)
      setStatusMessage(err.response?.data?.error || 'Failed to undo session')
    }
  }

  async function handleCollectBalance(member) {
    const amount = Number(member.balance || 0)
    const confirmed = window.confirm(`Collect ${peso(amount)} remaining coaching balance from "${member.name}"?`)
    if (!confirmed) return
    try {
      await collectMembershipBalance(member.id, memberPaymentMethod)
      setStatusMessage(`Collected ${peso(amount)} from ${member.name}. Balance settled.`)
      loadMemberships()
    } catch (err) {
      console.error(err)
      setStatusMessage(err.response?.data?.error || 'Failed to collect balance')
    }
  }

  async function handleCheckout(client) {
    const confirmed = window.confirm(`End time for walk-in client "${client.name}"?`)
    if (!confirmed) return
    try {
      const updated = await checkoutClient(client.id)
      setStatusMessage(`${updated.name} timed out. Time spent: ${updated.duration}.`)
      loadRealtimeClients()
      loadReports()
    } catch (err) {
      console.error(err)
      setStatusMessage(err.response?.data?.error || 'Failed to record time out')
    }
  }

  async function handleCollectPayment(client) {
    const amount = Number(client.balance || 0) > 0 ? Number(client.balance) : Number(client.totalAmount || 0)
    const confirmed = window.confirm(`Collect ${peso(amount)} cash from "${client.name}" and mark the visit as Paid?`)
    if (!confirmed) return
    try {
      const updated = await collectClientPayment(client.id)
      setStatusMessage(`${updated.name} marked as Paid. Collected ${peso(updated.amountPaid)}.`)
      loadRealtimeClients()
      loadReports()
    } catch (err) {
      console.error(err)
      setStatusMessage(err.response?.data?.error || 'Failed to record payment')
    }
  }

  async function handleLogClientSession(client) {
    try {
      const updated = await incrementClientSession(client.id)
      setStatusMessage(`Session logged for ${client.name}: ${updated.coachingSessionsUsed}/${updated.coachingSessionThreshold}`)
      loadRealtimeClients()
    } catch (err) {
      console.error(err)
      setStatusMessage(err.response?.data?.error || 'Failed to log session')
    }
  }

  async function handleUndoClientSession(client) {
    if ((Number(client.coachingSessionsUsed) || 0) <= 0) return setStatusMessage('No sessions to undo.')
    try {
      const updated = await undoClientSession(client.id)
      setStatusMessage(`Session reverted for ${client.name}: ${updated.coachingSessionsUsed}/${updated.coachingSessionThreshold}`)
      loadRealtimeClients()
    } catch (err) {
      console.error(err)
      setStatusMessage(err.response?.data?.error || 'Failed to undo session')
    }
  }

  async function handleCollectClientBalance(client) {
    const amount = Number(client.balance || 0)
    const confirmed = window.confirm(`Collect ${peso(amount)} remaining coaching balance from "${client.name}"?`)
    if (!confirmed) return
    try {
      await collectClientBalance(client.id, clientPaymentMethod)
      setStatusMessage(`Collected ${peso(amount)} from ${client.name}. Balance settled.`)
      loadRealtimeClients()
    } catch (err) {
      console.error(err)
      setStatusMessage(err.response?.data?.error || 'Failed to collect balance')
    }
  }

  function handleSubscribedChange(value) {
    setNewMemberSubscribed(value)
    if (!value) return
    const span = Math.max(1, monthsBetween(newMemberSubscribed, newMemberExpires))
    setNewMemberExpires(addMonthsISO(value, span))
  }

  function handleEditMembership(member) {
    setEditingMembership(member)
    setNewMemberName(member.name)
    setNewMemberType(member.type)
    setNewMemberSubscribed(member.subscribed)
    setNewMemberExpires(member.expires)
    setNewMemberCoaching(normalizeCoaching(member.coaching))
    setNewMemberIsStudent(Number(member.isStudent) === 1)
    setNewMemberSessions(Math.max(1, Number(member.coachingUnits) || 1))
    setNewMemberPlan(member.paymentPlan === 'installment' ? 'installment' : 'full')
    setNewMemberFee(Number(member.joinFee) || MEMBERSHIP_JOIN_FEE)
    const defaultTp = DEFAULT_TYPE_PRICES[member.type] ?? 0
    const tq = Number(member.typeQuantity) || 1
    const multiplier = String(member.type || '').toLowerCase().includes('monthly') ? tq : 1
    setNewMemberTypePrice(member.typePrice != null ? Number(member.typePrice) / multiplier : defaultTp)
    setNewMemberTypeQuantity(tq)
    const coachingKey = normalizeCoaching(member.coaching)
    if (coachingKey !== 'none' && Number(member.coachingPrice) > 0 && Number(member.coachingUnits) > 0) {
      setNewMemberCoachingRate(Number(member.coachingPrice) / Number(member.coachingUnits))
    } else {
      const defRate = coachingKey === 'daily' ? DEFAULT_COACHING_RATES.daily.regular : DEFAULT_COACHING_RATES.monthly.regular
      setNewMemberCoachingRate(member.isStudent && coachingKey !== 'none'
        ? DEFAULT_COACHING_RATES[coachingKey].student
        : defRate)
    }
    setNewMemberSessionThreshold(member.coachingSessionThreshold || 15)
    setStatusMessage('Editing member: ' + member.name)
    setActivePage('Input')
    setInputMode('member')
  }

  function handleCancelEdit() {
    setEditingMembership(null)
    setNewMemberName('')
    setNewMemberType('Member - Session')
    setNewMemberSubscribed(todayISO())
    setNewMemberExpires(addMonthsISO(todayISO(), 1))
    setNewMemberCoaching('none')
    setNewMemberIsStudent(false)
    setNewMemberSessions(1)
    setNewMemberPlan('full')
    setNewMemberFee(MEMBERSHIP_JOIN_FEE)
    setNewMemberTypePrice(DEFAULT_TYPE_PRICES['Member - Session'])
    setNewMemberTypeQuantity(1)
    setNewMemberCoachingRate(DEFAULT_COACHING_RATES.daily.regular)
  }

  async function handleDeleteMembership(id) {
    const confirmed = window.confirm('Delete this member record permanently? This cannot be undone.')
    if (!confirmed) {
      setStatusMessage('Member deletion cancelled')
      return
    }
    try {
      await deleteMembership(id)
      setStatusMessage('Member record deleted')
      loadMemberships()
    } catch (err) {
      console.error(err)
      setStatusMessage('Failed to delete member')
    }
  }

  async function handleToggleMembership(member) {
    const nextStatus = member.status === 'inactive' ? 'active' : 'inactive'
    const confirmed = window.confirm(
      nextStatus === 'inactive'
        ? `Deactivate ${member.name}? Use this for members about to expire or with no appearance.`
        : `Reactivate ${member.name}?`,
    )
    if (!confirmed) return
    try {
      await setMembershipStatus(member.id, nextStatus)
      setStatusMessage(nextStatus === 'inactive' ? `${member.name} deactivated` : `${member.name} reactivated`)
      loadMemberships()
    } catch (err) {
      console.error(err)
      setStatusMessage('Failed to update membership status')
    }
  }

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('receipt-open', Boolean(receipt))
    return () => document.body.classList.remove('receipt-open')
  }, [receipt])

  const timeText = useMemo(() => currentTime.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit' }), [currentTime])
  const dateText = useMemo(() => currentTime.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), [currentTime])

  const filteredMembers = useMemo(() => {
    return memberships.filter(member => {
      const matchesSearch = member.name.toLowerCase().includes(searchTerm.toLowerCase()) || member.type.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesType = membershipFilter === 'All' || member.type === membershipFilter
      return matchesSearch && matchesType
    })
  }, [memberships, searchTerm, membershipFilter])

  const memberQuote = useMemo(() => computeQuote({
    type: newMemberType,
    subscribedOn: newMemberSubscribed,
    expiresOn: newMemberExpires,
    coaching: newMemberCoaching,
    isStudent: newMemberIsStudent,
    sessions: newMemberSessions,
    joinFee: newMemberFee,
    typePrice: newMemberTypePrice,
    coachingRate: newMemberCoaching !== 'none' ? newMemberCoachingRate : undefined,
    typeQuantity: newMemberTypeQuantity,
  }), [newMemberType, newMemberSubscribed, newMemberExpires, newMemberCoaching, newMemberIsStudent, newMemberSessions, newMemberFee, newMemberTypePrice, newMemberCoachingRate, newMemberTypeQuantity])

  const memberPayment = useMemo(() => applyPaymentPlan(memberQuote, newMemberPlan), [memberQuote, newMemberPlan])

  const nonMemberQuote = useMemo(() => computeQuote({
    type: nonMemberType,
    coaching: clientCoaching,
    isStudent: clientIsStudent,
    sessions: clientSessions,
    joinFee: 0,
    typePrice: clientTypePrice,
    coachingRate: clientCoaching !== 'none' ? clientCoachingRate : undefined,
  }), [nonMemberType, clientCoaching, clientIsStudent, clientSessions, clientTypePrice, clientCoachingRate])

  const nonMemberPayment = useMemo(() => applyPaymentPlan(nonMemberQuote, clientPlan), [nonMemberQuote, clientPlan])

  useEffect(() => {
    let intervalId
    if (activePage === 'Dashboard') {
      loadRealtimeClients()
      loadReports()
      loadMemberships()
      intervalId = setInterval(() => {
        loadRealtimeClients()
        loadReports()
      }, 5000)
    }
    return () => clearInterval(intervalId)
  }, [activePage])

  useEffect(() => {
    if (activePage === 'Input') {
      setInputMode(editingMembership ? 'member' : 'choose')
      setStatusMessage(null)
    }
  }, [activePage])

  // Load fingerprint status on mount
  useEffect(() => {
    loadFingerprintStatus()
  }, [])

  useEffect(() => {
    if (activePage === 'Memberships') {
      loadMemberships()
      loadFingerprintStatus()
    }
  }, [activePage, searchTerm, membershipFilter])

  return (
    <div className="app-layout">
      <Sidebar items={staffItems} activeItem={activePage} onSelect={setActivePage} />
      <main className="main-view">
        <div className="main-topbar no-print">
          <div className="main-topbar-title">{activePage}</div>
          <ProfileMenu onLogout={() => { logout(); navigate('/login') }} />
        </div>
        {activePage === 'Dashboard' && (
          <header className="page-header header-with-actions no-print">
            <div>
              <h2>RDC GYM</h2>
              <p>Staff dashboard</p>
            </div>
            <div className="page-header-meta">
              <button type="button" className="pill action client-display-btn" onClick={openClientDisplay}>Open Client Display</button>
              <div className="time-block">
                <strong>{timeText}</strong>
                <span>{dateText}</span>
              </div>
              <div className="welcome-badge">Welcome Staff</div>
            </div>
          </header>
        )}

        <section className="content-card">
          {activePage === 'Dashboard' && (
            <>
              <div className="status-grid no-print">
                <div className="stat-card"><strong>Total Check-Ins</strong><span>{reports.totalCheckIns}</span></div>
                <div className="stat-card"><strong>Total Check-Outs</strong><span>{reports.totalCheckOuts}</span></div>
                <div className="stat-card"><strong>Active Members</strong><span>{reports.activeMembers}</span></div>
              </div>
              <RealtimeQueue
                clients={realtimeClients}
                now={currentTime}
                onCheckout={handleCheckout}
                onCollectPayment={handleCollectPayment}
                statusMessage={statusMessage}
              />
            </>
          )}

          {activePage === 'Input' && (
            <>
              {inputMode === 'choose' && (
                <>
                  <div className="section-title-row">
                    <div>
                      <h3>Register Client</h3>
                      <p className="section-subtitle">Choose whether to register a non-member or add a new member.</p>
                    </div>
                  </div>
                  <div className="input-choice-grid">
                    <button type="button" className="pill action choice-button" onClick={() => setInputMode('register')}>NON MEMBER</button>
                    <button type="button" className="pill action choice-button" onClick={() => setInputMode('member')}>MEMBER</button>
                  </div>

                  {realtimeClients.some(c => !isMemberType(c.type) && c.coaching !== 'none' && Number(c.balance) > 0) && (
                    <div className="fingerprint-controls" style={{ marginTop: 16 }}>
                      <div className="fingerprint-controls-header">
                        <h4>Walk-in Coaching Monitor</h4>
                        <span className="status-chip active">{realtimeClients.filter(c => !isMemberType(c.type) && c.coaching !== 'none' && Number(c.balance) > 0).length} pending</span>
                      </div>
                      <div className="fingerprint-controls-body">
                        <div className="table-card" style={{ margin: 0 }}>
                          <table>
                            <thead>
                              <tr>
                                <th>Client</th>
                                <th>Sessions Attended</th>
                                <th>Progress</th>
                                <th>Status</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {realtimeClients
                                .filter(c => !isMemberType(c.type) && c.coaching !== 'none' && Number(c.balance) > 0)
                                .map(c => {
                                  const used = Number(c.coachingSessionsUsed) || 0
                                  const threshold = Number(c.coachingSessionThreshold) || 15
                                  const pct = Math.min(100, Math.round((used / threshold) * 100))
                                  const ready = used >= threshold
                                  return (
                                    <tr key={c.id}>
                                      <td>{c.name}</td>
                                      <td>{used} / {threshold}</td>
                                      <td>
                                        <div style={{ background: '#e2e8f0', borderRadius: 8, height: 8, width: 120, overflow: 'hidden' }}>
                                          <div style={{ background: ready ? '#22c55e' : '#6366f1', height: '100%', width: `${pct}%`, borderRadius: 8, transition: 'width .3s' }} />
                                        </div>
                                      </td>
                                      <td>
                                        <span className={`status-chip ${ready ? 'active' : 'inactive'}`}>
                                          {ready ? 'Ready to Collect' : 'In Progress'}
                                        </span>
                                      </td>
                                      <td className="action-cell">
                                        {!ready && (
                                          <>
                                            {used > 0 && (
                                              <button type="button" className="icon-btn" title="Undo Session" onClick={() => handleUndoClientSession(c)}>
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
                                              </button>
                                            )}
                                            <button type="button" className="icon-btn" title="Log Session" onClick={() => handleLogClientSession(c)}>
                                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H14"/></svg>
                                            </button>
                                          </>
                                        )}
                                        {ready && (
                                          <button type="button" className="pill action" onClick={() => handleCollectClientBalance(c)}>Collect {peso(c.balance)}</button>
                                        )}
                                      </td>
                                    </tr>
                                  )
                                })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {inputMode === 'register' && (
                <>
                  <div className="section-title-row">
                    <div>
                      <h3>REGISTER NON-MEMBER</h3>
                      <p className="section-subtitle">Walk-in clients are timed in now. End Time is done from the Dashboard.</p>
                    </div>
                    <button type="button" className="pill" onClick={() => setInputMode('choose')}>Back</button>
                  </div>
                  <div className="register-card">
                    <div className="form-grid input-grid">
                      <label>
                        Client Name
                        <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Type client name" />
                      </label>
                      <label>
                        Non-Member Type
                        <select value={nonMemberType} onChange={e => setNonMemberType(e.target.value)}>
                          {nonMemberTypeOptions.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Type Price
                        <input type="number" min="0" step="1" value={clientTypePrice} onChange={e => setClientTypePrice(Number(e.target.value) || 0)} />
                      </label>
                      <label>
                        Coaching Type
                        <select value={clientCoaching} onChange={e => setClientCoaching(e.target.value)}>
                          {coachingOptions.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      {clientCoaching !== 'none' && (
                        <label>
                          Quantity
                          <input type="number" min="1" value={clientSessions} onChange={e => setClientSessions(e.target.value)} />
                        </label>
                      )}
                      {clientCoaching !== 'none' && (
                        <label>
                          Rate ({clientCoaching === 'daily' ? 'per session' : 'per month'})
                          <input type="number" min="0" step="1" value={clientCoachingRate} onChange={e => setClientCoachingRate(Number(e.target.value) || 0)} />
                        </label>
                      )}
                      <label>
                        Rate
                        <div className="button-group pill-group">
                          {[{ label: 'Regular', value: false }, { label: 'Student', value: true }].map(option => (
                            <button
                              key={option.label}
                              type="button"
                              className={clientIsStudent === option.value ? 'pill active' : 'pill'}
                              onClick={() => handleClientStudentChange(option.value)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </label>
                      <label>
                        Payment Status
                        <div className="button-group pill-group">
                          {paymentStatusOptions.map(option => (
                            <button
                              key={option.value}
                              type="button"
                              className={paymentStatus === option.value ? 'pill active' : 'pill'}
                              onClick={() => setPaymentStatus(option.value)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </label>
                      <label>
                        Payment
                        <div className="button-group pill-group">
                          {paymentPlanOptions.map(option => (
                            <button
                              key={option.value}
                              type="button"
                              disabled={option.value === 'installment' && nonMemberQuote.coachingTotal === 0}
                              className={(clientPlan === option.value && nonMemberQuote.coachingTotal > 0) || (option.value === 'full' && nonMemberQuote.coachingTotal === 0) ? 'pill active' : 'pill'}
                              onClick={() => setClientPlan(option.value)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </label>
                      {clientCoaching !== 'none' && clientPlan === 'installment' && (
                        <label>
                          Sessions Before 2nd Payment
                          <input type="number" min="1" value={clientSessionThreshold} onChange={e => setClientSessionThreshold(Number(e.target.value) || 15)} />
                        </label>
                      )}
                    </div>
                    <label className="full-width">
                      Payment Method
                      <div className="button-group pill-group">
                        {['Cash', 'GCash', 'Maya', 'Bank Transfer', 'Other'].map(method => (
                          <button
                            key={method}
                            type="button"
                            className={clientPaymentMethod === method ? 'pill active' : 'pill'}
                            onClick={() => setClientPaymentMethod(method)}
                          >
                            {method}
                          </button>
                        ))}
                      </div>
                    </label>
                    <QuoteCalculator
                      type={nonMemberType}
                      quote={nonMemberQuote}
                      payment={{
                        plan: nonMemberPayment.plan,
                        amountDueNow: paymentStatus === 'Paid' ? nonMemberPayment.amountDueNow : 0,
                        balance: paymentStatus === 'Paid' ? nonMemberPayment.balance : nonMemberQuote.total,
                      }}
                      isMember={false}
                    />
                    <div className="submit-row">
                      <button type="button" className="pill action" onClick={openNonMemberConfirm}>Register Non-Member</button>
                    </div>
                  </div>
                </>
              )}

              {inputMode === 'member' && (
                <>
                  <div className="section-title-row">
                    <div>
                      <h3>{editingMembership ? 'EDIT MEMBER' : 'ADD NEW MEMBER'}</h3>
                      <p className="section-subtitle">Enter the member details for membership record creation.</p>
                    </div>
                    <button type="button" className="pill" onClick={() => { handleCancelEdit(); setInputMode('choose') }}>Back</button>
                  </div>
                  <div className="register-card">
                    <div className="form-grid membership-form">
                      <label>
                        Member Name
                        <input value={newMemberName} onChange={e => setNewMemberName(e.target.value)} placeholder="Enter member name" />
                      </label>
                      <label>
                        Membership Fee
                        <input type="number" min="0" step="1" value={newMemberFee} onChange={e => setNewMemberFee(Number(e.target.value) || 0)} />
                      </label>
                      <label>
                        Type
                        <select value={newMemberType} onChange={e => {
                          setNewMemberType(e.target.value)
                          const key = e.target.value
                          setNewMemberTypePrice(DEFAULT_TYPE_PRICES[key] ?? 0)
                        }}>
                          {memberTypeOptions.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      {newMemberType.toLowerCase().includes('monthly') && (
                        <label>
                          Quantity (months)
                          <input type="number" min="1" value={newMemberTypeQuantity} onChange={e => setNewMemberTypeQuantity(Math.max(1, Number(e.target.value) || 1))} />
                        </label>
                      )}
                      <label>
                        Type Price ({newMemberType.toLowerCase().includes('monthly') ? 'per month' : 'session'})
                        <input type="number" min="0" step="1" value={newMemberTypePrice} onChange={e => setNewMemberTypePrice(Number(e.target.value) || 0)} />
                      </label>
                      <label>
                        Subscribed On
                        <input type="date" value={newMemberSubscribed} onChange={e => handleSubscribedChange(e.target.value)} />
                      </label>
                      <label>
                        Expires On
                        <input type="date" value={newMemberExpires} min={newMemberSubscribed} onChange={e => setNewMemberExpires(e.target.value)} />
                      </label>
                      <label>
                        Coaching Type
                        <select value={newMemberCoaching} onChange={e => setNewMemberCoaching(e.target.value)}>
                          {coachingOptions.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      {newMemberCoaching !== 'none' && (
                        <label>
                          Quantity
                          <input type="number" min="1" value={newMemberSessions} onChange={e => setNewMemberSessions(e.target.value)} />
                        </label>
                      )}
                      {newMemberCoaching !== 'none' && (
                        <label>
                          Rate ({newMemberCoaching === 'daily' ? 'per session' : 'per month'})
                          <input type="number" min="0" step="1" value={newMemberCoachingRate} onChange={e => setNewMemberCoachingRate(Number(e.target.value) || 0)} />
                        </label>
                      )}
                      <label>
                        Rate
                        <div className="button-group pill-group">
                          {[{ label: 'Regular', value: false }, { label: 'Student', value: true }].map(option => (
                            <button
                              key={option.label}
                              type="button"
                              className={newMemberIsStudent === option.value ? 'pill active' : 'pill'}
                              onClick={() => setNewMemberIsStudent(option.value)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </label>
                      <label>
                        Payment
                        <div className="button-group pill-group">
                          {paymentPlanOptions.map(option => (
                            <button
                              key={option.value}
                              type="button"
                               disabled={option.value === 'installment' && memberQuote.coachingTotal === 0}
                              className={(newMemberPlan === option.value && memberQuote.coachingTotal > 0) || (option.value === 'full' && memberQuote.coachingTotal === 0) ? 'pill active' : 'pill'}
                              onClick={() => setNewMemberPlan(option.value)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </label>
                      {newMemberCoaching === 'monthly' && newMemberPlan === 'installment' && (
                        <label>
                          Sessions Before 2nd Payment
                          <input type="number" min="1" value={newMemberSessionThreshold} onChange={e => setNewMemberSessionThreshold(Number(e.target.value) || 15)} />
                        </label>
                      )}
                      <label className="full-width">
                        Payment Method
                        <div className="button-group pill-group">
                          {['Cash', 'GCash', 'Maya', 'Bank Transfer', 'Other'].map(method => (
                            <button
                              key={method}
                              type="button"
                              className={memberPaymentMethod === method ? 'pill active' : 'pill'}
                              onClick={() => setMemberPaymentMethod(method)}
                            >
                              {method}
                            </button>
                          ))}
                        </div>
                      </label>
                    </div>
                    <QuoteCalculator type={newMemberType} quote={memberQuote} payment={memberPayment} isMember />
                    <div className="submit-row">
                      <button type="button" className="pill action" onClick={openMemberConfirm}>{editingMembership ? 'Update Member' : 'Add Member'}</button>
                      {editingMembership && <button type="button" className="pill danger" onClick={handleCancelEdit}>Cancel</button>}
                    </div>
                  </div>
                </>
              )}

              {statusMessage && <div className="status-message">{statusMessage}</div>}
            </>
          )}

          {activePage === 'Memberships' && (
            <>
              {memberships.some(m => m.coaching === 'monthly' && m.paymentPlan === 'installment' && Number(m.balance) > 0) && (
                <div className="fingerprint-controls" style={{ marginTop: 16 }}>
                  <div className="fingerprint-controls-header">
                    <h4>Coaching Monitor</h4>
                    <span className="status-chip active">{memberships.filter(m => m.coaching === 'monthly' && m.paymentPlan === 'installment' && Number(m.balance) > 0).length} pending</span>
                  </div>
                  <div className="fingerprint-controls-body">
                    <div className="table-card" style={{ margin: 0 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Member</th>
                            <th>Sessions Attended</th>
                            <th>Progress</th>
                            <th>Status</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {memberships
                            .filter(m => m.coaching === 'monthly' && m.paymentPlan === 'installment' && Number(m.balance) > 0)
                            .map(m => {
                              const used = Number(m.coachingSessionsUsed) || 0
                              const threshold = Number(m.coachingSessionThreshold) || 15
                              const pct = Math.min(100, Math.round((used / threshold) * 100))
                              const ready = used >= threshold
                              return (
                                <tr key={m.id}>
                                  <td>{m.name}</td>
                                  <td>{used} / {threshold}</td>
                                  <td>
                                    <div style={{ background: '#e2e8f0', borderRadius: 8, height: 8, width: 120, overflow: 'hidden' }}>
                                      <div style={{ background: ready ? '#22c55e' : '#6366f1', height: '100%', width: `${pct}%`, borderRadius: 8, transition: 'width .3s' }} />
                                    </div>
                                  </td>
                                  <td>
                                    <span className={`status-chip ${ready ? 'active' : 'inactive'}`}>
                                      {ready ? 'Ready to Collect' : 'In Progress'}
                                    </span>
                                  </td>
                                  <td className="action-cell">
                                    {!ready && (
                                      <>
                                        {used > 0 && (
                                          <button type="button" className="icon-btn" title="Undo Session" onClick={() => handleUndoSession(m)}>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
                                          </button>
                                        )}
                                        <button type="button" className="icon-btn" title="Log Session" onClick={() => handleLogSession(m)}>
                                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H14"/></svg>
                                        </button>
                                      </>
                                    )}
                                    {ready && (
                                      <button type="button" className="pill action" onClick={() => handleCollectBalance(m)}>Collect {peso(m.balance)}</button>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              <div className="section-title-row">
                <div>
                  <h3>Member List</h3>
                  <p>Deactivate members who are about to expire or have no appearance, reactivate them later, or delete the record.</p>
                </div>
                <div className="search-row">
                  <input type="search" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search name" />
                </div>
              </div>
              <div className="table-card">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Date of Subscriptions</th>
                      <th>Subscription Expiration</th>
                      <th>Status</th>
                      <th>Fingerprint</th>
                      <th>Coaching Sessions</th>
                      <th>Balance</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMembers.map(member => {
                      const daysLeft = daysUntilExpiry(member.expires)
                      const expiring = daysLeft != null && daysLeft <= 7 && member.status !== 'inactive'
                      return (
                        <tr key={member.id ?? member.name}>
                          <td>{member.name}</td>
                          <td>{member.type}</td>
                          <td>{member.subscribed}</td>
                          <td>
                            {member.expires}
                            {expiring && <span className="expiry-chip">{daysLeft < 0 ? 'Expired' : `${daysLeft}d left`}</span>}
                          </td>
                          <td>
                            <span className={member.status === 'inactive' ? 'status-chip inactive' : 'status-chip active'}>
                              {member.status === 'inactive' ? 'Inactive' : 'Active'}
                            </span>
                          </td>
                          <td>
                            {member.fingerprint_id ? (
                              <span className="status-chip active">Enrolled</span>
                            ) : (
                              <span className="status-chip inactive">Not Set</span>
                            )}
                          </td>
                          <td>
                            {member.coaching === 'monthly' && member.paymentPlan === 'installment' ? (
                              <span>
                                {Number(member.coachingSessionsUsed) || 0}/{Number(member.coachingSessionThreshold) || 15}
                                {Number(member.coachingSessionsUsed) >= Number(member.coachingSessionThreshold) && Number(member.balance) > 0 && (
                                  <span className="expiry-chip" style={{ marginLeft: 4 }}>Ready</span>
                                )}
                              </span>
                            ) : (
                              <span className="muted-text">—</span>
                            )}
                          </td>
                          <td>
                            {Number(member.balance) > 0
                              ? <span className="status-chip inactive">{peso(member.balance)} due</span>
                              : <span className="muted-text">Settled</span>}
                          </td>
                          <td className="action-cell">
                            <button type="button" className="icon-btn" title="Edit" onClick={() => handleEditMembership(member)}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                            </button>
                            <button type="button" className="icon-btn" title={member.status === 'inactive' ? 'Reactivate' : 'Deactivate'} onClick={() => handleToggleMembership(member)}>
                              {member.status === 'inactive' ? (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
                              ) : (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
                              )}
                            </button>
                            <button
                              type="button"
                              className={`icon-btn ${enrollingMemberId === member.id ? 'active' : ''}`}
                              title={member.fingerprint_id ? 'Re-enroll FP at door' : 'Enroll FP at door'}
                              disabled={enrollingMemberId === member.id}
                              onClick={() => handleEnrollFingerprint(member)}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/><path d="M5 19.5C5.5 18 6 15 6 12c0-3.5 2.5-6 6-6 1.7 0 3.2.7 4.2 1.8"/><path d="M10 12c0-1.1.9-2 2-2 .6 0 1.1.3 1.5.7"/><path d="M12 16c-2.2 0-4 1.8-4 4 0 1.1.9 2 2 2s2-.9 2-2"/></svg>
                            </button>
                            {member.fingerprint_id && (
                              <button type="button" className="icon-btn danger" title="Remove FP" onClick={() => handleRemoveFingerprint(member)}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/><path d="M5 19.5C5.5 18 6 15 6 12c0-3.5 2.5-6 6-6 1.7 0 3.2.7 4.2 1.8"/><path d="M10 12c0-1.1.9-2 2-2 .6 0 1.1.3 1.5.7"/><path d="M12 16c-2.2 0-4 1.8-4 4 0 1.1.9 2 2 2s2-.9 2-2"/><path d="m4 4 16 16"/></svg>
                              </button>
                            )}
                            {member.coaching === 'monthly' && member.paymentPlan === 'installment' && Number(member.balance) > 0 && Number(member.coachingSessionsUsed) >= Number(member.coachingSessionThreshold) && (
                              <button type="button" className="icon-btn" title="Collect Balance" onClick={() => handleCollectBalance(member)}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                              </button>
                            )}
                            <button type="button" className="icon-btn danger" title="Delete" onClick={() => handleDeleteMembership(member.id)}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {statusMessage && <div className="status-message">{statusMessage}</div>}
            </>
          )}
        </section>
      </main>

      {confirmModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>{confirmModal.title}</h3>
            <p className="modal-subtitle">{confirmModal.subtitle}</p>
            <div className="confirm-lines">
              {confirmModal.lines.map(line => (
                <div key={line.label} className={line.strong ? 'confirm-line strong' : 'confirm-line'}>
                  <span>{line.label}</span>
                  <span className={line.money ? 'money' : ''}>{line.value}</span>
                </div>
              ))}
            </div>
            <div className="submit-row no-print">
              <button type="button" className="pill" onClick={() => setConfirmModal(null)} disabled={saving}>Cancel</button>
              <button type="button" className="pill action" onClick={confirmRegistration} disabled={saving}>
                {saving ? 'Saving…' : 'Yes, Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {receipt && (
        <div className="modal-overlay">
          <div className="modal-card receipt-modal">
            <div className="receipt-print">
              <div className="receipt-brand">
                <strong>RDC GYM</strong>
                <span>{receipt.title}</span>
              </div>
              <div className="receipt-meta">
                <span>Receipt No.: {receipt.number}</span>
                <span>{receipt.issuedAt}</span>
              </div>
              <div className="receipt-customer">{receipt.customer}{receipt.isStudent ? ' (Student)' : ''}</div>
              {receipt.period && <div className="receipt-period">{receipt.period}</div>}
              <table className="receipt-table">
                <tbody>
                  {receipt.items.map(item => (
                    <tr key={item.label}>
                      <td>{item.label}</td>
                      <td className="num">{peso(item.amount)}</td>
                    </tr>
                  ))}
                  <tr className="grand-total">
                    <td>Total Amount to Pay</td>
                    <td className="num">{peso(receipt.total)}</td>
                  </tr>
                  <tr>
                    <td>Amount Paid</td>
                    <td className="num">{peso(receipt.amountPaid)}</td>
                  </tr>
                  {receipt.balance > 0 && (
                    <tr className="balance-row">
                      <td>Balance</td>
                      <td className="num">{peso(receipt.balance)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {receipt.note && <div className="receipt-note">{receipt.note}</div>}
              <div className="receipt-thanks">Thank you for choosing RDC GYM!</div>
            </div>
            <div className="submit-row no-print">
              <button type="button" className="pill" onClick={() => setReceipt(null)}>Close</button>
              <button type="button" className="pill action" onClick={() => window.print()}>Print Receipt</button>
            </div>
          </div>
        </div>
      )}

      {fpEnrollModal && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ textAlign: 'center', maxWidth: 440 }}>
            {fpEnrollModal.status === 'enrolling' && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="64" height="64" style={{ color: '#6366f1' }}>
                    <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/>
                    <path d="M5 19.5C5.5 18 6 15 6 12c0-3.5 2.5-6 6-6 1.7 0 3.2.7 4.2 1.8"/>
                    <path d="M10 12c0-1.1.9-2 2-2 .6 0 1.1.3 1.5.7"/>
                    <path d="M12 16c-2.2 0-4 1.8-4 4 0 1.1.9 2 2 2s2-.9 2-2"/>
                  </svg>
                </div>
                <h3>Enroll Fingerprint</h3>
                <p style={{ color: '#64748b', margin: '8px 0 24px' }}>
                  Press <strong>{fpEnrollModal.memberName}</strong>'s finger on the <strong>{fpStatus.sensorType === 'AS608' ? 'AS608 sensor at the desk' : fpStatus.connected ? 'fingerprint sensor' : 'R307 sensor at the door'}</strong><br/>
                  <span style={{ fontSize: '0.85em' }}>
                    {fpStatus.connected
                      ? 'The USB sensor will capture it. You will be prompted to place the finger twice.'
                      : 'The ESP32 will capture it. You will be prompted to place the finger twice.'}
                  </span>
                </p>
                <div style={{ margin: '16px 0' }}>
                  {fpEnrollModal.progress ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#64748b', marginBottom: 6, padding: '0 4px' }}>
                        <span>{ENROLL_STEP_LABEL[fpEnrollModal.progress.step] || fpEnrollModal.progress.step || 'Working...'}</span>
                        {fpEnrollModal.progress.quality != null && <span>{fpEnrollModal.progress.quality}%</span>}
                      </div>
                      <div style={{ height: 8, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden', padding: 0 }}>
                        <div style={{ height: '100%', width: `${fpEnrollModal.progress.quality ?? 0}%`, background: enrollQualityColor(fpEnrollModal.progress.quality ?? 0), transition: 'width .4s' }} />
                      </div>
                      <div style={{ marginTop: 10, fontSize: 14, fontWeight: 600, color: enrollQualityColor(fpEnrollModal.progress.quality ?? 0), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
                        {fpEnrollModal.progress.message || 'Working...'}
                      </div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      <span style={{ fontSize: 14, color: '#64748b' }}>Connecting to ESP32...</span>
                    </div>
                  )}
                </div>
                <div className="submit-row" style={{ justifyContent: 'center', marginTop: 16 }}>
                  <button type="button" className="pill" onClick={() => { setFpEnrollModal(prev => prev ? { ...prev, status: 'skipped' } : prev); handleFpEnrollComplete() }}>Skip</button>
                  <button type="button" className="pill" onClick={() => { setFpEnrollModal(prev => prev ? { ...prev, status: 'cancelled' } : prev); handleFpEnrollComplete() }}>Cancel</button>
                </div>
              </>
            )}
            {fpEnrollModal.status === 'success' && (
              <>
                <div style={{ marginBottom: 16, color: '#22c55e' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="64" height="64">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                </div>
                <h3>Fingerprint Enrolled!</h3>
                <p style={{ color: '#64748b', margin: '8px 0 24px' }}>
                  <strong>{fpEnrollModal.memberName}</strong> can now unlock the door with their fingerprint.
                </p>
                <div className="submit-row" style={{ justifyContent: 'center' }}>
                  <button type="button" className="pill action" onClick={handleFpEnrollComplete}>Continue</button>
                </div>
              </>
            )}
            {fpEnrollModal.status === 'error' && (
              <>
                <div style={{ marginBottom: 16, color: '#ef4444' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="64" height="64">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                  </svg>
                </div>
                <h3>Fingerprint Enrollment Failed</h3>
                <p style={{ color: '#64748b', margin: '8px 0 24px' }}>
                  <strong style={{ color: '#ef4444' }}>Invalid fingerprint or fingerprints did not match.</strong><br/>
                  {fpEnrollModal.error || 'Could not enroll fingerprint.'}<br/>
                  <span style={{ fontSize: '0.85em' }}>The membership was created. You can retry from the Memberships tab.</span>
                </p>
                <div className="submit-row" style={{ justifyContent: 'center' }}>
                  <button type="button" className="pill" onClick={handleFpEnrollComplete}>Cancel</button>
                  <button
                    type="button"
                    className="pill action"
                    onClick={() => {
                      setFpEnrollModal(prev => prev ? { ...prev, status: 'enrolling' } : prev)
                      if (fpStatus.connected) startUsbEnrollment(fpEnrollModal.memberId, fpEnrollModal.from)
                      else startDoorEnrollment(fpEnrollModal.memberId, fpEnrollModal.from)
                    }}
                  >Retry</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
