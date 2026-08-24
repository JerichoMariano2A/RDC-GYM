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
  fetchSalesReport,
  checkoutClient,
  setMembershipStatus,
  biometricScan,
} from '../services/auth'
import Sidebar from '../components/Sidebar'
import RealtimeQueue from '../components/RealtimeQueue'
import { daysUntilExpiry, monthStartISO, peso, todayISO } from '../utils/format'

const adminItems = [
  { label: 'Dashboard' },
  { label: 'Input' },
  { label: 'Memberships' },
  { label: 'Manage Staff' },
  { label: 'Audit Logs' },
  { label: 'Reports' },
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
  const [auditSearch, setAuditSearch] = useState('')
  const [dateRange, setDateRange] = useState({ from: monthStartISO(), to: todayISO() })
  const [reportRange, setReportRange] = useState({ from: monthStartISO(), to: todayISO() })
  const [realtimeClients, setRealtimeClients] = useState([])
  const [memberships, setMemberships] = useState([])
  const [staffAccounts, setStaffAccounts] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [reports, setReports] = useState({ totalCheckIns: 0, totalCheckOuts: 0, activeMembers: 0 })
  const [sales, setSales] = useState({ clientSales: [], membershipSales: [], dailyBreakdown: [], visitTotal: 0, membershipTotal: 0, totalSales: 0 })
  const [newStaffName, setNewStaffName] = useState('')
  const [newStaffPassword, setNewStaffPassword] = useState('')
  const [newStaffConfirm, setNewStaffConfirm] = useState('')
  const [showStaffPassword, setShowStaffPassword] = useState(false)
  const [showStaffConfirm, setShowStaffConfirm] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  const [newMemberType, setNewMemberType] = useState('Member - Per Session')
  const [newMemberSubscribed, setNewMemberSubscribed] = useState(todayISO())
  const [newMemberExpires, setNewMemberExpires] = useState(new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10))
  const [editingMembership, setEditingMembership] = useState(null)
  const [statusMessage, setStatusMessage] = useState(null)
  const [inputMode, setInputMode] = useState('choose')
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
      const data = await fetchAuditLogs({ from: dateRange.from, to: dateRange.to, role: auditRoleFilter, query: auditSearch })
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

  async function loadSales() {
    try {
      const data = await fetchSalesReport({ from: reportRange.from, to: reportRange.to })
      setSales(data)
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
      await createClient({ name: clientName, type: nonMemberType, payment: paymentStatus })
      setStatusMessage('Non-member registered and timed in')
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
      const payload = {
        name: newMemberName,
        type: newMemberType,
        subscribed_on: newMemberSubscribed,
        expires_on: newMemberExpires,
        status: editingMembership?.status || 'active',
      }
      if (editingMembership) {
        await editMembership(editingMembership.id, payload)
        setStatusMessage('Member updated successfully')
      } else {
        await createMembership(payload)
        setStatusMessage('Member added successfully')
      }
      handleCancelEdit()
      loadMemberships()
      loadReports()
    } catch (err) {
      console.error(err)
      setStatusMessage('Failed to save member')
    }
  }

  async function handleSimulateFingerprint() {
    const confirmed = window.confirm('Simulate a fingerprint scan? Members already inside will be timed out automatically.')
    if (!confirmed) {
      setStatusMessage('Fingerprint scan cancelled')
      return
    }
    const simulatedName = memberships[0]?.name || `Fingerprint User ${Math.floor(Math.random() * 1000)}`
    try {
      const client = await biometricScan({
        name: simulatedName,
        type: memberships[0]?.type || 'Member',
        payment: 'Paid',
        secret: 'rdc_biometric_secret',
      })
      setStatusMessage(
        client.action === 'checkout'
          ? `Fingerprint timed out ${simulatedName}. Time spent: ${client.duration}.`
          : `Fingerprint timed in ${simulatedName}.`,
      )
      loadRealtimeClients()
    } catch (err) {
      console.error(err)
      setStatusMessage('Failed to record fingerprint scan')
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
    setNewMemberSubscribed(todayISO())
    setNewMemberExpires(new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10))
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

  async function handleAddStaff() {
    if (!newStaffName || !newStaffPassword || !newStaffConfirm) {
      setStatusMessage('Enter username, password, and confirm password')
      return
    }
    if (newStaffPassword !== newStaffConfirm) {
      setStatusMessage('Password and confirm password do not match')
      return
    }
    const confirmed = window.confirm(`Create staff account "${newStaffName}"?`)
    if (!confirmed) {
      setStatusMessage('Staff account creation cancelled')
      return
    }
    try {
      await createStaff({ username: newStaffName, password: newStaffPassword, confirmPassword: newStaffConfirm })
      setNewStaffName('')
      setNewStaffPassword('')
      setNewStaffConfirm('')
      setStatusMessage('Staff account created')
      loadStaffAccounts()
    } catch (err) {
      console.error(err)
      setStatusMessage(err.response?.data?.error || 'Failed to add staff')
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
      setStatusMessage('Staff account deleted')
      loadStaffAccounts()
    } catch (err) {
      console.error(err)
      setStatusMessage('Failed to delete staff')
    }
  }

  function printSalesReport() {
    window.print()
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

  const groupedAuditLogs = useMemo(() => {
    return auditLogs.reduce((groups, log) => {
      const key = log.log_date || (log.timestamp || '').slice(0, 10) || 'Unknown date'
      if (!groups[key]) groups[key] = []
      groups[key].push(log)
      return groups
    }, {})
  }, [auditLogs])

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

  useEffect(() => {
    if (activePage === 'Memberships') loadMemberships()
  }, [activePage, searchTerm, membershipFilter])

  useEffect(() => {
    if (activePage === 'Manage Staff') loadStaffAccounts()
  }, [activePage])

  useEffect(() => {
    if (activePage === 'Audit Logs') loadAuditLogs()
  }, [activePage, auditRoleFilter, dateRange, auditSearch])

  useEffect(() => {
    if (activePage === 'Reports') {
      loadReports()
      loadSales()
    }
  }, [activePage, reportRange])

  return (
    <div className="app-layout">
      <Sidebar items={adminItems} activeItem={activePage} onSelect={setActivePage} onLogout={() => { logout(); navigate('/login') }} />
      <main className="main-view">
        {activePage === 'Dashboard' && (
          <header className="page-header header-with-actions no-print">
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
              <div className="status-grid no-print">
                <div className="stat-card"><strong>Total Check-Ins</strong><span>{reports.totalCheckIns}</span></div>
                <div className="stat-card"><strong>Total Check-Outs</strong><span>{reports.totalCheckOuts}</span></div>
                <div className="stat-card"><strong>Active Members</strong><span>{reports.activeMembers}</span></div>
              </div>
              <RealtimeQueue
                clients={realtimeClients}
                now={currentTime}
                onCheckout={handleCheckout}
                onSimulateFingerprint={handleSimulateFingerprint}
                canSimulate
                statusMessage={statusMessage}
              />
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
                  <button type="button" className="pill action choice-button" onClick={() => setInputMode('register')}>NON MEMBER</button>
                  <button type="button" className="pill action choice-button" onClick={() => setInputMode('member')}>MEMBER</button>
                </div>
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
                    <button type="button" className="pill" onClick={() => { handleCancelEdit(); setInputMode('choose') }}>Back</button>
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
                          <td className="action-cell">
                            <button type="button" className="pill" onClick={() => handleEditMembership(member)}>Edit</button>
                            <button type="button" className="pill" onClick={() => handleToggleMembership(member)}>
                              {member.status === 'inactive' ? 'Reactivate' : 'Deactivate'}
                            </button>
                            <button type="button" className="pill danger" onClick={() => handleDeleteMembership(member.id)}>Delete</button>
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

          {activePage === 'Manage Staff' && (
            <>
              <div className="section-title-row header-right-label">
                <h3>Manage Staff</h3>
                <div className="right-label">Admin Panel</div>
              </div>
              <div className="form-grid staff-form">
                <label>
                  Staff Username
                  <input value={newStaffName} onChange={e => setNewStaffName(e.target.value)} placeholder="Enter username" />
                </label>
                <label>
                  Staff Password
                  <div className="password-field">
                    <input
                      type={showStaffPassword ? 'text' : 'password'}
                      value={newStaffPassword}
                      onChange={e => setNewStaffPassword(e.target.value)}
                      placeholder="Enter password"
                    />
                    <button
                      type="button"
                      className={showStaffPassword ? 'password-toggle show' : 'password-toggle'}
                      onClick={() => setShowStaffPassword(prev => !prev)}
                      aria-label={showStaffPassword ? 'Hide password' : 'Show password'}
                    >
                      <span className="eye-icon" aria-hidden="true"></span>
                    </button>
                  </div>
                </label>
                <label>
                  Confirm Password
                  <div className="password-field">
                    <input
                      type={showStaffConfirm ? 'text' : 'password'}
                      value={newStaffConfirm}
                      onChange={e => setNewStaffConfirm(e.target.value)}
                      placeholder="Re-enter password"
                    />
                    <button
                      type="button"
                      className={showStaffConfirm ? 'password-toggle show' : 'password-toggle'}
                      onClick={() => setShowStaffConfirm(prev => !prev)}
                      aria-label={showStaffConfirm ? 'Hide confirm password' : 'Show confirm password'}
                    >
                      <span className="eye-icon" aria-hidden="true"></span>
                    </button>
                  </div>
                </label>
              </div>
              <div className="submit-row" style={{ justifyContent: 'flex-start' }}>
                <button type="button" className="pill active" onClick={handleAddStaff}>+ Add new staff account</button>
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
                <div>
                  <h3>Audit Logs</h3>
                  <p className="section-subtitle">Admin-only activity trail. Staff logins, check-ins, membership changes, and account actions are stored here for transparency.</p>
                </div>
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
                  <label>
                    Search
                    <input value={auditSearch} onChange={e => setAuditSearch(e.target.value)} placeholder="User, event, or detail" />
                  </label>
                </div>
              </div>
              <div className="audit-secure-note">Only administrators can open this page. Entries cannot be edited from the panel.</div>
              {Object.keys(groupedAuditLogs).length === 0 && (
                <div className="table-card"><div className="table-card-header">No activity in this date range.</div></div>
              )}
              {Object.entries(groupedAuditLogs).map(([day, logs]) => (
                <div className="table-card audit-group" key={day}>
                  <div className="table-card-header"><strong>{day}</strong><span>{logs.length} event{logs.length === 1 ? '' : 's'}</span></div>
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>User</th>
                        <th>Role</th>
                        <th>Event</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map(log => (
                        <tr key={log.id ?? `${log.timestamp}-${log.user}-${log.event}`}>
                          <td>{(log.timestamp || '').slice(11) || log.timestamp}</td>
                          <td>{log.user}</td>
                          <td><span className={`status-chip ${log.role === 'admin' ? 'active' : 'staff'}`}>{log.role}</span></td>
                          <td>{log.event}</td>
                          <td>{log.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </>
          )}

          {activePage === 'Reports' && (
            <div className="print-report">
              <div className="section-title-row header-right-label no-print">
                <div>
                  <h3>Reports / POS</h3>
                  <p className="section-subtitle">Track income from the selected start date through the selected end date. Sales are broken down by the system. Print to save as PDF. Excel export is not used.</p>
                </div>
                <div className="right-label">Admin Reports</div>
              </div>
              <div className="print-only-title">
                <h2>RDC GYM POS Sales Report</h2>
                <p>{reportRange.from} to {reportRange.to}</p>
              </div>
              <div className="filter-row no-print">
                <label>
                  From
                  <input type="date" value={reportRange.from} onChange={e => setReportRange(prev => ({ ...prev, from: e.target.value }))} />
                </label>
                <label>
                  To
                  <input type="date" value={reportRange.to} onChange={e => setReportRange(prev => ({ ...prev, to: e.target.value }))} />
                </label>
              </div>
              <div className="status-grid">
                <div className="stat-card"><strong>Visit Income</strong><span>{peso(sales.visitTotal)}</span></div>
                <div className="stat-card"><strong>Membership Income</strong><span>{peso(sales.membershipTotal)}</span></div>
                <div className="stat-card"><strong>Total Sales</strong><span>{peso(sales.totalSales)}</span></div>
              </div>
              <div className="status-grid">
                <div className="stat-card"><strong>Check-Ins (today)</strong><span>{reports.totalCheckIns}</span></div>
                <div className="stat-card"><strong>Check-Outs (today)</strong><span>{reports.totalCheckOuts}</span></div>
                <div className="stat-card"><strong>Active Members</strong><span>{reports.activeMembers}</span></div>
              </div>
              <div className="table-card">
                <div className="table-card-header"><strong>Visit sales by type</strong></div>
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Paid Visits</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sales.clientSales || []).length === 0 && <tr><td colSpan={3}>No paid visits in this range.</td></tr>}
                    {(sales.clientSales || []).map(row => (
                      <tr key={row.type}>
                        <td>{row.type}</td>
                        <td>{row.visits}</td>
                        <td>{peso(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-card" style={{ marginTop: 18 }}>
                <div className="table-card-header"><strong>Membership sales by plan</strong></div>
                <table>
                  <thead>
                    <tr>
                      <th>Plan</th>
                      <th>Subscriptions</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sales.membershipSales || []).length === 0 && <tr><td colSpan={3}>No membership sales in this range.</td></tr>}
                    {(sales.membershipSales || []).map(row => (
                      <tr key={row.type}>
                        <td>{row.type}</td>
                        <td>{row.count}</td>
                        <td>{peso(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-card" style={{ marginTop: 18 }}>
                <div className="table-card-header"><strong>Daily sales breakdown</strong></div>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Source</th>
                      <th>Type</th>
                      <th>Qty</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sales.dailyBreakdown || []).length === 0 && <tr><td colSpan={5}>No sales recorded for the selected dates.</td></tr>}
                    {(sales.dailyBreakdown || []).map(row => (
                      <tr key={`${row.sale_date}-${row.source}-${row.type}`}>
                        <td>{typeof row.sale_date === 'string' ? row.sale_date.slice(0, 10) : row.sale_date}</td>
                        <td>{row.source}</td>
                        <td>{row.type}</td>
                        <td>{row.qty}</td>
                        <td>{peso(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="report-actions no-print">
                <button type="button" className="pill action" onClick={printSalesReport}>Print / Save as PDF</button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
