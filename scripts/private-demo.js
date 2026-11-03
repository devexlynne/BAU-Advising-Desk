/*
 * Private demo from real advisee PDFs, renamed. Runs on this computer only.
 *
 *   npm i --no-save pdfjs-dist@3.11.174
 *   node scripts/private-demo.js --transcripts "A.pdf,B.pdf" --schedules "A-sched.pdf,B-sched.pdf" --count 8
 *
 * Several advisors' PDFs can be given, separated by commas. Students are picked
 * so the cases differ (a failed course, a withdrawal, transfer credits, a low
 * or high CGPA, close to graduation, first year...) and are spread across the
 * files, unless --ids names them.
 * Picks a few students from the registrar PDFs, replaces their name, Arabic
 * name, ID and nationality with invented ones, and writes:
 *   private-demo/students.json        the renamed records
 *   private-demo/private-demo.html    the offline portal with only those students
 *
 * private-demo/ is ignored by git, so nothing here can be committed. The output
 * still describes real students (their courses and grades), so it must stay on
 * this computer: do not upload, email or share it, and delete it when done.
 * --cases also nudges every passing grade up or down one step (a pass stays a
 * pass; F, D-, W and transfers stay) and recomputes the totals, so the
 * situation is kept but the exact record is not. Use it for anything that
 * leaves this computer, such as uploading to the trial on Railway.
 * Optional: --ids 202301234,202401234 to choose the students instead of the
 * first few, and --advisor <slug> for the advisor shown as signed in.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_SERVICE_ID) {
  console.error('The private demo runs on a local computer only.');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'private-demo');
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const transcripts = arg('--transcripts');
const schedules = arg('--schedules');
const count = Math.max(1, Math.min(30, Number(arg('--count') || 6)));
const list = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
const ids = (arg('--ids') || '').split(',').map(s => s.trim()).filter(Boolean);
const advisor = arg('--advisor') || 'julie-bu-daher';
if (!transcripts) {
  console.error('Usage: node scripts/private-demo.js --transcripts <pdf> [--schedules <pdf>] [--count 5 | --ids a,b]');
  process.exit(1);
}

let pdfjsLib;
try { pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js'); }
catch (e) { console.error('Run "npm i --no-save pdfjs-dist@3.11.174" first.'); process.exit(1); }
const PdfImport = require(path.join(ROOT, 'src', 'pdfimport.js'));
const Merge = require(path.join(ROOT, 'src', 'merge.js'));
const E = require(path.join(ROOT, 'src', 'engine.js'));
const rules = require(path.join(ROOT, 'data', 'rules.json'));

/* Turn a copy into a case: passing grades are moved up or down one step at
   random (a pass stays a pass), F, D-, W, AW, P and TR stay as they are, and
   every total is recomputed so the record still adds up. The situation is
   kept, the exact record is not. */
const PASS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D'];
function toCase(s, seed) {
  let x = seed >>> 0;
  const rnd = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  const history = (s.history || []).map(r => {
    const i = PASS.indexOf(r.grade);
    if (i < 0) return Object.assign({}, r);
    const j = Math.max(0, Math.min(PASS.length - 1, i + Math.floor(rnd() * 3) - 1));
    return Object.assign({}, r, { grade: PASS[j] });
  });
  const live = history.filter(r => r.flag !== 'A');
  const g = E.computeGpa(rules, live);
  const dminus = live.reduce((n, r) => n + ((rules.transcriptCreditGrades || []).includes(r.grade) && !E.isPassing(rules, r.grade) ? (Number(r.cr) || 0) : 0), 0);
  const termSummary = (s.termSummary || []).map(t => {
    const rows = history.filter(r => r.term === t.term);
    const tg = E.computeGpa(rules, rows);
    return Object.assign({}, t, { sgpa: tg.gpa });
  });
  return Object.assign({}, s, { history, termSummary, officialCgpa: g.gpa, officialCredits: g.earned + dminus });
}

// invented names, used in order
const NAMES = [
  ['Karim Fouad Haddad', 'كريم فؤاد حداد'], ['Nour Hassan Khalil', 'نور حسن خليل'], ['Rami Walid Saad', 'رامي وليد سعد'],
  ['Lea Georges Mansour', 'ليا جورج منصور'], ['Omar Bilal Fares', 'عمر بلال فارس'], ['Maya Samir Azar', 'مايا سمير عازار'],
  ['Hadi Mahmoud Nasser', 'هادي محمود ناصر'], ['Yara Nabil Chami', 'يارا نبيل شامي'], ['Ziad Antoine Rahal', 'زياد أنطوان رحال'],
  ['Sara Elie Tannous', 'سارة إيلي طنوس'], ['Jana Khaled Moussa', 'جنى خالد موسى'], ['Ali Hussein Hamdan', 'علي حسين حمدان'],
  ['Tarek Imad Sleiman', 'طارق عماد سليمان'], ['Rana Fadi Daou', 'رنا فادي ضو'], ['Joud Samer Kanaan', 'جود سامر كنعان'],
  ['Ahmad Riad Baalbaki', 'أحمد رياض بعلبكي'], ['Celine Marwan Aoun', 'سيلين مروان عون'], ['Bassel Ghassan Tabbara', 'باسل غسان طبارة'],
  ['Dima Wissam Zein', 'ديما وسام زين'], ['Fadi Nadim Chehab', 'فادي نديم شهاب'], ['Lara Ziad Helou', 'لارا زياد حلو'],
  ['Mohamad Adel Kassem', 'محمد عادل قاسم'], ['Rita Elias Saliba', 'ريتا الياس صليبا'], ['Hussein Ali Mrad', 'حسين علي مراد'],
  ['Nadine Karim Sabbagh', 'نادين كريم صباغ'], ['Youssef Tony Hayek', 'يوسف طوني حايك'], ['Mira Jamil Ghandour', 'ميرا جميل غندور'],
  ['Wael Hani Itani', 'وائل هاني عيتاني'], ['Hiba Salim Barakat', 'هبة سليم بركات'], ['Elie Raymond Khoury', 'إيلي ريمون خوري']
];

// what makes a case interesting, so the picks differ from each other
function tagsOf(s) {
  const h = s.history || [];
  const t = new Set();
  if (h.some(r => r.grade === 'F')) t.add('failed');
  if (h.some(r => r.flag === 'I')) t.add('retake');
  if (h.some(r => r.grade === 'W' || r.grade === 'AW')) t.add('withdrawal');
  if (h.some(r => r.grade === 'D-')) t.add('d-minus');
  if (h.some(r => r.term === 'TRANSFER' && !/^(ARAB|BIOL|CHEM|ENGL|HIST|MATH|PHIL|PHYS)1\d\d$/.test(r.code))) t.add('transfer');
  if (h.some(r => /^INTE/.test(r.code))) t.add('intensive-english');
  const cg = s.officialCgpa;
  if (cg != null && cg < 2) t.add('low-cgpa');
  if (cg != null && cg >= 3.5) t.add('high-cgpa');
  const cr = s.officialCredits || 0;
  if (cr >= 110) t.add('near-graduation');
  if (cr < 50) t.add('early');
  return t;
}

function pickVaried(pools, n) {
  const picked = [], covered = new Set();
  const left = pools.map(p => p.slice());
  for (let round = 0; picked.length < n && left.some(p => p.length); round++) {
    const pool = left[round % left.length];        // take turns between the files
    if (!pool.length) continue;
    let best = 0, bestScore = -1;
    pool.forEach((s, i) => {
      const score = [...tagsOf(s)].filter(x => !covered.has(x)).length;
      if (score > bestScore) { best = i; bestScore = score; }
    });
    const s = pool.splice(best, 1)[0];
    if (picked.some(p => p.id === s.id)) continue;   // the same student in two files
    tagsOf(s).forEach(x => covered.add(x));
    picked.push(s);
  }
  return picked;
}

async function pages(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  const out = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    out.push({ width: viewport.width, height: viewport.height, words: PdfImport.wordsFromContent(await page.getTextContent(), viewport) });
  }
  return out;
}

(async () => {
  const files = list(transcripts);
  const pools = [];
  for (const f of files) pools.push(PdfImport.parseTranscripts(await pages(path.resolve(f))).students);
  let regs = [];
  for (const f of list(schedules)) regs = regs.concat(PdfImport.parseSchedules(await pages(path.resolve(f))).registrations);
  const picked = ids.length ? [].concat(...pools).filter(s => ids.includes(s.id)) : pickVaried(pools, count);
  if (!picked.length) { console.error('No matching students in those transcript PDFs.'); process.exit(1); }

  const renamed = [], renamedRegs = [];
  picked.forEach((s, i) => {
    const [name, arabName] = NAMES[i % NAMES.length];
    const year = /^\d{4}/.test(s.id) ? s.id.slice(0, 4) : '2024';
    const newId = year + '99' + String(201 + i).padStart(3, '0');
    const copy = Object.assign({}, s, { id: newId, name, arabName, nationality: '', email: '', phone: '', pages: undefined });
    renamed.push(process.argv.includes('--cases') ? toCase(copy, i + 7) : copy);
    const reg = regs.find(r => r.id === s.id);
    if (reg) renamedRegs.push(Object.assign({}, reg, { id: newId, name }));
  });

  const merged = Merge.mergeTranscripts([], renamed, 'Demo advisor').students;
  if (renamedRegs.length) Merge.applySchedules(merged, renamedRegs, { advisorName: 'Demo advisor' });
  merged.forEach(s => { s.demo = true; s.demoCase = 'renamed copy (private)'; });

  fs.mkdirSync(OUT, { recursive: true });
  const seedFile = path.join(OUT, 'students.json');
  fs.writeFileSync(seedFile, JSON.stringify({ note: 'PRIVATE: renamed copies of real records. Keep on this computer only.', advisor, students: merged }, null, 1));
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'demo.js'), '--file', '--seed', seedFile,
    '--out', path.join(OUT, 'private-demo.html'), '--label', 'PRIVATE COPY: do not share'], { cwd: ROOT, stdio: 'inherit' });
  console.log('\n' + merged.length + ' students renamed (' + renamedRegs.length + ' with schedules). Cases covered: ' +
    Array.from(new Set([].concat(...picked.map(s => [...tagsOf(s)])))).join(', '));
  console.log('Open private-demo\\private-demo.html. Keep the private-demo folder on this computer and delete it when you are done.');
})().catch(e => { console.error(e.message); process.exit(1); });
