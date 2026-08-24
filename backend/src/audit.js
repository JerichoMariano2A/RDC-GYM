const pool = require('./db')

async function writeAudit(req, eventType, description, entity = null, entityId = null) {
  const user = (req && req.user) || {}
  const ip = req && (req.headers['x-forwarded-for'] || req.ip || null)
  try {
    await pool.query(
      `INSERT INTO audit_logs
        (user_id, action, entity, entity_id, details, ip_address, \`user\`, \`role\`, event_type, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id || null,
        eventType,
        entity,
        entityId == null ? null : String(entityId),
        description,
        ip,
        user.username || 'system',
        user.role || 'staff',
        eventType,
        description,
      ],
    )
  } catch (err) {
    console.error('Failed to write audit log:', err.message)
  }
}

module.exports = { writeAudit }
