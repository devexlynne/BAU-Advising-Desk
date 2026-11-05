'use strict';
/* The faculty set-up workbook: reading the .xlsx, turning it into structure,
   study plans, rule values and staff, refusing what is wrong, and loading it
   through the normal server routes. Synthetic data only. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Intake = require('../src/intake');
const OrgTree = require('../src/org-tree');
const { PASSWORDS, defaultStore, writeStore } = require('./helpers/auth-fixture');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(__dirname, 'fixtures', 'intake-sample.xlsx');
const PORT = 3197;
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = path.join(ROOT, '.test-data', 'intake');
const known = require('../data/catalog.json').universityElectives.map(c => c.code);
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ok  ' + msg); };
const read = () => Intake.readWorkbook(fs.readFileSync(FILE), b => zlib.inflateRawSync(b));
const copy = v => JSON.parse(JSON.stringify(v));
const headerAt = (book, sheet, name) => book[sheet][4].findIndex(h => String(h).trim() === name);

async function moduleChecks(tree) {
  const book = await read();
  ok(book['5 Courses'] && book['3 Programmes'] && book.Lists, 'the .xlsx is read sheet by sheet without any extra library');
  const got = Intake.fromWorkbook(book, { tree, known, fileName: 'sample.xlsx' });
  ok(got.report.errors.length === 0, 'the sample workbook has no errors' + (got.report.errors.length ? ': ' + got.report.errors.join(' | ') : ''));
  ok(got.facultyId === 'business-administration' && OrgTree.validateTree(got.tree).ok, 'it describes the Faculty of Business Administration and gives a valid structure');
  ok(OrgTree.findNode(got.tree, 'bba-digital-business') && OrgTree.isWithin(got.tree, 'accounting', 'bba-digital-business'),
    'a new programme without an ID gets one from its name, under the department given');
  const digital = got.plans['bba-digital-business'];
  ok(digital && digital.totalCredits === 100 && digital.buckets.MAJOR_CORE.credits === 27, 'the new programme has its credits and blocks');
  const c301 = digital.courses.find(c => c.code === 'BDIG301');
  ok(c301 && c301.minGrade === 'C' && c301.runsIn.join() === 'FALL' && c301.preOneOf && c301.preOneOf[0].join() === 'BACC201,BECO201' && !c301.pre.length,
    '"A OR B" is kept as one-of, not turned into both');
  const intern = digital.courses.find(c => c.code === 'BDIG490');
  ok(intern && intern.minEarned === 90 && intern.noGpa === true && intern.kind === 'Internship', 'credit-gated, pass/fail and internship details are kept on the course');
  ok(Object.keys(got.plans).every(id => got.plans[id].courses.some(c => c.code === 'BUSN100')), 'a course entered once for ALL is added to every programme of the faculty');
  ok(!got.plans['bba-economics'] && got.report.warnings.some(w => /BBA Economics: not filled in yet/.test(w)), 'a programme nobody filled in keeps its current plan');
  ok(got.plans['bba-accounting'].needsReview && !digital.needsReview, 'rows still marked "To check" make the plan load as "to check"');
  ok(got.rules['bba-management']['R.graduation.minCgpa'].value === 2.2 && got.rules['bba-digital-business']['R.load.REG-LOAD-01.max'].value === 17
    && !got.rules['bba-management']['R.load.REG-LOAD-01.max'], 'a faculty rule applies to all its programmes, a programme rule only to that one');
  ok(digital.intake.rules.some(r => r.rule === 'MIN_GRADE_MAJOR' && r.value === 'C'), 'rules the system cannot apply yet are recorded with the plan, with their source');
  ok(got.people.length === 2 && got.people[1].roles.some(r => r.role === 'faculty-admin') && got.people[1].roles.some(r => r.role === 'advisor' && r.scopes[0] === 'bba-accounting'),
    'staff come with their role, scope and the programme they also advise in');
  ok(digital.intake.approvals[0].approvedBy === 'Chairperson' && got.questions.length === 1, 'approvals and questions travel with the import');

  // what must stop a load
  let bad = copy(book);
  bad.Lists[1][24] = 'something else';
  ok(Intake.fromWorkbook(bad, { tree }).report.errors.length === 1, 'a spreadsheet that is not the set-up workbook is refused');
  bad = copy(book);
  bad['5 Courses'][4][headerAt(bad, '5 Courses', 'Prerequisites')] = 'Prereqs';
  ok(Intake.fromWorkbook(bad, { tree }).report.errors.some(e => /no column "Prerequisites"/.test(e)), 'a renamed column is reported, not guessed');
  bad = copy(book);
  const rr = bad['7 Rules'].findIndex(r => r && r[1] === 'GRAD_CGPA' && r[5] === 2.2);
  bad['7 Rules'][rr][5] = 7;
  ok(Intake.fromWorkbook(bad, { tree }).report.errors.some(e => /GRAD_CGPA must be a number from 0 to 4/.test(e)), 'a rule value out of range is refused');
  bad = copy(book);
  const pr = bad['8 People'].findIndex(r => r && /test\.intake\.advisor/.test(r[2]));
  bad['8 People'][pr][2] = 'someone@gmail.com';
  ok(Intake.fromWorkbook(bad, { tree }).report.errors.some(e => /@bau\.edu\.lb/.test(e)), 'staff must have a BAU email');
  bad = copy(book);
  const cr = bad['5 Courses'].findIndex(r => r && r[1] === 'BDIG302');
  bad['5 Courses'][cr][8] = 'BDIG302';
  ok(Intake.fromWorkbook(bad, { tree, known }).report.errors.some(e => /cannot require itself/.test(e)), 'the study plan checks of the setup page run on every programme');
  bad = copy(book);
  bad['3 Programmes'].find(r => r && r[0] === 'bba-accounting')[0] = 'cs';
  ok(Intake.fromWorkbook(bad, { tree }).report.errors.some(e => /cs is already used in another faculty/.test(e)), 'an ID used in another faculty is refused');
  const merged = Intake.mergeRules({ values: { 'R.load.REG-LOAD-01.min': 12 }, history: [] }, got.rules['bba-digital-business'], 'Synthetic', 'workbook');
  ok(merged.values['R.load.REG-LOAD-01.min'] === 12 && merged.values['R.load.REG-LOAD-01.max'] === 17 && merged.history[0].before.values['R.load.REG-LOAD-01.min'] === 12,
    'rule values join the saved ones with a history entry, so the Rules page can undo them');
  return got;
}

const post = (route, body, cookie) => fetch(BASE + route, {
  method: 'POST', headers: Object.assign({ 'content-type': 'application/json', origin: BASE }, cookie ? { cookie } : {}),
  body: JSON.stringify(body)
});

async function serverChecks() {
  fs.rmSync(DATA, { recursive: true, force: true });
  writeStore(DATA, defaultStore());
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DATA, ALLOW_UNVERIFIED_SIGNUP: 'true', ADMIN_SLUGS: '', STORE_KEY: '', SEED_CATALOGUE: 'false' })
  });
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { /* starting */ }
      await new Promise(r => setTimeout(r, 100));
    }
    const signIn = async (email, password) => (await post('/api/signin', { email, password })).headers.get('set-cookie').split(';')[0];
    const admin = await signIn('test.superadmin@bau.edu.lb', PASSWORDS.admin);
    const business = await signIn('test.business.admin@bau.edu.lb', PASSWORDS.business);
    const tree = (await (await post('/api/org/tree', {}, admin)).json()).tree;
    const got = Intake.fromWorkbook(await read(), { tree, known });
    ok(got.report.errors.length === 0, 'the sample workbook reads cleanly against the live structure');

    // the faculty's own admin can load it: it only touches their faculty
    let r = await post('/api/org/tree', { tree: got.tree }, business);
    ok(r.status === 200, 'the Business faculty admin can load the structure of their own faculty');
    for (const id of Object.keys(got.plans)) {
      r = await post('/api/set', { path: 'programmes/' + id + '/catalog', value: got.plans[id] }, business);
      assert.strictEqual(r.status, 200, id + ': ' + await r.text());
    }
    ok(true, 'every study plan in the workbook is accepted by the server checks');
    for (const id of Object.keys(got.rules)) {
      const next = Intake.mergeRules(null, got.rules[id], 'Synthetic', 'workbook');
      r = await post('/api/set', { path: 'config/' + id + '/rules', value: next }, business);
      assert.strictEqual(r.status, 200, id + ' rules');
    }
    ok(true, 'the rule values are saved per programme');
    const inv = await post('/api/people/invite', got.people[0], business);
    ok(inv.status === 200 && (await inv.json()).inviteLink, 'a person from the workbook can be invited with their role');

    const st = JSON.parse(fs.readFileSync(path.join(DATA, 'store.json'), 'utf8'));
    ok(st['programmes/bba-digital-business/catalog'].courses.length === 4
      && st['config/bba-digital-business/rules'].values['R.load.REG-LOAD-01.max'] === 17
      && st['people/test-intake-advisor'].roles[0].scopes[0] === 'bba-digital-business',
    'the new programme, its plan, its rules and its advisor are all in the system');

    // but not another faculty's
    const science = copy(got.tree);
    science.faculties.find(f => f.id === 'science').name = 'Changed by Business';
    r = await post('/api/org/tree', { tree: science }, business);
    ok(r.status === 403, 'a faculty admin still cannot change another faculty through a workbook');
  } finally {
    await new Promise(done => { server.on('exit', done); server.kill('SIGTERM'); });
  }
}

(async () => {
  const tree = defaultStore()['org/tree'];
  await moduleChecks(tree);
  await serverChecks();
  console.log('\n  ' + passed + ' passed, 0 failed');
})().catch(e => { console.error(e); process.exit(1); });
