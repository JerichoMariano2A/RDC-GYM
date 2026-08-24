const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_HOST = process.env.DB_HOST ?? 'localhost';
const DB_PORT = process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306;
const DB_USER = process.env.DB_USER ?? 'admin';
const DB_PASSWORD = process.env.DB_PASSWORD ?? 'adminpass';
const DB_NAME = process.env.DB_NAME ?? 'rdc_gym';

async function ensureDatabase() {
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
  });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();
}

async function seed() {
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'adminpass';

  try {
    await ensureDatabase();
    const pool = require('./src/db');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role ENUM('admin','staff') NOT NULL DEFAULT 'staff',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [adminUser]);
    if (rows && rows.length) {
      console.log('Admin user already exists');
      process.exit(0);
    }

    const hash = await bcrypt.hash(adminPass, 10);
    await pool.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [adminUser, hash, 'admin']);
    console.log('Seeded admin user:', adminUser);
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed', err);
    process.exit(1);
  }
}

seed();
