/* ── Rules studio ─────────────────────────────────────────────────────────
   Rules shown as plain sentences with the numbers editable in place
   (change "18" in "between 12 and 18 credits" and the portal follows).
   - edits stay a draft until published; "See the effect" lists who'd move
   - publish needs a reason; history keeps who/when/before/why, so undo works
   - config is stored per department key, an admin only touches their own
   Advisors get the same page read-only. */

// ---- state ----------------------------------------------------------------
// untouched copies of the shipped rules, every apply starts from these
const BASE_R = JSON.parse(JSON.stringify(R));
const BASE_C = JSON.parse(JSON.stringify(C));
let rulesCfg = { values: {}, courses: {}, removed: [], history: [] };
let rulesDraft = null;          // { values, courses, removed } while editing
let rulesEffect = null;         // the last "See the effect" result
let rulesTab = 'rules';

const deptOf = () => (state.me && state.me.dept) || 'cs';
const DEPT_NAME = { cs: 'Computer Science' };

// dotted-path helpers; keys look like 'R.load.REG-LOAD-01.max' or 'C.totalCredits'
const pathGet = (root, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), root);
function pathSet(root, path, value) {
  const ks = path.split('.'); let o = root;
  ks.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
  o[ks[ks.length - 1]] = value;
}
const rootOf = key => key.startsWith('C.') ? [C, key.slice(2)] : [R, key.slice(2)];
const readKey = key => { const [r, p] = rootOf(key); return pathGet(r, p); };

// ---- rule sentences -------------------------------------------------------
/* {0}, {1}... are the editable numbers. A token can have several keys since
   some numbers live twice in the data (load limits are in the regulations
   and in the registration notice). textPath gets rewritten with the sentence
   so the explanation advisors see matches the number. */
const RULE_FIELDS = [
  { group: 'Credit load', id: 'load', textAr: 'في الخريف والربيع، يسجّل الطالب بين {0} و{1} ساعة.', text: 'In fall and spring, a student registers between {0} and {1} credits.',
    tokens: [{ keys: ['R.load.REG-LOAD-01.min', 'R.registration.min'], type: 'int', min: 0, max: 30 },
             { keys: ['R.load.REG-LOAD-01.max', 'R.registration.max'], type: 'int', min: 1, max: 30 }], textPath: 'R.load.REG-LOAD-01.text' },
  { group: 'Credit load', id: 'summer', textAr: 'في الفصل الصيفي، يسجّل الطالب {0} ساعات كحدّ أقصى.', text: 'In the summer semester, a student registers at most {0} credits.',
    tokens: [{ keys: ['R.load.REG-LOAD-05.max', 'R.registration.summerMax'], type: 'int', min: 0, max: 18 }], textPath: 'R.load.REG-LOAD-05.text' },
  { group: 'Credit load', id: 'high', textAr: 'بمعدل تراكمي لا يقل عن {0} و{1} ساعة منجزة، يمكن للطالب تسجيل حتى {2} ساعة.', text: 'With a CGPA of at least {0} and {1} credits earned, a student may register up to {2} credits.',
    tokens: [{ keys: ['R.load.REG-LOAD-02.requiresCgpa'], type: 'num', step: 0.01, min: 0, max: 4 },
             { keys: ['R.load.REG-LOAD-02.requiresEarned'], type: 'int', min: 0, max: 150 },
             { keys: ['R.load.REG-LOAD-02.max'], type: 'int', min: 1, max: 30 }], textPath: 'R.load.REG-LOAD-02.text' },
  { group: 'Credit load', id: 'senior', textAr: 'الطالب في سنة التخرج بمعدل لا يقل عن {0} يمكنه تسجيل حتى {1} ساعة.', text: 'A student in the graduation year with a CGPA of at least {0} may register up to {1} credits.',
    tokens: [{ keys: ['R.load.REG-LOAD-03.requiresCgpa', 'R.load.REG-LOAD-03.requiresSgpa'], type: 'num', step: 0.01, min: 0, max: 4 },
             { keys: ['R.load.REG-LOAD-03.max'], type: 'int', min: 1, max: 30 }], textPath: 'R.load.REG-LOAD-03.text' },
  { group: 'Academic standing', id: 'probation', textAr: 'معدل فصلي ومعدل تراكمي كلاهما دون {0} يضعان الطالب تحت الإنذار، بحد أقصى {1} ساعة في الفصل التالي.', text: 'A semester GPA and a CGPA both below {0} put a student on probation, with at most {1} credits the next semester.',
    tokens: [{ keys: ['R.probation.warningThresholdCgpa', 'R.probation.warningThresholdSgpa'], type: 'num', step: 0.01, min: 0, max: 4 },
             { keys: ['R.probation.warningLoadCap', 'R.registration.belowTwoCgpaMax'], type: 'int', min: 0, max: 30 }] },
  { group: 'Academic standing', id: 'remedial', textAr: '{0} إنذارات أكاديمية متتالية تضع الطالب في المرحلة العلاجية: {1} ساعة كحد أقصى في الخريف والربيع، و{2} في الصيف.', text: '{0} academic warnings in a row put the student in the remedial stage: at most {1} credits in fall and spring, and {2} in summer.',
    tokens: [{ keys: ['R.probation.remedialAfter'], type: 'int', min: 1, max: 6, dflt: 2 },
             { keys: ['R.probation.remedialFallSpringCap'], type: 'int', min: 0, max: 30 },
             { keys: ['R.probation.remedialSummerCap'], type: 'int', min: 0, max: 18 }] },
  { group: 'Academic standing', id: 'dismiss', textAr: 'بعد إنذارين متتاليين، المعدل التراكمي دون {0} يعرّض الطالب للفصل.', text: 'After two academic warnings in a row, a CGPA below {0} is a risk of dismissal.',
    tokens: [{ keys: ['R.probation.dismissCgpaBelow'], type: 'num', step: 0.01, min: 0, max: 4 }] },
  { group: 'Graduation', id: 'grad', textAr: 'للتخرج يحتاج الطالب إلى {0} ساعة ومعدل تراكمي لا يقل عن {1}.', text: 'To graduate, a student needs {0} credits and a CGPA of at least {1}.',
    tokens: [{ keys: ['R.graduation.totalCredits', 'C.totalCredits'], type: 'int', min: 1, max: 200 },
             { keys: ['R.graduation.minCgpa'], type: 'num', step: 0.01, min: 0, max: 4 }] },
  { group: 'Graduation', id: 'ic3', textAr: 'تُستحق شهادة IC3 قبل نهاية الفصل {0}.', text: 'The IC3 certificate is due by semester {0}.',
    tokens: [{ keys: ['R.nonCredit.REG-UE-06.dueBySemester'], type: 'int', min: 1, max: 12 }], textPath: 'R.nonCredit.REG-UE-06.text' },
  { group: 'Graduation', id: 'wrnl', textAr: 'مقرر Work Ready Now (WRNL200) مطلوب للطلاب المقبولين ابتداءً من العام الجامعي {0}، بعد تجاوز {1} ساعة.', text: 'Work Ready Now (WRNL200) is required for students admitted from the {0} academic year on, once a student passes {1} credits.',
    tokens: [{ keys: ['R.universityElectives.REG-UE-05.appliesFromAdmissionYear'], type: 'int', min: 2000, max: 2100 },
             { keys: ['R.universityElectives.REG-UE-05.requiredAboveEarnedCredits'], type: 'int', min: 0, max: 150 }] },
  { group: 'Electives and tracks', id: 'ue', textAr: 'المقررات الاختيارية الجامعية {0} ساعة، منها {1} مقرر في الإنسانيات و{2} في العلوم الاجتماعية على الأقل.', text: 'University electives come to {0} credits, with at least {1} humanities course and {2} social science course.',
    tokens: [{ keys: ['R.universityElectives.REG-UE-03.totalCredits'], type: 'int', min: 0, max: 30 },
             { keys: ['R.universityElectives.REG-UE-03.minHumanitiesCourses'], type: 'int', min: 0, max: 5 },
             { keys: ['R.universityElectives.REG-UE-03.minSocialCourses'], type: 'int', min: 0, max: 5 }] },
  { group: 'Electives and tracks', id: 'de', textAr: 'تضع الخطة الدراسية مقررًا اختياريًا للقسم في الفصول {0}، ويعرض نظام التوصية {1} منها كحد أقصى في كل مرة.', text: 'The study plan places a departmental elective in semesters {0}, and the recommender shows at most {1} at a time.',
    tokens: [{ keys: ['C.deptElectiveSlots'], type: 'list', num: true },
             { keys: ['C.deptElectiveShowMax'], type: 'int', min: 1, max: 10, dflt: 3 }] },
  { group: 'Electives and tracks', id: 'ahead', textAr: 'لا يُوصى بمقررات إلزامية تتقدم الخطة الدراسية بأكثر من {0} فصل.', text: 'Core courses are recommended at most {0} semester ahead of the study plan.',
    tokens: [{ keys: ['C.coreAheadSemesters'], type: 'int', min: 0, max: 6, dflt: 1 }] },
  { group: 'Electives and tracks', id: 'track', textAr: 'يُكتسب المسار بـ{0} مقررات اختيارية من قائمة مسار واحد.', text: 'A track is earned with {0} departmental electives from one track list.',
    tokens: [{ keys: Object.keys(BASE_C.tracks || {}).map(k => 'C.tracks.' + k + '.coursesRequired'), type: 'int', min: 1, max: 6 }] },
  { group: 'Minor', id: 'minor', textAr: 'يتطلب التخصص الفرعي في الرياضيات {0} ساعة MATH، منها أحد المقررات: {1}.', text: 'The Minor in Mathematics needs {0} MATH credits, including one of {1}.',
    tokens: [{ keys: ['C.mathMinor.minCredits', 'C.mathMinor.maxCredits'], type: 'int', min: 1, max: 40 },
             { keys: ['C.mathMinor.requiredOneOf'], type: 'list' }] }
];

// value for a token: config override, else live data, else dflt
const tokVal = (tok, cfgValues) => {
  const k = tok.keys[0];
  if (cfgValues && Object.prototype.hasOwnProperty.call(cfgValues, k)) return cfgValues[k];
  const v = readKey(k);
  return v == null ? tok.dflt : v;
};
const showVal = (tok, v) => tok.type === 'list' ? (v || []).join(', ') : tok.type === 'num' ? Number(v).toFixed(2) : String(v);
const sentence = (rf, vals) => rf.text.replace(/\{(\d)\}/g, (m, i) => showVal(rf.tokens[i], vals[i]));

// ---- applying a config ----------------------------------------------------
// Always reset to the shipped rules first, then lay the changes on top.
// That's what makes undo actually bring the old number back.
function resetInto(target, base) {
  Object.keys(target).forEach(k => delete target[k]);
  Object.assign(target, JSON.parse(JSON.stringify(base)));
}
function applyRules(cfg) {
  resetInto(R, BASE_R); resetInto(C, BASE_C);
  Object.keys(cfg.values || {}).forEach(key => {
    const rf = RULE_FIELDS.find(f => f.tokens.some(t => t.keys[0] === key));
    const tok = rf && rf.tokens.find(t => t.keys[0] === key);
    (tok ? tok.keys : [key]).forEach(k => { const [r, p] = rootOf(k); pathSet(r, p, cfg.values[key]); });
  });
  // edited sentences replace the rule texts shown elsewhere in the portal
  RULE_FIELDS.forEach(rf => {
    if (!rf.textPath) return;
    if (!rf.tokens.some(t => Object.prototype.hasOwnProperty.call(cfg.values || {}, t.keys[0]))) return;
    const [r, p] = rootOf(rf.textPath); pathSet(r, p, sentence(rf, rf.tokens.map(t => tokVal(t))));
  });
  // study plan edits: drop removed courses, patch edited ones, add new ones
  const removed = new Set(cfg.removed || []);
  C.courses = C.courses.filter(c => !removed.has(c.code));
  Object.keys(cfg.courses || {}).forEach(code => {
    const have = C.courses.find(c => c.code === code);
    if (have) Object.assign(have, cfg.courses[code]);
    else C.courses.push(Object.assign({ code, pre: [], co: [], runsIn: ['FALL', 'SPRING'] }, cfg.courses[code]));
  });
  if (Array.isArray(cfg.terms) && cfg.terms.length) R.terms = JSON.parse(JSON.stringify(cfg.terms));
  MAP = E.byCode(C);
  if (typeof syncTerm === 'function' && state.term) syncTerm();
  flush();
}

async function loadRulesConfig() {
  try {
    const got = await Store.getConfig(deptOf());
    if (got && typeof got === 'object') rulesCfg = Object.assign({ values: {}, courses: {}, removed: [], history: [] }, got);
  } catch (e) { /* no saved config, keep the shipped rules */ }
  applyRules(rulesCfg);
}

const draftOrSaved = () => rulesDraft || rulesCfg;
const isAdminNow = () => !!(state.me && state.me.admin);

// ---- see the effect / publish / undo --------------------------------------
// compact fingerprint of a student's result, if it differs the student "moved"
function signature(s) {
  const { snap, level } = look(s);
  const a = E.graduationAudit(R, C, s);
  return [level, snap.standing.state, snap.standing.remedial ? 'R' : '', snap.standing.loadCap || '', a.blockers.length, a.remainingCredits].join('|');
}
function seeEffect() {
  const pool = state.students.filter(s => !offProgramme(s));
  applyRules(rulesCfg);
  const before = new Map(pool.map(s => [s.id, { sig: signature(s), level: look(s).level, st: look(s).snap.standing }]));
  applyRules(draftOrSaved());
  const moved = [];
  pool.forEach(s => {
    const b = before.get(s.id), sig = signature(s);
    if (b.sig !== sig) {
      const now = look(s);
      const bits = [];
      if (b.level !== now.level) bits.push(LEVEL[b.level].word + ' → ' + LEVEL[now.level].word);
      if (b.st.state !== now.snap.standing.state) bits.push(standingWord(b.st.state) + ' → ' + standingWord(now.snap.standing.state));
      if (!!b.st.remedial !== !!now.snap.standing.remedial) bits.push(now.snap.standing.remedial ? 'now in the remedial stage' : 'out of the remedial stage');
      if ((b.st.loadCap || 0) !== (now.snap.standing.loadCap || 0)) bits.push('credit cap ' + (b.st.loadCap || 'none') + ' → ' + (now.snap.standing.loadCap || 'none'));
      if (!bits.length) bits.push('graduation check changes');
      moved.push({ s, what: bits.join(', ') });
    }
  });
  applyRules(rulesCfg);   // back to the published rules, the draft only applies on publish
  rulesEffect = { moved, total: pool.length, at: Date.now() };
}

// human-readable list of what changed, goes into the history entry
function describeChanges(from, to) {
  const out = [];
  RULE_FIELDS.forEach(rf => rf.tokens.forEach(tok => {
    const k = tok.keys[0];
    const a = Object.prototype.hasOwnProperty.call(from.values, k) ? from.values[k] : pathGet(k.startsWith('C.') ? BASE_C : BASE_R, k.slice(2));
    const b = Object.prototype.hasOwnProperty.call(to.values, k) ? to.values[k] : a;
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(rf.group + ': ' + showVal(tok, a == null ? tok.dflt : a) + ' → ' + showVal(tok, b) + ' (' + rf.text.replace(/\{\d\}/g, '…').slice(0, 60) + ')');
  }));
  Object.keys(to.courses || {}).forEach(code => {
    if (JSON.stringify((from.courses || {})[code]) !== JSON.stringify(to.courses[code])) out.push('Study plan: ' + code + ' edited');
  });
  (to.removed || []).filter(c => !(from.removed || []).includes(c)).forEach(c => out.push('Study plan: ' + c + ' removed'));
  (from.removed || []).filter(c => !(to.removed || []).includes(c)).forEach(c => out.push('Study plan: ' + c + ' brought back'));
  if (JSON.stringify(from.terms || BASE_R.terms || []) !== JSON.stringify(to.terms || from.terms || BASE_R.terms || [])) out.push('Calendar: dates updated');
  return out;
}

async function publishRules(reason) {
  const next = { values: rulesDraft.values, courses: rulesDraft.courses, removed: rulesDraft.removed, terms: rulesDraft.terms || rulesCfg.terms };
  const changes = describeChanges(rulesCfg, next);
  if (!changes.length) { toast('Nothing has changed'); return; }
  const entry = { at: Date.now(), by: fullName(state.me), reason, changes,
    before: { values: rulesCfg.values, courses: rulesCfg.courses, removed: rulesCfg.removed, terms: rulesCfg.terms } };
  const saved = Object.assign({}, next, { history: [entry].concat(rulesCfg.history || []).slice(0, 200) });
  await Store.saveConfig(deptOf(), saved);
  rulesCfg = saved; rulesDraft = null; rulesEffect = null;
  applyRules(rulesCfg);
  render();
  toast('Published. Every student is now checked with the new rules.');
}

// undo = publish the "before" snapshot as a new change (history only grows)
async function undoRules(i) {
  const h = (rulesCfg.history || [])[i];
  if (!h || !h.before) return;
  rulesDraft = JSON.parse(JSON.stringify(h.before));
  await publishRules('Undo: ' + (h.reason || 'change of ' + new Date(h.at).toLocaleDateString()));
}

// ---- the page -------------------------------------------------------------
function viewRules() {
  const admin = isAdminNow();
  const cfg = draftOrSaved();
  const editing = admin && !!rulesDraft;
  const groups = [];
  RULE_FIELDS.forEach(rf => { if (!groups.includes(rf.group)) groups.push(rf.group); });
  // a number in a sentence: bold text when viewing, an input when editing
  const inputFor = (rf, ti) => {
    const tok = rf.tokens[ti], v = tokVal(tok, cfg.values);
    const changed = rulesDraft && JSON.stringify(v) !== JSON.stringify(tokVal(tok, rulesCfg.values));
    if (!editing) return `<b class="rv${changed ? ' changed' : ''}">${esc(showVal(tok, v))}</b>`;
    if (tok.type === 'list') return `<input class="rin list${changed ? ' changed' : ''}" data-rf="${rf.id}:${ti}" value="${esc(showVal(tok, v))}" size="${Math.max(6, showVal(tok, v).length + 1)}">`;
    return `<input class="rin${changed ? ' changed' : ''}" type="number" data-rf="${rf.id}:${ti}" value="${esc(tok.type === 'num' ? Number(v).toFixed(2) : v)}"
      step="${tok.step || 1}" min="${tok.min != null ? tok.min : ''}" max="${tok.max != null ? tok.max : ''}">`;
  };
  const rulesHtml = groups.map(g => `<div class="panel"><div class="hd">${esc(g)}</div><div class="bd rsent">
      ${RULE_FIELDS.filter(rf => rf.group === g).map(rf => `<p class="rs">${esc(LANG === 'ar' && rf.textAr ? rf.textAr : rf.text).replace(/\{(\d)\}/g, (m, i) => inputFor(rf, +i))}</p>`).join('')}
    </div></div>`).join('');

  const BUCKETS = Object.keys(C.buckets).filter(k => !['FRESHMAN', 'OTHER'].includes(k));
  const extra = Object.keys(cfg.courses || {}).filter(code => !C.courses.some(c => c.code === code)).map(code => Object.assign({ code }, cfg.courses[code]));
  const plan = C.courses.concat(extra).filter(c => ['FACULTY_CORE', 'MAJOR_CORE', 'DEPT_ELECTIVE', 'UNIV_MANDATORY'].includes(c.bucket) || (cfg.courses || {})[c.code])
    .slice().sort((a, b) => (a.planSem || 9) - (b.planSem || 9) || a.code.localeCompare(b.code));
  const cv = (c, f) => { const o = (cfg.courses || {})[c.code] || {}; return o[f] !== undefined ? o[f] : c[f]; };
  const removed = new Set(cfg.removed || []);
  const planHtml = `<div class="panel"><div class="hd">Study plan courses${editing ? '<i class="sep-dot"></i>edit any cell' : ''}</div>
    <div class="bd"><div class="ptable-wrap"><table class="ptable">
      <thead><tr><th>Code</th><th>Title</th><th>Cr</th><th>Category</th><th>Semester</th><th>Prerequisites</th><th>Runs in</th>${editing ? '<th></th>' : ''}</tr></thead>
      <tbody>${plan.map(c => {
        const gone = removed.has(c.code);
        const cell = (f, html) => `<td>${html}</td>`;
        if (!editing) return `<tr class="${gone ? 'gone' : ''}"><td class="mono">${c.code}</td><td>${esc(nice(cv(c, 'title')))}</td><td>${cv(c, 'cr')}</td>
          <td>${esc(((C.buckets[cv(c, 'bucket')] || {}).label) || cv(c, 'bucket'))}</td><td>${cv(c, 'planSem') || '—'}</td>
          <td class="mono">${esc((cv(c, 'pre') || []).join(', ') || '—')}</td><td>${esc((cv(c, 'runsIn') || []).map(x => x[0] + x.slice(1).toLowerCase()).join(', '))}</td></tr>`;
        const runs = (cv(c, 'runsIn') || []).join(',');
        return `<tr class="${gone ? 'gone' : ''}"><td class="mono">${c.code}</td>
          ${cell('title', `<input class="pin" data-pc="${c.code}:title" value="${esc(cv(c, 'title'))}">`)}
          ${cell('cr', `<input class="pin n" type="number" min="0" max="12" data-pc="${c.code}:cr" value="${cv(c, 'cr')}">`)}
          ${cell('bucket', `<select class="pin" data-pc="${c.code}:bucket">${BUCKETS.map(b => `<option value="${b}"${b === cv(c, 'bucket') ? ' selected' : ''}>${esc(C.buckets[b].label || b)}</option>`).join('')}</select>`)}
          ${cell('planSem', `<select class="pin n" data-pc="${c.code}:planSem"><option value="">—</option>${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option${n === cv(c, 'planSem') ? ' selected' : ''}>${n}</option>`).join('')}</select>`)}
          ${cell('pre', `<input class="pin mono" data-pc="${c.code}:pre" value="${esc((cv(c, 'pre') || []).join(', '))}" placeholder="none">`)}
          ${cell('runsIn', `<select class="pin" data-pc="${c.code}:runsIn">${[['FALL', 'Fall'], ['SPRING', 'Spring'], ['FALL,SPRING', 'Both']].map(([v, l]) => `<option value="${v}"${v === runs ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
          <td><button class="linkbtn" data-pc-del="${c.code}">${gone ? 'Bring back' : 'Remove'}</button></td></tr>`;
      }).join('')}</tbody></table></div>
      ${editing ? `<div class="row" style="margin-top:10px;gap:8px"><input id="newCode" class="pin mono" placeholder="New course code, e.g. CMPS470" style="max-width:260px">
        <button class="btn sm" data-pc-add="1">Add course</button></div>` : ''}
    </div></div>`;

  const hist = (rulesCfg.history || []);
  const histHtml = `<div class="panel"><div class="hd">History of changes</div><div class="bd">
    ${hist.length ? `<ol class="rhist">${hist.map((h, i) => `<li><div class="rh-top"><b>${esc(h.by)}</b><span>${esc(new Date(h.at).toLocaleString())}</span>
        ${admin ? `<button class="linkbtn" data-rules-undo="${i}">Undo this change</button>` : ''}</div>
        <p class="rh-why">${esc(h.reason || 'No reason given')}</p>
        <ul>${(h.changes || []).map(c => `<li>${esc(c)}</li>`).join('')}</ul></li>`).join('')}</ol>`
      : '<p class="note">No change has been made yet. The rules are the ones the portal shipped with, taken from the BAU regulations and the study plan.</p>'}
  </div></div>`;

  const effect = rulesEffect ? `<div class="effect ${rulesEffect.moved.length || !rulesEffect.total ? 'some' : ''}">
      <b>${!rulesEffect.total ? 'No students are loaded in this account to test the change on.' : rulesEffect.moved.length ? rulesEffect.moved.length + ' of ' + rulesEffect.total + ' students would change' : 'No student would change'}</b>
      ${rulesEffect.moved.length ? `<ul>${rulesEffect.moved.slice(0, 25).map(m => `<li><button class="slink" data-open="${m.s.id}">${esc(m.s.name)}</button>: ${esc(m.what)}</li>`).join('')}</ul>
        ${rulesEffect.moved.length > 25 ? `<p class="note">and ${rulesEffect.moved.length - 25} more.</p>` : ''}` : ''}
    </div>` : '';

  const bar = admin ? (editing
    ? `<div class="rbar editing"><span class="dot"></span><span><b>Draft.</b> Nobody is affected until you publish.</span>
        <button class="btn sm" data-rules-effect="1">See the effect</button>
        <input id="rulesWhy" placeholder="Why the change (kept in the history)" class="pin" style="flex:1;min-width:180px">
        <button class="btn sm primary" data-rules-publish="1">Publish</button>
        <button class="btn sm ghost" data-rules-cancel="1">Discard</button></div>`
    : `<div class="rbar"><span>These are the rules every student is checked with, for ${esc(DEPT_NAME[deptOf()] || deptOf())}.</span>
        <button class="btn sm primary" data-rules-edit="1">Change the rules</button></div>`)
    : `<div class="rbar"><span>The rules every student is checked with. Only the department admin can change them; ask them if something here is wrong.</span></div>`;

  return `<div class="wrap">
    <div class="page-h"><h1>${admin ? 'Rules and study plan' : 'Rules in force'}</h1>
      <p>${admin ? 'Written as sentences. Change a number, see who it affects, then publish. Every change is kept and can be undone.' : 'What the portal checks, in plain sentences, exactly as the department has set it.'}</p></div>
    ${bar}${effect}
    <div class="seg" style="align-self:flex-start">${[['rules', 'Rules'], ['plan', 'Study plan'], ['calendar', 'Calendar'], ['history', 'History']].map(([k, l]) =>
      `<button data-rules-tab="${k}" aria-pressed="${rulesTab === k}">${l}</button>`).join('')}</div>
    ${rulesTab === 'plan' ? planHtml : rulesTab === 'calendar' ? calendarHtml(cfg, editing) : rulesTab === 'history' ? histHtml : rulesHtml}
  </div>`;
}

// ---- academic calendar: drives "this term", add/drop and the plan target ----
const CAL_FIELDS = [['regOpens', 'Registration opens'], ['classesStart', 'Classes start'], ['addDropEnds', 'Add/drop ends'], ['withdrawBy', 'Withdraw by'], ['ends', 'Term ends']];
function calendarHtml(cfg, editing) {
  const terms = (cfg.terms || R.terms || []);
  const c = state.cal;
  return `<div class="panel"><div class="hd">Academic calendar${c ? '<i class="sep-dot"></i>now: ' + esc(shortTerm(c.term)) + ' · ' + phaseLine() : ''}</div>
    <div class="bd"><div class="ptable-wrap"><table class="ptable cal">
      <thead><tr><th>Term</th>${CAL_FIELDS.map(f => `<th>${f[1]}</th>`).join('')}</tr></thead>
      <tbody>${terms.map((t, i) => `<tr${c && c.term === t.term ? ' class="now"' : ''}><td><b>${esc(shortTerm(t.term))}</b></td>${CAL_FIELDS.map(([k]) =>
        `<td>${editing ? `<input type="date" class="rin" data-cal="${i}:${k}" value="${esc(t[k] || '')}">` : (t[k] ? fmtDay(t[k]) : '—')}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    ${editing ? '<button class="btn sm" data-cal-add="1" style="margin-top:10px">Add the next term</button>' : ''}</div></div>`;
}

// ---- editing --------------------------------------------------------------
// data-rf = rule token input, data-pc = study plan cell. Numbers get clamped to min/max.
function rulesInput(el) {
  if (!rulesDraft) return false;
  if (el.dataset.cal) {
    const [i, k] = el.dataset.cal.split(':');
    rulesDraft.terms = (rulesDraft.terms || []).slice();
    rulesDraft.terms[+i] = Object.assign({}, rulesDraft.terms[+i], { [k]: el.value });
    rulesEffect = null; el.classList.add('changed');
    return true;
  }
  if (el.dataset.rf) {
    const [id, ti] = el.dataset.rf.split(':');
    const rf = RULE_FIELDS.find(f => f.id === id), tok = rf.tokens[+ti];
    let v = el.value;
    if (tok.type === 'list') v = v.split(/[,\s]+/).filter(Boolean).map(x => tok.num ? Number(x) : x.toUpperCase());
    else { v = tok.type === 'int' ? parseInt(v, 10) : parseFloat(v); if (isNaN(v)) return true; if (tok.min != null) v = Math.max(tok.min, v); if (tok.max != null) v = Math.min(tok.max, v); }
    rulesDraft.values[tok.keys[0]] = v;
    rulesEffect = null;
    el.classList.add('changed');
    return true;
  }
  if (el.dataset.pc) {
    const [code, f] = el.dataset.pc.split(':');
    const o = rulesDraft.courses[code] = Object.assign({}, rulesDraft.courses[code]);
    let v = el.value;
    if (f === 'cr' || f === 'planSem') v = v === '' ? null : Number(v);
    if (f === 'pre') v = v.split(/[,\s]+/).filter(Boolean).map(x => x.toUpperCase());
    if (f === 'runsIn') v = v.split(',');
    o[f] = v;
    rulesEffect = null;
    return true;
  }
  return false;
}

async function rulesClick(t) {
  const tab = t.closest('[data-rules-tab]');
  if (tab) { rulesTab = tab.dataset.rulesTab; render(); return true; }
  if (t.closest('[data-rules-edit]')) { rulesDraft = JSON.parse(JSON.stringify({ values: rulesCfg.values, courses: rulesCfg.courses, removed: rulesCfg.removed || [], terms: rulesCfg.terms || R.terms || [] })); render(); return true; }
  if (t.closest('[data-rules-cancel]')) { rulesDraft = null; rulesEffect = null; applyRules(rulesCfg); render(); return true; }
  if (t.closest('[data-rules-effect]')) { seeEffect(); render(); return true; }
  if (t.closest('[data-rules-publish]')) {
    const why = ($('#rulesWhy') || {}).value || '';
    if (!why.trim()) { toast('Write a few words on why, so the history makes sense later.'); const w = $('#rulesWhy'); if (w) w.focus(); return true; }
    await publishRules(why.trim()); return true;
  }
  const undo = t.closest('[data-rules-undo]');
  if (undo) { await undoRules(+undo.dataset.rulesUndo); return true; }
  const del = t.closest('[data-pc-del]');
  if (del && rulesDraft) {
    const code = del.dataset.pcDel, r = new Set(rulesDraft.removed || []);
    if (r.has(code)) r.delete(code); else r.add(code);
    rulesDraft.removed = Array.from(r); rulesEffect = null; render(); return true;
  }
  if (t.closest('[data-cal-add]') && rulesDraft) {
    const ts = rulesDraft.terms = (rulesDraft.terms || []).slice();
    const last = ts[ts.length - 1];
    const term = last ? E.nextTermAfter(last.term) : state.nextTerm;
    ts.push({ term, regOpens: '', classesStart: '', addDropEnds: '', withdrawBy: '', ends: '' });
    render(); return true;
  }
  if (t.closest('[data-pc-add]') && rulesDraft) {
    const code = String(($('#newCode') || {}).value || '').toUpperCase().replace(/\s/g, '');
    if (!/^[A-Z]{3,4}\d{3}[A-Z]?$/.test(code)) { toast('A course code looks like CMPS470'); return true; }
    if (C.courses.some(c => c.code === code) || rulesDraft.courses[code]) { toast(code + ' is already in the plan'); return true; }
    rulesDraft.courses[code] = { code, title: 'New course', cr: 3, bucket: 'MAJOR_CORE', planSem: null, pre: [], co: [], runsIn: ['FALL', 'SPRING'] };
    render(); return true;
  }
  return false;
}
