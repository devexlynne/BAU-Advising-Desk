/* Run with: npm run test:email
   The two emailed flows end to end, in a real browser, against a stand-in mail server:
     1. a superadmin invites someone, the invitation arrives, the link activates the account
     2. that person forgets the password, asks for a link, and sets a new one
   Synthetic people only. Mail bodies are base64 (see mail.js), so they are decoded here. */
'use strict';
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PASSWORDS, defaultStore } = require('./helpers/auth-fixture');
const { startServer, localOnly, signIn, apiFrom, reporter } = require('./helpers/e2e');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, '.test-data', 'email-e2e');
const MAIL = path.join(DIR, 'mail.txt');
const SMTP_PORT = 2561;
const NEW_EMAIL = 'synthetic.newhire@bau.edu.lb';       // not test.*: test addresses are never emailed
const FIRST = 'First-password-2026', SECOND = 'Second-password-2026';

// all text in a received message, with base64 parts decoded
function readMail() {
  if (!fs.existsSync(MAIL)) return '';
  const raw = fs.readFileSync(MAIL, 'utf8');
  const parts = raw.split(/\r\n--[^\r\n]+\r\n/);
  return raw + '\n' + parts.map(part => {
    if (!/Content-Transfer-Encoding: base64/i.test(part)) return '';
    const body = part.split(/\r\n\r\n/).slice(1).join('\r\n\r\n').replace(/[^A-Za-z0-9+/=]/g, '');
    return Buffer.from(body, 'base64').toString('utf8');
  }).join('\n');
}
async function waitForMail(pattern) {
  for (let i = 0; i < 50; i++) {
    const m = readMail().match(pattern);
    if (m) return m[0];
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
}

(async () => {
  const { step, done } = reporter();
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-keyout', path.join(DIR, 'key.pem'), '-out', path.join(DIR, 'cert.pem')], { stdio: 'ignore' });
  const smtp = spawn(process.execPath, [path.join(__dirname, 'fake-smtp.js'), String(SMTP_PORT), MAIL],
    { env: Object.assign({}, process.env, { SMTP_TEST_DIR: DIR }), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 400));

  const server = await startServer({
    port: 3162, dataDir: path.join(DIR, 'data'), store: defaultStore(),
    env: { SMTP_URL: 'smtp://desk:secret@127.0.0.1:' + SMTP_PORT, NODE_TLS_REJECT_UNAUTHORIZED: '0',
      MAIL_FROM: 'Advising Desk <no-reply@bau.edu.lb>' }
  });
  const base = server.base;
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    await localOnly(ctx);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const api = apiFrom(page);

    // ---- 1. invitation ----
    await signIn(page, base, 'test.superadmin@bau.edu.lb', PASSWORDS.admin);
    const inv = await api('/api/people/invite', {
      person: { slug: 'synthetic-newhire', email: NEW_EMAIL, name: 'Synthetic New Hire', title: 'Advisor' },
      roles: [{ role: 'advisor', scopes: ['cs'] }]
    });
    step('a superadmin can invite someone', inv.status === 200, JSON.stringify(inv.json));
    const verifyLink = await waitForMail(new RegExp(base.replace(/[.:/]/g, '\\$&') + '/\\?verify=[a-f0-9]{64}'));
    step('the invitation email arrives with a link', !!verifyLink);
    step('it is addressed to the new person', new RegExp('To: <' + NEW_EMAIL.replace(/\./g, '\\.') + '>').test(readMail()));
    step('the link uses PUBLIC_URL, not the request host', verifyLink && verifyLink.startsWith(base + '/'));
    await page.click('#signOut');
    await page.waitForSelector('#fEmail');

    await page.goto(verifyLink, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#vPass');
    await page.fill('#vPass', 'short'); await page.fill('#vPass2', 'short');
    await page.click('#verifyForm button[type=submit]');
    await page.waitForSelector('#gateErr:not([hidden])');
    step('a too-short password is refused', /10/.test(await page.locator('#gateErr').innerText()));
    await page.fill('#vPass', FIRST); await page.fill('#vPass2', FIRST);
    await page.click('#verifyForm button[type=submit]');
    await page.waitForFunction(() => !document.getElementById('app').hidden, null, { timeout: 10000 });
    step('the invitation link activates the account and signs in', true);
    step('the address bar no longer holds the token', !(await page.evaluate(() => location.search)).includes('verify='));
    const reuse = await fetch(base + '/api/verify', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: verifyLink.split('verify=')[1], password: 'Another-password-2026' }) });
    step('the invitation link works only once', reuse.status === 401 || reuse.status === 409, 'status ' + reuse.status);
    await page.click('#signOut');
    await page.waitForSelector('#fEmail');

    // ---- 2. forgotten password ----
    fs.rmSync(MAIL, { force: true });
    await page.fill('#fEmail', NEW_EMAIL);
    await page.click('[data-reset]');
    await page.waitForSelector('#resetRequestForm');
    step('the reset page keeps the typed address', await page.inputValue('#resetEmail') === NEW_EMAIL);
    await page.click('#resetRequestForm button[type=submit]');
    await page.waitForSelector('#mailSent:not([hidden])');
    step('the page says a link was sent if the account exists', /reset link was sent/.test(await page.locator('#mailSent').innerText()));
    const resetLink = await waitForMail(/http:\/\/127\.0\.0\.1:3162\/\?reset=[a-f0-9]{64}/);
    step('the reset email arrives with a one-time link', !!resetLink);

    await page.goto(resetLink, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#lPass');
    await page.fill('#lPass', SECOND); await page.fill('#lPass2', SECOND);
    await page.click('#linkForm button[type=submit]');
    await page.waitForFunction(() => !document.getElementById('app').hidden, null, { timeout: 10000 });
    step('the new password is set and the person is signed in', true);
    step('the address bar no longer holds the token', !(await page.evaluate(() => location.search)).includes('reset='));

    const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    step('the reset link works only once',
      (await post('/api/reset-with-link', { token: resetLink.split('reset=')[1], password: 'Third-password-2026' })).status === 401);
    step('the old password stops working', (await post('/api/signin', { email: NEW_EMAIL, password: FIRST })).status === 401);
    step('the new password works', (await post('/api/signin', { email: NEW_EMAIL, password: SECOND })).status === 200);

    fs.rmSync(MAIL, { force: true });
    const quiet = await post('/api/reset-request', { email: 'nobody.here@bau.edu.lb' });
    const quietBody = await quiet.json();
    step('asking about an unknown address gets the same answer', quiet.status === 200 && quietBody.ok === true);
    await new Promise(r => setTimeout(r, 500));
    step('and no mail is sent for it', !fs.existsSync(MAIL));

    step('no JavaScript errors on the page', errors.length === 0, errors.join(' | '));
  } catch (e) {
    step('the run finished', false, e.message + '\n' + server.log().slice(-2000));
  } finally {
    await browser.close();
    server.stop();
    smtp.kill();
    done();
  }
})();
