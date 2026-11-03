/*
 * Online Advising System - rules engine.
 * Pure functions, no I/O. Rules and catalog come in as data.
 *
 * Findings look like:
 *   { ruleId, severity: 'BLOCK'|'WARN'|'INFO'|'OK', message, fix?, citation, overridable }
 *
 *   BLOCK - registration not allowed; advisor can override with a logged reason
 *   WARN  - allowed, but probably bad for the student
 *   INFO  - just context
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- helpers ------------------------------------------------------------

  function byCode(catalog) {
    const m = {};
    catalog.courses.forEach(c => (m[c.code] = c));
    catalog.universityElectives.forEach(c =>
      (m[c.code] = Object.assign({ bucket: 'UNIV_ELECTIVE', pre: [], co: [] }, c)));
    catalog.genScienceElectives.forEach(c =>
      (m[c.code] = Object.assign({ bucket: 'GEN_SCI_ELECTIVE', pre: [], co: [] }, c)));
    return m;
  }

  function finding(ruleId, severity, message, opts) {
    return Object.assign(
      { ruleId, severity, message, citation: '', overridable: severity === 'BLOCK' },
      opts || {}
    );
  }

  // ---- grades -------------------------------------------------------------

  // null = grade doesn't count toward the GPA
  function gradePoint(rules, grade) {
    if (grade == null) return null;
    const g = String(grade).trim().toUpperCase();
    if (rules.nonGpaCodes.includes(g)) return null;
    if (rules.transferGrades.includes(g)) return null; // earned, not graded
    return Object.prototype.hasOwnProperty.call(rules.gradeScale, g) ? rules.gradeScale[g] : null;
  }

  function isPassing(rules, grade) {
    if (grade == null) return false;
    const g = String(grade).trim().toUpperCase();
    return rules.passingGrades.includes(g) || rules.transferGrades.includes(g);
  }

  function mustRepeat(rules, grade) {
    if (grade == null) return false;
    return rules.mustRepeatGrades.includes(String(grade).trim().toUpperCase());
  }

  /* Same math as ContractSheet.xlsm:
       earned = credits graded A+..D or P/TR
       points = gradePoint * credits, GPA-bearing grades only
       GPA    = points / GPA-bearing credits
     P/TR counts as earned but stays out of the divisor, like the sheet's
     =SUM(S:T)/(M4-SUM(X:Y)). */
  function computeGpa(rules, records) {
    let earned = 0, points = 0, gpaCredits = 0, transferCredits = 0;
    records.forEach(r => {
      const cr = Number(r.cr) || 0;
      const gp = gradePoint(rules, r.grade);
      if (isPassing(rules, r.grade)) earned += cr;
      if (rules.transferGrades.includes(String(r.grade || '').toUpperCase())) transferCredits += cr;
      if (gp !== null) { points += gp * cr; gpaCredits += cr; }
    });
    return {
      earned,
      transferCredits,
      gpaCredits,
      points: round2(points),
      // No graded credits -> null, not 0. A 0 reads as failing and would put
      // first-termers on probation or cap someone whose last term was all P/F.
      gpa: gpaCredits > 0 ? round2(points / gpaCredits) : null,
      hasGpa: gpaCredits > 0
    };
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  // Sort key for terms: FALL < SPRING < SUMMER within a year.
  // Undated stuff (TRANSFER block etc.) sorts first.
  function termOrder(t) {
    const m = /(FALL|SPRING|SUMMER)\s*(\d{4})/i.exec(String(t || ''));
    if (!m) return -1;
    return Number(m[2]) * 10 + { FALL: 0, SPRING: 1, SUMMER: 2 }[m[1].toUpperCase()];
  }

  // ---- university elective categories --------------------------------------
  /* Need one humanities + one social science course.
     - MCOM had its own category, so MCOM003 counted for nothing while MCOM007
       did. Department treats all MCOM as humanities.
     - Courses missing from the UE list (new ARAB/HIST etc.) got no category.
       Fall back to the prefix when the list doesn't know the course.
     Still unknown -> null. Better than guessing. */
  const UE_PREFIX = {
    HUMANITIES: ['MCOM', 'ARAB', 'ARBA', 'HIST', 'FREN', 'ITAL', 'SPAN', 'TURK', 'ARTS', 'ARCH', 'FASD', 'EXTR'],
    SOCIAL: ['SOCI', 'PSYC']
  };

  function ueCategory(catalog, code) {
    const u = (catalog.universityElectives || []).find(x => x.code === code);
    // MCOM counts as humanities
    if (u) return u.cat === 'MASSCOM' ? 'HUMANITIES' : u.cat;
    const prefix = String(code || '').replace(/[0-9].*$/, '').toUpperCase();
    if (UE_PREFIX.HUMANITIES.indexOf(prefix) >= 0) return 'HUMANITIES';
    if (UE_PREFIX.SOCIAL.indexOf(prefix) >= 0) return 'SOCIAL';
    return null;
  }

  // ---- Intensive English ---------------------------------------------------
  /* Entrance exam places them in one of 3 levels, taken in order. The level
     caps the load: 6 credits in IE1, 14 in 2A and 2B. ENGL001 needs 2B.
     Should be done by summer of year one.
     "In a level" = registered in it now, or on the transcript without a pass. */
  function intensiveLevel(rules, student, term) {
    const cfg = rules.intensiveEnglish;
    if (!cfg) return null;
    const codes = Object.keys(cfg.levels);
    const reg = student.registration;
    const now = (reg && (!term || !reg.term || reg.term === term) ? (reg.courses || []) : []).map(c => c.code);
    const sitting = codes.filter(c => now.indexOf(c) >= 0);
    if (sitting.length) {
      // schedule shows more than one level -> take the highest
      const code = sitting.sort()[sitting.length - 1];
      return Object.assign({ code }, cfg.levels[code], { where: 'registered' });
    }
    const passed = new Set((student.history || [])
      .filter(r => isPassing(rules, r.grade)).map(r => r.code));
    const attempted = codes.filter(c => (student.history || []).some(r => r.code === c));
    const unfinished = attempted.filter(c => !passed.has(c));
    if (unfinished.length) {
      const code = unfinished.sort()[unfinished.length - 1];
      return Object.assign({ code }, cfg.levels[code], { where: 'not passed yet' });
    }
    return null;
  }

  // can this course be taken alongside their current level?
  function intensiveBlocks(rules, student, code, term) {
    const cfg = rules.intensiveEnglish;
    if (!cfg) return null;
    const gate = (cfg.gates || {})[code];
    if (!gate) return null;
    const passed = (student.history || []).some(r => r.code === gate && isPassing(rules, r.grade));
    if (passed) return null;
    return { gate, name: (cfg.levels[gate] || {}).name || gate };
  }

  /* The attempt that counts, per course. Imported transcripts flag each row
     I (counts), A (annulled by a later attempt) or N (transfer); we follow the
     flags since they're official. Hand-entered rows fall back to best grade. */
  function bestAttempts(rules, history) {
    const byCourse = {};
    history.forEach(r => { (byCourse[r.code] = byCourse[r.code] || []).push(r); });
    return Object.keys(byCourse).map(code => {
      const rows = byCourse[code];
      if (rows.length === 1) return rows[0];
      const flagged = rows.filter(r => r.flag === 'I');
      if (flagged.length) {
        const counted = flagged[flagged.length - 1];
        /* Failed then passed = passed. The registrar's "I" (included) flag
           does not always move to the newer attempt, so a later pass beats a
           flagged fail unless that pass is annulled. */
        if (!isPassing(rules, counted.grade)) {
          const later = rows
            .filter(r => isPassing(rules, r.grade) && r.flag !== 'A' && termOrder(r.term) > termOrder(counted.term))
            .sort((a, b) => termOrder(a.term) - termOrder(b.term));
          if (later.length) return later[later.length - 1];
        }
        return counted;
      }
      const live = rows.filter(r => r.flag !== 'A');
      const pool = live.length ? live : rows;
      let best = pool[0];
      pool.forEach(r => {
        const gp = gradePoint(rules, r.grade), prevGp = gradePoint(rules, best.grade);
        if (isPassing(rules, r.grade) && !isPassing(rules, best.grade)) best = r;
        else if (gp !== null && prevGp !== null && gp > prevGp) best = r;
      });
      return best;
    });
  }

  // buckets that don't count toward the degree total
  /* Year the student was admitted to the programme (start of the academic
     year: "SPRING 2023/2024" -> 2023). Transfer students keep their original
     ID, so the ID year can be older than the admission year. Without an
     admission term, falls back to the ID year minus one (ID 2026 = admitted
     2025/2026). */
  function admitYear(catalog, student) {
    const m = /(\d{4})\s*[\/-]\s*\d{2,4}/.exec(String((student && (student.admissionTerm || student.admission)) || ''));
    if (m) return Number(m[1]);
    const id = Number((student && student.catalogYear) || catalog.catalogYear || 0);
    return id ? id - 1 : 0;
  }
  // WRNL200 is required for students admitted from 2024/2025 on. Earlier
  // intakes (2023/2024 and before) are left alone: most will graduate first.
  function wrnlRequired(rules, catalog, student) {
    const w = rules.universityElectives['REG-UE-05'] || {};
    return admitYear(catalog, student) >= Number(w.appliesFromAdmissionYear || 2024);
  }

  const admitLabel = w => { const y = Number(w.appliesFromAdmissionYear || 2024); return y + '/' + (y + 1); };

  function nonDegree(catalog) {
    return catalog.nonDegreeBuckets || ['REMEDIAL', 'INTENSIVE', 'NON_CREDIT'];
  }

  function passedSet(rules, history) {
    const s = new Set();
    history.forEach(r => { if (isPassing(rules, r.grade)) s.add(r.code); });
    return s;
  }

  // ---- prerequisite graph -------------------------------------------------

  // Credits a course unlocks downstream (REG-PREQ-04). Each course counted
  // once even if reachable through two branches.
  function buildUnlockScores(catalog) {
    const map = byCode(catalog);
    const dependents = {};
    Object.values(map).forEach(c => {
      (c.pre || []).forEach(p => {
        (dependents[p] = dependents[p] || []).push(c.code);
      });
    });
    const out = {};
    Object.keys(map).forEach(code => {
      const seen = new Set();
      const stack = (dependents[code] || []).slice();
      let total = 0;
      while (stack.length) {
        const d = stack.pop();
        if (seen.has(d)) continue;
        seen.add(d);
        total += map[d] ? Number(map[d].cr) || 0 : 0;
        (dependents[d] || []).forEach(x => { if (!seen.has(x)) stack.push(x); });
      }
      out[code] = total;
    });
    return { scores: out, dependents };
  }

  function prereqStatus(rules, catalog, code, passed, earned) {
    const map = byCode(catalog);
    const c = map[code];
    if (!c) return { ok: false, missing: [], unknown: true };
    const missing = (c.pre || []).filter(p => !passed.has(p));
    // credit-count gate (Senior Project is the only one here)
    const shortBy = (c.minCredits && earned != null && earned < c.minCredits) ? c.minCredits - earned : 0;
    return { ok: missing.length === 0 && !shortBy, missing, shortBy, minCredits: c.minCredits || 0 };
  }

  // ---- when a course runs -------------------------------------------------

  // FALL 2026/2027 -> FALL
  function seasonOf(term) {
    const m = /(FALL|SPRING|SUMMER|WINTER)/i.exec(String(term || ''));
    return m ? m[1].toUpperCase() : null;
  }

  /* Does the course run this term? Loaded offering wins. Otherwise use
     the configured runsIn seasons.
       yes      - has a section in the loaded offering
       no       - offering for the term is loaded and it's not there
       likely   - no offering, but it normally runs this season
       unlikely - no offering, normally runs in the other season
       unknown  - no idea */
  function opensIn(catalog, code, term, offering) {
    const season = seasonOf(term);
    const forTerm = offering && offering.length ? offering.filter(x => x.term === term) : null;
    if (forTerm && forTerm.length) {
      if (forTerm.some(x => x.code === code)) return { state: 'yes', season };
      // offering might be partial, so only say "no" if runsIn agrees
      const c = byCode(catalog)[code];
      const runs = (c && c.runsIn) || [];
      if (runs.length && season && runs.indexOf(season) < 0) return { state: 'no', season, runsIn: runs };
      return { state: runs.length ? 'unlikely' : 'unknown', season, runsIn: runs };
    }
    const c = byCode(catalog)[code];
    const runs = (c && c.runsIn) || [];
    if (!runs.length || !season) return { state: 'unknown', season, runsIn: runs };
    return { state: runs.indexOf(season) >= 0 ? 'likely' : 'unlikely', season, runsIn: runs };
  }

  const seasonWord = s => s ? s.charAt(0) + s.slice(1).toLowerCase() : '';

  // next term on the BAU calendar
  function nextTermAfter(term) {
    const m = /(FALL|SPRING|SUMMER|WINTER)\s+(\d{4})\s*\/\s*(\d{4})/i.exec(String(term || ''));
    if (!m) return term;
    const season = m[1].toUpperCase(), a = +m[2], b = +m[3];
    if (season === 'FALL') return 'SPRING ' + a + '/' + b;
    if (season === 'SPRING') return 'SUMMER ' + a + '/' + b;
    return 'FALL ' + (a + 1) + '/' + (b + 1);
  }

  /* The academic calendar drives which term is "now". Each term has
     registration opening, first day of classes, end of add/drop, the
     withdrawal deadline and the last day. Dates are YYYY-MM-DD strings, so
     plain string comparison orders them. */
  function calendarNow(rules, today) {
    const terms = (rules.terms || []).filter(t => t && t.term && t.ends)
      .slice().sort((a, b) => String(a.classesStart || a.ends).localeCompare(String(b.classesStart || b.ends)));
    if (!terms.length) return null;
    const d = String(today).slice(0, 10);
    let cur = terms.find(t => d <= t.ends);
    // past the last term on the calendar: roll on to the next one, dates unknown
    if (!cur) cur = { term: nextMainTermAfter(terms[terms.length - 1].term), ends: '9999-12-31' };
    const i = terms.indexOf(cur);
    // advising looks ahead to the next main term; summer is planned only from summer
    const later = i < 0 ? null : terms.slice(i + 1).find(t => !/SUMMER/i.test(t.term));
    const next = later ? later.term : nextMainTermAfter(cur.term);
    const phase = i < 0 ? 'upcoming' : cur.regOpens && d < cur.regOpens ? 'upcoming'
      : cur.classesStart && d < cur.classesStart ? 'registration'
      : cur.addDropEnds && d <= cur.addDropEnds ? 'adddrop'
      : d <= cur.ends ? 'classes' : 'over';
    const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
    return { term: cur.term, next, phase, dates: cur,
      canRegister: phase === 'upcoming' || phase === 'registration' || phase === 'adddrop',
      daysToAddDropEnd: cur.addDropEnds ? days(d, cur.addDropEnds) : null,
      daysToRegistration: cur.regOpens ? days(d, cur.regOpens) : null };
  }

  // next non-summer term (where a missed course ends up)
  function nextMainTermAfter(term) {
    const t = nextTermAfter(term);
    return seasonOf(t) === 'SUMMER' ? nextTermAfter(t) : t;
  }

  // ---- student snapshot ---------------------------------------------------

  function snapshot(rules, catalog, student) {
    const map = byCode(catalog);
    const history = student.history || [];
    const best = bestAttempts(rules, history);

    // CGPA is per attempt; degree requirements are per course.
    const courseMeta = r => map[r.code] || (r.bucketOverride ? { bucket: r.bucketOverride, cr: r.cr, title: r.title || r.code } : null);
    const live = history.filter(r => r.flag !== 'A');
    const overall = computeGpa(rules, live);

    // degree credits: no foundation, intensive, freshman equivalency or
    // other-programme courses
    const counting = best.filter(r => {
      const c = courseMeta(r);
      return c && !nonDegree(catalog).includes(c.bucket);
    });
    const degree = computeGpa(rules, counting);
    // = "Tot. Cr. Compl." on the transcript.
    /* INT0 (internal transfer between BAU programmes) is left out: printed
       totals include it for some students and not for others. When the totals
       disagree, the page shows the printed one and flags the difference. */
    // D- earns transcript credits but must be repeated, so it only counts
    // here (see rules.json).
    const onTranscript = g => isPassing(rules, g)
      || (rules.transcriptCreditGrades || []).includes(String(g || '').trim().toUpperCase());
    const officialEarned = live.reduce((n, r) => n + (onTranscript(r.grade) ? (Number(r.cr) || 0) : 0), 0);

    // Per-term SGPA. Skip undated/planned rows, sort terms by date.
    const terms = {};
    history.forEach(r => {
      let key = r.term;
      // Real terms only. Counting the TRANSFER block made almost everyone a
      // semester older and read their standing off a block with no grades.
      if (!key || !/(FALL|SPRING|SUMMER|WINTER)\s*\d{4}/i.test(String(key))) return;
      if (rules.calendar.summerFoldsIntoSpring && /SUMMER/i.test(key)) key = String(key).replace(/SUMMER/i, 'SPRING');
      (terms[key] = terms[key] || []).push(r);
    });
    function termRank(t) {
      const m = /(FALL|SPRING|SUMMER)\s*(\d{4})\s*[\/-]\s*(\d{4})/i.exec(String(t || ''));
      if (!m) return Number.MAX_SAFE_INTEGER;
      const season = { FALL: 0, SPRING: 1, SUMMER: 2 }[m[1].toUpperCase()];
      return Number(m[2]) * 10 + season;
    }
    const termList = Object.keys(terms).sort((a,b) => termRank(a)-termRank(b)).map(t => ({
      term: t,
      records: terms[t],
      sgpa: computeGpa(rules, terms[t].filter(r => {
        const c = courseMeta(r);
        return c && !nonDegree(catalog).includes(c.bucket);
      })).gpa
    }));

    // Running CGPA after each term. Needed for "second one in a row",
    // which is what triggers the remedial stage.
    let running = [];
    const cgpaByTerm = termList.map(t => {
      running = running.concat(t.records);
      return { term: t.term, sgpa: t.sgpa, cgpa: computeGpa(rules, running.filter(r => r.flag !== 'A')).gpa };
    });
    // Consecutive academic warnings, from the latest term backwards. BAU's
    // published rule requires both SGPA and CGPA to be below 2.00.
    let probationRun = 0;
    for (let i = cgpaByTerm.length - 1; i >= 0; i--) {
      const t = cgpaByTerm[i];
      if (t.sgpa != null && t.cgpa != null
          && t.sgpa < rules.probation.warningThresholdSgpa
          && t.cgpa < rules.probation.warningThresholdCgpa) probationRun++;
      else break;
    }

    const passed = passedSet(rules, history);

    // Bucket progress. Catalogue 2026 moved 3 credits (WRNL200) from electives
    // to core, so block sizes depend on catalogue year.
    const inProgressCodes = [];
    if (student.registration && student.registration.courses) {
      student.registration.courses.forEach(c => {
        if (!passed.has(c.code)) inProgressCodes.push(c.code);
      });
    }

    const byYear = catalog.bucketsByCatalogYear || {};
    const catYear = Number(student.catalogYear || catalog.catalogYear || 0);
    const over = catYear >= 2026
      ? (byYear.from2026 || byYear[String(catYear)] || {})
      : (byYear.before2026 || byYear[String(catYear)] || byYear.default || {});
    const buckets = {};
    Object.keys(catalog.buckets).forEach(b => {
      buckets[b] = {
        label: catalog.buckets[b].label,
        required: over[b] !== undefined ? over[b] : catalog.buckets[b].credits,
        earned: 0, courses: []
      };
    });
    // Pre-2026 catalogue: WRNL200 is a university elective (11 cr block), not
    // mandatory. Putting it in mandatory showed those students as 8 of 5.
    const bucketFor = code => {
      const c = map[code];
      if (!c) return null;
      if (code === 'WRNL200' && catYear < 2026) return 'UNIV_ELECTIVE';
      return c.bucket;
    };
    counting.forEach(r => {
      const c = courseMeta(r);
      if (!c) return;
      const b = bucketFor(r.code) || c.bucket;
      if (!buckets[b]) return;
      if (isPassing(rules, r.grade)) {
        buckets[b].earned += Number(r.cr) || 0;
        buckets[b].courses.push(r.code);
      }
    });

    // in progress = registered now, not graded yet (from the schedule)
    Object.keys(buckets).forEach(b => { buckets[b].inProgress = 0; buckets[b].inProgressCourses = []; });
    inProgressCodes.forEach(code => {
      const c = map[code];
      if (!c || !buckets[c.bucket]) return;
      buckets[c.bucket].inProgress += Number(c.cr) || 0;
      buckets[c.bucket].inProgressCourses.push(code);
    });

    // UE block also needs one humanities + one social science course
    const ueList = catalog.universityElectives || [];
    const catOf = code => ueCategory(catalog, code);
    const ueTaken = buckets.UNIV_ELECTIVE ? buckets.UNIV_ELECTIVE.courses : [];
    if (buckets.UNIV_ELECTIVE) {
      buckets.UNIV_ELECTIVE.hasHumanities = ueTaken.some(c => catOf(c) === 'HUMANITIES');
      buckets.UNIV_ELECTIVE.hasSocial = ueTaken.some(c => catOf(c) === 'SOCIAL');
    }
    // "Missing" only makes sense for fixed blocks. Elective blocks are a
    // credit count, listing the whole pool as missing would be wrong.
    const FIXED = ['UNIV_MANDATORY', 'FACULTY_CORE', 'MAJOR_CORE', 'REMEDIAL'];
    const passedNow = passedSet(rules, history);
    const doingNow = new Set(inProgressCodes);
    Object.keys(buckets).forEach(b => {
      buckets[b].choose = FIXED.indexOf(b) < 0;
      // still to take = not passed and not taking it now
      buckets[b].missing = FIXED.indexOf(b) < 0 ? []
        : catalog.courses.filter(c => c.bucket === b && !c.alternateFor)
            .map(c => c.code).filter(code => !passedNow.has(code) && !doingNow.has(code));
      // Cap at block size. Extra credits go to surplus, they don't count twice.
      const k = buckets[b];
      k.passedCredits = k.earned;
      k.surplus = Math.max(0, k.earned - k.required);
      k.earned = Math.min(k.earned, k.required);
      k.inProgress = Math.min(k.inProgress, Math.max(0, k.required - k.earned));
      k.remaining = Math.max(0, k.required - k.earned - k.inProgress);
    });

    // standing / probation (REG-PROB)
    const standing = computeStanding(rules, termList, overall.gpa, student, probationRun);
    standing.probationRun = probationRun;
    /* Probation: SGPA and CGPA are both below 2.00, so the load drops to 12.
       Remedial: two academic warnings in a row. Same cap, with courses chosen
       by the advisor to improve the GPA. */
    if (probationRun >= ((rules.probation && rules.probation.remedialAfter) || 2) && (standing.state === 'PROBATION' || standing.state === 'DISMISSAL_RISK')) {
      standing.remedial = true;
      standing.loadCap = Math.min(standing.loadCap || 99, rules.probation.remedialFallSpringCap || 12);
    }

    /* Semester number counts from the admission term, not the first line of
       the transcript: a transfer's older terms are history, not semesters in
       this programme. Without an admission date, every term counts. */
    let completedSemesters = termList.length;
    const adm = String(student.admissionTerm || student.admission || '');
    const admYear = /(\d{4})\s*[\/-]\s*\d{2,4}/.exec(adm);
    if (admYear && termList.length) {
      const season = /SPRING|SUMMER/i.test(adm) ? 1 : 0;   // year only = from the fall of that year
      const from = Number(admYear[1]) * 10 + season;
      const since = termList.filter(t => termRank(t.term) >= from).length;
      if (since > 0) completedSemesters = since;
    }
    const ic3 = history.some(r => r.code === 'IC3' && isPassing(rules, r.grade));

    // Current courses come from the schedule. Not passed, can't be taken
    // again, and next term's plan assumes they'll be passed.
    const inProgress = new Set(inProgressCodes);
    const afterThisTerm = new Set(passed);
    inProgress.forEach(c => afterThisTerm.add(c));

    // track = 3 dept electives from one track's list (BAU CS programme page)
    const trackNames = Object.keys(catalog.tracks || {});
    const deptTaken = (buckets.DEPT_ELECTIVE ? buckets.DEPT_ELECTIVE.courses : []);
    const deptPlanned = Array.from(inProgress).filter(c => (map[c] || {}).bucket === 'DEPT_ELECTIVE');
    const trackProgress = {};
    trackNames.forEach(k => {
      const list = catalog.tracks[k].courses || [];
      const done = deptTaken.filter(c => list.includes(c));
      const doing = deptPlanned.filter(c => list.includes(c));
      trackProgress[k] = {
        key: k, label: catalog.tracks[k].label, courses: list,
        done, doing, count: done.length + doing.length,
        needed: (catalog.tracks[k].coursesRequired || 3)
      };
    });
    /* A transcript does not prove that a student formally selected a track.
       Do not infer one from a single elective.  Three matching completed/current
       courses are enough to show a *potential* track, while a spread across
       lists is reported as mixed evidence.  A track stored on the student is
       kept separate and labelled as recorded, not guessed. */
    const rankedTracks = trackNames.slice().sort((a, b) =>
      trackProgress[b].count - trackProgress[a].count || a.localeCompare(b));
    const firstTrack = rankedTracks[0] || null;
    const secondTrack = rankedTracks[1] || null;
    const firstCount = firstTrack ? trackProgress[firstTrack].count : 0;
    const secondCount = secondTrack ? trackProgress[secondTrack].count : 0;
    const evidenceTracks = rankedTracks.filter(k => trackProgress[k].count > 0);
    const recordedTrack = student.track && catalog.tracks[student.track] ? student.track : null;
    let inferredTrack = null;
    let trackEstimate;
    if (recordedTrack) {
      const p = trackProgress[recordedTrack];
      trackEstimate = { kind: 'recorded', key: recordedTrack, label: p.label,
        count: p.count, needed: p.needed, evidenceTracks };
    } else if (!firstTrack || firstCount === 0) {
      trackEstimate = { kind: 'none', key: null, label: 'No track evidence yet',
        count: 0, needed: 3, evidenceTracks: [] };
    } else if (firstCount >= trackProgress[firstTrack].needed && firstCount > secondCount) {
      inferredTrack = firstTrack;
      const p = trackProgress[firstTrack];
      trackEstimate = { kind: 'potential', key: firstTrack, label: p.label,
        count: p.count, needed: p.needed, evidenceTracks };
    } else if (evidenceTracks.length > 1) {
      trackEstimate = { kind: 'mixed', key: null, label: 'General / mixed electives',
        count: evidenceTracks.reduce((n, k) => n + trackProgress[k].count, 0),
        needed: 3, evidenceTracks };
    } else {
      const p = trackProgress[firstTrack];
      trackEstimate = { kind: 'developing', key: firstTrack, label: p.label,
        count: p.count, needed: p.needed, evidenceTracks };
    }

    const blockCredits = Object.keys(buckets).reduce((n, b) => n + buckets[b].earned, 0);
    return {
      student,
      passed,
      inProgress,
      afterThisTerm,
      trackProgress,
      trackEstimate,
      likelyTrack: recordedTrack || inferredTrack,
      history,
      best,
      counting,
      cgpa: overall.gpa,          // matches the transcript
      // Sum of capped blocks, so a 17 cr block can't read 20 and the degree
      // can't go over 100.
      earned: blockCredits,
      rawDegreeEarned: degree.earned,
      cgpaByTerm,                 // running CGPA after each term
      // current IE level, if any (decides the load cap)
      intensive: intensiveLevel(rules, student, (student.registration || {}).term),
      officialEarned,             // matches "Tot. Cr. Compl." on the transcript
      // gap = freshman equivalency + other-programme courses (printed, but not
      // part of the 100 degree credits)
      notCounted: officialEarned - degree.earned,
      blockCredits,
      gpaCredits: overall.gpaCredits,
      terms: termList,
      lastSgpa: termList.length ? termList[termList.length - 1].sgpa : null,
      buckets,
      completedSemesters,
      ic3,
      standing,
      intensiveActive: !!student.intensiveLevel && student.intensiveLevel !== 'DONE',
      foundationRemaining: (student.foundationRequired || []).filter(c => !passed.has(c))
    };
  }

  function computeStanding(rules, termList, cgpa, student, probationRun) {
    // nothing graded yet, nothing to judge
    if (cgpa == null) return { state: 'GOOD_STANDING', reason: 'No graded courses yet' };
    if (student.standingOverride) return { state: student.standingOverride, reason: 'Set from SIS import' };
    const p = rules.probation;
    // "From semester 2" = warning given in sem 2 based on sem 1, so one
    // finished term is already enough to judge.
    if (termList.length < p.startsFromSemester - 1) return { state: 'GOOD_STANDING', reason: 'First semester, nothing graded yet' };
    const last = termList[termList.length - 1];
    if (last.sgpa == null) {
      return { state: 'GOOD_STANDING', reason: 'No semester GPA was recorded for the latest term' };
    }
    const warning = last.sgpa < p.warningThresholdSgpa && cgpa < p.warningThresholdCgpa;
    if (warning) {
      if ((probationRun || 0) >= 2 && cgpa < p.dismissCgpaBelow) {
        return { state: 'DISMISSAL_RISK', reason: 'Two consecutive academic warnings and CGPA ' + cgpa.toFixed(2) + ' below ' + p.dismissCgpaBelow.toFixed(2), loadCap: p.warningLoadCap };
      }
      return { state: 'PROBATION', reason: 'Semester GPA ' + last.sgpa.toFixed(2) + ' and CGPA ' + cgpa.toFixed(2) + ' are below 2.00', loadCap: p.warningLoadCap };
    }
    if (last.sgpa < p.warningThresholdSgpa) {
      return { state: 'GOOD_STANDING', reason: 'CGPA ' + cgpa.toFixed(2), lowLastSgpa: last.sgpa };
    }
    return { state: 'GOOD_STANDING', reason: 'CGPA ' + cgpa.toFixed(2) };
  }

  // ---- load limits --------------------------------------------------------

  // min/max credits for this student and term, plus which rule set it
  function loadLimits(rules, snap, term) {
    const L = rules.load;
    if (/SUMMER/i.test(term)) {
      return { min: 0, max: L['REG-LOAD-05'].max, ruleId: 'REG-LOAD-05', citation: L['REG-LOAD-05'].citation, why: L['REG-LOAD-05'].text };
    }
    /* IE level caps the load. If they're also on probation, the lower cap
       wins: IE 2A (14) + CGPA < 2.00 (12) = 12. Six students were getting
       14 because whichever check ran first won. */
    const lvl = snap.intensive;
    const st = snap.standing.state;
    if (lvl && lvl.creditCap != null) {
      const onProbation = st === 'PROBATION' || st === 'DISMISSAL_RISK';
      const probCap = onProbation ? (snap.standing.loadCap || rules.probation.warningLoadCap) : Infinity;
      if (probCap < lvl.creditCap) {
        return { min: 0, max: probCap, ruleId: 'REG-LOAD-PROBATION',
          citation: rules.probation.citation || 'R&R VII',
          why: 'Academic probation holds the load to ' + probCap + ' credits, below the ' + lvl.creditCap + ' allowed by ' + lvl.name + '.' };
      }
      return { min: 0, max: lvl.creditCap, ruleId: 'INTENSIVE-ENGLISH',
        citation: (rules.intensiveEnglish || {}).citation || 'Intensive English Program',
        why: lvl.name + ' allows ' + lvl.creditCap + ' credits alongside it: ' + lvl.allowed + '.' };
    }
    if (st === 'PROBATION' || st === 'DISMISSAL_RISK') {
      return { min: 0, max: rules.probation.warningLoadCap, ruleId: 'REG-PROB', citation: rules.probation.citation, why: 'Academic probation: maximum 12 credits, chosen from failed, low-grade or university courses.' };
    }
    if (st === 'LOAD_CAPPED') {
      return { min: 0, max: L['REG-LOAD-04'].max, ruleId: 'REG-LOAD-04', citation: L['REG-LOAD-04'].citation, why: L['REG-LOAD-04'].text };
    }
    if (snap.cgpa != null && snap.cgpa >= L['REG-LOAD-02'].requiresCgpa && snap.earned >= L['REG-LOAD-02'].requiresEarned) {
      return { min: L['REG-LOAD-01'].min, max: L['REG-LOAD-02'].max, ruleId: 'REG-LOAD-02', citation: L['REG-LOAD-02'].citation, why: L['REG-LOAD-02'].text };
    }
    const seniorRule = L['REG-LOAD-03'];
    const isSeniorYear = snap.completedSemesters >= 4;
    if (seniorRule && isSeniorYear && snap.cgpa != null && snap.cgpa >= seniorRule.requiresCgpa && snap.lastSgpa != null && snap.lastSgpa >= seniorRule.requiresSgpa) {
      return { min: L['REG-LOAD-01'].min, max: seniorRule.max, ruleId: 'REG-LOAD-03', citation: seniorRule.citation, why: seniorRule.text };
    }
    return { min: L['REG-LOAD-01'].min, max: L['REG-LOAD-01'].max, ruleId: 'REG-LOAD-01', citation: L['REG-LOAD-01'].citation, why: L['REG-LOAD-01'].text };
  }

  // ---- basket validation --------------------------------------------------

  // Check a proposed basket for a term -> { findings, credits, limits, ok }
  function validateBasket(rules, catalog, student, basket, term, offering) {
    const snap = snapshot(rules, catalog, student);
    const map = byCode(catalog);
    const out = [];
    const limits = loadLimits(rules, snap, term);
    const codes = basket.map(b => (typeof b === 'string' ? b : b.code));
    const sections = basket.filter(b => typeof b !== 'string');

    let credits = 0;
    codes.forEach(c => { credits += map[c] ? Number(map[c].cr) || 0 : 0; });

    // REG-PREQ-01 prerequisites
    codes.forEach(code => {
      const c = map[code];
      if (!c) {
        out.push(finding('DATA-01', 'WARN', code + ' is not in the catalogue for this year.', { citation: 'Catalogue ' + catalog.catalogYear }));
        return;
      }
      const st = prereqStatus(rules, catalog, code, snap.passed);
      if (!st.ok) {
        // prereq in the same basket doesn't count
        const inBasket = st.missing.filter(m => codes.includes(m));
        const msg = code + ' requires ' + st.missing.join(' and ') + ' - not yet passed'
          + (inBasket.length ? ' (a prerequisite cannot be taken in the same semester)' : '') + '.';
        out.push(finding('REG-PREQ-01', 'BLOCK', msg, {
          citation: rules.sequencing['REG-PREQ-01'].citation,
          fix: { action: 'Register the prerequisite first', courses: st.missing },
          overridable: true
        }));
      }
    });

    // REG-FND-01/02 foundation gates. Marked as needing a foundation course ->
    // can't take the faculty course it unlocks yet. CMPS241 is the exception.
    const remainingFoundation = new Set(snap.foundationRemaining || []);
    if (remainingFoundation.size) {
      codes.forEach(code => {
        const c = map[code];
        const isFoundation = remainingFoundation.has(code) || (c && c.bucket === 'REMEDIAL');
        if (isFoundation || code === 'CMPS241') return;
        out.push(finding('REG-FND-02', 'BLOCK',
          code + ' must wait until the foundation courses are completed. A foundation student may take the foundation courses with CMPS241 in the first semester.',
          { citation: (rules.foundation || {}).citation || 'Foundation pathway',
            fix: { action: 'Keep foundation courses and CMPS241 only', courses: Array.from(remainingFoundation).concat(['CMPS241']) } }));
      });
    }
    codes.forEach(code => {
      (student.foundationRequired || []).forEach(fcode => {
        const f = map[fcode];
        if (remainingFoundation.has(fcode) && f && f.unlocksRemedial === code) {
          out.push(finding('REG-FND-01', 'BLOCK',
            code + ' requires foundation course ' + fcode + ' first.',
            { citation: 'Foundation pathway', fix: { action: 'Complete foundation course first', courses: [fcode] } }));
        }
      });
    });

    // REG-PREQ-02 co-requisites
    codes.forEach(code => {
      const c = map[code];
      if (!c || !c.co || !c.co.length) return;
      c.co.forEach(coreq => {
        if (!codes.includes(coreq) && !snap.passed.has(coreq)) {
          out.push(finding('REG-PREQ-02', 'BLOCK', code + ' must be taken with its co-requisite ' + coreq + '.', {
            citation: rules.sequencing['REG-PREQ-02'].citation,
            fix: { action: 'Add the co-requisite', courses: [coreq] }
          }));
        }
      });
    });

    // load limits
    if (credits > limits.max) {
      out.push(finding(limits.ruleId, 'BLOCK', 'Basket is ' + credits + ' credits; this student\'s maximum is ' + limits.max + '. ' + limits.why, { citation: limits.citation }));
    } else if (limits.min && credits < limits.min && credits > 0) {
      out.push(finding('REG-LOAD-06', 'WARN', 'Basket is ' + credits + ' credits, below the ' + limits.min + '-credit minimum. Registration is cancelled after week 2 unless an exception is approved (expected graduate, lack of offered courses, incompatible offerings, health or social status).', { citation: rules.load['REG-LOAD-06'].citation }));
    }

    // REG-INTE-01 intensive English cap
    if (snap.intensiveActive) {
      const academic = codes.filter(c => map[c] && !['INTENSIVE', 'NON_CREDIT'].includes(map[c].bucket));
      if (academic.length > rules.specialCases['REG-INTE-01'].maxAcademicCoursesAlongsideIntensive) {
        out.push(finding('REG-INTE-01', 'BLOCK',
          'Intensive English (' + student.intensiveLevel + ') allows only ONE academic course. This plan has ' + academic.length + '.',
          { citation: 'Department rule', fix: { action: 'Keep only the highest unlock-value course', courses: [rules.specialCases['REG-INTE-02'].preferredCompanion] } }));
      }
    }

    // REG-UE-04 own-faculty electives
    const scope = rules.universityElectives['REG-UE-04'].blockOwnFacultyElectivesScope;
    codes.forEach(code => {
      const ue = catalog.universityElectives.find(u => u.code === code);
      if (!ue) return;
      const blocked = scope === 'faculty' ? (ue.ownMajor || ue.ownFaculty) : ue.ownMajor;
      if (blocked) {
        out.push(finding('REG-UE-04', 'BLOCK',
          code + ' is from the student\'s own ' + (ue.ownMajor ? 'major' : 'faculty') + ' and cannot count as a university elective.',
          { citation: rules.universityElectives['REG-UE-04'].citation }));
      }
    });

    // Offering can exclude CS students (Science UEs are otherwise fine for CS).
    // careful: this term's sections only. The feed can pile up Fall + Spring
    // and an old term's exclusion shouldn't leak forward.
    const termOffering = offering && offering.length ? offering.filter(x => x.term === term) : offering;
    if (termOffering && termOffering.length) {
      codes.forEach(code => {
        const secs = termOffering.filter(x => x.code === code);
        if (!secs.length) return;
        const eligible = secs.some(x => !/(^|[,;\s])(CS|COMPUTER\s*SCIENCE)([,;\s]|$)/i.test(String(x.excludedPrograms || x.excluded || '')));
        if (!eligible) {
          out.push(finding('REG-OFFER-EXCL', 'BLOCK',
            code + ' is offered, but the current offering excludes Computer Science students.',
            { citation: 'Current course offering' }));
        }
      });
    }

    // REG-PREQ-09 timetable conflicts
    const clashes = detectClashes(sections);
    clashes.forEach(([a, b]) => {
      out.push(finding('REG-PREQ-09', 'BLOCK',
        a.code + ' (' + a.days + ' ' + a.start + '-' + a.end + ') clashes with ' + b.code + ' (' + b.days + ' ' + b.start + '-' + b.end + ').',
        { citation: 'Timetable', fix: { action: 'Pick a different section' } }));
    });

    // REG-PREQ-10 not in this term's synced offering
    if (offering && offering.length) {
      const offered = new Set(termOffering.map(s => s.code));
      codes.forEach(code => {
        if (!offered.has(code) && map[code] && map[code].bucket !== 'NON_CREDIT') {
          out.push(finding('REG-PREQ-10', 'INFO', code + ' is not in the synced offering for ' + term + '.', { citation: 'Course offering sync' }));
        }
      });
    }

    // REG-PREQ-06 next term starved of core. Skip for an empty basket.
    const look = lookAhead(rules, catalog, student, codes, offering, term);
    if (codes.length && look.eligibleCoreCredits < rules.sequencing['REG-PREQ-06'].minEligibleCoreNextTerm) {
      out.push(finding('REG-PREQ-06', 'WARN',
        'Starves next semester - only ' + look.eligibleCoreCredits + ' credits of core would be open.',
        { citation: 'Sequencing policy', fix: look.suggestion ? { action: 'Consider adding', courses: [look.suggestion] } : undefined }));
    }

    // REG-PREQ-11 room left but a high-unlock course they can take now is skipped
    const CHAIN_THRESHOLD = 9;
    const skipped = (look.delayedChain || []).filter(d => d.unlocks >= CHAIN_THRESHOLD);
    if (codes.length && skipped.length && credits < limits.max) {
      const top = skipped[0];
      out.push(finding('REG-PREQ-11', 'WARN',
        top.code + ' is open now and unlocks ' + top.unlocks + ' credits, but is not in the plan (' + (limits.max - credits) + ' credits of room left).',
        { citation: 'Sequencing policy', fix: { action: 'Add', courses: skipped.slice(0, 2).map(d => d.code) } }));
    }

    // REG-PREQ-05 spring entry
    if (student.entryTerm && /SPRING/i.test(student.entryTerm) && snap.completedSemesters === 0) {
      const academic = codes.filter(c => map[c] && !['INTENSIVE', 'NON_CREDIT'].includes(map[c].bucket));
      if (academic.length === 1 && academic[0] === 'CMPS241') {
        out.push(finding('REG-PREQ-05', 'WARN',
          'CMPS241 alone wastes a spring entry. Pair it with CMPS244, MATH241 or MATH242.',
          { citation: 'Sequencing policy', fix: { action: 'Add', courses: ['CMPS244', 'MATH241', 'MATH242'] } }));
      }
    }

    // degree-bucket nudges
    degreeNudges(rules, catalog, snap, codes, term).forEach(f => out.push(f));

    const ok = !out.some(f => f.severity === 'BLOCK');
    return { findings: out, credits, limits, ok, snapshot: snap, lookAhead: look };
  }

  function parseTime(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function detectClashes(sections) {
    const out = [];
    for (let i = 0; i < sections.length; i++) {
      for (let j = i + 1; j < sections.length; j++) {
        const a = sections[i], b = sections[j];
        if (!a.days || !b.days) continue;
        const da = String(a.days).split(/[,\s]+/).filter(Boolean);
        const db = new Set(String(b.days).split(/[,\s]+/).filter(Boolean));
        if (!da.some(d => db.has(d))) continue;
        const as = parseTime(a.start), ae = parseTime(a.end);
        const bs = parseTime(b.start), be = parseTime(b.end);
        if (as == null || bs == null) continue;
        if (as < be && bs < ae) out.push([a, b]);
      }
    }
    return out;
  }

  function degreeNudges(rules, catalog, snap, codes, term) {
    const out = [];
    const map = byCode(catalog);
    const ue = rules.universityElectives;

    // humanities / social science
    const takenUE = [].concat(
      snap.buckets.UNIV_ELECTIVE.courses,
      codes.filter(c => catalog.universityElectives.some(u => u.code === c))
    );
    const catOf = code => ueCategory(catalog, code);
    const hasHum = takenUE.some(c => catOf(c) === 'HUMANITIES');
    const hasSoc = takenUE.some(c => catOf(c) === 'SOCIAL');
    const remainingSemesters = Math.max(0, catalog.standardSemesters - snap.completedSemesters);

    if (!hasHum) {
      out.push(finding('REG-UE-01', remainingSemesters <= 2 ? 'WARN' : 'INFO',
        'No Humanities elective yet - one is required.',
        { citation: ue['REG-UE-01'].citation, fix: { action: 'Pick one humanities course', courses: catalog.universityElectives.filter(u => u.cat === 'HUMANITIES').slice(0, 5).map(u => u.code) } }));
    }
    if (!hasSoc) {
      out.push(finding('REG-UE-02', remainingSemesters <= 2 ? 'WARN' : 'INFO',
        'No Social Science elective yet - one is required.',
        { citation: ue['REG-UE-02'].citation, fix: { action: 'Pick one SOCI or PSYC course', courses: catalog.universityElectives.filter(u => u.cat === 'SOCIAL').slice(0, 5).map(u => u.code) } }));
    }

    // IC3
    if (!snap.ic3) {
      const due = rules.nonCredit['REG-UE-06'].dueBySemester;
      out.push(finding('REG-UE-06', snap.completedSemesters >= due ? 'WARN' : 'INFO',
        'IC3 not recorded. Due within ' + due + ' semesters; now in semester ' + (snap.completedSemesters + 1) + '.',
        { citation: rules.nonCredit['REG-UE-06'].citation }));
    }

    // WRN
    const wrn = ue['REG-UE-05'];
    if (wrnlRequired(rules, catalog, snap.student) && !snap.passed.has(wrn.code)) {
      if (snap.earned > wrn.requiredAboveEarnedCredits) {
        out.push(finding('REG-UE-05', 'WARN',
          wrn.code + ' (' + wrn.credits + ' cr) is mandatory above ' + wrn.requiredAboveEarnedCredits + ' credits (student has ' + snap.earned + ').',
          { citation: wrn.citation, fix: { action: 'Register WRN', courses: [wrn.code] } }));
      } else if (snap.earned >= wrn.warnAtEarnedCredits) {
        out.push(finding('REG-UE-05', 'INFO',
          wrn.code + ' becomes mandatory above ' + wrn.requiredAboveEarnedCredits + ' credits - student is at ' + snap.earned + '.',
          { citation: wrn.citation }));
      }
    }

    // ask for a track after 3 semesters
    if (snap.completedSemesters >= rules.sequencing['REG-PREQ-07'].afterCompletedSemesters && !snap.student.track) {
      out.push(finding('REG-PREQ-07', 'INFO',
        'Semester 4 reached - choose a track to guide departmental-elective planning.',
        { citation: 'Study plan' }));
    }

    // gen science electives due in the last two semesters
    const gse = snap.buckets.GEN_SCI_ELECTIVE;
    if (remainingSemesters <= 2 && gse.earned < gse.required) {
      const inBasket = codes.filter(c => map[c] && map[c].bucket === 'GEN_SCI_ELECTIVE').length;
      if (!inBasket) {
        out.push(finding('REG-PREQ-08', 'WARN',
          'General Science Electives due now - ' + gse.earned + '/' + gse.required + ' credits done. One 3-cr then one 2-cr.',
          { citation: rules.genScience['REG-GSE-02'].citation }));
      }
    }

    return out;
  }

  // ---- recommendation -----------------------------------------------------

  /* Ranked recommendations for a term. Order: core with prereqs first
     (REG-PREQ-03), then unlock value (REG-PREQ-04), then study-plan
     semester, then bucket urgency. */
  function recommend(rules, catalog, student, term, offering) {
    const snap = snapshot(rules, catalog, student);
    const map = byCode(catalog);
    const { scores } = buildUnlockScores(catalog);
    // this term's sections only, or a Fall-only course shows up for Spring
    const termOffering = offering && offering.length ? offering.filter(x => x.term === term) : offering;
    const offered = termOffering && termOffering.length ? new Set(termOffering.map(s => s.code)) : null;
    const limits = loadLimits(rules, snap, term);

    const candidates = [];

    // 1. remedial first, they gate the faculty core
    snap.foundationRemaining.forEach(code => {
      const c = map[code] || { code, title: code, cr: 3 };
      candidates.push({
        code, title: c.title, cr: c.cr, bucket: 'REMEDIAL', score: 10000,
        reasons: ['Foundation course - required before ' + (c.unlocksRemedial || 'the matching faculty core course')]
      });
    });

    // 2. everything in the degree not passed yet and eligible
    catalog.courses.forEach(c => {
      // univ mandatory is step 3, the non-degree buckets never go in the pool
      if (nonDegree(catalog).concat(['UNIV_MANDATORY']).includes(c.bucket)) return;
      if (snap.passed.has(c.code)) return;
      if (c.code === 'FREN111') return;
      const st = prereqStatus(rules, catalog, c.code, snap.passed, snap.earned);
      if (!st.ok) return;
      if (offered && !offered.has(c.code)) return;

      // dept electives only after 3 semesters (REG-PREQ-07)
      if (c.bucket === 'DEPT_ELECTIVE' && snap.completedSemesters < rules.sequencing['REG-PREQ-07'].afterCompletedSemesters) return;
      if (c.bucket === 'DEPT_ELECTIVE' && snap.buckets.DEPT_ELECTIVE.earned >= snap.buckets.DEPT_ELECTIVE.required) return;

      const unlock = scores[c.code] || 0;
      const reasons = [];
      if (unlock > 0) reasons.push('Unlocks ' + unlock + ' cr');
      if (c.bucket === 'FACULTY_CORE' || c.bucket === 'MAJOR_CORE') reasons.push('Core requirement');
      if (c.planSem) reasons.push('Semester ' + c.planSem);

      let score = unlock * 10;
      if (c.bucket === 'MAJOR_CORE' || c.bucket === 'FACULTY_CORE') score += 500;
      // a failed course comes back before one that was withdrawn (W / AW)
      const lastTry = snap.best.find(r => r.code === c.code);
      const lastGrade = String((lastTry && lastTry.grade) || '').trim().toUpperCase();
      if (lastTry && mustRepeat(rules, lastTry.grade)) { score += 400; reasons.unshift('Failed before, take it again'); }
      else if ((rules.withdrawalGrades || ['W', 'AW']).indexOf(lastGrade) >= 0) { score += 120; reasons.unshift('Withdrawn before'); }
      if (c.planSem && c.planSem <= snap.completedSemesters + 1) score += 300; // overdue per plan
      // 2+ semesters ahead in the study plan -> skip it, even if prereqs are met
      if (c.planSem && c.planSem > snap.completedSemesters + 1 + (catalog.coreAheadSemesters != null ? catalog.coreAheadSemesters : 1)) return;
      if (c.co && c.co.length) score += 5;

      /* Dept electives: the BAU study plan has one slot each in sem 4, 5, 6.
         Reached a slot without filling it = behind, so rank it next to that
         semester's core, not under the UEs. Track electives go first. */
      if (c.bucket === 'DEPT_ELECTIVE') {
        const de = snap.buckets.DEPT_ELECTIVE;

        const left = de.required - de.earned;
        const target = snap.completedSemesters + 1;
        const slots = (catalog.deptElectiveSlots || [4, 5, 6]).filter(n => n <= target).length;
        const due = slots * 3 - de.earned;
        const trackKey = student.track || snap.likelyTrack;
        const t = trackKey ? catalog.tracks[trackKey] : null;
        const inTrack = !!(t && t.courses.includes(c.code));
        score += due > 0 ? 700 : 320;
        if (inTrack) score += 200;
        // Prefer electives configured for the requested season.
        const season = seasonOf(term);
        if (season && Array.isArray(c.runsIn) && c.runsIn.length) {
          if (c.runsIn.includes(season)) { score += 100; reasons.push('Has run in ' + season.charAt(0) + season.slice(1).toLowerCase() + ' before'); }
          else { score -= 150; reasons.push('Has only run in ' + c.runsIn.map(x => x.charAt(0) + x.slice(1).toLowerCase()).join(' and ') + ' so far'); }
        }
        if (due > 0) reasons.unshift('Study plan has a departmental elective in semester ' + Math.min(target, 6));
        reasons.push('Departmental elective: ' + left + ' of ' + de.required + ' credits still needed');
        if (t) reasons.push(inTrack ? 'Counts toward the ' + t.label + ' track'
          : 'Outside the ' + t.label + ' track');
      }

      if (!reasons.length) {
        reasons.push('Counts toward ' + (catalog.buckets[c.bucket] ? catalog.buckets[c.bucket].label : c.bucket));
      }

      candidates.push({ code: c.code, title: c.title, cr: c.cr, bucket: c.bucket, score, reasons, co: c.co, pre: c.pre });
    });

    // 3. univ mandatory still missing
    catalog.courses.filter(c => c.bucket === 'UNIV_MANDATORY' && c.code !== 'FREN111'
      // ARAB007, ENGL006 etc. are alternates for the same requirement
      && !c.alternateFor
      && c.code !== rules.universityElectives['REG-UE-05'].code   // WRNL200 has its own rule below
      && (!c.appliesFromCatalogYear || (student.catalogYear || catalog.catalogYear) >= c.appliesFromCatalogYear)
    ).map(c => c.code).forEach(code => {
      if (snap.passed.has(code)) return;
      if (offered && !offered.has(code)) return;
      const c = map[code];
      candidates.push({ code, title: c.title, cr: c.cr, bucket: 'UNIV_MANDATORY', score: 600, reasons: ['University requirement'] });
    });

    // 4. WRN once it's due
    const wrn = rules.universityElectives['REG-UE-05'];
    if (wrnlRequired(rules, catalog, student) && !snap.passed.has(wrn.code) && snap.earned >= wrn.warnAtEarnedCredits) {
      const wc = map[wrn.code] || {};
      candidates.push({ code: wrn.code, title: wc.title || 'Work Ready Now', cr: wrn.credits || wc.cr || 3,
        bucket: wc.bucket || 'UNIV_MANDATORY',
        score: snap.earned > wrn.requiredAboveEarnedCredits ? 700 : 250,
        reasons: [snap.earned > wrn.requiredAboveEarnedCredits
          ? 'Required now - above ' + wrn.requiredAboveEarnedCredits + ' earned credits'
          : 'Becomes mandatory above ' + wrn.requiredAboveEarnedCredits + ' credits'] });
    }

    // 5. UEs: humanities / social first, then free
    const ueBucket = snap.buckets.UNIV_ELECTIVE;
    if (ueBucket.earned < ueBucket.required) {
      const taken = new Set(ueBucket.courses);
      const hasHum = ueBucket.courses.some(c => ueCategory(catalog, c) === 'HUMANITIES');
      const hasSoc = ueBucket.courses.some(c => ueCategory(catalog, c) === 'SOCIAL');
      const scope = rules.universityElectives['REG-UE-04'].blockOwnFacultyElectivesScope;
      catalog.universityElectives.forEach(u => {
        if (taken.has(u.code)) return;
        if (scope === 'faculty' ? (u.ownMajor || u.ownFaculty) : u.ownMajor) return;
        if (offered && !offered.has(u.code)) return;
        if (termOffering && termOffering.length) {
          const secs = termOffering.filter(x => x.code === u.code);
          if (secs.length && !secs.some(x => !/(^|[,;\s])(CS|COMPUTER\s*SCIENCE)([,;\s]|$)/i.test(String(x.excludedPrograms || x.excluded || '')))) return;
        }
        let s = 60, reasons = [];
        if (!hasHum && u.cat === 'HUMANITIES') { s = 420; reasons.push('Humanities elective'); }
        else if (!hasSoc && u.cat === 'SOCIAL') { s = 420; reasons.push('Social science elective'); }
        else reasons.push('Free university elective (' + (ueBucket.required - ueBucket.earned) + ' credits still needed)');
        candidates.push({ code: u.code, title: u.title, cr: u.cr, bucket: 'UNIV_ELECTIVE', score: s, reasons });
      });
    }

    // 6. gen science electives, last two semesters only
    const gse = snap.buckets.GEN_SCI_ELECTIVE;
    const remaining = catalog.standardSemesters - snap.completedSemesters;
    if (gse.earned < gse.required && remaining <= 2 && offered) {
      const need3 = !gse.courses.some(c => (map[c] || {}).cr === 3);
      catalog.genScienceElectives.forEach(g => {
        if (gse.courses.includes(g.code)) return;
        if (!offered.has(g.code)) return; // only from the real offering, not the placeholder list
        if (termOffering && termOffering.length) {
          const secs = termOffering.filter(x => x.code === g.code);
          if (secs.length && !secs.some(x => !/(^|[,;\s])(CS|COMPUTER\s*SCIENCE)([,;\s]|$)/i.test(String(x.excludedPrograms || x.excluded || '')))) return;
        }
        const wanted = need3 ? g.cr === 3 : g.cr === 2;
        candidates.push({ code: g.code, title: g.title, cr: g.cr, bucket: 'GEN_SCI_ELECTIVE', score: wanted ? 450 : 120, reasons: [wanted ? 'General Science Elective due now (' + g.cr + ' cr)' : 'General Science Elective'] });
      });
    }

    // Intensive English: keep only the one best companion course
    if (snap.intensiveActive) {
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates.filter(c => c.bucket !== 'REMEDIAL')[0];
      const remedial = candidates.filter(c => c.bucket === 'REMEDIAL')[0];
      const keep = [];
      if (snap.foundationRemaining.length && remedial) {
        keep.push(Object.assign({}, remedial, { reasons: remedial.reasons.concat(['Only ONE course may accompany Intensive English']) }));
      } else if (best) {
        keep.push(Object.assign({}, best, { reasons: best.reasons.concat(['Only ONE course may accompany Intensive English']) }));
      }
      return { recommendations: keep, limits, snapshot: snap, capped: true };
    }

    candidates.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
    // Electives are interchangeable inside a group (40 PSYC/SOCI courses all
    // fill Social Science). Show the top few per group, full list is in the catalogue.
    const cap = { UNIV_ELECTIVE: 3, DEPT_ELECTIVE: catalog.deptElectiveShowMax || 3, GEN_SCI_ELECTIVE: 3 };
    const seen = {}, once = new Set();
    const kept = candidates.filter(c => {
      if (once.has(c.code)) return false; // WRNL200 can arrive by two routes
      once.add(c.code);
      if (!cap[c.bucket]) return true;
      seen[c.bucket] = (seen[c.bucket] || 0) + 1;
      return seen[c.bucket] <= cap[c.bucket];
    });
    candidates.length = 0; kept.forEach(c => candidates.push(c));
    /* Do not recommend courses the student is registered in this term
       (same-term registration only). */
    const reg = student.registration;
    const sittingNow = new Set(
      reg && (!reg.term || !term || reg.term === term) ? (reg.courses || []).map(c => c.code) : []
    );
    const out = sittingNow.size ? candidates.filter(c => !sittingNow.has(c.code)) : candidates;
    return { recommendations: out, limits, snapshot: snap, capped: false, sittingNow: [...sittingNow] };
  }

  // REG-PREQ-06: what does this basket open up next term?
  function lookAhead(rules, catalog, student, codes, offering, term) {
    const termOffering = term && offering && offering.length ? offering.filter(x => x.term === term) : offering;
    const snap = snapshot(rules, catalog, student);
    const map = byCode(catalog);
    const future = new Set(snap.passed);
    codes.forEach(c => future.add(c)); // assume they pass

    let eligibleCoreCredits = 0;
    const opens = [];
    catalog.courses.forEach(c => {
      if (!['FACULTY_CORE', 'MAJOR_CORE'].includes(c.bucket)) return;
      if (future.has(c.code)) return;
      const missingNow = (c.pre || []).filter(p => !snap.passed.has(p));
      const missingAfter = (c.pre || []).filter(p => !future.has(p));
      if (missingAfter.length === 0) {
        eligibleCoreCredits += Number(c.cr) || 0;
        if (missingNow.length > 0) opens.push(c.code);
      }
    });

    // high-unlock courses they could take now but the basket left out (REG-PREQ-11)
    const { scores } = buildUnlockScores(catalog);
    const delayedChain = [];
    let suggestion = null, bestScore = -1;
    catalog.courses.forEach(c => {
      if (!['FACULTY_CORE', 'MAJOR_CORE'].includes(c.bucket)) return;
      if (snap.passed.has(c.code)) return;
      if ((c.pre || []).some(p => !snap.passed.has(p))) return; // not eligible now
      if (codes.includes(c.code)) return;                       // already chosen
      if (termOffering && termOffering.length && !termOffering.some(s => s.code === c.code)) return;
      const s = scores[c.code] || 0;
      delayedChain.push({ code: c.code, unlocks: s });
      if (s > bestScore) { bestScore = s; suggestion = c.code; }
    });
    delayedChain.sort((a, b) => b.unlocks - a.unlocks);

    return { eligibleCoreCredits, opens, delayedChain, suggestion: bestScore > 0 ? suggestion : null };
  }

  // ---- graduation audit ---------------------------------------------------

  function graduationAudit(rules, catalog, student) {
    const snap = snapshot(rules, catalog, student);
    const g = rules.graduation;
    const map = byCode(catalog);
    const items = [];
    Object.keys(snap.buckets).filter(b => snap.buckets[b].required > 0).forEach(b => {
      const bu = snap.buckets[b];
      items.push({ label: bu.label, ok: bu.earned >= bu.required, detail: bu.earned + ' / ' + bu.required + ' cr' });
    });

    // humanities/social are real graduation requirements, not just nudges
    const hasHum = !!snap.buckets.UNIV_ELECTIVE.hasHumanities;
    const hasSoc = !!snap.buckets.UNIV_ELECTIVE.hasSocial;
    items.push({ label: 'Humanities elective', ok: hasHum, detail: hasHum ? 'Completed' : 'Missing' });
    items.push({ label: 'Social Science elective', ok: hasSoc, detail: hasSoc ? 'Completed' : 'Missing' });

    // gen science: normally one 3 cr + one 2 cr. Two 3 cr courses are allowed
    // when no suitable 2 cr course was offered or fitted (rules.json genScience),
    // so 3 + 3 passes too, with a note for the advisor to confirm why.
    const gseRecords = snap.counting.filter(r => {
      const c = map[r.code];
      return (c && c.bucket === 'GEN_SCI_ELECTIVE') || r.bucketOverride === 'GEN_SCI_ELECTIVE';
    }).filter(r => isPassing(rules, r.grade));
    const n3 = gseRecords.filter(r => Number(r.cr) === 3).length;
    const has3 = n3 > 0;
    const has2 = gseRecords.some(r => Number(r.cr) === 2);
    const threeThree = !has2 && n3 >= 2;
    items.push({ hidden: true, label: 'General Science 3 + 2 credits', ok: (has3 && has2) || threeThree,
      detail: threeThree ? '3cr + 3cr, allowed when no 2cr course fitted (advisor confirms)'
        : (has3 ? '3cr \u2713' : '3cr missing') + ' \u00B7 ' + (has2 ? '2cr \u2713' : '2cr missing') });

    const wrn = rules.universityElectives['REG-UE-05'];
    if (wrnlRequired(rules, catalog, student)) {
      items.push({ label: 'WRNL200 Work Ready Now', ok: snap.passed.has(wrn.code), detail: snap.passed.has(wrn.code) ? 'Completed' : 'Missing' });
    }

    const repeatRequired = snap.best.filter(r => mustRepeat(rules, r.grade))
      .filter(r => repeatKind(rules, catalog, snap, r.code).kind === 'must');
    const incomplete = snap.best.filter(r => String(r.grade || '').toUpperCase() === 'I');
    items.push({ hidden: true, label: 'No unresolved F', ok: repeatRequired.length === 0, detail: repeatRequired.length ? repeatRequired.map(r => r.code).join(', ') : 'Clear' });
    items.push({ hidden: true, label: 'No incomplete grades', ok: incomplete.length === 0, detail: incomplete.length ? incomplete.map(r => r.code).join(', ') : 'Clear' });

    // Total credits + CGPA: hidden from the list (already at the top of the
    // page) but they still block graduation.
    const hidden = [
      { label: 'Total credits', ok: snap.earned >= g.totalCredits, detail: snap.earned + ' / ' + g.totalCredits, hidden: true },
      { label: 'CGPA >= 2.00', ok: snap.cgpa != null && snap.cgpa >= g.minCgpa, detail: snap.cgpa == null ? 'no graded courses yet' : snap.cgpa.toFixed(2), hidden: true }];
    hidden.forEach(h => items.push(h));
    items.push({ label: 'IC3 / ICDL', ok: snap.ic3, detail: snap.ic3 ? 'Obtained' : 'Missing' });
    // no limit on the number of semesters in the graduation check

    const noGradeBelowC = snap.counting.every(r => {
      const gp = gradePoint(rules, r.grade);
      return gp === null || gp >= rules.gradeScale[g.honorsNoGradeBelow];
    });
    const honors = snap.cgpa != null && snap.cgpa >= g.honorsCgpa && noGradeBelowC;

    const blockers = items.filter(i => !i.ok);
    return {
      items,
      eligible: blockers.length === 0,
      blockers,
      remainingCredits: Math.max(0, g.totalCredits - snap.earned),
      honors,
      snapshot: snap
    };
  }

  // ---- minor audit --------------------------------------------------------

  function minorAudit(rules, catalog, student) {
    const snap = snapshot(rules, catalog, student);
    const m = catalog.mathMinor;
    if (!m || !Array.isArray(m.eligiblePrefixes)) return null;   // programme without a minor
    const map = byCode(catalog);
    const allMath = snap.best.filter(r => m.eligiblePrefixes.some(p => r.code.startsWith(p)) && isPassing(rules, r.grade));
    // Foundation doesn't count for the minor: MATH111/112 are remedial,
    // freshman MATH110 etc. is entry credit. Ignore what the import says.
    const foundationBuckets = new Set(['REMEDIAL', 'FRESHMAN', 'INTENSIVE']);
    const isFoundation = r => {
      const c = map[r.code];
      if (c && foundationBuckets.has(c.bucket)) return true;
      const n = parseInt(String(r.code).replace(/^[A-Z]+/, ''), 10);
      return n < 200;
    };
    const foundation = allMath.filter(isFoundation);
    /* Dept rule: 18 MATH credits incl. MATH246 (Real Analysis I) or MATH346
       (Abstract Algebra I). MATH used as a dept or gen science elective stays
       there, not in the minor. */
    const usedElsewhere = new Set([].concat(
      (snap.buckets.GEN_SCI_ELECTIVE || {}).courses || [],
      (snap.buckets.DEPT_ELECTIVE || {}).courses || []));
    const taken = allMath.filter(r => !isFoundation(r) && (r.bucketOverride === 'MATH_MINOR' || !usedElsewhere.has(r.code)));
    const excluded = allMath.filter(r => taken.indexOf(r) < 0 && foundation.indexOf(r) < 0);
    const credits = taken.reduce((s, r) => s + (Number(r.cr) || 0), 0);
    const required = m.requiredOneOf || ['MATH246', 'MATH346'];
    const hasRequiredCourse = taken.some(r => required.indexOf(r.code) >= 0);
    return {
      credits, min: m.minCredits, max: m.maxCredits,
      courses: taken.map(r => r.code),
      excluded: excluded.map(r => r.code),
      foundation: foundation.map(r => r.code),
      requiredOneOf: required,
      hasRequiredCourse,
      mathCoursesSeen: allMath.map(r => r.code),
      ok: credits >= m.minCredits && hasRequiredCourse,
      warnings: [
        ...(credits >= m.minCredits && !hasRequiredCourse
          ? [finding('MINOR-01', 'WARN', 'The Mathematics minor also needs Real Analysis I (MATH246) or Abstract Algebra I (MATH346).', { citation: m.note })]
          : []),
        ...(foundation.length
          ? [finding('MINOR-03', 'INFO', 'Not counted in the minor because they are foundation courses, not university-level mathematics: ' + foundation.map(r => r.code).join(', ') + '.', { citation: m.note })]
          : []),
        ...(excluded.length
          ? [finding('MINOR-02', 'INFO', 'Not counted in the minor because they are used as general science or departmental electives: ' + excluded.map(r => r.code).join(', ') + '.', { citation: m.note })]
          : [])
      ],
      label: m.label
    };
  }

  // ---- what they actually did ---------------------------------------------

  // do two lists of weekly meetings overlap?
  function meetingsClash(a, b) {
    for (const m of a || []) {
      for (const n of b || []) {
        if (m.day !== n.day) continue;
        const as = parseTime(m.start), ae = parseTime(m.end);
        const bs = parseTime(n.start), be = parseTime(n.end);
        if (as == null || bs == null || ae == null || be == null) continue;
        if (as < be && bs < ae) return { day: m.day, a: m, b: n };
      }
    }
    return null;
  }

  function courseCampus(course) {
    if (course && course.campus) return String(course.campus);
    const section = String((course && course.section) || '').trim();
    if (/^B\d/i.test(section)) return 'Beirut';
    if (/^D\d/i.test(section)) return 'Debbieh';
    return '';
  }

  // Department advising practice: when consecutive classes are on different
  // campuses, leave at least an hour for travel. This is a warning, not a BAU
  // registration block.
  function campusTravelGaps(courses, minimumMinutes) {
    const out = [], min = minimumMinutes == null ? 60 : minimumMinutes;
    for (let i = 0; i < courses.length; i++) {
      for (let j = i + 1; j < courses.length; j++) {
        const a = courses[i], b = courses[j];
        const ac = courseCampus(a), bc = courseCampus(b);
        if (!ac || !bc || ac === bc) continue;
        for (const am of a.meetings || []) {
          for (const bm of b.meetings || []) {
            if (am.day !== bm.day) continue;
            const as = parseTime(am.start), ae = parseTime(am.end);
            const bs = parseTime(bm.start), be = parseTime(bm.end);
            if ([as, ae, bs, be].some(x => x == null)) continue;
            let gap = null, first = a, second = b;
            if (ae <= bs) gap = bs - ae;
            else if (be <= as) { gap = as - be; first = b; second = a; }
            if (gap != null && gap < min) out.push({ day: am.day, gap, first, second,
              firstCampus: courseCampus(first), secondCampus: courseCampus(second) });
          }
        }
      }
    }
    return out;
  }

  // Courses directly behind this one + when they run. A gate on a spring-only
  // course missed in the fall costs a year, not a semester.
  function blocks(catalog, code) {
    const map = byCode(catalog);
    return Object.keys(map).filter(k => (map[k].pre || []).indexOf(code) >= 0)
      .map(k => ({ code: k, title: map[k].title, runsIn: map[k].runsIn || [] }));
  }

  // how long skipping `code` this term holds up what's behind it
  function delayCost(catalog, code, term) {
    const season = seasonOf(term);
    const next = nextMainTermAfter(term);           // when the course comes round again
    const after = nextMainTermAfter(next);           // and the one after
    const worst = [];
    blocks(catalog, code).forEach(d => {
      if (!d.runsIn.length) return;
      // taken now -> dependent can start next term; taken later -> wait for a
      // term the dependent actually runs in
      const seasonsAhead = [next, after, nextMainTermAfter(after)];
      const firstOpen = seasonsAhead.filter(t => t !== next).find(t => d.runsIn.indexOf(seasonOf(t)) >= 0);
      const couldHave = d.runsIn.indexOf(seasonOf(next)) >= 0 ? next : null;
      if (couldHave && firstOpen && firstOpen !== couldHave) {
        worst.push({ code: d.code, title: d.title, from: couldHave, to: firstOpen });
      }
    });
    return { season, blocks: blocks(catalog, code), delays: worst };
  }

  /* Courses where skipping this term costs a whole year: miss the gate to a
     spring-only course in the fall and it slips to the spring after.
     This is what catches a withdrawal nobody repeated. */
  function yearDelayRisks(rules, catalog, student, term, offering) {
    const snap = snapshot(rules, catalog, student);
    const map = byCode(catalog);
    const registered = new Set(((student.registration || {}).courses || []).map(c => c.code));
    const out = [];
    Object.keys(map).forEach(code => {
      const c = map[code];
      if (nonDegree(catalog).includes(c.bucket)) return;
      if (snap.passed.has(code) || registered.has(code)) return;
      const st = prereqStatus(rules, catalog, code, snap.passed, snap.earned);
      if (!st.ok) return;                               // can't take it anyway
      const open = opensIn(catalog, code, term, offering);
      if (open.state !== 'yes' && open.state !== 'likely') return;
      // Only if they're already behind: sat it without passing (F or W), or the
      // plan had it 2+ semesters ago. Otherwise we'd flag everybody.
      const attempt = snap.best.find(r => r.code === code);
      const attemptedNotPassed = !!attempt && !isPassing(rules, attempt.grade);
      const overdue = c.planSem && c.planSem <= snap.completedSemesters - 1;
      if (!attemptedNotPassed && !overdue) return;
      const cost = delayCost(catalog, code, term);
      // only worth raising if a required course is behind it
      const delays = cost.delays.filter(d => {
        const dc = map[d.code];
        return dc && ['MAJOR_CORE', 'FACULTY_CORE'].includes(dc.bucket)
          && (!dc.planSem || dc.planSem <= snap.completedSemesters + 3);
      });
      if (!delays.length) return;
      out.push({ code, title: c.title, delays, grade: attempt ? attempt.grade : null,
        repeat: attemptedNotPassed });
    });
    return out;
  }

  /* Does a failed course have to be retaken?
     required -> yes, nothing else fills it
     elective -> can swap for another from the same pool (retaking a failed
                 one when another would do can waste a semester)
     other programme, or block already full -> no */
  function repeatKind(rules, catalog, snap, code) {
    const policy = (rules.repeats && rules.repeats['REG-REP-03']) || {};
    const must = policy.mustRepeatBuckets || ['UNIV_MANDATORY', 'FACULTY_CORE', 'MAJOR_CORE', 'REMEDIAL'];
    const may = policy.mayReplaceBuckets || ['UNIV_ELECTIVE', 'DEPT_ELECTIVE', 'GEN_SCI_ELECTIVE'];
    const c = byCode(catalog)[code];
    if (!c) return { kind: 'unknown', label: 'not in the curriculum' };
    // PHYS243 + lab are faculty core like the rest, a fail or W is still owed
    if (must.indexOf(c.bucket) >= 0) return { kind: 'must', bucket: c.bucket, label: 'required course' };
    if (may.indexOf(c.bucket) >= 0) {
      const b = snap.buckets[c.bucket];
      const short = b && (b.earned + (b.inProgress || 0)) < b.required;
      return { kind: short ? 'replace' : 'none', bucket: c.bucket,
        label: short ? 'elective, and the block is still short' : 'elective, and the block is already full',
        blockLabel: b ? b.label : c.bucket };
    }
    return { kind: 'none', bucket: c.bucket, label: 'outside the degree blocks' };
  }

  /* Courses to retake, in the order to take them: open this term first, then
     by how much sits behind it (a fail with 30 credits behind it matters more
     than one that opens nothing). */
  function repeatsDue(rules, catalog, student, term, offering) {
    const snap = snapshot(rules, catalog, student);
    const { scores } = buildUnlockScores(catalog);
    const map = byCode(catalog);
    const later = nextMainTermAfter(term);
    /* Withdrawals count too. A W isn't a fail so it never hit mustRepeat, and
       W-and-never-retaken courses silently dropped off: 60 across the dept,
       PHYS243 among them. If the degree doesn't need it (e.g. an elective
       already covered) it stays off. */
    const withdrawn = g => (rules.withdrawalGrades || ['W', 'AW'])
      .indexOf(String(g || '').trim().toUpperCase()) >= 0;
    return snap.best.filter(r => {
      if (mustRepeat(rules, r.grade)) return true;
      if (!withdrawn(r.grade)) return false;
      return repeatKind(rules, catalog, snap, r.code).kind !== 'none';
    }).map(r => {
      const kind = repeatKind(rules, catalog, snap, r.code);
      const left = withdrawn(r.grade);
      const open = opensIn(catalog, r.code, term, offering);
      const unlocks = scores[r.code] || 0;
      const title = (map[r.code] || {}).title || r.code;
      const behind = catalog.courses.filter(c => (c.pre || []).includes(r.code)).map(c => c.code);
      // a W / AW is a withdrawal, not a fail: say so instead of showing it like a grade
      const tag = r.code + ' (' + (left ? 'withdrawn' : String(r.grade || '').toUpperCase()) + ')';
      // as short as possible: the course, its grade, and what it opens
      let message = tag + (behind.length ? ' · opens ' + behind.slice(0, 3).join(', ') : '');
      let brief = tag;
      // cost of skipping it, in semesters
      const delays = (open.state === 'yes' || open.state === 'likely')
        ? delayCost(catalog, r.code, term).delays : [];
      if (delays.length) {
        const d = delays[0];
        message += ' · skipping it delays ' + d.code + ' a year';
        brief += ', delays ' + d.code + ' a year';
      }
      return { code: r.code, title, grade: r.grade, cr: Number(r.cr) || 0, unlocks, open: open.state,
        kind: kind.kind, kindLabel: kind.label, blockLabel: kind.blockLabel, withdrawn: left,
        runsIn: open.runsIn || [], message, brief, delays, plannedFor: later };
    }).sort((a, b) => {
      const rank = s => (s === 'yes' ? 0 : s === 'likely' ? 1 : s === 'unknown' ? 2 : 3);
      // failed (F) before withdrawn (W / AW)
      const wd = r => (withdrawn(r.grade) ? 1 : 0);
      return wd(a) - wd(b) || rank(a.open) - rank(b.open) || b.unlocks - a.unlocks || a.code.localeCompare(b.code);
    });
  }

  // Checks what they actually registered for this term (from the schedule),
  // not a plan. "Did they register correctly?"
  function checkRegistration(rules, catalog, student, term, offering) {
    const snap = snapshot(rules, catalog, student);
    const map = byCode(catalog);
    const reg = student.registration;
    const out = [];
    if (!reg || !reg.courses || !reg.courses.length) {
      out.push(finding('REG-NONE', 'WARN', 'Not registered for ' + term + ' yet.',
        { citation: 'Registration list', action: 'contact' }));
      return { findings: out, credits: 0, registered: [], limits: loadLimits(rules, snap, term), ok: false };
    }
    const courses = reg.courses.slice();
    const credits = courses.reduce((n, c) => n + (Number(c.cr) || 0), 0);
    const limits = loadLimits(rules, snap, term);
    const passedBefore = new Set(snap.passed);

    // load
    if (credits > limits.max) {
      out.push(finding('REG-LOAD', 'BLOCK', 'Registered for ' + credits + ' credits. The limit is ' + limits.max + '. ' + limits.why,
        { citation: limits.ruleId }));
    } else if (credits < limits.min && !/SUMMER/i.test(term)) {
      out.push(finding('REG-LOAD-LOW', 'WARN', 'Registered for ' + credits + ' credits, under the ' + limits.min + '-credit minimum.',
        { citation: limits.ruleId }));
    }

    // per course
    courses.forEach(c => {
      const meta = map[c.code];
      if (!meta) {
        out.push(finding('REG-UNKNOWN', 'INFO', c.code + ' is not part of the Computer Science curriculum.',
          { course: c.code, citation: 'Catalogue' }));
        return;
      }
      if (passedBefore.has(c.code)) {
        const prev = snap.best.find(r => r.code === c.code);
        const grade = prev ? prev.grade : '';
        if (mustRepeat(rules, grade)) return; // required repeat, fine
        out.push(finding('REG-REPEAT', 'WARN', c.code + ' was already passed with ' + grade + '. Repeating it only raises the grade, it does not add credits.',
          { course: c.code, citation: 'R&R VI' }));
      }
      const st = prereqStatus(rules, catalog, c.code, passedBefore, snap.earned);
      if (st.shortBy) {
        out.push(finding('REG-CREDITS', 'WARN',
          c.code + ' is normally taken with at least ' + st.minCredits + ' credits completed. This student has ' + snap.earned + '.',
          { course: c.code, citation: (map[c.code] || {}).minCreditsNote || 'Study plan' }));
      }
      if (!st.ok && st.missing.length) {
        const also = st.missing.filter(m => courses.some(x => x.code === m));
        out.push(finding('REG-PREQ', 'BLOCK',
          c.code + ' needs ' + st.missing.join(' and ') + ' first' + (also.length ? ' (taking it in the same semester does not count)' : '') + '.',
          { course: c.code, citation: rules.sequencing['REG-PREQ-01'].citation }));
      }
      (meta.co || []).forEach(co => {
        if (!passedBefore.has(co) && !courses.some(x => x.code === co)) {
          out.push(finding('REG-COREQ', 'WARN', c.code + ' should be taken together with ' + co + '.',
            { course: c.code, citation: rules.sequencing['REG-PREQ-02'].citation }));
        }
      });
    });

    // timetable
    for (let i = 0; i < courses.length; i++) {
      for (let j = i + 1; j < courses.length; j++) {
        const cl = meetingsClash(courses[i].meetings, courses[j].meetings);
        if (cl) {
          out.push(finding('REG-CLASH', 'BLOCK',
            courses[i].code + ' and ' + courses[j].code + ' overlap on ' + cl.day + ' at ' + cl.a.start + '.',
            { course: courses[i].code, citation: 'Timetable' }));
        }
      }
    }
    const travelMinutes = ((rules.sequencing || {})['REG-PREQ-11'] || {}).minimumCampusTravelMinutes || 60;
    campusTravelGaps(courses, travelMinutes).filter(() => !((rules.sequencing || {})['REG-PREQ-11'] || {}).off).forEach(g => {
      out.push(finding('REG-CAMPUS-GAP', 'WARN',
        g.first.code + ' in ' + g.firstCampus + ' and ' + g.second.code + ' in ' + g.secondCampus
          + ' are only ' + g.gap + ' minutes apart on ' + g.day + '. Leave at least ' + travelMinutes + ' minutes for travel.',
        { course: g.first.code, citation: 'Department advising practice' }));
    });

    // D-/F has to be retaken. Flag it if it's missing from this registration,
    // but only when it actually opens this term. A spring course can't be
    // registered in the fall, and that kind of noise buries the real cases.
    repeatsDue(rules, catalog, student, term, offering).forEach(r => {
      if (courses.some(c => c.code === r.code)) return;
      if (r.kind === 'none') {
        out.push(finding('REG-REPEAT-NONE', 'INFO', r.message, { course: r.code, citation: 'R&R VI', brief: r.brief, withdrawn: r.withdrawn }));
      } else if (r.kind === 'replace') {
        out.push(finding('REG-REPEAT-CHOICE', 'INFO', r.message, { course: r.code, citation: 'R&R VI', brief: r.brief, withdrawn: r.withdrawn }));
      } else if (r.open === 'yes' || r.open === 'likely') {
        out.push(finding('REG-REPEAT-DUE', 'WARN', r.message,
          { course: r.code, citation: 'R&R VI', unlocks: r.unlocks, brief: r.brief, withdrawn: r.withdrawn,
            fix: { action: 'Add', courses: [r.code] } }));
      } else {
        out.push(finding('REG-REPEAT-LATER', 'INFO', r.message,
          { course: r.code, citation: 'R&R VI', unlocks: r.unlocks, brief: r.brief, withdrawn: r.withdrawn }));
      }
    });

    // Is the registration moving the degree forward? Offering is passed in so a
    // spring course never shows as "should have registered" in the fall.
    const needed = recommend(rules, catalog, student, term, offering).recommendations
      .filter(r => {
        const o = opensIn(catalog, r.code, term, offering);
        return o.state !== 'no' && o.state !== 'unlikely';
      }).map(r => r.code);
    const top = new Set(needed.slice(0, 8));
    const notNeeded = courses.filter(c => {
      const meta = map[c.code];
      if (!meta) return false;
      if (nonDegree(catalog).includes(meta.bucket)) return false;
      if (passedBefore.has(c.code)) return false;
      const b = snap.buckets[meta.bucket];
      return b && b.earned >= b.required;
    });
    notNeeded.forEach(c => {
      const meta = map[c.code];
      out.push(finding('REG-NOT-NEEDED', 'WARN',
        c.code + ' does not fill anything that is still missing. The ' + (catalog.buckets[meta.bucket] || {}).label + ' block is already complete.',
        { course: c.code, citation: 'Study plan' }));
    });
    const missedPriority = needed.slice(0, 3).filter(code => !courses.some(c => c.code === code)
      && ['MAJOR_CORE', 'FACULTY_CORE'].includes((map[code] || {}).bucket));
    if (missedPriority.length && courses.length) {
      const withUnlocks = missedPriority.map(code => {
        const n = buildUnlockScores(catalog).scores[code] || 0;
        return code + (n ? ' (opens ' + n + ' credits)' : '');
      });
      out.push(finding('REG-PRIORITY', 'INFO',
        'Open this semester and worth more than what is registered: ' + withUnlocks.join(', ') + '.',
        { citation: 'Study plan', fix: { action: 'Consider instead', courses: missedPriority } }));
    }

    return {
      findings: out,
      credits,
      limits,
      registered: courses,
      ok: !out.some(f => f.severity === 'BLOCK')
    };
  }

  // Everything the advisor should see for one student, most urgent first.
  // Drives the alerts list and the status chip.
  function alerts(rules, catalog, student, term, offering) {
    const snap = snapshot(rules, catalog, student);
    const out = [];
    // brief = one-liner for the multi-student list, detail = full sentence
    // for the student page
    const push = (level, kind, title, detail, brief) =>
      out.push({ level, kind, title, detail, brief: brief || detail, student: student.id });

    // Remedial: list the courses to retake so the advisor doesn't have to dig
    // through the transcript. Worst grade first, that's where the CGPA moves most.
    if (snap.standing.remedial) {
      const low = (rules.remedialGrades || ['F', 'D-', 'D']);
      const again = snap.best
        .filter(r => low.indexOf(String(r.grade || '').trim().toUpperCase()) >= 0)
        .filter(r => repeatKind(rules, catalog, snap, r.code).kind !== 'none')
        .sort((a, b) => (gradePoint(rules, a.grade) || 0) - (gradePoint(rules, b.grade) || 0));
      const names = again.slice(0, 6).map(r => r.code + ' (' + r.grade + ')').join(', ');
      const run = snap.standing.probationRun || 1;
      push('urgent', 'standing', 'Remedial stage',
        'Max ' + snap.standing.loadCap + ' credits' + (again.length ? ' · retake ' + names + (again.length > 6 ? ' +' + (again.length - 6) : '') : ''),
        'remedial, ' + snap.standing.loadCap + ' credits, retake ' + (again.length || 'nothing'));
    }
    if (snap.standing.state === 'DISMISSAL_RISK') push('urgent', 'standing', 'At risk of dismissal', 'CGPA ' + snap.cgpa.toFixed(2) + ' · max ' + (snap.standing.loadCap || 12) + ' credits');
    else if (snap.standing.state === 'PROBATION') push('urgent', 'standing', 'On probation', 'Max ' + (snap.standing.loadCap || 12) + ' credits');
    else if (snap.standing.state === 'LOAD_CAPPED') push('watch', 'standing', 'Load capped this term', snap.standing.reason);
    if (snap.cgpa != null && snap.cgpa < rules.graduation.minCgpa && snap.terms.length >= 2
        && snap.standing.state === 'GOOD_STANDING') {
      push(snap.cgpa < rules.probation.dismissCgpaBelow ? 'urgent' : 'watch', 'gpa', 'CGPA below 2.00',
        'CGPA ' + snap.cgpa.toFixed(2) + ' · 2.00 needed to graduate');
    }

    // titles read as reasons when listed together
    const TITLES = {
      'REG-LOAD': 'Over the credit limit', 'REG-LOAD-LOW': 'Under the credit minimum',
      'REG-PREQ': 'Prerequisite missing', 'REG-COREQ': 'Co-requisite missing',
      'REG-CLASH': 'Two courses clash', 'REG-REPEAT': 'Already passed',
      'REG-REPEAT-DUE': 'Retake missing', 'REG-REPEAT-LATER': 'Retake next term',
      'REG-REPEAT-CHOICE': 'Failed elective', 'REG-REPEAT-NONE': 'Failed elective, covered',
      'REG-NOT-NEEDED': 'Course not needed',
    };
    // same findings for a withdrawn course (W / AW): not a fail, still to take
    const WD_TITLES = {
      'REG-REPEAT-DUE': 'Withdrawn course, take it now', 'REG-REPEAT-LATER': 'Withdrawn course, next term',
      'REG-REPEAT-CHOICE': 'Withdrawn elective', 'REG-REPEAT-NONE': 'Withdrawn elective, covered'
    };
    Object.assign(TITLES, {
      'REG-CREDITS': 'Taken too early', 'REG-UNKNOWN': 'Outside the curriculum',
      'REG-PRIORITY': 'Something more useful is available',
      'REG-CAMPUS-GAP': 'Not enough travel time'
    });
    const titleOf = f => (f.withdrawn && WD_TITLES[f.ruleId]) || TITLES[f.ruleId];
    const reg = checkRegistration(rules, catalog, student, term, offering);
    if (!student.registration) {
      // Studied last term -> probably just forgot to register. Not seen for a
      // year -> may have left, different job.
      const last = snap.terms.length ? snap.terms[snap.terms.length - 1].term : null;
      const lastWasRecent = last && nextMainTermAfter(last) === term;
      push('urgent', 'registration', 'Not registered',
        last && !lastWasRecent ? 'Last record ' + last : '',
        'no courses for ' + term + (last && !lastWasRecent ? ', last record ' + last : ''));
    } else {
      reg.findings.filter(f => f.severity === 'BLOCK').forEach(f =>
        push('urgent', 'registration', titleOf(f) || 'Registration problem', f.message, f.brief));
      reg.findings.filter(f => f.severity === 'WARN').forEach(f =>
        push('watch', 'registration', titleOf(f) || 'Worth checking', f.message, f.brief));
      reg.findings.filter(f => f.severity === 'INFO' && /^REG-REPEAT/.test(f.ruleId)).forEach(f =>
        push('info', 'registration', titleOf(f) || 'Repeat', f.message, f.brief));
    }

    // Repeats, only for students with no registration (checkRegistration
    // already covers the rest). Can't be taken until next term = just a note.
    if (!student.registration) {
      repeatsDue(rules, catalog, student, term, offering).forEach(r => {
        const open = r.open === 'yes' || r.open === 'likely';
        const level = r.kind === 'must' ? (open ? 'watch' : 'info') : 'info';
        const title = r.withdrawn
          ? (r.kind === 'none' ? 'Withdrawn elective, covered' : r.kind === 'replace' ? 'Withdrawn elective'
            : open ? 'Withdrawn course, take it now' : 'Withdrawn course, next term')
          : r.kind === 'none' ? 'Failed elective, covered'
          : r.kind === 'replace' ? 'Failed elective'
          : open ? 'Retake now' : 'Retake next term';
        push(level, 'repeat', title, r.message, r.brief);
      });
    }

    // university requirements
    // WRN: required for students admitted from 2024/2025 on. Only raise it
    // near the credit threshold, it's in their requirements list anyway.
    const wrn = rules.universityElectives['REG-UE-05'];
    const wrnRegistered = student.registration && student.registration.courses.some(c => c.code === wrn.code);
    if (!snap.passed.has(wrn.code) && !wrnRegistered && wrnlRequired(rules, catalog, student)) {
      // Missing WRNL200 is a contract item, only a real problem when there's
      // no room left before graduation.
      const creditsLeft = rules.graduation.totalCredits - snap.earned;
      if (creditsLeft <= 12) {
        push('watch', 'requirement', 'WRNL200 missing', creditsLeft + ' credits left');
      } else if (snap.earned >= wrn.warnAtEarnedCredits) {
        push('info', 'requirement', 'Plan WRNL200', 'Required for students admitted from ' + admitLabel(wrn) + ' on');
      }
    }

    // failed or overdue courses where skipping again costs a year
    const repeatCodes = new Set(repeatsDue(rules, catalog, student, term, offering).map(r => r.code));
    yearDelayRisks(rules, catalog, student, term, offering).forEach(r => {
      if (repeatCodes.has(r.code)) return;
      const d = r.delays[0];
      const how = r.grade ? 'was graded ' + r.grade + ' and has not been taken since' : 'has not been taken yet';
      push(r.repeat ? 'watch' : 'info', 'delay', 'Take ' + r.code + ' now',
        'Skipping it delays ' + d.code + ' a year',
        r.code + ' is open now; skipping it pushes ' + d.code + ' back a year');
    });

    if (!snap.ic3 && snap.completedSemesters >= rules.nonCredit['REG-UE-06'].dueBySemester) {
      // no credits, can be sat anytime, so just a reminder until it's late
      const late = snap.completedSemesters >= rules.nonCredit['REG-UE-06'].dueBySemester + 2;
      push(late ? 'watch' : 'info', 'requirement', 'IC3 missing',
        'Due by semester ' + rules.nonCredit['REG-UE-06'].dueBySemester,
        'due by semester ' + rules.nonCredit['REG-UE-06'].dueBySemester + ', now in semester ' + (snap.completedSemesters + 1));
    }

    const ueb = snap.buckets.UNIV_ELECTIVE;
    if (ueb && ueb.earned >= ueb.required * 0.5) {
      if (!ueb.hasHumanities) push('info', 'requirement', 'Humanities elective missing', '');
      if (!ueb.hasSocial) push('info', 'requirement', 'Social science elective missing', 'SOCI or PSYC');
    }

    // close to graduating
    const audit = graduationAudit(rules, catalog, student);
    // two lanes only: act now, plan ahead. "Good to know" items are things
    // to plan for, so they join plan ahead.
    out.forEach(a => { if (a.level === 'info') a.level = 'watch'; });
    return out;
  }

  // ---- planning the next term ---------------------------------------------

  /* What to take next term. Like recommend(), but current courses are assumed
     passed (they will be by the time registration opens). Already registered
     courses are left out, track courses get pulled up. */
  function planNextTerm(rules, catalog, student, term, offering) {
    const snap = snapshot(rules, catalog, student);
    const map = byCode(catalog);
    const shadow = Object.assign({}, student, {
      history: (student.history || []).concat(
        Array.from(snap.inProgress).map(code => ({
          code, cr: (map[code] || {}).cr || 0, grade: 'C', term: 'ASSUMED ' + term, flag: ''
        })))
    });
    // only the planned term's offering counts, this term's says nothing about next
    const forTerm = (offering || []).filter(x => x.term === term);
    const out = recommend(rules, catalog, shadow, term, forTerm.length ? forTerm : null);
    out.hasOfferingForTerm = forTerm.length > 0;
    const season = seasonOf(term);
    const track = snap.likelyTrack ? catalog.tracks[snap.likelyTrack] : null;
    out.recommendations = out.recommendations.filter(r => !snap.inProgress.has(r.code));
    out.recommendations.forEach(r => {
      if (snap.inProgress.size && (map[r.code] || { pre: [] }).pre.some(p => snap.inProgress.has(p))) {
        r.reasons = r.reasons.concat(['Opens up once this term\'s courses are passed']);
        r.afterThisTerm = true;
      }
      if (track && (map[r.code] || {}).bucket === 'DEPT_ELECTIVE') {
        r.inTrack = track.courses.indexOf(r.code) >= 0;
      }
      // no offering yet -> go by the study plan: sem 1/3/5 Fall, 2/4/6 Spring
      const meta = map[r.code] || {};
      if (!out.hasOfferingForTerm && season && meta.studyPlanSeason) {
        if (meta.studyPlanSeason === season) {
          r.season = 'match';
          r.score += 260;
          
        } else if (meta.alsoRunsIn === season) {
          r.season = 'repeat';
          r.score += 40;
          r.reasons = r.reasons.concat(['Normally a ' + meta.studyPlanSeason.toLowerCase() + ' course, but it also runs in ' + season.toLowerCase()]);
        } else {
          r.season = 'off';
          r.score -= 220;
          r.reasons = r.reasons.concat(['The study plan puts this in ' + meta.studyPlanSeason.toLowerCase() + ', so check the offering when it comes out']);
        }
      }
    });
    out.recommendations.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
    out.assumedPassing = Array.from(snap.inProgress);
    out.track = track ? Object.assign({ key: snap.likelyTrack }, track) : null;
    out.term = term;
    out.season = season;
    return out;
  }

  // Advisor's trial basket. Same rules as a registration, but checked against
  // what they'll have passed by then, plus campus of each section.
  function checkPlan(rules, catalog, student, picks, term, offering) {
    const snap = snapshot(rules, catalog, student);
    const map = byCode(catalog);
    const out = [];
    const basis = snap.afterThisTerm;
    const credits = picks.reduce((n, p) => n + (Number(p.cr) || (map[p.code] || {}).cr || 0), 0);
    const limits = loadLimits(rules, snap, term);

    if (credits > limits.max) {
      out.push(finding('PLAN-LOAD', 'BLOCK', credits + ' credits is over the ' + limits.max + ' credit limit. ' + limits.why,
        { citation: limits.ruleId }));
    } else if (credits && credits < limits.min && !/SUMMER/i.test(term)) {
      out.push(finding('PLAN-LOAD-LOW', 'WARN', credits + ' credits is under the ' + limits.min + ' credit minimum.',
        { citation: limits.ruleId }));
    }

    const seen = {};
    picks.forEach(p => {
      if (seen[p.code]) out.push(finding('PLAN-DUP', 'BLOCK', p.code + ' is in the plan twice.', { course: p.code }));
      seen[p.code] = true;
      const meta = map[p.code];
      if (!meta) { out.push(finding('PLAN-UNKNOWN', 'INFO', p.code + ' is not in the Computer Science curriculum.', { course: p.code })); return; }
      if (snap.passed.has(p.code)) {
        const prev = snap.best.find(r => r.code === p.code);
        if (!mustRepeat(rules, prev && prev.grade)) {
          out.push(finding('PLAN-PASSED', 'WARN', p.code + ' is already passed with ' + (prev ? prev.grade : '') + '. Taking it again raises the grade but adds no credits.', { course: p.code }));
        }
      }
      if (snap.inProgress.has(p.code)) {
        out.push(finding('PLAN-CURRENT', 'WARN', p.code + ' is being taken right now. Only add it again if this term is going badly.', { course: p.code }));
      }
      if (meta.minCredits && snap.earned < meta.minCredits) {
        out.push(finding('PLAN-CREDITS', 'WARN',
          p.code + ' is normally taken with at least ' + meta.minCredits + ' credits completed, and this student has ' + snap.earned + '.',
          { course: p.code, citation: meta.minCreditsNote || 'Study plan' }));
      }
      const missingEvenWithPlan = (meta.pre || []).filter(c => !basis.has(c));
      if (missingEvenWithPlan.length) {
        const inPlan = missingEvenWithPlan.filter(c => picks.some(x => x.code === c));
        out.push(finding('PLAN-PREQ', 'BLOCK',
          p.code + ' needs ' + missingEvenWithPlan.join(' and ') + ' first' + (inPlan.length ? ', and a prerequisite in the same semester does not count' : '') + '.',
          { course: p.code, citation: rules.sequencing['REG-PREQ-01'].citation }));
      }
      (meta.co || []).forEach(co => {
        if (!basis.has(co) && !picks.some(x => x.code === co)) {
          out.push(finding('PLAN-COREQ', 'WARN', p.code + ' should be taken together with ' + co + '.', { course: p.code }));
        }
      });
    });

    for (let i = 0; i < picks.length; i++) {
      for (let j = i + 1; j < picks.length; j++) {
        const cl = meetingsClash(picks[i].meetings, picks[j].meetings);
        if (cl) {
          out.push(finding('PLAN-CLASH', 'BLOCK',
            picks[i].code + ' ' + (picks[i].section || '') + ' and ' + picks[j].code + ' ' + (picks[j].section || '') +
            ' overlap on ' + cl.day + ', ' + cl.a.start + ' to ' + cl.a.end + '.',
            { course: picks[i].code, citation: 'Timetable' }));
        }
      }
    }

    const travelMinutes = ((rules.sequencing || {})['REG-PREQ-11'] || {}).minimumCampusTravelMinutes || 60;
    const shortCampusGaps = ((rules.sequencing || {})['REG-PREQ-11'] || {}).off ? [] : campusTravelGaps(picks, travelMinutes);
    shortCampusGaps.forEach(g => {
      out.push(finding('PLAN-CAMPUS-GAP', 'WARN',
        g.first.code + ' in ' + g.firstCampus + ' and ' + g.second.code + ' in ' + g.secondCampus
          + ' are only ' + g.gap + ' minutes apart on ' + g.day + '. Leave at least ' + travelMinutes + ' minutes for travel.',
        { course: g.first.code, citation: 'Department advising practice' }));
    });

    // Using both campuses in one week is normal and not reported; timetable
    // overlaps and short travel gaps are caught above.

    // does the plan move the degree forward / leave next term empty?
    const bucketsHit = {};
    picks.forEach(p => {
      const b = (map[p.code] || {}).bucket;
      if (b) bucketsHit[b] = (bucketsHit[b] || 0) + (Number(p.cr) || 0);
    });
    const look = lookAhead(rules, catalog, Object.assign({}, student, {
      history: (student.history || []).concat(Array.from(snap.inProgress).map(code =>
        ({ code, cr: (map[code] || {}).cr || 0, grade: 'C', term: 'ASSUMED' })))
    }), picks.map(p => p.code), offering, term);

    return { findings: out, credits, limits, picks, bucketsHit, lookAhead: look,
             ok: !out.some(f => f.severity === 'BLOCK') };
  }

  // one-word status for the list view
  function statusOf(rules, catalog, student, term, offering) {
    const a = alerts(rules, catalog, student, term, offering);
    if (a.some(x => x.level === 'urgent')) return 'urgent';
    if (a.some(x => x.level === 'watch')) return 'watch';
    return 'ok';
  }

  // ---- student BAU email ---------------------------------------------------
  /* Guessed from name + ID when the record has no address:
       "Sami Ali Haddad", 202300123 -> sah012@student.bau.edu.lb
     3 initials + 3 digits (usually the last 4 digits of the ID without the
     final one). The convention is not applied consistently, so the result is
     marked as a guess and never overwrites a real address. Using the first
     three words of the name matched 88% of known addresses. Particles (Al, El,
     Abu...) only count when a name has too few words. */
  const NAME_PARTICLE = /^(el|al|abu|abou|bu|bou|abd|abed|abdel|abdul|ben|bin|ibn|de|da|van|von)$/;

  function nameWords(fullName) {
    // "Al-Jamal" == "Al Jamal"
    return String(fullName || '')
      .replace(/[-']/g, ' ')
      .split(/\s+/)
      .map(w => w.replace(/[^A-Za-z]/g, ''))
      .filter(Boolean);
  }

  function nameInitials(fullName) {
    const w = nameWords(fullName);
    if (w.length < 2) return null;
    if (w.length >= 3) return w.slice(0, 3).map(x => x[0].toLowerCase()).join('');
    // two words only: skip particles, "Rana Haddad" -> r-r-h
    const names = w.filter((x, i) => !(NAME_PARTICLE.test(x.toLowerCase()) && w[i + 1]));
    const first = names[0] || w[0], last = names[names.length - 1] || w[w.length - 1];
    return (first[0] + first[0] + last[0]).toLowerCase();
  }

  // just the digits part
  function idDigits(id) {
    const d = String(id || '').replace(/\D/g, '');
    return d.length >= 4 ? d.slice(-4, -1) : null;
  }

  function bauEmail(fullName, id, domain) {
    const digits = idDigits(id);
    const initials = nameInitials(fullName);
    if (!initials || !digits) return null;
    return initials + digits + '@' + (domain || 'student.bau.edu.lb');
  }

  /* Only fills a missing address, never edits one.
     An older version corrected digits that didn't match the ID. Address on
     file wins; a built one is marked guessed so the UI can show it as a guess.
     Returns { email, guessed }. */
  function fixEmail(fullName, id, existing) {
    const have = String(existing || '').trim().toLowerCase();
    if (have) return { email: have, guessed: false };
    const made = bauEmail(fullName, id);
    return made ? { email: made, guessed: true } : { email: '', guessed: false };
  }

  return {
    bauEmail, fixEmail, nameInitials, idDigits, calendarNow,
    byCode, gradePoint, isPassing, mustRepeat, computeGpa, bestAttempts, passedSet,
    buildUnlockScores, prereqStatus, snapshot, computeStanding, loadLimits,
    validateBasket, detectClashes, recommend, lookAhead, graduationAudit, minorAudit,
    checkRegistration, alerts, statusOf, meetingsClash, nonDegree,
    planNextTerm, checkPlan, seasonOf, nextTermAfter, nextMainTermAfter, blocks, delayCost, yearDelayRisks,
    opensIn, seasonWord, repeatsDue,
    round2, ueCategory, intensiveLevel, intensiveBlocks, admitYear, wrnlRequired
  };
});
