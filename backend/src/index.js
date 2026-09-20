const express = require('express');
const authRoutes = require('./routes/auth');
const { verifyToken, requireRole } = require('./middleware/auth');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'rdc-gym-backend', time: new Date().toISOString() });
});

app.use('/auth', authRoutes);
const dataRoutes = require('./routes/data');
app.use('/data', dataRoutes);
const profileRoutes = require('./routes/profile');
app.use('/data/profile', profileRoutes);
const espRoutes = require('./routes/esp');
app.use('/esp', espRoutes);

app.get('/dashboard', verifyToken, (req, res) => {
  res.json({ message: 'Dashboard data', user: req.user });
});

app.get('/admin', verifyToken, requireRole('admin'), (req, res) => {
  res.json({ message: 'Admin area' });
});

app.get('/staff', verifyToken, requireRole('staff|admin'), (req, res) => {
  res.json({ message: 'Staff area' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`RDC GYM backend running on ${PORT}`);
});

// ---------------------------------------------------------------------------
// Close-of-day reset (10 PM)
// Closes all open visits when the gym closes. Runs every 60 seconds and
// fires once per calendar day. If the server restarts after 10 PM, this
// catches the current day's open visits. The read-time reconciliation in
// /clients/realtime handles any residual stale visits the next morning.
// ---------------------------------------------------------------------------
const pool = require('./db');
const GYM_CLOSE_HOUR = 22; // 10 PM
let lastNightlyResetDate = '';

setInterval(() => {
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  if (now.getHours() === GYM_CLOSE_HOUR && lastNightlyResetDate !== todayKey) {
    lastNightlyResetDate = todayKey;
    pool.query("UPDATE clients SET time_out = NOW() WHERE time_out IS NULL")
      .then(([result]) => {
        if (result.affectedRows > 0) {
          console.log('[nightly] Close-of-day: closed %d open visit(s)', result.affectedRows);
        }
      })
      .catch((err) => console.error('[nightly] Close-of-day reset failed:', err.message));
  }
}, 60 * 1000);
