const express = require('express');
const http = require('http');
const pool = require('../db');
const { writeAudit } = require('../audit');
const { writeDisplayEvent } = require('../clientDisplay');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

const ESP_SECRET = process.env.ESP_SECRET || process.env.BIOMETRIC_SECRET || 'rdc_esp_secret';

function ok(res, payload) {
  res.status(200).json({ ok: true, ...payload });
}

// ---------------------------------------------------------------------------
// ESP32 door unit - fingerprint scan.
// Reuses the full biometric-scan flow: check-in/check-out + client_display_events
// so the Client Display and Dashboard update in real time.
// ---------------------------------------------------------------------------

// Make an internal HTTP POST to the biometric-scan handler so we get the
// same check-in/check-out + display event logic without duplicating code.
function callBiometricScan(fpId) {
  const expected = process.env.BIOMETRIC_SECRET || 'rdc_biometric_secret';
  const body = JSON.stringify({ fingerprint_id: fpId, secret: expected });
  const port = process.env.PORT || 4000;
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/data/biometric-scan',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, ...JSON.parse(data) }); }
          catch (_) { resolve({ status: 500, error: 'Bad response' }); }
        });
      },
    );
    req.on('error', () => resolve({ status: 502, error: 'Connection failed' }));
    req.write(body);
    req.end();
  });
}

router.post('/scan', async (req, res) => {
  const { fingerprint_id: fpId, secret } = req.body || {};
  if (secret !== ESP_SECRET) {
    return res.status(403).json({ granted: false, message: 'Invalid ESP key' });
  }
  if (!fpId) {
    return res.status(400).json({ granted: false, action: 'denied', message: 'No fingerprint id' });
  }

  try {
    const bio = await callBiometricScan(Number(fpId));

    if (bio.status >= 400 || bio.error) {
      return res.json({
        granted: false,
        action: bio.action || 'denied',
        message: bio.error || 'Access denied',
        member: null,
      });
    }

    return ok(res, {
      granted: true,
      action: bio.action || 'unlock',
      message: bio.action === 'checkout' ? 'Thank you! See you next time.' : 'Welcome!',
      member: { id: bio.id, name: bio.name, type: bio.type },
    });
  } catch (err) {
    console.error('[esp:scan]', err);
    return res.status(500).json({ granted: false, action: 'error', message: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Denied scan (unrecognized fingerprint).  Called by the ESP32 when a finger
// is pressed but does not match any enrolled template.  Writes a denied
// display event so the Client Display shows "ACCESS DENIED".
// ---------------------------------------------------------------------------
router.post('/scan-denied', async (req, res) => {
  const { secret } = req.body || {};
  if (secret !== ESP_SECRET) {
    return res.status(403).json({ granted: false, message: 'Invalid ESP key' });
  }

  try {
    await writeDisplayEvent(null, 'denied', 'Access Denied — Fingerprint not recognized', null, null, null);
    return ok(res, { granted: false, action: 'denied', message: 'Fingerprint not recognized' });
  } catch (err) {
    console.error('[esp:scan-denied]', err);
    return res.status(500).json({ granted: false, action: 'error', message: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Enrollment: Admin UI queues a member; the ESP32 polls for it and enrolls
// the finger pressed on the single door sensor.
// ---------------------------------------------------------------------------

// Called by the Admin web UI (JWT protected) - queues a member for enrollment.
router.post('/enroll-request', verifyToken, requireRole('admin|staff'), async (req, res) => {
  const { member_id } = req.body || {};
  if (!member_id) return res.status(400).json({ error: 'member_id is required' });
  try {
    const [members] = await pool.query('SELECT id FROM memberships WHERE id = ?', [member_id]);
    if (!members.length) return res.status(404).json({ error: 'Member not found' });

    await pool.query('UPDATE door_enroll_jobs SET status = \'cancelled\' WHERE member_id = ? AND status IN (\'pending\',\'claimed\')', [member_id]);
    const [result] = await pool.query(
      'INSERT INTO door_enroll_jobs (member_id, status) VALUES (?, \'pending\')',
      [member_id],
    );
    await writeAudit(req, 'Door Enrollment Requested', `Queued fingerprint enrollment for member #${member_id}.`, 'memberships', member_id);
    res.status(201).json({ ok: true, jobId: result.insertId, message: 'Enrollment queued. Press the member\'s finger on the door sensor.' });
  } catch (err) {
    console.error('[esp:enroll-request]', err);
    res.status(500).json({ error: 'Failed to queue enrollment' });
  }
});

// Called by the ESP32 (x-esp-secret) - claims the next pending enrollment.
router.get('/enroll-job', async (req, res) => {
  const secret = req.headers['x-esp-secret'];
  if (secret !== ESP_SECRET) return res.status(403).json({ error: 'Invalid ESP key' });

  try {
    const [rows] = await pool.query(
      `SELECT j.id AS jobId, j.member_id AS memberId, m.name
       FROM door_enroll_jobs j
       JOIN memberships m ON m.id = j.member_id
       WHERE j.status = 'pending'
       ORDER BY j.id ASC
       LIMIT 1`,
    );
    if (!rows.length) return ok(res, { job: null });

    await pool.query('UPDATE door_enroll_jobs SET status = \'claimed\' WHERE id = ?', [rows[0].jobId]);
    return ok(res, { job: { memberId: rows[0].memberId, name: rows[0].name } });
  } catch (err) {
    console.error('[esp:enroll-job]', err);
    res.status(500).json({ error: 'Failed to fetch enroll job' });
  }
});

// Called by the ESP32 after enrolling the finger.
router.post('/enroll-result', async (req, res) => {
  const { member_id, success, reason } = req.body || {};
  const secret = req.headers['x-esp-secret'];
  if (secret !== ESP_SECRET) return res.status(403).json({ error: 'Invalid ESP key' });

  try {
    const [members] = await pool.query('SELECT name FROM memberships WHERE id = ?', [member_id]);
    if (!members.length) return res.status(404).json({ error: 'Member not found' });

    if (success) {
      await pool.query('UPDATE memberships SET fingerprint_id = ? WHERE id = ?', [member_id, member_id]);
      await pool.query(`UPDATE door_enroll_jobs SET status = 'done', reason = NULL WHERE member_id = ? AND status = 'claimed'`, [member_id]);
      console.log('[esp] Enrolled member #%d (%s)', member_id, members[0].name);
    } else {
      const r = ['no_match', 'timeout', 'fail', 'error'].includes(reason) ? reason : 'fail';
      await pool.query(`UPDATE door_enroll_jobs SET status = 'failed', reason = ? WHERE member_id = ? AND status = 'claimed'`, [r, member_id]);
      console.warn('[esp] Enrollment failed for member #%d: %s', member_id, r);
    }
    return ok(res, { member_id, success: !!success });
  } catch (err) {
    console.error('[esp:enroll-result]', err);
    res.status(500).json({ error: 'Failed to record enrollment result' });
  }
});

// Called by the ESP32 during enrollment to report live step/quality/message.
router.post('/enroll-status', async (req, res) => {
  const { member_id, step, quality, message } = req.body || {};
  const secret = req.headers['x-esp-secret'];
  if (secret !== ESP_SECRET) return res.status(403).json({ error: 'Invalid ESP key' });
  if (!member_id) return res.status(400).json({ error: 'member_id is required' });

  try {
    await pool.query(
      `UPDATE door_enroll_jobs
       SET step = ?, quality = ?, message = ?
       WHERE member_id = ? AND status = 'claimed'
       ORDER BY id DESC LIMIT 1`,
      [step || null, quality != null ? quality : null, message || null, member_id],
    );
    return ok(res, { member_id, step, quality });
  } catch (err) {
    console.error('[esp:enroll-status]', err);
    res.status(500).json({ error: 'Failed to update enrollment status' });
  }
});

// Lightweight health check.
router.get('/status', async (req, res) => {
  const secret = req.headers['x-esp-secret'];
  if (secret !== ESP_SECRET) return res.status(403).json({ error: 'Invalid ESP key' });
  ok(res, { status: 'online', time: new Date().toISOString() });
});

module.exports = router;
