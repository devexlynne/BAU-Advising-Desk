const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PASSWORDS, writeStore } = require('./helpers/auth-fixture');

(async () => {
  const port = 3183;
  const base = 'http://127.0.0.1:' + port;
  const dataDir = path.join(__dirname, '..', '.test-data', 'bulk-save');
  fs.rmSync(dataDir, { recursive: true, force: true });
  writeStore(dataDir);
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dataDir, ALLOW_UNVERIFIED_SIGNUP: 'true' }),
    stdio: ['ignore', 'ignore', 'inherit']
  });

  async function post(route, body, cookie) {
    const headers = { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    return fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body) });
  }

  try {
    for (let i = 0; i < 30; i++) {
      try { if ((await fetch(base + '/health')).ok) break; } catch (e) { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const advisorSignin = await post('/api/signin', {
      email: 'test.advisor@bau.edu.lb', password: PASSWORDS.advisor
    });
    if (advisorSignin.status !== 200) throw new Error('advisor sign-in failed: ' + await advisorSignin.text());
    const cookie = advisorSignin.headers.get('set-cookie').split(';')[0];
    const students = [{
      id: '999123456', name: 'Synthetic Learner', history: [],
      registration: { termCode: '202710', term: 'FALL 2026/2027', courses: [{ code: 'CMPS241', cr: 3 }] }
    }];
    const saved = await post('/api/students/save', { students }, cookie);
    if (saved.status !== 200) throw new Error('bulk save failed: ' + await saved.text());

    const listed = await post('/api/list', { path: 'advisors/synthetic-cs-advisor/students' }, cookie);
    if (listed.status !== 200) throw new Error('student list failed: ' + await listed.text());
    const records = (await listed.json()).data;
    assert.strictEqual(records['999123456'].registration.courses[0].code, 'CMPS241');
    console.log('  ok  an imported schedule is saved atomically and comes back registered');

    const advisorOffering = await post('/api/set', {
      path: 'offering/202710', value: { termCode: '202710', sections: [] }
    }, cookie);
    assert.strictEqual(advisorOffering.status, 403, 'an advisor changed the shared course offering');

    const adminSignin = await post('/api/signin', {
      email: 'test.superadmin@bau.edu.lb', password: PASSWORDS.admin
    });
    if (adminSignin.status !== 200) throw new Error('superadmin sign-in failed: ' + await adminSignin.text());
    const adminCookie = adminSignin.headers.get('set-cookie').split(';')[0];
    const adminOffering = await post('/api/set', {
      path: 'offering/202710', value: { termCode: '202710', sections: [{ crn: '12345', code: 'CMPS241' }] }
    }, adminCookie);
    assert.strictEqual(adminOffering.status, 200, 'the admin could not change the shared course offering');

    const sharedOffering = await post('/api/get', { path: 'offering/202710' }, cookie);
    assert.strictEqual(sharedOffering.status, 200, 'an advisor could not read the shared course offering');
    assert.strictEqual((await sharedOffering.json()).data.sections[0].crn, '12345');
    console.log('  ok  only the department admin can change the shared course offering');

    // the admin imports for an advisor: records land in that advisor's own list
    const onBehalf = await post('/api/students/save', { advisor: 'synthetic-cs-advisor', students: [{
      id: '999123457', name: 'Synthetic Learner', history: [] }] }, adminCookie);
    assert.strictEqual(onBehalf.status, 200, 'the admin could not import for an advisor');
    const layalList = (await (await post('/api/list', { path: 'advisors/synthetic-cs-advisor/students' }, cookie)).json()).data;
    assert.ok(layalList['999123457'], 'the advisor does not see what the admin imported for them');
    const adminOwn = (await (await post('/api/list', { path: 'advisors/synthetic-superadmin/students' }, adminCookie)).json()).data;
    assert.ok(!adminOwn['999123457'], 'the import landed in the admin list instead');
    const sneaky = await post('/api/students/save', { advisor: 'synthetic-superadmin', students: [{ id: '999123458', name: 'Synthetic Learner', history: [] }] }, cookie);
    assert.strictEqual(sneaky.status, 403, 'an advisor wrote into another advisor\'s list');
    console.log('  ok  the admin imports for a chosen advisor, and it shows in that advisor\'s list');
    console.log('  ok  an advisor cannot import into somebody else\'s list');

    // ---- hardening ----
    assert.strictEqual((await post('/api/signup', { slug: 'synthetic-outsider', email: 'test.outsider@bau.edu.lb', password: 'Synthetic-outsider-pass-1' })).status, 403,
      'an account was opened without an invitation');
    assert.strictEqual((await post('/api/set', { path: 'brand/cover', value: 'x" onerror="alert(1)' }, cookie)).status, 403,
      'an advisor changed the sign-in cover');
    assert.strictEqual((await post('/api/set', { path: 'brand/cover', value: 'x" onerror="alert(1)' }, adminCookie)).status, 400,
      'a cover that is not an image was accepted');
    assert.strictEqual((await post('/api/set', { path: 'brand/cover', value: 'data:image/png;base64,AA==' }, adminCookie)).status, 200,
      'a superadmin could not set an image cover');
    const businessCookie = (await post('/api/signin', {
      email: 'test.business.admin@bau.edu.lb', password: PASSWORDS.business
    })).headers.get('set-cookie').split(';')[0];
    assert.strictEqual((await post('/api/set', {
      path: 'offering/202710', value: { termCode: '202710', sections: [] }
    }, businessCookie)).status, 200, 'a faculty-admin could not change the university-wide offering');
    const editorCookie = (await post('/api/signin', {
      email: 'test.business.editor@bau.edu.lb', password: PASSWORDS.editor
    })).headers.get('set-cookie').split(';')[0];
    assert.strictEqual((await post('/api/set', {
      path: 'offering/202710', value: { termCode: '202710', sections: [] }
    }, editorCookie)).status, 403, 'a programme-editor changed the university-wide offering');
    assert.strictEqual((await post('/api/set', { path: 'advisors/synthetic-cs-advisor/students/999123456', value: { id: '<img src=x onerror=1>' } }, cookie)).status, 400,
      'a student record with a forged id was accepted');
    assert.strictEqual((await post('/api/set', { path: 'ideas/forged', value: { text: 'x', by: 'Dean' } }, cookie)).status, 403,
      'a suggestion was forged through the generic write route');
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) {
      const r = await fetch(base + '/api/signin', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.' + i },
        body: JSON.stringify({ email: 'test.advisor@bau.edu.lb', password: 'Wrong-synthetic-pass-' + i }) });
      limited = r.status === 429;
    }
    assert.ok(limited, 'changing X-Forwarded-For got around the sign-in limit');
    console.log('  ok  sign-up is limited to the faculty list, the cover is admin-only, forged records and ideas are refused');
    console.log('  ok  the sign-in limit cannot be dodged with a made-up X-Forwarded-For');
  } finally {
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
