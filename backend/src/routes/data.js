const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { verifyToken, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../audit');
const { priceForType, isMemberType, visitPrice } = require('../pricing');

const router = express.Router();

const CLIENT_SELECT = `
  SELECT id, name, client_type AS type, payment_status AS payment, price,
    DATE_FORMAT(time_in, '%H:%i') AS time_in,
    IF(time_out IS NULL, NULL, DATE_FORMAT(time_out, '%H:%i')) AS time_out,
    time_in AS time_in_at,
    time_out AS time_out_at,
    TIMESTAMPDIFF(SECOND, time_in, COALESCE(time_out, NOW())) AS duration_seconds
  FROM clients
`;

const MEMBERSHIP_SELECT = `
  SELECT id, name, membership_type AS type,
    DATE_FORMAT(subscribed_on, "%Y-%m-%d") AS subscribed,
    DATE_FORMAT(expires_on, "%Y-%m-%d") AS expires,
    price, status
  FROM memberships
`;

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function withDuration(row) {
  if (!row) return row;
  return { ...row, duration: formatDuration(row.duration_seconds), inside: !row.time_out };
}

router.get('/clients/realtime', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`${CLIENT_SELECT} ORDER BY id DESC`);
    res.json(rows.map(withDuration));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load clients' });
  }
});

router.post('/clients', verifyToken, async (req, res) => {
  const { name, type, payment } = req.body;
  if (!name || !type || !payment) return res.status(400).json({ error: 'Name, type and payment are required' });
  try {
    const price = payment === 'Paid' ? visitPrice(type) : 0;
    const [result] = await pool.query(
      'INSERT INTO clients (name, client_type, payment_status, price, time_in) VALUES (?, ?, ?, ?, NOW())',
      [name, type, payment, price],
    );
    const [rows] = await pool.query(`${CLIENT_SELECT} WHERE id = ?`, [result.insertId]);
    await writeAudit(req, 'Walk-in Check-in', `Registered ${type} visit for ${name}.`, 'clients', result.insertId);
    res.status(201).json(withDuration(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

router.post('/clients/:id/checkout', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await pool.query(`${CLIENT_SELECT} WHERE id = ?`, [id]);
    if (!existing.length) return res.status(404).json({ error: 'Visit not found' });
    const visit = existing[0];
    if (visit.time_out) return res.status(400).json({ error: 'This visit is already timed out' });
    if (isMemberType(visit.type)) {
      return res.status(400).json({ error: 'Member time-out is recorded automatically by fingerprint' });
    }

    await pool.query('UPDATE clients SET time_out = NOW() WHERE id = ? AND time_out IS NULL', [id]);
    const [rows] = await pool.query(`${CLIENT_SELECT} WHERE id = ?`, [id]);
    const updated = withDuration(rows[0]);
    await writeAudit(
      req,
      'Walk-in Check-out',
      `Ended visit for ${updated.name}. Time spent: ${updated.duration}.`,
      'clients',
      id,
    );
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record time out' });
  }
});

router.post('/biometric-scan', async (req, res) => {
  const { name, type = 'Member', payment = 'Paid', secret } = req.body || {};
  const expected = process.env.BIOMETRIC_SECRET || 'rdc_biometric_secret';
  if (secret !== expected) {
    return res.status(403).json({ error: 'Invalid biometric key' });
  }
  if (!name) {
    return res.status(400).json({ error: 'Biometric scan must include a name' });
  }
  try {
    const [members] = await pool.query(
      `${MEMBERSHIP_SELECT} WHERE name = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
      [name],
    );
    const member = members[0];
    const clientType = member ? member.type : type;
    const [openVisits] = await pool.query(
      `${CLIENT_SELECT} WHERE name = ? AND time_out IS NULL ORDER BY id DESC LIMIT 1`,
      [name],
    );

    if (openVisits.length && isMemberType(openVisits[0].type || clientType)) {
      await pool.query('UPDATE clients SET time_out = NOW() WHERE id = ? AND time_out IS NULL', [openVisits[0].id]);
      const [rows] = await pool.query(`${CLIENT_SELECT} WHERE id = ?`, [openVisits[0].id]);
      const updated = withDuration(rows[0]);
      await writeAudit(
        { user: { username: 'biometric', role: 'staff' }, ip: req.ip, headers: req.headers },
        'Member Check-out',
        `Fingerprint timed out ${name}. Time spent: ${updated.duration}.`,
        'clients',
        updated.id,
      );
      return res.status(200).json({ ...updated, action: 'checkout' });
    }

    const price = payment === 'Paid' ? visitPrice(clientType) : 0;
    const [result] = await pool.query(
      'INSERT INTO clients (name, client_type, payment_status, price, time_in) VALUES (?, ?, ?, ?, NOW())',
      [name, clientType, payment, price],
    );
    const [rows] = await pool.query(`${CLIENT_SELECT} WHERE id = ?`, [result.insertId]);
    await writeAudit(
      { user: { username: 'biometric', role: 'staff' }, ip: req.ip, headers: req.headers },
      'Member Check-in',
      `Fingerprint timed in ${name}.`,
      'clients',
      result.insertId,
    );
    res.status(201).json({ ...withDuration(rows[0]), action: 'checkin' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record biometric scan' });
  }
});

router.get('/memberships', verifyToken, async (req, res) => {
  const { query, type, status } = req.query;
  let sql = MEMBERSHIP_SELECT;
  const params = [];
  const filters = [];
  if (query) {
    filters.push('(name LIKE ? OR membership_type LIKE ?)');
    params.push(`%${query}%`, `%${query}%`);
  }
  if (type && type !== 'All') {
    filters.push('membership_type = ?');
    params.push(type);
  }
  if (status && status !== 'All') {
    filters.push('status = ?');
    params.push(status);
  }
  if (filters.length) sql += ` WHERE ${filters.join(' AND ')}`;
  sql += ' ORDER BY id DESC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load memberships' });
  }
});

router.post('/memberships', verifyToken, async (req, res) => {
  const { name, type, subscribed_on, expires_on } = req.body;
  if (!name || !type || !subscribed_on || !expires_on) {
    return res.status(400).json({ error: 'Name, type, subscribed date and expiry date are required' });
  }
  try {
    const price = priceForType(type);
    const [result] = await pool.query(
      'INSERT INTO memberships (name, membership_type, subscribed_on, expires_on, price, status) VALUES (?, ?, ?, ?, ?, ?)',
      [name, type, subscribed_on, expires_on, price, 'active'],
    );
    const [rows] = await pool.query(`${MEMBERSHIP_SELECT} WHERE id = ?`, [result.insertId]);
    await writeAudit(req, 'Membership Created', `Added member ${name} (${type}).`, 'memberships', result.insertId);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create membership' });
  }
});

router.put('/memberships/:id', verifyToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { name, type, subscribed_on, expires_on, status } = req.body;
  if (!name || !type || !subscribed_on || !expires_on) {
    return res.status(400).json({ error: 'Name, type, subscribed date and expiry date are required' });
  }
  try {
    const price = priceForType(type);
    const nextStatus = status === 'inactive' ? 'inactive' : 'active';
    await pool.query(
      'UPDATE memberships SET name = ?, membership_type = ?, subscribed_on = ?, expires_on = ?, price = ?, status = ? WHERE id = ?',
      [name, type, subscribed_on, expires_on, price, nextStatus, id],
    );
    const [rows] = await pool.query(`${MEMBERSHIP_SELECT} WHERE id = ?`, [id]);
    await writeAudit(req, 'Membership Updated', `Updated member ${name}.`, 'memberships', id);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update membership' });
  }
});

router.patch('/memberships/:id/status', verifyToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (status !== 'active' && status !== 'inactive') {
    return res.status(400).json({ error: 'Status must be active or inactive' });
  }
  try {
    const [existing] = await pool.query(`${MEMBERSHIP_SELECT} WHERE id = ?`, [id]);
    if (!existing.length) return res.status(404).json({ error: 'Member not found' });
    await pool.query('UPDATE memberships SET status = ? WHERE id = ?', [status, id]);
    const [rows] = await pool.query(`${MEMBERSHIP_SELECT} WHERE id = ?`, [id]);
    const action = status === 'inactive' ? 'Membership Deactivated' : 'Membership Reactivated';
    await writeAudit(req, action, `${action.replace('Membership ', '')} ${existing[0].name}.`, 'memberships', id);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update membership status' });
  }
});

router.delete('/memberships/:id', verifyToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await pool.query(`${MEMBERSHIP_SELECT} WHERE id = ?`, [id]);
    await pool.query('DELETE FROM memberships WHERE id = ?', [id]);
    if (existing[0]) {
      await writeAudit(req, 'Membership Deleted', `Deleted member record ${existing[0].name}.`, 'memberships', id);
    }
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete membership' });
  }
});

router.get('/staff', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, username AS name, CONCAT("STF-", LPAD(id, 3, "0")) AS staffId, DATE_FORMAT(created_at, "%Y-%m-%d") AS dateAdded FROM users WHERE role = ?', ['staff']);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load staff accounts' });
  }
});

router.post('/staff', verifyToken, requireRole('admin'), async (req, res) => {
  const { username, password, confirmPassword } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  if (confirmPassword != null && password !== confirmPassword) {
    return res.status(400).json({ error: 'Password and confirm password do not match' });
  }
  try {
    const [exists] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (exists.length) return res.status(409).json({ error: 'Username already exists' });
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hash, 'staff']);
    await writeAudit(req, 'Staff Added', `Created staff account ${username}.`, 'users', result.insertId);
    res.status(201).json({ id: result.insertId, username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create staff account' });
  }
});

router.delete('/staff/:id', verifyToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await pool.query('SELECT username FROM users WHERE id = ? AND role = ?', [id, 'staff']);
    await pool.query('DELETE FROM users WHERE id = ? AND role = ?', [id, 'staff']);
    if (existing[0]) {
      await writeAudit(req, 'Staff Deleted', `Deleted staff account ${existing[0].username}.`, 'users', id);
    }
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete staff account' });
  }
});

router.get('/audit-logs', verifyToken, requireRole('admin'), async (req, res) => {
  const { from, to, role, query } = req.query;
  let sql = `SELECT a.id,
      DATE_FORMAT(a.created_at, "%Y-%m-%d %H:%i:%s") AS timestamp,
      DATE_FORMAT(a.created_at, "%Y-%m-%d") AS log_date,
      COALESCE(u.username, a.user, 'system') AS user,
      COALESCE(u.role, a.role, 'staff') AS role,
      COALESCE(a.event_type, a.action) AS event,
      COALESCE(a.description, a.details) AS description,
      a.ip_address AS ip
    FROM audit_logs a
    LEFT JOIN users u ON a.user_id = u.id`;
  const filters = [];
  const params = [];
  if (from) {
    filters.push('a.created_at >= ?');
    params.push(from);
  }
  if (to) {
    filters.push('a.created_at <= ?');
    params.push(`${to} 23:59:59`);
  }
  if (role && role !== 'All') {
    filters.push('COALESCE(u.role, a.role) = ?');
    params.push(String(role).toLowerCase());
  }
  if (query) {
    filters.push('(COALESCE(u.username, a.user) LIKE ? OR COALESCE(a.event_type, a.action) LIKE ? OR COALESCE(a.description, a.details) LIKE ?)');
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  if (filters.length) sql += ` WHERE ${filters.join(' AND ')}`;
  sql += ' ORDER BY a.created_at DESC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load audit logs' });
  }
});

router.get('/reports', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const [[checkIns]] = await pool.query('SELECT COUNT(*) AS total FROM clients WHERE DATE(time_in) = CURDATE()');
    const [[checkOuts]] = await pool.query('SELECT COUNT(*) AS total FROM clients WHERE DATE(time_out) = CURDATE()');
    const [[members]] = await pool.query("SELECT COUNT(*) AS total FROM memberships WHERE status = 'active' AND expires_on >= CURDATE()");
    res.json({ totalCheckIns: checkIns.total, totalCheckOuts: checkOuts.total, activeMembers: members.total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

router.get('/reports/sales', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { from, to } = req.query;
    const start = from || '1970-01-01';
    const end = to || '9999-12-31';

    const [clientSales] = await pool.query(
      `SELECT client_type AS type, COUNT(*) AS visits, COALESCE(SUM(price), 0) AS total
       FROM clients
       WHERE payment_status = 'Paid' AND DATE(time_in) >= ? AND DATE(time_in) <= ?
       GROUP BY client_type
       ORDER BY total DESC`,
      [start, end],
    );

    const [membershipSales] = await pool.query(
      `SELECT membership_type AS type, COUNT(*) AS count, COALESCE(SUM(price), 0) AS total
       FROM memberships
       WHERE DATE(subscribed_on) >= ? AND DATE(subscribed_on) <= ?
       GROUP BY membership_type
       ORDER BY total DESC`,
      [start, end],
    );

    const [dailyBreakdown] = await pool.query(
      `SELECT sale_date, source, type, qty, total FROM (
         SELECT DATE_FORMAT(DATE(time_in), '%Y-%m-%d') AS sale_date, 'Visit' AS source, client_type AS type, COUNT(*) AS qty, COALESCE(SUM(price), 0) AS total
         FROM clients
         WHERE payment_status = 'Paid' AND DATE(time_in) >= ? AND DATE(time_in) <= ?
         GROUP BY DATE(time_in), client_type
         UNION ALL
         SELECT DATE_FORMAT(DATE(subscribed_on), '%Y-%m-%d') AS sale_date, 'Membership' AS source, membership_type AS type, COUNT(*) AS qty, COALESCE(SUM(price), 0) AS total
         FROM memberships
         WHERE DATE(subscribed_on) >= ? AND DATE(subscribed_on) <= ?
         GROUP BY DATE(subscribed_on), membership_type
       ) sales
       ORDER BY sale_date DESC, source, type`,
      [start, end, start, end],
    );

    const visitTotal = clientSales.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const membershipTotal = membershipSales.reduce((sum, row) => sum + Number(row.total || 0), 0);

    res.json({
      from: start,
      to: end,
      clientSales,
      membershipSales,
      dailyBreakdown,
      visitTotal,
      membershipTotal,
      totalSales: visitTotal + membershipTotal,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load sales report' });
  }
});

module.exports = router;
