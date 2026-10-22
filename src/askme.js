/* ── Ask Me, the question reader ─────────────────────────────────────────
   Turns a free-text question into conditions on the records, e.g.
   "registered for less than 12 credits on the Debbieh campus" ->
   reg credits < 12 + campus = Debbieh. The answer prints how it read the
   question so every list can be checked.
   Runs in the page only, no student data goes to an outside model (privacy
   promise of the portal). Handles typos, numbers as words, combined
   conditions and common Arabic phrasing. */

const ASKME = (() => {
  // ---- normalizing the question ----------------------------------------
  // number words -> digits ("twelve credits" -> "12 credits")
  const NUMW = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20, 'twenty one': 21, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8 };

  // Arabic phrases -> English the reader understands. Order matters: longer
  // phrases first so "غير مسجلين" wins over "مسجلين".
  const AR = [
    ['غير المسجلين', 'not registered'], ['الغير مسجلين', 'not registered'], ['غير مسجلين', 'not registered'], ['غير مسجل', 'not registered'], ['مش مسجل', 'not registered'],
    ['أقل من', 'less than'], ['اقل من', 'less than'], ['أكثر من', 'more than'], ['اكثر من', 'more than'],
    ['على الأقل', 'at least'], ['بين', 'between'], ['و', ' and '],
    ['كم عدد', 'how many'], ['كم', 'how many'], ['عدد', 'how many'], ['من هم', 'who'], ['مين', 'who'], ['من', 'who'],
    ['الطلاب', 'students'], ['طلاب', 'students'], ['طالب', 'student'],
    ['المعدل التراكمي', 'cgpa'], ['معدل', 'cgpa'], ['ساعات', 'credits'], ['ساعة', 'credits'], ['أرصدة', 'credits'],
    ['المسجلين', 'registered'], ['مسجلين', 'registered'], ['مسجل', 'registered'], ['إنذار', 'probation'], ['انذار', 'probation'],
    ['راسب', 'failed'], ['رسب', 'failed'], ['إعادة', 'repeat'], ['اعادة', 'repeat'], ['التخرج', 'graduating'], ['تخرج', 'graduating'],
    ['الدبية', 'debbieh'], ['بيروت', 'beirut'], ['الفصل', 'semester'], ['فصل', 'semester'], ['متوسط', 'average'],
    ['أعلى', 'highest'], ['اعلى', 'highest'], ['أدنى', 'lowest'], ['ادنى', 'lowest'], ['الأمن السيبراني', 'cybersecurity']
  ];

  // words typos get corrected against (plus student names, see normalize)
  const VOCAB = ('registered register registration unregistered credits credit probation remedial dismissal graduate graduating graduation ' +
    'semester cgpa gpa sgpa campus campuses debbieh beirut cybersecurity software science elective electives humanities social failed ' +
    'passed taking withdrawn withdrew missing average highest lowest students student courses course attention critical minimum maximum ' +
    'track tracks minor intensive english foundation standing honors honours dean repeat repeats transcript schedule clash conflict ' +
    'nationality completed earned remaining between exactly under over below above least most fewer more less without never ' +
    'overloaded underloaded load limit behind departmental general who which list show many count number percent ' +
    'summer spring fall season allowed rule rules policy take').split(' ');

  // edit distance, bails out early (9) when lengths differ by more than 2
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  function normalize(raw, fixes) {
    let t = String(raw || '');
    t = t.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
    AR.forEach(([a, e]) => { if (/[؀-ۿ]/.test(t)) t = t.split(a).join(' ' + e + ' '); });
    t = t.toLowerCase().replace(/[’']/g, "'").replace(/[?!,;:]/g, ' ');
    t = t.replace(/\b(twenty one|[a-z]+)\b/g, w => NUMW[w] != null && !/^(one|first|second)$/.test(w) ? String(NUMW[w]) : w);
    t = t.replace(/\bone\b(?=\s+(credit|course|semester))/g, '1').replace(/\b(first|second)\b(?=\s+(semester|year))/g, w => String(NUMW[w]));
    // typo fixing: only against VOCAB and the students' own names
    const names = new Set();
    advisees().forEach(s => s.name.toLowerCase().split(/\s+/).forEach(p => names.add(p)));
    t = t.split(/\s+/).map(w => {
      if (w.length < 4 || /\d/.test(w) || VOCAB.includes(w) || names.has(w)) return w;
      let best = null, bd = 9;
      VOCAB.forEach(v => { const d = lev(w, v); if (d < bd) { bd = d; best = v; } });
      const limit = w.length <= 5 ? 1 : 2;
      if (best && bd <= limit) { fixes.push([w, best]); return best; }
      return w;
    }).join(' ');
    return ' ' + t.replace(/\s+/g, ' ').trim() + ' ';
  }

  // ---- numbers with a comparison ---------------------------------------
  // Each pattern -> a condition {op, v}. "between" goes first so its numbers
  // aren't grabbed by the single-number patterns below.
  const N = '(\\d+(?:\\.\\d+)?)';
  const CMP = [
    [new RegExp('between ' + N + ' (?:and|to|-) ' + N, 'g'), m => ({ op: 'between', a: +m[1], b: +m[2] })],
    [new RegExp('(?:at most|no more than|up to|maximum of|not more than|<=) ?' + N, 'g'), m => ({ op: '<=', v: +m[1] })],
    [new RegExp('(?:at least|no less than|minimum of|not less than|>=) ?' + N, 'g'), m => ({ op: '>=', v: +m[1] })],
    [new RegExp('(?:less than|fewer than|under|below|lower than|smaller than|<) ?' + N, 'g'), m => ({ op: '<', v: +m[1] })],
    [new RegExp('(?:more than|over|above|greater than|higher than|exceeding|beyond|>) ?' + N, 'g'), m => ({ op: '>', v: +m[1] })],
    [new RegExp(N + ' (?:or more|and above|or above|or higher|plus)', 'g'), m => ({ op: '>=', v: +m[1] })],
    [new RegExp(N + '\\+', 'g'), m => ({ op: '>=', v: +m[1] })],
    [new RegExp(N + ' (?:or less|or fewer|and below|or below|or lower)', 'g'), m => ({ op: '<=', v: +m[1] })],
    [new RegExp('(?:exactly|equal to|=) ?' + N, 'g'), m => ({ op: '=', v: +m[1] })]
  ];
  const opWord = c => c.op === 'between' ? 'between ' + c.a + ' and ' + c.b
    : { '<': 'under', '<=': 'at most', '>': 'over', '>=': 'at least', '=': 'exactly' }[c.op] + ' ' + c.v;
  const test = (c, x) => x != null && (c.op === 'between' ? x >= c.a && x <= c.b : c.op === '<' ? x < c.v
    : c.op === '<=' ? x <= c.v : c.op === '>' ? x > c.v : c.op === '>=' ? x >= c.v : x === c.v);

  // Guess which field a number is about from the words around it. Fallback
  // by size: <= 4 is a GPA, <= 24 registered credits, else earned credits.
  let WHOLE = '';
  function fieldFor(before, after, c) {
    const around = before.slice(-45) + ' ## ' + after.slice(0, 30);
    const v = c.op === 'between' ? c.b : c.v;
    if (/sgpa|semester gpa|term gpa|last semester'?s? gpa|last term/.test(around)) return 'sgpa';
    if (/cgpa|gpa|average|grade point/.test(around)) return 'cgpa';
    if (/left|remaining|to graduate|away from|short of/.test(around) && /credit/.test(around)) return 'left';
    if (/credit|cr\b|hours?/.test(around)) {
      if (/complet|earn|passed|finish|done|accumulat|toward|degree|total/.test(around) || v > 24) return 'earned';
      return /regist|taking|\btake\b|load|enrol|schedule|this semester|this term|signed up/.test(WHOLE) ? 'reg' : 'earned';
    }
    if (/courses?/.test(after.slice(0, 12))) return 'regCourses';
    if (/semester|sem\b|term/.test(around)) return 'sem';
    if (String(v).includes('.') && v <= 4) return 'cgpa';
    if (v <= 4) return 'cgpa';
    return v <= 24 ? 'reg' : 'earned';
  }

  // label, getter and display format for each numeric field
  const FIELD = {
    cgpa: { word: 'CGPA', get: s => s.officialCgpa != null ? s.officialCgpa : look(s).snap.cgpa, show: x => x == null ? '—' : x.toFixed(2) },
    sgpa: { word: 'last semester GPA', get: s => look(s).snap.lastSgpa, show: x => x == null ? '—' : x.toFixed(2) },
    reg: { word: 'registered credits', get: s => s.registration ? regCredits(s) : null, show: x => x == null ? 'not registered' : x + ' cr' },
    regCourses: { word: 'registered courses', get: s => s.registration ? s.registration.courses.length : null, show: x => x == null ? '—' : x + ' courses' },
    earned: { word: 'degree credits completed', get: s => look(s).snap.earned, show: x => x + ' cr done' },
    left: { word: 'credits left to graduate', get: s => Math.max(0, C.totalCredits - look(s).snap.earned), show: x => x + ' cr left' },
    sem: { word: 'semester', get: s => look(s).snap.completedSemesters + 1, show: x => 'sem ' + x }
  };

  // ---- yes/no conditions -----------------------------------------------
  // true if a "not/without/never..." sits within 2 words before position i
  const neg = (t, i) => /\b(not|no|without|never|haven't|hasn't|havent|hasnt|didn't|didnt|missing|lacking|lack)\s+(\w+\s+){0,2}$/.test(t.slice(Math.max(0, i - 28), i));
  const trackOf = s => look(s).snap.likelyTrack;
  const snapOf = s => look(s).snap;
  /* Keyword flags. noNeg: phrase already carries its own "not", don't flip it.
     weak: dropped when a numeric registration condition is there.
     skipIf / invertWith: special cases for campuses and IC3. */
  const FLAGS = [
    { re: /not registered|unregistered|no (schedule|registration)|haven't registered|didn't register|did not register/, word: 'not registered', pred: s => !s.registration, noNeg: true },
    { re: /\bregistered\b(?! (for|in) (less|more|under|over|at|between|exactly))/, word: 'registered', pred: s => !!s.registration, weak: true },
    { re: /remedial/, word: 'in the remedial stage', pred: s => !!snapOf(s).standing.remedial },
    { re: /probation|academic warning/, word: 'on probation', pred: s => snapOf(s).standing.state === 'PROBATION' || snapOf(s).standing.state === 'DISMISSAL_RISK' },
    { re: /dismiss|at risk/, word: 'at risk of dismissal', pred: s => snapOf(s).standing.state === 'DISMISSAL_RISK' },
    { re: /good standing/, word: 'in good standing', pred: s => snapOf(s).standing.state === 'GOOD_STANDING' },
    { re: /act now|urgent|\bred\b/, word: 'marked act now', pred: s => look(s).level === 'urgent' },
    { re: /plan ahead|orange/, word: 'marked plan ahead', pred: s => look(s).level === 'watch' },
    { re: /need(s)? attention|needing attention|attention|need(s)? review/, word: 'needing attention', pred: s => look(s).level !== 'ok' },
    { re: /on track|no problems?/, word: 'on track', pred: s => look(s).level === 'ok' },
    { re: /critical/, word: 'marked critical', pred: s => isCritical(s) },
    { re: /both campus|two campus|both beirut and debbieh|mixed campus/, word: 'on both campuses', pred: s => !!s.campusMixed },
    { re: /debbieh/, word: 'based in Debbieh', pred: s => s.campus === 'Debbieh', skipIf: /both campus|two campus/ },
    { re: /beirut/, word: 'based in Beirut', pred: s => s.campus !== 'Debbieh', skipIf: /both campus|two campus|both beirut/ },
    { re: /cyber ?security|security track/, word: 'on the Cybersecurity track', pred: s => trackOf(s) === 'SEC' },
    { re: /software/, word: 'on the Software Development track', pred: s => trackOf(s) === 'SWE' },
    { re: /\bai\b|data science|artificial intelligence/, word: 'on the AI and Data Science track', pred: s => trackOf(s) === 'AIDS' },
    { re: /no track|without a track|not on a track/, word: 'with no track yet', pred: s => !trackOf(s), noNeg: true },
    { re: /ic3|icdl/, word: 'missing IC3', noNeg: true, pred: s => !snapOf(s).ic3, invertWith: /\b(have|has|with|got|obtained|done|passed) (the )?(ic3|icdl)/, invertWord: 'with IC3 done' },
    { re: /wrnl|work ready/, word: 'still needing Work Ready Now', pred: s => !snapOf(s).passed.has('WRNL200') && E.wrnlRequired(R, C, s) },
    { re: /humanities/, word: 'with no humanities elective', pred: s => !(snapOf(s).buckets.UNIV_ELECTIVE || {}).hasHumanities, noNeg: true },
    { re: /social science|social elective|\bsocial\b/, word: 'with no social science elective', pred: s => !(snapOf(s).buckets.UNIV_ELECTIVE || {}).hasSocial, noNeg: true },
    { re: /intensive|inte00/, word: 'in Intensive English', pred: s => !!(snapOf(s).intensive || snapOf(s).intensiveActive) },
    { re: /foundation|remedial course/, word: 'with foundation courses left', pred: s => (snapOf(s).foundationRemaining || []).length > 0 },
    { re: /\b(repeat|repeats|retake|owes?|owed|must take again|take again)\b/, word: 'with a course to take again', pred: s => E.repeatsDue(R, C, s, state.term, state.offering.sections).some(r => r.kind === 'must') },
    { re: /withdr/, word: 'with a withdrawal on the record', pred: s => (s.history || []).some(r => /^A?W$/.test(String(r.grade || '').toUpperCase())) },
    { re: /\bfailed\b|\bfailing\b/, word: 'with a failed course still owed', pred: s => E.repeatsDue(R, C, s, state.term, state.offering.sections).some(r => !r.withdrawn) },
    { re: /can graduate|eligible to graduate|ready to graduate|able to graduate/, word: 'meeting every graduation requirement', pred: s => E.graduationAudit(R, C, s).eligible },
    { re: /close to graduat|near(ly)? graduat|about to graduat|graduating soon|last semester|finishing/, word: 'within 20 credits of graduating', pred: s => E.graduationAudit(R, C, s).remainingCredits <= 20, closeness: true },
    { re: /honou?rs|dean'?s list|top students|excellent/, word: 'with a CGPA of 3.50 or more', pred: s => (s.officialCgpa || 0) >= 3.5 },
    { re: /overload|over the limit|too many credits|above the limit/, word: 'registered above the limit', pred: s => overLoad(s) },
    { re: /underload|under the minimum|light load|below the minimum|too few credits/, word: 'registered under the minimum', pred: s => underLoad(s) },
    { re: /clash|conflict|overlap/, word: 'with a timetable clash', pred: s => (look(s).reg.findings || []).some(f => /CLASH/.test(f.ruleId)) },
    { re: /behind (on )?(departmental )?electives?|departmental electives? behind/, word: 'behind on departmental electives', pred: s => {
        const sn = snapOf(s), de = sn.buckets.DEPT_ELECTIVE; if (!de || sn.completedSemesters < 4) return false;
        const slots = (C.deptElectiveSlots || [4, 5, 6]).filter(n => n <= sn.completedSemesters).length;
        return de.earned + (de.inProgress || 0) < slots * 3 && de.earned < de.required; } },
    { re: /minor/, word: 'with credits toward the Mathematics minor', pred: s => { const m = E.minorAudit(R, C, s); return !!m && m.credits > 0; } },
    { re: /new students?|first semester|just joined|freshly/, word: 'in their first semester', pred: s => snapOf(s).completedSemesters === 0 }
  ];

  // ID year, study year / semester, nationality
  function yearCond(t) {
    const m = t.match(/(?:id|entry|joined|joined in|catalog(?:ue)? year|batch|class of|admitted in|started in|since) ?(20\d\d)/);
    return m ? { word: 'ID year ' + m[1], pred: s => String(s.catalogYear) === m[1] } : null;
  }
  function semYear(t) {
    const m = t.match(/\b(\d) ?(?:st|nd|rd|th)? year\b/) || t.match(/\byear (\d)\b/);
    if (m) { const y = +m[1]; return { word: 'in year ' + y + ' (semesters ' + (2 * y - 1) + ' and ' + (2 * y) + ')', pred: s => { const k = snapOf(s).completedSemesters + 1; return k >= 2 * y - 1 && k <= 2 * y; } }; }
    const s2 = t.match(/\b(?:semester|sem) (\d{1,2})\b/) || t.match(/\b(\d{1,2}) ?(?:st|nd|rd|th)? semester\b/);
    if (s2) { const k = +s2[1]; return { word: 'in semester ' + k, pred: s => snapOf(s).completedSemesters + 1 === k }; }
    return null;
  }
  function nationalityCond(t) {
    const nats = {};
    advisees().forEach(s => { if (s.nationality) nats[String(s.nationality).toLowerCase()] = s.nationality; });
    const hit = Object.keys(nats).find(n => n.length > 3 && t.includes(' ' + n));
    return hit ? { word: nice(nats[hit]), pred: s => String(s.nationality || '').toLowerCase() === hit } : null;
  }

  // course codes: the verb just before the code picks taking/passed/failed/...
  function courseConds(t, codes) {
    const out = [];
    codes.forEach(code => {
      const i = t.toUpperCase().indexOf(code.slice(0, 4));
      const before = t.slice(Math.max(0, i - 40), i);
      const verb = /fail/.test(before) ? 'failed' : /withdr/.test(before) ? 'withdrew'
        : /(need|missing|not taken|haven't taken|didn't take|still|yet to|owe)/.test(before) ? 'need'
        : /(passed|completed|done|finished|took|have taken|has taken)/.test(before) ? 'passed' : 'taking';
      const hist = s => (s.history || []).filter(r => r.code === code);
      const P = {
        taking: s => !!(s.registration && s.registration.courses.some(c => c.code === code)),
        passed: s => snapOf(s).passed.has(code),
        failed: s => hist(s).some(r => String(r.grade).toUpperCase() === 'F'),
        withdrew: s => hist(s).some(r => /^A?W$/.test(String(r.grade).toUpperCase())),
        need: s => !snapOf(s).passed.has(code) && !snapOf(s).inProgress.has(code)
      };
      const W = { taking: 'taking ' + code + ' now', passed: 'who passed ' + code, failed: 'who failed ' + code, withdrew: 'who withdrew from ' + code, need: 'who still need ' + code };
      out.push({ word: W[verb], pred: P[verb], field: null });
    });
    return out;
  }

  // ---- parse + run -----------------------------------------------------
  // numeric conditions first; `used` stops two patterns claiming the same text
  function parse(t, codes) {
    const conds = [], used = [], showFields = new Set();
    WHOLE = t;
    CMP.forEach(([re, mk]) => {
      re.lastIndex = 0; let m;
      while ((m = re.exec(t))) {
        const a = m.index, b = m.index + m[0].length;
        if (used.some(([x, y]) => a < y && b > x)) continue;
        used.push([a, b]);
        const c = mk(m);
        const f = fieldFor(t.slice(0, a), t.slice(b), c);
        conds.push({ word: FIELD[f].word + ' ' + opWord(c), pred: s => test(c, FIELD[f].get(s)), field: f });
        showFields.add(f);
      }
    });
    const hasNumericReg = conds.some(c => c.field === 'reg' || c.field === 'regCourses');
    FLAGS.forEach(f => {
      const m = t.match(f.re);
      if (!m) return;
      if (f.skipIf && f.skipIf.test(t)) return;
      if (f.weak && (hasNumericReg || /not registered|unregistered/.test(t) || conds.length)) return;
      if (f.closeness && conds.some(c => c.field === 'left')) return;
      if (codes.length && /fail|withdr|repeat/.test(f.re.source)) return;
      let pred = f.pred, word = f.word;
      if (f.invertWith && f.invertWith.test(t)) { pred = s => !f.pred(s); word = f.invertWord; }
      else if (!f.noNeg && neg(t, m.index)) { pred = s => !f.pred(s); word = 'not ' + f.word; }
      conds.push({ word, pred });
    });
    [yearCond(t), semYear(t), nationalityCond(t)].forEach(c => { if (c) conds.push(c); });
    courseConds(t, codes).forEach(c => conds.push(c));
    return { conds, showFields };
  }

  const link = s => '[[' + s.id + '|' + s.name + ']]';
  const cg = s => s.officialCgpa != null ? s.officialCgpa.toFixed(2) : '—';

  function runQuery(t, parsed, fixes) {
    const pool = advisees();
    const hits = pool.filter(s => parsed.conds.every(c => { try { return c.pred(s); } catch (e) { return false; } }));
    const wantsCount = /how many|number of|count|how much/.test(t);
    const pct = /percent|percentage|proportion|share|%/.test(t);
    const avg = /average|mean/.test(t);
    const top = t.match(/\b(highest|best|top|strongest|lowest|worst|bottom|weakest)\b(?: (\d+))?/);
    let list = hits.slice();
    const fields = Array.from(parsed.showFields);
    let sortF = fields[0] || 'cgpa';
    if (top) {
      if (/credit/.test(t)) sortF = /left|remaining/.test(t) ? 'left' : /regist|taking|load/.test(t) ? 'reg' : 'earned';
      else if (/semester gpa|sgpa|last semester/.test(t)) sortF = 'sgpa';
      else sortF = 'cgpa';
      const low = /lowest|worst|bottom|weakest/.test(top[1]);
      list.sort((a, b) => ((FIELD[sortF].get(low ? a : b) ?? -1) - (FIELD[sortF].get(low ? b : a) ?? -1)));
      list = list.slice(0, top[2] ? +top[2] : 5);
    } else list.sort((a, b) => a.name.localeCompare(b.name));

    const read = parsed.conds.length ? parsed.conds.map(c => c.word).join(', ') : 'all your advisees';
    const lines = [];
    const cols = s => {
      const bits = [];
      const fs = fields.slice();
      if (top && !fs.includes(sortF)) fs.unshift(sortF);
      fs.forEach(f => bits.push((f === 'cgpa' ? 'CGPA ' : '') + FIELD[f].show(FIELD[f].get(s))));
      if (!fs.includes('cgpa')) bits.push('CGPA ' + cg(s));
      bits.push('sem ' + (snapOf(s).completedSemesters + 1));
      return bits.join(' · ');
    };
    if (avg) {
      const f = /credit/.test(t) ? (/regist|taking|load/.test(t) ? 'reg' : 'earned') : 'cgpa';
      const xs = hits.map(s => FIELD[f].get(s)).filter(x => x != null);
      const mean = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
      lines.push('The average ' + FIELD[f].word + ' of ' + (parsed.conds.length ? 'the ' + hits.length + ' students ' + read : 'your ' + hits.length + ' advisees')
        + ' is **' + (mean == null ? 'not available' : (f === 'cgpa' ? mean.toFixed(2) : mean.toFixed(1))) + '**.');
    } else if (pct) {
      lines.push('**' + Math.round(hits.length / Math.max(1, pool.length) * 100) + '%** of your advisees (' + hits.length + ' of ' + pool.length + ') are ' + read + '.');
    } else if (!hits.length) {
      lines.push('**Nobody** on your list is ' + read + '.');
    } else {
      lines.push(top ? 'The **' + list.length + (/lowest|worst|bottom|weakest/.test(top[1]) ? ' lowest' : ' highest') + '** by ' + FIELD[sortF].word + (parsed.conds.length ? ', among students ' + read : '') + ':'
        : '**' + hits.length + (hits.length === 1 ? ' student' : ' students') + '**:');
    }
    if ((hits.length && !avg && !pct && !(wantsCount && hits.length > 12)) || (top && list.length)) {
      const shown = list.slice(0, 40);
      lines.push(shown.map(s => '- ' + link(s) + ' — ' + cols(s)).join('\n'));
      if (list.length > shown.length) lines.push('and ' + (list.length - shown.length) + ' more.');
    } else if (wantsCount && hits.length > 12 && !avg) {
      lines.push(list.slice(0, 8).map(s => '- ' + link(s) + ' — ' + cols(s)).join('\n') + '\nand ' + (hits.length - 8) + ' more. Ask "list them" to see everyone.');
    }
    lines.push('_How I read it: ' + read + (fixes.length ? '. I read ' + fixes.map(f => '"' + f[0] + '" as "' + f[1] + '"').join(', ') : '') + '._');
    lastQuery = { t, parsed };
    return lines.join('\n\n');
  }
  let lastQuery = null;

  // ---- questions about one student -------------------------------------
  // rough graduation term, assumes about 17 credits a semester
  function forecast(s) {
    const left = Math.max(0, C.totalCredits - snapOf(s).earned - (s.registration ? regCredits(s) : 0));
    if (!left) return s.registration ? 'at the end of ' + shortTerm(state.term) + ', if this semester is passed' : 'now, once the non-credit requirements are in';
    let term = state.term, n = Math.ceil(left / 17);
    for (let i = 0; i < n; i++) term = E.nextMainTermAfter(term);
    return 'around ' + shortTerm(term) + ' (' + left + ' credits after this semester, at about 17 a semester)';
  }

  function studentAnswer(s, t) {
    const { snap, reg, alerts } = look(s);
    const first = s.name.split(' ')[0];
    const audit = E.graduationAudit(R, C, s);
    const codes = findCourses(t);
    if (codes.length && /grade|get|got|score|mark|result/.test(t)) {
      const rows = (s.history || []).filter(r => r.code === codes[0]);
      return rows.length ? link(s) + ' took ' + codes[0] + ': ' + rows.map(r => (r.grade || '—') + ' in ' + shortTerm(r.term)).join(', ') + '.'
        : link(s) + ' has no grade for ' + codes[0] + (snap.inProgress.has(codes[0]) ? '; it is on this semester’s schedule.' : ' yet.');
    }
    const parts = [];
    const asked = k => new RegExp(k).test(t);
    if (asked('cgpa|gpa|average')) parts.push('CGPA **' + cg(s) + '**' + (snap.lastSgpa != null ? ', last semester GPA ' + snap.lastSgpa.toFixed(2) : '') + '.');
    if (asked('credit|how far|progress|left|remaining')) parts.push('**' + snap.earned + '** of ' + C.totalCredits + ' degree credits completed, ' + audit.remainingCredits + ' left' + (s.registration ? ' (' + regCredits(s) + ' of them on this semester’s schedule)' : '') + '.');
    if (asked('graduat|finish|when')) parts.push('Expected to finish ' + forecast(s) + '.' + (audit.blockers.length ? ' Still open: ' + audit.blockers.map(b => b.label).join(', ') + '.' : ''));
    if (asked('standing|probation|remedial|warning|risk')) parts.push('Standing: **' + standingWord(snap.standing.state) + '**' + (snap.standing.remedial ? ', in the remedial stage' : '') + '. ' + snap.standing.reason + '.');
    if (asked('email|mail|contact|phone|reach')) parts.push('Email ' + (s.email || 'not on file') + (s.phone ? ', phone ' + s.phone : '') + '.');
    if (asked('on track|doing|okay|\\bok\\b|status|how is|fine')) parts.push(look(s).level === 'ok' ? 'On track: registered, within the rules, and moving through the study plan.'
      : 'Not on track right now (' + LEVEL[look(s).level].word.toLowerCase() + '): ' + alerts.map(a => a.title.toLowerCase()).join('; ') + '.');
    else if (asked('\\btrack\\b')) {
      const e = snap.trackEstimate || { kind: 'none' };
      if (e.kind === 'recorded') parts.push('Recorded track: **' + e.label + '**. The transcript course evidence is shown separately.');
      else if (e.kind === 'potential') parts.push('Potential **' + e.label + '** track from ' + e.count + ' matching courses. This is an estimate, not an official declaration.');
      else if (e.kind === 'mixed') parts.push('**General / mixed track evidence**: courses come from more than one track list, so no single track is estimated.');
      else if (e.kind === 'developing') parts.push('No potential track yet: ' + e.count + ' of ' + e.needed + ' courses point toward **' + e.label + '**.');
      else parts.push('No track evidence yet.');
    }
    if (asked('taking|schedule|registered|this semester|this term|courses')) parts.push(s.registration ? 'This semester: ' + s.registration.courses.map(c => c.code).join(', ') + ' (' + regCredits(s) + ' credits).' : 'Not registered for ' + shortTerm(state.term) + '.');
    if (asked('next|recommend|should|plan|take')) {
      const plan = E.planNextTerm(R, C, s, s.registration ? state.planTerm : state.term, state.offering.sections);
      parts.push('For ' + shortTerm(s.registration ? state.planTerm : state.term) + ': ' + plan.recommendations.slice(0, 5).map(c => c.code + ' ' + nice(c.title)).join(', ') + '.');
    }
    if (asked('ic3|icdl')) parts.push(snap.ic3 ? 'IC3 is done.' : 'IC3 is **missing**.');
    if (asked('minor')) { const m = E.minorAudit(R, C, s); parts.push(m ? m.credits + ' of ' + m.min + ' credits toward the Mathematics minor.' : 'No minor credits yet.'); }
    if (asked('repeat|failed|owe|retake')) { const due = E.repeatsDue(R, C, s, state.term, state.offering.sections).filter(r => r.kind === 'must'); parts.push(due.length ? 'To take again: ' + due.map(r => r.code).join(', ') + '.' : 'Nothing to take again.'); }
    if (asked('why|problem|issue|wrong|attention')) parts.push(alerts.length ? 'Needs attention because: ' + alerts.map(a => a.title.toLowerCase()).join('; ') + '.' : 'Nothing needs attention.');
    const head = '**' + s.name + '** (' + s.id + '), semester ' + (snap.completedSemesters + 1) + ', ' + (s.campus || 'Beirut') + '.';
    if (!parts.length) {
      parts.push('CGPA ' + cg(s) + ', ' + snap.earned + ' of ' + C.totalCredits + ' degree credits, ' + standingWord(snap.standing.state).toLowerCase() + '.');
      parts.push(s.registration ? 'This semester: ' + s.registration.courses.map(c => c.code).join(', ') + ' (' + regCredits(s) + ' credits).' : 'Not registered for ' + shortTerm(state.term) + '.');
      parts.push('Expected to finish ' + forecast(s) + '.');
      parts.push(alerts.length ? 'Needs a look: ' + alerts.map(a => a.title.toLowerCase()).join(', ') + '.' : 'Nothing outstanding.');
    }
    return head + ' [[' + s.id + '|Open ' + first + '’s page]]\n\n' + parts.join('\n\n');
  }

  // ---- rule lookup -----------------------------------------------------
  // Small TF-IDF search over the rule texts in R, with SYN folding synonyms
  // (load/hours -> credit etc.). Built once on first use.
  let DOCS = null;
  const STOP = new Set('the a an is are of to in for and or on at by with what how can may do does student students i my me it be this that which who when there any if from as much many please tell about rule rules'.split(' '));
  const stem = w => w.replace(/(ing|ed|es|s)$/,'');
  const toks = s => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w)).map(stem);
  const SYN = { load: 'credit', credits: 'credit', hours: 'credit', gpa: 'cgpa', average: 'cgpa', fail: 'repeat', retake: 'repeat', warning: 'probation',
    finish: 'graduat', graduation: 'graduat', graduate: 'graduat', summer: 'summer', max: 'maximum', min: 'minimum', drop: 'withdraw', withdrawal: 'withdraw' };
  function buildDocs() {
    DOCS = [];
    const walk = (o, path) => {
      if (!o || typeof o !== 'object') return;
      if (typeof o.text === 'string' && o.text.length > 25) DOCS.push({ text: o.text, cite: o.citation || '', key: path });
      Object.keys(o).forEach(k => { if (typeof o[k] === 'object') walk(o[k], path ? path + '.' + k : k); });
    };
    walk(R, '');
    [['Remedial stage', R.remedialNote], ['Withdrawal', R.withdrawalNote], ['Minor in Mathematics', (C.mathMinor || {}).note]]
      .forEach(([k, x]) => { if (x) DOCS.push({ text: x, cite: '', key: k }); });
    DOCS.forEach(d => { d.tf = {}; toks(d.text + ' ' + d.key.replace(/[._-]/g, ' ')).forEach(w => { w = SYN[w] || w; d.tf[w] = (d.tf[w] || 0) + 1; }); });
    const df = {};
    DOCS.forEach(d => Object.keys(d.tf).forEach(w => { df[w] = (df[w] || 0) + 1; }));
    DOCS.idf = w => Math.log((DOCS.length + 1) / ((df[w] || 0) + 1)) + 1;
  }
  function ruleAnswer(q) {
    if (!DOCS) buildDocs();
    const qt = toks(q).map(w => SYN[w] || w);
    if (!qt.length) return null;
    const scored = DOCS.map(d => {
      let s = 0, norm = 0;
      Object.keys(d.tf).forEach(w => { norm += Math.pow(d.tf[w] * DOCS.idf(w), 2); });
      qt.forEach(w => { if (d.tf[w]) s += d.tf[w] * DOCS.idf(w) * DOCS.idf(w); });
      return { d, s: s / Math.sqrt(norm || 1) / Math.sqrt(qt.length) };
    }).sort((a, b) => b.s - a.s);
    if (!scored[0] || scored[0].s < 0.35) return null;   // weak match, better say nothing
    // the same sentence can live in two places in the rules, show it once
    const seen = new Set();
    const best = scored.filter(x => x.s >= scored[0].s * 0.8).filter(x => !seen.has(x.d.text) && seen.add(x.d.text)).slice(0, 2);
    return best.map(x => x.d.text).join('\n\n');
  }

  // Which student is meant. A first-name match scores higher than a middle-name
  // match ("Sami's CGPA" prefers Sami Haddad over Rami Sami Khoury); 's is stripped.
  function whoIsMeant(t) {
    const byId = advisees().filter(s => t.includes(String(s.id)));
    if (byId.length) return byId;
    const words = t.replace(/'s\b/g, '').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !VOCAB.includes(w) && !STOP.has(w));
    if (!words.length) return [];
    const hits = advisees().map(s => {
      const parts = s.name.toLowerCase().split(/\s+/);
      let score = 0;
      words.forEach(w => parts.forEach((p, i) => { if (p === w) score += i === 0 ? 5 : 3; else if (w.length > 3 && p.startsWith(w)) score += 1; }));
      return { s, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
    if (!hits.length) return [];
    if (hits.length === 1 || hits[0].score > hits[1].score) return [hits[0].s];
    return hits.filter(x => x.score === hits[0].score).map(x => x.s);
  }

  // ---- entry point -----------------------------------------------------
  // returns null when it can't read the question as a records question
  function answer(raw) {
    const fixes = [];
    let t = normalize(raw, fixes);
    if (lastQuery && /^\s*(list them|show them|who are they|list all|show all|names)\s*$/.test(t)) {
      return runQuery(lastQuery.t.replace(/how many|number of|count/g, 'list'), lastQuery.parsed, []);
    }
    // "how many credits can a student take in summer" is about a rule, not a
    // headcount. No name and no number of our own: let the rules answer it.
    if (/\b(can|may|allowed to|is it possible|maximum|minimum|limit|rule)\b/.test(t) && /\b(a student|any student|one|students can|students may|i)\b/.test(t)
        && !/\d/.test(t) && !whoIsMeant(t).length) {
      const r = ruleAnswer(t);
      if (r) return r;
    }
    const codes = findCourses(t);
    const plural = /\b(who|which|students|list|show|how many|anyone|everyone|number of|percent|average|highest|lowest|top)\b/.test(t);
    const people = whoIsMeant(t);
    if (people.length === 1 && !plural) return studentAnswer(people[0], t);
    if (people.length > 1 && !plural) return 'Which one do you mean? ' + people.slice(0, 6).map(link).join(', ') + '. Tap a name, or ask again with the family name.';
    const parsed = parse(t, plural ? codes : []);
    if (parsed.conds.length && (plural || parsed.conds.some(c => c.field))) return runQuery(t, parsed, fixes);
    if (plural && /average|highest|lowest|top|how many|percent/.test(t)) return runQuery(t, parsed, fixes);
    return null;
  }

  return { answer, ruleAnswer, normalize };
})();
