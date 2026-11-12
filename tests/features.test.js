'use strict';
/* New features from the November 2026 pass: your own sessions, the superadmin
   activity log, saved term plans with overrides, and the print-window CSP hash.
   Run with: node tests/features.test.js   (synthetic data only) */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { PASSWORDS, defaultStore, writeStore, person, account } = require('./helpers/auth-fixture');
const { checkPlan } = require('../server/saved-plan');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, '.test-data', 'features');
const PORT = 3311, BASE = 'http://127.0.0.1:' + PORT;
let passed = 0, failed = 0;
const check = (name, ok, extra) => {
  if (ok) passed++; else failed++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? ' - ' + extra : ''));
};
const post = (route, body, cookie, ua) => fetch(BASE + route, {
  method: 'POST',
  headers: Object.assign({ 'content-type': 'application/json' }, cookie ? { cookie } : {}, ua ? { 'user-agent': ua } : {}),
  body: JSON.stringify(body || {})
});
const signIn = async (email, password, ua) =>
  ((await post('/api/signin', { email, password }, null, ua)).headers.get('set-cookie') || '').split(';')[0];
const readAudit = () => fs.readFileSync(path.join(DATA, 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const STUDENT = 'advisors/synthetic-cs-advisor/students/999900031';

(async () => {
  // ---- saved-plan checks, without a server ----
  const ok = checkPlan({ term: '202620', courses: [{ code: 'CMPS241', crn: '1234', section: 'A' }],
    overrides: [{ key: 'REG-PREQ-01|x', ruleId: 'REG-PREQ-01', course: 'CMPS241', reason: 'approved by the chair', by: 'someone-else', at: 1 }] },
  null, 'synthetic-cs-advisor', 1000);
  check('a valid plan passes and the server stamps who and when', !ok.error && ok.plan.overrides[0].by === 'synthetic-cs-advisor'
    && ok.plan.overrides[0].at === 1000 && ok.added.length === 1);
  const again = checkPlan(Object.assign({}, ok.plan), ok.plan, 'another-advisor', 2000);
  check('re-saving the same override keeps the original author and is not new', again.plan.overrides[0].by === 'synthetic-cs-advisor' && !again.added.length);
  check('a short reason is refused', !!checkPlan({ term: '202620', courses: [], overrides: [{ key: 'k', reason: 'ok' }] }, null, 'a', 1).error);
  check('a bad course code is refused', !!checkPlan({ term: '202620', courses: [{ code: '<img>' }] }, null, 'a', 1).error);
  check('a missing term is refused', !!checkPlan({ courses: [] }, null, 'a', 1).error);
  check('more than 20 courses is refused', !!checkPlan({ term: 'x', courses: Array(21).fill({ code: 'CMPS241' }) }, null, 'a', 1).error);

  // ---- running server ----
  fs.rmSync(DATA, { recursive: true, force: true });
  const store = defaultStore();
  store[STUDENT] = { id: '999900031', name: 'Synthetic Plan Student' };
  // a second advisor and a viewer, both in the same programme as the student's advisor
  store['people/synthetic-cs-advisor-2'] = person('synthetic-cs-advisor-2', 'test.advisor2@bau.edu.lb', [{ role: 'advisor', scopes: ['cs'] }]);
  store['advisors/synthetic-cs-advisor-2/account'] = account('synthetic-cs-advisor-2', 'test.advisor2@bau.edu.lb', 'Synthetic-advisor-two-2026');
  store['people/synthetic-cs-viewer'] = person('synthetic-cs-viewer', 'test.viewer@bau.edu.lb', [{ role: 'viewer', scopes: ['cs'] }]);
  store['advisors/synthetic-cs-viewer/account'] = account('synthetic-cs-viewer', 'test.viewer@bau.edu.lb', 'Synthetic-viewer-2026');
  writeStore(DATA, store);
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env, {
    PORT: String(PORT), DATA_DIR: DATA, STORE_KEY: '', ENABLE_STUDENT_IMPORTS: 'true',
    SMTP_URL: '', MAIL_API_URL: '', MAIL_API_KEY: '', DATABASE_URL: '', ADMIN_SLUGS: '' }) });
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { /* starting */ }
      await new Promise(r => setTimeout(r, 100));
    }
    // sessions
    const a1 = await signIn('test.advisor@bau.edu.lb', PASSWORDS.advisor, FIREFOX);
    const a2 = await signIn('test.advisor@bau.edu.lb', PASSWORDS.advisor, SAFARI);
    const a3 = await signIn('test.advisor@bau.edu.lb', PASSWORDS.advisor, SAFARI);
    const listed = await (await post('/api/sessions', {}, a1)).json();
    check('you see each place you are signed in', listed.sessions.length === 3, JSON.stringify(listed));
    check('the current one is marked and listed first', listed.sessions[0].current && listed.sessions.filter(x => x.current).length === 1);
    check('devices are coarse labels, not the user-agent string',
      listed.sessions[0].device === 'Firefox on Windows' && listed.sessions.some(x => x.device === 'Safari on iPhone or iPad')
      && !JSON.stringify(listed).includes('Mozilla'));
    check('no session token or stored key is exposed', listed.sessions.every(x => /^[a-f0-9]{16}$/.test(x.handle)));
    const admin = await signIn('test.superadmin@bau.edu.lb', PASSWORDS.admin);
    const adminList = await (await post('/api/sessions', {}, admin)).json();
    check('another person\'s sessions are not in your list', adminList.sessions.length === 1);
    const notMine = await post('/api/sessions/end', { handle: listed.sessions[1].handle }, admin);
    check('you cannot end someone else\'s session', notMine.status === 404);
    const one = await post('/api/sessions/end', { handle: listed.sessions[1].handle }, a1);
    check('you can end one other session', one.status === 200 && (await one.json()).ended === 1);
    const rest = await (await post('/api/sessions/end', { handle: 'others' }, a1)).json();
    check('"sign out everywhere else" ends the rest', rest.ended === 1);
    const stillHere = await post('/api/sessions', {}, a1);
    const gone = [await post('/api/sessions', {}, a2), await post('/api/sessions', {}, a3)];
    check('this browser stays signed in, the others are out', stillHere.status === 200 && gone.every(r => r.status === 401));

    // saved plan through the API
    const rec = await (await post('/api/get', { path: STUDENT }, a1)).json();
    const bad = await post('/api/set', { path: STUDENT, value: Object.assign({}, rec.data, {
      plan: { term: '202620', courses: [{ code: 'CMPS241' }], overrides: [{ key: 'k', ruleId: 'REG-PREQ-01', reason: 'short' }] } }) }, a1);
    check('the server refuses an override without a real reason', bad.status === 400);
    const plan = { term: '202620', courses: [{ code: 'CMPS241', crn: '1111', section: 'A' }],
      overrides: [{ key: 'REG-PREQ-01|CMPS241 requires CMPS200', ruleId: 'REG-PREQ-01', course: 'CMPS241',
        reason: 'Prerequisite taken at another university, approved by the chair', by: 'synthetic-superadmin', at: 5 }] };
    const good = await post('/api/set', { path: STUDENT, value: Object.assign({}, rec.data, { plan }) }, a1);
    check('a plan with an override is saved', good.status === 200);
    const stored = (await (await post('/api/get', { path: STUDENT }, a1)).json()).data.plan;
    check('the override carries the real author, not the one the browser sent',
      stored.overrides[0].by === 'synthetic-cs-advisor' && stored.overrides[0].at > 1e12 && stored.savedBy === 'synthetic-cs-advisor');
    await post('/api/set', { path: STUDENT, value: Object.assign({}, rec.data, { plan: stored, note: { text: 'later' } }) }, a1);
    const overrides = readAudit().filter(e => e.action === 'block-overridden');
    check('the override is in the audit log once, with the reason', overrides.length === 1
      && /another university/.test(overrides[0].reason) && overrides[0].student === '999900031');
    const editor = await signIn('test.business.editor@bau.edu.lb', PASSWORDS.editor);
    check('someone outside the scope cannot save a plan',
      (await post('/api/set', { path: STUDENT, value: Object.assign({}, rec.data, { plan }) }, editor)).status === 403);

    // only the advisor (and admins) reach a student list
    const other = await signIn('test.advisor2@bau.edu.lb', 'Synthetic-advisor-two-2026');
    const viewer = await signIn('test.viewer@bau.edu.lb', 'Synthetic-viewer-2026');
    check('another advisor in the same programme cannot list the students',
      (await post('/api/list', { path: 'advisors/synthetic-cs-advisor/students' }, other)).status === 403);
    check('or open one', (await post('/api/get', { path: STUDENT }, other)).status === 403);
    check('or change one', (await post('/api/set', { path: STUDENT, value: rec.data }, other)).status === 403);
    const otherAll = await (await post('/api/all-students', {}, other)).json();
    check('the all-students view shows another advisor nothing of anyone else',
      !Object.keys(otherAll.advisors || {}).some(k => k !== 'synthetic-cs-advisor-2'));
    check('a viewer in the same programme cannot open the record', (await post('/api/get', { path: STUDENT }, viewer)).status === 403);
    check('the advisor still opens their own', (await post('/api/get', { path: STUDENT }, a1)).status === 200);
    check('a superadmin can still open it', (await post('/api/get', { path: STUDENT }, admin)).status === 200);

    // activity log viewer
    check('an advisor cannot read the activity log', (await post('/api/admin/audit', {}, a1)).status === 403);
    const page0 = await (await post('/api/admin/audit', {}, admin)).json();
    check('a superadmin reads the activity log, newest first', page0.entries.length > 0
      && page0.entries[0].at >= page0.entries[page0.entries.length - 1].at && page0.actions.includes('signin'));
    const filtered = await (await post('/api/admin/audit', { action: 'block-overridden' }, admin)).json();
    check('it filters by action', filtered.total === 1 && filtered.entries[0].details.ruleId === 'REG-PREQ-01');
    const byActor = await (await post('/api/admin/audit', { actor: 'synthetic-cs-advisor', action: 'signin' }, admin)).json();
    check('it filters by person', byActor.total === 3 && byActor.entries.every(e => e.actor === 'synthetic-cs-advisor'));
    const far = await (await post('/api/admin/audit', { page: 99 }, admin)).json();
    check('a page past the end is empty, not an error', Array.isArray(far.entries) && far.entries.length === 0);
    check('reading the log is itself logged', readAudit().some(e => e.action === 'audit-log-read' && e.actor === 'synthetic-superadmin'));

    // print-window CSP
    const page = await fetch(BASE + '/');
    const csp = page.headers.get('content-security-policy') || '';
    const html = await page.text();
    const auto = (html.match(/<script>([^<]*?)<\\\/script>/) || [])[1];
    const hash = auto && crypto.createHash('sha256').update(auto, 'utf8').digest('base64');
    check('the print window\'s auto-print script is allowed by hash', !!hash && csp.includes("'sha256-" + hash + "'"));
    check('the policy still has no unsafe-inline for scripts', !/script-src[^;]*unsafe-inline/.test(csp));
  } finally {
    proc.kill();
  }
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
