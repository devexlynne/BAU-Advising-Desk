#!/usr/bin/env node
'use strict';
/* Put an encrypted backup back as the live store.

     STORE_KEY=... node scripts/restore-backup.js <backup-file> [--data <dir>] --yes

   Stop the server first. The backup is decrypted with STORE_KEY before anything
   is touched, so a wrong key or a damaged file changes nothing. The current
   store.json is kept next to it as store.json.before-restore-<time>.
   Without --yes it only checks the backup and says what it would do. */

const path = require('path');
const sealed = require('../src/encrypted-file');
const B = require('../server/backup-files');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--data');
const dataDir = path.resolve(opt('--data') || process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

function fail(msg) { console.error('restore: ' + msg); process.exit(1); }

if (!file) fail('name the backup file, e.g. data/backups/store-2026-11-12T09-00-00-000Z.json');
if (!process.env.STORE_KEY) fail('STORE_KEY is not set');
let key;
try { key = sealed.parseKey(process.env.STORE_KEY); } catch (e) { fail(e.message); }

let data;
try { data = B.readStoreFile(path.resolve(file), key); } catch (e) { fail('cannot read the backup: ' + e.message); }
const people = Object.keys(data).filter(k => /^people\//.test(k)).length;
const records = Object.keys(data).filter(k => /^advisors\/[^/]+\/students\//.test(k)).length;
console.log('backup ok: ' + Object.keys(data).length + ' keys, ' + people + ' people, ' + records + ' student records');

if (!args.includes('--yes')) {
  console.log('nothing changed. Run again with --yes (server stopped) to restore it into ' + dataDir);
  process.exit(0);
}
const out = B.restore(dataDir, path.resolve(file), key);
console.log('restored into ' + path.join(dataDir, 'store.json'));
if (out.keptAs) console.log('the store it replaced is kept as ' + out.keptAs);
