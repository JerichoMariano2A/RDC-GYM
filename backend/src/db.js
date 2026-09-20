const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
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

  await addColumnIfMissing('users', 'full_name', 'VARCHAR(120) NULL');
  await addColumnIfMissing('users', 'profile_photo', 'LONGBLOB NULL');
  await addColumnIfMissing('users', 'profile_mime', 'VARCHAR(100) NULL');

  await pool.query(`
    CREATE OR REPLACE VIEW staff_accounts AS
    SELECT
      id,
      username AS name,
      CONCAT('STF-', LPAD(id, 3, '0')) AS staff_id,
      DATE_FORMAT(created_at, '%Y-%m-%d') AS date_added,
      created_at
    FROM users
    WHERE role = 'staff'
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
  await addColumnIfMissing('memberships', 'fingerprint_id', 'INT NULL');
  await addColumnIfMissing('memberships', 'coaching_sessions_used', 'INT NOT NULL DEFAULT 0');
  await addColumnIfMissing('memberships', 'coaching_session_threshold', 'INT NOT NULL DEFAULT 15');
  await addColumnIfMissing('memberships', 'type_quantity', 'INT NOT NULL DEFAULT 1');

  await addColumnIfMissing('clients', 'coaching_sessions_used', 'INT NOT NULL DEFAULT 0');
  await addColumnIfMissing('clients', 'coaching_session_threshold', 'INT NOT NULL DEFAULT 15');

  const breakdownColumns = [
    ['membership_fee', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
    ['type_price', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
    ['coaching_type', "VARCHAR(20) NOT NULL DEFAULT 'none'"],
    ['coaching_price', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
    ['coaching_units', 'INT NOT NULL DEFAULT 1'],
    ['is_student', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['total_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
    ['amount_paid', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
    ['balance', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
    ['payment_plan', "VARCHAR(20) NOT NULL DEFAULT 'full'"],
    ['payment_method', "VARCHAR(30) NOT NULL DEFAULT 'Cash'"],
    ['created_by', 'INT UNSIGNED NULL'],
  ];
  for (const table of ['clients', 'memberships']) {
    for (const [column, definition] of breakdownColumns) {
      await addColumnIfMissing(table, column, definition);
    }
  }

  await pool.query('CREATE TABLE IF NOT EXISTS promo_banners (' +
    'id INT AUTO_INCREMENT PRIMARY KEY,' +
    ' image LONGBLOB NOT NULL,' +
    ' mime_type VARCHAR(100) NOT NULL,' +
    ' file_name VARCHAR(255) NULL,' +
    ' uploaded_by VARCHAR(100) NULL,' +
    ' created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP' +
    ') ENGINE=InnoDB;');

  const [[{ count: userCount }]] = await pool.query('SELECT COUNT(*) AS count FROM users');
  if (!userCount) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'adminpass';
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hash, 'admin']);
    console.log(`Users table was empty - seeded default admin account "${username}"`);
  }
  try {
    await pool.query("ALTER TABLE clients MODIFY COLUMN client_type VARCHAR(100) NOT NULL DEFAULT 'Walk-in'");
  } catch (err) {
    console.warn('Could not widen clients.client_type:', err.message);
  }

  await pool.query('CREATE TABLE IF NOT EXISTS audit_logs (' +
    'id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,' +
    ' user_id INT NULL,' +
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

  await pool.query('CREATE TABLE IF NOT EXISTS client_display_events (' +
    'id INT AUTO_INCREMENT PRIMARY KEY,' +
    ' member_name VARCHAR(255) NULL,' +
    " action ENUM('checkin','checkout','denied','expired','error') NOT NULL," +
    ' message TEXT NULL,' +
    ' membership_type VARCHAR(100) NULL,' +
    ' membership_status VARCHAR(50) NULL,' +
    ' time_spent VARCHAR(50) NULL,' +
    ' payload JSON NULL,' +
    ' created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP' +
    ') ENGINE=InnoDB;'
  );
  await pool.query('ALTER TABLE client_display_events ADD COLUMN IF NOT EXISTS payload JSON NULL');

  await pool.query('CREATE TABLE IF NOT EXISTS door_enroll_jobs (' +
    'id INT AUTO_INCREMENT PRIMARY KEY,' +
    ' member_id INT NOT NULL,' +
    " status ENUM('pending','claimed','done','failed','cancelled') NOT NULL DEFAULT 'pending'," +
    ' reason VARCHAR(50) NULL,' +
    ' created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,' +
    ' updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,' +
    ' INDEX (member_id),' +
    ' INDEX (status)' +
    ') ENGINE=InnoDB;'
  );
  await pool.query('ALTER TABLE door_enroll_jobs ADD COLUMN IF NOT EXISTS reason VARCHAR(50) NULL');
  await pool.query('ALTER TABLE door_enroll_jobs ADD COLUMN IF NOT EXISTS step VARCHAR(50) NULL');
  await pool.query('ALTER TABLE door_enroll_jobs ADD COLUMN IF NOT EXISTS quality TINYINT UNSIGNED NULL');
  await pool.query('ALTER TABLE door_enroll_jobs ADD COLUMN IF NOT EXISTS message VARCHAR(255) NULL');

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
