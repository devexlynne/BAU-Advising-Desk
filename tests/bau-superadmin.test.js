'use strict';
/* The hand-over to the BAU Superadmin account: the account is named
   "BAU Superadmin", and the retired department admin is deactivated (records
   kept, sessions ended), but only once that account can sign in. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { account, person, defaultStore, writeStore } = require('./helpers/auth-fixture');

const ROOT = path.join(__dirname, '..');
const DESK = 'desk.superadmin@example.com';
const OLD = 'old.admin@bau.edu.lb';
let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAILED  ' + name + '\n     ' + e.message); }
}
async function startOnce(dir, port) {
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dir, SMTP_URL: '', MAIL_API_URL: '', MAIL_API_KEY: '',
      ADMIN_SLUGS: '', SUPERADMIN_EMAIL: DESK, RETIRE_STAFF_EMAILS: OLD, STORE_KEY: '' })
  });
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('server exited');
    try { if ((await fetch('http://127.0.0.1:' + port + '/health')).ok) break; } catch (e) { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  await new Promise(r => setTimeout(r, 300));
  server.kill(); await new Promise(r => server.once('exit', r));
  return JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8'));
}
function fixture(dir, withPassword) {
  fs.rmSync(dir, { recursive: true, force: true });
  const s = defaultStore();
  s['people/system-admin'] = person('system-admin', DESK, [{ role: 'superadmin', scopes: ['bau'] }], { name: 'Superadmin' });
  if (withPassword) s['advisors/system-admin/account'] = account('system-admin', DESK, 'Synthetic-desk-pass-2026');
  s['people/old-admin'] = person('old-admin', OLD, [{ role: 'superadmin', scopes: ['bau'] }], { name: 'Old Admin' });
  s['advisors/old-admin/account'] = account('old-admin', OLD, 'Synthetic-old-pass-2026');
  s._sessions = { abc: { slug: 'old-admin', at: Date.now() } };
  writeStore(dir, s);
}

(async () => {
  console.log('\n--- BAU Superadmin hand-over ---');
  const dir1 = path.join(ROOT, '.test-data', 'bau-superadmin-1');
  fixture(dir1, true);
  const after = await startOnce(dir1, 3231);
  await check('the superadmin account is named BAU Superadmin', () => {
    assert.strictEqual(after['people/system-admin'].name, 'BAU Superadmin');
  });
  await check('the retired admin is deactivated, keeps the record, and loses every session', () => {
    assert.strictEqual(after['people/old-admin'].active, false);
    assert.ok(after['advisors/old-admin/account'], 'account record kept');
    assert.ok(!Object.values(after._sessions || {}).some(x => x && x.slug === 'old-admin'));
  });
  await check('it happens once: a later reactivation is not undone', async () => {
    after['people/old-admin'].active = true;
    fs.writeFileSync(path.join(dir1, 'store.json'), JSON.stringify(after));
    const again = await startOnce(dir1, 3232);
    assert.strictEqual(again['people/old-admin'].active, true);
  });
  const dir2 = path.join(ROOT, '.test-data', 'bau-superadmin-2');
  fixture(dir2, false);
  const waiting = await startOnce(dir2, 3233);
  await check('nobody is deactivated while BAU Superadmin has no password yet', () => {
    assert.notStrictEqual(waiting['people/old-admin'].active, false);
    assert.strictEqual(waiting['people/system-admin'].name, 'BAU Superadmin');
  });
  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
