/*
 * pdfimport.js - reads BAU's transcript and schedule PDFs in the browser.
 *   transcripts: 3-column grid, each column goes term by term
 *   schedules:   one student per page, times under day columns
 * Parsed by x/y position since rows from neighbouring columns get interleaved.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PdfImport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CODE = /^[A-Z]{3,4}\d{3}[A-Z]?$/;

  // ---- Arabic names -------------------------------------------------------

  /* The PDF stores Arabic as presentation-form glyphs in visual (RTL) order,
     so a raw read is backwards and unsearchable. Reverse + NFKC fixes it:
       ﻢﻴﻤﺗ ﻰﻔﻄﺼﻣ ﻒﻴﻔﻋ   ->   عفيف مصطفى تميم
     Normal Arabic text is left alone. */
  const PRESENTATION = /[\uFB50-\uFDFF\uFE70-\uFEFF]/;
  function arabicText(t) {
    const str = String(t || '');
    if (!PRESENTATION.test(str)) {
      // plain letters, but maybe still in visual order: keep the reading that looks like a name
      const flat = str.normalize('NFKC').replace(/\s+/g, ' ').trim();
      const flipped = Array.from(flat).reverse().join('');
      const score = x => x.split(' ').reduce((n, w) => n + (/^ال/.test(w) ? 1 : 0) + (/^(محمد|احمد|أحمد|علي|عبد|حسن|حسين|ابو|أبو|محمود|خالد|عمر)$/.test(w) ? 2 : 0), 0);
      return score(flipped) > score(flat) ? flipped : flat;
    }
    return Array.from(str).reverse().join('').normalize('NFKC').replace(/\s+/g, ' ').trim();
  }
  // "FALL 2025 / 2026", "Fall 2025/2026", "Fall Semester 2025-2026", "FALL 2025/26"
  const TERM = /^(FALL|SPRING|SUMMER|WINTER)(?:\s+SEMESTER)?\s*:?\s*(\d{4})\s*[\/-]\s*(\d{2,4})\b/i;
  const termOf = m => {
    const y1 = m[2], y2 = m[3].length === 2 ? m[2].slice(0, 2) + m[3] : m[3];
    return m[1].toUpperCase() + ' ' + y1 + '/' + y2;
  };
  const TRANSFER = /BACCALAUREATE|EQV|TRANSFER/i;
  // INT0 = course carried over on an internal transfer between BAU programmes
  const GRADE = /^(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F|P|TR|W|AW|I|INC|NP|EX|AU|INT0)$/;
  const FLAGS = ['A', 'I', 'N'];
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const SHORT = { Monday: 'MON', Tuesday: 'TUE', Wednesday: 'WED', Thursday: 'THU', Friday: 'FRI', Saturday: 'SAT', Sunday: 'SUN' };

  // ---- pdf.js adapter -----------------------------------------------------
  // pdf.js gives text runs (not words) with y pointing up. Split on spaces and
  // spread x by char count so the column maths matches the reference parser.
  function wordsFromContent(content, viewport) {
    const out = [];
    content.items.forEach(item => {
      const str = item.str;
      if (!str || !str.trim()) return;
      // Skip the big grey "This is not an official transcript" watermark, it
      // splits course rows. Real text is 6-10pt, so anything taller goes.
      if ((item.height || Math.abs(item.transform[3]) || 0) > 30) return;
      const x = item.transform[4];
      const yUp = item.transform[5];
      const top = viewport.height - yUp - (item.height || 10);
      const total = str.length || 1;
      const perChar = (item.width || 0) / total;
      let i = 0;
      str.split(/(\s+)/).forEach(part => {
        if (part.trim()) {
          out.push({ text: part, x: x + i * perChar, y: top, w: part.length * perChar });
        }
        i += part.length;
      });
    });
    return out.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  async function pagesOf(arrayBuffer, onProgress) {
    if (typeof pdfjsLib === 'undefined') throw new Error('The PDF reader did not load. Check the connection and reload.');
    // isEvalSupported: false blocks the font-code path abused by CVE-2024-4367
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({ width: viewport.width, height: viewport.height, words: wordsFromContent(content, viewport) });
      if (onProgress) onProgress(n, pdf.numPages);
    }
    return pages;
  }

  // ---- shared geometry ----------------------------------------------------
  function rows(words, tol) {
    const out = [];
    words.slice().sort((a, b) => a.y - b.y || a.x - b.x).forEach(w => {
      const r = out.find(r => Math.abs(r.y - w.y) <= (tol || 3));
      if (r) r.words.push(w);
      else out.push({ y: w.y, words: [w] });
    });
    out.forEach(r => r.words.sort((a, b) => a.x - b.x));
    return out.sort((a, b) => a.y - b.y);
  }

  const txt = ws => ws.map(w => w.text).join(' ');

  // ---- transcripts --------------------------------------------------------
  function columnBounds(rs) {
    for (const r of rs) {
      // "Code" = old layout, "CODE" = new layout
      const starts = r.words.filter(w => w.text === 'Code' || w.text === 'CODE').map(w => w.x).sort((a, b) => a - b);
      if (starts.length >= 2) {
        // tight cut: a column's repeat flag sits just left of the next code
        const edges = [0].concat(starts.slice(1).map(s => s - 13)).concat([1e6]);
        return starts.map((_, i) => [edges[i], edges[i + 1]]);
      }
    }
    return [[0, 1e6]];
  }

  function splitCells(row, bounds) {
    const cells = bounds.map(() => []);
    row.words.forEach(w => {
      for (let i = 0; i < bounds.length; i++) {
        if (w.x >= bounds[i][0] && w.x < bounds[i][1]) { cells[i].push(w); break; }
      }
    });
    // lone capital at the start of a cell = previous column's flag
    for (let i = cells.length - 1; i > 0; i--) {
      while (cells[i].length && cells[i][0].text.length === 1 && FLAGS.includes(cells[i][0].text) && cells[i - 1].length) {
        cells[i - 1].push(cells[i].shift());
      }
    }
    return cells;
  }

  function parseCourse(tokens) {
    if (!tokens.length || !CODE.test(tokens[0])) return null;
    const code = tokens[0];
    const rest = tokens.slice(1);
    let i = rest.length - 1, flag = '', earned = null, grade = '', cr = null;
    if (i >= 0 && rest[i].length === 1 && FLAGS.includes(rest[i]) && !GRADE.test(rest[i])) { flag = rest[i]; i--; }
    else if (i >= 0 && FLAGS.includes(rest[i])) { flag = rest[i]; i--; }
    if (i >= 0 && /^\d+(\.\d+)?$/.test(rest[i])) { earned = parseFloat(rest[i]); i--; }
    if (i >= 0 && GRADE.test(rest[i])) { grade = rest[i]; i--; }
    if (i >= 0 && /^\d+(\.\d+)?$/.test(rest[i])) { cr = parseFloat(rest[i]); i--; }
    if (cr === null && !grade) return null;
    return { code, title: rest.slice(0, i + 1).join(' ').trim(), cr: cr === null ? 0 : cr,
             grade, earned: earned === null ? 0 : earned, flag };
  }

  function parseTotals(s) {
    const att = /Att\.Cr\.\s+([\d.]+)/.exec(s);
    // old layout: "Earnd Cr." / "Sem GPA", new: "ERN" / "SGPA"
    const earn = /Earnd\s+Cr\.\s+([\d.]+)/.exec(s) || /\bERN\s+([\d.]+)/.exec(s);
    const gpa = /Sem\s+GPA\s+([\d.]+)/.exec(s) || /\bSGPA\s+([\d.]+)/.exec(s);
    return { attempted: att ? +att[1] : 0, earned: earn ? +earn[1] : 0, gpa: gpa ? +gpa[1] : null };
  }

  function transcriptPage(page) {
    const rs = rows(page.words, 3);
    const bounds = columnBounds(rs);
    const head = {};
    let bodyStart = 0;
    rs.forEach((r, idx) => {
      const line = txt(r.words);
      if (line.indexOf('Name:') >= 0) {
        const m = /Name:\s+(.*?)\s*(?:[\u0600-\u06FF\uFB50-\uFEFF][^]*?)?\s*Nationality:\s*(\S+)/.exec(line);
        if (m) { head.name = m[1].trim(); head.nationality = m[2]; }
        // newer layout: "Name: <full name> Campus: Beirut ..."
        const n = !m && /Name:\s+(.*?)\s+Campus:\s*(\S+)/.exec(line);
        if (n) { head.name = n[1].trim(); head.campus = n[2]; }
        head.arabName = arabicText(r.words.filter(w => /[\u0600-\u06FF\uFB50-\uFEFF]/.test(w.text)).map(w => w.text).join(' '));
      }
      // Rest of the new header, kept as printed. note: Degree is the one being
      // studied for. Graduation Term is what shows it was actually awarded.
      if (line.indexOf('Nationality:') === 0) {
        const m = /Nationality:\s*(\S+)/.exec(line);
        if (m) head.nationality = m[1];
        const pr = /Program:\s*(.*?)\s+Graduation\s+Term:\s*(.*)$/.exec(line);
        if (pr) { head.programName = pr[1].trim(); head.graduationTerm = pr[2].trim(); }
      }
      if (line.indexOf('Faculty:') >= 0 && !/Faculty\s+of:/.test(line)) {
        const f = /Faculty:\s*(.*?)\s+Admission/.exec(line);
        if (f) head.facultyName = f[1].trim();
        const a = /Admission\s+Term:\s*(\w+)\s+(\d{4})\s*[\/-]\s*(\d{2,4})/i.exec(line);
        if (a) {
          const y2 = a[3].length === 2 ? a[2].slice(0, 2) + a[3] : a[3];
          head.admission = a[2] + '/' + a[3];
          // the season matters for the semester number (a spring intake is a term behind)
          if (/^(FALL|SPRING|SUMMER|WINTER)$/i.test(a[1])) head.admissionTerm = a[1].toUpperCase() + ' ' + a[2] + '/' + y2;
        }
      }
      if (line.indexOf('Degree:') >= 0) {
        const d = /Degree:\s*(.*?)\s+CGPA:/.exec(line);
        if (d) head.degree = d[1].trim();
        const g = /CGPA:\s*([\d.]+)/.exec(line);
        if (g && !isNaN(parseFloat(g[1]))) head.cgpa = parseFloat(g[1]);
      }
      if (/\bID\b/i.test(line) && /\d{9}/.test(line)) {
        const m = /ID\s*(?:No\.?|Number)?\s*:?\s*(\d{9})/i.exec(line);
        if (m) head.id = m[1];
        const f = /Faculty\s+of:\s*(.*?)\s+Bachelor/.exec(line);
        if (f) head.faculty = f[1].trim();
      }
      if (line.indexOf('Admission') >= 0 && line.indexOf('Year:') >= 0) {
        const m = /Year:\s*(\d{4})\s*\/\s*(\d{4})/.exec(line);
        if (m) head.admission = m[1] + '/' + m[2];
      }
      if (r.words.some(w => w.text === 'Code' || w.text === 'CODE')) bodyStart = idx + 1;
    });
    // Fallbacks for layouts that word the header differently ("ID 202603294",
    // "Student No.", "Student Name:"): take the first BAU-style ID in the header.
    if (!head.id) {
      for (const r of rs.slice(0, Math.max(bodyStart, 12))) {
        const w = r.words.find(x => /^(19|20)\d{7}$/.test(x.text.replace(/[^\d]/g, '')) && x.text.replace(/[^\d]/g, '').length === 9);
        if (w) { head.id = w.text.replace(/[^\d]/g, ''); break; }
      }
    }
    if (!head.name) {
      for (const r of rs.slice(0, Math.max(bodyStart, 12))) {
        const m = /(?:Student\s+)?Name\s*:?\s+([A-Za-z][A-Za-z' .-]+?)(?=\s{1,}(?:[\u0600-\u06FF\uFB50-\uFEFF]|Campus:|Nationality:|Student|ID\b)|$)/.exec(txt(r.words));
        if (m) { head.name = m[1].trim(); break; }
      }
    }
    const colTerms = bounds.map(() => []);
    const cur = bounds.map(() => null);
    const totals = {};
    rs.slice(bodyStart).forEach(r => {
      splitCells(r, bounds).forEach((cell, ci) => {
        if (!cell.length) return;
        const tokens = cell.map(w => w.text);
        const line = tokens.join(' ');
        // New layout's TRANSCRIPT TOTALS box. "Overall" = credit total.
        // careful: "Transfer from Bacc" here is a total, don't open a transfer block.
        const ov = /^Overall:\s*([\d.]+)/.exec(line);
        if (ov) { totals.totalCredits = +ov[1]; return; }
        if (/^(Total\s+Institution:|Transfer\s+from\s+Bacc:|TRANSCRIPT\s+TOTALS|ERN\s+CGPA)/.test(line)) return;
        if (line.indexOf('Tot.') >= 0 && line.indexOf('Cr.') >= 0) {
          const a = /Tot\.\s*Cr\.\s*Compl\.\s*([\d.]+)/.exec(line);
          if (a) totals.totalCredits = +a[1];
          const b = /Cum\.\s*GPA:\s*([\d.]+)/.exec(line);
          if (b) totals.cgpa = +b[1];
          return;
        }
        const tm = !CODE.test(tokens[0]) && TERM.exec(line);
        if (tm) {
          cur[ci] = { term: termOf(tm), courses: [], totals: null };
          colTerms[ci].push(cur[ci]);
          // a course printed on the same line as its term heading
          const rest = line.slice(tm[0].length).trim().split(/\s+/).filter(Boolean);
          const c0 = rest.length && parseCourse(rest);
          if (c0) cur[ci].courses.push(c0);
          return;
        }
        if (TRANSFER.test(line) && !CODE.test(tokens[0])) {
          cur[ci] = { term: 'TRANSFER', courses: [], totals: null };
          colTerms[ci].push(cur[ci]);
          return;
        }
        if (line.indexOf('Att.Cr.') === 0) { if (cur[ci]) cur[ci].totals = parseTotals(line); return; }
        const c = parseCourse(tokens);
        if (c && cur[ci]) cur[ci].courses.push(c);
      });
    });
    const terms = [];
    colTerms.forEach(col => col.forEach(t => terms.push(t)));
    return { head, terms, totals };
  }

  // pages -> student records for the portal
  function parseTranscripts(pages) {
    const byId = {}, order = [];
    const skipped = [];
    pages.forEach((page, i) => {
      let head, terms, totals;
      try { ({ head, terms, totals } = transcriptPage(page)); }
      catch (e) { skipped.push('page ' + (i + 1) + ': ' + e.message); return; }
      if (!head.id) { skipped.push('page ' + (i + 1) + ': no student ID found'); return; }
      if (!byId[head.id]) {
        byId[head.id] = { id: head.id, name: head.name || '', arabName: head.arabName || '',
          nationality: head.nationality || '',
          program: head.faculty || (head.facultyName && head.programName ? head.facultyName + ' / ' + head.programName : ''),
          admission: head.admission || '', admissionTerm: head.admissionTerm || '',
          catalogYear: parseInt(head.id.slice(0, 4), 10) || null, terms: [], pages: [],
          degree: head.degree || '', graduationTerm: head.graduationTerm || '', campus: head.campus || '' };
        order.push(head.id);
      }
      const s = byId[head.id];
      s.pages.push(i + 1);
      terms.forEach(t => {
        const same = s.terms.find(x => x.term === t.term);
        if (same) {
          // The same page can appear twice in one PDF; a course cannot be
          // taken twice in one term, so duplicates are skipped.
          const have = new Set(same.courses.map(c => c.code));
          same.courses = same.courses.concat(t.courses.filter(c => !have.has(c.code)));
          if (t.totals) same.totals = t.totals;
        } else s.terms.push(t);
      });
      if (totals.totalCredits != null) s.officialCredits = totals.totalCredits;
      if (totals.cgpa != null) s.officialCgpa = totals.cgpa;
      else if (head.cgpa != null) s.officialCgpa = head.cgpa;
    });
    const students = order.map(id => {
      const s = byId[id];
      const history = [];
      s.terms.forEach(t => t.courses.forEach(c => history.push({
        code: c.code, title: c.title, cr: c.cr, grade: c.grade, earned: c.earned, term: t.term, flag: c.flag
      })));
      return {
        id: s.id, name: s.name, arabName: s.arabName, nationality: s.nationality,
        program: s.program, admission: s.admission, admissionTerm: s.admissionTerm, catalogYear: s.catalogYear,
        officialCredits: s.officialCredits != null ? s.officialCredits : null,
        officialCgpa: s.officialCgpa != null ? s.officialCgpa : null,
        ...(s.degree ? { degreeSought: s.degree } : {}),
        ...(s.graduationTerm ? { graduationTerm: s.graduationTerm } : {}),
        ...(s.campus ? { campus: s.campus } : {}),
        history,
        termSummary: s.terms.filter(t => t.term !== 'TRANSFER').map(t => ({
          term: t.term, attempted: t.totals ? t.totals.attempted : null,
          earned: t.totals ? t.totals.earned : null, sgpa: t.totals ? t.totals.gpa : null
        })),
        source: 'transcript-import'
      };
    });
    return { students, skipped };
  }

  // ---- schedules ----------------------------------------------------------
  const hhmm = t => { t = String(t).padStart(4, '0'); return t.slice(0, 2) + ':' + t.slice(2); };

  function schedulePage(page) {
    const rs = rows(page.words, 4);
    let sid = null, name = null, term = null, headerIdx = -1, total = null;
    let daycols = [], colx = {};
    rs.forEach((r, i) => {
      const line = txt(r.words).trim();
      if (!sid && /^\d{9}$/.test(line)) { sid = line; return; }
      if (sid && !name && /^[A-Za-z' .-]{4,}$/.test(line)) name = line;
      if (!term && /^\d{6}$/.test(line)) term = line;
      // Master's schedules put the term on the faculty line
      // ("Faculty: Science 202710"), so grab any term-shaped number.
      if (!term) {
        const m = /\b(20\d{2}(?:10|20|30))\b/.exec(line);
        if (m) term = m[1];
      }
      if (line.indexOf('CRN') >= 0 && line.indexOf('Course') >= 0) {
        headerIdx = i;
        daycols = r.words.filter(w => DAYS.indexOf(w.text) >= 0).map(w => [w.text, w.x]);
        colx = {};
        r.words.forEach(w => {
          colx[w.text] = w.x;
          // pdf.js can join the "Sec" and "Credit" headings into one word
          if (w.text === 'SecCredit') { colx.Sec = w.x; colx.Credit = w.x + w.w * 3 / 9; }
        });
      }
      const m = /Total\s+Number\s+of\s+Credits:\s*([\d.]+)/.exec(line);
      if (m) total = +m[1];
    });
    const regs = [];
    if (headerIdx >= 0) {
      // a heading's x is estimated when pdf.js joins it with its neighbour, so
      // allow some slack before the first day column (times are 3-4 digits,
      // so the 1-2 digit credit column is never mistaken for one)
      const firstDayX = daycols.length ? Math.min.apply(null, daycols.map(d => d[1])) - 8 : 1e6;
      const secX = colx.Sec || 0, credX = colx.Credit || firstDayX;
      rs.slice(headerIdx + 1).forEach(r => {
        const ws = r.words;
        const line = txt(ws);
        if (line.indexOf('Total') >= 0) return;
        const codeW = ws.find(w => CODE.test(w.text));
        const crnW = ws.length && /^\d{4,6}$/.test(ws[0].text) ? ws[0] : null;
        if (!codeW || !crnW) {
          // continuation row = another weekly meeting of the course above
          const extra = ws.filter(w => /^\d{3,4}$/.test(w.text) && w.x >= firstDayX - 6);
          if (regs.length && extra.length >= 2) {
            for (let j = 0; j + 1 < extra.length; j += 2) {
              const day = nearestDay(daycols, extra[j].x);
              regs[regs.length - 1].meetings.push({ day, start: hhmm(extra[j].text), end: hhmm(extra[j + 1].text) });
            }
          }
          return;
        }
        const after = ws.filter(w => w.x > codeW.x);
        const secW = after.find(w => w.x >= secX - 6 && w.x < credX - 6);
        const crW = after.find(w => w.x >= credX - 6 && w.x < firstDayX - 6 && /^\d{1,2}$/.test(w.text));
        const nums = after.filter(w => /^\d{3,4}$/.test(w.text) && w.x >= firstDayX - 6);
        const meetings = [];
        for (let j = 0; j + 1 < nums.length; j += 2) {
          meetings.push({ day: nearestDay(daycols, nums[j].x), start: hhmm(nums[j].text), end: hhmm(nums[j + 1].text) });
        }
        regs.push({ crn: crnW.text, code: codeW.text, section: secW ? secW.text : '',
                    cr: crW ? +crW.text : 0, meetings });
      });
    }
    return { sid, name, term, regs, total };
  }

  function nearestDay(daycols, x) {
    if (!daycols.length) return '';
    let best = daycols[0];
    daycols.forEach(d => { if (Math.abs(d[1] - x) < Math.abs(best[1] - x)) best = d; });
    return SHORT[best[0]] || best[0];
  }

  const TERM_SEASON = { '10': 'FALL', '20': 'SPRING', '30': 'SUMMER', '40': 'WINTER' };
  function termName(code) {
    const m = /^(\d{4})(\d{2})$/.exec(String(code || ''));
    if (!m) return String(code || '');
    const end = +m[1];
    return (TERM_SEASON[m[2]] || 'FALL') + ' ' + (end - 1) + '/' + end;
  }

  function parseSchedules(pages) {
    const byId = {}, order = [], skipped = [];
    pages.forEach((page, i) => {
      let r;
      try { r = schedulePage(page); }
      catch (e) { skipped.push('page ' + (i + 1) + ': ' + e.message); return; }
      if (!r.sid) { skipped.push('page ' + (i + 1) + ': no student ID found'); return; }
      if (!byId[r.sid]) { byId[r.sid] = { id: r.sid, name: r.name || '', termCode: r.term || '', courses: [] }; order.push(r.sid); }
      const s = byId[r.sid];
      if (r.term && !s.termCode) s.termCode = r.term;
      r.regs.forEach(c => {
        const ex = s.courses.find(x => x.crn === c.crn);
        if (ex) {
          c.meetings.forEach(m => {
            if (!ex.meetings.some(y => y.day === m.day && y.start === m.start)) ex.meetings.push(m);
          });
          if (c.cr && !ex.cr) ex.cr = c.cr;
        } else s.courses.push(c);
      });
    });
    return {
      registrations: order.map(id => ({
        id, name: byId[id].name, termCode: byId[id].termCode, term: termName(byId[id].termCode),
        courses: byId[id].courses
      })), skipped
    };
  }

  // ---- offering -----------------------------------------------------------

  // build offering sections out of the students' registrations
  function sectionsFromRegistrations(regs) {
    const map = {};
    regs.forEach(r => r.courses.forEach(c => {
      const k = c.crn;
      if (!map[k]) map[k] = { crn: c.crn, code: c.code, section: c.section, cr: c.cr, title: '',
                              term: r.term, termCode: r.termCode, meetings: [], teacher: '',
                              attribute: null, sources: ['registrations'] };
      c.meetings.forEach(m => {
        if (!map[k].meetings.some(y => y.day === m.day && y.start === m.start)) {
          map[k].meetings.push({ day: m.day, start: m.start, end: m.end, kind: '', room: '' });
        }
      });
    }));
    return Object.keys(map).map(k => map[k]);
  }

  return { pagesOf, wordsFromContent, parseTranscripts, parseSchedules, sectionsFromRegistrations, termName, arabicText,
           _internal: { rows, transcriptPage, schedulePage, columnBounds } };
});
