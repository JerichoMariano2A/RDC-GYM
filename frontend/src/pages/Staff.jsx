import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  logout,
  createClient,
  fetchRealtimeClients,
  fetchMemberships,
} from '../services/auth'
import Sidebar from '../components/Sidebar'

const staffItems = [
  { label: 'Dashboard' },
  { label: 'Input' },
  { label: 'Memberships' },
]
  const [currentTime, setCurrentTime] = useState(new Date())
  const [clientName, setClientName] = useState('')
  const [membershipStatus, setMembershipStatus] = useState('Member')
  const [paymentStatus, setPaymentStatus] = useState('Paid')
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
    if (activePage === 'Dashboard') loadRealtimeClients()
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
    const confirmed = window.confirm(`Register client "${clientName}" as ${membershipStatus}?`)
    if (!confirmed) {
      setStatusMessage('Client registration cancelled')
      return
    }
    try {
      await createClient({ name: clientName, type: membershipStatus, payment: paymentStatus })
      setStatusMessage('Client registered successfully')
      setClientName('')
      setMembershipStatus('Member')
      setPaymentStatus('Paid')
      loadRealtimeClients()
    } catch (err) {
      console.error(err)
      setStatusMessage('Failed to save client')
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
            <>
              <div className="section-title-row">
                <h3>Dashboard</h3>
                <p>See live check-in data and current visitors.</p>
              </div>
              <div className="table-card">
                <div className="table-card-header"><strong>Real-time client details</strong></div>
                <table>
                  <thead>
                    <tr>
                      <th>Client Name</th>
                      <th>Type</th>
                      <th>Payment</th>
                      <th>In</th>
                      <th>Out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {realtimeClients.map(client => (
                      <tr key={client.id ?? client.name}>
                        <td>{client.name}</td>
                        <td>{client.type}</td>
                        <td>{client.payment}</td>
                        <td>{client.time_in}</td>
                        <td>{client.time_out}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {activePage === 'Input' && (
            <>
              <div className="section-title-row">
                <h3>Register New Client</h3>
              </div>
              <div className="form-grid">
                <label>
                  Client Name
                  <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Type client name" />
                </label>
                <label>
                  Membership Status
                  <div className="button-group">
                    {['Member', 'Walk-in', 'CI'].map(status => (
                      <button
                        key={status}
                        type="button"
                        className={membershipStatus === status ? 'pill active' : 'pill'}
                        onClick={() => setMembershipStatus(status)}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </label>
                <label>
                  Payment Status
                  <select value={paymentStatus} onChange={e => setPaymentStatus(e.target.value)}>
                    <option>Paid</option>
                    <option>Not Paid</option>
                    <option>CI</option>
                  </select>
                </label>
              </div>
              <div className="table-card input-table">
                <table>
                  <thead>
                    <tr>
                      <th>Client Name</th>
                      <th>Membership Status</th>
                      <th>Payment Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{clientName || 'No client name yet'}</td>
                      <td>{membershipStatus}</td>
                      <td>{paymentStatus}</td>
                      <td><button type="button" className="pill active" onClick={handleSaveClient}>Save</button></td>
                    </tr>
                  </tbody>
                </table>
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
                    <option>Non-Member - Per Session</option>
                    <option>Non-Member - Student</option>
                    <option>Non-Member - Monthly</option>
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
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMembers.map(member => (
                      <tr key={member.id ?? member.name}>
                        <td>{member.name}</td>
                        <td>{member.type}</td>
                        <td>{member.subscribed}</td>
                        <td>{member.expires}</td>
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
