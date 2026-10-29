/*
 * Private demo from real advisee PDFs, renamed. Runs on this computer only.
 *
 *   npm i --no-save pdfjs-dist@3.11.174
 *   node scripts/private-demo.js --transcripts "C:\path\Transcripts.pdf" --schedules "C:\path\Schedules.pdf" --count 5
 *
 * Picks a few students from the registrar PDFs, replaces their name, Arabic
 * name, ID and nationality with invented ones, and writes:
 *   private-demo/students.json        the renamed records
 *   private-demo/private-demo.html    the offline portal with only those students
 *
 * private-demo/ is ignored by git, so nothing here can be committed. The output
 * still describes real students (their courses and grades), so it must stay on
 * this computer: do not upload, email or share it, and delete it when done.
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
const count = Math.max(1, Math.min(30, Number(arg('--count') || 5)));
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
  const t = PdfImport.parseTranscripts(await pages(path.resolve(transcripts)));
  let picked = ids.length ? t.students.filter(s => ids.includes(s.id)) : t.students.slice(0, count);
  if (!picked.length) { console.error('No matching students in that transcript PDF.'); process.exit(1); }
  const regs = schedules ? PdfImport.parseSchedules(await pages(path.resolve(schedules))).registrations : [];

  const renamed = [], renamedRegs = [];
  picked.forEach((s, i) => {
    const [name, arabName] = NAMES[i % NAMES.length];
    const year = /^\d{4}/.test(s.id) ? s.id.slice(0, 4) : '2024';
    const newId = year + '99' + String(201 + i).padStart(3, '0');
    renamed.push(Object.assign({}, s, { id: newId, name, arabName, nationality: '', email: '', phone: '', pages: undefined }));
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
  console.log('\n' + merged.length + ' students renamed (' + renamedRegs.length + ' with schedules).');
  console.log('Open private-demo\\private-demo.html. Keep the private-demo folder on this computer and delete it when you are done.');
})().catch(e => { console.error(e.message); process.exit(1); });
