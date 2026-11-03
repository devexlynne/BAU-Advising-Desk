/*
 * Uploads the case students made by private-demo.js --cases to a running
 * portal (for example the trial on Railway), into one advisor's list.
 *
 *   node scripts/upload-cases.js --url https://your-trial.up.railway.app --as lynn-el-arwadi --advisor julie-bu-daher
 *
 * --as is the portal admin who signs in (the password is asked for and not
 * shown or stored). --advisor is whose list the students go into. It reads
 * private-demo/students.json, or the file given with --file, and only uploads
 * records marked as demo cases with IDs in the 99xxx block.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const base = String(arg('--url') || '').replace(/\/+$/, '');
const as = arg('--as');
const advisor = arg('--advisor');
const file = path.resolve(arg('--file') || path.join(__dirname, '..', 'private-demo', 'students.json'));
if (!/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])/.test(base + '/') || !as || !advisor) {
  console.error('Usage: node scripts/upload-cases.js --url https://... --as <admin slug> --advisor <advisor slug> [--file <students.json>]');
  process.exit(1);
}

function askHidden(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    rl._writeToOutput = text => { if (text.includes(question)) process.stdout.write(text); };
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const students = (seed.students || []).filter(s => s.demo === true && /^20\d\d99\d{3}$/.test(s.id));
  if (!students.length || students.length !== (seed.students || []).length) {
    console.error('The file must contain only demo case records (made with private-demo.js --cases).');
    process.exit(1);
  }
  const password = await askHidden('Password for ' + as + ': ');
  const signin = await fetch(base + '/api/signin', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: as, password })
  });
  if (!signin.ok) { console.error('Sign-in failed (' + signin.status + ').'); process.exit(1); }
  const cookie = (signin.headers.get('set-cookie') || '').split(';')[0];
  const save = await fetch(base + '/api/students/save', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ students, advisor })
  });
  const body = await save.json().catch(() => ({}));
  if (!save.ok) { console.error('Upload failed (' + save.status + '): ' + (body.error || '')); process.exit(1); }
  await fetch(base + '/api/signout', { method: 'POST', headers: { cookie } }).catch(() => {});
  console.log('Uploaded ' + students.length + ' case students into ' + advisor + "'s list.");
})().catch(e => { console.error(e.message); process.exit(1); });
