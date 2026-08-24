const express = require('express');
const authRoutes = require('./routes/auth');
const { verifyToken, requireRole } = require('./middleware/auth');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.use('/auth', authRoutes);
const dataRoutes = require('./routes/data');
app.use('/data', dataRoutes);

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
app.listen(PORT, () => console.log(`RDC GYM backend running on ${PORT}`));
