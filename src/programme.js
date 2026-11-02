/*
 * programme.js - one study plan per programme.
 * Every programme (BSc Computer Science, BBA Accounting, ...) has its own
 * catalogue: credits, requirement blocks, courses, prerequisites and tracks.
 * University-wide lists (university electives, their categories, campuses)
 * are shared and are not copied into each programme.
 * Used by the server (to refuse a broken study plan) and by the page (to show
 * the same checks while someone is editing).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Programme = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // BAU degrees share this block structure. A block a programme does not use
  // keeps 0 credits, so the advising checks always find every block they ask for.
  const STANDARD_BUCKETS = [
    ['UNIV_MANDATORY', 'University Requirements'],
    ['UNIV_ELECTIVE', 'University Electives'],
    ['FACULTY_CORE', 'Faculty Core'],
    ['MAJOR_CORE', 'Major Core'],
    ['DEPT_ELECTIVE', 'Departmental Electives'],
    ['GEN_SCI_ELECTIVE', 'General Electives'],
    ['FRESHMAN', 'Freshman'],
    ['OTHER', 'Other']
  ];
  const NO_CREDIT_BUCKETS = ['FRESHMAN', 'OTHER'];
  // lists that belong to the whole university, taken from the shared catalogue
  const SHARED_KEYS = ['universityElectives', 'electiveCategories', 'nonDegreeBuckets',
    'campuses', 'bucketsByCatalogYear', 'seasonPolicy'];
  const SEASONS = ['FALL', 'SPRING', 'SUMMER'];
  const CODE = /^[A-Z]{2,6}\d{1,4}[A-Z]?$/;
  // university foundation blocks (remedial, Intensive English, non-credit)
  const NON_DEGREE = ['REMEDIAL', 'INTENSIVE', 'NON_CREDIT'];
  const BUCKET_KEY = /^[A-Z][A-Z0-9_]{1,30}$/;
  const MAX_COURSES = 400;

  const clone = v => JSON.parse(JSON.stringify(v));
  const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
  const codeOf = v => String(v || '').toUpperCase().replace(/\s+/g, '');
  const codeList = v => (Array.isArray(v) ? v : String(v || '').split(/[,;/|]|\s+(?:and|or)\s+|\s+/))
    .map(codeOf).filter(Boolean);

  function blankCatalog(info) {
    const i = info || {};
    const buckets = {};
    STANDARD_BUCKETS.forEach(([k, label]) => { buckets[k] = { label, credits: 0 }; });
    return normalize({
      catalogYear: int(i.catalogYear, new Date().getFullYear()),
      program: String(i.program || i.name || 'New programme'),
      faculty: String(i.faculty || ''),
      department: String(i.department || ''),
      totalCredits: int(i.totalCredits, 100),
      standardSemesters: int(i.standardSemesters, 6),
      maxSemesters: int(i.maxSemesters, 12),
      buckets,
      tracks: {},
      courses: [],
      genScienceElectives: [],
      deptElectiveSlots: [],
      setupStatus: 'draft'
    });
  }

  // A copy of another programme's study plan, renamed, to adapt.
  function copyCatalog(source, info) {
    const out = clone(source || {});
    SHARED_KEYS.forEach(k => { delete out[k]; });
    delete out.history;
    // CS-only extras do not travel to another programme
    delete out.mathMinor; delete out.genSciencePolicy;
    const i = info || {};
    if (i.program || i.name) out.program = String(i.program || i.name);
    if (i.faculty !== undefined) out.faculty = String(i.faculty);
    if (i.department !== undefined) out.department = String(i.department);
    out.setupStatus = 'draft';
    return normalize(out);
  }

  function normalizeCourse(c) {
    const runs = (Array.isArray(c.runsIn) ? c.runsIn : String(c.runsIn || '').split(/[,;/\s]+/))
      .map(s => String(s).toUpperCase()).filter(s => SEASONS.includes(s));
    const out = Object.assign({}, c, {
      code: codeOf(c.code),
      title: String(c.title || '').trim(),
      cr: Number.isFinite(Number(c.cr)) ? Number(c.cr) : 0,
      bucket: String(c.bucket || 'MAJOR_CORE').toUpperCase(),
      pre: codeList(c.pre),
      co: codeList(c.co),
      runsIn: runs.length ? runs : ['FALL', 'SPRING']
    });
    const sem = int(c.planSem, null);
    if (sem) out.planSem = sem; else delete out.planSem;
    return out;
  }

  function normalize(cat) {
    const c = Object.assign({}, cat || {});
    c.program = String(c.program || '').trim();
    c.totalCredits = int(c.totalCredits, 0);
    c.standardSemesters = int(c.standardSemesters, 6);
    c.maxSemesters = int(c.maxSemesters, 12);
    c.catalogYear = int(c.catalogYear, new Date().getFullYear());
    const buckets = Object.assign({}, c.buckets || {});
    STANDARD_BUCKETS.forEach(([k, label]) => {
      if (!buckets[k]) buckets[k] = { label, credits: 0 };
    });
    Object.keys(buckets).forEach(k => {
      const b = buckets[k] || {};
      buckets[k] = Object.assign({}, b, { label: String(b.label || k), credits: int(b.credits, 0) });
    });
    c.buckets = buckets;
    c.courses = (Array.isArray(c.courses) ? c.courses : []).map(normalizeCourse);
    c.tracks = c.tracks && typeof c.tracks === 'object' && !Array.isArray(c.tracks) ? c.tracks : {};
    Object.keys(c.tracks).forEach(k => {
      const t = c.tracks[k] || {};
      c.tracks[k] = Object.assign({}, t, { label: String(t.label || k), courses: codeList(t.courses),
        coursesRequired: int(t.coursesRequired, 3) });
    });
    c.genScienceElectives = Array.isArray(c.genScienceElectives) ? c.genScienceElectives : [];
    c.deptElectiveSlots = Array.isArray(c.deptElectiveSlots) ? c.deptElectiveSlots.map(n => int(n, 0)).filter(Boolean) : [];
    return c;
  }

  // Shared university lists are laid under the programme's own data.
  function withShared(cat, shared) {
    const out = normalize(cat);
    SHARED_KEYS.forEach(k => {
      if (shared && shared[k] !== undefined && out[k] === undefined) out[k] = clone(shared[k]);
    });
    if (!Array.isArray(out.universityElectives)) out.universityElectives = [];
    return out;
  }

  // Programme data as it is saved: shared lists stripped.
  function forStorage(cat) {
    const out = normalize(cat);
    SHARED_KEYS.forEach(k => { delete out[k]; });
    return out;
  }

  function findCycle(courses) {
    const pre = new Map(courses.map(c => [c.code, c.pre || []]));
    const state = new Map();
    let found = null;
    const visit = (code, path) => {
      if (found) return;
      if (state.get(code) === 1) { found = path.slice(path.indexOf(code)).concat(code); return; }
      if (state.get(code) === 2 || !pre.has(code)) return;
      state.set(code, 1);
      pre.get(code).forEach(p => visit(p, path.concat(code)));
      state.set(code, 2);
    };
    courses.forEach(c => visit(c.code, []));
    return found;
  }

  /* errors stop a save, warnings are shown for someone to look at.
     known: extra course codes that exist outside this programme (university
     electives, other programmes), so a prerequisite on them is fine. */
  function validate(cat, known) {
    const errors = [], warnings = [];
    if (!cat || typeof cat !== 'object' || Array.isArray(cat)) return { errors: ['the study plan is missing'], warnings };
    const c = normalize(cat);
    if (!c.program) errors.push('Give the programme a name.');
    if (!(c.totalCredits > 0 && c.totalCredits <= 300)) errors.push('Total credits must be between 1 and 300.');
    if (!(c.standardSemesters >= 1 && c.standardSemesters <= 16)) errors.push('Standard length must be 1 to 16 semesters.');
    if (!(c.maxSemesters >= c.standardSemesters && c.maxSemesters <= 30)) errors.push('Maximum length must be at least the standard length.');
    Object.keys(c.buckets).forEach(k => {
      if (!BUCKET_KEY.test(k)) errors.push('Block "' + k + '" needs a short key in capitals, like MAJOR_CORE.');
      const n = c.buckets[k].credits;
      if (!(n >= 0 && n <= 300)) errors.push(c.buckets[k].label + ': credits must be between 0 and 300.');
    });
    if (c.courses.length > MAX_COURSES) errors.push('A study plan can hold at most ' + MAX_COURSES + ' courses.');
    const seen = new Set();
    c.courses.forEach((x, i) => {
      const where = x.code || 'Row ' + (i + 1);
      if (!CODE.test(x.code)) errors.push(where + ': the course code should look like ACCT201 or CHEM241L.');
      if (seen.has(x.code)) errors.push(x.code + ' is listed twice.');
      seen.add(x.code);
      if (!x.title) warnings.push(where + ' has no title.');
      if (!(x.cr >= 0 && x.cr <= 12)) errors.push(where + ': credits must be between 0 and 12.');
      if (!c.buckets[x.bucket] && !NON_DEGREE.includes(x.bucket)) errors.push(where + ' is in block ' + x.bucket + ', which this programme does not have.');
      if (x.pre.includes(x.code) || x.co.includes(x.code)) errors.push(where + ' cannot require itself.');
      if (x.planSem && (x.planSem < 1 || x.planSem > c.maxSemesters)) errors.push(where + ': planned semester must be 1 to ' + c.maxSemesters + '.');
    });
    const knownSet = new Set((known || []).map(codeOf));
    c.courses.forEach(x => x.pre.concat(x.co).forEach(p => {
      if (!seen.has(p) && !knownSet.has(p)) warnings.push(x.code + ' requires ' + p + ', which is not in this study plan.');
    }));
    const cycle = findCycle(c.courses);
    if (cycle) errors.push('Prerequisites go round in a circle: ' + cycle.join(' → ') + '.');
    const blockSum = Object.keys(c.buckets).filter(k => !NO_CREDIT_BUCKETS.includes(k))
      .reduce((a, k) => a + c.buckets[k].credits, 0);
    if (c.totalCredits > 0 && blockSum !== c.totalCredits) {
      warnings.push('The blocks add up to ' + blockSum + ' credits but the programme needs ' + c.totalCredits + '.');
    }
    ['FACULTY_CORE', 'MAJOR_CORE'].forEach(k => {
      const need = c.buckets[k].credits;
      const listed = c.courses.filter(x => x.bucket === k).reduce((a, x) => a + x.cr, 0);
      if (need > 0 && listed < need) warnings.push(c.buckets[k].label + ' needs ' + need + ' credits but its courses only add up to ' + listed + '.');
    });
    Object.keys(c.tracks).forEach(k => {
      const t = c.tracks[k];
      t.courses.filter(code => !seen.has(code)).forEach(code => warnings.push('Track ' + t.label + ' lists ' + code + ', which is not in this study plan.'));
      if (t.coursesRequired > t.courses.length) errors.push('Track ' + t.label + ' asks for more courses than it lists.');
    });
    if (!c.courses.length) warnings.push('No courses yet. Add them below, or paste them from Excel.');
    return { errors, warnings };
  }

  // Bucket from what someone typed: a key (MAJOR_CORE) or a label (Major core).
  function bucketFrom(text, buckets) {
    const t = String(text || '').trim();
    if (!t) return 'MAJOR_CORE';
    const up = t.toUpperCase().replace(/[\s-]+/g, '_');
    if (buckets[up]) return up;
    const hit = Object.keys(buckets).find(k => String(buckets[k].label).toLowerCase() === t.toLowerCase());
    return hit || up;
  }

  /* Rows pasted from Excel (tab separated) or a CSV file.
     Columns, by header name when there is a header row:
     code, title, credits, block, semester, prerequisites, corequisites, runs in */
  function fromRows(text, buckets) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return { courses: [], skipped: 0 };
    const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
    const split = line => line.split(sep).map(s => s.trim().replace(/^"(.*)"$/, '$1'));
    const NAMES = {
      code: /^(course\s*)?code$|^course$/i, title: /title|name/i, cr: /^(cr|credits?|credit hours?)$/i,
      bucket: /block|bucket|category|type/i, planSem: /sem/i, pre: /pre/i, co: /^co|coreq/i, runsIn: /runs|season|offered/i
    };
    let cols = ['code', 'title', 'cr', 'bucket', 'planSem', 'pre', 'co', 'runsIn'];
    let start = 0;
    const head = split(lines[0]);
    if (!CODE.test(codeOf(head[0]))) {
      cols = head.map(h => Object.keys(NAMES).find(k => NAMES[k].test(h)) || null);
      start = 1;
    }
    const courses = []; let skipped = 0;
    lines.slice(start).forEach(line => {
      const cells = split(line), row = {};
      cols.forEach((k, i) => { if (k && cells[i] !== undefined && cells[i] !== '') row[k] = cells[i]; });
      if (!row.code) { skipped++; return; }
      row.bucket = bucketFrom(row.bucket, buckets || {});
      courses.push(normalizeCourse(row));
    });
    return { courses, skipped };
  }

  return { STANDARD_BUCKETS, SHARED_KEYS, blankCatalog, copyCatalog, normalize, withShared,
    forStorage, validate, fromRows, findCycle };
});
