/* Run with: npm run test:security   (builds nothing: run `node build.js` first, `npm start` does it)
   A real browser against a real server, checking what is protected.
   Rewritten for invite-only accounts: people and accounts are seeded with the synthetic fixture. */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { PASSWORDS, account, person, defaultStore } = require('./helpers/auth-fixture');
const { startServer, localOnly, signIn, apiFrom, reporter } = require('./helpers/e2e');

const DATA = path.join(__dirname, '..', '.test-data', 'security');
const OTHER_PASS = 'Synthetic-other-advisor-2026';

(async () => {
  const { step, done } = reporter();
  const demo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'demo', 'students.json'), 'utf8')).students;
  const store = defaultStore();
  const mine = demo[0];
  store[`advisors/synthetic-cs-advisor/students/${mine.id}`] = mine;
  store['people/synthetic-cs-advisor-2'] = person('synthetic-cs-advisor-2', 'test.advisor2@bau.edu.lb',
    [{ role: 'advisor', scopes: ['cs'] }]);
  store['advisors/synthetic-cs-advisor-2/account'] = account('synthetic-cs-advisor-2', 'test.advisor2@bau.edu.lb', OTHER_PASS);

  const srv = await startServer({ port: 3170, dataDir: DATA, store });
  const b = await chromium.launch();
  try {
    const base = srv.base;
    const pre = await fetch(base + '/api/get', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'advisors/synthetic-cs-advisor/students' }) });
    step('records refused before sign-in', pre.status === 401, 'status ' + pre.status);

    const ctx = await b.newContext(); await localOnly(ctx);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    const cspViolations = [];
    p.on('console', m => { if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text()); });

    await signIn(p, base, 'test.advisor@bau.edu.lb', PASSWORDS.advisor);
    step('advisor signs in through the form', true);
    const api = apiFrom(p);

    const raw = fs.readFileSync(path.join(DATA, 'store.json'), 'utf8');
    step('password not stored anywhere', !raw.includes(PASSWORDS.advisor));

    const own = await api('/api/list', { path: 'advisors/synthetic-cs-advisor/students' });
    step('advisor can list own students', own.status === 200, 'status ' + own.status);

    // save a note through the UI and read it back after a reload
    await p.click('[data-view="students"]').catch(() => {});
    await p.locator('.srow').first().click(); await p.waitForSelector('#noteText');
    await p.fill('#noteText', 'Check with the registrar.');
    await p.click('[data-note-save]'); await p.waitForTimeout(800);
    await p.reload(); await p.waitForFunction(() => !document.getElementById('app').hidden);
    const back = await api('/api/get', { path: `advisors/synthetic-cs-advisor/students/${mine.id}` });
    const noteText = back.json && back.json.data && back.json.data.note && back.json.data.note.text;
    step('the note was saved on the server and survives a reload', noteText === 'Check with the registrar.', JSON.stringify(noteText));

    // a second advisor in another browser
    const ctx2 = await b.newContext(); await localOnly(ctx2);
    const p2 = await ctx2.newPage();
    await signIn(p2, base, 'test.advisor2@bau.edu.lb', OTHER_PASS);
    const api2 = apiFrom(p2);
    // an advisor sees only their own students, even in the same programme
    const shared = await api2('/api/list', { path: 'advisors/synthetic-cs-advisor/students' });
    step('another advisor in the same programme cannot list them', shared.status === 403, 'status ' + shared.status);
    const peek = await api2('/api/get', { path: 'advisors/synthetic-cs-advisor/students/' + mine.id });
    step('or open one of them', peek.status === 403, 'status ' + peek.status);
    const change = await api2('/api/set', { path: 'advisors/synthetic-cs-advisor/students/' + mine.id, value: Object.assign({}, mine, { name: 'Changed' }) });
    step('or change one of them', change.status === 403, 'status ' + change.status);
    const everyone2 = await api2('/api/all-students', {});
    step('and the all-students view gives an advisor nothing of anyone else\'s',
      everyone2.status === 403 || !Object.keys((everyone2.json || {}).advisors || {}).some(k => k !== 'synthetic-cs-advisor-2'), 'status ' + everyone2.status);

    // someone outside the scope cannot
    const ctx3 = await b.newContext(); await localOnly(ctx3);
    const p3 = await ctx3.newPage();
    await signIn(p3, base, 'test.business.editor@bau.edu.lb', PASSWORDS.editor);
    const api3 = apiFrom(p3);
    const leak = await api3('/api/list', { path: 'advisors/synthetic-cs-advisor/students' });
    step('staff outside the scope cannot read the list', leak.status === 403, 'status ' + leak.status);
    const one = await api3('/api/get', { path: `advisors/synthetic-cs-advisor/students/${mine.id}` });
    step('staff outside the scope cannot read a student', one.status === 403, 'status ' + one.status);
    const write = await api3('/api/set', { path: `advisors/synthetic-cs-advisor/students/${mine.id}`, value: mine });
    step('staff outside the scope cannot change a student', write.status === 403, 'status ' + write.status);
    const acct = await api2('/api/get', { path: 'advisors/synthetic-cs-advisor/account' });
    step('account records are never served', acct.status === 403, 'status ' + acct.status);
    const internal = await api2('/api/get', { path: '_sessions' });
    step('internal keys are never served', internal.status === 403 || internal.status === 400, 'status ' + internal.status);

    // CSRF: a POST from another origin is refused even with a valid cookie
    const cross = await p2.evaluate(async () => {
      const r = await fetch('/api/whoami', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: '{}' });
      return r.status;
    });
    const forged = await fetch(base + '/api/list', { method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ path: 'advisors/synthetic-cs-advisor/students' }) });
    step('a POST from another origin is refused', forged.status === 403, 'status ' + forged.status + ' (same-origin ' + cross + ')');

    // guessing gets slowed down
    let last = 0;
    for (let i = 0; i < 9; i++) {
      const r = await fetch(base + '/api/signin', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'test.advisor2@bau.edu.lb', password: 'guess-' + i + '-xxxxxxxx' }) });
      last = r.status;
    }
    step('password guessing is rate limited', last === 429, 'status ' + last);

    // sign out really ends it
    await p.click('#signOut'); await p.waitForTimeout(600);
    const after = await api('/api/list', { path: 'advisors/synthetic-cs-advisor/students' });
    step('signing out ends the session', after.status === 401, 'status ' + after.status);

    // headers
    const h = await fetch(base + '/');
    const csp = h.headers.get('content-security-policy') || '';
    step('security headers set', !!csp && h.headers.get('x-content-type-options') === 'nosniff'
      && h.headers.get('x-frame-options') === 'DENY' && h.headers.get('referrer-policy') === 'no-referrer');
    step('CSP has no unsafe-inline for scripts', !/script-src[^;]*'unsafe-inline'/.test(csp), csp.slice(0, 120));

    // an injected inline script must not run under the CSP
    const injected = await p.evaluate(() => new Promise(resolve => {
      window.__pwned = false;
      const s = document.createElement('script'); s.textContent = 'window.__pwned = true';
      document.body.appendChild(s);
      setTimeout(() => resolve(window.__pwned), 200);
    }));
    step('an injected inline script is blocked', injected === false);

    step('no JavaScript errors in the page', errs.length === 0, errs.join(' | '));
    step('no CSP violations from the app itself', cspViolations.filter(v => !/__pwned/.test(v)).length <= 1,
      cspViolations.length + ' reported (1 expected from the injection check)');
  } catch (e) {
    step('test run finished without an exception', false, e.message.split('\n')[0]);
    console.log(srv.log().split('\n').slice(-15).join('\n'));
  } finally {
    await b.close();
    srv.stop();
    done();
  }
})();
