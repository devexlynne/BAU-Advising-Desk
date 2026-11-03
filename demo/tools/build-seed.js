/*
 * Reads the demo PDFs back through the portal's own importer and writes
 * demo/students.json, the records the offline demo starts with. Because the
 * records come out of the same code a real import uses, the demo shows
 * exactly what an advisor would see after importing these PDFs.
 *
 *   npm i --no-save pdfjs-dist@3.11.174
 *   node demo/tools/build-seed.js
 *
 * It stops with an error if any page is skipped, if a parsed value differs
 * from students-spec.json, or if the portal's own credit/CGPA check fails.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const pdfjsLib = require(process.env.PDFJS || 'pdfjs-dist/legacy/build/pdf.js');
const PdfImport = require(path.join(ROOT, 'src', 'pdfimport.js'));
const Merge = require(path.join(ROOT, 'src', 'merge.js'));
const E = require(path.join(ROOT, 'src', 'engine.js'));
const rules = require(path.join(ROOT, 'data', 'rules.json'));
const spec = require(path.join(__dirname, 'students-spec.json'));

const ADVISOR = 'Julie Bu Daher';

async function pages(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  const out = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    out.push({ width: viewport.width, height: viewport.height, words: PdfImport.wordsFromContent(content, viewport) });
  }
  return out;
}

function fail(msg) { console.error('FAIL ' + msg); process.exitCode = 1; }

(async () => {
  const t = PdfImport.parseTranscripts(await pages(path.join(ROOT, 'demo', 'demo-transcripts.pdf')));
  const sch = PdfImport.parseSchedules(await pages(path.join(ROOT, 'demo', 'demo-schedules.pdf')));
  if (t.skipped.length) fail('transcript pages skipped: ' + t.skipped.join('; '));
  if (sch.skipped.length) fail('schedule pages skipped: ' + sch.skipped.join('; '));

  // compare what was read with what was printed
  spec.forEach(s => {
    const got = t.students.find(x => x.id === s.id);
    if (!got) return fail(s.id + ' missing from transcripts');
    if (got.name !== s.name) fail(s.id + ' name ' + got.name);
    if (got.history.length !== s.history.length) fail(s.id + ' rows ' + got.history.length + ' vs ' + s.history.length);
    s.history.forEach((h, i) => {
      const g = got.history[i] || {};
      ['code', 'cr', 'grade', 'term', 'flag'].forEach(k => {
        if (String(g[k]) !== String(h[k])) fail(s.id + ' row ' + i + ' ' + k + ': ' + g[k] + ' vs ' + h[k]);
      });
    });
    if (got.officialCredits !== s.totalCredits) fail(s.id + ' credits ' + got.officialCredits + ' vs ' + s.totalCredits);
    if (Math.abs((got.officialCgpa || 0) - (s.cgpa || 0)) > 0.001) fail(s.id + ' cgpa ' + got.officialCgpa + ' vs ' + s.cgpa);
    const reg = sch.registrations.find(x => x.id === s.id);
    if (!reg) return fail(s.id + ' missing from schedules');
    const want = s.schedule.courses.map(c => c.code + '/' + c.section + '/' + c.meetings.length).join(' ');
    const have = reg.courses.map(c => c.code + '/' + c.section + '/' + c.meetings.length).join(' ');
    if (want !== have) fail(s.id + ' schedule ' + have + ' vs ' + want);
  });

  // the same steps the import screen runs
  const merged = Merge.mergeTranscripts([], t.students, ADVISOR).students;
  const check = Merge.verifyTranscripts(E, rules, merged);
  if (check.off.length) fail('portal credit/CGPA check disagrees for ' + check.off.map(o => o.s.id + ' (' + o.dCr + ' cr, ' + o.dGpa + ' gpa)').join(', '));
  Merge.applySchedules(merged, sch.registrations, { advisorName: ADVISOR });

  // details a transcript PDF doesn't carry in this demo layout
  merged.forEach(s => {
    const src = spec.find(x => x.id === s.id);
    s.arabName = src.arabName;
    s.admissionTerm = src.admissionTerm;   // the printout shows the year, not the season
    s.demo = true;
    s.demoCase = src.note;
  });

  if (process.exitCode) return;
  const out = { note: 'Fictional students for the offline demo. No real student data.', advisor: 'julie-bu-daher', students: merged };
  fs.writeFileSync(path.join(ROOT, 'demo', 'students.json'), JSON.stringify(out, null, 1) + '\n');
  console.log('ok  ' + merged.length + ' demo students read back from the PDFs; credit and CGPA checks pass for all of them');
})().catch(e => { console.error(e); process.exit(1); });
