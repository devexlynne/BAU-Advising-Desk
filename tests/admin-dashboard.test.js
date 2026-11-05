'use strict';

/* Superadmin dashboard, the advisor-only correction, read-only mode and the
   hardening added with them (reset links, storage keys, size caps). */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PASSWORDS, account, person, defaultStore, writeStore } = require('./helpers/auth-fixture');

const ROOT = path.join(__dirname, '..');
const PORT = 3207;
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = path.join(ROOT, '.test-data', 'admin-dashboard');
const DESK = 'desk.superadmin@example.com';
const DESK_PASS = 'Synthetic-desk-pass-2026';
const JULIE_PASS = 'Synthetic-julie-pass-2026';

const post = (route, body, cookie) => fetch(BASE + route, {
  method: 'POST',
  headers: Object.assign({ 'content-type': 'application/json' }, cookie ? { cookie } : {}),
  body: JSON.stringify(body || {})
});
const signIn = async (email, password) => {
  const r = await post('/api/signin', { email, password });
  assert.strictEqual(r.status, 200, 'sign-in for ' + email + ' failed: ' + r.status);
  return /sid=[a-f0-9]+/.exec(r.headers.get('set-cookie'))[0];
};

async function waitForServer(server) {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('test server exited before becoming ready');
    try { if ((await fetch(BASE + '/health')).ok) return; } catch (e) { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('test server did not start');
}

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAILED  ' + name + '\n     ' + e.message); }
}

async function run() {
  fs.rmSync(DATA, { recursive: true, force: true });
  const store = defaultStore();
  // the advisor who had also been made superadmin
  store['people/julie-test'] = person('julie-test', 'julie.test@bau.edu.lb',
    [{ role: 'superadmin', scopes: ['bau'] }, { role: 'advisor', scopes: ['cs'] }]);
  store['advisors/julie-test/account'] = account('julie-test', 'julie.test@bau.edu.lb', JULIE_PASS);
  store['advisors/julie-test/students/999900002'] = { id: '999900002', name: 'Synthetic Advisee', history: [] };
  // the dedicated superadmin account already set up
  store['people/system-admin'] = person('system-admin', DESK, [{ role: 'superadmin', scopes: ['bau'] }], { name: 'Superadmin' });
  store['advisors/system-admin/account'] = account('system-admin', DESK, DESK_PASS);
  // a business faculty admin who also advises in CS (works outside the business admin's scope)
  store['people/two-hats'] = person('two-hats', 'two.hats@bau.edu.lb',
    [{ role: 'advisor', scopes: ['cs'] }, { role: 'advisor', scopes: ['bba-accounting'] }]);
  store['advisors/two-hats/account'] = account('two-hats', 'two.hats@bau.edu.lb', 'Synthetic-two-hats-2026');
  writeStore(DATA, store);

  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATA_DIR: DATA, ALLOW_UNVERIFIED_SIGNUP: 'true', ENABLE_STUDENT_IMPORTS: 'true',
      SMTP_URL: '', MAIL_API_URL: '', MAIL_API_KEY: '', PUBLIC_URL: BASE, ADMIN_SLUGS: '',
      SUPERADMIN_EMAIL: DESK, ADVISOR_ONLY_EMAILS: 'julie.test@bau.edu.lb', API_PER_MINUTE: '100000'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  server.stdout.on('data', c => { output += c; });
  server.stderr.on('data', c => { output += c; });

  try {
    await waitForServer(server);
    const desk = await signIn(DESK, DESK_PASS);
    const julie = await signIn('julie.test@bau.edu.lb', JULIE_PASS);
    const advisor = await signIn('test.advisor@bau.edu.lb', PASSWORDS.advisor);
    const business = await signIn('test.business.admin@bau.edu.lb', PASSWORDS.business);

    console.log('\n--- the advisor-only correction ---');
    await check('the listed advisor is no longer a superadmin', async () => {
      const s = await (await fetch(BASE + '/api/session', { headers: { cookie: julie } })).json();
      assert.strictEqual(s.admin, false);
      const list = await (await post('/api/people/list', {}, desk)).json();
      const j = list.people.find(p => p.slug === 'julie-test');
      assert.deepStrictEqual(j.roles, [{ role: 'advisor', scopes: ['cs'] }]);
    });
    await check('she keeps her own students', async () => {
      const r = await (await post('/api/list', { path: 'advisors/julie-test/students' }, julie)).json();
      assert.ok(r.data['999900002']);
    });
    await check('she cannot open the admin dashboard', async () => {
      assert.strictEqual((await post('/api/admin/overview', {}, julie)).status, 403);
    });
    await check('the correction runs once and is logged', async () => {
      assert.ok(/advisor only from now on: julie-test/.test(output), output);
      const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'store.json'), 'utf8'));
      assert.ok(saved._seeds['advisor-only-2026-11']);
    });

    console.log('\n--- the dashboard ---');
    await check('a superadmin gets the overview', async () => {
      const r = await post('/api/admin/overview', {}, desk);
      assert.strictEqual(r.status, 200);
      const d = await r.json();
      assert.ok(d.people.total >= 6 && d.students.total >= 1);
      assert.ok(d.structure.list.some(p => p.id === 'cs' && p.advisors >= 1));
      assert.ok(d.security.activeSessions >= 4);
      assert.ok(!JSON.stringify(d).includes('"hash"'), 'no password hashes in the overview');
    });
    await check('advisors and faculty admins are refused', async () => {
      assert.strictEqual((await post('/api/admin/overview', {}, advisor)).status, 403);
      assert.strictEqual((await post('/api/admin/activity', {}, business)).status, 403);
      assert.strictEqual((await post('/api/admin/settings', { readOnly: true }, business)).status, 403);
    });
    await check('activity lists sign-ins without record contents', async () => {
      const d = await (await post('/api/admin/activity', { action: 'signin' }, desk)).json();
      assert.ok(d.events.length >= 4 && d.events.every(e => e.action === 'signin'));
    });
    await check('a person can be signed out everywhere', async () => {
      const r = await (await post('/api/admin/sessions/end', { slug: 'synthetic-cs-advisor' }, desk)).json();
      assert.strictEqual(r.ended, 1);
      assert.strictEqual((await post('/api/accounts', {}, advisor)).status, 401);
    });

    console.log('\n--- read-only mode and the banner ---');
    await check('read-only blocks changes for everyone but superadmins', async () => {
      await post('/api/admin/settings', { readOnly: true, banner: 'Registration opens Monday' }, desk);
      const s = await (await fetch(BASE + '/api/session', { headers: { cookie: julie } })).json();
      assert.strictEqual(s.readOnly, true);
      assert.strictEqual(s.banner, 'Registration opens Monday');
      const r = await post('/api/set', { path: 'advisors/julie-test/settings', value: { a: 1 } }, julie);
      assert.strictEqual(r.status, 423);
      const ok = await post('/api/set', { path: 'advisors/system-admin/settings', value: { a: 1 } }, desk);
      assert.strictEqual(ok.status, 200);
      await post('/api/admin/settings', { readOnly: false, banner: '' }, desk);
      assert.strictEqual((await post('/api/set', { path: 'advisors/julie-test/settings', value: { a: 1 } }, julie)).status, 200);
    });

    console.log('\n--- hardening ---');
    await check('an advisor cannot create arbitrary keys under their name', async () => {
      const r = await post('/api/set', { path: 'advisors/julie-test/anything', value: { a: 1 } }, julie);
      assert.strictEqual(r.status, 403);
    });
    await check('oversized settings are refused', async () => {
      const r = await post('/api/set', { path: 'advisors/julie-test/settings', value: { pad: 'x'.repeat(600 * 1024) } }, julie);
      assert.strictEqual(r.status, 413);
    });
    await check('a faculty admin cannot take over someone who also works elsewhere', async () => {
      assert.strictEqual((await post('/api/admin/reset-link', { slug: 'two-hats' }, business)).status, 403);
      assert.strictEqual((await post('/api/admin/clear-password', { slug: 'two-hats' }, business)).status, 403);
    });
    await check('requests that never finish their headers are cut off', async () => {
      const net = require('net');
      const closed = await new Promise(resolve => {
        const sock = net.connect(PORT, '127.0.0.1', () => sock.write('GET / HTTP/1.1\r\nHost: x\r\n'));
        sock.on('data', d => { if (/^HTTP\/1\.1 408/.test(String(d))) resolve(true); });
        sock.on('close', () => resolve(true));
        setTimeout(() => { sock.destroy(); resolve(false); }, 40000);
      });
      assert.ok(closed);
    });
  } finally {
    server.kill('SIGTERM');
  }
  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log(output); process.exit(1); }
}

run().catch(e => { console.error(e); process.exit(1); });
