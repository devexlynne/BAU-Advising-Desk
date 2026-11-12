'use strict';
/* Shared helpers for the backup scripts (restore, key rotation) and the backup status
   shown to superadmins. Everything here works on the encrypted files in DATA_DIR:
     store.json        the whole store, one AES-256-GCM envelope
     backups/*.json    hourly copies of store.json
     audit.log         one encrypted envelope (JSON) per line */

const fs = require('fs');
const path = require('path');
const sealed = require('../src/encrypted-file');

const backupNames = dir => (fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(f => /^store-.*\.json$/.test(f)).sort() : []);

// newest backup: name, time, size. null when there is none.
function latestBackup(dataDir) {
  const dir = path.join(dataDir, 'backups');
  const names = backupNames(dir);
  if (!names.length) return null;
  const name = names[names.length - 1];
  const st = fs.statSync(path.join(dir, name));
  return { name, file: path.join(dir, name), at: st.mtimeMs, bytes: st.size, count: names.length };
}

// write a file so a crash can never leave half of it behind
function writeAtomic(file, text) {
  const tmp = file + '.tmp-' + process.pid;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

// read an encrypted store file and return the store object (throws on a wrong key or an edited file)
function readStoreFile(file, key) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!sealed.isEnvelope(raw)) throw new Error(path.basename(file) + ' is not an encrypted store file');
  const data = JSON.parse(sealed.decrypt(key, raw));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(path.basename(file) + ' does not hold a store');
  return data;
}

const sealStore = (key, store) => JSON.stringify(sealed.encrypt(key, JSON.stringify(store)));

/* Re-encrypt everything in dataDir from oldKey to newKey. Each file is decrypted,
   re-encrypted, checked with the new key, and only then put in place of the old one.
   The server must be stopped while this runs. Returns counts. */
function rotateKey(dataDir, oldKey, newKey) {
  if (oldKey.equals(newKey)) throw new Error('the new key is the same as the old one');
  const out = { store: 0, backups: 0, auditLines: 0 };
  const plan = [];
  const storeFile = path.join(dataDir, 'store.json');
  if (fs.existsSync(storeFile)) plan.push(storeFile);
  backupNames(path.join(dataDir, 'backups')).forEach(n => plan.push(path.join(dataDir, 'backups', n)));
  // decrypt everything first: if any file fails, nothing has been changed yet
  const ready = plan.map(file => {
    const text = sealStore(newKey, readStoreFile(file, oldKey));
    const check = JSON.parse(sealed.decrypt(newKey, JSON.parse(text)));
    if (!check || typeof check !== 'object') throw new Error('re-encryption check failed for ' + path.basename(file));
    return { file, text };
  });
  const auditFile = path.join(dataDir, 'audit.log');
  let auditText = null;
  if (fs.existsSync(auditFile)) {
    const lines = fs.readFileSync(auditFile, 'utf8').split('\n').filter(Boolean);
    auditText = lines.map(l => {
      const plain = sealed.decrypt(oldKey, JSON.parse(l));
      return JSON.stringify(sealed.encrypt(newKey, plain));
    }).join('\n') + (lines.length ? '\n' : '');
    out.auditLines = lines.length;
  }
  ready.forEach(({ file, text }) => {
    writeAtomic(file, text);
    if (file === storeFile) out.store = 1; else out.backups++;
  });
  if (auditText !== null) writeAtomic(auditFile, auditText);
  return out;
}

/* Put a backup back in place of store.json. The current store is kept next to it as
   store.json.before-restore-<time> (still encrypted). The server must be stopped. */
function restore(dataDir, backupFile, key) {
  const data = readStoreFile(backupFile, key);              // refuses a wrong key or a damaged file
  const storeFile = path.join(dataDir, 'store.json');
  let keptAs = null;
  if (fs.existsSync(storeFile)) {
    keptAs = storeFile + '.before-restore-' + new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(storeFile, keptAs);
  }
  writeAtomic(storeFile, sealStore(key, data));
  return { keys: Object.keys(data).length, keptAs };
}

module.exports = { latestBackup, writeAtomic, readStoreFile, sealStore, rotateKey, restore, backupNames };
