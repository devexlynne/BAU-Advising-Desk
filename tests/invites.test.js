'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PASSWORDS, account, person, defaultStore, writeStore } = require('./helpers/auth-fixture');

const ROOT = path.join(__dirname, '..');
const PORT = 3196;
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = path.join(ROOT, '.test-data', 'phase1-invites');
const OLD_VERIFY_TOKEN = 'synthetic-old-verification-token';
const RESET_TOKEN = 'synthetic-reset-token';

const post = (route, body, cookie) => fetch(BASE + route, {
  method: 'POST',
  headers: Object.assign({ 'content-type': 'application/json' }, cookie ? { cookie } : {}),
  body: JSON.stringify(body)
});

async function waitForServer(server) {
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error('test server exited before becoming ready');
    try { if ((await fetch(BASE + '/health')).ok) return; } catch (error) { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('test server did not start');
}

async function run() {
  fs.rmSync(DATA, { recursive: true, force: true });
  const store = defaultStore();
  store['advisors/synthetic-cs-advisor/students/999900001'] = {
    id: '999900001', name: 'Synthetic Student', history: []
  };
  store['people/synthetic-pending'] = person('synthetic-pending', 'test.pending@bau.edu.lb',
    [{ role: 'advisor', scopes: ['cs'] }]);
  store['advisors/synthetic-pending/account'] = account('synthetic-pending',
    'test.pending@bau.edu.lb', 'Synthetic-pending-pass-2026', false);
  store._verifies = {
    [crypto.createHash('sha256').update(OLD_VERIFY_TOKEN).digest('hex')]: {
      slug: 'synthetic-pending', at: Date.now()
    }
  };
  store._resets = {
    [crypto.createHash('sha256').update(RESET_TOKEN).digest('hex')]: {
      slug: 'synthetic-pending', at: Date.now()
    }
  };
  writeStore(DATA, store);

  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      DATA_DIR: DATA,
      ALLOW_UNVERIFIED_SIGNUP: 'true',
      ENABLE_STUDENT_IMPORTS: 'true',
      MAIL_FROM: 'Synthetic Advising Desk <test.mail@bau.edu.lb>',
      SMTP_URL: 'smtp://127.0.0.1:1',
      MAIL_API_URL: '',
      MAIL_API_KEY: '',
      PUBLIC_URL: BASE,
      ADMIN_SLUGS: ''
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk.toString(); });
  server.stderr.on('data', chunk => { output += chunk.toString(); });

  try {
    await waitForServer(server);
    assert.strictEqual((await fetch(BASE + '/api/accounts')).status, 401,
      'account enumeration must require a session');

    const adminSignin = await post('/api/signin', {
      email: 'test.superadmin@bau.edu.lb', password: PASSWORDS.admin
    });
    assert.strictEqual(adminSignin.status, 200, 'a migrated account signs in using email');
    const adminCookie = adminSignin.headers.get('set-cookie').split(';')[0];

    const accounts = await post('/api/accounts', {});
    assert.strictEqual(accounts.status, 401);
    const sessionAccounts = await fetch(BASE + '/api/accounts', { headers: { cookie: adminCookie } });
    assert.strictEqual(sessionAccounts.status, 200);
    assert.strictEqual((await sessionAccounts.json()).accounts['synthetic-cs-advisor'], true);
    const ideas = await post('/api/list', { path: 'ideas' }, adminCookie);
    assert.strictEqual(ideas.status, 200, 'a superadmin can read the suggestions collection');

    assert.strictEqual((await post('/api/signup', {
      slug: 'synthetic-outsider', email: 'test.outsider@bau.edu.lb', password: 'Synthetic-outsider-pass-1'
    })).status, 403, 'uninvited sign-up must not work, including in development');

    const businessSignin = await post('/api/signin', {
      email: 'test.business.admin@bau.edu.lb', password: PASSWORDS.business
    });
    const businessCookie = businessSignin.headers.get('set-cookie').split(';')[0];
    const businessPeople = await (await post('/api/people/list', {}, businessCookie)).json();
    assert.ok(businessPeople.people.some(person => person.slug === 'synthetic-business-editor'));
    assert.ok(!businessPeople.people.some(person => person.slug === 'synthetic-cs-advisor'),
      'Business faculty-admin must not list Science people');
    const updatedPerson = await post('/api/people/update', {
      slug: 'synthetic-business-editor',
      person: { name: 'Updated Synthetic Editor', title: 'Synthetic programme editor' },
      roles: [{ role: 'programme-editor', scopes: ['bba-accounting'] }]
    }, businessCookie);
    assert.strictEqual(updatedPerson.status, 200, 'a faculty admin can edit a person within their scope');
    assert.strictEqual((await updatedPerson.json()).person.name, 'Updated Synthetic Editor');
    for (const route of ['/api/get', '/api/list']) {
      const read = await post(route, {
        path: route === '/api/list' ? 'advisors/synthetic-cs-advisor/students' : 'config/cs/rules'
      }, businessCookie);
      assert.strictEqual(read.status, 403, 'Business faculty-admin read outside scope through ' + route);
    }
    const deniedStudentWrite = await post('/api/set', {
      path: 'advisors/synthetic-cs-advisor/students/999900001',
      value: { id: '999900001', name: 'Changed' }
    }, businessCookie);
    assert.strictEqual(deniedStudentWrite.status, 403,
      'Business faculty-admin must not change Science student records');
    assert.strictEqual((await post('/api/set', {
      path: 'config/cs/rules', value: { forbidden: true }
    }, businessCookie)).status, 403, 'Business faculty-admin must not change Science rules');
    assert.strictEqual((await post('/api/org/tree', {}, businessCookie)).status, 200,
      'authenticated staff may load the tree needed for scoped administration');
    assert.strictEqual((await post('/api/org/tree', { tree: {} }, businessCookie)).status, 403,
      'only a superadmin may change the organisation tree');

    const invited = await post('/api/people/invite', {
      person: {
        slug: 'synthetic-invited', name: 'Synthetic Invitee', title: 'Synthetic Advisor',
        email: 'test.invited@bau.edu.lb', faculty: 'Faculty of Science',
        department: 'Mathematics and Computer Science'
      },
      roles: [{ role: 'advisor', scopes: ['cs'] }]
    }, adminCookie);
    assert.strictEqual(invited.status, 200);
    const inviteBody = await invited.json();
    assert.ok(inviteBody.inviteLink);
    const inviteToken = new URL(inviteBody.inviteLink).searchParams.get('verify');
    assert.ok(inviteToken);
    assert.ok(output.includes(inviteBody.inviteLink), 'synthetic test invites are logged instead of emailed');

    const accepted = await post('/api/verify', {
      token: inviteToken, password: 'Synthetic-invite-password-2026'
    });
    assert.strictEqual(accepted.status, 200);
    const acceptedCookie = accepted.headers.get('set-cookie').split(';')[0];
    assert.strictEqual((await post('/api/verify', {
      token: inviteToken, password: 'Synthetic-invite-password-2026'
    })).status, 401, 'invite token must be single-use');
    assert.strictEqual((await post('/api/signin', {
      email: 'test.invited@bau.edu.lb', password: 'Synthetic-invite-password-2026'
    })).status, 200, 'invitee can sign in using email and their chosen password');
    assert.ok(acceptedCookie);

    const rawStore = fs.readFileSync(path.join(DATA, 'store.json'), 'utf8');
    assert.ok(!rawStore.includes(inviteToken), 'only the invite token hash may be stored');

    const oldVerify = await post('/api/verify', {
      token: OLD_VERIFY_TOKEN, password: 'Synthetic-pending-pass-2026'
    });
    assert.strictEqual(oldVerify.status, 200, 'previously issued verification links must remain usable');
    assert.strictEqual((await post('/api/signin', {
      email: 'test.pending@bau.edu.lb', password: 'Synthetic-pending-pass-2026'
    })).status, 200, 'legacy verified advisors can sign in by migrated email');

    const resetRequested = await post('/api/reset-request', { email: 'test.advisor@bau.edu.lb' });
    assert.strictEqual(resetRequested.status, 200);
    assert.deepStrictEqual(await resetRequested.json(), { ok: true, mail: true });
    await new Promise(resolve => setTimeout(resolve, 300));
    const afterRequest = JSON.parse(fs.readFileSync(path.join(DATA, 'store.json'), 'utf8'));
    assert.ok(Object.values(afterRequest._resets || {}).some(record => record.slug === 'synthetic-cs-advisor'),
      'email reset requests should create an expiring hashed reset token');
    const reset = await post('/api/reset-with-link', {
      token: RESET_TOKEN, password: 'Synthetic-reset-password-2026'
    });
    assert.strictEqual(reset.status, 200, 'existing password-reset links continue to work');
    assert.strictEqual((await post('/api/signin', {
      email: 'test.pending@bau.edu.lb', password: 'Synthetic-reset-password-2026'
    })).status, 200);

    const demoteLast = await post('/api/people/update', {
      slug: 'synthetic-superadmin',
      person: {},
      roles: [{ role: 'advisor', scopes: ['cs'] }]
    }, adminCookie);
    assert.strictEqual(demoteLast.status, 409, 'the last superadmin cannot be demoted');
    const deactivateLast = await post('/api/people/deactivate', {
      slug: 'synthetic-superadmin'
    }, adminCookie);
    assert.strictEqual(deactivateLast.status, 409, 'the last superadmin cannot be deactivated');

    const tree = (await (await post('/api/org/tree', {}, adminCookie)).json()).tree;
    tree.name = 'Synthetic University Demo';
    assert.strictEqual((await post('/api/org/tree', { tree }, adminCookie)).status, 200);
    assert.strictEqual((await post('/api/org/tree', { tree: { id: 'invalid' } }, adminCookie)).status, 400);

    const advisorSignin = await post('/api/signin', {
      email: 'test.advisor@bau.edu.lb', password: PASSWORDS.advisor
    });
    const advisorCookie = advisorSignin.headers.get('set-cookie').split(';')[0];
    const deactivated = await post('/api/people/deactivate', {
      slug: 'synthetic-cs-advisor'
    }, adminCookie);
    assert.strictEqual(deactivated.status, 200);
    const allStudents = await (await post('/api/all-students', {}, adminCookie)).json();
    assert.ok(allStudents.advisors['synthetic-cs-advisor'].some(student => student.id === '999900001'),
      'deactivation must not delete student data or hide it from an in-scope admin');
    assert.strictEqual((await post('/api/get', {
      path: 'advisors/synthetic-cs-advisor/students/999900001'
    }, advisorCookie)).status, 401,
    'a deactivated account cannot keep using its session');

    await new Promise(resolve => setTimeout(resolve, 300));
    const auditText = fs.readFileSync(path.join(DATA, 'audit.log'), 'utf8');
    const auditEvents = auditText.trim().split('\n').map(line => JSON.parse(line));
    assert.ok(auditEvents.some(event => event.action === 'person-invited'
      && event.target === 'synthetic-invited' && event.before === null && event.after));
    assert.ok(auditEvents.some(event => event.action === 'person-updated'
      && event.target === 'synthetic-business-editor' && event.before.name === 'Synthetic synthetic-business-editor'
      && event.after.name === 'Updated Synthetic Editor'));
    assert.ok(auditEvents.some(event => event.action === 'org-tree-changed' && event.before && event.after));
    assert.ok(auditEvents.some(event => event.action === 'person-deactivated'
      && event.target === 'synthetic-cs-advisor' && event.before.active === true && event.after.active === false));
    console.log('  invite, sign-in, scope, recovery, superadmin, deactivation, and audit checks passed');
  } finally {
    server.kill();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
