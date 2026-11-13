'use strict';
/* Shared helpers for the browser (Playwright) tests.
   - starts server.js on a seeded store and always stops it again, even when a step throws
   - signs a person in through the real sign-in form
   - counts PASS / FAIL and sets the exit code, so `npm run test:*` fails loudly instead of hanging */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { writeStore } = require('./auth-fixture');

const ROOT = path.join(__dirname, '..', '..');

async function startServer({ port, dataDir, store, env = {} }) {
  fs.rmSync(dataDir, { recursive: true, force: true });
  writeStore(dataDir, store);
  const base = 'http://127.0.0.1:' + port;
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(port), DATA_DIR: dataDir, ADMIN_SLUGS: '', PUBLIC_URL: base,
      ENABLE_STUDENT_IMPORTS: 'true', MAIL_FROM: '', SMTP_URL: '', MAIL_API_URL: '', MAIL_API_KEY: ''
    }, env),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  proc.stdout.on('data', c => { log += c; });
  proc.stderr.on('data', c => { log += c; });
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error('server exited early:\n' + log);
    try { if ((await fetch(base + '/health')).ok) break; } catch (e) { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  return { base, proc, log: () => log, stop: () => { try { proc.kill(); } catch (e) { /* gone */ } } };
}

function localOnly(context) {
  return context.route('**', route => {
    const u = route.request().url();
    return (u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1') || u.startsWith('data:'))
      ? route.continue() : route.abort();
  });
}

/* The gate opens on the staff directory; "Sign in with your BAU email" leads to the
   plain email form. Works on either screen, so tests do not depend on the directory. */
async function openEmailForm(page) {
  await page.waitForSelector('#fEmail, [data-dir-email]', { timeout: 10000 });
  if (!(await page.locator('#fEmail:not([readonly])').count())) {
    await page.locator('[data-dir-email]').first().click();
    await page.waitForSelector('#fEmail:not([readonly])', { timeout: 5000 });
  }
}

async function signIn(page, base, email, password) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await openEmailForm(page);
  await page.fill('#fEmail', email);
  await page.fill('#fPass', password);
  await page.click('#signForm button[type=submit]');
  await page.waitForFunction(() => !document.getElementById('app').hidden, null, { timeout: 10000 });
}

function apiFrom(page) {
  return (route, body) => page.evaluate(async ([r, b]) => {
    const res = await fetch(r, { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) });
    let json = null; try { json = await res.json(); } catch (e) { /* not json */ }
    return { status: res.status, json };
  }, [route, body]);
}

function reporter() {
  let failed = 0, passed = 0;
  const step = (name, ok, extra) => {
    if (ok) passed++; else failed++;
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' - ' + extra : ''));
  };
  const done = () => { console.log(`  ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0; };
  return { step, done };
}

module.exports = { openEmailForm, startServer, localOnly, signIn, apiFrom, reporter };
