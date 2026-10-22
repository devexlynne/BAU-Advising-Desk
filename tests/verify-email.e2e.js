/* Run with: node tests/verify-email.e2e.js
   A new account is locked until its owner opens the emailed link and types
   the password they chose. Uses the stand-in mail server. */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');

(async () => {
  fs.rmSync('./.test-data/verify', { recursive: true, force: true });
  fs.rmSync('./.test-data/verify-mail.txt', { force: true });
  const smtp = spawn('node', ['./tests/fake-smtp.js', '2561', './.test-data/verify-mail.txt'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 500));
  const srv = spawn('node', ['./server.js'], {
    env: Object.assign({}, process.env, {
      PORT: '3161', DATA_DIR: './.test-data/verify',
      SMTP_URL: 'smtp://desk:secret@127.0.0.1:2561',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      MAIL_FROM: 'Advising Desk <no-reply@bau.edu.lb>',
      PUBLIC_URL: 'http://localhost:3161'
    }), stdio: 'inherit'
  });
  await new Promise(r => setTimeout(r, 900));
  const base = 'http://localhost:3161';
  let fails = 0;
  const step = (n, ok, extra) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? ' — ' + extra : '')); };
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const lastMail = () => fs.existsSync('./.test-data/verify-mail.txt') ? fs.readFileSync('./.test-data/verify-mail.txt', 'utf8') : '';
  const linkIn = t => (t.match(/http:\/\/localhost:3161\/\?verify=[a-f0-9]{64}/) || [])[0];

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext();
  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1')) return route.continue();
    return route.abort();
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push('JS: ' + e.message));

  // sign up in the page
  await p.goto(base, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.click('[data-pick="julie-bu-daher"]'); await p.waitForTimeout(300);
  await p.fill('#fPass', 'firstpassword1'); await p.fill('#fPass2', 'firstpassword1');
  await p.click('#signForm button[type=submit]'); await p.waitForTimeout(1500);
  step('after sign-up the page asks to check the email', /Check your BAU email/.test(await p.locator('#gate').innerText()));
  step('the portal does not open yet', await p.evaluate(() => document.getElementById('app').hidden));
  const who = await (await fetch(base + '/api/session', { headers: { cookie: (await ctx.cookies()).map(c => c.name + '=' + c.value).join('; ') } })).json();
  step('no session is given before verifying', !who.slug);

  const m1 = lastMail();
  step('the activation email was sent to the address on file', /To: <j\.budaher@bau\.edu\.lb>/.test(m1));
  const link1 = linkIn(m1);
  step('it carries an activation link', !!link1);

  const early = await post('/api/signin', { slug: 'julie-bu-daher', password: 'firstpassword1' });
  step('signing in before verifying is refused', early.status === 403, 'status ' + early.status);
  const acc = await (await fetch(base + '/api/accounts')).json();
  step('the account is not listed as ready', !acc.accounts['julie-bu-daher']);

  // resend from the waiting screen: only the newest link works
  await p.click('[data-verify-resend]'); await p.waitForTimeout(1500);
  step('the page confirms it sent again', /Sent\./.test(await p.locator('#mailSent').innerText()));
  const link2 = linkIn(lastMail());
  step('a new link came', !!link2 && link2 !== link1);
  const stale = await post('/api/verify', { token: link1.split('verify=')[1], password: 'firstpassword1' });
  step('the older link stops working', stale.status === 401, 'status ' + stale.status);

  // open the link: wrong password first
  await p.goto(link2, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(900);
  await p.fill('#vPass', 'not-the-password'); await p.click('#verifyForm button[type=submit]'); await p.waitForTimeout(800);
  step('a wrong password does not activate', !(await p.locator('#gateErr').isHidden()) && await p.evaluate(() => document.getElementById('app').hidden));
  await p.fill('#vPass', 'firstpassword1'); await p.click('#verifyForm button[type=submit]'); await p.waitForTimeout(1500);
  step('the right password activates and signs in', await p.evaluate(() => !document.getElementById('app').hidden));
  step('the address is cleaned up', !(await p.evaluate(() => location.search)).includes('verify='));
  const reuse = await post('/api/verify', { token: link2.split('verify=')[1], password: 'firstpassword1' });
  step('the link works only once', reuse.status === 401, 'status ' + reuse.status);
  step('normal sign-in now works', (await post('/api/signin', { slug: 'julie-bu-daher', password: 'firstpassword1' })).status === 200);
  step('a verified account cannot be made again', (await post('/api/signup', { slug: 'julie-bu-daher', email: 'j.budaher@bau.edu.lb', password: 'another-pass-1' })).status === 409);

  // someone signs up in another advisor's name; the real advisor can still take it
  const squat = await post('/api/signup', { slug: 'may-itani', email: 'ma.itani@bau.edu.lb', password: 'stranger-pass-1' });
  step('a stranger can start an account', squat.status === 200);
  const squatLink = linkIn(lastMail());
  step("the advisor's own password does not activate the stranger's account",
    (await post('/api/verify', { token: squatLink.split('verify=')[1], password: 'mays-own-pass-1' })).status === 401);
  const real = await post('/api/signup', { slug: 'may-itani', email: 'ma.itani@bau.edu.lb', password: 'mays-own-pass-1' });
  step('the advisor can create the account again', real.status === 200);
  const realLink = linkIn(lastMail());
  step("the stranger's link is dead", (await post('/api/verify', { token: squatLink.split('verify=')[1], password: 'stranger-pass-1' })).status === 401);
  step("the advisor's link works with their password", (await post('/api/verify', { token: realLink.split('verify=')[1], password: 'mays-own-pass-1' })).status === 200);

  console.log(errs.length ? 'JS ERRORS:\n' + errs.join('\n') : 'no JS errors');
  console.log(fails ? fails + ' FAILED' : 'all passed');
  await b.close(); srv.kill(); smtp.kill();
  process.exit(fails ? 1 : 0);
})();
