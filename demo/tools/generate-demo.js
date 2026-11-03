/*
 * Builds the fictional demo students (demo/tools/students-spec.json).
 * Every name and ID here is invented. IDs follow the BAU shape
 * (admission year + 5 digits) but always use the 99xxx block, which is
 * kept for demo records only. The test cases in test-cases.json are added
 * after the twelve students below.
 *
 *   node demo/tools/generate-demo.js
 *
 * The PDFs are drawn from this file by make-pdfs.py, and demo/students.json
 * is then produced by reading those PDFs back through the portal's own
 * import code (build-seed.js), so the demo records match a real import.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const catalog = require(path.join(ROOT, 'data', 'catalog.json'));
const rules = require(path.join(ROOT, 'data', 'rules.json'));
const offering = require(path.join(ROOT, 'data', 'offering.json'));
const E = require(path.join(ROOT, 'src', 'engine.js'));

const byCode = {};
catalog.courses.forEach(c => { byCode[c.code] = c; });
catalog.universityElectives.forEach(c => { if (!byCode[c.code]) byCode[c.code] = Object.assign({ bucket: 'UNIV_ELECTIVE' }, c); });
catalog.genScienceElectives.forEach(c => { if (!byCode[c.code]) byCode[c.code] = Object.assign({ bucket: 'GEN_SCI_ELECTIVE' }, c); });
const plan = k => catalog.courses.filter(c => c.planSem === k).map(c => c.code);

// small seeded random so the dataset is the same on every run
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D'];
function grade(r, level) {
  // level 0 = strong, 1 = average, 2 = weak
  const base = [0.8, 3.6, 6.4][level];
  const i = Math.max(0, Math.min(GRADES.length - 1, Math.round(base + (r() - 0.5) * 3)));
  return GRADES[i];
}

const SEASONS = ['FALL', 'SPRING'];
function termsFrom(season, year, count, summers) {
  const out = [];
  let s = SEASONS.indexOf(season), y = year;
  while (out.length < count) {
    out.push(SEASONS[s] + ' ' + y + '/' + (y + 1));
    if (s === 1 && summers && summers.includes(y + 1)) out.push('SUMMER ' + y + '/' + (y + 1));
    s++; if (s === 2) { s = 0; y++; }
  }
  return out;
}

// Courses added on top of the study plan, per study-plan semester.
const EXTRA = {
  1: ['ENGL001'],
  2: ['ARAB001', 'FREN001'],
  3: ['BLAW001', 'HIST002'],
  4: ['MATH252', 'SPAN001'],
  5: ['DEPT', 'ITAL001'],
  6: ['DEPT', 'DEPT', 'PHYS245', 'HIST004']
};

/* Each student: who they are and what happened to them. The events are the
   cases the demo walks through. */
const STUDENTS = [
  { id: '202599101', name: 'Karim Fouad Haddad', arab: 'كريم فؤاد حداد', nat: 'Lebanese', start: ['FALL', 2025], done: 2, level: 0, note: 'Second-year student, on track' },
  { id: '202499102', name: 'Nour Hassan Khalil', arab: 'نور حسن خليل', nat: 'Lebanese', start: ['FALL', 2024], done: 4, level: 0, track: 'SWE', note: 'Strong student, WRNL200 required (admitted 2024/2025)' },
  { id: '202399103', name: 'Rami Walid Saad', arab: 'رامي وليد سعد', nat: 'Lebanese', start: ['FALL', 2023], done: 6, level: 1, summers: [2025], note: 'Final year, close to graduation, departmental electives counted by credits' },
  { id: '202499104', name: 'Lea Georges Mansour', arab: 'ليا جورج منصور', nat: 'Lebanese', start: ['FALL', 2024], done: 4, level: 1, failRetake: 'CMPS242', note: 'Failed CMPS242 and passed it on the retake' },
  { id: '202399105', name: 'Omar Bilal Fares', arab: 'عمر بلال فارس', nat: 'Syrian', start: ['FALL', 2023], done: 5, level: 1, withdraw: ['CMPS347', 'CMPS344'], noRetake: true, note: 'Withdrew from two core courses, now behind on prerequisites' },
  { id: '202499106', name: 'Maya Samir Azar', arab: 'مايا سمير عازار', nat: 'Lebanese', start: ['FALL', 2024], done: 4, level: 2, fail: ['CMPS248', 'MATH242'], note: 'Low GPA, academic warning, failed courses to repeat' },
  { id: '202499107', name: 'Hadi Mahmoud Nasser', arab: 'هادي محمود ناصر', nat: 'Lebanese', start: ['SPRING', 2024], done: 3, level: 1, note: 'Spring intake, a term behind the standard plan' },
  { id: '202499108', name: 'Yara Nabil Chami', arab: 'يارا نبيل شامي', nat: 'Jordanian', start: ['FALL', 2024], done: 4, level: 1, dminus: 'CMPS346', transfer: ['MATH241', 'CHEM241'], note: 'Transfer credits, and a D- that must be repeated' },
  { id: '202399109', name: 'Ziad Antoine Rahal', arab: 'زياد أنطوان رحال', nat: 'Lebanese', start: ['FALL', 2023], done: 6, level: 0, summers: [2025], track: 'SEC', note: 'Final semester, Cybersecurity track' },
  { id: '202599110', name: 'Sara Elie Tannous', arab: 'سارة إيلي طنوس', nat: 'Lebanese', start: ['FALL', 2025], done: 2, level: 1, campus: 'Debbieh', note: 'Studies at the Debbieh campus' },
  { id: '202499111', name: 'Jana Khaled Moussa', arab: 'جنى خالد موسى', nat: 'Lebanese', start: ['FALL', 2024], done: 4, level: 0, noWrnl: true, note: 'Good standing, WRNL200 still missing' },
  { id: '202599112', name: 'Ali Hussein Hamdan', arab: 'علي حسين حمدان', nat: 'Lebanese', start: ['FALL', 2025], done: 2, level: 2, withdraw: ['MATH242'], note: 'First-year student who withdrew from a course' }
];

const BACC = ['ARAB110', 'BIOL120', 'BIOL121', 'CHEM110', 'ENGL110', 'HIST110', 'MATH110', 'MATH111', 'PHIL110', 'PHYS110'];

const TRACK_ELECTIVES = {
  SWE: ['CMPS326', 'CMPS352', 'CMPS463'],
  SEC: ['CMPS325', 'CMPS354', 'CMPS467'],
  DEFAULT: ['CMPS326', 'CMPS453', 'CMPS470']
};

function build(spec, seed) {
  const r = rng(seed);
  const terms = termsFrom(spec.start[0], spec.start[1], spec.done, spec.summers);
  const regular = terms.filter(t => !t.startsWith('SUMMER'));
  const history = [];
  const electives = (TRACK_ELECTIVES[spec.track] || TRACK_ELECTIVES.DEFAULT).slice();
  const carry = [];   // failed or withdrawn courses taken again later
  const pending = []; // withdrawn and not taken again yet

  // Lebanese Baccalaureate (or equivalent) block: the freshman courses every
  // student is credited with on admission, printed first with TR and flag N
  BACC.forEach(code => {
    const c = byCode[code];
    history.push({ code, title: c.title, cr: c.cr, grade: 'TR', earned: c.cr, term: 'TRANSFER', flag: 'N', block: 'bacc' });
  });
  // courses credited from another university
  (spec.transfer || []).forEach(code => {
    const c = byCode[code];
    history.push({ code, title: c.title, cr: c.cr, grade: 'TR', earned: c.cr, term: 'TRANSFER', flag: 'N', block: 'transfer' });
  });
  const transferred = new Set(spec.transfer || []);

  regular.forEach((term, idx) => {
    // a spring intake follows the same plan, just shifted by a term
    const sem = idx + 1;
    let codes = plan(sem).concat(EXTRA[sem] || []);
    if (sem >= 4 && spec.id >= '202499' && !spec.noWrnl && sem === 4) codes.push('WRNL200');
    codes = codes.map(c => (c === 'DEPT' ? electives.shift() : c)).filter(Boolean);
    // repeats from earlier terms go first
    const again = carry.splice(0);
    codes = again.concat(codes.filter(c => !again.includes(c)));
    codes.forEach(code => {
      if (transferred.has(code)) return;
      const c = byCode[code];
      if (!c) throw new Error('unknown course ' + code);
      let g = grade(r, spec.level);
      const retaking = again.includes(code);
      if (!retaking && spec.failRetake === code) { g = 'F'; carry.push(code); }
      else if (!retaking && (spec.fail || []).includes(code)) { g = 'F'; }
      else if (!retaking && (spec.withdraw || []).includes(code)) { g = 'W'; if (!spec.noRetake) carry.push(code); else pending.push(code); }
      else if (!retaking && spec.dminus === code) { g = 'D-'; }
      if (retaking && spec.level === 2) g = 'C';
      history.push({ code, title: c.title, cr: c.cr, grade: g, earned: 0, term, flag: '' });
    });
  });

  // summer terms: one or two departmental electives or leftovers
  terms.filter(t => t.startsWith('SUMMER')).forEach(term => {
    const code = electives.shift() || 'HIST005';
    const c = byCode[code];
    history.push({ code, title: c.title, cr: c.cr, grade: grade(r, spec.level), earned: 0, term, flag: '' });
  });

  // registrar flags: when a course appears twice, the old attempt is A, the counted one I
  const seen = {};
  history.forEach(h => { (seen[h.code] = seen[h.code] || []).push(h); });
  Object.values(seen).forEach(rows => {
    rows = rows.filter(h => h.term !== 'TRANSFER');
    if (rows.length < 2) return;
    rows.forEach((h, i) => { h.flag = i === rows.length - 1 ? 'I' : 'A'; });
  });

  // earned credits per row, as the registrar prints them (D- counts on the page)
  history.forEach(h => {
    const passing = E.isPassing ? E.isPassing(rules, h.grade) : GRADES.includes(h.grade);
    h.earned = passing || h.grade === 'TR' || (rules.transcriptCreditGrades || []).includes(h.grade) ? h.cr : 0;
  });

  // term totals and running CGPA, the same maths the portal checks against
  const order = Array.from(new Set(history.map(h => h.term)));
  const termTotals = order.filter(t => t !== 'TRANSFER').map(t => {
    const rows = history.filter(h => h.term === t);
    const att = rows.filter(h => !['W', 'AW'].includes(h.grade)).reduce((n, h) => n + h.cr, 0);
    const earned = rows.reduce((n, h) => n + h.earned, 0);
    const g = E.computeGpa(rules, rows);
    return { term: t, attempted: att, earned, sgpa: g.gpa == null ? 0 : g.gpa };
  });
  const live = history.filter(h => h.flag !== 'A');
  const g = E.computeGpa(rules, live);
  const extra = live.reduce((n, h) => n + ((rules.transcriptCreditGrades || []).includes(h.grade) && !E.isPassing(rules, h.grade) ? h.cr : 0), 0);
  const totalCredits = g.earned + extra;

  // this term's schedule (Fall 2026/2027): the next plan semester's courses
  const nextSem = Math.min(regular.length + 1, 6);
  let want = pending.concat(carry, plan(nextSem)).filter(c => !live.some(h => h.code === c && E.isPassing(rules, h.grade)));
  if (regular.length >= 6) want = ['CMPS442', 'CMPS444', 'CMPS343'].concat(electives).filter(c => !live.some(h => h.code === c && E.isPassing(rules, h.grade)));
  if (nextSem === 6) want = want.concat(electives);
  (spec.fail || []).forEach(c => { if (!want.includes(c)) want.unshift(c); });
  if (spec.noWrnl) want.push('WRNL200');
  want = want.slice(0, 6);
  const campusLetter = spec.campus === 'Debbieh' ? 'D' : 'B';
  let crn = 90100 + seed * 10;
  const schedule = want.map(code => {
    const c = byCode[code];
    const sec = offering.sections.find(s => s.code === code && s.section && s.section[0] === campusLetter && s.meetings && s.meetings.length);
    if (sec) return { crn: sec.crn, code, section: sec.section, cr: sec.cr || c.cr, meetings: sec.meetings.map(m => ({ day: m.day, start: m.start, end: m.end })) };
    crn += 1;
    const day = ['MON', 'TUE', 'WED', 'THU', 'FRI'][crn % 5];
    const start = ['08:00', '10:00', '12:00', '14:00'][crn % 4];
    const end = String(Number(start.slice(0, 2)) + 2).padStart(2, '0') + ':00';
    return { crn: String(crn), code, section: campusLetter + '1', cr: c.cr, meetings: [{ day, start, end }] };
  });

  return {
    id: spec.id, name: spec.name, arabName: spec.arab, nationality: spec.nat,
    admission: spec.start[1] + '/' + (spec.start[1] + 1),
    admissionTerm: spec.start[0] + ' ' + spec.start[1] + '/' + (spec.start[1] + 1),
    campus: spec.campus || 'Beirut', note: spec.note,
    history, termTotals, cgpa: g.gpa, totalCredits,
    schedule: { termCode: '202710', term: 'FALL 2026/2027', courses: schedule }
  };
}

// the test cases in test-cases.json (fictional people, built from synthetic
// test PDFs) come after the twelve students above
const out = STUDENTS.map((s, i) => build(s, i + 1))
  .concat(JSON.parse(fs.readFileSync(path.join(__dirname, 'test-cases.json'), 'utf8')));

// every registration is rebuilt the way an advisor would (plan-schedules.js),
// so no student has clashing, repeated, already-passed or over-limit courses
const planRegistration = require('./plan-schedules').plan;
out.forEach((s, i) => {
  const p = planRegistration(s, i);
  if (p.errors.length) throw new Error(s.id + ': ' + p.errors.map(e => e.message).join('; '));
  if (!p.courses.length) throw new Error(s.id + ': no courses could be planned');
  s.schedule = { termCode: '202710', term: 'FALL 2026/2027', courses: p.courses };
});
fs.writeFileSync(path.join(__dirname, 'students-spec.json'), JSON.stringify(out, null, 2));
out.forEach(s => console.log(s.id, s.name.padEnd(22), 'terms', String(s.termTotals.length).padStart(2), 'credits', String(s.totalCredits).padStart(3), 'CGPA', s.cgpa, 'schedule', s.schedule.courses.map(c => c.code).join(' ')));
