/* ── Programmes and the university structure ─────────────────────────────
   One portal, one programme at a time. Each programme (BSc Computer Science,
   BBA Accounting, ...) has its own study plan and its own rule settings, and
   its students are checked against those. University rules (grades,
   probation, IC3, Intensive English) are shared by every programme.
   - University structure: faculties, departments and programmes, built here
     by a superadmin; a faculty admin reshapes the inside of their own faculty
   - Programme setup: credits, requirement blocks, courses, prerequisites and
     tracks for one programme, checked before it is saved
   The server enforces every permission; these pages only hide what a person
   cannot do. */

// bundled Computer Science plan; also holds the university-wide lists
const SHARED_C = JSON.parse(JSON.stringify(C));
let planStatus = {};          // programme id -> { ready, courses, updatedAt }
let planStatusLoading = false;
let structEdit = null;        // the add/rename form that is open, if any
let structMsg = '';
let catalogueMsg = '';
let planDraft = null;         // working copy on the Programme setup page
let planFor = null;           // which programme the draft belongs to
let planDirty = false;
let planPasteOpen = false;
let planMsg = '';
let planPreview = '';         // student id used for the preview

// ---- who may do what (the server checks the same) ----------------------------
function programmeRows() { return orgScopeRows().filter(row => row.kind === 'programme'); }
function programmeRow(id) { return orgScopeRows().find(row => row.id === id) || null; }
function findOrgNode(id, node) {
  const n = node || state.orgTree;
  if (!n) return null;
  if (n.id === id) return n;
  for (const key of ['faculties', 'departments', 'programmes']) {
    for (const child of n[key] || []) { const hit = findOrgNode(id, child); if (hit) return hit; }
  }
  return null;
}
function activeProgramme() { return state.programme || (state.me && state.me.programme) || 'cs'; }
const myRoles = () => (state.me && Array.isArray(state.me.roles) ? state.me.roles : []);
const scopeCovers = (scope, id) => scope === id || uiNodeContains(scope, id);

function programmesFor() {
  if (!state.me) return [];
  const rows = programmeRows();
  if (!rows.length) return ['cs'];
  if (state.me.superadmin) return rows.map(row => row.id);
  const ids = rows.map(row => row.id).filter(id => myRoles().some(a => (a.scopes || []).some(s => scopeCovers(s, id))));
  return ids.length ? ids : ['cs'];
}
function canEditPlan(id) {
  if (!state.me) return false;
  if (state.me.superadmin) return true;
  return myRoles().some(a => (a.role === 'faculty-admin' || a.role === 'programme-editor')
    && (a.scopes || []).some(s => scopeCovers(s, id)));
}
function canEditStructure() {
  return !!(state.me && Store.isServer() && (state.me.superadmin || state.me.facultyAdmin));
}
function ownFaculties() {
  if (state.me && state.me.superadmin) return ((state.orgTree && state.orgTree.faculties) || []).map(f => f.id);
  return myRoles().filter(a => a.role === 'faculty-admin').flatMap(a => a.scopes || []);
}

// ---- which students belong where -----------------------------------------------
function advisorProgramme(slug) {
  const person = (state.people || []).find(p => p.slug === slug) || (state.me && state.me.slug === slug ? state.me : null);
  if (!person) return null;
  const ids = programmeRows().map(row => row.id);
  for (const a of person.roles || []) {
    const hit = (a.scopes || []).find(s => ids.includes(s));
    if (hit) return hit;
  }
  return null;
}
function studentProgramme(s, advisorSlug) {
  return (s && s.programme) || advisorProgramme(advisorSlug || (s && s.advisorSlug)) || 'cs';
}
function inActiveProgramme(list, advisorSlug) {
  const id = activeProgramme();
  return (list || []).filter(s => studentProgramme(s, advisorSlug) === id);
}
function filterEveryone(map) {
  const out = {};
  Object.keys(map || {}).forEach(slug => {
    const list = inActiveProgramme(map[slug], slug);
    if (list.length) out[slug] = list;
  });
  return out;
}
// new and re-imported students are filed under the programme being worked on
const tagStudent = s => { if (s && typeof s === 'object' && !s.programme) s.programme = activeProgramme(); return s; };
const saveStudentsPlain = Store.saveStudents, saveStudentPlain = Store.saveStudent;
Store.saveStudents = (slug, list) => saveStudentsPlain(slug, (list || []).map(tagStudent));
Store.saveStudent = (slug, s) => saveStudentPlain(slug, tagStudent(s));

// ---- names shown on pages, printouts and emails -------------------------------
function progFacultyName() { const row = programmeRow(activeProgramme()); return (row && row.faculty) || 'Faculty of Science'; }
function progDeptName() { const row = programmeRow(activeProgramme()); return (row && row.department) || 'Mathematics and Computer Science'; }
function progDeptLine() { return 'Department of ' + progDeptName().replace(/^Department of /i, ''); }
function programmeName(id) { const n = findOrgNode(id); return (n && n.name) || (id === 'cs' ? 'BSc Computer Science' : id); }

// ---- switching programme ---------------------------------------------------------
async function loadProgrammeBase(id) {
  let saved = null;
  if (Store.isServer()) { try { saved = await Store.getProgramme(id); } catch (e) { /* not set up yet */ } }
  if (saved) return { base: saved, ready: true };
  if (id === 'cs') return { base: SHARED_C, ready: true };
  const row = programmeRow(id) || {};
  return { base: Programme.blankCatalog({ program: programmeName(id), faculty: row.faculty, department: row.department }), ready: false };
}
async function useProgramme(id, opts) {
  state.programme = id;
  try { sessionStorage.setItem('bau.programme', id); } catch (e) { /* not kept */ }
  const got = await loadProgrammeBase(id);
  state.programmeReady = got.ready;
  resetInto(BASE_C, Programme.withShared(got.base, SHARED_C));
  rulesCfg = { values: {}, courses: {}, removed: [], history: [] };
  rulesDraft = null; rulesEffect = null;
  await loadRulesConfig();
  if (opts && opts.reloadStudents) {
    if (state.me.admin) {
      try { state.everyone = await loadEveryone(); state.everyoneErr = ''; }
      catch (e) { state.everyone = {}; state.everyoneErr = 'Could not reach the lists just now.'; }
      state.students = everyoneFlat();
    }
    else state.students = inActiveProgramme(await Store.loadStudents(state.me.slug, []), state.me.slug);
  }
}
async function switchProgramme(id) {
  if (!programmesFor().includes(id) || id === activeProgramme()) return;
  await useProgramme(id, { reloadStudents: true });
  planDraft = null; planFor = null; planDirty = false; planMsg = ''; planPreview = '';
  state.sel = null; state.filter = 'all'; state.advisorFilter = 'all';
  // pages about one programme stay where they are; any other page goes to the programme's student list
  const PROGRAMME_PAGES = ['everyone', 'students', 'programme', 'rules', 'import', 'freshmen', 'decide'];
  if (!PROGRAMME_PAGES.includes(state.view)) state.view = state.me.admin ? 'everyone' : 'students';
  render(); window.scrollTo(0, 0);
  toast('Now working on ' + programmeName(id) + (state.programmeReady ? '.' : '. Its study plan is not set up yet.'));
}

function programmePicker() {
  const ids = programmesFor();
  if (!state.orgTree || ids.length < 2) {
    return `<div class="lab">Programme</div><div class="railinfo" style="padding:0 14px 10px;font-weight:600">${esc(programmeName(activeProgramme()))}</div>`;
  }
  const byFaculty = new Map();
  programmeRows().filter(row => ids.includes(row.id)).forEach(row => {
    if (!byFaculty.has(row.faculty)) byFaculty.set(row.faculty, []);
    byFaculty.get(row.faculty).push(row);
  });
  return `<div class="lab">Programme</div><div class="prog-wrap" style="padding:0 12px 10px">
    <select id="progPick" class="pin" aria-label="Programme you are working on">
      ${Array.from(byFaculty, ([faculty, rows]) => `<optgroup label="${esc(faculty)}">${rows.map(row =>
        `<option value="${esc(row.id)}"${row.id === activeProgramme() ? ' selected' : ''}>${esc(programmeName(row.id))}</option>`).join('')}</optgroup>`).join('')}
    </select></div>`;
}

// ---- University structure page ----------------------------------------------------
async function loadPlanStatuses() {
  if (planStatusLoading) return;
  planStatusLoading = true;
  const out = {};
  const mine = programmesFor();
  await Promise.all(programmeRows().filter(row => mine.includes(row.id)).map(async row => {
    let saved = null;
    try { saved = Store.isServer() ? await Store.getProgramme(row.id) : null; } catch (e) { /* unreadable: not ours */ }
    out[row.id] = saved ? { ready: true, courses: (saved.courses || []).length, updatedAt: saved.updatedAt, review: !!saved.needsReview }
      : row.id === 'cs' ? { ready: true, builtIn: true, courses: SHARED_C.courses.length } : { ready: false };
  }));
  planStatus = out; planStatusLoading = false; planStatus.loaded = true;
  if (state.view === 'structure' || state.view === 'programme') render();
}

const slugify = text => String(text || '').toLowerCase().replace(/^faculty of\s+/, '').replace(/^department of\s+/, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'unit';
function freshId(base) {
  const taken = new Set(orgScopeRows().map(row => row.id).concat(['bau']));
  let id = slugify(base), n = 2;
  while (taken.has(id)) id = slugify(base) + '-' + n++;
  return id;
}
const CAMPUSES = () => SHARED_C.campuses || ['Beirut', 'Debbieh', 'Tripoli', 'Bekaa'];

function structForm(kind, parentId, node) {
  const isProg = kind === 'programme';
  const title = node ? 'Rename' : 'Add a ' + kind;
  return `<div class="panel" style="margin-top:10px"><div class="hd">${esc(title)}</div><div class="bd stack">
    <label class="f">Name<input id="stName" maxlength="120" value="${esc(node ? node.name : '')}" placeholder="${kind === 'faculty' ? 'Faculty of Business Administration' : kind === 'department' ? 'Accounting' : 'BBA Accounting'}"></label>
    <label class="f">Arabic name (optional)<input id="stNameAr" dir="rtl" maxlength="120" value="${esc(node && node.nameAr || '')}"></label>
    ${isProg ? `<div class="f" style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px"><b style="width:100%">Campuses</b>${CAMPUSES().map(c =>
      `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="stCampus" value="${esc(c)}"${!node || (node.campuses || []).includes(c) ? ' checked' : ''}>${esc(c)}</label>`).join('')}</div>` : ''}
    ${structMsg ? `<p class="note" style="color:var(--urgent)">${esc(structMsg)}</p>` : ''}
    <div style="display:flex;gap:8px"><button class="btn primary sm" data-st-save="1">${node ? 'Save' : 'Add'}</button>
      <button class="btn sm" data-st-cancel="1">Cancel</button></div>
  </div></div>`;
}

function viewStructure() {
  if (!canEditStructure()) return '<div class="wrap"><p class="note">Only a superadmin or a faculty admin can change the university structure.</p></div>';
  if (!planStatus.loaded) loadPlanStatuses();
  const tree = state.orgTree || { faculties: [] };
  const own = new Set(ownFaculties());
  const isOpen = (kind, parent, id) => structEdit && structEdit.kind === kind && structEdit.parent === parent && (structEdit.id || null) === (id || null);
  const progRow = (dept, p) => {
    const st = planStatus[p.id] || {};
    const chip = !planStatus.loaded ? '<span class="chip">checking…</span>'
      : st.ready && st.review ? `<span class="chip watch">From the catalogue · ${st.courses} courses · to check</span>`
      : st.ready ? `<span class="chip ok">Study plan ready · ${st.courses} courses${st.builtIn ? ' · built in' : ''}</span>`
        : '<span class="chip watch">Not set up yet</span>';
    return `<div class="al"><span class="body"><span class="t">${esc(p.name)}${p.nameAr ? ` <span class="who-meta" dir="rtl">${esc(p.nameAr)}</span>` : ''}
        <span class="who-meta">${esc((p.campuses || []).join(', ') || 'No campus set')}<i class="sep-dot" aria-hidden="true"></i>${chip}</span></span></span>
      <span class="act" style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn sm primary" data-st-open="${esc(p.id)}">${st.ready ? 'Open setup' : 'Set up'}</button>
        <button class="btn sm" data-st-rename="programme:${esc(dept.id)}:${esc(p.id)}">Rename</button>
        ${!st.ready && p.id !== 'cs' ? `<button class="btn sm danger" data-st-remove="${esc(p.id)}">Remove</button>` : ''}
      </span></div>
      ${isOpen('programme', dept.id, p.id) ? structForm('programme', dept.id, p) : ''}`;
  };
  const faculties = (tree.faculties || []).map(f => {
    const mine = own.has(f.id);
    return `<section class="sec"><div class="sec-h" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <h2>${esc(f.name)}</h2>${f.nameAr ? `<span class="who-meta" dir="rtl">${esc(f.nameAr)}</span>` : ''}
        ${mine ? `<span style="margin-left:auto;display:flex;gap:6px">
          <button class="btn sm" data-st-add="department:${esc(f.id)}">Add department</button>
          ${state.me.superadmin ? `<button class="btn sm" data-st-rename="faculty:bau:${esc(f.id)}">Rename</button>` : ''}
          ${state.me.superadmin && !(f.departments || []).length ? `<button class="btn sm danger" data-st-remove="${esc(f.id)}">Remove</button>` : ''}</span>` : '<span class="chip" style="margin-left:auto">view only</span>'}</div>
      ${isOpen('faculty', 'bau', f.id) ? structForm('faculty', 'bau', f) : ''}
      ${isOpen('department', f.id, null) ? structForm('department', f.id, null) : ''}
      ${(f.departments || []).map(d => `<div class="panel"><div class="hd" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span>${esc(d.name)}</span>${mine ? `<span style="margin-left:auto;display:flex;gap:6px">
            <button class="btn sm" data-st-add="programme:${esc(d.id)}">Add programme</button>
            <button class="btn sm" data-st-rename="department:${esc(f.id)}:${esc(d.id)}">Rename</button>
            ${!(d.programmes || []).length ? `<button class="btn sm danger" data-st-remove="${esc(d.id)}">Remove</button>` : ''}</span>` : ''}</div>
        ${isOpen('department', f.id, d.id) ? `<div class="bd">${structForm('department', f.id, d)}</div>` : ''}
        ${isOpen('programme', d.id, null) ? `<div class="bd">${structForm('programme', d.id, null)}</div>` : ''}
        <div class="alist">${(d.programmes || []).map(p => mine ? progRow(d, p) : `<div class="al"><span class="body"><span class="t">${esc(p.name)}</span></span></div>`).join('')
          || '<p class="note" style="padding:10px 16px">No programmes yet.</p>'}</div></div>`).join('')
        || '<p class="note">No departments yet.</p>'}
    </section>`;
  }).join('');
  return `<div class="wrap"><div class="page-h"><h1>University structure</h1>
      <p>Faculties, departments and programmes. Each programme gets its own study plan and rules; university rules such as probation, IC3 and Intensive English apply to all of them.</p></div>
    ${state.me.superadmin ? `<div class="rbar"><span>${(tree.faculties || []).length} faculties · ${programmeRows().length} programmes</span>
      <button class="btn sm primary" data-st-add="faculty:bau">Add faculty</button>
      ${window.CATALOGUE_SEED ? '<button class="btn sm" data-st-catalogue="1">Load BAU catalogue (2020–2021)</button>' : ''}</div>
      ${catalogueMsg ? `<p class="note">${esc(catalogueMsg)}</p>` : ''}` : `<div class="rbar"><span>You can add and rename departments and programmes inside your own faculty.</span></div>`}
    ${isOpen('faculty', 'bau', null) ? structForm('faculty', 'bau', null) : ''}
    ${faculties}
  </div>`;
}

async function saveTree(next, done) {
  try {
    state.orgTree = await Store.saveOrgTree(next);
    structEdit = null; structMsg = '';
    planStatus = {}; render();
    if (done) toast(done);
  } catch (e) { structMsg = e.message; render(); }
}

function structSave() {
  const name = String(($('#stName') || {}).value || '').trim();
  const nameAr = String(($('#stNameAr') || {}).value || '').trim();
  if (!name) { structMsg = 'Write a name first.'; render(); return; }
  const tree = JSON.parse(JSON.stringify(state.orgTree));
  const { kind, parent, id } = structEdit;
  const campuses = Array.from(document.querySelectorAll('input[name=stCampus]:checked')).map(x => x.value);
  if (kind === 'programme' && !campuses.length) { structMsg = 'Pick at least one campus.'; render(); return; }
  if (id) {
    const node = findOrgNode(id, tree);
    node.name = name;
    if (nameAr) node.nameAr = nameAr; else delete node.nameAr;
    if (kind === 'programme') node.campuses = campuses;
    return saveTree(tree, 'Renamed.');
  }
  const node = { id: freshId(name), name };
  if (nameAr) node.nameAr = nameAr;
  if (kind === 'faculty') { node.departments = []; tree.faculties.push(node); }
  if (kind === 'department') { node.programmes = []; findOrgNode(parent, tree).departments.push(node); }
  if (kind === 'programme') { node.campuses = campuses; findOrgNode(parent, tree).programmes.push(node); }
  return saveTree(tree, name + ' added' + (kind === 'programme' ? '. Open its setup to build the study plan.' : '.'));
}

/* Adds the faculties, departments and programmes of the 2020-2021 catalogue that
   are not in the structure yet (nothing existing is renamed or removed), then
   gives each programme without a study plan the plan read from the catalogue,
   marked "to check". */
async function loadCatalogue() {
  const seed = window.CATALOGUE_SEED;
  if (!seed || !state.me.superadmin) return;
  if (!window.confirm('Add the BAU faculties, departments and programmes from the 2020–2021 catalogue, and their study plans where they could be read? Nothing that already exists is changed.')) return;
  const tree = JSON.parse(JSON.stringify(state.orgTree));
  const ids = new Set(); const walk = n => { ids.add(n.id); ['faculties', 'departments', 'programmes'].forEach(k => (n[k] || []).forEach(walk)); }; walk(tree);
  let added = 0;
  const merge = (into, from, key, childKey) => (from[key] || []).forEach(child => {
    let have = (into[key] || []).find(x => x.id === child.id);
    if (!have) {
      if (ids.has(child.id)) return;   // the id is used elsewhere in the structure: leave it alone
      have = JSON.parse(JSON.stringify(childKey ? Object.assign({}, child, { [childKey]: [] }) : child));
      into[key].push(have); added++; ids.add(child.id);
    }
    if (childKey) merge(have, child, childKey, childKey === 'departments' ? 'programmes' : null);
  });
  merge(tree, seed.tree, 'faculties', 'departments');
  try {
    if (added) state.orgTree = await Store.saveOrgTree(tree);
    let plans = 0, kept = 0;
    for (const id of Object.keys(seed.plans)) {
      if (!findOrgNode(id) || id === 'cs') continue;
      let have = null;
      try { have = await Store.getProgramme(id); } catch (e) { /* none yet */ }
      if (have) { kept++; continue; }
      await Store.saveProgramme(id, seed.plans[id]);
      plans++;
    }
    planStatus = {};
    catalogueMsg = added + ' faculties, departments and programmes added. ' + plans + ' study plans loaded from the catalogue, marked "to check"'
      + (kept ? '; ' + kept + ' programmes already had a plan and were left as they are' : '') + '. Programmes without a readable plan stay "Not set up yet".';
    render(); toast('Catalogue loaded');
  } catch (e) { catalogueMsg = 'Not loaded: ' + e.message; render(); }
}

function structRemove(id) {
  const tree = JSON.parse(JSON.stringify(state.orgTree));
  const drop = node => ['faculties', 'departments', 'programmes'].forEach(key => {
    if (Array.isArray(node[key])) { node[key] = node[key].filter(child => child.id !== id); node[key].forEach(drop); }
  });
  drop(tree);
  return saveTree(tree, 'Removed.');
}

// ---- Programme setup page -----------------------------------------------------------
const knownCodes = () => SHARED_C.universityElectives.map(c => c.code)
  .concat(SHARED_C.genScienceElectives.map(c => c.code), SHARED_C.courses.map(c => c.code));
function draftChecks() { return planDraft ? Programme.validate(planDraft, knownCodes()) : { errors: [], warnings: [] }; }

function ensureDraft() {
  if (planFor === activeProgramme() && (planDraft || !state.programmeReady)) return;
  planFor = activeProgramme(); planDirty = false; planMsg = '';
  planDraft = state.programmeReady ? Programme.forStorage(JSON.parse(JSON.stringify(BASE_C))) : null;
}

function checksHtml() {
  const ch = draftChecks();
  if (!ch.errors.length && !ch.warnings.length) return '<p class="chip ok">Everything checks out.</p>';
  return `${ch.errors.length ? `<p><b style="color:var(--urgent)">${ch.errors.length} to fix before saving</b></p><ul>${ch.errors.slice(0, 12).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${ch.warnings.length ? `<p><b style="color:var(--watch)">${ch.warnings.length} to look at</b> (saving is still allowed)</p><ul>${ch.warnings.slice(0, 12).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
}

function previewHtml() {
  const pool = state.students.filter(s => !offProgramme(s));
  if (!pool.length) return '<p class="note">No students of this programme are loaded yet. Import a few transcripts under this programme to test the study plan on real records.</p>';
  const s = pool.find(x => x.id === planPreview) || pool[0];
  let body = '';
  try {
    const cat = Programme.withShared(planDraft, SHARED_C);
    const audit = E.graduationAudit(R, cat, s);
    const snap = E.snapshot(R, cat, s);
    body = `<p><b>${audit.remainingCredits}</b> credits left to graduate · ${audit.blockers.length} thing${audit.blockers.length === 1 ? '' : 's'} blocking graduation</p>
      <ul>${Object.keys(snap.buckets).filter(k => snap.buckets[k].required > 0).map(k => {
        const b = snap.buckets[k];
        return `<li>${esc(b.label)}: ${b.earned} of ${b.required} credits</li>`; }).join('')}</ul>`;
  } catch (e) { body = '<p class="note" style="color:var(--urgent)">This study plan cannot be checked yet: ' + esc(e.message) + '</p>'; }
  return `<label class="f" style="max-width:420px">Student
      <select data-pl="preview" class="pin">${pool.slice(0, 200).map(x => `<option value="${esc(x.id)}"${x.id === s.id ? ' selected' : ''}>${esc(x.name)} · ${esc(x.id)}</option>`).join('')}</select></label>
    <div id="planPreviewOut">${body}</div>
    <p class="note">Worked out with the plan on this page, including changes you have not saved yet.</p>`;
}

function viewProgrammeSetup() {
  const id = activeProgramme();
  ensureDraft();
  const row = programmeRow(id) || {};
  const edit = canEditPlan(id);
  const head = `<div class="page-h"><h1>Programme setup</h1>
    <p>${esc(programmeName(id))}${row.department ? ' · ' + esc(row.department) : ''}${row.faculty ? ' · ' + esc(row.faculty) : ''}</p></div>`;
  if (!planDraft) {
    if (!planStatus.loaded) loadPlanStatuses();
    const sources = programmeRows().filter(r => r.id !== id && (planStatus[r.id] || {}).ready);
    if (!edit) return `<div class="wrap">${head}<p class="note">This programme's study plan has not been set up yet. Ask its faculty admin or programme editor.</p></div>`;
    return `<div class="wrap">${head}
      <div class="panel"><div class="hd">This programme has no study plan yet</div><div class="bd stack">
        <p>Until it has one, its students cannot be advised. Start from an empty plan, or copy another programme's plan and change what is different.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <button class="btn primary" data-pl-start="blank">Start empty</button>
          ${sources.length ? `<label class="f" style="min-width:260px">Or copy from
            <select id="plCopyFrom" class="pin">${sources.map(r => `<option value="${esc(r.id)}">${esc(programmeName(r.id))}</option>`).join('')}</select></label>
            <button class="btn" data-pl-start="copy">Copy this plan</button>` : ''}
        </div>
        <p class="note">Nothing is saved until you press Save study plan.</p>
      </div></div></div>`;
  }
  const d = planDraft;
  const ro = edit ? '' : ' disabled';
  const inp = (key, val, attrs) => `<input${/class=/.test(attrs || '') ? '' : ' class="pin"'} data-pl="${key}" value="${esc(val == null ? '' : val)}"${attrs || ''}${ro}>`;
  const bucketKeys = Object.keys(d.buckets);
  const credBuckets = bucketKeys.filter(k => !['FRESHMAN', 'OTHER'].includes(k));
  const sum = credBuckets.reduce((a, k) => a + (Number(d.buckets[k].credits) || 0), 0);
  const listed = k => d.courses.filter(c => c.bucket === k).reduce((a, c) => a + (Number(c.cr) || 0), 0);
  const semOpts = n => `<option value="">—</option>` + Array.from({ length: d.maxSemesters || 12 }, (_, i) => i + 1)
    .map(x => `<option${x === n ? ' selected' : ''}>${x}</option>`).join('');
  const bar = `<div id="planBar">${planBarHtml()}</div>`;

  const basics = `<div class="panel"><div class="hd">Basics</div><div class="bd" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px">
      <label class="f">Programme name${inp('basic:program', d.program)}</label>
      <label class="f">Credits to graduate${inp('basic:totalCredits', d.totalCredits, ' type="number" min="1" max="300"')}</label>
      <label class="f">Standard length (semesters)${inp('basic:standardSemesters', d.standardSemesters, ' type="number" min="1" max="16"')}</label>
      <label class="f">Maximum length (semesters)${inp('basic:maxSemesters', d.maxSemesters, ' type="number" min="1" max="30"')}</label>
      <label class="f">Catalogue year${inp('basic:catalogYear', d.catalogYear, ' type="number" min="2000" max="2100"')}</label>
    </div></div>`;

  const blocks = `<div class="panel"><div class="hd">Requirement blocks<i class="sep-dot"></i><span id="planSum">${sum} of ${d.totalCredits} credits</span></div>
    <div class="bd"><p class="note">How the degree's credits are split. A block the programme does not use stays at 0.</p>
    <div class="ptable-wrap"><table class="ptable"><thead><tr><th>Block</th><th>Credits needed</th><th>Courses listed</th></tr></thead><tbody>
      ${credBuckets.map(k => `<tr><td>${inp('bucket:' + k + ':label', d.buckets[k].label)}</td>
        <td>${inp('bucket:' + k + ':credits', d.buckets[k].credits, ' type="number" min="0" max="300" style="width:90px"')}</td>
        <td>${listed(k)} credits</td></tr>`).join('')}
    </tbody></table></div>
    ${edit ? `<div class="row" style="margin-top:10px;gap:8px"><input id="plNewBlock" class="pin" placeholder="New block, e.g. Internship" style="max-width:260px"><button class="btn sm" data-pl-addblock="1">Add block</button></div>` : ''}
    </div></div>`;

  const courseRows = d.courses.map((c, i) => `<tr>
      <td>${inp('course:' + i + ':code', c.code, ' style="width:100px" class="pin mono"')}</td>
      <td>${inp('course:' + i + ':title', c.title, ' class="pin" style="min-width:200px"')}</td>
      <td>${inp('course:' + i + ':cr', c.cr, ' type="number" min="0" max="12" style="width:64px"')}</td>
      <td><select class="pin" data-pl="course:${i}:bucket"${ro}>${bucketKeys.concat(['REMEDIAL', 'INTENSIVE', 'NON_CREDIT'].filter(k => !bucketKeys.includes(k))).map(k =>
        `<option value="${k}"${k === c.bucket ? ' selected' : ''}>${esc((d.buckets[k] || {}).label || k[0] + k.slice(1).toLowerCase().replace(/_/g, ' '))}</option>`).join('')}</select></td>
      <td><select class="pin n" data-pl="course:${i}:planSem"${ro}>${semOpts(c.planSem)}</select></td>
      <td>${inp('course:' + i + ':pre', (c.pre || []).join(', '), ' placeholder="none" style="min-width:120px"')}</td>
      <td>${inp('course:' + i + ':co', (c.co || []).join(', '), ' placeholder="none" style="min-width:90px"')}</td>
      <td><select class="pin" data-pl="course:${i}:runsIn"${ro}>${[['FALL,SPRING', 'Both'], ['FALL', 'Fall'], ['SPRING', 'Spring'], ['FALL,SPRING,SUMMER', 'All']].map(([v, l]) =>
        `<option value="${v}"${v === (c.runsIn || []).join(',') ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
      ${edit ? `<td><button class="linkbtn" data-pl-delcourse="${i}">Remove</button></td>` : ''}</tr>`).join('');
  const courses = `<div class="panel"><div class="hd">Courses<i class="sep-dot"></i>${d.courses.length}</div><div class="bd">
    <div class="ptable-wrap"><table class="ptable"><thead><tr><th>Code</th><th>Title</th><th>Cr</th><th>Block</th><th>Semester</th><th>Prerequisites</th><th>Co-requisites</th><th>Runs in</th>${edit ? '<th></th>' : ''}</tr></thead>
      <tbody>${courseRows || `<tr><td colspan="9" class="note">No courses yet.</td></tr>`}</tbody></table></div>
    ${edit ? `<div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap"><button class="btn sm" data-pl-addcourse="1">Add a course</button>
      <button class="btn sm" data-pl-paste="1">${planPasteOpen ? 'Close paste box' : 'Paste courses from Excel'}</button></div>
      ${planPasteOpen ? `<div class="stack" style="margin-top:10px"><p class="note">Copy the rows from Excel and paste them here. Columns: Code, Title, Credits, Block, Semester, Prerequisites (a header row is fine). Courses already in the plan are updated, new ones are added.</p>
        <textarea id="plPasteBox" class="pin mono" rows="7" placeholder="ACCT201\tPrinciples of Accounting\t3\tMajor Core\t1\t"></textarea>
        <div><button class="btn sm primary" data-pl-pasteadd="1">Add these courses</button></div></div>` : ''}` : ''}
    </div></div>`;

  const trackKeys = Object.keys(d.tracks || {});
  const tracks = `<div class="panel"><div class="hd">Tracks (optional)</div><div class="bd">
    <p class="note">A track is earned by passing a number of courses from its list, like the Computer Science Cybersecurity track.</p>
    ${trackKeys.length ? `<div class="ptable-wrap"><table class="ptable"><thead><tr><th>Track</th><th>Courses</th><th>Needed</th>${edit ? '<th></th>' : ''}</tr></thead><tbody>
      ${trackKeys.map(k => `<tr><td>${inp('track:' + k + ':label', d.tracks[k].label)}</td>
        <td>${inp('track:' + k + ':courses', (d.tracks[k].courses || []).join(', '), ' class="pin mono"')}</td>
        <td>${inp('track:' + k + ':coursesRequired', d.tracks[k].coursesRequired, ' type="number" min="1" max="10" style="width:64px"')}</td>
        ${edit ? `<td><button class="linkbtn" data-pl-deltrack="${esc(k)}">Remove</button></td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<p class="note">No tracks.</p>'}
    ${edit ? `<div class="row" style="margin-top:10px;gap:8px"><input id="plNewTrack" class="pin" placeholder="New track name" style="max-width:260px"><button class="btn sm" data-pl-addtrack="1">Add track</button></div>` : ''}
    </div></div>`;

  const src = d.source || null;
  const review = d.needsReview ? `<div class="chk warn" style="margin-bottom:12px"><span class="ic">!</span><span class="tx">
      <p><b>Read from the ${esc((src && src.catalogue) || 'catalogue')}, not checked yet.</b> Compare it with the programme's current study plan and correct anything that changed.
      ${src && src.url ? `<a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">Open the catalogue page</a>` : ''}</p>
      ${src && src.note ? `<p class="note" style="margin-top:4px">${esc(src.note)}</p>` : ''}
      ${edit ? `<label style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" data-pl="checked"${d.checkedNow ? ' checked' : ''}> I have checked this plan against the current study plan</label>` : ''}
    </span></div>` : '';
  return `<div class="wrap">${head}${bar}${review}
    <div class="panel"><div class="hd">Checks</div><div class="bd" id="planChecks">${checksHtml()}</div></div>
    ${basics}${blocks}${courses}${tracks}
    <div class="panel"><div class="hd">Try it on a student</div><div class="bd" id="planPreview">${previewHtml()}</div></div>
    <p class="note">University rules (grades, probation, IC3, Intensive English, credit load) come from the university layer. Numbers specific to this programme can be changed in Rules and study plan.</p>
  </div>`;
}

function planBarHtml() {
  if (!canEditPlan(activeProgramme())) return '<div class="rbar"><span>View only. The faculty admin or a programme editor can change this plan.</span></div>';
  return `<div class="rbar${planDirty ? ' editing' : ''}">${planDirty ? '<span class="dot"></span><span><b>Unsaved changes.</b> Students are still checked with the saved plan.</span>' : '<span>Change anything below, then save. The plan is checked before it is kept.</span>'}
      <button class="btn sm primary" data-pl-save="1">Save study plan</button>
      ${planDirty ? '<button class="btn sm ghost" data-pl-discard="1">Discard changes</button>' : ''}</div>
      ${planMsg ? `<p class="note">${esc(planMsg)}</p>` : ''}`;
}

function planChanged() {
  planDirty = true; planMsg = '';
  const box = $('#planChecks'); if (box) box.innerHTML = checksHtml();
  const sumEl = $('#planSum');
  if (sumEl && planDraft) {
    const sum = Object.keys(planDraft.buckets).filter(k => !['FRESHMAN', 'OTHER'].includes(k))
      .reduce((a, k) => a + (Number(planDraft.buckets[k].credits) || 0), 0);
    sumEl.textContent = sum + ' of ' + planDraft.totalCredits + ' credits';
  }
  const pv = $('#planPreview'); if (pv && document.activeElement && !pv.contains(document.activeElement)) pv.innerHTML = previewHtml();
  const bar = $('#planBar'); if (bar) bar.innerHTML = planBarHtml();
}

// typing updates the draft and the checks, without redrawing the page under the cursor
function planInput(el) {
  const key = el.dataset.pl;
  if (key === 'preview') { planPreview = el.value; const pv = $('#planPreview'); if (pv) pv.innerHTML = previewHtml(); return; }
  if (key === 'checked') { if (planDraft) { planDraft.checkedNow = el.checked; planChanged(); } return; }
  if (!planDraft || !canEditPlan(activeProgramme())) return;
  const parts = key.split(':'), v = el.value;
  const num = x => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
  const codes = x => String(x || '').split(/[,;\s]+/).map(s => s.toUpperCase()).filter(Boolean);
  if (parts[0] === 'basic') planDraft[parts[1]] = parts[1] === 'program' ? v : num(v);
  if (parts[0] === 'bucket') planDraft.buckets[parts[1]][parts[2]] = parts[2] === 'credits' ? num(v) : v;
  if (parts[0] === 'track') {
    const t = planDraft.tracks[parts[1]];
    t[parts[2]] = parts[2] === 'courses' ? codes(v) : parts[2] === 'coursesRequired' ? num(v) : v;
  }
  if (parts[0] === 'course') {
    const c = planDraft.courses[+parts[1]], f = parts[2];
    if (!c) return;
    if (f === 'code') c.code = v.toUpperCase().replace(/\s+/g, '');
    else if (f === 'cr') c.cr = num(v);
    else if (f === 'planSem') { if (v) c.planSem = num(v); else delete c.planSem; }
    else if (f === 'pre' || f === 'co') c[f] = codes(v);
    else if (f === 'runsIn') c.runsIn = v.split(',');
    else c[f] = v;
  }
  planChanged();
}

async function savePlan() {
  const id = activeProgramme();
  const ch = draftChecks();
  if (ch.errors.length) { planMsg = 'Fix the problems listed under Checks first.'; render(); return; }
  const value = Object.assign({}, planDraft, { setupStatus: 'ready' });
  if (value.checkedNow) { value.needsReview = false; value.checkedBy = fullName(state.me); value.checkedAt = Date.now(); }
  delete value.checkedNow;
  try {
    const r = await Store.saveProgramme(id, value);
    await useProgramme(id);
    planDraft = null; planFor = null; planDirty = false; planStatus = {};
    planMsg = 'Saved. ' + programmeName(id) + ' students are now checked with this plan.'
      + (r && r.warnings && r.warnings.length ? ' ' + r.warnings.length + ' point(s) are still worth a look.' : '');
    render();
    toast('Study plan saved');
  } catch (e) { planMsg = 'Not saved: ' + e.message; render(); }
}

function addBlockKey(label, map) {
  let key = String(label).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'BLOCK';
  if (!/^[A-Z]/.test(key)) key = 'B_' + key;
  let k = key, n = 2;
  while ((map || planDraft.buckets)[k]) k = key + '_' + n++;
  return k;
}

async function structureClick(t) {
  // University structure
  const add = t.closest('[data-st-add]');
  if (add) { const [kind, parent] = add.dataset.stAdd.split(':'); structEdit = { kind, parent }; structMsg = ''; render(); return true; }
  const ren = t.closest('[data-st-rename]');
  if (ren) { const [kind, parent, id] = ren.dataset.stRename.split(':'); structEdit = { kind, parent, id }; structMsg = ''; render(); return true; }
  if (t.closest('[data-st-cancel]')) { structEdit = null; structMsg = ''; render(); return true; }
  if (t.closest('[data-st-save]')) { await structSave(); return true; }
  if (t.closest('[data-st-catalogue]')) { await loadCatalogue(); return true; }
  const rem = t.closest('[data-st-remove]');
  if (rem) {
    const node = findOrgNode(rem.dataset.stRemove);
    if (node && window.confirm('Remove ' + node.name + ' from the structure?')) await structRemove(rem.dataset.stRemove);
    return true;
  }
  const open = t.closest('[data-st-open]');
  if (open) {
    const id = open.dataset.stOpen;
    if (id !== activeProgramme()) await switchProgramme(id);
    state.view = 'programme'; render(); window.scrollTo(0, 0); return true;
  }
  // Programme setup
  const start = t.closest('[data-pl-start]');
  if (start) {
    const row = programmeRow(activeProgramme()) || {};
    const info = { program: programmeName(activeProgramme()), faculty: row.faculty, department: row.department };
    if (start.dataset.plStart === 'copy') {
      const from = ($('#plCopyFrom') || {}).value;
      const src = await loadProgrammeBase(from);
      planDraft = Programme.copyCatalog(src.base, info);
    } else planDraft = Programme.blankCatalog(info);
    planFor = activeProgramme(); planDirty = true; render(); return true;
  }
  if (!planDraft) return false;
  if (t.closest('[data-pl-save]')) { await savePlan(); return true; }
  if (t.closest('[data-pl-discard]')) { planDraft = null; planFor = null; planDirty = false; planMsg = ''; render(); return true; }
  if (t.closest('[data-pl-addcourse]')) {
    planDraft.courses.push({ code: '', title: '', cr: 3, bucket: 'MAJOR_CORE', pre: [], co: [], runsIn: ['FALL', 'SPRING'] });
    planDirty = true; render();
    const inputs = document.querySelectorAll('[data-pl^="course:' + (planDraft.courses.length - 1) + ':code"]');
    if (inputs[0]) inputs[0].focus();
    return true;
  }
  const del = t.closest('[data-pl-delcourse]');
  if (del) { planDraft.courses.splice(+del.dataset.plDelcourse, 1); planDirty = true; render(); return true; }
  if (t.closest('[data-pl-paste]')) { planPasteOpen = !planPasteOpen; render(); return true; }
  if (t.closest('[data-pl-pasteadd]')) {
    const got = Programme.fromRows(($('#plPasteBox') || {}).value, planDraft.buckets);
    let added = 0, updated = 0;
    got.courses.forEach(c => {
      const have = planDraft.courses.find(x => x.code === c.code);
      if (have) { Object.assign(have, c); updated++; } else { planDraft.courses.push(c); added++; }
    });
    planPasteOpen = false; planDirty = true;
    planMsg = added + ' course(s) added, ' + updated + ' updated' + (got.skipped ? ', ' + got.skipped + ' row(s) skipped with no code' : '') + '. Not saved yet.';
    render(); return true;
  }
  if (t.closest('[data-pl-addblock]')) {
    const label = String(($('#plNewBlock') || {}).value || '').trim();
    if (!label) { toast('Give the block a name first'); return true; }
    planDraft.buckets[addBlockKey(label)] = { label, credits: 0 };
    planDirty = true; render(); return true;
  }
  if (t.closest('[data-pl-addtrack]')) {
    const label = String(($('#plNewTrack') || {}).value || '').trim();
    if (!label) { toast('Give the track a name first'); return true; }
    planDraft.tracks[addBlockKey(label, planDraft.tracks)] = { label, courses: [], coursesRequired: 3 };
    planDirty = true; render(); return true;
  }
  const dt = t.closest('[data-pl-deltrack]');
  if (dt) { delete planDraft.tracks[dt.dataset.plDeltrack]; planDirty = true; render(); return true; }
  return false;
}

// ---- the programme a transcript names ------------------------------------------
const ADVISORY_LINE = 'Advisory only. The official transcript from the registrar is the reference.';
const programmeKey = name => String(name || '').toLowerCase()
  .replace(/\b(b\.?\s?sc|bs|ba|bba|be|barch|bgd|bid|bfd|bl|mbbch|bods|bachelor( degree)? of|bachelor|in|of|and)\b\.?/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
/* "Science / Computer Science" -> the cs programme. Only an unambiguous match
   counts; anything else stays with the programme picked for the import. */
function programmeFromRecord(s) {
  const text = String((s && s.program) || '');
  if (!text.trim()) return null;
  const whole = ' ' + programmeKey(text) + ' ', last = programmeKey(text.split('/').pop());
  const rows = programmeRows().map(r => ({ id: r.id, key: programmeKey(programmeName(r.id)) })).filter(r => r.key);
  const exact = rows.filter(r => r.key === last);
  if (exact.length === 1) return exact[0].id;
  const hits = rows.filter(r => whole.includes(' ' + r.key + ' ')).sort((a, b) => b.key.length - a.key.length);
  if (hits.length === 1 || (hits.length > 1 && hits[0].key.length > hits[1].key.length)) return hits[0].id;
  return null;
}
// files each imported student under the programme its transcript names; returns who moved
function fileByTranscript(records, parsed) {
  const here = activeProgramme(), moved = [];
  (parsed || []).forEach(p => {
    const id = programmeFromRecord(p);
    if (!id || id === here) return;
    const rec = (records || []).find(r => r.id === p.id);
    if (!rec || rec.programme === id) return;
    rec.programme = id;
    moved.push({ name: rec.name || p.name, id: rec.id, programme: id });
  });
  return moved;
}
function elsewhereHtml(moved) {
  if (!moved || !moved.length) return '';
  return `<p style="margin-top:5px"><b>${moved.length} student${moved.length === 1 ? ' is' : 's are'} in another programme</b> according to the transcript and ${moved.length === 1 ? 'was' : 'were'} filed there:
    ${moved.slice(0, 8).map(m => esc(m.name) + ' (' + esc(programmeName(m.programme)) + ')').join(', ')}${moved.length > 8 ? ' and ' + (moved.length - 8) + ' more' : ''}.
    Switch the programme menu to see them.</p>`;
}

// heading line under a student list: which programme this is
function programmeLine() {
  const row = programmeRow(activeProgramme()) || {};
  return esc(programmeName(activeProgramme())) + (row.faculty ? ' · ' + esc(row.faculty) : '');
}
function emptyProgrammeHtml() {
  return `<div class="panel"><div class="bd stack">
    <p><b>No students in ${esc(programmeName(activeProgramme()))} yet.</b></p>
    <p class="note">Import this programme's transcripts and schedules${state.programmeReady ? '' : ', and set up its study plan first so they can be checked'}.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn sm primary" data-view="import">Import</button>
      ${canEditPlan(activeProgramme()) ? '<button class="btn sm" data-view="programme">Programme setup</button>' : ''}
    </div></div></div>`;
}
