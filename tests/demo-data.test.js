/* Run with: node tests/demo-data.test.js
   The demo dataset is fictional, internally consistent, and only ever loaded
   by the offline demo. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'src', 'engine.js'));
const Merge = require(path.join(ROOT, 'src', 'merge.js'));
const rules = require(path.join(ROOT, 'data', 'rules.json'));
const seed = require(path.join(ROOT, 'demo', 'students.json'));
const spec = require(path.join(ROOT, 'demo', 'tools', 'students-spec.json'));

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

ok('every demo record is marked as demo and uses the reserved 99xxx ID block', () => {
  assert.ok(seed.students.length >= 10);
  seed.students.forEach(s => {
    assert.strictEqual(s.demo, true, s.id);
    assert.ok(/^20\d\d99\d{3}$/.test(s.id), s.id);
  });
});

ok('the demo records are exactly the fictional students in the spec', () => {
  assert.deepStrictEqual(seed.students.map(s => s.id).sort(), spec.map(s => s.id).sort());
  seed.students.forEach(s => assert.strictEqual(s.name, spec.find(x => x.id === s.id).name));
});

ok('printed credits and CGPA agree with the course rows for every demo student', () => {
  const check = Merge.verifyTranscripts(E, rules, seed.students);
  assert.strictEqual(check.off.length, 0, JSON.stringify(check.off.map(o => o.s.id)));
  // a new student with no transcript yet has nothing to check
  assert.strictEqual(check.ok.length + check.empty.length, seed.students.length);
  check.empty.forEach(s => assert.strictEqual(spec.find(x => x.id === s.id).history.length, 0, s.id));
});

ok('every demo student has a registration for the demo term', () => {
  seed.students.forEach(s => {
    assert.ok(s.registration && s.registration.termCode === '202710', s.id);
    assert.ok(s.registration.courses.length > 0, s.id);
  });
});

ok('the demo transcript and schedule PDFs are present', () => {
  ['demo-transcripts.pdf', 'demo-schedules.pdf'].forEach(f => {
    const raw = fs.readFileSync(path.join(ROOT, 'demo', f), 'latin1');
    assert.ok(raw.length > 1000, f);
  });
});

// the store only seeds demo data in offline-demo mode, never on the portal server
async function storeSeeding() {
  const run = async (opts) => {
    global.window = { OFFLINE_DEMO: opts.offline, SERVED: opts.served, DEMO_DATA: { advisor: 'demo-advisor', students: [{ id: '202599901', name: 'X', demo: true }] } };
    global.self = global.window;
    global.location = { protocol: 'file:' };
    global.sessionStorage = { getItem() { return null; } };
    delete require.cache[require.resolve(path.join(ROOT, 'src', 'store.js'))];
    const Store = require(path.join(ROOT, 'src', 'store.js'));
    try { await Store.init(); } catch (e) { return { error: e.message }; }
    return { students: await Store.loadStudents('demo-advisor', []) };
  };
  const offline = await run({ offline: true, served: false });
  assert.strictEqual(offline.students.length, 1);
  const neither = await run({ offline: false, served: false });
  assert.ok(neither.error, 'without the demo flag the page must refuse local data');
  passed++; console.log('  ok  demo students load only in the offline demo');
}

storeSeeding().then(() => {
  console.log('\n  ' + passed + ' passed, 0 failed');
}).catch(e => { console.error(e); process.exit(1); });
