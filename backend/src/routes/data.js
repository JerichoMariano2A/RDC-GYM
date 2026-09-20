const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { verifyToken, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../audit');
const { writeDisplayEvent } = require('../clientDisplay');
const { isMemberType, visitPrice, round2, MEMBERSHIP_JOIN_FEE, computeQuote, applyPaymentPlan } = require('../pricing');
const fingerprint = require('../fingerprint');

const router = express.Router();

const CLIENT_SELECT = `
  SELECT id, name, client_type AS type, payment_status AS payment, price,
    membership_fee AS joinFee,
    type_price AS typePrice,
    coaching_type AS coaching,
    coaching_price AS coachingPrice,
    coaching_units AS coachingUnits,
    is_student AS isStudent,
    total_amount AS totalAmount,
    amount_paid AS amountPaid,
    balance, payment_plan AS paymentPlan,
    payment_method AS paymentMethod,
    created_by AS createdBy,
    coaching_sessions_used AS coachingSessionsUsed,
    coaching_session_threshold AS coachingSessionThreshold,
    DATE_FORMAT(time_in, '%h:%i:%s %p') AS time_in,
    IF(time_out IS NULL, NULL, DATE_FORMAT(time_out, '%h:%i:%s %p')) AS time_out,
    time_in AS time_in_at,
    time_out AS time_out_at,
    TIMESTAMPDIFF(SECOND, time_in, COALESCE(time_out, NOW())) AS duration_seconds
  FROM clients
`;

const MEMBERSHIP_SELECT = `
  SELECT id, name, membership_type AS type,
    DATE_FORMAT(subscribed_on, '%Y-%m-%d') AS subscribed,
    DATE_FORMAT(expires_on, '%Y-%m-%d') AS expires,
    price, status, fingerprint_id,
    membership_fee AS joinFee,
    type_price AS typePrice,
    coaching_type AS coaching,
    coaching_price AS coachingPrice,
    coaching_units AS coachingUnits,
    is_student AS isStudent,
    total_amount AS totalAmount,
    amount_paid AS amountPaid,
    balance, payment_plan AS paymentPlan,
    payment_method AS paymentMethod,
    coaching_sessions_used AS coachingSessionsUsed,
    coaching_session_threshold AS coachingSessionThreshold,
    type_quantity AS typeQuantity,
    created_by AS createdBy
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
    // Daily reset: any visit still open from a PREVIOUS day is force-closed at
    // the end of its own gym day (22:00). Runs on every read regardless of the
    // current time, so the dashboard always starts the day at zero and never
    // shows yesterday's operations still "inside".
    await pool.query(
      "UPDATE clients SET time_out = TIMESTAMP(DATE(time_in), '22:00:00') WHERE time_out IS NULL AND DATE(time_in) < CURDATE()",
    );

    const [rows] = await pool.query(
      `${CLIENT_SELECT} WHERE DATE(time_in) = CURDATE()
        OR (time_out IS NOT NULL AND DATE(time_out) = CURDATE())
        ORDER BY id DESC`,
    );
    res.json(rows.map(withDuration));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load clients' });
  }
});

router.post('/clients', verifyToken, async (req, res) => {
  const { name, type, payment, coaching = 'none', isStudent = false, sessions = 1, paymentPlan = 'full', typePrice, coachingRate, paymentMethod, sessionThreshold } = req.body;
  if (!name || !type || !payment) return res.status(400).json({ error: 'Name, type and payment are required' });
  try {
    const quote = computeQuote({ type, coaching, isStudent, sessions, joinFee: 0, typePrice, coachingRate });
    const planResult = applyPaymentPlan(quote, paymentPlan);
    const price = payment === 'Paid' ? planResult.amountDueNow : 0;
    const balance = round2(quote.total - price);
    const threshold = sessionThreshold != null ? Math.max(1, Number(sessionThreshold)) : 15;
    const [result] = await pool.query(
      `INSERT INTO clients
        (name, client_type, payment_status, price, time_in,
         membership_fee, type_price, coaching_type, coaching_price, coaching_units, is_student,
         total_amount, amount_paid, balance, payment_plan, payment_method, coaching_session_threshold, created_by)
       VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, type, payment, price,
        quote.membershipFee, quote.membershipTypePrice, quote.coachingType, quote.coachingTotal, quote.coachingUnits, isStudent ? 1 : 0,
        quote.total, price, balance, planResult.plan, paymentMethod || 'Cash', threshold, req.user?.id || null,
      ],
    );
    const [rows] = await pool.query(`${CLIENT_SELECT} WHERE id = ?`, [result.insertId]);
    await writeAudit(
      req,
      'Walk-in Check-in',
      `Registered ${type} visit for ${name}. Coaching: ${quote.coachingType}. Total: ${quote.total}. Paid: ${price}. Balance: ${planResult.balance}.`,
      'clients',
      result.insertId,
    );
    res.status(201).json(withDuration(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

router.patch('/clients/:id/payment', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { paymentMethod } = req.body || {};
  try {
    const [existing] = await pool.query(`${CLIENT_SELECT} WHERE id = ?`, [id]);
    if (!existing.length) return res.status(404).json({ error: 'Visit not found' });
    const visit = existing[0];
    if (visit.payment === 'Paid' && Number(visit.balance) <= 0) {
      return res.status(400).json({ error: 'This visit is already marked as Paid' });
    }
    let due = round2(Number(visit.totalAmount || 0) - Number(visit.amountPaid || 0));
    if (due <= 0) due = round2(Number(visit.balance) > 0 ? Number(visit.balance) : visitPrice(visit.type));
    if (paymentMethod) {
      await pool.query(
        'UPDATE clients SET payment_status = ?, price = ?, amount_paid = ?, balance = 0, payment_method = ? WHERE id = ?',
        ['Paid', due, due, paymentMethod, id],
      );
    } else {
      await pool.query(
        'UPDATE clients SET payment_status = ?, price = ?, amount_paid = ?, balance = 0 WHERE id = ?',
        ['Paid', due, due, id],
      );
    }
    const [rows] = await pool.query(`${CLIENT_SELECT} WHERE id = ?`, [id]);
    await writeAudit(
      req,
      'Walk-in Payment Collected',
      `Collected ${due} from ${visit.name}. Visit marked as Paid.`,
      'clients',
      id,
    );
    res.json(withDuration(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record payment' });
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

router.patch('/clients/:id/sessions', verifyToken, requireRole('staff|admin'), async (req, res) => {
  const { id } = req.params;
  const { action } = req.body || {};
  try {
    const [existing] = await pool.query(`${CLIENT_SELECT} WHERE id = ?`, [id]);
    if (!existing.length) return res.status(404).json({ error: 'Client not found' });
    const client = existing[0];
    if (action === 'undo') {
      const prev = Math.max(0, (client.coachingSessionsUsed || 0) - 1);
      await pool.query('UPDATE clients SET coaching_sessions_used = ? WHERE id = ?', [prev, id]);
      const [rows] = await pool.query(`${CLIENT_SELECT} WHERE id = ?`, [id]);
      await writeAudit(req, 'Coaching Session Undone', `Reverted session to ${prev}/${client.coachingSessionThreshold} for ${client.name}.`, 'clients', id);
      return res.json(rows[0]);
    }
    const next = (client.coachingSessionsUsed || 0) + 1;
    await pool.query('UPDATE clients SET coaching_sessions_used = ? WHERE id = ?', [next, id]);
    const [rows] = await pool.query(`${CLIENT_SELECT} WHERE id = ?`, [id]);
    await writeAudit(req, 'Coaching Session Logged', `Logged session ${next}/${client.coachingSessionThreshold} for ${client.name}.`, 'clients', id);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to log session' });
  }
});

router.patch('/clients/:id/collect-balance', verifyToken, requireRole('staff|admin'), async (req, res) => {
  const { id } = req.params;
  const { paymentMethod } = req.body || {};
  try {
    const [existing] = await pool.query(`${CLIENT_SELECT} WHERE id = ?`, [id]);
    if (!existing.length) return res.status(404).json({ error: 'Client not found' });
    const client = existing[0];
    const due = Number(client.balance) > 0 ? Number(client.balance) : 0;
    if (due <= 0) return res.status(400).json({ error: 'No balance to collect' });
    await pool.query(
      'UPDATE clients SET amount_paid = total_amount, balance = 0, payment_status = ?, payment_method = COALESCE(?, payment_method) WHERE id = ?',
      ['Paid', paymentMethod || null, id],
    );
    const [rows] = await pool.query(`${CLIENT_SELECT} WHERE id = ?`, [id]);
    await writeAudit(req, 'Client Balance Collected', `Collected ${due} balance from ${client.name}.`, 'clients', id);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to collect balance' });
  }
});

router.post('/biometric-scan', async (req, res) => {
  const { name, fingerprint_id: fpId, type = 'Member', payment = 'Paid', secret } = req.body || {};
  const expected = process.env.BIOMETRIC_SECRET || 'rdc_biometric_secret';
  if (secret !== expected) {
    return res.status(403).json({ error: 'Invalid biometric key' });
  }

  let memberName = name;
  let clientType = type;
  let memberByFingerprint = null;

  try {
    if (fpId && !memberName) {
      const [fpMembers] = await pool.query(
        `${MEMBERSHIP_SELECT} WHERE fingerprint_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
        [fpId],
      );
      if (fpMembers.length) {
        memberByFingerprint = fpMembers[0];
        memberName = fpMembers[0].name;
        clientType = fpMembers[0].type;
      } else {
        await writeDisplayEvent(null, 'denied', 'Access Denied — Fingerprint not registered', null, null, null);
        return res.status(404).json({ error: 'Fingerprint not registered', action: 'denied' });
      }
    }

    if (!memberName) {
      return res.status(400).json({ error: 'Biometric scan must include a name or fingerprint_id' });
    }

    // When the finger was matched, prefer that exact membership record so the
    // member info shown on the door display always comes from the scanned
    // member - even if another row shares the same name.
    const member = memberByFingerprint || (await pool.query(
      `${MEMBERSHIP_SELECT} WHERE name = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
      [memberName],
    ))[0];

    if (!member && !fpId) {
      await writeDisplayEvent(memberName, 'denied', 'Access Denied — Not an active member', null, null, null);
      return res.status(404).json({ error: 'Member not found or inactive', action: 'denied' });
    }

    if (member && member.expires) {
      const expires = new Date(member.expires);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      if (expires < now) {
        await writeDisplayEvent(memberName, 'expired', 'Access Denied — Membership expired', member.type, 'expired', null);
        return res.status(403).json({ error: 'Membership expired', action: 'denied' });
      }
    }

    if (!clientType || clientType === 'Member') clientType = member ? member.type : type;

    const [openVisits] = await pool.query(
      `${CLIENT_SELECT} WHERE name = ? AND time_out IS NULL ORDER BY id DESC LIMIT 1`,
      [memberName],
    );

    if (openVisits.length && isMemberType(openVisits[0].type || clientType)) {
      // If the open visit is from a PREVIOUS day (missed the 10 PM reset or
      // visit was never closed), auto-close it at its own gym close-of-day
      // and treat this scan as a FRESH CHECK-IN (not a stale check-out).
      const [[{ staleVisit }]] = await pool.query(
        'SELECT CASE WHEN DATE(time_in) < CURDATE() THEN 1 ELSE 0 END AS staleVisit FROM clients WHERE id = ?',
        [openVisits[0].id],
      );

      if (staleVisit) {
        await pool.query(
          "UPDATE clients SET time_out = TIMESTAMP(DATE(time_in), '22:00:00') WHERE id = ? AND time_out IS NULL",
          [openVisits[0].id],
        );
        console.log('[biometric] Auto-closed stale visit %d for %s (previous day)', openVisits[0].id, memberName);
        // Fall through below to INSERT a fresh check-in for today
      } else {
        // Normal same-day checkout
        await pool.query('UPDATE clients SET time_out = NOW() WHERE id = ? AND time_out IS NULL', [openVisits[0].id]);
        const [rows] = await pool.query(`${CLIENT_SELECT} WHERE id = ?`, [openVisits[0].id]);
        const updated = withDuration(rows[0]);
        await writeAudit(
          { user: { username: 'biometric', role: 'staff' }, ip: req.ip, headers: req.headers },
          'Member Check-out',
          `Fingerprint timed out ${memberName}. Time spent: ${updated.duration}.`,
          'clients',
          updated.id,
        );
        await writeDisplayEvent(memberName, 'checkout', 'Thank you! See you next time.', clientType, member?.status, updated.duration, membershipStatusPayload(member));
        return res.status(200).json({ ...updated, action: 'checkout', payload: membershipStatusPayload(member) });
      }
    }

    const price = payment === 'Paid' ? visitPrice(clientType) : 0;
    const [result] = await pool.query(
      'INSERT INTO clients (name, client_type, payment_status, price, time_in) VALUES (?, ?, ?, ?, NOW())',
      [memberName, clientType, payment, price],
    );
    const [rows] = await pool.query(`${CLIENT_SELECT} WHERE id = ?`, [result.insertId]);
    await writeAudit(
      { user: { username: 'biometric', role: 'staff' }, ip: req.ip, headers: req.headers },
      'Member Check-in',
      `Fingerprint timed in ${memberName}.`,
      'clients',
      result.insertId,
    );
    await writeDisplayEvent(memberName, 'checkin', 'Thank you for choosing RDC Gym!', clientType, member?.status, null, membershipStatusPayload(member));
    res.status(201).json({ ...withDuration(rows[0]), action: 'checkin', payload: membershipStatusPayload(member) });
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
  const { name, type, subscribed_on, expires_on, coaching = 'none', isStudent = false, sessions = 1, paymentPlan = 'full', membershipFee, typePrice, coachingRate, paymentMethod, sessionThreshold, typeQuantity } = req.body;
  if (!name || !type || !subscribed_on || !expires_on) {
    return res.status(400).json({ error: 'Name, type, subscribed date and expiry date are required' });
  }
  try {
    const joinFee = membershipFee != null ? Number(membershipFee) : MEMBERSHIP_JOIN_FEE;
    const quote = computeQuote({ type, subscribedOn: subscribed_on, expiresOn: expires_on, coaching, isStudent, sessions, joinFee, typePrice, coachingRate, typeQuantity });
    const planResult = applyPaymentPlan(quote, paymentPlan);
    const price = quote.total;
    const threshold = sessionThreshold != null ? Math.max(1, Number(sessionThreshold)) : 15;
    const tq = Math.max(1, Number(typeQuantity) || 1);
    const [result] = await pool.query(
      `INSERT INTO memberships
        (name, membership_type, subscribed_on, expires_on, price, status,
         membership_fee, type_price, coaching_type, coaching_price, coaching_units, is_student,
         total_amount, amount_paid, balance, payment_plan, payment_method, coaching_session_threshold, type_quantity, created_by)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, type, subscribed_on, expires_on, price,
        quote.membershipFee, quote.membershipTypePrice, quote.coachingType, quote.coachingTotal, quote.coachingUnits, isStudent ? 1 : 0,
        quote.total, planResult.amountDueNow, planResult.balance, planResult.plan, paymentMethod || 'Cash', threshold, tq, req.user?.id || null,
      ],
    );
    const [rows] = await pool.query(`${MEMBERSHIP_SELECT} WHERE id = ?`, [result.insertId]);
    await writeAudit(
      req,
      'Membership Created',
      `Added member ${name} (${type}). Coaching: ${quote.coachingType}. Total: ${quote.total}. Paid: ${planResult.amountDueNow}. Balance: ${planResult.balance}.`,
      'memberships',
      result.insertId,
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create membership' });
  }
});

router.put('/memberships/:id', verifyToken, requireRole('staff|admin'), async (req, res) => {
  const { id } = req.params;
  const { name, type, subscribed_on, expires_on, status, coaching = 'none', isStudent = false, sessions = 1, paymentPlan = 'full', membershipFee, typePrice, coachingRate, sessionThreshold, typeQuantity } = req.body;
  if (!name || !type || !subscribed_on || !expires_on) {
    return res.status(400).json({ error: 'Name, type, subscribed date and expiry date are required' });
  }
  try {
    const joinFee = membershipFee != null ? Number(membershipFee) : MEMBERSHIP_JOIN_FEE;
    const quote = computeQuote({ type, subscribedOn: subscribed_on, expiresOn: expires_on, coaching, isStudent, sessions, joinFee, typePrice, coachingRate, typeQuantity });
    const planResult = applyPaymentPlan(quote, paymentPlan);
    const price = quote.total;
    const nextStatus = status === 'inactive' ? 'inactive' : 'active';
    const threshold = sessionThreshold != null ? Math.max(1, Number(sessionThreshold)) : 15;
    const tq = Math.max(1, Number(typeQuantity) || 1);
    const [existingRows] = await pool.query(`${MEMBERSHIP_SELECT} WHERE id = ?`, [id]);
    const currentUsed = existingRows.length ? Number(existingRows[0].coachingSessionsUsed) || 0 : 0;
    const isNewCoachingCycle = quote.coachingType !== 'none' && planResult.plan === 'installment';
    const nextUsed = isNewCoachingCycle ? 0 : currentUsed;
    await pool.query(
      `UPDATE memberships SET
        name = ?, membership_type = ?, subscribed_on = ?, expires_on = ?, price = ?, status = ?,
        membership_fee = ?, type_price = ?, coaching_type = ?, coaching_price = ?, coaching_units = ?, is_student = ?,
        total_amount = ?, amount_paid = ?, balance = ?, payment_plan = ?, coaching_session_threshold = ?, type_quantity = ?,
        coaching_sessions_used = ?
       WHERE id = ?`,
      [
        name, type, subscribed_on, expires_on, price, nextStatus,
        quote.membershipFee, quote.membershipTypePrice, quote.coachingType, quote.coachingTotal, quote.coachingUnits, isStudent ? 1 : 0,
        quote.total, planResult.amountDueNow, planResult.balance, planResult.plan, threshold, tq,
        nextUsed,
        id,
      ],
    );
    const [rows] = await pool.query(`${MEMBERSHIP_SELECT} WHERE id = ?`, [id]);
    await writeAudit(req, 'Membership Updated', `Updated member ${name}. Total: ${quote.total}. Balance: ${planResult.balance}.`, 'memberships', id);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update membership' });
  }
});

router.patch('/memberships/:id/sessions', verifyToken, requireRole('staff|admin'), async (req, res) => {
  const { id } = req.params;
  const { action } = req.body || {};
  try {
    const [existing] = await pool.query(`${MEMBERSHIP_SELECT} WHERE id = ?`, [id]);
    if (!existing.length) return res.status(404).json({ error: 'Member not found' });
    const member = existing[0];
    if (member.coaching !== 'monthly') return res.status(400).json({ error: 'Session tracking is only for monthly coaching members' });
    if (action === 'undo') {
      const prev = Math.max(0, (member.coachingSessionsUsed || 0) - 1);
      await pool.query('UPDATE memberships SET coaching_sessions_used = ? WHERE id = ?', [prev, id]);
      const [rows] = await pool.query(`${MEMBERSHIP_SELECT} WHERE id = ?`, [id]);
      await writeAudit(req, 'Coaching Session Undone', `Reverted session to ${prev}/${member.coachingSessionThreshold} for ${member.name}.`, 'memberships', id);
      return res.json(rows[0]);
    }
    const next = (member.coachingSessionsUsed || 0) + 1;
    await pool.query('UPDATE memberships SET coaching_sessions_used = ? WHERE id = ?', [next, id]);
    const [rows] = await pool.query(`${MEMBERSHIP_SELECT} WHERE id = ?`, [id]);
    await writeAudit(req, 'Coaching Session Logged', `Logged session ${next}/${member.coachingSessionThreshold} for ${member.name}.`, 'memberships', id);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to log session' });
  }
});

router.patch('/memberships/:id/collect-balance', verifyToken, requireRole('staff|admin'), async (req, res) => {
  const { id } = req.params;
  const { paymentMethod } = req.body || {};
  try {
    const [existing] = await pool.query(`${MEMBERSHIP_SELECT} WHERE id = ?`, [id]);
    if (!existing.length) return res.status(404).json({ error: 'Member not found' });
    const member = existing[0];
    const due = Number(member.balance) > 0 ? Number(member.balance) : 0;
    if (due <= 0) return res.status(400).json({ error: 'No balance to collect' });
    const newAmountPaid = round2(Number(member.amountPaid) + due);
    await pool.query(
      'UPDATE memberships SET amount_paid = ?, balance = 0, payment_method = COALESCE(?, payment_method) WHERE id = ?',
      [newAmountPaid, paymentMethod || null, id],
    );
    const [rows] = await pool.query(`${MEMBERSHIP_SELECT} WHERE id = ?`, [id]);
    await writeAudit(req, 'Membership Balance Collected', `Collected ${due} balance from ${member.name}.`, 'memberships', id);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to collect balance' });
  }
});

router.patch('/memberships/:id/status', verifyToken, requireRole('staff|admin'), async (req, res) => {
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

router.delete('/memberships/:id', verifyToken, requireRole('staff|admin'), async (req, res) => {
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

router.get('/promo/meta', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, mime_type AS mime, file_name AS fileName, uploaded_by AS uploadedBy,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS updatedAt
       FROM promo_banners ORDER BY id DESC LIMIT 1`,
    );
    if (!rows.length) return res.json({ hasImage: false });
    res.json({ hasImage: true, ...rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load promo info' });
  }
});

router.get('/promo/image', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT image, mime_type FROM promo_banners ORDER BY id DESC LIMIT 1');
    if (!rows.length) return res.status(404).json({ error: 'No promo image posted' });
    res.set('Content-Type', rows[0].mime_type);
    res.set('Cache-Control', 'no-store');
    res.send(rows[0].image);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load promo image' });
  }
});

const PROMO_MIME_PATTERN = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/;

router.post('/promo', verifyToken, requireRole('admin'), async (req, res) => {
  const { imageData, fileName } = req.body || {};
  const match = typeof imageData === 'string' ? imageData.match(PROMO_MIME_PATTERN) : null;
  if (!match) {
    return res.status(400).json({ error: 'Attach a valid image file (PNG, JPG, GIF or WEBP)' });
  }
  try {
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'The attached image is empty' });
    if (buffer.length > 6 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image is too large. Maximum size is 6MB.' });
    }
    const mime = match[1].toLowerCase() === 'jpg' ? 'image/jpeg' : `image/${match[1]}`;
    await pool.query('DELETE FROM promo_banners');
    const [result] = await pool.query(
      'INSERT INTO promo_banners (image, mime_type, file_name, uploaded_by) VALUES (?, ?, ?, ?)',
      [buffer, mime, fileName || null, req.user?.username || 'admin'],
    );
    await writeAudit(req, 'Announcement Updated', `Posted a new What's New announcement (${fileName || mime}).`, 'promo_banners', result.insertId);
    res.status(201).json({ id: result.insertId, fileName: fileName || null, mime });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save promo image' });
  }
});

router.delete('/promo', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT id FROM promo_banners LIMIT 1');
    if (!existing.length) return res.status(404).json({ error: 'There is no promo banner to remove' });
    await pool.query('DELETE FROM promo_banners');
    await writeAudit(req, 'Announcement Removed', 'Removed the What\'s New announcement from the sidebar.', 'promo_banners', null);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove promo image' });
  }
});

router.get('/staff', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, username AS name, CONCAT(\'STF-\', LPAD(id, 3, \'0\')) AS staffId, DATE_FORMAT(created_at, \'%Y-%m-%d\') AS dateAdded FROM users WHERE role = ?', ['staff']);
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

router.put('/staff/:id', verifyToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const confirmPassword = String(body.confirmPassword || '');
  if (!username && !password) {
    return res.status(400).json({ error: 'Nothing to update - enter a new username and/or password' });
  }
  if (username && username.length > 100) {
    return res.status(400).json({ error: 'Username is too long. Maximum is 100 characters.' });
  }
  if (password) {
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }
    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({ error: 'Password and confirm password do not match' });
    }
  }
  try {
    const [existing] = await pool.query('SELECT id, username FROM users WHERE id = ? AND role = ?', [id, 'staff']);
    if (!existing.length) return res.status(404).json({ error: 'Staff account not found' });
    const current = existing[0];
    if (username && username.toLowerCase() !== current.username.toLowerCase()) {
      const [exists] = await pool.query('SELECT id FROM users WHERE username = ? AND id <> ?', [username, id]);
      if (exists.length) return res.status(409).json({ error: 'Username already exists' });
    }
    const finalUsername = username || current.username;
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET username = ?, password = ? WHERE id = ?', [finalUsername, hash, id]);
    } else {
      await pool.query('UPDATE users SET username = ? WHERE id = ?', [finalUsername, id]);
    }
    const changes = [];
    if (finalUsername !== current.username) changes.push(`username "${current.username}" changed to "${finalUsername}"`);
    if (password) changes.push('password reset');
    await writeAudit(req, 'Staff Updated', `Updated staff account ${current.username}: ${changes.join(', ')}.`, 'users', id);
    res.json({ ok: true, id: Number(id), username: finalUsername });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update staff account' });
  }
});

router.get('/audit-logs', verifyToken, requireRole('admin'), async (req, res) => {
  const { from, to, role, query } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  let where = '';
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
  if (filters.length) where = ` WHERE ${filters.join(' AND ')}`;
  try {
    const countSql = `SELECT COUNT(*) AS total FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id${where}`;
    const [[{ total }]] = await pool.query(countSql, params);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const dataSql = `SELECT a.id,
        DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s') AS timestamp,
        DATE_FORMAT(a.created_at, '%Y-%m-%d') AS log_date,
        COALESCE(u.username, a.user, 'system') AS user,
        COALESCE(u.role, a.role, 'staff') AS role,
        COALESCE(a.event_type, a.action) AS event,
        COALESCE(a.description, a.details) AS description,
        a.ip_address AS ip
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id${where}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?`;
    const [rows] = await pool.query(dataSql, [...params, limit, offset]);
    res.json({ logs: rows, total, page, totalPages, limit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load audit logs' });
  }
});

router.get('/reports', verifyToken, requireRole('staff|admin'), async (req, res) => {
  try {
    const [[checkIns]] = await pool.query(
      "SELECT COUNT(*) AS total FROM clients WHERE DATE(time_in) = CURDATE()"
    );
    const [[checkOuts]] = await pool.query(
      "SELECT COUNT(*) AS total FROM clients WHERE DATE(time_out) = CURDATE()"
    );
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

router.get('/reports/dashboard', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { from, to, paymentMethod, membershipType, staffId, paymentStatus } = req.query;
    const start = from || '1970-01-01';
    const end = to || '9999-12-31';

    const clientFilters = ['payment_status = ?'];
    const clientParams = [paymentStatus || 'Paid'];
    const memFilters = [];
    const memParams = [];
    const clientDateFilters = ['DATE(time_in) >= ?', 'DATE(time_in) <= ?'];
    const clientDateParams = [start, end];
    const memDateFilters = ['DATE(subscribed_on) >= ?', 'DATE(subscribed_on) <= ?'];
    const memDateParams = [start, end];

    if (paymentMethod && paymentMethod !== 'All') {
      clientFilters.push('COALESCE(payment_method, ?) = ?');
      clientParams.push('Cash', paymentMethod);
      memFilters.push('COALESCE(payment_method, ?) = ?');
      memParams.push('Cash', paymentMethod);
    }
    if (membershipType && membershipType !== 'All') {
      clientFilters.push('client_type = ?');
      clientParams.push(membershipType);
      memFilters.push('membership_type = ?');
      memParams.push(membershipType);
    }

    const cfl = [...clientFilters, ...clientDateFilters].join(' AND ');
    const mfl = [...memFilters, ...memDateFilters].join(' AND ');
    const cfp = [...clientParams, ...clientDateParams];
    const mfp = [...memParams, ...memDateParams];

    const todayOnly = ['DATE(time_in) = CURDATE()'];
    const todayParams = [];
    if (paymentMethod && paymentMethod !== 'All') { todayOnly.push('COALESCE(payment_method, ?) = ?'); todayParams.push('Cash', paymentMethod); }
    if (membershipType && membershipType !== 'All') { todayOnly.push('client_type = ?'); todayParams.push(membershipType); }
    const todayMemOnly = ['DATE(subscribed_on) = CURDATE()'];
    const todayMemParams = [];
    if (paymentMethod && paymentMethod !== 'All') { todayMemOnly.push('COALESCE(payment_method, ?) = ?'); todayMemParams.push('Cash', paymentMethod); }
    if (membershipType && membershipType !== 'All') { todayMemOnly.push('membership_type = ?'); todayMemParams.push(membershipType); }

    const todayTxnWhere = [`DATE(time_in) = CURDATE()`];
    const todayTxnP = [];
    if (membershipType && membershipType !== 'All') { todayTxnWhere.push('client_type = ?'); todayTxnP.push(membershipType); }
    const memTxnWhere = [`DATE(subscribed_on) = CURDATE()`];
    const memTxnP = [];
    if (membershipType && membershipType !== 'All') { memTxnWhere.push('membership_type = ?'); memTxnP.push(membershipType); }

    const txnClientWhere = ['payment_status = ?'];
    const txnClientParams = ['Paid'];
    const txnMemWhere = [];
    const txnMemParams = [];
    if (paymentMethod && paymentMethod !== 'All') {
      txnClientWhere.push('COALESCE(payment_method, ?) = ?'); txnClientParams.push('Cash', paymentMethod);
      txnMemWhere.push('COALESCE(payment_method, ?) = ?'); txnMemParams.push('Cash', paymentMethod);
    }
    if (membershipType && membershipType !== 'All') {
      txnClientWhere.push('client_type = ?'); txnClientParams.push(membershipType);
      txnMemWhere.push('membership_type = ?'); txnMemParams.push(membershipType);
    }
    const txncDateFilters = clientDateFilters.join(' AND ');
    const txnmDateFilters = memDateFilters.join(' AND ');
    const txnMemDateWhere = txnMemWhere.length > 0 ? [...txnMemWhere, ...memDateFilters] : memDateFilters;
    const txnMemDateParams = [...txnMemParams, ...memDateParams];

    const joinConds = ['a.created_at >= ?', 'a.created_at <= DATE_ADD(?, INTERVAL 1 DAY)'];
    const joinParams = [start, end];
    const whereConds = ['u.role = ?'];
    const whereParams = ['staff'];
    if (staffId && staffId !== 'All') { whereConds.push('u.id = ?'); whereParams.push(staffId); }

    // Fire every query at once - all blocks are independent of each other, so
    // waiting on them one-by-one only multiplied the per-query round-trip time.
    const [
      [todayClientRev],
      [todayMemRev],
      [todayClientRevF],
      [todayMemRevF],
      [todayTxn],
      [totalTxn],
      [{ activeMembers }],
      [{ todayCheckIns }],
      [{ todayCheckOuts }],
      [{ currentlyInside }],
      [revenueByPeriod],
      [salesAvg],
      [paymentMethods],
      [membershipSales],
      [attCheckIns],
      [attCheckOuts],
      [attInside],
      [attTotal],
      [dailyVisits],
      [peakHours],
      [msActive],
      [msExpiring],
      [msExpired],
      [staffActivity],
      [recentTransactions],
      [recentMemTxns],
    ] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(price), 0) AS total FROM clients WHERE ${cfl}`, cfp),
      pool.query(`SELECT COALESCE(SUM(price), 0) AS total FROM memberships WHERE ${mfl}`, mfp),
      pool.query(`SELECT COALESCE(SUM(price), 0) AS total FROM clients WHERE payment_status = 'Paid' AND ${todayOnly.join(' AND ')}`, todayParams),
      pool.query(`SELECT COALESCE(SUM(price), 0) AS total FROM memberships WHERE ${todayMemOnly.join(' AND ')}`, todayMemParams),
      pool.query(
        `SELECT (SELECT COUNT(*) FROM clients WHERE ${todayTxnWhere.join(' AND ')})
         + (SELECT COUNT(*) FROM memberships WHERE ${memTxnWhere.join(' AND ')}) AS total`,
        [...todayTxnP, ...memTxnP]
      ),
      pool.query(
        `SELECT (SELECT COUNT(*) FROM clients WHERE payment_status = 'Paid' AND ${clientDateFilters.join(' AND ')})
         + (SELECT COUNT(*) FROM memberships WHERE ${memDateFilters.join(' AND ')}) AS total`,
        [...clientDateParams, ...memDateParams]
      ),
      pool.query("SELECT COUNT(*) AS activeMembers FROM memberships WHERE status = 'active'"),
      pool.query("SELECT COUNT(*) AS todayCheckIns FROM clients WHERE DATE(time_in) = CURDATE()"),
      pool.query("SELECT COUNT(*) AS todayCheckOuts FROM clients WHERE DATE(time_out) IS NOT NULL AND DATE(time_out) = CURDATE()"),
      pool.query("SELECT COUNT(*) AS currentlyInside FROM clients WHERE time_out IS NULL AND DATE(time_in) = CURDATE()"),
      pool.query(
        `SELECT sale_date AS period,
          SUM(total) AS total,
          SUM(CASE WHEN source = 'Membership' THEN total ELSE 0 END) AS membership,
          SUM(CASE WHEN source = 'Visit' THEN total ELSE 0 END) AS visit
        FROM (
          SELECT DATE_FORMAT(DATE(time_in), '%Y-%m-%d') AS sale_date, 'Visit' AS source, COALESCE(SUM(price), 0) AS total
          FROM clients WHERE ${cfl}
          GROUP BY DATE(time_in)
          UNION ALL
          SELECT DATE_FORMAT(DATE(subscribed_on), '%Y-%m-%d') AS sale_date, 'Membership' AS source, COALESCE(SUM(price), 0) AS total
          FROM memberships WHERE ${mfl}
          GROUP BY DATE(subscribed_on)
        ) combined
        GROUP BY sale_date ORDER BY sale_date`,
        [...cfp, ...mfp]
      ),
      pool.query(
        `SELECT
          COUNT(*) AS transactions,
          COALESCE(SUM(total), 0) AS totalSales,
          COALESCE(MAX(total), 0) AS highest,
          COALESCE(MIN(total), 0) AS lowest
        FROM (
          SELECT price AS total FROM clients WHERE ${cfl}
          UNION ALL
          SELECT price FROM memberships WHERE ${mfl}
        ) t`,
        [...cfp, ...mfp]
      ),
      pool.query(
        `SELECT COALESCE(payment_method, 'Cash') AS method, SUM(total) AS total FROM (
          SELECT COALESCE(payment_method, 'Cash') AS payment_method, price AS total
          FROM clients WHERE ${cfl}
          UNION ALL
          SELECT COALESCE(payment_method, 'Cash') AS payment_method, price AS total
          FROM memberships WHERE ${mfl}
        ) t GROUP BY method ORDER BY total DESC`,
        [...cfp, ...mfp]
      ),
      pool.query(
        `SELECT membership_type AS type, COUNT(*) AS count, COALESCE(SUM(price), 0) AS revenue
         FROM memberships WHERE ${mfl}
         GROUP BY membership_type ORDER BY revenue DESC`,
        mfp
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM clients WHERE ${clientDateFilters.join(' AND ')}`,
        clientDateParams
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM clients WHERE time_out IS NOT NULL AND DATE(time_out) >= ? AND DATE(time_out) <= ?`,
        [start, end]
      ),
      pool.query("SELECT COUNT(*) AS total FROM clients WHERE time_out IS NULL AND DATE(time_in) = CURDATE()"),
      pool.query(
        `SELECT COUNT(*) AS total FROM clients WHERE ${clientDateFilters.join(' AND ')}`,
        clientDateParams
      ),
      pool.query(
        `SELECT DAYNAME(time_in) AS day_name, DAYOFWEEK(time_in) AS day_num, COUNT(*) AS visits
         FROM clients WHERE ${clientDateFilters.join(' AND ')}
         GROUP BY day_name, day_num ORDER BY day_num`,
        clientDateParams
      ),
      pool.query(
        `SELECT HOUR(time_in) AS hour, COUNT(*) AS visits
         FROM clients WHERE ${clientDateFilters.join(' AND ')}
         GROUP BY HOUR(time_in) ORDER BY hour`,
        clientDateParams
      ),
      pool.query("SELECT COUNT(*) AS t FROM memberships WHERE status = 'active'"),
      pool.query("SELECT COUNT(*) AS t FROM memberships WHERE status = 'active' AND expires_on >= CURDATE() AND expires_on <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)"),
      pool.query("SELECT COUNT(*) AS t FROM memberships WHERE expires_on < CURDATE() AND status = 'active'"),
      pool.query(
        `SELECT u.id AS userId, COALESCE(u.full_name, u.username) AS name,
          SUM(CASE WHEN a.event_type IN ('Walk-in Check-in', 'Membership Created') THEN 1 ELSE 0 END) AS transactions,
          SUM(CASE WHEN a.event_type IN ('Walk-in Check-in', 'Membership Created') THEN
            CASE WHEN a.description REGEXP 'Total: [0-9.]+' THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(a.description, '. Paid', 1), 'Total: ', -1) AS DECIMAL(10,2)) ELSE 0 END
          ELSE 0 END) AS sales,
          SUM(CASE WHEN a.event_type = 'Walk-in Check-in' THEN 1 ELSE 0 END) AS checkIns,
          SUM(CASE WHEN a.event_type = 'Walk-in Check-out' THEN 1 ELSE 0 END) AS checkOuts
         FROM users u
         LEFT JOIN audit_logs a ON a.user_id = u.id AND ${joinConds.join(' AND ')}
         WHERE ${whereConds.join(' AND ')}
         GROUP BY u.id, u.full_name, u.username ORDER BY transactions DESC`,
        [...joinParams, ...whereParams]
      ),
      pool.query(
        `SELECT CONCAT('INV-', LPAD(id, 5, '0')) AS transactionNo,
          DATE_FORMAT(time_in, '%Y-%m-%d') AS date,
          DATE_FORMAT(time_in, '%h:%i %p') AS time,
          name AS member,
          client_type AS type,
          price AS amount,
          COALESCE(payment_method, 'Cash') AS paymentMethod,
          payment_status AS status
         FROM clients WHERE ${txnClientWhere.join(' AND ')} AND ${txncDateFilters}
         ORDER BY id DESC LIMIT 50`,
        [...txnClientParams, ...clientDateParams]
      ),
      pool.query(
        `SELECT CONCAT('INV-M', LPAD(id, 5, '0')) AS transactionNo,
          DATE_FORMAT(subscribed_on, '%Y-%m-%d') AS date,
          DATE_FORMAT(subscribed_on, '%h:%i %p') AS time,
          name AS member,
          CONCAT(membership_type, ' Membership') AS type,
          price AS amount,
          COALESCE(payment_method, 'Cash') AS paymentMethod,
          'Paid' AS status
         FROM memberships WHERE ${txnMemDateWhere.join(' AND ')}
         ORDER BY id DESC LIMIT 50`,
        txnMemDateParams
      ),
    ]);

    const totalRevenue = Number(todayClientRev.total || 0) + Number(todayMemRev.total || 0);
    const todayRevenue = Number(todayClientRevF.total || 0) + Number(todayMemRevF.total || 0);
    const todayTransactions = todayTxn.total;
    const totalTransactions = totalTxn.total;

    const salesSummary = {
      totalSales: Number(salesAvg.totalSales || 0),
      transactions: salesAvg.transactions,
      avgTransaction: salesAvg.transactions > 0 ? Number((salesAvg.totalSales / salesAvg.transactions).toFixed(2)) : 0,
      highestTransaction: Number(salesAvg.highest || 0),
      lowestTransaction: Number(salesAvg.lowest || 0),
    };

    const totalMemSales = membershipSales.reduce((s, r) => s + Number(r.revenue || 0), 0);
    membershipSales.forEach(r => {
      r.percentage = totalMemSales > 0 ? Number(((Number(r.revenue) / totalMemSales) * 100).toFixed(1)) : 0;
    });

    const peakHour = peakHours.reduce((max, r) => r.visits > max.visits ? r : max, { visits: 0 });
    const peakHourLabel = peakHour.hour != null ? `${peakHour.hour === 0 ? 12 : peakHour.hour > 12 ? peakHour.hour - 12 : peakHour.hour}:00 ${peakHour.hour < 12 ? 'AM' : 'PM'}` : 'N/A';

    let allTxns = [...recentTransactions, ...recentMemTxns]
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || ''));
    const txnTotal = allTxns.length;
    allTxns = allTxns.slice(0, 50);

    res.json({
      summary: {
        todayRevenue,
        totalRevenue,
        todayTransactions,
        totalTransactions,
        activeMembers,
        todayCheckIns,
        todayCheckOuts,
        currentlyInside,
      },
      revenueByPeriod,
      salesSummary,
      paymentMethods,
      membershipSales: { items: membershipSales, totalRevenue: totalMemSales },
      attendance: {
        totalCheckIns: attCheckIns.total,
        totalCheckOuts: attCheckOuts.total,
        currentlyInside: attInside.total,
        totalVisits: attTotal.total,
        dailyVisits,
      },
      peakHours: peakHours.map(r => ({
        hour: r.hour,
        label: `${r.hour === 0 ? 12 : r.hour > 12 ? r.hour - 12 : r.hour}:00 ${r.hour < 12 ? 'AM' : 'PM'}`,
        visits: r.visits,
      })),
      peakHour: peakHourLabel,
      membershipStatus: {
        active: msActive.t,
        expiringSoon: msExpiring.t,
        expired: msExpired.t,
      },
      staffActivity,
      recentTransactions: allTxns,
      txnTotal,
    });
  } catch (err) {
    console.error('Dashboard report error:', err);
    res.status(500).json({ error: 'Failed to load dashboard report' });
  }
});

// Build the membership status summary shown on the door's client display
// after a member checks in: name, type, dates, status, coaching progress and
// any unpaid / installment balance.
function membershipStatusPayload(member, coachingThreshold) {
  if (!member) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  let statusText = String(member.status || 'active').toLowerCase() === 'active' ? 'Active' : 'Inactive';
  if (member.expires) {
    const expires = new Date(member.expires);
    if (expires < now) statusText = 'Expired';
  }
  const used = Number(member.coachingSessionsUsed) || 0;
  const threshold = Number(coachingThreshold) || Number(member.coachingSessionThreshold) || 0;
  const hasCoaching = member.coaching && member.coaching !== 'none';
  return {
    id: member.id,
    name: member.name,
    type: member.type,
    subscribed: member.subscribed,
    expires: member.expires,
    status: statusText,
    coaching: hasCoaching ? member.coaching : null,
    coachingLabel: hasCoaching ? `${used} / ${threshold} sessions` : null,
    coachingUsed: hasCoaching ? used : null,
    coachingThreshold: hasCoaching ? threshold : null,
    paymentPlan: member.paymentPlan || 'full',
    balance: Number(member.balance) || 0,
    amountPaid: Number(member.amountPaid) || 0,
    totalAmount: Number(member.totalAmount) || 0,
  };
}

// Store SSE clients for real-time fingerprint events
const fingerprintSSEClients = new Set();

// Broadcast fingerprint events to all connected SSE clients
function broadcastFingerprintEvent(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of fingerprintSSEClients) {
    client.write(payload);
  }
}

// Listen to fingerprint device events and broadcast via SSE
fingerprint.on('finger-detected', () => broadcastFingerprintEvent('finger-detected', { timestamp: Date.now() }));
fingerprint.on('image-captured', () => broadcastFingerprintEvent('image-captured', { timestamp: Date.now() }));
fingerprint.on('image-processed', () => broadcastFingerprintEvent('image-processed', { timestamp: Date.now() }));
fingerprint.on('match', (data) => broadcastFingerprintEvent('match', data));
fingerprint.on('no-match', () => broadcastFingerprintEvent('no-match', { timestamp: Date.now() }));
fingerprint.on('scan-started', () => broadcastFingerprintEvent('scan-started', { timestamp: Date.now() }));
fingerprint.on('scan-stopped', () => broadcastFingerprintEvent('scan-stopped', { timestamp: Date.now() }));
fingerprint.on('enroll-start', (data) => broadcastFingerprintEvent('enroll-start', data));
fingerprint.on('enroll-step', (data) => broadcastFingerprintEvent('enroll-step', data));
fingerprint.on('enroll-done', (data) => broadcastFingerprintEvent('enroll-done', data));
fingerprint.on('connected', () => broadcastFingerprintEvent('connected', fingerprint.getStatus()));
fingerprint.on('disconnected', () => broadcastFingerprintEvent('disconnected', fingerprint.getStatus()));

// SSE endpoint for real-time fingerprint events (token via query param since EventSource can't set headers)
router.get('/fingerprint/events', async (req, res) => {
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'Token is required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || (!payload.id && !payload.sub) || !payload.role) return res.status(401).end();
  } catch (_) {
    return res.status(401).end();
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial status
  res.write(`event: status\ndata: ${JSON.stringify(fingerprint.getStatus())}\n\n`);

  // Add client to the set
  fingerprintSSEClients.add(res);

  // Keep the connection alive with periodic heartbeats
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  // Remove client on close
  req.on('close', () => {
    clearInterval(heartbeat);
    fingerprintSSEClients.delete(res);
  });
});

router.get('/fingerprint/status', verifyToken, async (_req, res) => {
  res.json(fingerprint.getStatus());
});

// Get the latest door enrollment job status for a member, so the web UI can
// tell whether the fingerprint was enrolled successfully, still pending, or
// failed (with a reason like "no_match" = fingerprints did not match).
router.get('/fingerprint/enroll-status/:memberId', verifyToken, requireRole('admin|staff'), async (req, res) => {
  try {
    const [members] = await pool.query('SELECT id, name, fingerprint_id FROM memberships WHERE id = ? LIMIT 1', [req.params.memberId]);
    if (!members.length) return res.status(404).json({ error: 'Member not found' });

    const member = members[0];
    const [jobs] = await pool.query(
      `SELECT id, status, reason, step, quality, message FROM door_enroll_jobs
       WHERE member_id = ?
       ORDER BY id DESC LIMIT 1`,
      [member.id],
    );
    const job = jobs[0] || null;
    res.json({
      member_id: member.id,
      name: member.name,
      enrolled: !!member.fingerprint_id,
      job: job ? { status: job.status, reason: job.reason, step: job.step, quality: job.quality, message: job.message } : null,
    });
  } catch (err) {
    console.error('[fingerprint] Enroll status error:', err);
    res.status(500).json({ error: 'Failed to fetch enrollment status' });
  }
});

router.post('/fingerprint/connect', verifyToken, requireRole('admin|staff'), async (req, res) => {
  const { port, baudRate, sensorType } = req.body || {};
  const portPath = port || process.env.FINGERPRINT_PORT || 'COM3';
  const options = {};
  if (baudRate) options.baudRate = Number(baudRate);
  if (sensorType) options.sensorType = sensorType;
  try {
    const ok = await fingerprint.open(portPath, options);
    if (ok) {
      const status = fingerprint.getStatus();
      res.json({ connected: true, port: portPath, sensorType: status.sensorType, baudRate: status.baudRate });
    } else {
      res.status(500).json({ connected: false, error: 'Could not connect to fingerprint device. Check port and sensor type.' });
    }
  } catch (err) {
    res.status(500).json({ connected: false, error: err.message });
  }
});

router.post('/fingerprint/disconnect', verifyToken, requireRole('admin|staff'), async (_req, res) => {
  fingerprint.close();
  res.json({ connected: false });
});

router.post('/fingerprint/enroll', verifyToken, requireRole('admin|staff'), async (req, res) => {
  const { member_id } = req.body || {};
  if (!member_id) return res.status(400).json({ error: 'member_id is required' });
  if (!fingerprint.getStatus().connected) return res.status(500).json({ error: 'Fingerprint device not connected' });
  if (fingerprint.getStatus().enrolling) return res.status(409).json({ error: 'Already enrolling another member' });

  try {
    const [members] = await pool.query(`${MEMBERSHIP_SELECT} WHERE id = ? LIMIT 1`, [member_id]);
    if (!members.length) return res.status(404).json({ error: 'Member not found' });

    const memberId = Number(member_id);
    const result = await fingerprint.enroll(memberId);

    if (result.success) {
      await pool.query('UPDATE memberships SET fingerprint_id = ? WHERE id = ?', [memberId, member_id]);
      res.json({ success: true, message: 'Fingerprint enrolled successfully', member: members[0].name });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err) {
    console.error('[fingerprint] Enroll error:', err);
    res.status(500).json({ error: err.message || 'Enrollment failed' });
  }
});

router.delete('/fingerprint/:memberId', verifyToken, requireRole('admin|staff'), async (req, res) => {
  const { memberId } = req.params;
  try {
    const [members] = await pool.query(`${MEMBERSHIP_SELECT} WHERE id = ? LIMIT 1`, [memberId]);
    if (!members.length) return res.status(404).json({ error: 'Member not found' });

    // Remove the template from the sensor hardware if connected
    if (fingerprint.getStatus().connected) {
      try {
        await fingerprint.deleteTemplate(Number(memberId));
      } catch (err) {
        console.warn('[fingerprint] Could not delete template from device:', err.message);
      }
    }

    await pool.query('UPDATE memberships SET fingerprint_id = NULL WHERE id = ?', [memberId]);
    res.json({ success: true, message: 'Fingerprint removed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove fingerprint' });
  }
});

router.get('/fingerprint/scan-start', verifyToken, requireRole('admin|staff'), async (_req, res) => {
  if (!fingerprint.getStatus().connected) return res.status(500).json({ error: 'Device not connected' });

  fingerprint.startScanLoop(async (result) => {
    try {
      const secret = process.env.BIOMETRIC_SECRET || 'rdc_biometric_secret';
      const http = require('http');
      const body = JSON.stringify({ fingerprint_id: result.templateId, secret });
      const port = process.env.PORT || 4000;

      const internalReq = http.request({
        hostname: '127.0.0.1', port, path: '/data/biometric-scan',
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          const text = data.toString();
          try {
            const parsed = JSON.parse(text);
            broadcastFingerprintEvent('scan-result', parsed);
          } catch (_) {
            broadcastFingerprintEvent('scan-result', { error: text });
          }
        });
      });
      internalReq.on('error', () => {});
      internalReq.write(body);
      internalReq.end();
    } catch (_) {}
  });

  res.json({ scanning: true });
});

router.get('/fingerprint/scan-stop', verifyToken, requireRole('admin|staff'), async (_req, res) => {
  fingerprint.stopScanLoop();
  res.json({ scanning: false });
});

router.get('/client-display', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM client_display_events ORDER BY created_at DESC LIMIT 1',
    );
    const row = rows[0] || null;
    if (row && row.payload) {
      try { row.payload = JSON.parse(row.payload); } catch (_) { row.payload = null; }
    }
    let membersInside = 0;
    let nonMembersInside = 0;
    try {
      const [[inside]] = await pool.query(
        `SELECT
           SUM(CASE WHEN (client_type = 'Member' OR (client_type LIKE 'Member%' AND client_type NOT LIKE 'Non-Member%')) THEN 1 ELSE 0 END) AS members_inside,
           SUM(CASE WHEN NOT (client_type = 'Member' OR (client_type LIKE 'Member%' AND client_type NOT LIKE 'Non-Member%')) THEN 1 ELSE 0 END) AS non_members_inside
         FROM clients
         WHERE time_out IS NULL
           AND DATE(time_in) = CURDATE()`,
      );
      membersInside = Number(inside.members_inside) || 0;
      nonMembersInside = Number(inside.non_members_inside) || 0;
    } catch (_) {}
    res.json({
      ...(row || {}),
      members_inside: membersInside,
      non_members_inside: nonMembersInside,
      gym_hours: { open: '6:00 AM', close: '10:00 PM' },
    });
  } catch (err) {
    res.json(null);
  }
});

router.get('/client-display/clear', async (_req, res) => {
  try {
    await pool.query('DELETE FROM client_display_events');
  } catch (_) {}
  res.json({ ok: true });
});

router.post('/client-display/test', verifyToken, requireRole('admin'), async (req, res) => {
  const { action, member_name, message, membership_type, time_spent, payload } = req.body || {};
  const validActions = ['checkin', 'checkout', 'denied', 'expired'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Use: checkin, checkout, denied, expired' });
  }
  const msgs = {
    checkin: message || 'Thank you for choosing RDC Gym!',
    checkout: message || 'Thank you! See you next time.',
    denied: message || 'Access Denied — Not an active member',
    expired: message || 'Access Denied — Membership expired',
  };
  await writeDisplayEvent(
    member_name || 'Test Member',
    action,
    msgs[action],
    membership_type || 'Regular',
    action === 'checkin' ? (payload?.status || 'active') : action === 'expired' ? 'expired' : 'active',
    action === 'checkout' ? (time_spent || '1h 23m') : null,
    payload || null,
  );
  res.json({ ok: true, action, message: msgs[action] });
});

module.exports = router;
