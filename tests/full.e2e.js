/* One run through the whole portal, the way an advisor uses it, against a
   real server and a stand-in mail server.
   node tests/full.e2e.js   (after: node build.js) */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');

const PORT = 3190, SMTP = 2590;
const DATA = './.test-data/full';
const MAILBOX = './.test-data/full-mail.txt';

let pass = 0, fail = 0;
const step = (name, ok, extra) => {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
};

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.rmSync(MAILBOX, { force: true });
  const smtp = spawn('node', ['./tests/fake-smtp.js', String(SMTP), MAILBOX], { stdio: 'ignore' });
  const srv = spawn('node', ['./server.js'], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATA_DIR: DATA,
      SMTP_URL: 'smtp://desk:secret@127.0.0.1:' + SMTP,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      MAIL_FROM: 'Advising Desk <no-reply@bau.edu.lb>',
      PUBLIC_URL: 'http://localhost:' + PORT,
      IDEAS_TO: 'l.arwadi@bau.edu.lb',
      ADMIN_TOKEN: 'test-admin'
    }), stdio: 'ignore'
  });
  await new Promise(r => setTimeout(r, 1000));
  const base = 'http://localhost:' + PORT;

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext();
  await ctx.route('**', r => {
    const u = r.request().url();
    return (u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1')) ? r.continue() : r.abort();
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('JS: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errs.push('console: ' + m.text()); });

  // ── signing up and in ────────────────────────────────────────────────────
  await p.goto(base, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  step('the cover photo is on the sign-in page', (await p.locator('.cover img').first().getAttribute('src') || '').startsWith('data:image'));
  /* Was hardcoded to eight and went stale the moment a ninth advisor was
     added to data/faculty.json. Count from the data instead. */
  const facultyCount = require('../data/faculty.json').length;
  step('every doctor on the department list is offered',
    await p.locator('[data-pick]').count() === facultyCount,
    'expected ' + facultyCount);

  await p.click('[data-pick="julie-bu-daher"]'); await p.waitForTimeout(400);
  await p.fill('#fPass', 'advising2026!'); await p.fill('#fPass2', 'advising2026!');
  await p.click('#signForm button[type=submit]'); await p.waitForTimeout(1000);
  step('a new account opens without a recovery-code screen',
    await p.locator('[data-gostart]').count() === 0 && await p.evaluate(() => !document.getElementById('app').hidden));
  await p.waitForTimeout(800);
  step('signed in and the students arrived', (await p.locator('.who-row').count()) > 0,
    (await p.locator('.who-row').count()) + ' rows');
  step('the sign-in note no longer calls it a pilot',
    !(await p.content()).includes('pilot sign-in'));

  // ── the day's list ───────────────────────────────────────────────────────
  const urgentHead = await p.locator('.ghead .gt.urgent').count();
  step('the list is grouped into urgent and the rest', urgentHead === 1);

  // ── a student ────────────────────────────────────────────────────────────
  await p.locator('.who-row').first().click(); await p.waitForTimeout(700);
  step('a student page opens with the tabs', await p.locator('[data-tab="plan"]').count() === 1);
  for (const tab of ['term', 'plan', 'chain', 'sheet', 'transcript', 'progress']) {
    await p.click('[data-tab="' + tab + '"]'); await p.waitForTimeout(350);
    const bodyLen = (await p.locator('#view').innerText()).length;
    step('the ' + tab + ' tab draws', bodyLen > 200, bodyLen + ' characters');
  }

  // ── a note, and that it survives a reload ────────────────────────────────
  await p.fill('#noteText', 'Ask the registrar about the withdrawal.');
  await p.check('#noteFlag');
  await p.click('[data-note-save]'); await p.waitForTimeout(900);
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1800);
  step('the session and the note survive a reload',
    (await p.locator('text=Marked by you').count()) > 0);

  // ── the suggestions board ────────────────────────────────────────────────
  await p.click('[data-view="ideas"]'); await p.waitForTimeout(500);
  await p.fill('#ideaText', 'Please show which students have not replied to my email.');
  await p.click('[data-idea-save]'); await p.waitForTimeout(1600);
  step('the suggestion is on the board', (await p.locator('.alist .al').count()) === 1);
  const mailText = fs.existsSync(MAILBOX) ? fs.readFileSync(MAILBOX, 'utf8') : '';
  step('and was emailed to l.arwadi@bau.edu.lb', /To: <l\.arwadi@bau\.edu\.lb>/.test(mailText),
    (mailText.match(/To: .*/) || ['(nothing sent)'])[0]);
  step('the email carries the text and the author',
    /have not replied to my email/.test(mailText) && /Julie Bu Daher/.test(mailText));

  // ── asking a question ────────────────────────────────────────────────────
  await p.click('[data-view="ask"]'); await p.waitForTimeout(400);
  await p.fill('#askBox', 'who is not registered');
  await p.click('#askGo'); await p.waitForTimeout(600);
  step('the assistant answers from the records',
    (await p.locator('.msg.bot').last().innerText()).length > 40);

  // ── the import page ──────────────────────────────────────────────────────
  await p.click('[data-view="import"]'); await p.waitForTimeout(400);
  const importText = await p.locator('#view').innerText();
  step('advisor import offers transcripts and schedules, but not the shared offering',
    /Transcripts/.test(importText) && /Schedules/.test(importText) && !/Course offering/.test(importText));
  step('the cover photo section is gone', !/Cover photo/.test(importText));

  // ── the account panel ────────────────────────────────────────────────────
  await p.click('[data-account]'); await p.waitForTimeout(500);
  step('the account panel offers a password change and a backup',
    (await p.locator('#pwForm').count()) === 1 && (await p.locator('[data-export="json"]').count()) === 1);
  await p.fill('#pwOld', 'advising2026!');
  await p.fill('#pwNew', 'secondpassword1'); await p.fill('#pwNew2', 'secondpassword1');
  await p.click('#pwForm button[type=submit]'); await p.waitForTimeout(1200);
  step('the password changes', (await p.locator('.okmsg').count()) > 0);
  await p.click('[data-close]'); await p.waitForTimeout(300);

  // ── privacy between advisors ─────────────────────────────────────────────
  const leak = await p.evaluate(async () => {
    const r = await fetch('/api/list', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'advisors/ali-el-zaart/students' }) });
    return r.status;
  });
  step('another advisor\'s students are refused', leak === 403, 'status ' + leak);

  // ── signing out, and back in with the new password ───────────────────────
  await p.click('#signOut'); await p.waitForTimeout(800);
  await p.click('[data-pick="julie-bu-daher"]'); await p.waitForTimeout(400);
  await p.fill('#fPass', 'advising2026!');
  await p.click('#signForm button[type=submit]'); await p.waitForTimeout(900);
  step('the old password no longer works', !(await p.locator('#gateErr').isHidden()));
  await p.fill('#fPass', 'secondpassword1');
  await p.click('#signForm button[type=submit]'); await p.waitForTimeout(1600);
  step('the new one does', await p.evaluate(() => !document.getElementById('app').hidden));

  console.log(errs.length ? '\nJS ERRORS:\n' + errs.join('\n') : '\nno JS errors');
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  await b.close(); srv.kill(); smtp.kill();
  process.exit(fail ? 1 : 0);
})();
