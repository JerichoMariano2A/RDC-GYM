-- RDC GYM schema for MySQL
-- Save as schema.sql, then import into a MySQL server (XAMPP).
-- The backend also creates/updates these tables on startup.

CREATE DATABASE IF NOT EXISTS `rdc_gym`
  DEFAULT CHARACTER SET = utf8mb4
  DEFAULT COLLATE = utf8mb4_unicode_ci;
USE `rdc_gym`;

CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(100) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `role` ENUM('admin','staff') NOT NULL DEFAULT 'staff',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `clients` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `client_type` VARCHAR(100) NOT NULL DEFAULT 'Walk-in',
  `payment_status` ENUM('Paid','Not Paid','CI') NOT NULL DEFAULT 'Paid',
  `price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `time_in` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `time_out` DATETIME NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `memberships` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `membership_type` VARCHAR(100) NOT NULL,
  `subscribed_on` DATE NOT NULL,
  `expires_on` DATE NOT NULL,
  `price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NULL,
  `action` VARCHAR(255) NULL,
  `entity` VARCHAR(100) NULL,
  `entity_id` VARCHAR(100) NULL,
  `details` TEXT NULL,
  `ip_address` VARCHAR(60) NULL,
  `user` VARCHAR(100) NULL,
  `role` ENUM('admin','staff') NULL,
  `event_type` VARCHAR(150) NULL,
  `description` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
