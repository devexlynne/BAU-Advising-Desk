/*
 * intake.js - reads a faculty set-up workbook (made by
 * scripts/build-intake-workbooks.py) and turns it into what the system keeps:
 * the organisation tree, one study plan per programme, the rule values that
 * differ from the university, and the staff to invite.
 *
 * Nothing here saves anything. It returns a report (errors stop the load,
 * warnings are for someone to read) and the data; the page saves it through
 * the normal routes, so the server checks every piece again.
 * Used by the page ("Load a faculty workbook") and by scripts/intake.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./programme'), require('./org-tree'));
  else root.Intake = factory(root.Programme, root.OrgTree || null);
})(typeof self !== 'undefined' ? self : this, function (Programme, OrgTree) {
  'use strict';

  const FORMAT = 'BAU-INTAKE-1';
  const HEADER_ROW = 4;            // row 5 in Excel
  const FIRST_ROW = 6;             // row 7; row 6 is the example
  const CAMPUSES = ['Beirut', 'Debbieh', 'Tripoli', 'Bekaa'];
  const NON_DEGREE = ['REMEDIAL', 'INTENSIVE', 'NON_CREDIT'];
  const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-'];
  const ROLE_OF = { 'faculty admin': 'faculty-admin', 'programme editor': 'programme-editor', approver: 'approver', advisor: 'advisor', viewer: 'viewer' };
  const OFFERED = { fall: ['FALL'], spring: ['SPRING'], summer: ['SUMMER'], 'fall and spring': ['FALL', 'SPRING'], 'every semester': ['FALL', 'SPRING', 'SUMMER'] };

  /* Rules the system applies by itself, with the key the Rules page uses.
     Anything else in sheet 7 is recorded with the plan and listed for a person. */
  const RULES = {
    LOAD_MIN: { key: 'R.load.REG-LOAD-01.min', type: 'int', min: 0, max: 30 },
    LOAD_MAX: { key: 'R.load.REG-LOAD-01.max', type: 'int', min: 1, max: 30 },
    SUMMER_MAX: { key: 'R.load.REG-LOAD-05.max', type: 'int', min: 0, max: 18 },
    HIGH_LOAD_CGPA: { key: 'R.load.REG-LOAD-02.requiresCgpa', type: 'num', min: 0, max: 4 },
    HIGH_LOAD_EARNED: { key: 'R.load.REG-LOAD-02.requiresEarned', type: 'int', min: 0, max: 300 },
    HIGH_LOAD_MAX: { key: 'R.load.REG-LOAD-02.max', type: 'int', min: 1, max: 30 },
    SENIOR_CGPA: { key: 'R.load.REG-LOAD-03.requiresCgpa', type: 'num', min: 0, max: 4 },
    SENIOR_MAX: { key: 'R.load.REG-LOAD-03.max', type: 'int', min: 1, max: 30 },
    PROBATION_GPA: { key: 'R.probation.warningThresholdCgpa', type: 'num', min: 0, max: 4 },
    PROBATION_CAP: { key: 'R.probation.warningLoadCap', type: 'int', min: 0, max: 30 },
    REMEDIAL_AFTER: { key: 'R.probation.remedialAfter', type: 'int', min: 1, max: 6 },
    REMEDIAL_CAP: { key: 'R.probation.remedialFallSpringCap', type: 'int', min: 0, max: 30 },
    REMEDIAL_SUMMER: { key: 'R.probation.remedialSummerCap', type: 'int', min: 0, max: 18 },
    DISMISS_CGPA: { key: 'R.probation.dismissCgpaBelow', type: 'num', min: 0, max: 4 },
    GRAD_CGPA: { key: 'R.graduation.minCgpa', type: 'num', min: 0, max: 4 },
    IC3_DUE: { key: 'R.nonCredit.REG-UE-06.dueBySemester', type: 'int', min: 1, max: 16 },
    UE_TOTAL: { key: 'R.universityElectives.REG-UE-03.totalCredits', type: 'int', min: 0, max: 40 },
    UE_MIN_HUM: { key: 'R.universityElectives.REG-UE-03.minHumanitiesCourses', type: 'int', min: 0, max: 5 },
    UE_MIN_SOC: { key: 'R.universityElectives.REG-UE-03.minSocialCourses', type: 'int', min: 0, max: 5 },
    WRNL_FROM: { key: 'R.universityElectives.REG-UE-05.appliesFromAdmissionYear', type: 'int', min: 2000, max: 2100 },
    WRNL_AFTER: { key: 'R.universityElectives.REG-UE-05.requiredAboveEarnedCredits', type: 'int', min: 0, max: 300 },
    CORE_AHEAD: { key: 'C.coreAheadSemesters', type: 'int', min: 0, max: 6 },
    ELECTIVE_SLOTS: { key: 'C.deptElectiveSlots', type: 'list' }
  };
  const RECORDED = ['HONOURS_CGPA', 'MIN_GRADE_MAJOR', 'MIN_GRADE_PREREQ', 'ATTENDANCE_AW', 'YEAR_PROGRESSION',
    'INTERNSHIP', 'EXIT_EXAM', 'ENTRY_TEST', 'TRANSFER_MIN_GRADE', 'OTHER'];

  // ---- reading the .xlsx file ------------------------------------------------
  // An .xlsx is a zip of XML files. inflateRaw(bytes) undoes zip compression:
  // zlib.inflateRawSync in Node, DecompressionStream('deflate-raw') in a browser.
  async function unzip(bytes, inflateRaw, wanted) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let end = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error('This is not an Excel (.xlsx) file.');
    const count = dv.getUint16(end + 10, true);
    let p = dv.getUint32(end + 16, true);
    const out = {};
    const dec = new TextDecoder('utf-8');
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The Excel file is damaged.');
      const method = dv.getUint16(p + 10, true);
      const size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), note = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extra + note;
      if (wanted && !wanted(name)) continue;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const raw = b.subarray(start, start + size);
      const data = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
      if (data) out[name] = dec.decode(data);
    }
    return out;
  }

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unxml = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] || m));
  const textOf = xml => { let t = ''; xml.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (m, v) => { t += v; return m; }); return unxml(t); };
  const attr = (s, name) => { const m = new RegExp('\\b' + name + '="([^"]*)"').exec(s); return m ? unxml(m[1]) : null; };
  const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

  /* Returns { 'Sheet name': [[cell, cell, ...], ...] } with the values Excel
     last showed (formulas give their last result). */
  async function readWorkbook(bytes, inflateRaw) {
    const files = await unzip(bytes, inflateRaw, n => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(n));
    if (!files['xl/workbook.xml']) throw new Error('This is not an Excel workbook.');
    const shared = [];
    (files['xl/sharedStrings.xml'] || '').replace(/<si>([\s\S]*?)<\/si>/g, (m, si) => { shared.push(textOf(si)); return m; });
    const rels = {};
    (files['xl/_rels/workbook.xml.rels'] || '').replace(/<Relationship\b[^>]*>/g, m => { rels[attr(m, 'Id')] = attr(m, 'Target'); return m; });
    const book = {};
    files['xl/workbook.xml'].replace(/<sheet\b[^>]*>/g, m => {
      const target = String(rels[attr(m, 'r:id')] || '').replace(/^\/?(xl\/)?/, '');
      const xml = files['xl/' + target];
      if (xml) book[attr(m, 'name')] = sheetRows(xml, shared);
      return m;
    });
    return book;
  }

  function sheetRows(xml, shared) {
    const rows = [];
    xml.replace(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, (m, ra, body) => {
      const r = parseInt(attr(ra, 'r'), 10) - 1;
      const cells = [];
      (body || '').replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (cm, ca, inner) => {
        const ref = attr(ca, 'r');
        if (!ref || !inner) return cm;
        const t = attr(ca, 't');
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        let value = '';
        if (t === 's') value = v ? shared[parseInt(v[1], 10)] || '' : '';
        else if (t === 'inlineStr') value = textOf(inner);
        else if (t === 'str' || t === 'e') value = v ? unxml(v[1]) : '';
        else if (t === 'b') value = v ? v[1] === '1' : '';
        else value = v && v[1] !== '' ? Number(v[1]) : '';
        cells[colIndex(ref)] = value;
        return cm;
      });
      rows[r] = cells;
      return m;
    });
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  // ---- small helpers ---------------------------------------------------------
  const txt = v => (v === null || v === undefined ? '' : String(v)).trim();
  const num = v => { const s = txt(v); if (!s) return null; const n = Number(s.replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
  const slug = s => txt(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const code = s => txt(s).toUpperCase().replace(/\s+/g, '');
  const yes = v => /^(yes|y|true|1|نعم)$/i.test(txt(v));
  const no = v => /^(no|n|false|0|لا)$/i.test(txt(v));
  const clone = v => JSON.parse(JSON.stringify(v));

  /* "MATH241, CHEM241" = both; "MATH241 OR MATH243" = one of them. */
  function prerequisites(text) {
    const all = [], oneOf = [];
    txt(text).split(/[,;]+/).map(s => s.trim()).filter(Boolean).forEach(part => {
      const options = part.split(/\s+or\s+|\//i).map(code).filter(Boolean);
      if (options.length > 1) oneOf.push(options); else if (options[0]) all.push(options[0]);
    });
    return { all, oneOf };
  }

  // a sheet as objects keyed by the header names in row 5
  function table(book, name, required, report) {
    const rows = book[name];
    if (!rows) { report.errors.push('Sheet "' + name + '" is missing. Was it renamed?'); return []; }
    const head = (rows[HEADER_ROW] || []).map(h => txt(h).toLowerCase());
    const missing = required.filter(h => !head.includes(h.toLowerCase()));
    if (missing.length) { report.errors.push('Sheet "' + name + '" has no column ' + missing.map(m => '"' + m + '"').join(', ') + '. Columns must keep their names.'); return []; }
    const out = [];
    for (let r = FIRST_ROW; r < rows.length; r++) {
      const cells = rows[r] || [];
      if (!cells.some(c => txt(c) !== '')) continue;
      const row = { _row: r + 1 };
      head.forEach((h, i) => { if (h) row[h] = cells[i]; });
      out.push(row);
    }
    return out;
  }
  const get = (row, name) => row[name.toLowerCase()];

  // ---- the workbook to the system ----------------------------------------------
  /* ctx: { tree, people: [{email}], known: [course codes outside the programme],
            fileName, now } */
  function fromWorkbook(book, ctx) {
    const c = ctx || {};
    const report = { errors: [], warnings: [], notes: [] };
    const now = c.now || Date.now();
    const lists = book.Lists || [];
    if (txt((lists[1] || [])[24]) !== FORMAT) {
      report.errors.push('This is not a faculty set-up workbook (format ' + FORMAT + '). Use the workbook the system administrator sent.');
      return { report };
    }
    const facultyId = txt((lists[2] || [])[24]);

    // 1 Faculty: question / answer pairs
    const facultyInfo = {};
    (book['1 Faculty'] || []).slice(HEADER_ROW + 1).forEach(r => { if (r && txt(r[0])) facultyInfo[txt(r[0])] = txt(r[1]); });
    const facultyName = facultyInfo['Faculty name (English)'];
    if (!facultyName) report.errors.push('Sheet 1: give the faculty name.');
    const workbookYear = parseInt(facultyInfo['Catalogue year these answers describe'], 10) || null;

    const tree = clone(c.tree || (OrgTree && OrgTree.DEFAULT_TREE) || { id: 'bau', name: 'Beirut Arab University', faculties: [] });
    const elsewhere = new Map();     // id -> faculty id, for ids outside this faculty
    (tree.faculties || []).forEach(f => {
      if (f.id !== facultyId) {
        elsewhere.set(f.id, f.id);
        (f.departments || []).forEach(d => { elsewhere.set(d.id, f.id); (d.programmes || []).forEach(p => elsewhere.set(p.id, f.id)); });
      }
    });
    let faculty = tree.faculties.find(f => f.id === facultyId);
    if (!faculty) {
      if (elsewhere.has(facultyId)) report.errors.push('The faculty ID ' + facultyId + ' is already used by something else.');
      faculty = { id: facultyId, name: facultyName || facultyId, departments: [] };
      tree.faculties.push(faculty);
      report.notes.push('New faculty: ' + faculty.name + '.');
    }
    if (facultyName && faculty.name !== facultyName) { report.notes.push('Faculty renamed to ' + facultyName + '.'); faculty.name = facultyName; }
    if (facultyInfo['Faculty name (Arabic)']) faculty.nameAr = facultyInfo['Faculty name (Arabic)'];
    const taken = id => elsewhere.has(id) ? 'already used in another faculty' : null;

    // 2 Departments
    table(book, '2 Departments', ['Department ID', 'Department name (English)', 'Action'], report).forEach(r => {
      const name = txt(get(r, 'Department name (English)'));
      const id = txt(get(r, 'Department ID')) || slug(name);
      const where = 'Sheet 2, row ' + r._row;
      if (!id) { report.errors.push(where + ': give the department a name.'); return; }
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) { report.errors.push(where + ': the ID "' + id + '" may only use lowercase letters, digits and dashes.'); return; }
      if (taken(id)) { report.errors.push(where + ': the ID ' + id + ' is ' + taken(id) + '.'); return; }
      const have = faculty.departments.find(d => d.id === id);
      if (/^remove$/i.test(txt(get(r, 'Action')))) {
        if (have) report.warnings.push(where + ': ' + have.name + ' is marked Remove. Nothing is removed by an import; remove it in University structure once it is empty.');
        return;
      }
      if (!have) {
        if (!name) { report.errors.push(where + ': give the department a name.'); return; }
        faculty.departments.push(Object.assign({ id, name, programmes: [] }, txt(get(r, 'Department name (Arabic)')) ? { nameAr: txt(get(r, 'Department name (Arabic)')) } : {}));
        report.notes.push('New department: ' + name + '.');
      } else {
        if (name && have.name !== name) { report.notes.push('Department ' + have.name + ' renamed to ' + name + '.'); have.name = name; }
        if (txt(get(r, 'Department name (Arabic)'))) have.nameAr = txt(get(r, 'Department name (Arabic)'));
      }
    });

    // 3 Programmes
    const programmes = [];
    table(book, '3 Programmes', ['Programme ID', 'Department ID', 'Degree name (English)', 'Total credits', 'Standard semesters', 'Maximum semesters', 'Action', 'Status'], report).forEach(r => {
      const name = txt(get(r, 'Degree name (English)'));
      const id = txt(get(r, 'Programme ID')) || slug(name);
      const where = 'Sheet 3, row ' + r._row;
      if (!id) { report.errors.push(where + ': give the programme a name.'); return; }
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) { report.errors.push(where + ': the ID "' + id + '" may only use lowercase letters, digits and dashes.'); return; }
      if (taken(id)) { report.errors.push(where + ': the ID ' + id + ' is ' + taken(id) + '.'); return; }
      const deptId = txt(get(r, 'Department ID'));
      const dept = faculty.departments.find(d => d.id === deptId);
      let node = null, from = null;
      faculty.departments.forEach(d => (d.programmes || []).forEach(p => { if (p.id === id) { node = p; from = d; } }));
      if (/^remove$/i.test(txt(get(r, 'Action')))) {
        if (node) report.warnings.push(where + ': ' + node.name + ' is marked Remove. Nothing is removed by an import; a programme with students or a study plan has to be retired by hand.');
        return;
      }
      if (!dept) { report.errors.push(where + ': ' + (deptId ? 'department ' + deptId + ' is not in sheet 2.' : 'say which department the programme belongs to.')); return; }
      if (!name && !node) { report.errors.push(where + ': give the degree name.'); return; }
      const campuses = txt(get(r, 'Campuses')).split(/[,;/]+/).map(s => s.trim()).filter(Boolean)
        .map(s => CAMPUSES.find(k => k.toLowerCase() === s.toLowerCase()) || s);
      campuses.filter(k => !CAMPUSES.includes(k)).forEach(k => report.warnings.push(where + ': "' + k + '" is not one of the four campuses.'));
      if (!node) {
        node = { id, name };
        dept.programmes.push(node);
        report.notes.push('New programme: ' + name + ' in ' + dept.name + '.');
      } else {
        if (from !== dept) {
          from.programmes = from.programmes.filter(p => p !== node);
          dept.programmes.push(node);
          report.notes.push(node.name + ' moved from ' + from.name + ' to ' + dept.name + '.');
        }
        if (name && node.name !== name) { report.notes.push(node.name + ' renamed to ' + name + '.'); node.name = name; }
      }
      if (txt(get(r, 'Degree name (Arabic)'))) node.nameAr = txt(get(r, 'Degree name (Arabic)'));
      if (campuses.length) node.campuses = campuses;
      programmes.push({ id, node, dept, row: r });
    });
    const progIds = new Set(programmes.map(p => p.id));

    // 4 Blocks, 5 Courses, 6 Lists
    const blocks = table(book, '4 Blocks', ['Programme ID', 'Block key', 'Block name as printed', 'Credits required', 'Counts toward the degree'], report);
    const courses = table(book, '5 Courses', ['Programme ID', 'Course code', 'Course title (English)', 'Credits', 'Block key', 'Prerequisites'], report);
    const listRows = table(book, '6 Lists and tracks', ['Programme ID', 'List key', 'List name', 'List type', 'Course code'], report);
    const checkId = (id, where, allowAll) => {
      if (allowAll && id === 'ALL') return true;
      if (progIds.has(id)) return true;
      report.errors.push(where + ': programme ' + (id || '(blank)') + ' is not in sheet 3.');
      return false;
    };
    blocks.forEach(r => checkId(txt(get(r, 'Programme ID')), 'Sheet 4, row ' + r._row));
    courses.forEach(r => checkId(txt(get(r, 'Programme ID')), 'Sheet 5, row ' + r._row, true));
    listRows.forEach(r => checkId(txt(get(r, 'Programme ID')), 'Sheet 6, row ' + r._row));

    const toCourse = r => {
      const pre = prerequisites(get(r, 'Prerequisites'));
      const co = prerequisites(get(r, 'Corequisites'));
      const offered = OFFERED[txt(get(r, 'Usually offered')).toLowerCase()];
      const out = {
        code: code(get(r, 'Course code')),
        title: txt(get(r, 'Course title (English)')),
        cr: num(get(r, 'Credits')),
        bucket: txt(get(r, 'Block key')).toUpperCase().replace(/[\s-]+/g, '_') || 'MAJOR_CORE',
        pre: pre.all,
        co: co.all.concat(...co.oneOf),
        runsIn: offered || ['FALL', 'SPRING']
      };
      if (pre.oneOf.length) out.preOneOf = pre.oneOf;
      const sem = num(get(r, 'Plan semester'));
      if (sem) out.planSem = sem;
      const ar = txt(get(r, 'Course title (Arabic)'));
      if (ar) out.titleAr = ar;
      const earned = num(get(r, 'Credits earned before registering'));
      if (earned) out.minEarned = earned;
      const grade = txt(get(r, 'Lowest passing grade (if not D)')).toUpperCase();
      if (grade && grade !== 'D') out.minGrade = grade;
      if (no(get(r, 'Counts in GPA'))) out.noGpa = true;
      const kind = txt(get(r, 'Course type'));
      if (kind) out.kind = kind;
      const note = txt(get(r, 'Notes'));
      if (note) out.note = note;
      return { course: out, row: r };
    };

    // 7 Rules: ALL first, then each programme's own value on top
    const ruleRows = table(book, '7 Rules', ['Applies to', 'Rule ID', 'Faculty value', 'Where it is written'], report)
      .filter(r => txt(get(r, 'Faculty value')) !== '');
    const rulesFor = {};
    const recorded = {};
    programmes.forEach(p => { rulesFor[p.id] = {}; recorded[p.id] = []; });
    ruleRows.sort((a, b) => (txt(get(a, 'Applies to')) === 'ALL' ? 0 : 1) - (txt(get(b, 'Applies to')) === 'ALL' ? 0 : 1)).forEach(r => {
      const where = 'Sheet 7, row ' + r._row;
      const target = txt(get(r, 'Applies to')) || 'ALL';
      if (!checkId(target, where, true)) return;
      const id = txt(get(r, 'Rule ID')).toUpperCase();
      const raw = txt(get(r, 'Faculty value'));
      const source = txt(get(r, 'Where it is written'));
      if (!source) report.warnings.push(where + ': ' + id + ' differs from the university but does not say where it is written.');
      const ids = target === 'ALL' ? [...progIds] : [target];
      const spec = RULES[id];
      if (!spec) {
        if (!RECORDED.includes(id)) { report.errors.push(where + ': unknown rule ID ' + (id || '(blank)') + '.'); return; }
        if (/GRADE/.test(id) && !GRADES.includes(raw.toUpperCase())) { report.errors.push(where + ': ' + id + ' needs a letter grade such as C or C-.'); return; }
        ids.forEach(pid => {
          recorded[pid] = recorded[pid].filter(x => x.rule !== id || id === 'OTHER');
          recorded[pid].push({ rule: id, value: raw, source, note: txt(get(r, 'Notes')) });
        });
        return;
      }
      let value;
      if (spec.type === 'list') {
        value = raw.split(/[,;\s]+/).map(Number).filter(n => Number.isInteger(n) && n > 0);
        if (!value.length) { report.errors.push(where + ': ' + id + ' needs semester numbers such as 4, 5, 6.'); return; }
      } else {
        value = num(raw);
        if (!Number.isFinite(value) || value < spec.min || value > spec.max || (spec.type === 'int' && !Number.isInteger(value))) {
          report.errors.push(where + ': ' + id + ' must be a ' + (spec.type === 'int' ? 'whole number' : 'number') + ' from ' + spec.min + ' to ' + spec.max + '.');
          return;
        }
      }
      ids.forEach(pid => { rulesFor[pid][spec.key] = { value, rule: id, source }; });
    });

    // the study plans
    const plans = {};
    programmes.forEach(p => {
      const mine = blocks.filter(r => txt(get(r, 'Programme ID')) === p.id);
      const own = courses.filter(r => txt(get(r, 'Programme ID')) === p.id);
      const shared = courses.filter(r => txt(get(r, 'Programme ID')) === 'ALL');
      const untouched = !own.length && mine.every(b => txt(get(b, 'Credits required')) === '');
      if (!mine.length && !own.length || untouched) {
        report.warnings.push(p.node.name + ': not filled in yet (no credits or courses), so its study plan is left as it is.');
        return;
      }
      const r = p.row;
      const where = p.node.name;
      const buckets = {};
      mine.forEach(b => {
        const key = txt(get(b, 'Block key')).toUpperCase().replace(/[\s-]+/g, '_');
        const credits = num(get(b, 'Credits required'));
        const counts = !no(get(b, 'Counts toward the degree'));
        if (!key) { report.errors.push('Sheet 4, row ' + b._row + ': give a block key.'); return; }
        if (buckets[key]) { report.errors.push('Sheet 4, row ' + b._row + ': ' + where + ' lists block ' + key + ' twice.'); return; }
        if (!Number.isFinite(credits)) { report.errors.push('Sheet 4, row ' + b._row + ': give the credits of ' + key + ' (0 if none).'); return; }
        if (!counts && credits > 0) report.warnings.push('Sheet 4, row ' + b._row + ': ' + key + ' does not count toward the degree but asks for ' + credits + ' credits.');
        if (!counts && NON_DEGREE.includes(key)) return;      // the system already knows these
        buckets[key] = { label: txt(get(b, 'Block name as printed')) || key, credits };
        const how = txt(get(b, 'How courses are chosen'));
        if (how) buckets[key].chosen = how;
        const pass = num(get(b, 'Courses to pass (if a number)'));
        if (pass) buckets[key].coursesRequired = pass;
        if (!counts) buckets[key].countsTowardDegree = false;
      });
      const byCode = new Map();
      shared.concat(own).map(toCourse).forEach(({ course, row }) => {
        if (byCode.has(course.code) && txt(get(row, 'Programme ID')) !== 'ALL' && byCode.get(course.code).fromAll) byCode.delete(course.code);
        else if (byCode.has(course.code)) { report.errors.push('Sheet 5, row ' + row._row + ': ' + course.code + ' is listed twice for ' + where + '.'); return; }
        if (!Number.isFinite(course.cr)) report.errors.push('Sheet 5, row ' + row._row + ': ' + course.code + ' needs its credits.');
        if (course.minGrade && !GRADES.includes(course.minGrade)) report.errors.push('Sheet 5, row ' + row._row + ': ' + course.minGrade + ' is not a grade.');
        if (course.preOneOf) report.warnings.push(where + ': ' + course.code + ' needs one of ' + course.preOneOf.map(g => g.join(' or ')).join('; ') + '. Kept with the plan; advisors check this one by hand for now.');
        byCode.set(course.code, Object.assign(course, { fromAll: txt(get(row, 'Programme ID')) === 'ALL' }));
      });
      const plannedCourses = [...byCode.values()].map(x => { const y = Object.assign({}, x); delete y.fromAll; return y; });
      const tracks = {}, otherLists = {};
      listRows.filter(x => txt(get(x, 'Programme ID')) === p.id).forEach(x => {
        const key = txt(get(x, 'List key')).toUpperCase().replace(/[\s-]+/g, '_');
        const type = txt(get(x, 'List type')) || 'Elective list';
        if (!key) { report.errors.push('Sheet 6, row ' + x._row + ': give the list a key.'); return; }
        const into = /^track$/i.test(type) ? tracks : otherLists;
        const list = into[key] || (into[key] = { label: txt(get(x, 'List name')) || key, type, courses: [] });
        const need = num(get(x, 'Courses to pass from the list'));
        if (need) list.coursesRequired = need;
        const credits = num(get(x, 'Credits to pass from the list'));
        if (credits) list.creditsRequired = credits;
        const cc = code(get(x, 'Course code'));
        if (cc && !list.courses.includes(cc)) list.courses.push(cc);
      });
      Object.keys(tracks).forEach(k => { if (!tracks[k].coursesRequired) tracks[k].coursesRequired = Math.min(3, tracks[k].courses.length); });

      const status = [r].concat(mine, own).filter(x => /^to check$/i.test(txt(get(x, 'Status')))).length;
      const signoff = (book['11 Sign-off'] || []).slice(HEADER_ROW + 1, HEADER_ROW + 5).map(x => ({ step: txt((x || [])[0]), name: txt((x || [])[1]), email: txt((x || [])[2]), date: txt((x || [])[3]) }));
      const plan = Programme.normalize({
        catalogYear: num(get(r, 'Catalogue year')) || workbookYear || new Date(now).getFullYear(),
        program: p.node.name,
        faculty: faculty.name,
        department: p.dept.name,
        totalCredits: num(get(r, 'Total credits')),
        standardSemesters: num(get(r, 'Standard semesters')),
        maxSemesters: num(get(r, 'Maximum semesters')),
        buckets,
        tracks,
        courses: plannedCourses,
        genScienceElectives: [],
        deptElectiveSlots: [],
        setupStatus: 'draft',
        needsReview: status > 0,
        source: {
          catalogue: 'Faculty set-up workbook',
          file: txt(c.fileName),
          importedAt: now,
          note: status ? status + ' row(s) were still marked "To check" in the workbook.' : 'Every row was marked checked in the workbook.'
        },
        intake: {
          format: FORMAT,
          degreeType: txt(get(r, 'Degree type')),
          language: txt(get(r, 'Language of teaching')),
          studySystem: txt(get(r, 'Study system')),
          admitsNewStudents: !no(get(r, 'Admits new students')),
          contact: txt(get(r, 'Programme contact (email)')),
          lists: otherLists,
          rules: recorded[p.id],
          signoff
        }
      });
      if (!Object.keys(buckets).length) report.errors.push(where + ': sheet 4 has no blocks for it.');
      const v = Programme.validate(plan, c.known || []);
      v.errors.forEach(e => report.errors.push(where + ': ' + e));
      v.warnings.forEach(w => report.warnings.push(where + ': ' + w));
      if (status) report.warnings.push(where + ': ' + status + ' row(s) still say "To check". It loads, marked to check.');
      plans[p.id] = plan;
    });

    // 8 People
    const known = new Set((c.people || []).map(x => txt(x.email).toLowerCase()));
    const scopes = new Set([faculty.id].concat(faculty.departments.map(d => d.id), [...progIds]));
    const people = [];
    table(book, '8 People', ['Full name', 'BAU email', 'Role', 'Scope'], report).forEach(r => {
      const where = 'Sheet 8, row ' + r._row;
      const email = txt(get(r, 'BAU email')).toLowerCase();
      const name = txt(get(r, 'Full name'));
      const role = ROLE_OF[txt(get(r, 'Role')).toLowerCase()];
      const scope = txt(get(r, 'Scope')) || faculty.id;
      const also = txt(get(r, 'Also advises students in'));
      if (!/^[^@\s]+@bau\.edu\.lb$/.test(email)) { report.errors.push(where + ': ' + (name || 'this person') + ' needs a @bau.edu.lb email.'); return; }
      if (!name) { report.errors.push(where + ': give the full name.'); return; }
      if (!role) { report.errors.push(where + ': pick a role from the list.'); return; }
      if (!scopes.has(scope)) { report.errors.push(where + ': the scope ' + scope + ' is not this faculty, one of its departments or programmes.'); return; }
      if (also && !progIds.has(also)) { report.errors.push(where + ': ' + also + ' is not a programme in sheet 3.'); return; }
      if (people.some(x => x.person.email === email)) { report.errors.push(where + ': ' + email + ' is listed twice.'); return; }
      const roles = [{ role, scopes: [scope] }];
      if (also && role !== 'advisor') roles.push({ role: 'advisor', scopes: [also] });
      const deptOf = faculty.departments.find(d => d.id === scope || (d.programmes || []).some(x => x.id === scope));
      people.push({
        person: { slug: email.split('@')[0].replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60), name, title: txt(get(r, 'Title')), email,
          faculty: faculty.name, department: deptOf ? deptOf.name : '' },
        roles,
        existing: known.has(email)
      });
    });

    const approvals = table(book, '9 Approvals', ['Exception', 'Proposed by', 'Approved by'], report)
      .filter(r => txt(get(r, 'Approved by')))
      .map(r => ({ exception: txt(get(r, 'Exception')), proposedBy: txt(get(r, 'Proposed by')), approvedBy: txt(get(r, 'Approved by')),
        deanSigns: yes(get(r, 'Dean also signs')), reasonRequired: yes(get(r, 'Reason required')), condition: txt(get(r, 'Limit or condition')),
        source: txt(get(r, 'Where it is written')) }));
    Object.values(plans).forEach(p => { p.intake.approvals = approvals; });
    const questions = table(book, '10 Questions', ['Question or note', 'Answer'], report)
      .map(r => ({ sheet: txt(get(r, 'Sheet')), about: txt(get(r, 'Row or course')), question: txt(get(r, 'Question or note')), answer: txt(get(r, 'Answer')) }))
      .filter(q => q.question);
    const open = questions.filter(q => !q.answer).length;
    if (open) report.warnings.push(open + ' question(s) in sheet 10 have no answer yet.');
    const signed = (book['11 Sign-off'] || [])[HEADER_ROW + 3] || [];
    if (!txt(signed[1])) report.warnings.push('The dean has not signed sheet 11 yet.');

    if (OrgTree && OrgTree.validateTree) {
      const ok = OrgTree.validateTree(tree);
      if (!ok.ok) report.errors.push('The structure would not be valid: ' + ok.error);
    }

    const rules = {};
    Object.keys(rulesFor).forEach(id => {
      if (Object.keys(rulesFor[id]).length) rules[id] = rulesFor[id];
    });
    return { report, facultyId, facultyName: faculty.name, facultyInfo, tree, plans, rules, people, approvals, questions };
  }

  /* Lays the imported rule values on top of a programme's saved rules config,
     with a history entry so the Rules page can show and undo it. */
  function mergeRules(cfg, imported, by, reason) {
    const before = cfg && typeof cfg === 'object' ? cfg : { values: {}, courses: {}, removed: [], history: [] };
    const values = Object.assign({}, before.values || {});
    const changes = [];
    Object.keys(imported || {}).forEach(key => {
      const v = imported[key].value;
      if (JSON.stringify(values[key]) !== JSON.stringify(v)) {
        changes.push(imported[key].rule + ': ' + (Array.isArray(v) ? v.join(', ') : v) + (imported[key].source ? ' (' + imported[key].source + ')' : ''));
        values[key] = v;
      }
    });
    if (!changes.length) return null;
    const entry = { at: Date.now(), by, reason, changes,
      before: { values: before.values || {}, courses: before.courses || {}, removed: before.removed || [], terms: before.terms } };
    return Object.assign({}, before, { values, history: [entry].concat(before.history || []).slice(0, 200) });
  }

  return { FORMAT, RULES, RECORDED, unzip, readWorkbook, fromWorkbook, mergeRules, prerequisites };
});
