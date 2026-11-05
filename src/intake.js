/*
 * intake.js - reads a programme's study-plan file (one sheet, made by
 * scripts/build-intake-workbooks.py) and turns it into what the system keeps:
 * the programme in the organisation tree, its study plan, the rule values
 * that differ from the university, and the staff to invite.
 *
 * Nothing here saves anything. It returns a report (errors stop the load,
 * warnings are for someone to read) and the data; the page saves it through
 * the normal routes, so the server checks every piece again.
 * Used by the page ("Load study-plan files") and by scripts/intake.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./programme'), require('./org-tree'), require('../data/intake-rules.json'));
  else root.Intake = factory(root.Programme, root.OrgTree || null, root.INTAKE_SPEC);
})(typeof self !== 'undefined' ? self : this, function (Programme, OrgTree, SPEC) {
  'use strict';

  const FORMAT = SPEC.format;
  const SHEET = 'Study plan';
  const SECTIONS = ['1. Programme', '2. Requirement blocks', '3. Rules that are different for this programme',
    '4. People who advise or edit this programme', '5. Courses'];
  const CAMPUSES = ['Beirut', 'Debbieh', 'Tripoli', 'Bekaa'];
  const NON_DEGREE = ['REMEDIAL', 'INTENSIVE', 'NON_CREDIT'];
  const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-'];
  const ROLE_OF = { advisor: 'advisor', 'programme editor': 'programme-editor' };
  const OFFERED = { fall: ['FALL'], spring: ['SPRING'], summer: ['SUMMER'], 'fall and spring': ['FALL', 'SPRING'], 'every semester': ['FALL', 'SPRING', 'SUMMER'] };
  // study-plan details the file does not ask about, kept from the plan already in the system
  const KEEP = ['tracks', 'genScienceElectives', 'deptElectiveSlots', 'mathMinor', 'genSciencePolicy', 'deptElectiveShowMax', 'coreAheadSemesters'];

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

  const blockKey = label => {
    const t = txt(label).toLowerCase();
    const hit = SPEC.blocks.find(b => b.label.toLowerCase() === t || b.key.toLowerCase() === t);
    return hit ? hit.key : txt(label).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
  };

  // rows of one section: from the row after its title (plus skip) to the next section title
  function sectionRows(rows, index, skip) {
    const titles = SECTIONS.map(s => s.toLowerCase());
    const at = rows.findIndex(r => r && txt(r[0]).toLowerCase() === titles[index]);
    if (at < 0) return null;
    const out = [];
    for (let r = at + 1 + skip; r < rows.length; r++) {
      const cells = rows[r] || [];
      if (titles.includes(txt(cells[0]).toLowerCase())) break;
      out.push({ cells, row: r + 1 });
    }
    return out;
  }

  /* One file = one programme.
     ctx: { tree, people: [{email}], known: [course codes outside the programme], fileName, now } */
  function fromWorkbook(book, ctx) {
    const c = ctx || {};
    const report = { errors: [], warnings: [], notes: [] };
    const now = c.now || Date.now();
    const lists = book.Lists || [];
    const rows = book[SHEET];
    if (!rows || txt((lists[1] || [])[24]) !== FORMAT) {
      report.errors.push('This is not a study-plan file from the advising system. Use the file that was sent to the department.');
      return { report };
    }
    const facultyId = txt((lists[1] || [])[25]);
    const givenId = txt((lists[2] || [])[25]);
    const parts = SECTIONS.map((s, i) => sectionRows(rows, i, [0, 1, 1, 1, 2][i]));
    const missing = SECTIONS.filter((s, i) => !parts[i]);
    if (missing.length) {
      report.errors.push('These section titles were changed or removed: ' + missing.join(', ') + '. Put them back as they were.');
      return { report };
    }

    // 1. Programme: label in column A, answer in column C
    const info = {};
    parts[0].forEach(({ cells }) => { if (txt(cells[0])) info[txt(cells[0]).toLowerCase()] = cells[2]; });
    const field = name => info[name.toLowerCase()];
    const name = txt(field('Programme name (English)'));
    const deptName = txt(field('Department'));
    const total = num(field('Total credits to graduate'));
    const standard = num(field('Standard length (semesters)'));
    const maximum = num(field('Maximum length (semesters)'));
    const confirmed = yes(field('Everything on this sheet is correct'));
    if (!name) report.errors.push('Section 1: give the programme name.');
    if (!deptName) report.errors.push('Section 1: give the department.');
    if (!(total > 0)) report.errors.push('Section 1: give the total credits to graduate.');
    if (!(standard > 0)) report.errors.push('Section 1: give the standard length in semesters.');
    if (!(maximum > 0)) report.errors.push('Section 1: give the maximum length in semesters.');
    else if (standard > 0 && maximum > 2 * standard) report.warnings.push('Section 1: the maximum length is more than double the standard length (R&R VIII.1).');
    if (!confirmed) report.warnings.push('The file does not say "Yes" to "Everything on this sheet is correct", so the plan loads marked "to check".');

    // where it sits in the structure
    const tree = clone(c.tree || (OrgTree && OrgTree.DEFAULT_TREE) || { id: 'bau', name: 'Beirut Arab University', faculties: [] });
    const faculty = (tree.faculties || []).find(f => f.id === facultyId);
    if (!faculty) {
      report.errors.push('The faculty of this file (' + (txt(field('Faculty')) || facultyId) + ') is not in the system yet. Add it in University structure first.');
      return { report };
    }
    const owner = new Map();
    tree.faculties.forEach(f => (f.departments || []).forEach(d => { owner.set(d.id, f.id); (d.programmes || []).forEach(p => owner.set(p.id, f.id)); }));
    let dept = deptName && faculty.departments.find(d => d.name.toLowerCase() === deptName.toLowerCase());
    if (deptName && !dept) {
      const id = slug(deptName);
      if (owner.has(id) && owner.get(id) !== faculty.id) { report.errors.push('Section 1: a department called ' + deptName + ' already belongs to another faculty.'); }
      else {
        dept = faculty.departments.find(d => d.id === id) || null;
        if (!dept) { dept = { id, name: deptName, programmes: [] }; faculty.departments.push(dept); report.notes.push('New department: ' + deptName + '.'); }
      }
    }
    const id = givenId || slug(name);
    if (!givenId && id && owner.has(id) && owner.get(id) !== faculty.id) report.errors.push('Another faculty already has a programme with the ID ' + id + '. Change the name slightly.');
    let node = null, from = null;
    faculty.departments.forEach(d => (d.programmes || []).forEach(p => { if (p.id === id) { node = p; from = d; } }));
    if (givenId && !node && owner.has(givenId)) report.errors.push('This file belongs to a programme that is now in another faculty. Ask for a new file.');
    const isNew = !node;
    if (dept && id && !report.errors.length) {
      if (!node) {
        node = { id, name };
        dept.programmes.push(node);
        report.notes.push('New programme: ' + name + ' in ' + dept.name + '.');
      } else {
        if (from !== dept) { from.programmes = from.programmes.filter(p => p !== node); dept.programmes.push(node); report.notes.push(node.name + ' moved to ' + dept.name + '.'); }
        if (name && node.name !== name) { report.notes.push(node.name + ' renamed to ' + name + '.'); node.name = name; }
      }
      const ar = txt(field('Programme name (Arabic)'));
      if (ar) node.nameAr = ar;
      const campuses = txt(field('Campuses')).split(/[,;/]+/).map(s => s.trim()).filter(Boolean)
        .map(s => CAMPUSES.find(k => k.toLowerCase() === s.toLowerCase()) || s);
      campuses.filter(k => !CAMPUSES.includes(k)).forEach(k => report.warnings.push('Section 1: "' + k + '" is not one of the four campuses.'));
      if (campuses.length) node.campuses = campuses;
    }

    // 2. Blocks
    const buckets = {};
    parts[1].forEach(({ cells, row }) => {
      const label = txt(cells[0]);
      if (!label || /^total$/i.test(label)) return;
      const key = blockKey(label);
      const credits = num(cells[2]);
      if (!key) { report.errors.push('Section 2, row ' + row + ': the block needs a name.'); return; }
      if (buckets[key]) { report.errors.push('Section 2, row ' + row + ': ' + label + ' is listed twice.'); return; }
      if (!Number.isFinite(credits)) { report.errors.push('Section 2, row ' + row + ': give the credits of ' + label + ' (0 if none).'); return; }
      if (NON_DEGREE.includes(key)) return;              // the system already knows these, they count for nothing
      buckets[key] = { label: txt(cells[3]) || label, credits };
    });
    if (!Object.keys(buckets).length) report.errors.push('Section 2: list the requirement blocks and their credits.');

    // 5. Courses
    const byCode = new Map();
    parts[4].forEach(({ cells, row }) => {
      const cc = code(cells[0]);
      if (!cc) { if (cells.slice(1, 9).some(v => txt(v))) report.errors.push('Section 5, row ' + row + ': the course has no code.'); return; }
      const where = 'Section 5, row ' + row + ' (' + cc + ')';
      if (byCode.has(cc)) { report.errors.push(where + ': listed twice.'); return; }
      const pre = prerequisites(cells[5]), co = prerequisites(cells[6]);
      const key = blockKey(cells[3] || 'Major requirements');
      if (!buckets[key] && !NON_DEGREE.includes(key)) report.errors.push(where + ': the block "' + txt(cells[3]) + '" is not in section 2.');
      const course = {
        code: cc, title: txt(cells[1]), cr: num(cells[2]), bucket: key, pre: pre.all, co: co.all.concat(...co.oneOf),
        runsIn: OFFERED[txt(cells[7]).toLowerCase()] || ['FALL', 'SPRING']
      };
      if (!Number.isFinite(course.cr)) report.errors.push(where + ': give the credits.');
      const sem = num(cells[4]);
      if (sem) course.planSem = sem;
      if (pre.oneOf.length) {
        course.preOneOf = pre.oneOf;
        report.warnings.push(cc + ' needs one of ' + pre.oneOf.map(g => g.join(' or ')).join('; ') + '. Kept with the plan; advisors check it by hand for now.');
      }
      const note = txt(cells[8]);
      if (note) {
        course.note = note;
        const earned = /(?:need|needs|after|earned|complet\w*|at least)\D{0,20}(\d{2,3})\s*(?:cr|credit)/i.exec(note) || /(\d{2,3})\s*(?:cr|credits?)\s*(?:earned|completed|first|before)/i.exec(note);
        if (earned) course.minEarned = Number(earned[1]);
        if (/pass\s*\/?\s*fail/i.test(note)) course.noGpa = true;
        const grade = /(?:lowest|minimum|min\.?)\s+(?:passing\s+)?grade\s*(?:is|of|:)?\s*([A-D][+-]?)/i.exec(note);
        if (grade && GRADES.includes(grade[1].toUpperCase())) course.minGrade = grade[1].toUpperCase();
      }
      byCode.set(cc, course);
    });

    // 3. Rules that differ
    const rules = {}, recorded = [];
    parts[2].forEach(({ cells, row }) => {
      const text = txt(cells[0]), raw = txt(cells[4]);
      if (!text && !raw) return;
      const where = 'Section 3, row ' + row;
      const rule = SPEC.rules.find(r => r.text.toLowerCase() === text.toLowerCase());
      if (!rule) { report.errors.push(where + ': pick the rule from the list.'); return; }
      if (!raw) { report.errors.push(where + ': "' + rule.text + '" has no value for this programme.'); return; }
      const source = txt(cells[5]);
      if (!source) report.warnings.push(where + ': "' + rule.text + '" does not say where it is written.');
      if (!rule.key) {
        if (rule.type === 'grade' && !GRADES.includes(raw.toUpperCase())) { report.errors.push(where + ': give a letter grade such as C or C-.'); return; }
        recorded.push({ rule: rule.id, text: rule.text, value: raw, source, note: txt(cells[8]) });
        return;
      }
      let value;
      if (rule.type === 'list') {
        value = raw.split(/[,;\s]+/).map(Number).filter(n => Number.isInteger(n) && n > 0);
        if (!value.length) { report.errors.push(where + ': give semester numbers such as 4, 5, 6.'); return; }
      } else {
        value = num(raw);
        if (!Number.isFinite(value) || value < rule.min || value > rule.max || (rule.type === 'int' && !Number.isInteger(value))) {
          report.errors.push(where + ': "' + rule.text + '" must be a ' + (rule.type === 'int' ? 'whole number' : 'number') + ' from ' + rule.min + ' to ' + rule.max + '.');
          return;
        }
      }
      rules[rule.key] = { value, rule: rule.id, source };
    });
    if (recorded.length) report.notes.push(recorded.length + ' rule(s) kept with the plan for advisors to apply by hand: ' + recorded.map(r => r.text).join('; ') + '.');

    // 4. People
    const known = new Set((c.people || []).map(x => txt(x.email).toLowerCase()));
    const people = [];
    parts[3].forEach(({ cells, row }) => {
      const full = txt(cells[1]), email = txt(cells[3]).toLowerCase(), roleText = txt(cells[5]);
      if (!full && !email) return;
      const where = 'Section 4, row ' + row;
      const role = ROLE_OF[roleText.toLowerCase()];
      if (!full) { report.errors.push(where + ': give the full name.'); return; }
      if (!/^[^@\s]+@bau\.edu\.lb$/.test(email)) { report.errors.push(where + ': ' + full + ' needs a @bau.edu.lb email.'); return; }
      if (!role) { report.errors.push(where + ': pick Advisor or Programme editor for ' + full + '.'); return; }
      if (people.some(p => p.person.email === email)) { report.errors.push(where + ': ' + email + ' is listed twice.'); return; }
      people.push({
        person: { slug: email.split('@')[0].replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60), name: full, title: txt(cells[0]), email,
          faculty: faculty.name, department: dept ? dept.name : '' },
        roles: [{ role, scopes: [id] }],
        existing: known.has(email)
      });
    });

    const plan = Programme.normalize({
      catalogYear: num(field('Catalogue year')) || new Date(now).getFullYear(),
      program: name, faculty: faculty.name, department: dept ? dept.name : '',
      totalCredits: total, standardSemesters: standard, maxSemesters: maximum,
      buckets, tracks: {}, courses: [...byCode.values()],
      setupStatus: 'draft', needsReview: !confirmed,
      source: { catalogue: 'Study-plan file from the department', file: txt(c.fileName), importedAt: now,
        filledBy: txt(field('Filled in by (name and email)')), checkedBy: txt(field('Checked by the chairperson (name)')) },
      intake: { format: FORMAT, rules: recorded }
    });
    if (!report.errors.length) {
      const v = Programme.validate(plan, c.known || []);
      v.errors.forEach(e => report.errors.push(e));
      v.warnings.forEach(w => report.warnings.push(w));
    }
    if (OrgTree && OrgTree.validateTree && !report.errors.length) {
      const ok = OrgTree.validateTree(tree);
      if (!ok.ok) report.errors.push('The structure would not be valid: ' + ok.error);
    }
    return { report, facultyId, programmeId: id, programmeName: name, isNew, tree, plan, rules, people };
  }

  /* The file covers what a department knows best. Tracks, minors and advising
     settings already set up in the system are kept, not wiped. */
  function keepFromExisting(plan, existing) {
    const out = clone(plan);
    if (existing && typeof existing === 'object') {
      KEEP.forEach(k => { if (existing[k] !== undefined && (out[k] === undefined || (Array.isArray(out[k]) ? !out[k].length : !Object.keys(out[k] || {}).length))) out[k] = clone(existing[k]); });
    }
    return Programme.normalize(out);
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

  return { FORMAT, SPEC, unzip, readWorkbook, fromWorkbook, keepFromExisting, mergeRules, prerequisites };
});
