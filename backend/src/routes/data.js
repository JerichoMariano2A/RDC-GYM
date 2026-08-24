const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/clients/realtime', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, name, client_type AS type, payment_status AS payment, DATE_FORMAT(time_in, '%H:%i') AS time_in,
        IF(time_out IS NULL, '--', DATE_FORMAT(time_out, '%H:%i')) AS time_out
      FROM clients
      ORDER BY id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load clients' });
  }
});

router.post('/clients', verifyToken, async (req, res) => {
  const { name, type, payment } = req.body;
  if (!name || !type || !payment) return res.status(400).json({ error: 'Name, type and payment are required' });
  try {
    const [result] = await pool.query(
      'INSERT INTO clients (name, client_type, payment_status, time_in) VALUES (?, ?, ?, NOW())',
      [name, type, payment]
    );
    const [rows] = await pool.query("SELECT id, name, client_type AS type, payment_status AS payment, DATE_FORMAT(time_in, '%H:%i') AS time_in, IF(time_out IS NULL, '--', DATE_FORMAT(time_out, '%H:%i')) AS time_out FROM clients WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

router.post('/biometric-scan', async (req, res) => {
  const { name, type = 'Walk-in', payment = 'Paid', secret } = req.body || {};
  const expected = process.env.BIOMETRIC_SECRET || 'rdc_biometric_secret';
  if (secret !== expected) {
    return res.status(403).json({ error: 'Invalid biometric key' });
  }
  if (!name) {
    return res.status(400).json({ error: 'Biometric scan must include a name' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO clients (name, client_type, payment_status, time_in) VALUES (?, ?, ?, NOW())',
      [name, type, payment]
    );
    const [rows] = await pool.query("SELECT id, name, client_type AS type, payment_status AS payment, DATE_FORMAT(time_in, '%H:%i') AS time_in, IF(time_out IS NULL, '--', DATE_FORMAT(time_out, '%H:%i')) AS time_out FROM clients WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record biometric scan' });
  }
});

router.get('/memberships', verifyToken, async (req, res) => {
  const { query, type } = req.query;
  let sql = 'SELECT id, name, membership_type AS type, DATE_FORMAT(subscribed_on, "%Y-%m-%d") AS subscribed, DATE_FORMAT(expires_on, "%Y-%m-%d") AS expires FROM memberships';
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
    const [result] = await pool.query(
      'INSERT INTO memberships (name, membership_type, subscribed_on, expires_on) VALUES (?, ?, ?, ?)',
      [name, type, subscribed_on, expires_on],
    );
    const [rows] = await pool.query('SELECT id, name, membership_type AS type, DATE_FORMAT(subscribed_on, "%Y-%m-%d") AS subscribed, DATE_FORMAT(expires_on, "%Y-%m-%d") AS expires FROM memberships WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create membership' });
  }
});

router.put('/memberships/:id', verifyToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { name, type, subscribed_on, expires_on } = req.body;
  if (!name || !type || !subscribed_on || !expires_on) {
    return res.status(400).json({ error: 'Name, type, subscribed date and expiry date are required' });
  }
  try {
    await pool.query(
      'UPDATE memberships SET name = ?, membership_type = ?, subscribed_on = ?, expires_on = ? WHERE id = ?',
      [name, type, subscribed_on, expires_on, id],
    );
    const [rows] = await pool.query('SELECT id, name, membership_type AS type, DATE_FORMAT(subscribed_on, "%Y-%m-%d") AS subscribed, DATE_FORMAT(expires_on, "%Y-%m-%d") AS expires FROM memberships WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update membership' });
  }
});

router.delete('/memberships/:id', verifyToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM memberships WHERE id = ?', [id]);
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
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  try {
    const [exists] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (exists.length) return res.status(409).json({ error: 'Username already exists' });
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hash, 'staff']);
    res.status(201).json({ id: result.insertId, username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create staff account' });
  }
});

router.delete('/staff/:id', verifyToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM users WHERE id = ? AND role = ?', [id, 'staff']);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete staff account' });
  }
});

router.get('/audit-logs', verifyToken, requireRole('admin'), async (req, res) => {
  const { from, to, role } = req.query;
  let sql = `SELECT DATE_FORMAT(a.created_at, "%Y-%m-%d %H:%i") AS timestamp,
      COALESCE(u.username, 'system') AS user,
      COALESCE(u.role, 'staff') AS role,
      COALESCE(a.event_type, a.action) AS event,
      COALESCE(a.description, a.details) AS description
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
    filters.push('u.role = ?');
    params.push(role);
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
    const [[members]] = await pool.query('SELECT COUNT(*) AS total FROM memberships WHERE expires_on >= CURDATE()');
    res.json({ totalCheckIns: checkIns.total, totalCheckOuts: checkOuts.total, activeMembers: members.total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

// Sales report aggregated by date coverage (from/to)
router.get('/reports/sales', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { from, to } = req.query;
    const params = [];
    let where = '';
    if (from) { where += ' AND DATE(time_in) >= ?'; params.push(from); }
    if (to) { where += ' AND DATE(time_in) <= ?'; params.push(to); }

    // Per-session / per-visit sales from clients (paid check-ins)
    const [clientSales] = await pool.query(
      `SELECT client_type, COUNT(*) AS visits, SUM(price) AS total
       FROM clients
       WHERE payment_status = 'Paid'${where}
       GROUP BY client_type`,
      params
    );

    // Membership subscriptions within the date coverage
    const [membershipSales] = await pool.query(
      `SELECT membership_type, COUNT(*) AS count, SUM(price) AS total
       FROM memberships
       WHERE DATE(subscribed_on) >= ? AND DATE(subscribed_on) <= ?
       GROUP BY membership_type`,
      [from || '1970-01-01', to || '9999-12-31']
    );

    const totalSales =
      (clientSales.reduce((s, r) => s + (Number(r.total) || 0), 0)) +
      (membershipSales.reduce((s, r) => s + (Number(r.total) || 0), 0));

    res.json({ clientSales, membershipSales, totalSales });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load sales report' });
  }
});

module.exports = router;
