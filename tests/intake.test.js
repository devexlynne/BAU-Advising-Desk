'use strict';
/* Study-plan files sent to departments: reading the .xlsx, turning one file
   into one programme (structure, study plan, rule values, staff), refusing
   what is wrong, and loading it through the normal server routes.
   Synthetic data only. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Intake = require('../src/intake');
const OrgTree = require('../src/org-tree');
const { PASSWORDS, defaultStore, writeStore } = require('./helpers/auth-fixture');

const ROOT = path.join(__dirname, '..');
const ACC = path.join(__dirname, 'fixtures', 'intake-accounting.xlsx');
const NEW = path.join(__dirname, 'fixtures', 'intake-new-programme.xlsx');
const PORT = 3197;
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = path.join(ROOT, '.test-data', 'intake');
const known = require('../data/catalog.json').universityElectives.map(c => c.code);
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ok  ' + msg); };
const read = file => Intake.readWorkbook(fs.readFileSync(file), b => zlib.inflateRawSync(b));
const copy = v => JSON.parse(JSON.stringify(v));
const rowOf = (book, text) => book['Study plan'].findIndex(r => r && r[0] === text);

async function moduleChecks(tree) {
  const acc = await read(ACC);
  ok(Object.keys(acc).includes('Study plan'), 'the .xlsx is read without any extra library');
  let got = Intake.fromWorkbook(acc, { tree, known, fileName: 'acc.xlsx' });
  ok(got.report.errors.length === 0, 'a checked programme file has no errors' + (got.report.errors.length ? ': ' + got.report.errors.join(' | ') : ''));
  ok(got.programmeId === 'bba-accounting' && !got.isNew && got.plan.courses.length === 39 && got.plan.totalCredits === 100,
    'the file knows which programme it belongs to, and brings its credits and courses');
  ok(got.plan.buckets.FACULTY_CORE.credits === 48 && got.plan.buckets.FACULTY_CORE.label === 'Common Requirement Courses',
    'blocks keep the name the study plan prints');
  ok(!got.plan.needsReview && got.plan.source.checkedBy === 'Synthetic Chair', '"Everything is correct: Yes" loads it as checked, with who checked it');
  ok(OrgTree.findNode(got.tree, 'bba-accounting').nameAr === 'بكالوريوس المحاسبة', 'the Arabic name goes into the structure');
  ok(got.rules['R.graduation.minCgpa'].value === 2.2 && got.plan.intake.rules.find(r => r.rule === 'MIN_GRADE_MAJOR').value === 'C',
    'a different rule is applied, and one the system cannot apply yet is kept with its source');
  ok(got.rules['R.load.REG-LOAD-01.max'].value === 18 && got.rules['R.probation.dismissCgpaBelow'].value === 1.6,
    'every pre-filled value becomes the programme\'s own rule, independent of the others');
  ok(got.plan.intake.rules.some(r => r.rule === 'SUMMER_MAX' && r.kind === 'addition' && /probation/.test(r.value)),
    'a note is kept as an addition for advisors, not applied');
  ok(got.plan.intake.answers.length === 1 && /out of order/.test(got.plan.intake.answers[0].answer), 'free answers in section 6 are kept with the plan');
  ok(got.plan.courses.filter(c => c.bucket === 'MAJOR_CORE').every(c => c.minGrade === 'C'), 'a higher lowest grade for major courses is put on every major course');
  ok(got.people.length === 2 && got.people[1].roles[0].role === 'programme-editor' && got.people[1].roles[0].scopes[0] === 'bba-accounting',
    'staff come with their role on this programme');

  const fresh = await read(NEW);
  got = Intake.fromWorkbook(fresh, { tree, known, fileName: 'new.xlsx' });
  ok(got.report.errors.length === 0 && got.isNew && got.programmeId === 'bba-digital-business'
    && OrgTree.isWithin(got.tree, 'accounting', 'bba-digital-business'), 'the blank file creates a new programme in the department picked');
  const c301 = got.plan.courses.find(c => c.code === 'BDIG301');
  ok(c301.preOneOf[0].join() === 'BACC201,BECO201' && !c301.pre.length, '"A OR B" stays one-of, not both');
  const c490 = got.plan.courses.find(c => c.code === 'BDIG490');
  ok(c490.minEarned === 90 && c490.noGpa && got.plan.courses.find(c => c.code === 'BDIG302').minGrade === 'C',
    'plain notes like "pass/fail, needs 90 credits first" and "lowest grade C" are understood');
  ok(got.rules['R.load.REG-LOAD-01.max'].value === 17, 'a programme rule value is read');
  ok(!got.rules['R.load.REG-LOAD-01.min'] && got.plan.intake.rules.some(r => r.rule === 'LOAD_MIN' && /last semester/.test(r.value))
    && got.report.warnings.some(w => /kept as written/.test(w)), 'a rule written in words is kept for advisors with a warning, not refused');
  ok(got.plan.tracks.DATA && got.plan.tracks.DATA.coursesRequired === 1 && got.plan.tracks.DATA.courses.join() === 'BDIG301,BDIG302',
    'a track from section 4 becomes a track the advising page follows');
  ok(got.plan.intake.minors.length === 1 && got.plan.intake.minors[0].label === 'Minor in Economics', 'a minor is kept with the plan for advisors');
  ok(got.report.warnings.some(w => /were left empty, so the current value is kept/.test(w)), 'rule lines left empty are pointed out, and the university rule is used');

  const kept = Intake.keepFromExisting(Object.assign({}, got.plan, { tracks: {} }), { tracks: { SEC: { label: 'Security', courses: ['BDIG301'], coursesRequired: 1 } }, deptElectiveSlots: [4, 5] });
  ok(kept.tracks.SEC && kept.deptElectiveSlots.join() === '4,5', 'when the file has no tracks, the tracks and settings already in the system are kept, not wiped');

  // what must stop a load
  let bad = copy(acc);
  bad.Lists[1][24] = 'something else';
  ok(Intake.fromWorkbook(bad, { tree }).report.errors.length === 1, 'a spreadsheet that is not a study-plan file is refused');
  bad = copy(acc);
  bad['Study plan'][rowOf(bad, '7. Courses')][0] = 'Courses';
  ok(Intake.fromWorkbook(bad, { tree }).report.errors.some(e => /7\. Courses/.test(e)), 'a renamed section is reported, not guessed');
  bad = copy(acc);
  bad['Study plan'][rowOf(bad, 'Minimum CGPA to graduate')][3] = 7;
  ok(Intake.fromWorkbook(bad, { tree }).report.errors.some(e => /from 0 to 4/.test(e)), 'a rule value out of range is refused');
  bad = copy(acc);
  bad['Study plan'][rowOf(bad, 'Maximum credits in summer')][0] = 'Summer credits';
  ok(Intake.fromWorkbook(bad, { tree }).report.errors.some(e => /Do not change the rule names/.test(e)), 'a renamed rule line is refused, not guessed');
  bad = copy(acc);
  bad['Study plan'][rowOf(bad, '5. People who advise or edit this programme') + 2][3] = 'someone@gmail.com';
  ok(Intake.fromWorkbook(bad, { tree }).report.errors.some(e => /@bau\.edu\.lb/.test(e)), 'staff must have a BAU email');
  bad = copy(acc);
  const first = rowOf(bad, '7. Courses') + 3;
  bad['Study plan'][first + 1][0] = bad['Study plan'][first][0];
  ok(Intake.fromWorkbook(bad, { tree }).report.errors.some(e => /listed twice/.test(e)), 'a course listed twice is refused');
  bad = copy(acc);
  bad['Study plan'][first][5] = bad['Study plan'][first][0];
  ok(Intake.fromWorkbook(bad, { tree, known }).report.errors.some(e => /cannot require itself/.test(e)), 'the study plan checks of the setup page run too');
  bad = copy(acc);
  bad['Study plan'][first][3] = 'Lab block';
  ok(Intake.fromWorkbook(bad, { tree }).report.errors.some(e => /not in section 2/.test(e)), 'a course in a block the plan does not have is refused');

  const merged = Intake.mergeRules({ values: { 'R.load.REG-LOAD-01.min': 12 }, history: [] }, got.rules, 'Synthetic', 'file');
  ok(merged.values['R.load.REG-LOAD-01.min'] === 12 && merged.values['R.load.REG-LOAD-01.max'] === 17 && merged.history[0].before.values['R.load.REG-LOAD-01.min'] === 12,
    'rule values join the saved ones with a history entry, so the Rules page can undo them');
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
    let tree = (await (await post('/api/org/tree', {}, admin)).json()).tree;

    // two files, loaded one after the other the way the page does
    for (const file of [ACC, NEW]) {
      const got = Intake.fromWorkbook(await read(file), { tree, known });
      assert.strictEqual(got.report.errors.length, 0, path.basename(file));
      let r = await post('/api/org/tree', { tree: got.tree }, business);
      assert.strictEqual(r.status, 200, 'tree ' + path.basename(file));
      tree = (await r.json()).tree;
      r = await post('/api/set', { path: 'programmes/' + got.programmeId + '/catalog', value: got.plan }, business);
      assert.strictEqual(r.status, 200, 'plan ' + path.basename(file) + ': ' + await r.text());
      r = await post('/api/set', { path: 'config/' + got.programmeId + '/rules', value: Intake.mergeRules(null, got.rules, 'Synthetic', 'file') }, business);
      assert.strictEqual(r.status, 200, 'rules ' + path.basename(file));
      for (const p of got.people) assert.strictEqual((await post('/api/people/invite', p, business)).status, 200, p.person.email);
    }
    ok(true, 'the faculty admin loads both files: structure, study plans, rules and invitations all pass the server checks');
    const st = JSON.parse(fs.readFileSync(path.join(DATA, 'store.json'), 'utf8'));
    ok(st['programmes/bba-digital-business/catalog'].courses.length === 5 && st['programmes/bba-accounting/catalog'].courses.length === 39
      && st['config/bba-digital-business/rules'].values['R.load.REG-LOAD-01.max'] === 17
      && st['people/test-intake-editor'].roles[0].role === 'programme-editor',
    'both programmes, their plans, rules and staff are in the system');

    const science = copy(tree);
    science.faculties.find(f => f.id === 'science').name = 'Changed by Business';
    ok((await post('/api/org/tree', { tree: science }, business)).status === 403, 'a faculty admin still cannot change another faculty');
  } finally {
    await new Promise(done => { server.on('exit', done); server.kill('SIGTERM'); });
  }
}

(async () => {
  await moduleChecks(defaultStore()['org/tree']);
  await serverChecks();
  console.log('\n  ' + passed + ' passed, 0 failed');
})().catch(e => { console.error(e); process.exit(1); });
