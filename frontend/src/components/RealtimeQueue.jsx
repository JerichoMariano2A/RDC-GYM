import React from 'react'
import { formatDuration, isMemberType, liveDurationSeconds, peso } from '../utils/format'

function pendingAmount(client) {
  const balance = Number(client.balance || 0)
  if (balance > 0) return balance
  return Number(client.totalAmount || 0)
}

export default function RealtimeQueue({
  clients,
  now,
  onCheckout,
  onCollectPayment,
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

  function needsPayment(client) {
    return client.payment !== 'Paid' || Number(client.balance || 0) > 0
  }

  return (
    <>
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
                <td>
                  <span className={client.payment === 'Paid' && Number(client.balance || 0) <= 0 ? 'status-chip active' : 'status-chip inactive'}>
                    {client.payment === 'Paid' ? 'Paid' : 'Unpaid'}
                  </span>
                  {Number(client.balance || 0) > 0 && <span className="expiry-chip">{peso(client.balance)} due</span>}
                </td>
                <td>{client.time_in || '--'}</td>
                <td>{client.time_out || (client.inside ? <span className="status-chip inside">Inside</span> : '--')}</td>
                <td>{spentTime(client)}</td>
                {tab === 'non-members' && (
                  <td className="action-cell">
                    {client.inside && onCheckout && (
                      <button type="button" className="pill action end-time-btn" onClick={() => onCheckout(client)}>
                        End Time
                      </button>
                    )}
                    {!client.inside && !needsPayment(client) && <span className="muted-text">Completed</span>}
                    {!client.inside && needsPayment(client) && onCollectPayment && (
                      <button type="button" className="pill action" onClick={() => onCollectPayment(client)}>
                        Collect {peso(pendingAmount(client))}
                      </button>
                    )}
                    {!client.inside && needsPayment(client) && !onCollectPayment && <span className="muted-text">{peso(pendingAmount(client))} due</span>}
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
