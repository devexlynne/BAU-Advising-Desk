/* ── Per-student exceptions ─────────────────────────────────────────────────
   An approved decision for ONE student, kept on that student's record with a
   reason, who approved it and when:
   - substitute: a course the student passed counts in place of a required one
   - waive: a required course is no longer asked for (no credits are given;
     the degree's credit total still has to be reached)
   The transcript itself is never changed. Every advising check sees a copy of
   the record with the exceptions laid on top, so alerts, the graduation check
   and the recommendations all agree. */

const EXCEPTION_KINDS = { substitute: 'Substitute', waive: 'Waive' };
// engine entry points that take the student as their third argument
const EXCEPTION_FNS = ['snapshot', 'validateBasket', 'recommend', 'lookAhead', 'graduationAudit', 'minorAudit',
  'yearDelayRisks', 'repeatsDue', 'checkRegistration', 'alerts', 'planNextTerm', 'checkPlan', 'statusOf', 'wrnlRequired'];
const exceptionCache = new WeakMap();
const passingRow = h => !!h && E.isPassing(R, h.grade);

function withExceptions(s) {
  const list = s && Array.isArray(s.exceptions) ? s.exceptions.filter(x => x && !x.removed) : [];
  if (!list.length) return s;
  const key = JSON.stringify(list) + ':' + (s.history || []).length + ':' + (s.updatedAt || 0);
  const hit = exceptionCache.get(s);
  if (hit && hit.key === key) return hit.value;
  const copy = Object.assign({}, s, { history: (s.history || []).map(h => Object.assign({}, h)) });
  list.forEach(x => {
    if (copy.history.some(h => h.code === x.course && passingRow(h))) return;   // already passed for real
    if (x.kind === 'substitute') {
      // the best counted attempt of the course taken fills the required one's place
      const row = copy.history.filter(h => h.code === x.taken && passingRow(h) && h.flag !== 'A')
        .sort((a, b) => (Number(b.earned) || 0) - (Number(a.earned) || 0))[0];
      if (row) { row.substituteFor = x.course; row.takenAs = row.code; row.code = x.course; }
    } else if (x.kind === 'waive') {
      copy.history.push({ code: x.course, title: 'Waived', cr: 0, grade: 'TR', earned: 0, term: 'TRANSFER', flag: 'N', waived: true });
    }
  });
  exceptionCache.set(s, { key, value: copy });
  return copy;
}
EXCEPTION_FNS.forEach(name => {
  const fn = E[name];
  if (typeof fn !== 'function') return;
  E[name] = function (rules, catalog, student, ...rest) { return fn.call(this, rules, catalog, withExceptions(student), ...rest); };
});

let exceptionForm = null;   // { id } of the student whose form is open
let exceptionMsg = '';

function exceptionTitle(code) { const c = MAP[code] || C.courses.find(x => x.code === code); return c ? code + ' ' + nice(c.title || '') : code; }

function exceptionsPanel(s) {
  const list = (s.exceptions || []).filter(x => !x.removed);
  const open = exceptionForm && exceptionForm.id === s.id;
  const when = at => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const passed = new Set((s.history || []).filter(passingRow).map(h => h.code));
  const required = C.courses.filter(c => ['UNIV_MANDATORY', 'FACULTY_CORE', 'MAJOR_CORE'].includes(c.bucket) && !passed.has(c.code))
    .sort((a, b) => a.code.localeCompare(b.code));
  const takenCodes = Array.from(passed).sort();
  const form = open ? `<div class="stack" style="margin-top:8px">
      <label class="f">Decision<select id="exKind" class="pin">${Object.keys(EXCEPTION_KINDS).map(k => `<option value="${k}">${EXCEPTION_KINDS[k]}</option>`).join('')}</select></label>
      <label class="f">Required course<select id="exCourse" class="pin">${required.map(c => `<option value="${esc(c.code)}">${esc(c.code + ' ' + nice(c.title || ''))}</option>`).join('')}</select></label>
      <label class="f" id="exTakenWrap">Counted in its place (substitute only)<select id="exTaken" class="pin">${takenCodes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label>
      <label class="f">Reason<input id="exReason" class="pin" maxlength="300" placeholder="e.g. equivalent course taken before transfer"></label>
      <label class="f">Approved by<input id="exApprover" class="pin" maxlength="120" placeholder="e.g. Department head, 3 Nov"></label>
      ${exceptionMsg ? `<p class="note" style="color:var(--urgent)">${esc(exceptionMsg)}</p>` : ''}
      <div style="display:flex;gap:8px"><button class="btn sm primary" data-ex-save="${esc(s.id)}">Save exception</button><button class="btn sm" data-ex-cancel="1">Cancel</button></div>
      <p class="note">Only record a decision that has already been approved. The transcript is not changed.</p>
    </div>` : '';
  return `<div class="panel"><div class="hd">Exceptions</div><div class="bd stack">
    ${list.length ? `<ul class="ex-list" style="margin:0;padding-left:18px">${list.map(x => `<li style="margin-bottom:6px">
        <b>${x.kind === 'substitute' ? esc(x.taken) + ' counts as ' + esc(exceptionTitle(x.course)) : esc(exceptionTitle(x.course)) + ' waived'}</b><br>
        <span class="note">${esc(x.reason)} · approved by ${esc(x.approvedBy)} · recorded ${esc(when(x.at))}${x.by ? ' by ' + esc(x.by) : ''}</span>
        <button class="linkbtn no-print" data-ex-remove="${esc(s.id)}:${esc(x.id)}">Remove</button></li>`).join('')}</ul>`
      : '<p class="note">No exceptions recorded. A substitution or waiver approved for this student goes here, so the checks stop listing that course as missing.</p>'}
    ${open ? form : `<div class="no-print"><button class="btn sm" data-ex-add="${esc(s.id)}">Record an exception</button></div>`}
  </div></div>`;
}

async function saveStudentRecord(st) {
  const owner = st.advisorSlug || state.me.slug;
  const record = Object.assign({}, st); delete record.advisorSlug;
  await Store.saveStudent(owner, record);
  st.updatedAt = record.updatedAt;
}

async function exceptionsClick(t) {
  const add = t.closest('[data-ex-add]');
  if (add) { exceptionForm = { id: add.dataset.exAdd }; exceptionMsg = ''; render(); return true; }
  if (t.closest('[data-ex-cancel]')) { exceptionForm = null; exceptionMsg = ''; render(); return true; }
  const save = t.closest('[data-ex-save]');
  if (save) {
    const st = state.students.find(x => x.id === save.dataset.exSave);
    if (!st) return true;
    const kind = ($('#exKind') || {}).value, course = ($('#exCourse') || {}).value, taken = ($('#exTaken') || {}).value;
    const reason = String(($('#exReason') || {}).value || '').trim(), approvedBy = String(($('#exApprover') || {}).value || '').trim();
    if (!course) { exceptionMsg = 'Pick the required course.'; render(); return true; }
    if (kind === 'substitute' && !taken) { exceptionMsg = 'Pick the course that counts in its place.'; render(); return true; }
    if (!reason || !approvedBy) { exceptionMsg = 'Write the reason and who approved it.'; render(); return true; }
    const entry = { id: 'x' + Date.now().toString(36), kind, course, reason, approvedBy, at: Date.now(), by: fullName(state.me) };
    if (kind === 'substitute') entry.taken = taken;
    st.exceptions = (st.exceptions || []).concat([entry]);
    await saveStudentRecord(st);
    exceptionForm = null; exceptionMsg = '';
    flush(); render(); toast('Exception recorded');
    return true;
  }
  const rem = t.closest('[data-ex-remove]');
  if (rem) {
    const [id, xid] = rem.dataset.exRemove.split(':');
    const st = state.students.find(x => x.id === id);
    if (!st || !window.confirm('Remove this exception? The course will count as missing again.')) return true;
    // kept in the record as removed, so the history of decisions survives
    st.exceptions = (st.exceptions || []).map(x => x.id === xid ? Object.assign({}, x, { removed: true, removedAt: Date.now(), removedBy: fullName(state.me) }) : x);
    await saveStudentRecord(st);
    flush(); render(); toast('Exception removed');
    return true;
  }
  return false;
}
