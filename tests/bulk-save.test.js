const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

(async () => {
  const port = 3183;
  const base = 'http://127.0.0.1:' + port;
  const dataDir = path.join(__dirname, '..', '.test-data', 'bulk-save');
  fs.rmSync(dataDir, { recursive: true, force: true });
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
    const signup = await post('/api/signup', {
      slug: 'layal-abu-daher', email: 'layal.abudaher@bau.edu.lb', password: 'bulk-save-test-2026'
    });
    if (signup.status !== 200) throw new Error('signup failed: ' + await signup.text());
    const cookie = signup.headers.get('set-cookie').split(';')[0];
    const students = [{
      id: '999123456', name: 'Synthetic Learner', history: [],
      registration: { termCode: '202710', term: 'FALL 2026/2027', courses: [{ code: 'CMPS241', cr: 3 }] }
    }];
    const saved = await post('/api/students/save', { students }, cookie);
    if (saved.status !== 200) throw new Error('bulk save failed: ' + await saved.text());

    const listed = await post('/api/list', { path: 'advisors/layal-abu-daher/students' }, cookie);
    if (listed.status !== 200) throw new Error('student list failed: ' + await listed.text());
    const records = (await listed.json()).data;
    assert.strictEqual(records['999123456'].registration.courses[0].code, 'CMPS241');
    console.log('  ok  an imported schedule is saved atomically and comes back registered');

    const advisorOffering = await post('/api/set', {
      path: 'offering/202710', value: { termCode: '202710', sections: [] }
    }, cookie);
    assert.strictEqual(advisorOffering.status, 403, 'an advisor changed the shared course offering');

    const adminSignup = await post('/api/signup', {
      slug: 'lynn-el-arwadi', email: 'l.arwadi@bau.edu.lb', password: 'admin-offering-test-2026'
    });
    if (adminSignup.status !== 200) throw new Error('admin signup failed: ' + await adminSignup.text());
    const adminCookie = adminSignup.headers.get('set-cookie').split(';')[0];
    const adminOffering = await post('/api/set', {
      path: 'offering/202710', value: { termCode: '202710', sections: [{ crn: '12345', code: 'CMPS241' }] }
    }, adminCookie);
    assert.strictEqual(adminOffering.status, 200, 'the admin could not change the shared course offering');

    const sharedOffering = await post('/api/get', { path: 'offering/202710' }, cookie);
    assert.strictEqual(sharedOffering.status, 200, 'an advisor could not read the shared course offering');
    assert.strictEqual((await sharedOffering.json()).data.sections[0].crn, '12345');
    console.log('  ok  only the department admin can change the shared course offering');

    // the admin imports for an advisor: records land in that advisor's own list
    const onBehalf = await post('/api/students/save', { advisor: 'layal-abu-daher', students: [{
      id: '999123457', name: 'Synthetic Learner', history: [] }] }, adminCookie);
    assert.strictEqual(onBehalf.status, 200, 'the admin could not import for an advisor');
    const layalList = (await (await post('/api/list', { path: 'advisors/layal-abu-daher/students' }, cookie)).json()).data;
    assert.ok(layalList['999123457'], 'the advisor does not see what the admin imported for them');
    const adminOwn = (await (await post('/api/list', { path: 'advisors/lynn-el-arwadi/students' }, adminCookie)).json()).data;
    assert.ok(!adminOwn['999123457'], 'the import landed in the admin list instead');
    const sneaky = await post('/api/students/save', { advisor: 'julie-bu-daher', students: [{ id: '999123458', name: 'Synthetic Learner', history: [] }] }, cookie);
    assert.strictEqual(sneaky.status, 403, 'an advisor wrote into another advisor\'s list');
    console.log('  ok  the admin imports for a chosen advisor, and it shows in that advisor\'s list');
    console.log('  ok  an advisor cannot import into somebody else\'s list');

    // ---- hardening ----
    assert.strictEqual((await post('/api/signup', { slug: 'zz-stranger', email: 'x@bau.edu.lb', password: 'stranger-pass-2026' })).status, 400,
      'a name that is not on the faculty list opened an account');
    assert.strictEqual((await post('/api/signup', { slug: 'bilal-nakhal', email: 'someone@bau.edu.lb', password: 'stranger-pass-2026' })).status, 400,
      'an account was opened with an address that is not the one on file');
    assert.strictEqual((await post('/api/set', { path: 'brand/cover', value: 'x" onerror="alert(1)' }, cookie)).status, 403,
      'an advisor changed the sign-in cover');
    assert.strictEqual((await post('/api/set', { path: 'brand/cover', value: 'x" onerror="alert(1)' }, adminCookie)).status, 400,
      'a cover that is not an image was accepted');
    assert.strictEqual((await post('/api/set', { path: 'advisors/layal-abu-daher/students/999123456', value: { id: '<img src=x onerror=1>' } }, cookie)).status, 400,
      'a student record with a forged id was accepted');
    assert.strictEqual((await post('/api/set', { path: 'ideas/forged', value: { text: 'x', by: 'Dean' } }, cookie)).status, 403,
      'a suggestion was forged through the generic write route');
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) {
      const r = await fetch(base + '/api/signin', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.' + i },
        body: JSON.stringify({ slug: 'layal-abu-daher', password: 'wrong-password-' + i }) });
      limited = r.status === 429;
    }
    assert.ok(limited, 'changing X-Forwarded-For got around the sign-in limit');
    console.log('  ok  sign-up is limited to the faculty list, the cover is admin-only, forged records and ideas are refused');
    console.log('  ok  the sign-in limit cannot be dodged with a made-up X-Forwarded-For');
  } finally {
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
