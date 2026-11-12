/* Run with: node tests/encrypted-store.test.js
   Encrypted file storage (STORE_KEY): the store, backups and activity log on
   disk are unreadable, the data comes back after a restart with the right key,
   and a wrong key stops the server without touching the files. */
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sealed = require('../src/encrypted-file');
const { PASSWORDS, defaultStore } = require('./helpers/auth-fixture');

let passed = 0, failed = 0;
const check = (name, ok, extra) => {
  if (ok) passed++; else failed++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
};
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, '.test-data', 'encrypted');
const KEY = crypto.randomBytes(32).toString('hex');
const base = { DATA_DIR: DATA, STORE_KEY: KEY, MAIL_API_URL: '', MAIL_API_KEY: '', SMTP_URL: '', DATABASE_URL: '' };

async function waitFor(url) {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url + '/health')).ok) return; } catch (e) { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
const post = (url, p, body, cookie) => fetch(url + p, {
  method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, cookie ? { cookie } : {}), body: JSON.stringify(body)
});
function start(port, extra) {
  return spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, base, { PORT: String(port) }, extra || {}), stdio: 'ignore' });
}

(async () => {
  check('a malformed key is refused', (() => { try { sealed.parseKey('short'); return false; } catch (e) { return true; } })());
  const env = sealed.encrypt(Buffer.from(KEY, 'hex'), 'hello');
  check('encrypt and decrypt round trip', sealed.decrypt(Buffer.from(KEY, 'hex'), env) === 'hello');
  check('a wrong key cannot decrypt', (() => { try { sealed.decrypt(crypto.randomBytes(32), env); return false; } catch (e) { return true; } })());

  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'store.json'), JSON.stringify(
    sealed.encrypt(Buffer.from(KEY, 'hex'), JSON.stringify(defaultStore()))));
  let srv = start(3291, { ALLOW_UNVERIFIED_SIGNUP: 'true', ENABLE_STUDENT_IMPORTS: 'true' });
  let url = 'http://127.0.0.1:3291';
  try {
    await waitFor(url);
    const si = await post(url, '/api/signin', { email: 'test.advisor@bau.edu.lb', password: PASSWORDS.advisor });
    const cookie = (si.headers.get('set-cookie') || '').split(';')[0];
    const save = await post(url, '/api/students/save', { students: [{ id: '202599901', name: 'Zelda Quentin Example' }] }, cookie);
    check('a record is saved', save.status === 200, 'status ' + save.status);
    await new Promise(r => setTimeout(r, 400));
  } finally { srv.kill(); await new Promise(r => setTimeout(r, 300)); }

  const raw = fs.readFileSync(path.join(DATA, 'store.json'), 'utf8');
  check('store.json on disk is encrypted', sealed.isEnvelope(JSON.parse(raw)));
  check('the student name and ID do not appear on disk', !raw.includes('Zelda') && !raw.includes('202599901'));
  const log = fs.readFileSync(path.join(DATA, 'audit.log'), 'utf8').trim().split('\n');
  check('every activity log line is encrypted', log.length > 0 && log.every(l => sealed.isEnvelope(JSON.parse(l))));
  const backups = fs.readdirSync(path.join(DATA, 'backups'));
  check('backups are encrypted too', backups.length > 0 && backups.every(f => sealed.isEnvelope(JSON.parse(fs.readFileSync(path.join(DATA, 'backups', f), 'utf8')))));

  srv = start(3292, { ALLOW_UNVERIFIED_SIGNUP: 'true' });
  url = 'http://127.0.0.1:3292';
  try {
    await waitFor(url);
    const si = await post(url, '/api/signin', { email: 'test.advisor@bau.edu.lb', password: PASSWORDS.advisor });
    const cookie = (si.headers.get('set-cookie') || '').split(';')[0];
    const got = await (await post(url, '/api/get', { path: 'advisors/synthetic-cs-advisor/students/202599901' }, cookie)).json();
    check('the record comes back after a restart with the same key', got.data && got.data.name === 'Zelda Quentin Example');
  } finally { srv.kill(); await new Promise(r => setTimeout(r, 300)); }

  const before = fs.readFileSync(path.join(DATA, 'store.json'), 'utf8');
  const wrong = spawnSync(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, base, { PORT: '3293', STORE_KEY: crypto.randomBytes(32).toString('hex') }), timeout: 8000 });
  check('a wrong key stops the server', wrong.status === 1, 'exit ' + wrong.status);
  check('and leaves the store untouched', fs.readFileSync(path.join(DATA, 'store.json'), 'utf8') === before);

  const prodDir = DATA + '-prod';
  fs.rmSync(prodDir, { recursive: true, force: true });
  srv = start(3294, { NODE_ENV: 'production', DATA_DIR: prodDir, PUBLIC_URL: 'https://advising.example.test' });
  try {
    await waitFor('http://127.0.0.1:3294');
    check('production starts with encrypted file storage', true);
  } catch (e) { check('production starts with encrypted file storage', false, e.message); }
  finally { srv.kill(); }

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
