import React from 'react'
import { formatDuration, isMemberType, liveDurationSeconds } from '../utils/format'

export default function RealtimeQueue({
  clients,
  now,
  onCheckout,
  onSimulateFingerprint,
  canSimulate = false,
  statusMessage,
}) {
  const [tab, setTab] = React.useState('members')
  const members = clients.filter(client => isMemberType(client.type))
  const nonMembers = clients.filter(client => !isMemberType(client.type))
  const rows = tab === 'members' ? members : nonMembers

  function spentTime(client) {
    if (client.time_out) return client.duration || formatDuration(client.duration_seconds)
    return formatDuration(liveDurationSeconds(client.time_in_at, now))
  }

  return (
    <>
      <div className="section-title-row">
        <div>
          <h3>Dashboard</h3>
          <p>Separate live time-in and time-out records for members and walk-in clients.</p>
        </div>
      </div>
      <div className="dashboard-tabs">
        <button type="button" className={tab === 'members' ? 'pill active' : 'pill'} onClick={() => setTab('members')}>
          Members ({members.length})
        </button>
        <button type="button" className={tab === 'non-members' ? 'pill active' : 'pill'} onClick={() => setTab('non-members')}>
          Non-Members ({nonMembers.length})
        </button>
      </div>
      <div className="table-card">
        <div className="table-card-header">
          <strong>{tab === 'members' ? 'Member fingerprint attendance' : 'Walk-in / non-member attendance'}</strong>
        </div>
        {tab === 'members' ? (
          <div className="fingerprint-note">
            Members time in and time out automatically when the fingerprint scanner records them. A second scan stores time out and the time spent.
          </div>
        ) : (
          <div className="fingerprint-note">
            Non-members are timed in at registration. Admin or staff must click End Time to store time out. Spent time is calculated automatically.
          </div>
        )}
        {canSimulate && tab === 'members' && (
          <div className="table-toolbar">
            <button type="button" className="pill active" onClick={onSimulateFingerprint}>Simulate Fingerprint Scan</button>
          </div>
        )}
        <table>
          <thead>
            <tr>
              <th>Client Name</th>
              <th>Type</th>
              <th>Payment</th>
              <th>Time In</th>
              <th>Time Out</th>
              <th>Time Spent</th>
              {tab === 'non-members' && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={tab === 'non-members' ? 7 : 6}>No {tab === 'members' ? 'member' : 'non-member'} visits yet.</td>
              </tr>
            )}
            {rows.map(client => (
              <tr key={client.id ?? client.name}>
                <td>{client.name}</td>
                <td>{client.type}</td>
                <td>{client.payment}</td>
                <td>{client.time_in || '--'}</td>
                <td>{client.time_out || (client.inside ? 'Inside' : '--')}</td>
                <td>{spentTime(client)}</td>
                {tab === 'non-members' && (
                  <td>
                    {client.inside ? (
                      <button type="button" className="pill action" onClick={() => onCheckout(client)}>
                        End Time
                      </button>
                    ) : (
                      <span className="muted-text">Completed</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {statusMessage && <div className="status-message">{statusMessage}</div>}
    </>
  )
}
