const pool = require('./db')

async function writeDisplayEvent(memberName, action, message, membershipType, membershipStatus, timeSpent, payload = null) {
  try {
    await pool.query(
      'INSERT INTO client_display_events (member_name, action, message, membership_type, membership_status, time_spent, payload) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [memberName, action, message, membershipType, membershipStatus, timeSpent, payload ? JSON.stringify(payload) : null],
    );
    await pool.query('DELETE FROM client_display_events WHERE id NOT IN (SELECT id FROM (SELECT id FROM client_display_events ORDER BY created_at DESC LIMIT 20) AS t)');
  } catch (err) {
    console.error('[display] Failed to write event:', err.message);
  }
}

module.exports = { writeDisplayEvent }