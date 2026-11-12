#!/usr/bin/env node
'use strict';
/* Screenshots of the main screens, for design review.
     node scripts/ui-tour.js [--root <checkout>] [--out docs/screenshots/after] [--port 3401]
   Starts that checkout's server on a throwaway store with synthetic staff and the
   demo students (99xxx IDs), signs in, and saves PNGs. Run it on an older checkout
   (git worktree) to get "before" pictures of the same screens. Local only. */

const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PASSWORDS, defaultStore, writeStore } = require('../tests/helpers/auth-fixture');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(arg('--root', path.join(__dirname, '..')));
const OUT = path.resolve(arg('--out', path.join(__dirname, '..', 'docs', 'screenshots', 'after')));
const PORT = Number(arg('--port', 3401));
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = path.join(require('os').tmpdir(), 'ui-tour-' + PORT);

(async () => {
  spawnSync(process.execPath, ['build.js'], { cwd: ROOT, stdio: 'ignore' });
  fs.rmSync(DATA, { recursive: true, force: true });
  const store = defaultStore();
  store['people/synthetic-cs-advisor'].name = 'Rana Haddad';
  store['people/synthetic-superadmin'].name = 'Karim Nassar';
  const demo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'demo', 'students.json'), 'utf8')).students;
  demo.forEach(s => { store['advisors/synthetic-cs-advisor/students/' + s.id] = Object.assign({}, s, { advisor: 'synthetic-cs-advisor' }); });
  writeStore(DATA, store);
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env, {
    PORT: String(PORT), DATA_DIR: DATA, PUBLIC_URL: BASE, ENABLE_STUDENT_IMPORTS: 'true', STORE_KEY: '',
    SMTP_URL: '', MAIL_API_URL: '', MAIL_API_KEY: '', DATABASE_URL: '', ADMIN_SLUGS: '' }) });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const shot = async (page, name, full) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: !!full }); };
  async function session(email, password, viewport, colorScheme) {
    const ctx = await browser.newContext({ viewport, colorScheme: colorScheme || 'light' });
    await ctx.route('**', r => /^http:\/\/(127\.0\.0\.1|localhost)|^data:/.test(r.request().url()) ? r.continue() : r.abort());
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#fEmail');
    if (!email) return page;
    await page.fill('#fEmail', email); await page.fill('#fPass', password);
    await page.click('#signForm button[type=submit]');
    await page.waitForFunction(() => !document.getElementById('app').hidden);
    await page.waitForTimeout(800);
    return page;
  }
  const exists = async (page, sel) => (await page.locator(sel).count()) > 0;
  try {
    const desk = { width: 1400, height: 900 };
    let p = await session(null, null, desk);
    await shot(p, '01-sign-in');
    await p.click('[data-reset]'); await shot(p, '02-forgot-password');

    p = await session('test.advisor@bau.edu.lb', PASSWORDS.advisor, desk);
    await shot(p, '03-students');
    await p.fill('input[type=search], #q, .search input', 'zzzz-nobody').catch(() => {});
    await shot(p, '04-students-no-match');
    await p.fill('input[type=search], #q, .search input', '').catch(() => {});
    await p.locator('.srow').first().click();
    await shot(p, '05-student-progress', true);
    await p.click('[data-tab="plan"]');
    // add every suggestion: more than the credit limit, so a blocked check shows up
    const adds = await p.locator('.pick [data-toggle]').count();
    for (let i = 0; i < adds; i++) { await p.locator('.pick [data-toggle]').nth(i).click(); await p.waitForTimeout(40); }
    await shot(p, '06-student-plan', true);
    if (await exists(p, '[data-override]')) {
      await p.locator('[data-override]').first().click();
      await shot(p, '07-override-dialog');
      await p.fill('#ovReason', 'Approved by the chair after a meeting on 3 November.');
      await p.click('[data-override-save]');
      await shot(p, '08-plan-saved-with-override', true);
    }
    await p.click('[data-tab="transcript"]'); await shot(p, '09-student-transcript', true);
    await p.click('[data-view="notices"]'); await shot(p, '10-notices');
    await p.click('[data-view="ask"]'); await shot(p, '11-ask-me');
    await p.click('[data-view="import"]'); await shot(p, '12-import');
    await p.click('[data-account]'); await shot(p, '13-account-panel', true);
    await p.locator('#dlg [data-close]').last().click().catch(() => {});
    await p.click('.lang-btn:not(.gate-lang)').catch(e => console.log('language toggle: ' + e.message));
    await p.click('[data-view="students"]').catch(() => {});
    await shot(p, '14-students-arabic');

    p = await session('test.advisor@bau.edu.lb', PASSWORDS.advisor, desk, 'dark');
    await p.click('#themeBtn').catch(() => {});
    await shot(p, '15-students-dark');

    const phone = { width: 390, height: 844 };
    p = await session(null, null, phone); await shot(p, '16-phone-sign-in');
    p = await session('test.advisor@bau.edu.lb', PASSWORDS.advisor, phone);
    await shot(p, '17-phone-students');
    await p.locator('.srow').first().click(); await shot(p, '18-phone-student');

    p = await session('test.superadmin@bau.edu.lb', PASSWORDS.admin, desk);
    await shot(p, '19-admin-home');
    if (await exists(p, '[data-view="activity"]')) {
      await p.click('[data-view="activity"]');
      await p.waitForSelector('table.t.act', { timeout: 5000 }).catch(() => {});
      await shot(p, '20-admin-activity-and-backups', true);
    }
    if (await exists(p, '[data-view="people"]')) { await p.click('[data-view="people"]'); await shot(p, '21-admin-people'); }
  } finally {
    await browser.close();
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
  }
  console.log('screenshots in ' + OUT + (errors.length ? '\npage errors:\n' + errors.join('\n') : '\nno page errors'));
})().catch(e => { console.error(e); process.exit(1); });
