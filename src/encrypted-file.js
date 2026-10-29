'use strict';
/*
 * Encrypted file storage: the store and the activity log are written with
 * AES-256-GCM, so the files on the server's disk are unreadable without the
 * key. The key comes from STORE_KEY (32 bytes, as 64 hex characters or
 * base64) and is never written to disk.
 *
 * Note: the key has to live in the server's settings for the server to read
 * the data, so this protects the files (disk, backups, copies of the volume),
 * not against someone who controls the running server or its settings.
 */
const crypto = require('crypto');

const FORMAT = 'advising-encrypted-v1';

function parseKey(value) {
  const v = String(value || '').trim();
  let key = null;
  if (/^[0-9a-fA-F]{64}$/.test(v)) key = Buffer.from(v, 'hex');
  else if (v) {
    try { key = Buffer.from(v, 'base64'); } catch (e) { key = null; }
  }
  if (!key || key.length !== 32) {
    throw new Error('STORE_KEY must be 32 bytes, written as 64 hex characters or base64');
  }
  return key;
}

function encrypt(key, text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return { format: FORMAT, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function isEnvelope(o) {
  return !!(o && typeof o === 'object' && o.format === FORMAT && o.iv && o.tag && typeof o.data === 'string');
}

function decrypt(key, envelope) {
  if (!isEnvelope(envelope)) throw new Error('not an encrypted store file');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  // a wrong key or an edited file fails here instead of returning garbage
  return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { FORMAT, parseKey, encrypt, decrypt, isEnvelope };
