const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_HOST = process.env.DB_HOST ?? 'localhost';
const DB_PORT = process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306;
const DB_USER = process.env.DB_USER ?? 'admin';
const DB_PASSWORD = process.env.DB_PASSWORD ?? 'adminpass';
const DB_NAME = process.env.DB_NAME ?? 'rdc_gym';

const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  connectionLimit: 10,
});

// ensure the database exists before attempting pool queries
(async function testConnection() {
  try {
    const adminConn = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
    });
    await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await adminConn.end();

    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();

    await ensureTables();

    console.log('MySQL pool connected to', DB_NAME);
  } catch (err) {
    console.error('MySQL connection failed:', err.message);
  }
})();

async function addColumnIfMissing(table, column, definition) {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [DB_NAME, table, column],
  );
  if (!rows[0].c) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(100) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role ENUM('admin','staff') NOT NULL DEFAULT 'staff',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      client_type VARCHAR(100) NOT NULL DEFAULT 'Walk-in',
      payment_status ENUM('Paid','Not Paid','CI') NOT NULL DEFAULT 'Paid',
      price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      time_in DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      time_out DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS memberships (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      membership_type VARCHAR(100) NOT NULL,
      subscribed_on DATE NOT NULL,
      expires_on DATE NOT NULL,
      price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      status ENUM('active','inactive') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await addColumnIfMissing('clients', 'price', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00');
  await addColumnIfMissing('memberships', 'price', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00');
  await addColumnIfMissing('memberships', 'status', "ENUM('active','inactive') NOT NULL DEFAULT 'active'");
  try {
    await pool.query("ALTER TABLE clients MODIFY COLUMN client_type VARCHAR(100) NOT NULL DEFAULT 'Walk-in'");
  } catch (err) {
    console.warn('Could not widen clients.client_type:', err.message);
  }

  await pool.query('CREATE TABLE IF NOT EXISTS audit_logs (' +
    'id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,' +
    ' user_id INT UNSIGNED NULL,' +
    ' action VARCHAR(255) NULL,' +
    ' entity VARCHAR(100) NULL,' +
    ' entity_id VARCHAR(100) NULL,' +
    ' details TEXT NULL,' +
    ' ip_address VARCHAR(60) NULL,' +
    ' `user` VARCHAR(100) NULL,' +
    ' `role` ENUM(\'admin\',\'staff\') NULL,' +
    ' event_type VARCHAR(150) NULL,' +
    ' description TEXT NULL,' +
    ' created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,' +
    ' FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,' +
    ' INDEX (user_id)' +
    ') ENGINE=InnoDB;'
  );

  await pool.query('ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_id INT UNSIGNED NULL');
  await pool.query('ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS action VARCHAR(255) NULL');
  await pool.query('ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity VARCHAR(100) NULL');
  await pool.query('ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_id VARCHAR(100) NULL');
  await pool.query('ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details TEXT NULL');
  await pool.query('ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(60) NULL');
  await pool.query('ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS `user` VARCHAR(100) NULL');
  await pool.query('ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS `role` ENUM(\'admin\',\'staff\') NULL');
  await pool.query('ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS event_type VARCHAR(150) NULL');
  await pool.query('ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS description TEXT NULL');
  await pool.query('ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

  await pool.query('UPDATE audit_logs '
    + 'SET `user` = COALESCE(`user`, (SELECT username FROM users WHERE users.id = audit_logs.user_id), \'system\'),' +
    ' `role` = COALESCE(`role`, \'staff\'),' +
    ' event_type = COALESCE(event_type, action),' +
    ' description = COALESCE(description, details)' +
    ' WHERE 1'
  );

  const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM memberships');
  if (count === 0) {
    // Do not pre-seed membership data here so the app starts with a clean membership list.
  }

  const [[{ logCount }]] = await pool.query('SELECT COUNT(*) AS logCount FROM audit_logs');
  if (logCount === 0) {
    await pool.query(`INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES
      (NULL, 'Login', 'dashboard', NULL, 'Admin signed in from dashboard.'),
      (NULL, 'Member Check-in', 'clients', NULL, 'Member scanned in at reception.'),
      (NULL, 'Staff Added', 'users', NULL, 'New staff account was created.')
    `);
  }
}

module.exports = pool;
