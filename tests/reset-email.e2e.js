/* Run with: node tests/reset-email.e2e.js
   The forgotten-password flow end to end, against a stand-in mail server. */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');

(async () => {
  fs.rmSync('./.test-data/mail', { recursive: true, force: true });
  fs.rmSync('./.test-data/mail.txt', { force: true });
  const smtp = spawn('node', ['./tests/fake-smtp.js', '2560', './.test-data/mail.txt'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 500));
  // the client alone, before the browser gets involved
  try {
    const mail = require('./mail.js');
    console.log('(mailer module loaded)');
  } catch (e) { console.log('mailer failed to load: ' + e.message); }
  const srv = spawn('node', ['./server.js'], {
    env: Object.assign({}, process.env, {
      PORT: '3160', DATA_DIR: './.test-data/mail',
      SMTP_URL: 'smtp://desk:secret@127.0.0.1:2560',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      MAIL_FROM: 'Advising Desk <no-reply@bau.edu.lb>',
      PUBLIC_URL: 'http://localhost:3160'
    }), stdio: 'inherit'
  });
  await new Promise(r => setTimeout(r, 900));
  const base = 'http://localhost:3160';
  const step = (n, ok, extra) => console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? ' — ' + extra : ''));

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext();
  // Fonts and pdf.js come from the internet, which this sandbox blocks; the
  // page works without them and the test should not wait on them.
  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1')) return route.continue();
    return route.abort();
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push('JS: ' + e.message));

  // an account to forget the password of
  await p.goto(base, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.click('[data-pick="julie-bu-daher"]'); await p.waitForTimeout(300);
  await p.fill('#fPass', 'firstpassword1'); await p.fill('#fPass2', 'firstpassword1');
  await p.click('#signForm button[type=submit]'); await p.waitForTimeout(1500);
  // new accounts are activated from the emailed link first
  const verifyLink = ((fs.existsSync('./.test-data/mail.txt') ? fs.readFileSync('./.test-data/mail.txt', 'utf8') : '')
    .match(/http:\/\/localhost:3160\/\?verify=[a-f0-9]{64}/) || [])[0];
  step('the new account gets an activation link', !!verifyLink);
  await p.goto(verifyLink, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(900);
  await p.fill('#vPass', 'firstpassword1'); await p.click('#verifyForm button[type=submit]'); await p.waitForTimeout(1200);
  await p.click('#signOut'); await p.waitForTimeout(600);

  // forgot it: ask for the link
  await p.click('[data-pick="julie-bu-daher"]'); await p.waitForTimeout(300);
  await p.click('[data-reset]'); await p.waitForTimeout(300);
  step('the emailed link is offered', await p.locator('[data-mail-reset]').count() === 1);
  await p.click('[data-mail-reset]'); await p.waitForTimeout(1500);
  const said = await p.locator('#mailSent').innerText();
  step('the page says it was sent', /link was sent/.test(said), said);

  const mailText = fs.existsSync('./.test-data/mail.txt') ? fs.readFileSync('./.test-data/mail.txt', 'utf8') : '';
  step('the mail server received a message', mailText.length > 0);
  step('addressed to the account', /To: <j\.budaher@bau\.edu\.lb>/.test(mailText), (mailText.match(/To: .*/) || [''])[0]);
  const link = (mailText.match(/http:\/\/localhost:3160\/\?reset=[a-f0-9]{64}/) || [])[0];
  step('it carries a one-time link', !!link);

  // the email path does not accept just typing the address
  const typed = await fetch(base + '/api/reset', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'julie-bu-daher', code: 'j.budaher@bau.edu.lb', password: 'typedaddress1' }) });
  step('typing the address alone is not a reset route', typed.status === 404 || typed.status === 401, 'status ' + typed.status);

  // open the link and set a new password
  await p.goto(link, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(900);
  await p.fill('#lPass', 'brandnewpass12'); await p.fill('#lPass2', 'brandnewpass12');
  await p.click('#linkForm button[type=submit]'); await p.waitForTimeout(1200);
  step('no recovery-code screen is shown', await p.locator('[data-gostart]').count() === 0);
  step('signed in after the reset', await p.evaluate(() => !document.getElementById('app').hidden));
  step('the address is cleaned up', !(await p.evaluate(() => location.search)).includes('reset='));

  // the same link cannot be used twice
  const again = await fetch(base + '/api/reset-with-link', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: link.split('reset=')[1], password: 'thirdpassword1' }) });
  step('the link works only once', again.status === 401, 'status ' + again.status);

  // the old password is dead, the new one works
  const oldTry = await fetch(base + '/api/signin', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'julie-bu-daher', password: 'firstpassword1' }) });
  step('the old password stops working', oldTry.status === 401, 'status ' + oldTry.status);
  const newTry = await fetch(base + '/api/signin', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'julie-bu-daher', password: 'brandnewpass12' }) });
  step('the new password works', newTry.status === 200, 'status ' + newTry.status);

  // asking for a link about an account that does not exist says the same thing
  const quiet = await fetch(base + '/api/reset-request', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'may-itani' }) });
  const quietBody = await quiet.json();
  step('no way to learn who has an account', quiet.status === 200 && quietBody.ok === true);

  console.log(errs.length ? 'JS ERRORS:\n' + errs.join('\n') : 'no JS errors');
  await b.close(); srv.kill(); smtp.kill();
})();
