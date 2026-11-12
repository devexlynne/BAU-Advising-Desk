/* Run with: npm run test:full   (after: node build.js)
   One run through the portal the way an advisor uses it: sign in, the day's list,
   a student's tabs, a note that survives a reload, a suggestion that is emailed,
   the rule-based guide, the import page, a password change, and sign-in again.
   Synthetic people; the students are the demo set (99xxx IDs). */
'use strict';
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PASSWORDS, defaultStore } = require('./helpers/auth-fixture');
const { startServer, localOnly, signIn, apiFrom, reporter } = require('./helpers/e2e');

const DIR = path.join(__dirname, '..', '.test-data', 'full-e2e');
const MAIL = path.join(DIR, 'mail.txt');
const SMTP_PORT = 2591;
const NEW_PASS = 'Changed-password-2026';

function readMail() {
  if (!fs.existsSync(MAIL)) return '';
  const raw = fs.readFileSync(MAIL, 'utf8');
  return raw + '\n' + raw.split(/\r\n--[^\r\n]+\r\n/).map(part => /Content-Transfer-Encoding: base64/i.test(part)
    ? Buffer.from(part.split(/\r\n\r\n/).slice(1).join('').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64').toString('utf8') : '').join('\n');
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

  const store = defaultStore();
  const demo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'demo', 'students.json'), 'utf8')).students;
  demo.forEach(s => { store['advisors/synthetic-cs-advisor/students/' + s.id] = Object.assign({}, s, { advisor: 'synthetic-cs-advisor' }); });

  const server = await startServer({
    port: 3191, dataDir: path.join(DIR, 'data'), store,
    env: { SMTP_URL: 'smtp://desk:secret@127.0.0.1:' + SMTP_PORT, NODE_TLS_REJECT_UNAUTHORIZED: '0',
      MAIL_FROM: 'Advising Desk <no-reply@bau.edu.lb>', IDEAS_TO: 'test.ideas@bau.edu.lb' }
  });
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    await localOnly(ctx);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push('JS: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errs.push('console: ' + m.text()); });
    const api = apiFrom(p);

    // ---- sign in and the day's list ----
    await signIn(p, server.base, 'test.advisor@bau.edu.lb', PASSWORDS.advisor);
    await p.waitForSelector('.srow', { timeout: 10000 });
    const rows = await p.locator('.srow').count();
    step('signed in and all 32 demo students are listed', rows === 32, rows + ' rows');
    step('the filters show the counts', /Needs attention\s*\d+/.test(await p.locator('#view').innerText()));

    // ---- a student ----
    await p.locator('.srow').first().click();
    await p.waitForSelector('[data-tab="plan"]');
    for (const tab of ['progress', 'term', 'plan', 'roadmap', 'chain', 'sheet', 'transcript']) {
      await p.click('[data-tab="' + tab + '"]');
      await p.waitForTimeout(250);
      const len = (await p.locator('#view').innerText()).length;
      step('the ' + tab + ' tab draws', len > 200, len + ' characters');
    }

    // ---- save a term plan, override a blocked check with a reason ----
    await p.click('[data-tab="plan"]');
    const addCount = await p.locator('.pick [data-toggle]').count();
    for (let i = 0; i < addCount; i++) { await p.locator('.pick [data-toggle]').nth(i).click(); await p.waitForTimeout(30); }
    step('an over-limit plan shows a blocked check that can be overridden', await p.locator('[data-override]').count() > 0);
    await p.locator('[data-override]').first().click();
    await p.waitForSelector('#ovReason');
    await p.fill('#ovReason', 'short');
    await p.click('[data-override-save]');
    step('a reason that is too short is refused in the dialog', await p.locator('#ovErr:not([hidden])').count() === 1);
    await p.fill('#ovReason', 'Graduating this year, approved by the dean in writing.');
    await p.click('[data-override-save]');
    await p.waitForSelector('.chk.overridden', { timeout: 5000 }).catch(() => {});
    step('the check now shows as overridden with the reason', /approved by the dean/.test(await p.locator('.chk.overridden').first().innerText().catch(() => '')));
    step('the plan reads as saved', /^Saved /.test(await p.locator('.plan-actions .note').innerText()));
    const studentId = await p.locator('[data-plan-print]').getAttribute('data-plan-print');
    const savedRec = await api('/api/get', { path: 'advisors/synthetic-cs-advisor/students/' + studentId });
    step('the plan is on the student record', savedRec.json.data.plan && savedRec.json.data.plan.courses.length === addCount
      && savedRec.json.data.plan.overrides[0].by === 'synthetic-cs-advisor');
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !document.getElementById('app').hidden, null, { timeout: 10000 });
    await p.click('[data-view="students"]');
    await p.click('[data-open="' + studentId + '"]');
    await p.click('[data-tab="plan"]');
    await p.waitForTimeout(300);
    step('after a reload the saved plan comes back', await p.locator('.basket .bitem').count() === addCount
      && await p.locator('.chk.overridden').count() > 0);

    // ---- a note survives a reload ----
    await p.click('[data-tab="progress"]');
    if (await p.locator('#noteText').count()) {
      await p.fill('#noteText', 'Ask the registrar about the withdrawal.');
      if (await p.locator('#noteFlag').count()) await p.check('#noteFlag');
      await p.click('[data-note-save]');
      await p.waitForTimeout(800);
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => !document.getElementById('app').hidden, null, { timeout: 10000 });
      const opened = await p.locator('#noteText').count() ? await p.inputValue('#noteText') : '';
      const stored = await api('/api/list', { path: 'advisors/synthetic-cs-advisor/students' });
      const anyNote = Object.values((stored.json || {}).data || {}).some(s => s && s.note && /registrar/.test(s.note.text || ''));
      step('the session and the note survive a reload', /registrar/.test(opened) || anyNote);
    } else step('the note box is on the student page', false);

    // ---- suggestions board, emailed ----
    const idea = await api('/api/idea', { text: 'Please show which students have not replied to my email.' });
    step('a suggestion is accepted', idea.status === 200, JSON.stringify(idea.json));
    let mailText = '';
    for (let i = 0; i < 30 && !/not replied/.test(mailText); i++) { await p.waitForTimeout(100); mailText = readMail(); }
    step('and emailed to the configured recipient', /To: <test\.ideas@bau\.edu\.lb>/.test(mailText));
    step('the email carries the text', /have not replied to my email/.test(mailText));

    // ---- the guide ----
    await p.click('[data-view="ask"]');
    await p.waitForSelector('#askBox');
    await p.fill('#askBox', 'who is not registered');
    await p.click('#askGo');
    await p.waitForTimeout(600);
    step('the rule-based guide answers from the records', (await p.locator('.msg.bot').last().innerText()).length > 40);

    // ---- import page ----
    await p.click('[data-view="import"]');
    await p.waitForTimeout(400);
    const importText = await p.locator('#view').innerText();
    step('the import page offers transcripts and schedules', /Transcripts/i.test(importText) && /Schedules/i.test(importText));

    // ---- account panel and password change ----
    await p.click('[data-account]');
    await p.waitForSelector('#pwForm');
    await p.fill('#pwOld', PASSWORDS.advisor);
    await p.fill('#pwNew', NEW_PASS); await p.fill('#pwNew2', NEW_PASS);
    await p.click('#pwForm button[type=submit]');
    await p.waitForSelector('.okmsg', { timeout: 5000 }).catch(() => {});
    step('the password changes', await p.locator('.okmsg').count() > 0);
    await p.waitForSelector('.sess-list li', { timeout: 5000 }).catch(() => {});
    step('the account panel lists where you are signed in', /this browser/.test(await p.locator('#sessBox').innerText()));
    await p.locator('#dlg [data-close]').last().click().catch(() => {});

    // ---- an out-of-scope read is refused ----
    const leak = await api('/api/list', { path: 'advisors/synthetic-business-editor/students' });
    step('a list outside your scope is refused', leak.status === 403, 'status ' + leak.status);

    // ---- sign out, old password refused, new one works ----
    await p.click('#signOut');
    await p.waitForSelector('#fEmail');
    await p.fill('#fEmail', 'test.advisor@bau.edu.lb');
    await p.fill('#fPass', PASSWORDS.advisor);
    await p.click('#signForm button[type=submit]');
    await p.waitForSelector('#gateErr:not([hidden])');
    step('the old password no longer works', true);
    await p.fill('#fPass', NEW_PASS);
    await p.click('#signForm button[type=submit]');
    await p.waitForFunction(() => !document.getElementById('app').hidden, null, { timeout: 10000 });
    step('the new one does', true);

    // ---- superadmin: activity log and backups ----
    const ctx2 = await browser.newContext();
    await localOnly(ctx2);
    const a = await ctx2.newPage();
    a.on('pageerror', e => errs.push('JS (admin): ' + e.message));
    await signIn(a, server.base, 'test.superadmin@bau.edu.lb', PASSWORDS.admin);
    await a.click('[data-view="activity"]');
    await a.waitForSelector('table.t.act', { timeout: 8000 });
    const actText = await a.locator('#view').innerText();
    step('the superadmin sees the activity log', /Overrode a registration check/.test(actText) && /Signed in/.test(actText));
    step('and the backup status', /Newest backup/.test(actText) && /Last taken off the server/.test(actText));
    await a.selectOption('#actAction', 'block-overridden');
    await a.click('[data-act-filter]');
    await a.waitForTimeout(500);
    step('filtering by action leaves only that action', await a.locator('table.t.act tbody tr').count() === 1);

    step('no JavaScript errors', errs.length === 0, errs.join(' | '));
  } catch (e) {
    step('the run finished', false, e.message + '\n' + server.log().slice(-1500));
  } finally {
    await browser.close();
    server.stop();
    smtp.kill();
    done();
  }
})();
