// ============================================================
// utils/hashPassword.js
// Wraps bcrypt hashing in a named utility.
// Used by user creation flows — NOT by auth login.
// ============================================================

import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 12

/**
 * Hashes a plain-text password using bcrypt.
 * Salt rounds set to 12 — strong enough for production,
 * not so high it causes request latency.
 *
 * @param {string} plainPassword
 * @returns {Promise<string>} Hashed password
 */
const hashPassword = async (plainPassword) => {
  return bcrypt.hash(plainPassword, SALT_ROUNDS)
}

export default hashPassword
