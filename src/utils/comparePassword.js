// ============================================================
// utils/comparePassword.js
// Wraps bcrypt comparison in a named utility.
// Used exclusively by auth.service.js during login.
// ============================================================

import bcrypt from 'bcryptjs'

/**
 * Compares a plain-text password against a bcrypt hash.
 * Returns false (never throws) if the comparison fails —
 * the service layer decides how to handle a mismatch.
 *
 * Timing-safe: bcrypt.compare uses constant-time comparison
 * internally, preventing timing attack exploits.
 *
 * @param {string} plainPassword  — from req.body
 * @param {string} hashedPassword — from DB (passwordHash field)
 * @returns {Promise<boolean>}
 */
const comparePassword = async (plainPassword, hashedPassword) => {
  return bcrypt.compare(plainPassword, hashedPassword)
}

export default comparePassword
