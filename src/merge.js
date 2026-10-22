/*
 * merge.js - folds a transcript/schedule import into an advisor's list.
 * Runs on first import and again every semester, kept off the page so the
 * tests can hit it directly.
 *   - new transcript = new student, otherwise update the existing one
 *   - hand-entered stuff stays (note, email, phone, campus, this term's schedule)
 *   - transcript wins on courses, grades, official CGPA and credits
 *   - schedule IDs not in this advisor's list get reported, not dropped
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Merge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // BAU emails are built from name + ID, so we can always fill one in.
  // The rule lives in engine.js; this require is just so tests work standalone.
  const engine = (typeof require === 'function' && typeof module === 'object')
    ? require('./engine.js')
    : (typeof self !== 'undefined' ? self.Engine : null);
  function applyEmail(rec, id) {
    if (!engine || !engine.fixEmail) return;
    const r = engine.fixEmail(rec.name, id, rec.email);
    rec.email = r.email || '';
    if (r.guessed) rec.emailGuessed = true; else delete rec.emailGuessed;
  }

  // ---- transcripts --------------------------------------------------------

  // advisor-owned fields, a re-import never touches these
  const KEEP = ['note', 'reviewed', 'critical', 'hold', 'meetings', 'registration', 'campus', 'campusMixed', 'campusesThisTerm', 'track', 'advisorNotes'];

  function mergeTranscripts(existing, parsed, advisorName) {
    const byId = new Map((existing || []).map(s => [String(s.id), s]));
    const out = [];
    let added = 0, updated = 0;

    (parsed || []).forEach(ns => {
      const id = String(ns.id);
      const old = byId.get(id);
      if (!old) {
        added++;
        const fresh = Object.assign({
          email: '', phone: '', campus: 'Beirut', registration: null
        }, ns, { id, advisor: advisorName });
        applyEmail(fresh, id);
        out.push(fresh);
        return;
      }
      updated++;
      // a field the PDF left empty never blanks what is already stored
      const fresh = {};
      Object.keys(ns).forEach(k => { if (!(ns[k] === '' || ns[k] == null)) fresh[k] = ns[k]; });
      const merged = Object.assign({}, old, fresh, { id, advisor: advisorName });
      KEEP.forEach(k => { if (old[k] !== undefined) merged[k] = old[k]; });
      // A schedule can arrive before any transcript. Once the transcript does
      // arrive, it resolves the temporary "no transcript / unsorted" state but
      // KEEP above retains the already-saved registration.
      if (old.noTranscript) {
        delete merged.noTranscript;
        delete merged.groupReason;
        if (merged.group === 'unsorted') delete merged.group;
      }
      // hand-typed contact beats a blank from the PDF
      merged.email = old.email || ns.email || '';
      applyEmail(merged, id);
      merged.phone = old.phone || ns.phone || '';
      out.push(merged);
    });

    return { students: out, added, updated };
  }

  // ---- schedules ----------------------------------------------------------

  // Returns only the students that changed (so we only save those) plus the
  // IDs with no matching student. During the real import, keep a schedule-only
  // placeholder when transcripts have not been loaded yet; the later
  // transcript merge replaces its identity/history and preserves registration.
  function applySchedules(students, registrations, options) {
    options = options || {};
    const byId = new Map((students || []).map(s => [String(s.id), s]));
    const touched = [], unknown = [], created = [];
    let courses = 0;

    (registrations || []).forEach(r => {
      const id = String(r.id);
      let s = byId.get(id);
      if (!s && options.createMissing) {
        s = {
          id, name: r.name || ('Student ' + id), arabName: '', email: '', phone: '',
          campus: 'Beirut', history: [], termSummary: [], officialCredits: null,
          officialCgpa: null, registration: null, source: 'schedule-import',
          advisor: options.advisorName || '', noTranscript: true, group: 'unsorted',
          groupReason: 'Schedule imported successfully; no transcript has been provided yet'
        };
        students.push(s);
        byId.set(id, s);
        created.push(id);
      }
      if (!s) { unknown.push(id); return; }
      s.registration = { termCode: r.termCode, term: r.term, courses: r.courses || [] };
      courses += (r.courses || []).length;
      // campus comes from the section labels on the schedule
      const campuses = Array.from(new Set((r.courses || []).map(c => campusOf(c.section)).filter(Boolean)));
      if (campuses.length) {
        s.campus = campuses[0];
        s.campusesThisTerm = campuses;
        s.campusMixed = campuses.length > 1;
      }
      touched.push(s);
    });

    return { touched, unknown, created, matched: touched.length, courses };
  }

  // B1, B12 -> Beirut; D1, D3 -> Debbieh
  function campusOf(section) {
    const m = /^([BD])/i.exec(String(section || ''));
    if (!m) return null;
    return m[1].toUpperCase() === 'D' ? 'Debbieh' : 'Beirut';
  }

  // ---- sanity check -------------------------------------------------------

  // Recompute CGPA + credits from the course rows and compare with what the
  // transcript prints. If they match, the PDF was read right.
  function verifyTranscripts(engine, rules, list) {
    const ok = [], off = [], empty = [];
    (list || []).forEach(s => {
      if (!s.history || !s.history.length) { empty.push(s); return; }
      const live = s.history.filter(r => r.flag !== 'A');
      const g = engine.computeGpa(rules, live);
      // the transcript also counts grades like D- as earned (they still must be
      // repeated), so add those back before comparing with "Tot. Cr. Compl."
      const extra = (rules.transcriptCreditGrades || []).map(x => String(x).toUpperCase());
      const onPage = g.earned + live.reduce((n, r) => n + (extra.includes(String(r.grade || '').trim().toUpperCase())
        && !(engine.isPassing && engine.isPassing(rules, r.grade)) ? (Number(r.cr) || 0) : 0), 0);
      const dCr = s.officialCredits != null ? onPage - s.officialCredits : 0;
      const dGpa = (s.officialCgpa != null && g.gpa != null) ? Math.round((g.gpa - s.officialCgpa) * 100) / 100 : 0;
      if (Math.abs(dCr) > 0 || Math.abs(dGpa) > 0.02) off.push({ s, credits: onPage, cgpa: g.gpa, dCr, dGpa });
      else ok.push(s);
    });
    return { ok, off, empty };
  }

  return { mergeTranscripts, applySchedules, verifyTranscripts, campusOf, KEEP };
});
