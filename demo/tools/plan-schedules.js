/*
 * Gives each demo student a sensible Fall 2026/2027 registration, the way an
 * advisor would build it: the portal's own recommendations in order, one
 * section per course from the course offering, no time clashes, labs with
 * their lecture, and no more credits than the student's load limit allows.
 *
 * Used by generate-demo.js. Every schedule is then checked with the portal's
 * registration check, and any error stops the build.
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const catalog = require(path.join(ROOT, 'data', 'catalog.json'));
const rules = require(path.join(ROOT, 'data', 'rules.json'));
const offering = require(path.join(ROOT, 'data', 'offering.json'));
const E = require(path.join(ROOT, 'src', 'engine.js'));

const TERM = 'FALL 2026/2027';
const byCode = {};
catalog.courses.forEach(c => { byCode[c.code] = c; });
const DAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const span = m => [Math.min(mins(m.start), mins(m.end)), Math.max(mins(m.start), mins(m.end))];
const clash = (a, b) => a.meetings.some(x => b.meetings.some(y => {
  const [s1, e1] = span(x), [s2, e2] = span(y);
  return x.day === y.day && s1 < e2 && s2 < e1;
}));

function asStudent(s) {
  return {
    id: s.id, name: s.name, campus: s.campus, program: 'Science / Computer Science',
    admission: s.admission, admissionTerm: s.admissionTerm, catalogYear: Number(String(s.admission).slice(0, 4)),
    history: s.history, termSummary: s.termTotals, officialCgpa: s.cgpa, officialCredits: s.totalCredits
  };
}

// sections of a course on the student's campus, rotated by the student's
// number so classmates are not all put in the same section
function sectionsOf(code, campus, turn) {
  const list = offering.sections.filter(x => x.code === code && x.section && x.meetings && x.meetings.length &&
    (x.campus === campus || (campus !== 'Debbieh' && x.campus === 'Beirut')));
  const k = list.length ? turn % list.length : 0;
  return list.slice(k).concat(list.slice(0, k));
}

function plan(spec, turn) {
  turn = turn || 0;
  const student = asStudent(spec);
  const rec = E.recommend(rules, catalog, student, TERM, offering.sections);
  const max = rec.limits.max;
  const picked = [];
  const groupOf = {};
  rec.recommendations.forEach(r => { groupOf[r.code] = r.bucket || (byCode[r.code] || {}).bucket; });
  let credits = 0;
  const fits = sec => !picked.some(p => clash(p, sec));
  // Intensive English comes first when a level is still to pass (or, for a
  // new student with no transcript, the placement level already chosen), and
  // ENGL001 cannot be taken alongside it
  const placed = !spec.history.length && (spec.schedule || { courses: [] }).courses.find(c => /^INTE/.test(c.code));
  const inte = rec.snapshot.intensive ? rec.snapshot.intensive.code : placed ? placed.code : null;
  if (inte) {
    const sec = sectionsOf(inte, spec.campus, turn)[0];
    if (sec) picked.push(sec);
  }
  for (const r of rec.recommendations) {
    if (picked.some(p => p.code === r.code) || (inte && r.code === 'ENGL001') || /^INTE/.test(r.code)) continue;
    // one elective from a group at a time (two for department electives)
    const group = r.bucket || (byCode[r.code] || {}).bucket;
    const sameGroup = picked.filter(p => groupOf[p.code] === group).length;
    if (/ELECTIVE/.test(group || '') && sameGroup >= (group === 'DEPT_ELECTIVE' ? 2 : 1)) continue;
    const cr = (byCode[r.code] || {}).cr != null ? byCode[r.code].cr : r.cr;
    // a lab goes with its lecture: take both or neither
    const lab = byCode[r.code + 'L'] && !rec.snapshot.passed.has(r.code + 'L') ? r.code + 'L' : null;
    const labCr = lab ? byCode[lab].cr : 0;
    if (credits + cr + labCr > max) continue;
    const lec = sectionsOf(r.code, spec.campus, turn).find(fits);
    if (!lec) continue;
    let labSec = null;
    if (lab) {
      labSec = sectionsOf(lab, spec.campus, turn).find(x => fits(x) && !clash(x, lec));
      if (!labSec) continue;
    }
    picked.push(lec); credits += cr;
    if (labSec) { picked.push(labSec); credits += labCr; }
    if (credits >= max - 1 || picked.length >= 6) break;
  }
  const courses = picked.map(x => ({
    crn: x.crn, code: x.code, section: x.section, cr: byCode[x.code] ? byCode[x.code].cr : x.cr,
    // a few offering rows have start and end swapped; print them the right
    // way round, in day and time order
    meetings: x.meetings.map(m => mins(m.start) < mins(m.end) ? { day: m.day, start: m.start, end: m.end } : { day: m.day, start: m.end, end: m.start })
      .filter((m, i, all) => all.findIndex(o => o.day === m.day && o.start === m.start && o.end === m.end) === i)
      .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || mins(a.start) - mins(b.start))
  }));
  // check it the way the portal will
  const check = E.checkRegistration(rules, catalog, Object.assign(student, {
    registration: { termCode: '202710', term: TERM, courses }
  }), TERM, offering.sections);
  const errors = check.findings.filter(f => f.severity === 'ERROR' || f.severity === 'BLOCK');
  return { courses, credits, max, errors };
}

module.exports = { plan };
