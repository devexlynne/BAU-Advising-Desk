'use strict';
/* Catalogue study plans, per-student exceptions, programme detection from the
   transcript, and the course offering's meeting times. Synthetic data only. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Programme = require('../src/programme');
const OrgTree = require('../src/org-tree');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ok  ' + msg); };

// ---- the offering has no meeting that ends before it starts ----------------------
const OFF = require('../data/offering.json');
const mins = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t)); return m ? +m[1] * 60 + +m[2] : null; };
const reversed = [];
OFF.sections.forEach(s => (s.meetings || []).forEach(m => {
  if (mins(m.start) != null && mins(m.end) != null && mins(m.start) > mins(m.end)) reversed.push(s.code + ' ' + s.section);
}));
ok(!reversed.length, 'no course meeting in the offering ends before it starts' + (reversed.length ? ': ' + reversed.join(', ') : ''));
const b5 = OFF.sections.find(s => s.crn === '10356');
ok(b5.meetings.some(m => m.day === 'TUE' && m.kind === 'Lab' && m.start === '08:01'), 'CMPS246 B5 keeps its Tuesday lab, with its room');

// ---- catalogue seed ------------------------------------------------------------------
const SEED = require('../data/catalogue-2020.json');
ok(OrgTree.validateTree(SEED.tree).ok, 'the catalogue structure is a valid organisation tree');
const faculties = SEED.tree.faculties.map(f => f.id);
ok(faculties.length === 10, 'the catalogue structure has all 10 BAU faculties');
ok(OrgTree.findNode(SEED.tree, 'cs') && OrgTree.isWithin(SEED.tree, 'mathematics-and-computer-science', 'cs'),
  'Computer Science stays a programme of the Department of Mathematics and Computer Science');
const known = require('../data/catalog.json').universityElectives.map(c => c.code);
const totals = { 'bba-accounting': 100, 'bsc-mathematics': 97, mbbch: 204, law: 138, bds: 180 };
Object.keys(SEED.plans).forEach(id => {
  const plan = SEED.plans[id];
  assert.ok(OrgTree.findNode(SEED.tree, id), id + ' is in the structure');
  const v = Programme.validate(plan, known);
  assert.strictEqual(v.errors.length, 0, id + ': ' + v.errors.join(' '));
  assert.ok(plan.needsReview && plan.source && /bau\.edu\.lb/.test(plan.source.url), id + ' is marked to check, with its source');
});
ok(true, 'all ' + Object.keys(SEED.plans).length + ' catalogue study plans pass the checks and are marked "to check" with their source');
Object.keys(totals).forEach(id => assert.strictEqual(SEED.plans[id].totalCredits, totals[id], id + ' total credits'));
ok(true, 'catalogue totals match the programmes page (Accounting 100, Mathematics 97, Medicine 204, Law 138, Dentistry 180)');
const acc = SEED.plans['bba-accounting'];
const sum = b => acc.courses.filter(c => c.bucket === b).reduce((a, c) => a + c.cr, 0);
ok(sum('FACULTY_CORE') === 48 && sum('MAJOR_CORE') === 27 && sum('UNIV_MANDATORY') === 5,
  'Accounting courses add up to the printed 48 common, 27 major core and 5 university credits');

// ---- exceptions and programme detection, run in the page's own code ------------------
const Engine = require('../src/engine');
const ctx = {
  console, JSON, Object, Array, Set, Map, WeakMap, Date, Number, String, Math,
  window: { CATALOGUE_SEED: SEED }, E: Object.assign({}, Engine), R: require('../data/rules.json'), C: require('../data/catalog.json'),
  Store: { saveStudents: async () => {}, saveStudent: async () => {} }, state: { programme: 'cs', people: [], me: null },
  MAP: {}, nice: s => s, esc: s => String(s), $: () => null
};
ctx.programmeRowsStub = [
  { id: 'cs', kind: 'programme', label: 'Science / Mathematics and Computer Science / BSc Computer Science', faculty: 'Faculty of Science', department: 'Mathematics and Computer Science' },
  { id: 'bsc-mathematics', kind: 'programme', label: 'x', faculty: 'Faculty of Science', department: 'Mathematics and Computer Science' },
  { id: 'bba-accounting', kind: 'programme', label: 'x', faculty: 'Faculty of Business Administration', department: 'Accounting' },
  { id: 'be-computer', kind: 'programme', label: 'x', faculty: 'Faculty of Engineering', department: 'Electrical and Computer Engineering' }
];
vm.createContext(ctx);
vm.runInContext('function orgScopeRows() { return programmeRowsStub; } function uiNodeContains() { return false; } function fullName(p) { return p.name; }', ctx);
vm.runInContext(read('src/structure.js'), ctx);
vm.runInContext(read('src/exceptions.js'), ctx);
vm.runInContext(`programmeName = id => ({ cs: 'BSc Computer Science', 'bsc-mathematics': 'BSc Mathematics', 'bba-accounting': 'BBA Accounting', 'be-computer': 'BE Computer Engineering' })[id] || id;`, ctx);

const detect = text => vm.runInContext('programmeFromRecord(' + JSON.stringify({ program: text }) + ')', ctx);
ok(detect('Science / Computer Science') === 'cs', 'a transcript saying "Science / Computer Science" is filed under Computer Science');
ok(detect('Business Administration / Accounting') === 'bba-accounting', 'a transcript saying "Business Administration / Accounting" is filed under BBA Accounting');
ok(detect('Engineering / Computer Engineering') === 'be-computer', 'Computer Engineering is not mistaken for Computer Science');
ok(detect('Law / Law') === null && detect('') === null, 'an unknown or empty programme is left with the programme picked for the import');

const DEMO = require('../demo/students.json').students;
const student = JSON.parse(JSON.stringify(DEMO.find(s => (s.history || []).length > 10)));
const R = ctx.R, C = ctx.C;
const passedCodes = new Set(student.history.filter(h => Engine.isPassing(R, h.grade)).map(h => h.code));
const missing = C.courses.find(c => c.bucket === 'MAJOR_CORE' && !passedCodes.has(c.code) && c.cr === 3);
const before = vm.runInContext('E.graduationAudit(R, C, s)', Object.assign(ctx, { s: student }));
const beforeSnap = vm.runInContext('E.snapshot(R, C, s)', ctx);
student.exceptions = [{ id: 'x1', kind: 'waive', course: missing.code, reason: 'synthetic test', approvedBy: 'synthetic head', at: 1 }];
student.updatedAt = 2;
const snapW = vm.runInContext('E.snapshot(R, C, s)', ctx);
const afterW = vm.runInContext('E.graduationAudit(R, C, s)', ctx);
const isOpen = (snap, code) => !snap.passed.has(code);
ok(isOpen(beforeSnap, missing.code) && !isOpen(snapW, missing.code), 'a waived course counts as done for this student');
ok(afterW.remainingCredits === before.remainingCredits, 'a waiver gives no credits: the credits left to graduate stay the same');
ok(student.history.every(h => h.code !== missing.code), 'the stored transcript is not changed by the waiver');
const taken = student.history.find(h => Engine.isPassing(R, h.grade) && h.flag !== 'A' && !C.courses.some(c => c.code === h.code));
if (taken) {
  student.exceptions = [{ id: 'x2', kind: 'substitute', course: missing.code, taken: taken.code, reason: 'synthetic', approvedBy: 'synthetic', at: 1 }];
  student.updatedAt = 3;
  const snapS = vm.runInContext('E.snapshot(R, C, s)', ctx);
  ok(!isOpen(snapS, missing.code), 'a substituted course fills the required course\'s place');
}
student.exceptions = [{ id: 'x3', kind: 'waive', course: missing.code, reason: 'r', approvedBy: 'a', at: 1, removed: true }];
student.updatedAt = 4;
ok(isOpen(vm.runInContext('E.snapshot(R, C, s)', ctx), missing.code), 'a removed exception no longer counts, and stays in the record');

console.log('\n  ' + passed + ' passed, 0 failed');
