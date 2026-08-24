const mysql = require('mysql2/promise');
require('dotenv').config();
(async () => {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
      user: process.env.DB_USER || 'admin',
      password: process.env.DB_PASSWORD === undefined ? 'adminpass' : process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'rdc_gym'
    });
    const [cols] = await conn.query('SHOW COLUMNS FROM audit_logs');
    console.log('columns:', cols.map(c => `${c.Field}:${c.Type}`).join(' | '));
    const [rows] = await conn.query('SELECT * FROM audit_logs LIMIT 1');
    console.log('row sample:', rows.length ? JSON.stringify(rows[0], null, 2) : 'no rows');
    await conn.end();
  } catch (err) {
    console.error('ERROR', err.message);
    process.exit(0);
  }
})();
