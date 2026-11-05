'use strict';
/* One portal, several programmes: study plan checks, the advising engine on a
   new programme, and who may change which programme's plan or staff.
   Synthetic data only. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const Programme = require('../src/programme');
const E = require('../src/engine');
const R = require('../data/rules.json');
const CS = require('../data/catalog.json');
const OFFERING = require('../data/offering.json');
const DEMO = require('../demo/students.json').students;
const { PASSWORDS, person, defaultStore, writeStore } = require('./helpers/auth-fixture');

const ROOT = path.join(__dirname, '..');
const PORT = 3198;
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = path.join(ROOT, '.test-data', 'programmes');
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ok  ' + msg); };

const known = CS.universityElectives.map(c => c.code).concat(CS.genScienceElectives.map(c => c.code));
const accounting = () => Object.assign(Programme.blankCatalog({ program: 'BBA Accounting' }), {
  totalCredits: 100,
  buckets: Object.assign(Programme.blankCatalog({}).buckets, {
    UNIV_MANDATORY: { label: 'University Requirements', credits: 8 },
    UNIV_ELECTIVE: { label: 'University Electives', credits: 8 },
    FACULTY_CORE: { label: 'Faculty Core', credits: 3 },
    MAJOR_CORE: { label: 'Major Core', credits: 81 }
  }),
  courses: [
    { code: 'BUSN201', title: 'Synthetic Business Basics', cr: 3, bucket: 'FACULTY_CORE', planSem: 1 },
    { code: 'ACCT201', title: 'Synthetic Accounting I', cr: 3, bucket: 'MAJOR_CORE', planSem: 1 },
    { code: 'ACCT202', title: 'Synthetic Accounting II', cr: 3, bucket: 'MAJOR_CORE', planSem: 2, pre: ['ACCT201'] }
  ]
});

function moduleChecks() {
  const cs = Programme.validate(CS, known);
  ok(!cs.errors.length && !cs.warnings.length, 'the Computer Science study plan passes every check');
  const blank = Programme.blankCatalog({ program: 'Synthetic programme' });
  ok(['UNIV_MANDATORY', 'UNIV_ELECTIVE', 'FACULTY_CORE', 'MAJOR_CORE', 'DEPT_ELECTIVE', 'GEN_SCI_ELECTIVE']
    .every(k => blank.buckets[k] && blank.buckets[k].credits === 0), 'an empty programme has every standard block at 0 credits');
  const loop = accounting();
  loop.courses[1].pre = ['ACCT202'];
  ok(Programme.validate(loop, known).errors.some(e => /circle/.test(e)), 'a prerequisite loop is refused');
  const dup = accounting(); dup.courses.push(Object.assign({}, dup.courses[1]));
  ok(Programme.validate(dup, known).errors.some(e => /twice/.test(e)), 'a course listed twice is refused');
  const wrongBlock = accounting(); wrongBlock.courses[0].bucket = 'NOPE';
  ok(Programme.validate(wrongBlock, known).errors.some(e => /NOPE/.test(e)), 'a course in an unknown block is refused');
  const rows = Programme.fromRows('Code\tTitle\tCredits\tBlock\tSemester\tPrerequisites\n'
    + 'ACCT301\tSynthetic Cost Accounting\t3\tMajor Core\t3\tACCT202\nMGMT201\tSynthetic Management\t3\tFaculty Core\t2\t',
    accounting().buckets);
  ok(rows.courses.length === 2 && rows.courses[0].bucket === 'MAJOR_CORE' && rows.courses[0].pre[0] === 'ACCT202'
    && rows.courses[1].bucket === 'FACULTY_CORE' && rows.courses[0].planSem === 3, 'rows pasted from Excel become courses, block names included');
  const copy = Programme.copyCatalog(CS, { program: 'Synthetic copy' });
  ok(copy.program === 'Synthetic copy' && !copy.mathMinor && !copy.universityElectives && copy.courses.length === CS.courses.length,
    'a copied plan keeps the courses and drops the Computer Science extras and shared lists');
  let fails = 0;
  [Programme.withShared(accounting(), CS), Programme.withShared(copy, CS), Programme.withShared(blank, CS)].forEach(cat => DEMO.forEach(s => {
    try {
      E.snapshot(R, cat, s); E.alerts(R, cat, s, OFFERING.term, OFFERING.sections);
      E.statusOf(R, cat, s, OFFERING.term, OFFERING.sections); E.recommend(R, cat, s, OFFERING.term, OFFERING.sections);
      E.graduationAudit(R, cat, s); E.minorAudit(R, cat, s); E.planNextTerm(R, cat, s, OFFERING.term, OFFERING.sections);
      E.checkRegistration(R, cat, s, OFFERING.term, OFFERING.sections);
    } catch (e) { fails++; }
  }));
  ok(fails === 0, 'every advising check runs for all ' + DEMO.length + ' demo students on a new, a copied and an empty programme');
  const acc = E.graduationAudit(R, Programme.withShared(accounting(), CS), DEMO[0]);
  ok(acc.remainingCredits > 0, 'a Computer Science student checked against Accounting is far from graduating, as expected');
}

const post = (route, body, cookie) => fetch(BASE + route, {
  method: 'POST', headers: Object.assign({ 'content-type': 'application/json', origin: BASE }, cookie ? { cookie } : {}),
  body: JSON.stringify(body)
});
async function signIn(email, password) {
  const r = await post('/api/signin', { email, password });
  assert.strictEqual(r.status, 200, 'sign-in for ' + email);
  return (r.headers.get('set-cookie') || '').split(';')[0];
}

async function serverChecks() {
  fs.rmSync(DATA, { recursive: true, force: true });
  const store = defaultStore();
  store['people/synthetic-shared'] = person('synthetic-shared', 'test.shared@bau.edu.lb',
    [{ role: 'advisor', scopes: ['cs', 'bba-accounting'] }]);
  // on the staff list from the start, never created an account
  store['people/synthetic-listed'] = person('synthetic-listed', 'listed.doctor@bau.edu.lb', [{ role: 'advisor', scopes: ['cs'] }]);
  writeStore(DATA, store);
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DATA, ALLOW_UNVERIFIED_SIGNUP: 'true', ADMIN_SLUGS: '', STORE_KEY: '' })
  });
  let out = ''; server.stdout.on('data', d => { out += d; }); server.stderr.on('data', d => { out += d; });
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { /* starting */ }
      await new Promise(r => setTimeout(r, 100));
    }
    const business = await signIn('test.business.admin@bau.edu.lb', PASSWORDS.business);
    const editor = await signIn('test.business.editor@bau.edu.lb', PASSWORDS.editor);
    const advisor = await signIn('test.advisor@bau.edu.lb', PASSWORDS.advisor);
    const admin = await signIn('test.superadmin@bau.edu.lb', PASSWORDS.admin);

    // staff who work in two faculties
    let r = await post('/api/people/update', { slug: 'synthetic-shared', roles: [{ role: 'advisor', scopes: ['bba-accounting'] }] }, business);
    const shared = () => JSON.parse(fs.readFileSync(path.join(DATA, 'store.json'), 'utf8'))['people/synthetic-shared'];
    ok(r.status === 200 && JSON.stringify(shared().roles).includes('"cs"'), 'a Business admin editing a shared advisor cannot remove their Computer Science role');
    r = await post('/api/people/update', { slug: 'synthetic-shared', person: { name: 'Changed by Business' },
      roles: [{ role: 'advisor', scopes: ['bba-accounting'] }] }, business);
    ok(r.status === 403 && shared().name !== 'Changed by Business', 'a Business admin cannot rename someone who also works in Science');
    r = await post('/api/people/deactivate', { slug: 'synthetic-shared' }, business);
    ok(r.status === 200 && shared().active !== false && !JSON.stringify(shared().roles).includes('bba-accounting')
      && JSON.stringify(shared().roles).includes('"cs"'), 'a Business admin "deactivating" a shared advisor only removes the Business role');
    r = await post('/api/people/deactivate', { slug: 'synthetic-shared' }, business);
    ok(r.status === 403, 'once nothing of theirs is left in Business, the Business admin cannot touch them');
    r = await post('/api/people/deactivate', { slug: 'synthetic-shared' }, admin);
    ok(r.status === 200 && shared().active === false, 'a superadmin can deactivate them completely');

    // someone on the staff list without an account gets a fresh invitation
    r = await post('/api/people/reinvite', { slug: 'synthetic-listed' }, business);
    ok(r.status === 403, 'a Business admin cannot invite a Computer Science doctor');
    r = await post('/api/people/reinvite', { slug: 'synthetic-cs-advisor' }, admin);
    ok(r.status === 409, 'someone who already has an account is not re-invited');
    r = await post('/api/people/reinvite', { slug: 'synthetic-listed' }, admin);
    const inv = await r.json();
    ok(r.status === 200 && /\?verify=[a-f0-9]{64}$/.test(inv.link || ''), 'a superadmin can invite a listed doctor who never signed up, and gets the link');
    const token = inv.link.split('verify=')[1];
    r = await post('/api/verify', { token, password: 'Synthetic-listed-pass-2026' });
    ok(r.status === 200, 'the invitation sets the password and activates the account');
    r = await post('/api/verify', { token, password: 'Synthetic-listed-pass-2026' });
    ok(r.status !== 200, 'the invitation link works only once');
    r = await post('/api/signin', { email: 'listed.doctor@bau.edu.lb', password: 'Synthetic-listed-pass-2026' });
    ok(r.status === 200, 'the invited doctor can then sign in with that password');

    // study plans, one per programme
    const planPath = id => 'programmes/' + id + '/catalog';
    r = await post('/api/set', { path: planPath('bba-accounting'), value: accounting() }, editor);
    ok(r.status === 200, 'the Accounting programme editor can save the Accounting study plan');
    r = await post('/api/get', { path: planPath('bba-accounting') }, business);
    const saved = (await r.json()).data;
    ok(saved && saved.courses.length === 3 && !saved.universityElectives && saved.updatedBy === 'synthetic-business-editor',
      'the saved plan is kept without the shared university lists, with who saved it');
    r = await post('/api/set', { path: planPath('cs'), value: accounting() }, editor);
    ok(r.status === 403, 'the Accounting editor cannot change the Computer Science plan');
    r = await post('/api/set', { path: planPath('cs'), value: accounting() }, business);
    ok(r.status === 403, 'the Business admin cannot change the Computer Science plan');
    r = await post('/api/get', { path: planPath('bba-accounting') }, advisor);
    ok(r.status === 403, 'a Computer Science advisor cannot read the Accounting plan');
    r = await post('/api/set', { path: planPath('no-such-programme'), value: accounting() }, admin);
    ok(r.status === 403, 'a plan cannot be saved for a programme that is not in the structure');
    const loop = accounting(); loop.courses[1].pre = ['ACCT202'];
    r = await post('/api/set', { path: planPath('bba-accounting'), value: loop }, editor);
    ok(r.status === 400 && /circle/.test((await r.json()).error), 'a broken plan is refused by the server too');
    r = await post('/api/delete', { path: planPath('bba-accounting') }, admin);
    ok(r.status === 409, 'a study plan cannot be deleted through storage');

    // the structure keeps programmes that already have a plan
    const tree = (await (await post('/api/org/tree', {}, admin)).json()).tree;
    const without = JSON.parse(JSON.stringify(tree));
    without.faculties.find(f => f.id === 'business-administration').departments
      .find(d => d.id === 'accounting').programmes = [];
    r = await post('/api/org/tree', { tree: without }, admin);
    ok(r.status === 409, 'a programme with a study plan cannot be removed from the structure');
    const noCs = JSON.parse(JSON.stringify(tree));
    noCs.faculties = noCs.faculties.filter(f => f.id !== 'science');
    r = await post('/api/org/tree', { tree: noCs }, admin);
    ok(r.status === 409, 'the Computer Science programme cannot be removed');
    const audit = fs.readFileSync(path.join(DATA, 'audit.log'), 'utf8');
    ok(/study-plan-saved/.test(audit), 'saving a study plan is in the activity log');
  } finally {
    server.kill();
    if (process.env.DEBUG_TEST) console.log(out);
  }
}

(async () => {
  moduleChecks();
  await serverChecks();
  console.log('\n  ' + passed + ' passed, 0 failed');
})().catch(e => { console.error(e); process.exit(1); });
