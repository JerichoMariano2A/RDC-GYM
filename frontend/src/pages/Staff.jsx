import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  logout,
  createClient,
  fetchRealtimeClients,
  fetchMemberships,
  checkoutClient,
} from '../services/auth'
import Sidebar from '../components/Sidebar'
import RealtimeQueue from '../components/RealtimeQueue'

const staffItems = [
  { label: 'Dashboard' },
  { label: 'Input' },
  { label: 'Memberships' },
]

const paymentStatusOptions = [
  { label: 'Paid', value: 'Paid' },
  { label: 'Unpaid', value: 'Not Paid' },
]

const nonMemberTypeOptions = [
  { label: 'Non-Member - Per Session (₱70)', value: 'Non-Member - Per Session' },
  { label: 'Non-Member - Student (₱60)', value: 'Non-Member - Student' },
  { label: 'Non-Member - Monthly (₱1,100)', value: 'Non-Member - Monthly' },
]

export default function Staff() {
  const [activePage, setActivePage] = useState('Dashboard')
  const [currentTime, setCurrentTime] = useState(new Date())
  const [clientName, setClientName] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('Paid')
  const [nonMemberType, setNonMemberType] = useState('Non-Member - Per Session')
  const [searchTerm, setSearchTerm] = useState('')
  const [membershipFilter, setMembershipFilter] = useState('All')
  const [realtimeClients, setRealtimeClients] = useState([])
  const [memberships, setMemberships] = useState([])
  const [statusMessage, setStatusMessage] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let intervalId
    if (activePage === 'Dashboard') {
      loadRealtimeClients()
      intervalId = setInterval(loadRealtimeClients, 5000)
    }
    return () => clearInterval(intervalId)
  }, [activePage])

  useEffect(() => {
    if (activePage === 'Memberships') loadMemberships()
  }, [activePage, searchTerm, membershipFilter])

  const timeText = useMemo(
    () =>
      currentTime.toLocaleTimeString('en-PH', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    [currentTime],
  )

  const dateText = useMemo(
    () =>
      currentTime.toLocaleDateString('en-PH', {
        timeZone: 'Asia/Manila',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    [currentTime],
  )

  const filteredMembers = useMemo(() => {
    return memberships.filter(member => {
      const matchesSearch =
        member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.type.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesType = membershipFilter === 'All' || member.type === membershipFilter
      return matchesSearch && matchesType
    })
  }, [memberships, searchTerm, membershipFilter])

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

  async function handleSaveClient() {
    if (!clientName) {
      setStatusMessage('Enter a client name')
      return
    }
    const confirmed = window.confirm(`Register non-member "${clientName}" as ${nonMemberType}?`)
    if (!confirmed) {
      setStatusMessage('Client registration cancelled')
      return
    }
    try {
      await createClient({ name: clientName, type: nonMemberType, payment: paymentStatus })
      setStatusMessage('Non-member registered and timed in')
      setClientName('')
      setNonMemberType('Non-Member - Per Session')
      setPaymentStatus('Paid')
      loadRealtimeClients()
    } catch (err) {
      console.error(err)
      setStatusMessage('Failed to save client')
    }
  }

  async function handleCheckout(client) {
    const confirmed = window.confirm(`End time for walk-in client "${client.name}"?`)
    if (!confirmed) return
    try {
      const updated = await checkoutClient(client.id)
      setStatusMessage(`${updated.name} timed out. Time spent: ${updated.duration}.`)
      loadRealtimeClients()
    } catch (err) {
      console.error(err)
      setStatusMessage(err.response?.data?.error || 'Failed to record time out')
    }
  }

  return (
    <div className="app-layout">
      <Sidebar items={staffItems} activeItem={activePage} onSelect={setActivePage} onLogout={() => { logout(); navigate('/login') }} />
      <main className="main-view">
        <header className="page-header header-with-actions">
          <div>
            <h2>RDC GYM</h2>
            <p>Staff dashboard</p>
          </div>
          <div className="page-header-meta">
            <div className="time-block">
              <strong>{timeText}</strong>
              <span>{dateText}</span>
            </div>
            <div className="welcome-badge">Welcome Staff</div>
          </div>
        </header>

        <section className="content-card">
          {activePage === 'Dashboard' && (
            <RealtimeQueue
              clients={realtimeClients}
              now={currentTime}
              onCheckout={handleCheckout}
              statusMessage={statusMessage}
            />
          )}

          {activePage === 'Input' && (
            <>
              <div className="section-title-row">
                <div>
                  <h3>Register Non-Member</h3>
                  <p className="section-subtitle">Walk-in clients are timed in now. Use Dashboard End Time when they leave.</p>
                </div>
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
                </div>
                <div className="submit-row">
                  <button type="button" className="pill action" onClick={handleSaveClient}>Register Non-Member</button>
                </div>
              </div>
              {statusMessage && <div className="status-message">{statusMessage}</div>}
            </>
          )}

          {activePage === 'Memberships' && (
            <>
              <div className="section-title-row">
                <div>
                  <h3>Member List</h3>
                  <p>Search by name or membership type.</p>
                </div>
                <div className="search-row">
                  <input type="search" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search name or membership type" />
                  <select value={membershipFilter} onChange={e => setMembershipFilter(e.target.value)}>
                    <option>All</option>
                    <option>Member - Per Session</option>
                    <option>Member - Monthly</option>
                    <option>Member - Yearly</option>
                  </select>
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
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMembers.map(member => (
                      <tr key={member.id ?? member.name}>
                        <td>{member.name}</td>
                        <td>{member.type}</td>
                        <td>{member.subscribed}</td>
                        <td>{member.expires}</td>
                        <td>{member.status === 'inactive' ? 'Inactive' : 'Active'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
