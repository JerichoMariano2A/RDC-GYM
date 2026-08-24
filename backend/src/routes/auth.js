const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
require('dotenv').config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

router.post('/login', async (req, res) => {
  const body = req.body || {};
  const username = body.username || body.email || '';
  const password = body.password || '';

  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  try {
    const [rows] = await pool.query('SELECT id, username, password, role FROM users WHERE username = ?', [username]);
    const user = rows && rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '4h' });
    res.json({ token, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

module.exports = router;
