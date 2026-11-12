'use strict';
/* Password hashing.
   PBKDF2-HMAC-SHA256 with a per-account random salt, run off the event loop.
   The work factor follows the OWASP Password Storage Cheat Sheet (600,000 iterations
   for PBKDF2-HMAC-SHA256). Accounts made before this change were hashed with 310,000
   and carry no `iter` field; they still verify, and are re-hashed at the next sign-in. */

const crypto = require('crypto');

const ITERATIONS = 600000;
const LEGACY_ITERATIONS = 310000;
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;

const hash = (password, salt, iterations = ITERATIONS) => new Promise((resolve, reject) =>
  crypto.pbkdf2(String(password), 'bau:' + salt, iterations, 32, 'sha256',
    (e, key) => (e ? reject(e) : resolve(key.toString('hex')))));

const newSalt = () => crypto.randomBytes(16).toString('hex');

const iterationsOf = acct => (acct && Number.isInteger(acct.iter) && acct.iter >= LEGACY_ITERATIONS
  ? acct.iter : LEGACY_ITERATIONS);

const needsRehash = acct => iterationsOf(acct) < ITERATIONS;

// constant-time compare for hex hashes
function sameSecret(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* Check a password against an account. For a missing account the hash still runs
   (with a dummy salt at the current cost) so the reply time does not reveal it. */
async function verify(acct, password) {
  const pw = String(password || '').slice(0, PASSWORD_MAX);
  if (!acct) { await hash(pw, 'no-account'); return false; }
  return sameSecret(await hash(pw, acct.salt, iterationsOf(acct)), acct.hash);
}

// fields to merge into an account record for a new password
async function freshHash(password) {
  const salt = newSalt();
  return { salt, hash: await hash(password, salt, ITERATIONS), iter: ITERATIONS };
}

const passwordProblem = pw => (pw.length < PASSWORD_MIN ? 'make the password at least ' + PASSWORD_MIN + ' characters'
  : pw.length > PASSWORD_MAX ? 'make the password at most ' + PASSWORD_MAX + ' characters' : '');

module.exports = {
  ITERATIONS, LEGACY_ITERATIONS, PASSWORD_MIN, PASSWORD_MAX,
  hash, newSalt, iterationsOf, needsRehash, sameSecret, verify, freshHash, passwordProblem
};
