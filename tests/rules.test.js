/* The regulations, tested on purpose-built cases rather than real students, so
   a rule change shows up here immediately. Run: node tests/rules.test.js */
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '..', 'src', 'engine.js'));
const catalog = require(path.join(__dirname, '..', 'data', 'catalog.json'));
const rules = require(path.join(__dirname, '..', 'data', 'rules.json'));

let pass = 0, fail = 0; const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; failures.push([name, e.message]); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
const TERM = 'FALL 2026/2027';
let n = 0;
function student(opts) {
  return Object.assign({
    id: '2026' + String(++n).padStart(5, '0'), name: 'Test Student', catalogYear: 2026,
    email: 't@student.bau.edu.lb', advisor: 'Julie Bu Daher', history: [], registration: null
  }, opts);
}
function rec(term, list) {
  return list.map(([code, grade]) => {
    const c = E.byCode(catalog)[code] || {};
    return { code, cr: c.cr || 3, grade, earned: ['F', 'W', 'D-'].includes(grade) ? 0 : (c.cr || 3), term, flag: '' };
  });
}
const has = (res, id) => res.findings.some(f => f.ruleId === id);

console.log('\n--- grades ---');

t('the grade scale is the one the transcripts use', () => {
  [['A+', 4], ['A', 4], ['A-', 3.67], ['B+', 3.33], ['B', 3], ['B-', 2.67],
   ['C+', 2.33], ['C', 2], ['C-', 1.67], ['D', 1.33], ['F', 0]].forEach(([g, p]) =>
    assert.strictEqual(E.gradePoint(rules, g), p, g + ' should be ' + p));
});

t('P and TR earn credits but stay out of the average', () => {
  const r = E.computeGpa(rules, [{ code: 'X', cr: 3, grade: 'A' }, { code: 'Y', cr: 3, grade: 'TR' }]);
  assert.strictEqual(r.earned, 6);
  assert.strictEqual(r.gpaCredits, 3);
  assert.strictEqual(r.gpa, 4);
});

t('a term with no graded course has no average, rather than zero', () => {
  const r = E.computeGpa(rules, [{ code: 'X', cr: 3, grade: 'P' }, { code: 'Y', cr: 0, grade: 'W' }]);
  assert.strictEqual(r.gpa, null);
  assert.strictEqual(r.hasGpa, false);
});

t('a first-term student is not put on probation for having no grades', () => {
  const s = student({ history: rec('FALL 2026/2027', [['MATH111', 'P'], ['MATH112', 'P']]) });
  const snap = E.snapshot(rules, catalog, s);
  assert.strictEqual(snap.cgpa, null);
  assert.strictEqual(snap.standing.state, 'GOOD_STANDING');
});

console.log('\n--- load limits ---');

t('the normal load is 12 to 18 credits', () => {
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'B'], ['MATH241', 'B']]) });
  const lim = E.loadLimits(rules, E.snapshot(rules, catalog, s), TERM);
  assert.strictEqual(lim.min, 12); assert.strictEqual(lim.max, 18);
});

t('a low term with the CGPA under 2.00 as well caps the next term at 12', () => {
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'B'], ['MATH241', 'B']])
    .concat(rec('SPRING 2025/2026', [['CMPS242', 'D'], ['CMPS244', 'F'], ['CMPS248', 'D']])) });
  const snap = E.snapshot(rules, catalog, s);
  assert.ok(snap.cgpa < 2, 'the example needs a CGPA under 2.00, got ' + snap.cgpa);
  assert.ok(['PROBATION', 'DISMISSAL_RISK'].includes(snap.standing.state), snap.standing.state);
  assert.strictEqual(E.loadLimits(rules, snap, TERM).max, 12);
});

t('a low term with the CGPA at 2.00 or above keeps the normal load', () => {
  // Department instruction: a CGPA of 2.00 or above allows more than 12.
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'A'], ['MATH241', 'A']])
    .concat(rec('SPRING 2025/2026', [['CMPS242', 'D'], ['CMPS244', 'F']])) });
  const snap = E.snapshot(rules, catalog, s);
  assert.ok(snap.lastSgpa < 2, 'the example needs a low last term, got ' + snap.lastSgpa);
  assert.ok(snap.cgpa >= 2, 'the example needs a CGPA of 2.00 or more, got ' + snap.cgpa);
  assert.strictEqual(snap.standing.state, 'GOOD_STANDING');
  assert.strictEqual(E.loadLimits(rules, snap, TERM).max, 18);
});

t('a low last term with a good CGPA raises nothing (the note was removed)', () => {
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'A'], ['MATH241', 'A']])
    .concat(rec('SPRING 2025/2026', [['CMPS242', 'D'], ['CMPS244', 'F']])) });
  const a = E.alerts(rules, catalog, s, TERM);
  assert.ok(!a.some(x => x.kind === 'standing'), JSON.stringify(a.map(x => x.title)));
});

console.log('\n--- academic warnings and remedial standing ---');

t('one term with both SGPA and CGPA under 2.00 is probation, not remedial', () => {
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'D'], ['MATH241', 'F'], ['CMPS244', 'D']]) });
  const snap = E.snapshot(rules, catalog, s);
  assert.ok(snap.cgpa < 2, 'the example needs a CGPA under 2.00, got ' + snap.cgpa);
  assert.strictEqual(snap.standing.state, 'PROBATION');
  assert.strictEqual(E.loadLimits(rules, snap, TERM).max, 12);
  assert.ok(!snap.standing.remedial, 'one low semester should not be the remedial stage');
});

t('two consecutive academic warnings lead to the remedial stage', () => {
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'F'], ['MATH241', 'F']])
    .concat(rec('SPRING 2025/2026', [['CMPS242', 'D'], ['CMPS244', 'F']])) });
  const snap = E.snapshot(rules, catalog, s);
  assert.ok(snap.standing.remedial, 'two low averages in a row is not being treated as remedial');
  assert.strictEqual(E.loadLimits(rules, snap, TERM).max, 12);
});

t('a probation cap beats a looser Intensive English cap', () => {
  const s = student({
    history: rec('FALL 2025/2026', [['CMPS241', 'F'], ['MATH241', 'F'], ['CMPS244', 'F']]),
    registration: { term: TERM, courses: [{ code: 'INTE002A', cr: 0 }] }
  });
  const snap = E.snapshot(rules, catalog, s);
  assert.ok(snap.cgpa < 2 && snap.intensive, 'the example needs both to apply');
  assert.strictEqual(E.loadLimits(rules, snap, TERM).max, 12, 'the looser of the two caps won');
});

t('a good semester does not create a warning when only the CGPA is under 2.00', () => {
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'F'], ['MATH241', 'F'], ['CMPS244', 'F']])
    .concat(rec('SPRING 2025/2026', [['CMPS242', 'B'], ['CMPS248', 'B']])) });
  const snap = E.snapshot(rules, catalog, s);
  assert.ok(snap.lastSgpa >= 2, 'the example needs a good last semester');
  assert.ok(snap.cgpa < 2, 'and a CGPA still under 2.00, got ' + snap.cgpa);
  assert.strictEqual(snap.standing.state, 'GOOD_STANDING');
  assert.strictEqual(E.loadLimits(rules, snap, TERM).max, 18);
});

t('a CGPA of 2.00 or above is not remedial, whatever the last semester did', () => {
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'A'], ['MATH241', 'A']])
    .concat(rec('SPRING 2025/2026', [['CMPS242', 'D'], ['CMPS244', 'F']])) });
  const snap = E.snapshot(rules, catalog, s);
  assert.ok(snap.cgpa >= 2, 'the example needs a CGPA of 2.00 or more');
  assert.ok(!snap.standing.remedial, 'put in the remedial stage with a CGPA of ' + snap.cgpa);
  assert.notStrictEqual(snap.standing.state, 'PROBATION');
  assert.strictEqual(E.loadLimits(rules, snap, TERM).max, 18);
});

console.log('\n--- the Intensive English programme ---');

t('each level allows what the programme says', () => {
  const L = rules.intensiveEnglish.levels;
  assert.strictEqual(L.INTE001.creditCap, 6);
  assert.strictEqual(L.INTE002A.creditCap, 14);
  assert.strictEqual(L.INTE002B.creditCap, 14);
  assert.strictEqual(rules.intensiveEnglish.gates.ENGL001, 'INTE002B');
});

t('a student in Intensive English 1 is held to 6 credits', () => {
  const s = student({ registration: { term: TERM, courses: [{ code: 'INTE001', cr: 0 }, { code: 'ARAB001', cr: 3 }] } });
  const snap = E.snapshot(rules, catalog, s);
  assert.strictEqual(snap.intensive.code, 'INTE001');
  const lim = E.loadLimits(rules, snap, TERM);
  assert.strictEqual(lim.max, 6);
  assert.strictEqual(lim.ruleId, 'INTENSIVE-ENGLISH');
});

t('2A and 2B allow 14', () => {
  ['INTE002A', 'INTE002B'].forEach(code => {
    const s = student({ registration: { term: TERM, courses: [{ code, cr: 0 }, { code: 'CMPS241', cr: 3 }] } });
    assert.strictEqual(E.loadLimits(rules, E.snapshot(rules, catalog, s), TERM).max, 14, code);
  });
});

t('a level still on the transcript unpassed still counts as being in it', () => {
  const s = student({ history: [{ code: 'INTE002A', title: 'Intensive English 2A', cr: 0, grade: 'F', earned: 0, term: 'FALL 2025/2026' }] });
  assert.strictEqual(E.snapshot(rules, catalog, s).intensive.code, 'INTE002A');
});

t('finishing the programme lifts the cap', () => {
  const s = student({ history: [
    { code: 'INTE001', title: 'x', cr: 0, grade: 'P', earned: 0, term: 'FALL 2024/2025' },
    { code: 'INTE002A', title: 'x', cr: 0, grade: 'P', earned: 0, term: 'SPRING 2024/2025' },
    { code: 'INTE002B', title: 'x', cr: 0, grade: 'P', earned: 0, term: 'SUMMER 2024/2025' }] });
  assert.strictEqual(E.snapshot(rules, catalog, s).intensive, null);
});

t('ENGL001 waits for Intensive English 2B', () => {
  assert.ok(E.intensiveBlocks(rules, { history: [] }, 'ENGL001'), 'ENGL001 was allowed without 2B');
  assert.strictEqual(E.intensiveBlocks(rules, { history: [{ code: 'INTE002B', grade: 'P' }] }, 'ENGL001'), null);
  assert.strictEqual(E.intensiveBlocks(rules, { history: [] }, 'CMPS241'), null, 'an ordinary course was gated');
});

console.log('\n--- pass or fail, and the two campuses ---');

t('P is a pass, and an intensive course graded P is finished with', () => {
  // The intensive and remedial courses are marked pass or fail, not graded.
  assert.ok(E.isPassing(rules, 'P'), 'P is not being read as a pass');
  assert.ok(!E.mustRepeat(rules, 'P'), 'a P is being sent back to be repeated');
  assert.strictEqual(E.gradePoint(rules, 'P'), null, 'a P should stay out of the average');
  const s = student({ history: rec('FALL 2025/2026', [['ENGL001', 'P'], ['CMPS241', 'B']]) });
  const due = E.repeatsDue(rules, catalog, s, TERM).map(r => r.code);
  assert.ok(!due.includes('ENGL001'), 'told to take an intensive course again after passing it');
});

t.skip = t.skip || ((n) => console.log('  skip ' + n));
t.skip('a plan across both campuses is a note, not a warning (campus notes removed)', () => {
  const picks = [
    { code: 'CMPS242', cr: 3, campus: 'Beirut', meetings: [{ day: 'MON', start: '09:00', end: '10:30' }] },
    { code: 'CMPS244', cr: 3, campus: 'Debbieh', meetings: [{ day: 'MON', start: '14:00', end: '15:30' }] }
  ];
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'B'], ['MATH241', 'B']]) });
  const found = E.checkPlan(rules, catalog, s, picks, TERM, []).findings
    .filter(f => f.ruleId === 'PLAN-CAMPUS');
  assert.strictEqual(found.length, 1, 'the note about the campuses has gone entirely');
  assert.strictEqual(found[0].severity, 'INFO', 'two campuses on one day is still being warned about');
});

t.skip('back-to-back classes on different campuses get a travel warning (removed)', () => {
  const picks = [
    { code: 'CMPS242', cr: 3, campus: 'Beirut', meetings: [{ day: 'MON', start: '09:00', end: '10:30' }] },
    { code: 'CMPS244', cr: 3, campus: 'Debbieh', meetings: [{ day: 'MON', start: '11:00', end: '12:30' }] }
  ];
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'B'], ['MATH241', 'B']]) });
  const warning = E.checkPlan(rules, catalog, s, picks, TERM, []).findings
    .find(f => f.ruleId === 'PLAN-CAMPUS-GAP');
  assert.ok(warning && warning.severity === 'WARN', 'short cross-campus gap was not raised');
});

t('a real overlap is still caught, whichever campus it is on', () => {
  const picks = [
    { code: 'CMPS242', cr: 3, campus: 'Beirut', meetings: [{ day: 'MON', start: '09:00', end: '10:30' }] },
    { code: 'CMPS244', cr: 3, campus: 'Debbieh', meetings: [{ day: 'MON', start: '09:30', end: '11:00' }] }
  ];
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'B'], ['MATH241', 'B']]) });
  const bad = E.checkPlan(rules, catalog, s, picks, TERM, []).findings
    .filter(f => f.severity !== 'INFO');
  assert.ok(bad.length > 0, 'two courses at the same hour were allowed through');
});

console.log('\n--- a course the student is already sitting ---');

t('what they are taking now is not recommended to them again', () => {
  const s = student({
    history: rec('FALL 2025/2026', [['CMPS241', 'B'], ['MATH241', 'B']]),
    registration: { term: TERM, courses: [{ code: 'CMPS242', cr: 3 }, { code: 'CMPS244', cr: 3 }] }
  });
  const got = E.recommend(rules, catalog, s, TERM, []).recommendations.map(r => r.code);
  ['CMPS242', 'CMPS244'].forEach(c => {
    assert.ok(!got.includes(c), c + ' was recommended although they are sitting it');
  });
});

t('a student with nothing registered still gets the full list', () => {
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'B'], ['MATH241', 'B']]) });
  const got = E.recommend(rules, catalog, s, TERM, []).recommendations;
  assert.ok(got.length > 0, 'nothing was recommended to a student with an empty term');
});

t('a registration for another term does not suppress anything', () => {
  // What they sat last spring is history, not a reason to stay silent now.
  const s = student({
    history: rec('FALL 2025/2026', [['CMPS241', 'B'], ['MATH241', 'B']]),
    registration: { term: 'SPRING 2025/2026', courses: [{ code: 'CMPS242', cr: 3 }] }
  });
  const got = E.recommend(rules, catalog, s, TERM, []).recommendations.map(r => r.code);
  assert.ok(got.includes('CMPS242'), 'an old registration silenced a course that is still owed');
});

console.log('\n--- what counts as a humanities or social elective ---');

t('Mass Communication is a humanities elective, all of it', () => {
  // MCOM003 used to sit in a category of its own and satisfy nothing, while
  // MCOM007 counted. They are the same kind of course.
  ['MCOM002', 'MCOM003', 'MCOM004', 'MCOM007'].forEach(c => {
    assert.strictEqual(E.ueCategory(catalog, c), 'HUMANITIES', c + ' does not count as humanities');
  });
});

t('SOCI and PSYC are social sciences', () => {
  ['SOCI001', 'SOCI010', 'PSYC004', 'PSYC007'].forEach(c => {
    assert.strictEqual(E.ueCategory(catalog, c), 'SOCIAL', c + ' does not count as social science');
  });
});

t('CMPS006 is an own-major elective and does not count for CS students', () => {
  const u = catalog.universityElectives.find(x => x.code === 'CMPS006');
  assert.ok(u && u.ownMajor, 'CMPS006 is not marked as an own-major elective');
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'B']]) });
  const res = E.validateBasket(rules, catalog, s, ['CMPS006'], TERM, []);
  assert.ok(has(res, 'REG-UE-04'), 'CMPS006 was allowed to count as a university elective');
});

t('a course the elective list has not caught up with is read from its prefix', () => {
  assert.strictEqual(E.ueCategory(catalog, 'ARAB111'), 'HUMANITIES');
  assert.strictEqual(E.ueCategory(catalog, 'SOCI099'), 'SOCIAL');
});

t('a course nobody can place is left unplaced, not guessed at', () => {
  assert.strictEqual(E.ueCategory(catalog, 'CMPS241'), null);
  assert.strictEqual(E.ueCategory(catalog, 'ZZZZ999'), null);
});

t('the other categories are untouched', () => {
  assert.strictEqual(E.ueCategory(catalog, 'PHAR001'), 'MEDICAL');
  assert.strictEqual(E.ueCategory(catalog, 'BLAW003'), 'LAW');
});

t('a student who has taken MCOM is not asked for a humanities elective', () => {
  const s = student({ catalogYear: 2026, history: rec('FALL 2025/2026', [['CMPS241', 'B'], ['MCOM003', 'B']]) });
  const asked = E.alerts(rules, catalog, s, TERM).filter(a => /humanities/i.test(a.title + (a.detail || '')));
  assert.deepStrictEqual(asked.map(a => a.title), []);
});

console.log('\n--- a course failed and then passed ---');

const row = (code, grade, term, flag, cr) => ({ code, title: code, cr: cr || 3,
  grade, earned: E.isPassing(rules, grade) ? (cr || 3) : 0, term, flag });

t('a pass after a fail counts, even when the old fail is still marked as counting', () => {
  // Ali El Mir's CMPS241, as it appears on his transcript.
  const best = E.bestAttempts(rules, [
    row('CMPS241', 'F', 'FALL 2025/2026', 'I'),
    row('CMPS241', 'C-', 'SPRING 2025/2026')
  ]);
  assert.strictEqual(best[0].grade, 'C-');
});

t('a pass the registrar annulled does not count', () => {
  const best = E.bestAttempts(rules, [
    row('CMPS241', 'F', 'FALL 2025/2026', 'I'),
    row('CMPS241', 'C-', 'SPRING 2025/2026', 'A')
  ]);
  assert.strictEqual(best[0].grade, 'F');
});

t('an earlier pass does not overrule a later counted attempt', () => {
  // A passed course retaken to raise the grade: the transcript decides which
  // counts, and a pass that came before it is not "a pass after a fail".
  const best = E.bestAttempts(rules, [
    row('CMPS241', 'D', 'FALL 2024/2025'),
    row('CMPS241', 'F', 'FALL 2025/2026', 'I')
  ]);
  assert.strictEqual(best[0].grade, 'F');
});

t('a course failed and then passed is not asked to be repeated', () => {
  const s = student({ history: [
    row('CMPS241', 'F', 'FALL 2025/2026', 'I'),
    row('CMPS241', 'C-', 'SPRING 2025/2026')
  ] });
  const due = E.repeatsDue(rules, catalog, s, TERM).map(r => r.code);
  assert.ok(!due.includes('CMPS241'), 'still told to repeat CMPS241');
});

t('summer is capped at 9 credits', () => {
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'A']]) });
  assert.strictEqual(E.loadLimits(rules, E.snapshot(rules, catalog, s), 'SUMMER 2026/2027').max, 9);
});

t('registering over the cap is blocked, and the reason says which rule', () => {
  const s = student({
    history: rec('FALL 2025/2026', [['CMPS241', 'B'], ['MATH241', 'B']])
      .concat(rec('SPRING 2025/2026', [['MATH242', 'D'], ['CMPS244', 'F']])),
    registration: { term: TERM, termCode: '202710', courses: [
      { crn: '1', code: 'CMPS242', section: 'B1', cr: 3, meetings: [{ day: 'MON', start: '08:00', end: '10:00' }] },
      { crn: '2', code: 'CMPS244', section: 'B1', cr: 3, meetings: [{ day: 'TUE', start: '08:00', end: '10:00' }] },
      { crn: '3', code: 'CMPS246', section: 'B1', cr: 3, meetings: [{ day: 'WED', start: '08:00', end: '10:00' }] },
      { crn: '4', code: 'CMPS248', section: 'B1', cr: 3, meetings: [{ day: 'THU', start: '08:00', end: '10:00' }] },
      { crn: '5', code: 'MATH242', section: 'B1', cr: 3, meetings: [{ day: 'FRI', start: '08:00', end: '10:00' }] }
    ] }
  });
  const res = E.checkRegistration(rules, catalog, s, TERM, []);
  assert.ok(has(res, 'REG-LOAD'), 'expected the load rule to fire: ' + JSON.stringify(res.findings.map(f => f.ruleId)));
});

console.log('\n--- prerequisites and the timetable ---');

t('a course without its prerequisite is blocked', () => {
  const s = student({ registration: { term: TERM, termCode: '202710', courses: [
    { crn: '1', code: 'CMPS342', section: 'B1', cr: 3, meetings: [] }] } });
  const res = E.checkRegistration(rules, catalog, s, TERM, []);
  assert.ok(has(res, 'REG-PREQ'));
  assert.ok(/CMPS24/.test(res.findings.find(f => f.ruleId === 'REG-PREQ').message));
});

t('taking the prerequisite in the same semester does not count', () => {
  const s = student({ registration: { term: TERM, termCode: '202710', courses: [
    { crn: '1', code: 'CMPS241', section: 'B1', cr: 3, meetings: [] },
    { crn: '2', code: 'CMPS242', section: 'B1', cr: 3, meetings: [] }] } });
  const res = E.checkRegistration(rules, catalog, s, TERM, []);
  const f = res.findings.find(x => x.ruleId === 'REG-PREQ');
  assert.ok(f && /same semester/.test(f.message), 'expected the same-semester note');
});

t('two courses at the same hour on the same day clash', () => {
  const s = student({
    history: rec('FALL 2025/2026', [['CMPS241', 'B'], ['MATH241', 'B'], ['CMPS244', 'B']]),
    registration: { term: TERM, termCode: '202710', courses: [
      { crn: '1', code: 'CMPS242', section: 'B1', cr: 3, meetings: [{ day: 'MON', start: '10:00', end: '12:00' }] },
      { crn: '2', code: 'CMPS248', section: 'B1', cr: 3, meetings: [{ day: 'MON', start: '11:00', end: '13:00' }] }] }
  });
  const res = E.checkRegistration(rules, catalog, s, TERM, []);
  assert.ok(has(res, 'REG-CLASH'), 'expected a clash');
});

t('courses on different days do not clash', () => {
  const a = [{ day: 'MON', start: '10:00', end: '12:00' }];
  const b = [{ day: 'TUE', start: '10:00', end: '12:00' }];
  assert.strictEqual(E.meetingsClash(a, b), null);
});

console.log('\n--- Work Ready Now ---');

t('WRNL200 is raised for ID 2025 and above, as something to plan rather than a crisis', () => {
  const s = student({ catalogYear: 2025, id: '202500001',
    history: rec('FALL 2025/2026', [['CMPS241', 'B'], ['CMPS242', 'B'], ['CMPS244', 'B'], ['CMPS246', 'B'],
      ['CMPS248', 'B'], ['MATH241', 'B'], ['MATH242', 'B'], ['CHEM241', 'B'], ['PHYS243', 'B'],
      ['MATH341', 'B'], ['CMPS342', 'B'], ['CMPS345', 'B'], ['CMPS347', 'B'], ['CMPS343', 'B'],
      ['CMPS344', 'B'], ['CMPS346', 'B'], ['CMPS447', 'B'], ['MATH348', 'B']]) });
  const snap = E.snapshot(rules, catalog, s);
  assert.ok(snap.earned > 50, 'fixture should be past 50 credits, got ' + snap.earned);
  const a = E.alerts(rules, catalog, s, TERM, []);
  const w = a.filter(x => /WRNL200/.test(x.title));
  assert.ok(w.length, JSON.stringify(a.map(x => x.title)));
  // A student who simply has not taken it yet is on track, not in trouble.
  assert.ok(w.every(x => x.level !== 'urgent'), 'it should never be urgent: ' + JSON.stringify(w));
});

t('WRNL200 is only a recommendation for ID 2024', () => {
  const s = student({ catalogYear: 2024, id: '202400001',
    history: rec('FALL 2025/2026', [['CMPS241', 'B'], ['CMPS242', 'B'], ['CMPS244', 'B'], ['CMPS246', 'B'],
      ['CMPS248', 'B'], ['MATH241', 'B'], ['MATH242', 'B'], ['CHEM241', 'B'], ['PHYS243', 'B'],
      ['MATH341', 'B'], ['CMPS342', 'B'], ['CMPS345', 'B'], ['CMPS347', 'B'], ['CMPS343', 'B'],
      ['CMPS344', 'B'], ['CMPS346', 'B'], ['CMPS447', 'B'], ['MATH348', 'B']]) });
  const a = E.alerts(rules, catalog, s, TERM, []);
  const w = a.filter(x => /WRNL200/.test(x.title));
  assert.ok(!w.length, 'only recommended for 2024, so not raised: ' + JSON.stringify(w));
});

t('a first-semester 2026 student is not nagged about WRNL200', () => {
  const s = student({ catalogYear: 2026, history: rec('FALL 2026/2027', [['CMPS241', 'B'], ['MATH241', 'B']]) });
  const a = E.alerts(rules, catalog, s, TERM, []);
  assert.ok(!a.some(x => /Work Ready Now/.test(x.title)), 'too early to raise it');
});

console.log('\n--- repeats and requirements ---');

t('a course graded F is flagged for repeat, and again if it is missing from the registration', () => {
  const s = student({
    history: rec('FALL 2025/2026', [['CMPS241', 'F'], ['MATH241', 'B']]),
    registration: { term: TERM, termCode: '202710', courses: [
      { crn: '1', code: 'MATH242', section: 'B1', cr: 3, meetings: [] }] }
  });
  const res = E.checkRegistration(rules, catalog, s, TERM, []);
  assert.ok(has(res, 'REG-REPEAT-DUE'), 'expected the repeat reminder on the registration');
  const a = E.alerts(rules, catalog, s, TERM, []);
  const again = x => /CMPS241/.test(x.detail) && /(\(F\)|graded F|taken again|repeated)/i.test(x.detail);
  assert.ok(a.some(again), 'the advisor should see it once: ' + JSON.stringify(a.map(x => x.detail)));
  /* Once as the repeat itself. A student in the remedial stage is also told
     which courses pulled the average down, and that list names the same
     course: two different things for the advisor to know, not a duplicate. */
  const asTheRepeat = a.filter(x => again(x) && x.kind !== 'standing');
  assert.strictEqual(asTheRepeat.length, 1, 'the repeat itself should be raised once: '
    + JSON.stringify(a.filter(again).map(x => x.kind + ': ' + x.title)));

  // With no registration at all it is still raised, on its own
  const s2 = student({ history: rec('FALL 2025/2026', [['CMPS241', 'F'], ['MATH241', 'B']]) });
  const a2 = E.alerts(rules, catalog, s2, TERM, []);
  assert.ok(a2.some(x => /Retake/.test(x.title) && /CMPS241/.test(x.detail)), 'expected the standalone repeat alert');
});

t('a passed course taken again is only a note, not a problem', () => {
  const s = student({
    history: rec('FALL 2025/2026', [['CMPS241', 'C'], ['MATH241', 'B']]),
    registration: { term: TERM, termCode: '202710', courses: [
      { crn: '1', code: 'CMPS241', section: 'B1', cr: 3, meetings: [] }] }
  });
  const res = E.checkRegistration(rules, catalog, s, TERM, []);
  const f = res.findings.find(x => x.ruleId === 'REG-REPEAT');
  assert.ok(f && f.severity === 'WARN', 'expected a warning, not a block');
});

t('humanities and social science electives are both required', () => {
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'B'], ['MATH241', 'B'], ['NURS001', 'B']]) });
  const snap = E.snapshot(rules, catalog, s);
  assert.strictEqual(snap.buckets.UNIV_ELECTIVE.hasHumanities, false);
  assert.strictEqual(snap.buckets.UNIV_ELECTIVE.hasSocial, false);
  const s2 = student({ history: rec('FALL 2025/2026', [['HIST002', 'B'], ['PSYC007', 'B']]) });
  const snap2 = E.snapshot(rules, catalog, s2);
  assert.strictEqual(snap2.buckets.UNIV_ELECTIVE.hasHumanities, true);
  assert.strictEqual(snap2.buckets.UNIV_ELECTIVE.hasSocial, true, 'PSYC counts as social science');
});

t('not being registered at all is the first thing raised', () => {
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'B']]) });
  const a = E.alerts(rules, catalog, s, TERM, []);
  assert.strictEqual(a[0].kind, 'registration');
  assert.strictEqual(a[0].level, 'urgent');
});

t('the degree blocks add up to the 100 credits in the study plan', () => {
  const total = Object.keys(catalog.buckets).reduce((n, k) => n + (catalog.buckets[k].credits || 0), 0);
  assert.strictEqual(total, catalog.totalCredits);
});
console.log('\n--- when courses actually run ---');

t('a spring-only course failed last year is not held against a fall registration', () => {
  // CMPS244 runs in spring. Failing it and not registering it in the fall is
  // not a mistake, it is the calendar.
  const s = student({
    history: rec('SPRING 2025/2026', [['CMPS244', 'F'], ['MATH241', 'B']]),
    registration: { term: TERM, termCode: '202710', courses: [
      { crn: '1', code: 'CMPS241', section: 'B1', cr: 3, meetings: [] },
      { crn: '2', code: 'CMPS246', section: 'B1', cr: 3, meetings: [] },
      { crn: '3', code: 'MATH341', section: 'B1', cr: 3, meetings: [] },
      { crn: '4', code: 'CMPS342', section: 'B1', cr: 3, meetings: [] }] }
  });
  const a = E.alerts(rules, catalog, s, TERM, []);
  const about = a.filter(x => /CMPS244/.test(x.detail || ''));
  assert.ok(about.length, 'it should still be mentioned');
  // The standing alert may name it as a course to retake; what must not
  // happen is the registration being marked wrong for a course that does
  // not run this term.
  const aboutTheTerm = about.filter(x => x.kind !== 'standing');
  assert.ok(aboutTheTerm.every(x => x.level !== 'urgent'),
    'a spring course was held against a fall registration: ' + JSON.stringify(aboutTheTerm));
  assert.ok(about.some(x => /next term/i.test(x.title)), JSON.stringify(about));
});

t('repeats are ordered by how much they hold up', () => {
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'F'], ['CHEM241', 'F']]) });
  const due = E.repeatsDue(rules, catalog, s, TERM, []);
  assert.strictEqual(due[0].code, 'CMPS241', 'CMPS241 opens more of the degree: ' + JSON.stringify(due.map(d => d.code + ':' + d.unlocks)));
  assert.ok(due[0].unlocks > due[1].unlocks);
});

t('a block never reads as more than full', () => {
  const s = student({ catalogYear: 2026, history: rec('FALL 2025/2026',
    [['MATH343', 'A'], ['MATH345', 'A'], ['MATH351', 'A']]) });
  const snap = E.snapshot(rules, catalog, s);
  const g = snap.buckets.GEN_SCI_ELECTIVE;
  assert.ok(g.earned <= g.required, g.earned + ' / ' + g.required);
  assert.ok(g.surplus > 0, 'the extra credits should be reported as surplus');
});

t('senior project has no credit gate', () => {
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'B']]) });
  const st = E.prereqStatus(rules, catalog, 'CMPS443', E.snapshot(rules, catalog, s).passed, 12);
  assert.ok(st.ok, 'nothing published stops a student registering it: ' + JSON.stringify(st));
});

t('the credits that count exclude the freshman equivalency block', () => {
  const s = student({ history: rec('FALL 2025/2026',
    [['ARAB110', 'TR'], ['ENGL110', 'TR'], ['MATH110', 'TR'], ['CMPS241', 'B']]) });
  const snap = E.snapshot(rules, catalog, s);
  assert.strictEqual(snap.earned, 3, 'only CMPS241 counts toward the degree');
  assert.strictEqual(snap.officialEarned, 12, 'the transcript still shows all twelve');
  assert.strictEqual(snap.notCounted, 9);
});

t('foundation students may take foundation courses with CMPS241, but not MATH241', () => {
  const s = student({ foundationRequired: ['MATH111'], history: [] });
  const allowed = E.validateBasket(rules, catalog, s, ['MATH111', 'CMPS241'], TERM, []);
  assert.ok(!allowed.findings.some(x => x.ruleId === 'REG-FND-02'), JSON.stringify(allowed));
  const blocked = E.validateBasket(rules, catalog, s, ['MATH111', 'MATH241'], TERM, []);
  assert.ok(blocked.findings.some(x => x.ruleId === 'REG-FND-02' && /MATH241/.test(x.message)), JSON.stringify(blocked));
});

t('a failed PHYS243 is a required repeat like any faculty core course', () => {
  const s = student({ history: rec('FALL 2025/2026', [['PHYS243', 'F']]) });
  const due = E.repeatsDue(rules, catalog, s, TERM, []);
  assert.ok(due.some(x => x.code === 'PHYS243' && x.kind === 'must'), JSON.stringify(due));
});

t('the graduation check does not repeat total credits or the CGPA, but both still block', () => {
  const s = student({ history: rec('FALL 2025/2026', [['CMPS241', 'A']]) });
  const a = E.graduationAudit(rules, catalog, s);
  const shown = a.items.filter(i => !i.hidden).map(i => i.label);
  assert.ok(!shown.includes('Total credits') && !shown.some(l => /CGPA/.test(l)), shown.join(', '));
  assert.ok(a.blockers.some(b => b.label === 'Total credits'));
});

t('the mathematics minor needs 18 separate credits and MATH246 or MATH346', () => {
  const history = ['MATH246', 'MATH410', 'MATH411', 'MATH412', 'MATH413', 'MATH414'].map(code => ({
    term: 'FALL 2025/2026', code, title: code, cr: 3, grade: 'B', flag: 'I', bucketOverride: 'MATH_MINOR'
  }));
  const a = E.minorAudit(rules, catalog, student({ history }));
  assert.strictEqual(a.credits, 18);
  assert.ok(a.hasRequiredCourse && a.ok, JSON.stringify(a));
});

t('MATH used as a general science elective is not counted in the minor; core MATH is', () => {
  const history = [
    { term: 'FALL 2025/2026', code: 'MATH246', cr: 3, grade: 'B', flag: 'I' },
    { term: 'FALL 2025/2026', code: 'MATH454', cr: 2, grade: 'B', flag: 'I' },
    { term: 'FALL 2024/2025', code: 'MATH241', cr: 3, grade: 'B', flag: 'I' }
  ];
  const a = E.minorAudit(rules, catalog, student({ history }));
  assert.deepStrictEqual(a.excluded.sort(), ['MATH246', 'MATH454']);
  assert.deepStrictEqual(a.courses, ['MATH241']);
});


t('foundation courses MATH111 and MATH112 never count toward the Minor in Mathematics', () => {
  const history = [
    { term: 'FALL 2024/2025', code: 'MATH111', cr: 3, grade: 'B', flag: 'I' },
    { term: 'FALL 2024/2025', code: 'MATH112', cr: 3, grade: 'A', flag: 'I' },
    { term: 'TRANSFER', code: 'MATH110', cr: 3, grade: 'TR', flag: '' },
    { term: 'SPRING 2024/2025', code: 'MATH346', cr: 3, grade: 'B', flag: 'I' }
  ];
  const a = E.minorAudit(rules, catalog, student({ history }));
  assert.deepStrictEqual(a.courses, ['MATH346']);
  assert.strictEqual(a.credits, 3);
  assert.ok(a.foundation.includes('MATH111') && a.foundation.includes('MATH112'));
  assert.strictEqual(a.label, 'Minor in Mathematics');
});

console.log('\n--- departmental electives, as the BAU study plan places them ---');
{
  t('one or two matching electives do not claim a potential track', () => {
    const s = student({ history: rec('SPRING 2025/2026', [['CMPS326', 'B'], ['CMPS352', 'C']]) });
    const snap = E.snapshot(rules, catalog, s);
    assert.strictEqual(snap.trackEstimate.kind, 'developing');
    assert.strictEqual(snap.trackEstimate.key, 'SWE');
    assert.strictEqual(snap.likelyTrack, null);
  });
  t('three matching electives create a potential, not official, track', () => {
    const s = student({ history: rec('SPRING 2025/2026', [['CMPS325', 'B'], ['CMPS354', 'C'], ['CMPS465', 'B-']]) });
    const snap = E.snapshot(rules, catalog, s);
    assert.strictEqual(snap.trackEstimate.kind, 'potential');
    assert.strictEqual(snap.trackEstimate.key, 'SEC');
    assert.strictEqual(snap.likelyTrack, 'SEC');
  });
  t('courses split across track lists are labelled mixed', () => {
    const s = student({ history: rec('SPRING 2025/2026', [['CMPS326', 'B'], ['CMPS325', 'C']]) });
    const snap = E.snapshot(rules, catalog, s);
    assert.strictEqual(snap.trackEstimate.kind, 'mixed');
    assert.strictEqual(snap.likelyTrack, null);
  });
  t('a recorded track stays distinct from a course-based estimate', () => {
    const s = student({ track: 'AIDS', history: [] });
    const snap = E.snapshot(rules, catalog, s);
    assert.strictEqual(snap.trackEstimate.kind, 'recorded');
    assert.strictEqual(snap.likelyTrack, 'AIDS');
  });
  t('elective prerequisites from the Faculty catalogue are applied', () => {
    const by = E.byCode(catalog);
    assert.deepStrictEqual(by.CMPS348.pre, ['CMPS347']);
    assert.deepStrictEqual(by.CMPS454.pre, ['CMPS445', 'CMPS248']);
  });
  t('the Software Development track matches the BAU website', () => {
    assert.deepStrictEqual(catalog.tracks.SWE.courses.slice().sort(), ['CMPS326', 'CMPS352', 'CMPS461', 'CMPS463', 'CMPS464']);
  });
}

console.log('\n--- general science combination ---');
t('General Science: 3 + 2 passes, 3 + 3 passes with a note, a single 3 does not', () => {
  const gse = (list) => student({ history: list.map(([code, cr]) => ({ code, cr, grade: 'B', earned: cr, term: 'FALL 2025/2026', flag: '', bucketOverride: 'GEN_SCI_ELECTIVE' })) });
  const item = s => E.graduationAudit(rules, catalog, s).items.find(i => /General Science 3/.test(i.label));
  assert.ok(item(gse([['BIOL201', 3], ['CHEM202', 2]])).ok, '3 + 2');
  const tt = item(gse([['BIOL201', 3], ['CHEM203', 3]]));
  assert.ok(tt.ok, '3 + 3 should pass'); assert.ok(/advisor confirms/.test(tt.detail), tt.detail);
  assert.ok(!item(gse([['BIOL201', 3]])).ok, 'a single 3 credit course is not enough');
});

console.log('\n' + '='.repeat(56));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(56) + '\n');
if (fail) { failures.forEach(([n2, m]) => console.log('FAILED: ' + n2 + '\n   ' + m)); process.exit(1); }
