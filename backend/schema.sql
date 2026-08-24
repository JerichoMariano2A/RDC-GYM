-- RDC GYM schema for MySQL
-- Save as schema.sql, then import into a MySQL server (XAMPP).

CREATE DATABASE IF NOT EXISTS `rdc_gym`
  DEFAULT CHARACTER SET = utf8mb4
  DEFAULT COLLATE = utf8mb4_unicode_ci;
USE `rdc_gym`;

-- Users (admin / staff)
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(100) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `role` ENUM('admin','staff') NOT NULL DEFAULT 'staff',
  `full_name` VARCHAR(200),
  `email` VARCHAR(200),
  `last_login` DATETIME NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Members (gym customers)
CREATE TABLE IF NOT EXISTS `members` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `member_no` VARCHAR(50) NOT NULL UNIQUE,
  `first_name` VARCHAR(120) NOT NULL,
  `last_name` VARCHAR(120) NOT NULL,
  `dob` DATE NULL,
  `gender` ENUM('male','female','other') NULL,
  `phone` VARCHAR(30) NULL,
  `email` VARCHAR(200) NULL,
  `address` TEXT NULL,
  `joined_at` DATE DEFAULT (CURRENT_DATE),
  `status` ENUM('active','inactive','suspended','cancelled') DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Membership plans (pricing)
CREATE TABLE IF NOT EXISTS `membership_plans` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(150) NOT NULL,
  `duration_months` INT UNSIGNED NOT NULL,
  `price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `description` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Member subscriptions / active memberships
CREATE TABLE IF NOT EXISTS `member_memberships` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `member_id` INT UNSIGNED NOT NULL,
  `plan_id` INT UNSIGNED NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `status` ENUM('active','expired','cancelled') NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`plan_id`) REFERENCES `membership_plans`(`id`) ON DELETE RESTRICT,
  INDEX (`member_id`),
  INDEX (`plan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fingerprint templates (if storing template data locally)
-- NOTE: storing biometric templates may have legal/privacy implications; consider storing them in a secure device/SDK instead.
CREATE TABLE IF NOT EXISTS `fingerprint_templates` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `member_id` INT UNSIGNED NULL,
  `device_id` VARCHAR(100) NULL,
  `template` LONGBLOB NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE SET NULL,
  INDEX (`member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Attendance / time in - time out
CREATE TABLE IF NOT EXISTS `attendance` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `member_id` INT UNSIGNED NULL,
  `checked_in_at` DATETIME NOT NULL,
  `checked_out_at` DATETIME NULL,
  `source` ENUM('biometric','manual','web') NOT NULL DEFAULT 'biometric',
  `device_id` VARCHAR(100) NULL,
  `registered_by_user_id` INT UNSIGNED NULL, -- staff who registered manual/log adjustments
  `notes` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`registered_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX (`member_id`),
  INDEX (`registered_by_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit logs for admin actions
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT UNSIGNED NULL,
  `action` VARCHAR(255) NOT NULL,
  `entity` VARCHAR(100) NULL,
  `entity_id` VARCHAR(100) NULL,
  `details` TEXT NULL,
  `ip_address` VARCHAR(60) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX (`user_id`),
  INDEX (`entity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional: reports table for scheduled/archived report metadata
CREATE TABLE IF NOT EXISTS `reports` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `filters` JSON NULL,
  `file_path` VARCHAR(500) NULL,
  `created_by` INT UNSIGNED NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_members_status ON `members` (`status`);
CREATE INDEX IF NOT EXISTS idx_attendance_checked_in_at ON `attendance` (`checked_in_at`);

-- Example: do not insert admin password here (seed script will create an admin),
-- but if you want a quick admin row (not recommended to hardcode plaintext password),
-- use the seed script provided in the backend (seedAdmin.js) which hashes the password with bcrypt.

-- End of schema
