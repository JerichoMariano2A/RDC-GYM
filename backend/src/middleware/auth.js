const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(allowed) {
  // allowed: string like 'admin' or 'staff|admin'
  const allowedRegex = new RegExp(`^(${allowed})$`);
  return (req, res, next) => {
    if (!req.user || !req.user.role) return res.status(403).json({ error: 'Forbidden' });
    if (!allowedRegex.test(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

module.exports = { verifyToken, requireRole };
