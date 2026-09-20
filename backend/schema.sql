-- RDC GYM schema for MySQL
-- Save as schema.sql, then import into a MySQL server (XAMPP).
-- The backend also creates/updates these tables on startup.
-- Tables: users (admin + Manage Staff), clients, memberships, audit_logs, promo_banners, client_display_events.
-- View: staff_accounts (staff rows from users where role = 'staff').

CREATE DATABASE IF NOT EXISTS `rdc_gym`
  DEFAULT CHARACTER SET = utf8mb4
  DEFAULT COLLATE = utf8mb4_unicode_ci;
USE `rdc_gym`;

-- Login accounts, including Manage Staff.
-- Staff records are rows in `users` with role = 'staff' (Staff ID is STF- plus the numeric id).
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(100) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `role` ENUM('admin','staff') NOT NULL DEFAULT 'staff',
  `full_name` VARCHAR(120) NULL,
  `profile_photo` LONGBLOB NULL,
  `profile_mime` VARCHAR(100) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `staff_accounts` AS
SELECT
  `id`,
  `username` AS `name`,
  CONCAT('STF-', LPAD(`id`, 3, '0')) AS `staff_id`,
  DATE_FORMAT(`created_at`, '%Y-%m-%d') AS `date_added`,
  `created_at`
FROM `users`
WHERE `role` = 'staff';

-- Client walk-in and visit records.
-- Each row is a single visit (time_in / time_out).
-- breakdown columns track pricing: membership_fee, type_price, coaching, totals, payment plan.
-- payment_method tracks how the client paid (Cash, GCash, Maya, etc).
-- created_by links to the staff/admin user who created the record.
CREATE TABLE IF NOT EXISTS `clients` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `client_type` VARCHAR(100) NOT NULL DEFAULT 'Walk-in',
  `payment_status` ENUM('Paid','Not Paid','CI') NOT NULL DEFAULT 'Paid',
  `price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `time_in` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `time_out` DATETIME NULL,
  `membership_fee` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `type_price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `coaching_type` VARCHAR(20) NOT NULL DEFAULT 'none',
  `coaching_price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `coaching_units` INT NOT NULL DEFAULT 1,
  `is_student` TINYINT(1) NOT NULL DEFAULT 0,
  `total_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `amount_paid` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `balance` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `payment_plan` VARCHAR(20) NOT NULL DEFAULT 'full',
  `payment_method` VARCHAR(30) NOT NULL DEFAULT 'Cash',
  `created_by` INT UNSIGNED NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Membership subscriptions.
-- Each row is one membership plan purchase with start/expiry dates.
-- fingerprint_id links to the R307 biometric device template ID.
-- created_by links to the staff/admin user who created the record.
CREATE TABLE IF NOT EXISTS `memberships` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `membership_type` VARCHAR(100) NOT NULL,
  `subscribed_on` DATE NOT NULL,
  `expires_on` DATE NOT NULL,
  `price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `fingerprint_id` INT NULL,
  `membership_fee` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `type_price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `coaching_type` VARCHAR(20) NOT NULL DEFAULT 'none',
  `coaching_price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `coaching_units` INT NOT NULL DEFAULT 1,
  `is_student` TINYINT(1) NOT NULL DEFAULT 0,
  `total_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `amount_paid` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `balance` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `payment_plan` VARCHAR(20) NOT NULL DEFAULT 'full',
  `payment_method` VARCHAR(30) NOT NULL DEFAULT 'Cash',
  `coaching_sessions_used` INT NOT NULL DEFAULT 0,
  `coaching_session_threshold` INT NOT NULL DEFAULT 15,
  `created_by` INT UNSIGNED NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit log for tracking all system events (logins, CRUD, check-ins, etc).
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
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What's New / promotional banner image.
CREATE TABLE IF NOT EXISTS `promo_banners` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `image` LONGBLOB NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `file_name` VARCHAR(255) NULL,
  `uploaded_by` VARCHAR(100) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Client-facing second monitor display events.
-- Stores the most recent scan events for the TV/monitor display.
CREATE TABLE IF NOT EXISTS `client_display_events` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `member_name` VARCHAR(255) NULL,
  `action` ENUM('checkin','checkout','denied','expired','error') NOT NULL,
  `message` TEXT NULL,
  `membership_type` VARCHAR(100) NULL,
  `membership_status` VARCHAR(50) NULL,
  `time_spent` VARCHAR(50) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ESP32 door enrollment queue.
-- Admin web UI queues a member (pending); the ESP32 polls, enrolls the finger,
-- and reports the result back.
CREATE TABLE IF NOT EXISTS `door_enroll_jobs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `member_id` INT NOT NULL,
  `status` ENUM('pending','claimed','done','failed','cancelled') NOT NULL DEFAULT 'pending',
  `reason` VARCHAR(50) NULL,
  `step` VARCHAR(50) NULL,
  `quality` TINYINT UNSIGNED NULL,
  `message` VARCHAR(255) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (`member_id`),
  INDEX (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
