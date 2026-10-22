const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1380, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('JS: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'build', 'index.html'));
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'shots/1-signin.png' });

  await page.click('[data-pick="julie-bu-daher"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/2-password.png' });
  await page.fill('#fPass', 'advising2026');
  await page.fill('#fPass2', 'advising2026');
  await page.click('#signForm button[type=submit]');
  await page.waitForTimeout(1200);
  console.log('after signin:', JSON.stringify(await page.evaluate(() => ({
    gate: document.getElementById('gate').hidden, app: document.getElementById('app').hidden }))));
  await page.screenshot({ path: 'shots/3-today.png' });

  await page.click('[data-view="students"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/4-students.png' });

  // open the first student row
  await page.locator('.srow').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shots/5-student.png', fullPage: true });

  await page.click('[data-tab="term"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/6-term.png', fullPage: true });

  await page.click('[data-tab="plan"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shots/6b-plan.png', fullPage: true });

  await page.click('[data-tab="chain"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shots/6c-chain.png', fullPage: true });

  await page.click('[data-tab="sheet"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/7-sheet.png', fullPage: true });

  await page.click('[data-tab="transcript"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/8-transcript.png' });

  await page.click('[data-view="import"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/9-import.png' });

  await page.click('[data-view="ask"]');
  await page.waitForTimeout(300);
  await page.fill('#askBox', 'what does needs review mean');
  await page.click('#askGo');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/10-ask.png' });

  await page.click('[data-account]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/10b-account.png' });
  await page.click('[data-close]');
  await page.waitForTimeout(200);

  // dark theme + phone
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.click('[data-view="today"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/11-dark.png' });
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/12-phone.png' });

  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no JS errors');
  await browser.close();
})();
