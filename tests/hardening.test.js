'use strict';
/* Checks for the November 2026 hardening pass (see docs/IMPROVEMENTS_REPORT.md).
   Synthetic people and data only. */

const assert = require('assert');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { PASSWORDS, defaultStore, writeStore } = require('./helpers/auth-fixture');
const Passwords = require('../server/passwords');
const { parseJsonSafe } = require('../server/http-guards');
const mail = require('../mail');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, '.test-data', 'hardening');
const PORT = 3281;
const BASE = 'http://127.0.0.1:' + PORT;
let passed = 0, failed = 0;
const check = (name, ok, extra) => {
  if (ok) passed++; else failed++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? ' - ' + extra : ''));
};
const post = (route, body, cookie) => fetch(BASE + route, {
  method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, cookie ? { cookie } : {}),
  body: typeof body === 'string' ? body : JSON.stringify(body)
});
const readStore = () => JSON.parse(fs.readFileSync(path.join(DATA, 'store.json'), 'utf8'));

async function waitFor(proc) {
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error('server exited');
    try { if ((await fetch(BASE + '/health')).ok) return; } catch (e) { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

(async () => {
  // ---- password module ----
  const fresh = await Passwords.freshHash('a-new-password-2026');
  check('new hashes use 600,000 PBKDF2 iterations', fresh.iter === 600000 && Passwords.ITERATIONS === 600000);
  check('new hashes get a fresh 16-byte salt', /^[0-9a-f]{32}$/.test(fresh.salt));
  check('an account without iter is treated as the old 310,000', Passwords.iterationsOf({}) === 310000);
  check('old accounts need a re-hash, new ones do not', Passwords.needsRehash({}) && !Passwords.needsRehash(fresh));
  check('verify works for the new format', await Passwords.verify(fresh, 'a-new-password-2026')
    && !(await Passwords.verify(fresh, 'wrong-password-2026')));
  check('verify of a missing account is false', (await Passwords.verify(null, 'x')) === false);

  // ---- JSON guard ----
  const refuses = t => { try { parseJsonSafe(t); return false; } catch (e) { return e.code === 'FORBIDDEN_KEY'; } };
  check('a body with __proto__ is refused', refuses('{"a":1,"__proto__":{"x":1}}'));
  check('a nested constructor key is refused', refuses('{"value":{"deep":[{"constructor":{"prototype":{}}}]}}'));
  check('a normal body still parses', parseJsonSafe('{"a":[1,{"b":"c"}]}').a[1].b === 'c');

  // ---- mail encoding ----
  const msg = mail._message('x@bau.edu.lb', 'Meeting with أحمد الخطيب', 'line one\n.\nline three', null, null);
  const subjectLines = msg.split('\r\n').filter((l, i, a) => l.startsWith('Subject:') || (l.startsWith(' =?') && i > 0));
  const decoded = subjectLines.join('').replace(/^Subject: /, '').split(/\s+/)
    .map(w => Buffer.from(w.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString('utf8')).join('');
  check('an Arabic subject is RFC 2047 encoded and decodes back', /=\?UTF-8\?B\?/.test(msg) && decoded.includes('أحمد'));
  check('no header or body line is longer than 78 characters', Math.max(...msg.split('\r\n').map(l => l.length)) <= 78);
  check('mail headers stay 7-bit', !/[^\x00-\x7f]/.test(msg));

  // ---- production needs PUBLIC_URL ----
  const prodDir = DATA + '-prod';
  fs.rmSync(prodDir, { recursive: true, force: true });
  const noUrl = spawnSync(process.execPath, ['server.js'], {
    cwd: ROOT, timeout: 8000,
    env: Object.assign({}, process.env, { NODE_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: '', RAILWAY_SERVICE_ID: '',
      DATABASE_URL: '', STORE_KEY: crypto.randomBytes(32).toString('hex'), DATA_DIR: prodDir, PUBLIC_URL: '' })
  });
  check('production refuses to start without PUBLIC_URL', noUrl.status === 1 && /PUBLIC_URL/.test(String(noUrl.stderr)),
    'exit ' + noUrl.status);
  const httpUrl = spawnSync(process.execPath, ['server.js'], {
    cwd: ROOT, timeout: 8000,
    env: Object.assign({}, process.env, { NODE_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: '', RAILWAY_SERVICE_ID: '',
      DATABASE_URL: '', STORE_KEY: crypto.randomBytes(32).toString('hex'), DATA_DIR: prodDir, PUBLIC_URL: 'http://advising.example.test' })
  });
  check('production refuses a PUBLIC_URL that is not https', httpUrl.status === 1, 'exit ' + httpUrl.status);

  // ---- running server: re-hash on sign-in, body guard, header timeout ----
  fs.rmSync(DATA, { recursive: true, force: true });
  writeStore(DATA, defaultStore());
  const before = readStore()['advisors/synthetic-cs-advisor/account'];
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DATA, ADMIN_SLUGS: '', PUBLIC_URL: BASE,
      ENABLE_STUDENT_IMPORTS: 'true', HEADERS_TIMEOUT_MS: '1500', MAIL_FROM: '', SMTP_URL: '', MAIL_API_URL: '' })
  });
  try {
    await waitFor(srv);
    const r1 = await post('/api/signin', { email: 'test.advisor@bau.edu.lb', password: PASSWORDS.advisor });
    check('an account hashed at 310,000 still signs in', r1.status === 200, 'status ' + r1.status);
    await new Promise(r => setTimeout(r, 400));
    const after = readStore()['advisors/synthetic-cs-advisor/account'];
    check('and is quietly re-hashed at 600,000 with a new salt',
      after.iter === 600000 && after.salt !== before.salt && after.hash !== before.hash);
    const r2 = await post('/api/signin', { email: 'test.advisor@bau.edu.lb', password: PASSWORDS.advisor });
    check('the upgraded account signs in again', r2.status === 200, 'status ' + r2.status);
    const audit = fs.readFileSync(path.join(DATA, 'audit.log'), 'utf8');
    check('the upgrade is in the audit log without the password', /password-rehashed/.test(audit) && !audit.includes(PASSWORDS.advisor));

    const cookie = (r2.headers.get('set-cookie') || '').split(';')[0];
    const polluted = await post('/api/set', '{"path":"advisors/synthetic-cs-advisor/students/999900011","value":{"id":"999900011","__proto__":{"admin":true}}}', cookie);
    check('the server refuses a body with __proto__', polluted.status === 400, 'status ' + polluted.status);
    check('nothing was written for it', !readStore()['advisors/synthetic-cs-advisor/students/999900011']);

    const closedIn = await new Promise(resolve => {
      const t0 = Date.now();
      const sock = net.connect(PORT, '127.0.0.1', () => sock.write('GET / HTTP/1.1\r\nHost: x\r\n'));   // never finishes the headers
      sock.on('close', () => resolve(Date.now() - t0));
      sock.on('error', e => { if (process.env.DEBUG_HT) console.log('sock error', e.code); });
      sock.on('data', d => { if (process.env.DEBUG_HT) console.log('sock data', String(d).split('\r\n')[0]); });
      setTimeout(() => { sock.destroy(); resolve(-1); }, 9000);
    });
    check('a client that never finishes its headers is dropped', closedIn > 0 && closedIn < 8000, closedIn + ' ms');
  } finally {
    srv.kill();
  }
  console.log(`  ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
