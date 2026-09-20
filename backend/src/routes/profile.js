const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { verifyToken, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../audit');
require('dotenv').config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

const PHOTO_MIME_PATTERN = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    fullName: row.full_name || '',
    hasPhoto: Boolean(row.profile_photo),
  };
}

async function loadUser(userId) {
  const [rows] = await pool.query(
    'SELECT id, username, role, full_name, profile_photo FROM users WHERE id = ?',
    [userId],
  );
  return rows[0] || null;
}

router.get('/', verifyToken, async (req, res) => {
  try {
    const user = await loadUser(req.user.id);
    if (!user) return res.status(404).json({ error: 'Account not found' });
    res.json(publicUser(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

router.put('/name', verifyToken, async (req, res) => {
  const fullName = String((req.body && req.body.fullName) || '').trim();
  if (fullName.length > 120) {
    return res.status(400).json({ error: 'Name is too long. Maximum is 120 characters.' });
  }
  try {
    await pool.query('UPDATE users SET full_name = ? WHERE id = ?', [fullName || null, req.user.id]);
    await writeAudit(
      req,
      'Profile Updated',
      fullName ? `Updated display name to "${fullName}".` : 'Cleared the display name.',
      'users',
      req.user.id,
    );
    const user = await loadUser(req.user.id);
    res.json(publicUser(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update name' });
  }
});

router.get('/photo/:id', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT profile_photo, profile_mime FROM users WHERE id = ?', [req.params.id]);
    if (!rows.length || !rows[0].profile_photo) {
      return res.status(404).json({ error: 'No profile photo' });
    }
    res.set('Content-Type', rows[0].profile_mime || 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(rows[0].profile_photo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load profile photo' });
  }
});

router.post('/photo', verifyToken, async (req, res) => {
  const imageData = req.body && req.body.imageData;
  const fileName = req.body && req.body.fileName;
  const match = typeof imageData === 'string' ? imageData.match(PHOTO_MIME_PATTERN) : null;
  if (!match) {
    return res.status(400).json({ error: 'Attach a valid image file (PNG, JPG, GIF or WEBP)' });
  }
  try {
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'The attached image is empty' });
    if (buffer.length > MAX_PHOTO_BYTES) {
      return res.status(400).json({ error: 'Image is too large. Maximum size is 4MB.' });
    }
    const mime = match[1].toLowerCase() === 'jpg' ? 'image/jpeg' : `image/${match[1]}`;
    await pool.query('UPDATE users SET profile_photo = ?, profile_mime = ? WHERE id = ?', [buffer, mime, req.user.id]);
    await writeAudit(req, 'Profile Photo Updated', `Updated the account photo${fileName ? ` (${fileName})` : ''}.`, 'users', req.user.id);
    const user = await loadUser(req.user.id);
    res.json(publicUser(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save profile photo' });
  }
});

router.delete('/photo', verifyToken, async (req, res) => {
  try {
    const user = await loadUser(req.user.id);
    if (!user || !user.profile_photo) return res.status(404).json({ error: 'There is no photo to remove' });
    await pool.query('UPDATE users SET profile_photo = NULL, profile_mime = NULL WHERE id = ?', [req.user.id]);
    await writeAudit(req, 'Profile Photo Removed', 'Removed the account photo.', 'users', req.user.id);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove profile photo' });
  }
});

router.put('/username', verifyToken, requireRole('admin|staff'), async (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  const currentPassword = String((req.body && req.body.currentPassword) || '');
  if (!username) return res.status(400).json({ error: 'New username is required' });
  if (username.length > 100) return res.status(400).json({ error: 'Username is too long. Maximum is 100 characters.' });
  if (!currentPassword) return res.status(400).json({ error: 'Enter your current password to confirm this change' });
  try {
    const [rows] = await pool.query('SELECT id, username, password FROM users WHERE id = ?', [req.user.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Account not found' });
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
    if (username.toLowerCase() === user.username.toLowerCase()) {
      return res.status(400).json({ error: 'That is already your current username' });
    }
    const [exists] = await pool.query('SELECT id FROM users WHERE username = ? AND id <> ?', [username, req.user.id]);
    if (exists.length) return res.status(409).json({ error: 'That username is already taken' });
    await pool.query('UPDATE users SET username = ? WHERE id = ?', [username, req.user.id]);
    const token = jwt.sign({ id: user.id, username, role: req.user.role }, JWT_SECRET, { expiresIn: '4h' });
    await writeAudit(req, 'Username Changed', `Changed the username from "${user.username}" to "${username}".`, 'users', req.user.id);
    res.json({ token, username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to change username' });
  }
});

router.put('/password', verifyToken, requireRole('admin|staff'), async (req, res) => {
  const body = req.body || {};
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');
  const confirmPassword = String(body.confirmPassword || '');
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new passwords are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New password and confirm password do not match' });
  }
  try {
    const [rows] = await pool.query('SELECT id, password FROM users WHERE id = ?', [req.user.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Account not found' });
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [hash, req.user.id]);
    await writeAudit(req, 'Password Changed', 'Changed the account password.', 'users', req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
