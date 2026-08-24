import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  logout,
  createClient,
  createStaff,
  createMembership,
  deleteMembership,
  editMembership,
  deleteStaff,
  fetchRealtimeClients,
  fetchMemberships,
  fetchStaff,
  fetchAuditLogs,
  fetchReports,
} from '../services/auth'
import Sidebar from '../components/Sidebar'

const adminItems = [
  { label: 'Reports' },
  { label: 'Dashboard' },
  { label: 'Input' },
  { label: 'Memberships' },
  { label: 'Manage Staff' },
  { label: 'Audit Logs' },
]

const paymentStatusOptions = [
  { label: 'Paid', value: 'Paid' },
  { label: 'Unpaid', value: 'Not Paid' },
]

const memberTypeOptions = [
  { label: 'Member - Per Session (₱50)', value: 'Member - Per Session' },
  { label: 'Member - Monthly (₱700)', value: 'Member - Monthly' },
  { label: 'Member - Yearly (₱500)', value: 'Member - Yearly' },
]

const nonMemberTypeOptions = [
  { label: 'Non-Member - Per Session (₱70)', value: 'Non-Member - Per Session' },
  { label: 'Non-Member - Student (₱60)', value: 'Non-Member - Student' },
  { label: 'Non-Member - Monthly (₱1,100)', value: 'Non-Member - Monthly' },
]

export default function Admin() {
  const [activePage, setActivePage] = useState('Dashboard')
  const [currentTime, setCurrentTime] = useState(new Date())
  const [clientName, setClientName] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('Paid')
  const [nonMemberType, setNonMemberType] = useState('Non-Member - Per Session')
  const [searchTerm, setSearchTerm] = useState('')
  const [membershipFilter, setMembershipFilter] = useState('All')
  const [auditRoleFilter, setAuditRoleFilter] = useState('All')
  const [dateRange, setDateRange] = useState({ from: '2026-08-01', to: '2026-08-31' })
  const [realtimeClients, setRealtimeClients] = useState([])
  const [memberships, setMemberships] = useState([])
  const [staffAccounts, setStaffAccounts] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [reports, setReports] = useState({ totalCheckIns: 0, totalCheckOuts: 0, activeMembers: 0 })
  const [newStaffName, setNewStaffName] = useState('')
  const [newStaffPassword, setNewStaffPassword] = useState('')
  const [newMemberName, setNewMemberName] = useState('')
  const [newMemberType, setNewMemberType] = useState('Member - Per Session')
  const [newMemberSubscribed, setNewMemberSubscribed] = useState('2026-08-11')
  const [newMemberExpires, setNewMemberExpires] = useState('2027-08-11')
  const [editingMembership, setEditingMembership] = useState(null)
  const [lastCreatedClient, setLastCreatedClient] = useState(null)
  const [statusMessage, setStatusMessage] = useState(null)
  const [inputMode, setInputMode] = useState('choose')
  const [biometricClients, setBiometricClients] = useState([])
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

  async function loadStaffAccounts() {
    try {
      const data = await fetchStaff()
      setStaffAccounts(data)
    } catch (err) {
      console.error(err)
    }
  }

  async function loadAuditLogs() {
    try {
      const data = await fetchAuditLogs({ from: dateRange.from, to: dateRange.to, role: auditRoleFilter })
      setAuditLogs(data)
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

  async function handleSaveClient() {
    const confirmed = window.confirm(`Register non-member "${clientName}" with ${nonMemberType} and ${paymentStatus} payment?`)
    if (!confirmed) {
      setStatusMessage('Non-member registration cancelled')
      return
    }

    try {
      const client = await createClient({ name: clientName, type: nonMemberType, payment: paymentStatus })
      setLastCreatedClient(client)
      setStatusMessage('Non-member registered successfully')
      setClientName('')
      setNonMemberType('Non-Member - Per Session')
      setPaymentStatus('Paid')
      loadRealtimeClients()
    } catch (err) {
      console.error(err)
      setStatusMessage('Failed to save non-member')
    }
  }

  async function handleCreateMembership() {
    if (!newMemberName) {
      setStatusMessage('Enter a name for the new member')
      return
    }

    const actionLabel = editingMembership ? 'update' : 'add'
    const confirmed = window.confirm(`${editingMembership ? 'Update' : 'Add'} member "${newMemberName}" with ${newMemberType} membership?`)
    if (!confirmed) {
      setStatusMessage(`Member ${actionLabel} cancelled`)
      return
    }

    try {
      await createMembership({
        name: newMemberName,
        type: newMemberType,
        subscribed_on: newMemberSubscribed,
        expires_on: newMemberExpires,
      })
      setNewMemberName('')
      setNewMemberType('Member - Per Session')
      setNewMemberSubscribed(new Date().toISOString().slice(0, 10))
      setNewMemberExpires(new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10))
      setStatusMessage('Member added successfully')
      loadMemberships()
      loadReports()
    } catch (err) {
      console.error(err)
      setStatusMessage('Failed to add member')
    }
  }

  async function handleSimulateFingerprint() {
    const confirmed = window.confirm('Simulate a fingerprint scan and record a check-in?')
    if (!confirmed) {
      setStatusMessage('Fingerprint scan cancelled')
      return
    }
    const simulatedName = `Fingerprint User ${Math.floor(Math.random() * 1000)}`
    try {
      const client = await biometricScan({
        name: simulatedName,
        type: 'Walk-in',
        payment: 'Paid',
        secret: 'rdc_biometric_secret',
      })
      setBiometricClients(prev => [client, ...prev].slice(0, 10))
      setStatusMessage(`Fingerprint scan recorded for ${simulatedName}`)
      loadRealtimeClients()
    } catch (err) {
      console.error(err)
      setStatusMessage('Failed to record fingerprint scan')
    }
  }

  function handleEditMembership(member) {
    setEditingMembership(member)
    setNewMemberName(member.name)
    setNewMemberType(member.type)
    setNewMemberSubscribed(member.subscribed)
    setNewMemberExpires(member.expires)
    setStatusMessage('Editing member: ' + member.name)
    setActivePage('Input')
    setInputMode('member')
  }

  function handleCancelEdit() {
    setEditingMembership(null)
    setNewMemberName('')
    setNewMemberType('Member - Per Session')
    setNewMemberSubscribed(new Date().toISOString().slice(0, 10))
    setNewMemberExpires(new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10))
    setStatusMessage(null)
  }

  async function handleDeleteMembership(id) {
    const confirmed = window.confirm('Are you sure you want to remove this member? This cannot be undone.')
    if (!confirmed) {
      setStatusMessage('Member removal cancelled')
      return
    }
    try {
      await deleteMembership(id)
      setStatusMessage('Member removed successfully')
      loadMemberships()
    } catch (err) {
      console.error(err)
      setStatusMessage('Failed to remove member')
    }
  }

  async function handleAddStaff() {
    if (!newStaffName || !newStaffPassword) {
      setStatusMessage('Enter staff username and password')
      return
    }
    const confirmed = window.confirm(`Create staff account "${newStaffName}"?`)
    if (!confirmed) {
      setStatusMessage('Staff account creation cancelled')
      return
    }
    try {
      await createStaff({ username: newStaffName, password: newStaffPassword })
      setNewStaffName('')
      setNewStaffPassword('')
      setStatusMessage('Staff account created')
      loadStaffAccounts()
    } catch (err) {
      console.error(err)
      setStatusMessage('Failed to add staff')
    }
  }

  async function handleDeleteStaff(id) {
    const confirmed = window.confirm('Are you sure you want to delete this staff account? This cannot be undone.')
    if (!confirmed) {
      setStatusMessage('Staff deletion cancelled')
      return
    }
    try {
      await deleteStaff(id)
      loadStaffAccounts()
    } catch (err) {
      console.error(err)
      setStatusMessage('Failed to delete staff')
    }
  }

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const timeText = useMemo(() => currentTime.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit' }), [currentTime])
  const dateText = useMemo(() => currentTime.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), [currentTime])

  const filteredMembers = useMemo(() => {
    return memberships.filter(member => {
      const matchesSearch = member.name.toLowerCase().includes(searchTerm.toLowerCase()) || member.type.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesType = membershipFilter === 'All' || member.type === membershipFilter
      return matchesSearch && matchesType
    })
  }, [memberships, searchTerm, membershipFilter])

  useEffect(() => {
    let intervalId
    if (activePage === 'Dashboard') {
      loadRealtimeClients()
      loadReports()
      intervalId = setInterval(() => {
        loadRealtimeClients()
        loadReports()
      }, 5000)
    }
    return () => clearInterval(intervalId)
  }, [activePage])

  useEffect(() => {
    if (activePage === 'Input') {
      setInputMode('choose')
      setEditingMembership(null)
      setStatusMessage(null)
    }
  }, [activePage])

  useEffect(() => {
    if (activePage === 'Memberships') loadMemberships()
  }, [activePage, searchTerm, membershipFilter])

  useEffect(() => {
    if (activePage === 'Manage Staff') loadStaffAccounts()
  }, [activePage])

  useEffect(() => {
    if (activePage === 'Audit Logs') loadAuditLogs()
  }, [activePage, auditRoleFilter, dateRange])

  useEffect(() => {
    if (activePage === 'Reports') loadReports()
  }, [activePage])

  return (
    <div className="app-layout">
      <Sidebar items={adminItems} activeItem={activePage} onSelect={setActivePage} onLogout={() => { logout(); navigate('/login') }} />
      <main className="main-view">
        {activePage === 'Dashboard' && (
          <header className="page-header header-with-actions">
            <div>
              <h2>RDC GYM</h2>
              <p>Admin dashboard</p>
            </div>
            <div className="page-header-meta">
              <div className="time-block">
                <strong>{timeText}</strong>
                <span>{dateText}</span>
              </div>
              <div className="welcome-badge">Welcome Admin</div>
            </div>
          </header>
        )}

        <section className="content-card">
          {activePage === 'Dashboard' && (
            <>
              <div className="section-title-row">
                <h3>Dashboard</h3>
                <p>Live client queue and check-in status.</p>
              </div>
              <div className="status-grid">
                <div className="stat-card"><strong>Total Check-Ins</strong><span>{reports.totalCheckIns}</span></div>
                <div className="stat-card"><strong>Total Check-Outs</strong><span>{reports.totalCheckOuts}</span></div>
                <div className="stat-card"><strong>Active Members</strong><span>{reports.activeMembers}</span></div>
              </div>
              <div className="table-card">
                <div className="table-card-header"><strong>Real-time client details</strong></div>
                <div className="fingerprint-note">Fingerprint scans from R307 appear here automatically when the system receives them.</div>
                <button type="button" className="pill active" onClick={handleSimulateFingerprint}>Simulate Fingerprint Scan</button>
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
                <div>
                  <h3>Register Client</h3>
                  <p className="section-subtitle">Choose whether to register a non-member or add a new member.</p>
                </div>
              </div>

              {inputMode === 'choose' && (
                <div className="input-choice-grid">
                  <button
                    type="button"
                    className="pill action choice-button"
                    onClick={() => setInputMode('register')}
                  >
                    NON MEMBER
                  </button>
                  <button
                    type="button"
                    className="pill action choice-button"
                    onClick={() => setInputMode('member')}
                  >
                    MEMBER
                  </button>
                </div>
              )}

              {inputMode === 'register' && (
                <>
                  <div className="section-title-row">
                    <div>
                      <h3>REGISTER NON-MEMBER</h3>
                      <p className="section-subtitle">Enter the non-member details and payment information.</p>
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
                </>
              )}

              {inputMode === 'member' && (
                <>
                  <div className="section-title-row">
                    <div>
                      <h3>{editingMembership ? 'EDIT MEMBER' : 'ADD NEW MEMBER'}</h3>
                      <p className="section-subtitle">Enter the member details for membership record creation.</p>
                    </div>
                    <button type="button" className="pill" onClick={() => setInputMode('choose')}>Back</button>
                  </div>
                  <div className="register-card">
                    <div className="form-grid membership-form">
                      <label>
                        Member Name
                        <input value={newMemberName} onChange={e => setNewMemberName(e.target.value)} placeholder="Enter member name" />
                      </label>
                      <label>
                        Membership Type
                        <select value={newMemberType} onChange={e => setNewMemberType(e.target.value)}>
                          {memberTypeOptions.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Subscribed On
                        <input type="date" value={newMemberSubscribed} onChange={e => setNewMemberSubscribed(e.target.value)} />
                      </label>
                      <label>
                        Expires On
                        <input type="date" value={newMemberExpires} onChange={e => setNewMemberExpires(e.target.value)} />
                      </label>
                    </div>
                    <div className="submit-row">
                      <button type="button" className="pill action" onClick={handleCreateMembership}>{editingMembership ? 'Update Member' : 'Add Member'}</button>
                      {editingMembership && <button type="button" className="pill danger" onClick={handleCancelEdit} style={{ marginLeft: '12px' }}>Cancel</button>}
                    </div>
                  </div>
                </>
              )}

              {statusMessage && <div className="status-message">{statusMessage}</div>}
            </>
          )}

          {activePage === 'Memberships' && (
            <>
              <div className="section-title-row">
                <div>
                  <h3>Member List</h3>
                  <p>Search by member name and review current membership records.</p>
                  <p style={{ marginTop: '8px', color: '#6b7280', fontSize: '0.95rem' }}>
                    Use the Input page to add or edit member records.
                  </p>
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
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMembers.map(member => (
                      <tr key={member.id ?? member.name}>
                        <td>{member.name}</td>
                        <td>{member.type}</td>
                        <td>{member.subscribed}</td>
                        <td>{member.expires}</td>
                        <td>
                          <button type="button" className="pill" onClick={() => handleEditMembership(member)}>Edit</button>
                          <button type="button" className="pill danger" onClick={() => handleDeleteMembership(member.id)}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {activePage === 'Manage Staff' && (
            <>
              <div className="section-title-row header-right-label">
                <h3>Manage Staff</h3>
                <div className="right-label">Admin Panel</div>
              </div>
              <div className="top-bar">
                <span>+ Add new staff account</span>
              </div>
              <div className="top-bar">
                <button type="button" className="pill active" onClick={handleAddStaff}>+ Add new staff account</button>
              </div>
              <div className="form-grid staff-form">
                <label>
                  Staff Username
                  <input value={newStaffName} onChange={e => setNewStaffName(e.target.value)} placeholder="Enter username" />
                </label>
                <label>
                  Staff Password
                  <input type="password" value={newStaffPassword} onChange={e => setNewStaffPassword(e.target.value)} placeholder="Enter password" />
                </label>
              </div>
              <div className="table-card">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Staff ID</th>
                      <th>Date Added</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffAccounts.map(staff => (
                      <tr key={staff.staffId}>
                        <td>{staff.name}</td>
                        <td>{staff.staffId}</td>
                        <td>{staff.dateAdded}</td>
                        <td>
                          <button className="pill">Edit</button>
                          <button className="pill danger" onClick={() => handleDeleteStaff(staff.id)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {statusMessage && <div className="status-message">{statusMessage}</div>}
            </>
          )}

          {activePage === 'Audit Logs' && (
            <>
              <div className="section-title-row">
                <h3>Audit Logs</h3>
                <div className="filter-row">
                  <label>
                    From
                    <input type="date" value={dateRange.from} onChange={e => setDateRange(prev => ({ ...prev, from: e.target.value }))} />
                  </label>
                  <label>
                    To
                    <input type="date" value={dateRange.to} onChange={e => setDateRange(prev => ({ ...prev, to: e.target.value }))} />
                  </label>
                  <label>
                    Role
                    <select value={auditRoleFilter} onChange={e => setAuditRoleFilter(e.target.value)}>
                      <option>All</option>
                      <option>Admin</option>
                      <option>Staff</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="table-card">
                <table>
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>User</th>
                      <th>Event Type</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map(log => (
                      <tr key={`${log.timestamp}-${log.user}`}>
                        <td>{log.timestamp}</td>
                        <td>{log.user}</td>
                        <td>{log.event}</td>
                        <td>{log.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {activePage === 'Reports' && (
            <>
              <div className="section-title-row header-right-label">
                <h3>Reports</h3>
                <div className="right-label">Admin Reports: System Check-in/Check out & System Usage</div>
              </div>
              <div className="status-grid">
                <div className="stat-card"><strong>Total Check-Ins (today)</strong><span>{reports.totalCheckIns}</span></div>
                <div className="stat-card"><strong>Total Check-Outs (today)</strong><span>{reports.totalCheckOuts}</span></div>
                <div className="stat-card"><strong>Members (Active Members)</strong><span>{reports.activeMembers}</span></div>
              </div>
              <div className="report-actions">
                <button className="pill">Download as PDF</button>
                <button className="pill">Print Reports</button>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
