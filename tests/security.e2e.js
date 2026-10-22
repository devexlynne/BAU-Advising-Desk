/* Run with: node tests/security.e2e.js  (needs the built page: node build.js)
   A real browser against a real server, checking what is protected. */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');

(async () => {
  fs.rmSync('./.test-data/security', { recursive: true, force: true });
  const srv = spawn('node', ['./server.js'], {
    env: Object.assign({}, process.env, { PORT: '3170', DATA_DIR: './.test-data/security', ALLOW_UNVERIFIED_SIGNUP: 'true' }),
    stdio: 'inherit'
  });
  await new Promise(r => setTimeout(r, 900));
  const base = 'http://localhost:3170';
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext();
  await ctx.route('**', route => {
    const u = route.request().url();
    return (u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1')) ? route.continue() : route.abort();
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push('JS: ' + e.message));

  const step = (name, ok, extra) => console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));

  // nothing readable before signing in
  const pre = await fetch(base + '/api/get', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'advisors/julie-bu-daher/students' }) });
  step('records refused before sign-in', pre.status === 401, 'status ' + pre.status);

  await p.goto(base, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.click('[data-pick="julie-bu-daher"]'); await p.waitForTimeout(300);

  // short password refused by the server
  await p.fill('#fPass', 'short12'); await p.fill('#fPass2', 'short12');
  await p.click('#signForm button[type=submit]'); await p.waitForTimeout(400);
  step('short password refused', !(await p.locator('#gateErr').isHidden()));

  await p.fill('#fPass', 'advising2026!'); await p.fill('#fPass2', 'advising2026!');
  await p.click('#signForm button[type=submit]'); await p.waitForTimeout(900);
  step('signed in', await p.evaluate(() => !document.getElementById('app').hidden));

  // the password never reached the store file
  const raw = fs.readFileSync('./.test-data/security/store.json', 'utf8');
  step('password not stored anywhere', !raw.includes('advising2026!'));
  step('no recovery code is generated or stored', !raw.includes('codeHash') && !raw.includes('codeSalt'));

  // write a note, then check it comes back after a reload
  await p.click('[data-view="students"]'); await p.waitForTimeout(500);
  await p.locator('.srow').first().click(); await p.waitForTimeout(500);
  await p.fill('#noteText', 'Check with the registrar.'); await p.check('#noteFlag');
  await p.click('[data-note-save]'); await p.waitForTimeout(900);
  await p.reload(); await p.waitForTimeout(1600);
  step('session survives a reload', await p.evaluate(() => !document.getElementById('app').hidden));
  await p.click('[data-view="students"]'); await p.waitForTimeout(500);
  await p.locator('.srow').first().click(); await p.waitForTimeout(600);
  const kept = await p.locator('#noteText').inputValue().catch(() => '');
  step('the note was saved on the server', kept === 'Check with the registrar.', JSON.stringify(kept));

  // another browser, another advisor: cannot read Julie's students
  const ctx2 = await b.newContext();
  await ctx2.route('**', route => {
    const u = route.request().url();
    return (u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1')) ? route.continue() : route.abort();
  });
  const p2 = await ctx2.newPage();
  await p2.goto(base, { waitUntil: 'domcontentloaded' }); await p2.waitForTimeout(700);
  await p2.click('[data-pick="ali-el-zaart"]'); await p2.waitForTimeout(300);
  await p2.fill('#fPass', 'otheradvisor2026'); await p2.fill('#fPass2', 'otheradvisor2026');
  await p2.click('#signForm button[type=submit]'); await p2.waitForTimeout(900);
  const leak = await p2.evaluate(async () => {
    const r = await fetch('/api/list', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'advisors/julie-bu-daher/students' }) });
    return { status: r.status, body: await r.text() };
  });
  step('one advisor cannot read another list', leak.status === 403, 'status ' + leak.status);

  const acct = await p2.evaluate(async () => {
    const r = await fetch('/api/get', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'advisors/julie-bu-daher/account' }) });
    return r.status;
  });
  step('account records are never served', acct === 403, 'status ' + acct);

  // guessing gets slowed down
  let last = 0;
  for (let i = 0; i < 9; i++) {
    const r = await fetch(base + '/api/signin', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'julie-bu-daher', password: 'guess' + i }) });
    last = r.status;
  }
  step('guessing is rate limited', last === 429, 'status ' + last);

  // sign out really ends it
  await p.click('#signOut'); await p.waitForTimeout(600);
  const after = await p.evaluate(async () => {
    const r = await fetch('/api/list', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'advisors/julie-bu-daher/students' }) });
    return r.status;
  });
  step('signing out ends the session', after === 401, 'status ' + after);

  // headers
  const h = await fetch(base + '/');
  step('security headers set', !!h.headers.get('content-security-policy') && h.headers.get('x-content-type-options') === 'nosniff');

  console.log(errs.length ? 'JS ERRORS:\n' + errs.join('\n') : 'no JS errors');
  await b.close(); srv.kill();
})();
