#!/usr/bin/env node
'use strict';
/* Re-encrypt the store, every backup and the audit log with a new key.

     STORE_KEY=<old> NEW_STORE_KEY=<new> node scripts/rotate-store-key.js [--data <dir>] --yes

   Stop the server first, run this, then start the server with STORE_KEY set to the
   new key. Every file is decrypted with the old key before any file is replaced,
   so a wrong old key changes nothing. Make a new key with:
     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" */

const path = require('path');
const sealed = require('../src/encrypted-file');
const B = require('../server/backup-files');

const args = process.argv.slice(2);
const i = args.indexOf('--data');
const dataDir = path.resolve(i >= 0 ? args[i + 1] : process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
function fail(msg) { console.error('rotate: ' + msg); process.exit(1); }

if (!process.env.STORE_KEY || !process.env.NEW_STORE_KEY) fail('set both STORE_KEY (current) and NEW_STORE_KEY');
let oldKey, newKey;
try { oldKey = sealed.parseKey(process.env.STORE_KEY); newKey = sealed.parseKey(process.env.NEW_STORE_KEY); } catch (e) { fail(e.message); }
if (!args.includes('--yes')) {
  console.log('this re-encrypts everything in ' + dataDir + '. Stop the server and run again with --yes.');
  process.exit(0);
}
try {
  const n = B.rotateKey(dataDir, oldKey, newKey);
  console.log('done: store ' + n.store + ', backups ' + n.backups + ', audit lines ' + n.auditLines);
  console.log('now start the server with STORE_KEY set to the new key, and keep the old key until you have checked it.');
} catch (e) { fail(e.message + ' (nothing was replaced)'); }
