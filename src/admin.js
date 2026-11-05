/*
 * Superadmin dashboard: one place to see how the whole portal is doing and to
 * act on it. Tabs: Overview (numbers, programme readiness, system health),
 * People and access (accounts, last sign-in, who is online, sign people out),
 * Activity (recent audit events) and Settings (banner, read-only mode).
 * Everything is read from /api/admin/*, which only answers a superadmin.
 */
const adminUi = { tab: 'overview', data: null, events: null, err: '', loading: false,
  progFilter: 'all', facFilter: '', actFilter: '', peopleQ: '' };

const ADMIN_ACTIONS = {
  'signin': 'Signed in', 'signin-failed': 'Failed sign-in', 'signout': 'Signed out',
  'password-reset': 'Password reset', 'password-changed': 'Changed password',
  'person-invited': 'Invited a person', 'person-reinvited': 'Re-sent an invitation',
  'person-updated': 'Edited a profile', 'person-role-changed': 'Changed roles',
  'person-deactivated': 'Deactivated a person', 'admin-reset-link': 'Made a reset link',
  'admin-clear-password': 'Cleared a password', 'students-save': 'Imported students',
  'students-clear': 'Cleared a student list', 'set': 'Changed a record', 'delete': 'Deleted a record',
  'org-tree-changed': 'Changed the university structure', 'catalogue-seeded': 'Loaded the catalogue',
  'org-migration': 'Upgraded stored data', 'superadmin-account-created': 'Created the superadmin account',
  'sessions-ended': 'Signed a person out', 'sessions-ended-all': 'Signed everyone out',
  'settings-changed': 'Changed portal settings', 'idea': 'Posted a suggestion', 'mail-sent': 'Sent an email'
};

async function loadAdmin(force) {
  if (adminUi.loading || (adminUi.data && !force)) return;
  adminUi.loading = true; adminUi.err = '';
  try {
    const [data, act] = await Promise.all([Store.adminCall('overview'), Store.adminCall('activity', { limit: 300 })]);
    adminUi.data = data; adminUi.events = act.events || [];
  } catch (e) {
    adminUi.err = e.message || 'Could not load the dashboard.';
  }
  adminUi.loading = false;
  if (state.view === 'admin') render();
}

const adminName = slug => {
  if (!slug) return '';
  if (slug === 'system') return 'System';
  const p = (state.people || []).find(x => x.slug === slug);
  return p ? fullName(p) : slug;
};
const ADMIN_ROLE_NAMES = { superadmin: 'Superadmin', 'faculty-admin': 'Faculty admin', 'programme-editor': 'Programme editor',
  approver: 'Approver', advisor: 'Advisor', viewer: 'Viewer' };
function adminRoleText(r) {
  const rows = orgScopeRows();
  const where = (r.scopes || []).map(id => id === 'bau' ? 'whole university'
    : ((rows.find(row => row.id === id) || {}).label || id).split(' / ').pop()).join(', ');
  return (ADMIN_ROLE_NAMES[r.role] || r.role) + (where ? ' · ' + where : '');
}
const adminAgo = t => {
  if (!t || (typeof t === 'number' && t < 946684800000)) return 'never';   // before 2000: no real date
  const ms = Date.now() - (typeof t === 'number' ? t : Date.parse(t));
  if (!Number.isFinite(ms)) return '';
  if (ms < 60e3) return 'just now';
  if (ms < 3600e3) return Math.round(ms / 60e3) + ' min ago';
  if (ms < 86400e3) return Math.round(ms / 3600e3) + ' h ago';
  if (ms < 30 * 86400e3) return Math.round(ms / 86400e3) + ' days ago';
  return new Date(t).toLocaleDateString();
};
const adminUptime = s => s < 3600 ? Math.round(s / 60) + ' min' : s < 86400 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' days';
const adminTile = (k, v, s, cls, attrs) =>
  `<div class="tile ${cls || ''}" ${attrs || ''}><div class="k">${esc(k)}</div><div class="v">${esc(String(v))}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}</div>`;

function viewAdmin() {
  if (!state.me.superadmin) return '<div class="wrap"><p class="note">Only a superadmin can open the admin dashboard.</p></div>';
  if (!adminUi.data && !adminUi.err) { loadAdmin(); }
  const d = adminUi.data;
  const tabs = [['overview', 'Overview'], ['programmes', 'Programmes'], ['access', 'People and access'], ['activity', 'Activity'], ['settings', 'Settings']];
  const head = `<div class="page-h adm-h"><div><h1>Admin dashboard</h1>
      <p>The whole portal at a glance: who uses it, which programmes are ready, and what changed.</p></div>
      <button class="btn sm" data-adm-refresh="1">${adminUi.loading ? 'Loading…' : 'Refresh'}</button></div>
    <div class="tabs adm-tabs" role="tablist">${tabs.map(([k, l]) =>
      `<button role="tab" data-adm-tab="${k}" aria-selected="${adminUi.tab === k}">${l}</button>`).join('')}</div>`;
  if (adminUi.err) return `<div class="wrap">${head}<div class="chk warn"><span class="ic">!</span><span class="tx"><p>${esc(adminUi.err)}</p></span></div></div>`;
  if (!d) return `<div class="wrap">${head}<p class="note">Loading the dashboard…</p></div>`;
  const body = adminUi.tab === 'programmes' ? adminProgrammes(d)
    : adminUi.tab === 'access' ? adminAccess(d)
    : adminUi.tab === 'activity' ? adminActivity()
    : adminUi.tab === 'settings' ? adminSettings(d)
    : adminOverviewTab(d);
  return `<div class="wrap adm">${head}${body}
    <p class="note adm-foot">Updated ${esc(adminAgo(d.generatedAt))}.</p></div>`;
}

function adminOverviewTab(d) {
  const progs = d.structure.list;
  const ready = progs.filter(p => p.plan === 'ready' || p.plan === 'built-in').length;
  const toCheck = progs.filter(p => p.plan === 'to check').length;
  const noAdvisor = progs.filter(p => !p.advisors).length;
  const s = d.security, sys = d.system;
  const attention = [];
  if (!sys.storageOk) attention.push(['urgent', 'Storage is failing. Changes are not being saved; check the database on Railway.']);
  if (d.settings.readOnly) attention.push(['watch', 'The portal is read-only for everyone except superadmins.']);
  if (!sys.mail) attention.push(['watch', 'Email is not set up, so invitations and password resets cannot be sent.']);
  if (s.failedToday >= 10) attention.push(['watch', s.failedToday + ' failed sign-ins in the last 24 hours. Check Activity for the addresses.']);
  if (s.lockedOut) attention.push(['watch', s.lockedOut + ' sign-in ' + (s.lockedOut === 1 ? 'is' : 'are') + ' locked for a few minutes after too many wrong passwords.']);
  if (d.people.invitePending) attention.push(['info', d.people.invitePending + ' staff have not set up their account yet.', 'access']);
  if (toCheck) attention.push(['info', toCheck + ' study plans were read from the catalogue and still need checking.', 'programmes']);
  return `
    ${attention.length ? `<div class="adm-attn">${attention.map(([tone, text, tab]) =>
      `<div class="adm-attn-row ${tone}"><span class="dot"></span><span>${esc(text)}</span>${tab ? `<button class="btn ghost sm" data-adm-tab="${tab}">Open</button>` : ''}</div>`).join('')}</div>` : ''}
    <div class="tiles adm-tiles">
      ${adminTile('Staff', d.people.active, d.people.withAccount + ' with an account', '', 'data-adm-tab="access" role="button" tabindex="0"')}
      ${adminTile('Online now', s.activeSessions, 'open sessions', '', 'data-adm-tab="access" role="button" tabindex="0"')}
      ${adminTile('Students', d.students.total, d.students.advisorsWithStudents + (d.students.advisorsWithStudents === 1 ? ' advisor' : ' advisors') + ' with students')}
      ${adminTile('Programmes', d.structure.programmes, d.structure.faculties + ' faculties, ' + d.structure.departments + ' departments', '', 'data-adm-tab="programmes" role="button" tabindex="0"')}
      ${adminTile('Ready to advise', ready, 'of ' + progs.length + ' programmes', ready ? 'is-ok' : '')}
      ${adminTile('Without advisor', noAdvisor, 'programmes', noAdvisor ? 'is-watch' : '')}
      ${adminTile('Sign-ins today', s.signinsToday, s.failedToday + ' failed', s.failedToday >= 10 ? 'is-watch' : '')}
    </div>
    <div class="adm-grid">
      <div class="panel"><div class="hd">Roles</div><div class="bd adm-kv">
        ${Object.keys(d.people.roles).sort().map(r => `<div><span>${esc(r)}</span><b>${d.people.roles[r]}</b></div>`).join('') || '<p class="note">No roles yet.</p>'}
        <div><span>Deactivated</span><b>${d.people.deactivated}</b></div>
      </div></div>
      <div class="panel"><div class="hd">System health</div><div class="bd adm-kv">
        <div><span>Storage</span><b class="${sys.storageOk ? 'ok' : 'bad'}">${esc(sys.storage)}${sys.storageOk ? '' : ' (failing)'}</b></div>
        <div><span>Email</span><b class="${sys.mail ? 'ok' : 'bad'}">${sys.mail ? 'On' : 'Off'}</b></div>
        <div><span>Student imports</span><b>${sys.imports ? 'On' : 'Off'}</b></div>
        <div><span>Running for</span><b>${esc(adminUptime(sys.uptimeSeconds))}</b></div>
        <div><span>Memory</span><b>${sys.memoryMb} MB</b></div>
        <div><span>Stored records</span><b>${sys.records} (${sys.dataMb} MB)</b></div>
        <div><span>Sessions</span><b>${sys.sessionHours} h, idle ${sys.idleMinutes} min</b></div>
        <div><span>Staff email</span><b>@${esc(sys.staffDomains.join(', @'))}</b></div>
      </div></div>
      <div class="panel"><div class="hd">Latest activity <button class="btn ghost sm" style="margin-left:auto" data-adm-tab="activity">All</button></div>
        <div class="alist">${(adminUi.events || []).slice(0, 7).map(adminEventRow).join('') || '<p class="note" style="padding:14px 16px">Nothing yet.</p>'}</div></div>
    </div>`;
}

function adminProgrammes(d) {
  const faculties = Array.from(new Set(d.structure.list.map(p => p.faculty)));
  const f = adminUi.progFilter, fac = adminUi.facFilter;
  const rows = d.structure.list.filter(p => (!fac || p.faculty === fac)
    && (f === 'all' || (f === 'noadvisor' && !p.advisors) || (f === 'check' && p.plan === 'to check')
      || (f === 'missing' && p.plan === 'missing') || (f === 'ready' && (p.plan === 'ready' || p.plan === 'built-in'))));
  const planTag = p => p.plan === 'ready' || p.plan === 'built-in' ? '<span class="tag ok">Ready</span>'
    : p.plan === 'to check' ? '<span class="tag watch">To check</span>' : '<span class="tag urgent">No study plan</span>';
  const chip = (k, l) => `<button class="adm-chip" data-adm-prog="${k}" aria-pressed="${f === k}">${l}</button>`;
  return `<p class="note adm-lead">A programme is ready to advise when it has a checked study plan and at least one advisor. Open one to finish setting it up.</p>
    <div class="adm-filters">
      ${chip('all', 'All')}${chip('ready', 'Ready')}${chip('check', 'Plan to check')}${chip('missing', 'No plan')}${chip('noadvisor', 'No advisor')}
      <select data-adm-fac aria-label="Faculty"><option value="">All faculties</option>${faculties.map(x =>
        `<option ${fac === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
    </div>
    <div class="panel"><div class="ptable-wrap"><table class="ptable adm-table">
      <thead><tr><th>Programme</th><th>Faculty / department</th><th>Study plan</th><th class="n">Advisors</th><th class="n">Students</th><th></th></tr></thead>
      <tbody>${rows.map(p => `<tr>
        <td><b>${esc(p.name)}</b>${p.campuses.length ? `<br><span class="adm-sub2">${esc(p.campuses.join(' · '))}</span>` : ''}</td>
        <td><span class="adm-sub">${esc(p.faculty.replace(/^Faculty of /, ''))}</span><br><span class="adm-sub2">${esc(p.department)}</span></td>
        <td>${planTag(p)}<br><span class="adm-sub2">${p.rules === 'own' ? 'Own rules' : 'University rules'}</span></td>
        <td class="n ${p.advisors ? '' : 'adm-zero'}">${p.advisors}</td>
        <td class="n">${p.students}</td>
        <td class="adm-act"><button class="btn sm" data-adm-open-prog="${esc(p.id)}">Set up</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="note">No programmes match.</td></tr>'}</tbody>
    </table></div></div>`;
}

function adminAccess(d) {
  const q = adminUi.peopleQ.trim().toLowerCase();
  const list = d.people.list.filter(p => !q || [p.name, p.email, p.roles.map(adminRoleText).join(' ')].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || (b.lastSignIn || 0) - (a.lastSignIn || 0));
  return `<div class="adm-filters">
      <input type="search" data-adm-peopleq placeholder="Search name, email or role" value="${esc(adminUi.peopleQ)}" style="max-width:360px">
      <button class="btn sm danger" data-adm-endall="1" style="margin-left:auto">Sign everyone else out</button>
    </div>
    <div class="panel"><div class="ptable-wrap"><table class="ptable adm-table">
      <thead><tr><th>Person</th><th>Roles</th><th>Account</th><th>Last sign-in</th><th class="n">Students</th><th></th></tr></thead>
      <tbody>${list.map(p => `<tr class="${p.active ? '' : 'gone'}">
        <td><b>${esc(p.name || p.slug)}</b>${p.online ? ' <span class="tag ok">Online</span>' : ''}<br><span class="adm-sub2">${esc(p.email || '')}</span></td>
        <td class="adm-sub2">${p.roles.map(r => esc(adminRoleText(r))).join('<br>')}</td>
        <td>${!p.active ? '<span class="tag urgent">Deactivated</span>' : p.verified ? '<span class="tag ok">Active</span>' : '<span class="tag watch">Invite pending</span>'}</td>
        <td class="adm-sub2">${esc(adminAgo(p.lastSignIn))}</td>
        <td class="n">${p.students}</td>
        <td>${p.online && p.slug !== state.me.slug ? `<button class="btn sm" data-adm-end="${esc(p.slug)}">Sign out</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="note">No one matches.</td></tr>'}</tbody>
    </table></div></div>
    <p class="note adm-lead">To invite someone, change their roles or deactivate them, use <button class="linkish" data-view="people">People</button>.</p>`;
}

function adminEventRow(e) {
  const label = ADMIN_ACTIONS[e.action] || e.action;
  const bad = e.action === 'signin-failed' || e.action === 'person-deactivated' || e.action === 'students-clear';
  const target = e.target ? ' · ' + adminName(e.target) : e.key ? ' · ' + e.key : '';
  return `<div class="al adm-ev"><span class="adm-dot ${bad ? 'bad' : ''}"></span><span class="body">
    <span class="t">${esc(label)}<span class="adm-sub2">${esc(target)}${e.count != null ? ' (' + esc(String(e.count)) + ')' : ''}</span></span>
    <span class="m">${esc(adminName(e.actor) || 'Unknown')} · ${esc(adminAgo(e.at))}${e.ip ? ' · ' + esc(e.ip) : ''}</span></span></div>`;
}

function adminActivity() {
  const events = adminUi.events || [];
  const kinds = Array.from(new Set(events.map(e => e.action))).sort();
  const list = events.filter(e => !adminUi.actFilter || e.action === adminUi.actFilter);
  return `<div class="adm-filters">
      <select data-adm-act aria-label="Kind of event"><option value="">All events (${events.length})</option>${kinds.map(k =>
        `<option value="${esc(k)}" ${adminUi.actFilter === k ? 'selected' : ''}>${esc(ADMIN_ACTIONS[k] || k)}</option>`).join('')}</select>
      <button class="btn sm" data-adm-csv="1">Download CSV</button>
    </div>
    <div class="panel"><div class="alist">${list.map(adminEventRow).join('') || '<p class="note" style="padding:14px 16px">No events.</p>'}</div></div>
    <p class="note adm-lead">The last 600 events are kept here, without any student details. The full audit log is kept separately in the database and cannot be changed from the portal.</p>`;
}

function adminSettings(d) {
  const s = d.settings;
  return `<div class="adm-grid two">
    <div class="panel"><div class="hd">Message for everyone</div><div class="bd stack">
      <p class="note">Shown at the top of every page after sign-in, for example registration dates or planned maintenance. Leave empty to hide it.</p>
      <textarea id="admBanner" maxlength="300" rows="3" placeholder="For example: Registration for Spring opens on Monday.">${esc(s.banner)}</textarea>
      <label class="f check"><input type="checkbox" id="admBannerWarn" ${s.bannerTone === 'warn' ? 'checked' : ''}> Show it as a warning</label>
      <div><button class="btn primary sm" data-adm-save-banner="1">Save message</button></div>
    </div></div>
    <div class="panel"><div class="hd">Read-only mode</div><div class="bd stack">
      <p class="note">While it is on, advisors and faculty admins can still open everything but cannot import, edit or delete. Use it while the semester or the study plans are being set up.</p>
      <p><b>${s.readOnly ? 'On: only superadmins can change things.' : 'Off: everyone can work normally.'}</b></p>
      <div><button class="btn sm ${s.readOnly ? 'primary' : 'danger'}" data-adm-readonly="${s.readOnly ? 'off' : 'on'}">${s.readOnly ? 'Turn read-only off' : 'Turn read-only on'}</button></div>
    </div></div>
    <div class="panel"><div class="hd">Deployment settings</div><div class="bd adm-kv">
      <div><span>Superadmin account</span><b>${esc(d.system.superadminEmail || 'not set')}</b></div>
      <div><span>Staff email domains</span><b>${esc(d.system.staffDomains.join(', '))}</b></div>
      <div><span>Public address set</span><b>${d.system.publicUrl ? 'Yes' : 'No'}</b></div>
      <div><span>Node.js</span><b>${esc(d.system.node)}</b></div>
      <p class="note">These come from the Railway variables (SUPERADMIN_EMAIL, STAFF_EMAIL_DOMAINS, PUBLIC_URL). See DEPLOY.md.</p>
    </div></div>
  </div>`;
}

function adminCsv() {
  const rows = [['time', 'event', 'by', 'target', 'ip']].concat((adminUi.events || []).map(e =>
    [e.at, ADMIN_ACTIONS[e.action] || e.action, adminName(e.actor), e.target ? adminName(e.target) : (e.key || ''), e.ip || '']));
  // neutralise spreadsheet formulas (CSV injection) and quote every cell
  const cell = v => '"' + String(v == null ? '' : v).replace(/^([=+\-@\t\r])/, "'$1").replace(/"/g, '""') + '"';
  const blob = new Blob([rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'portal-activity-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function adminSaveSettings(patch, done) {
  try {
    adminUi.data.settings = await Store.adminCall('settings', patch);
    await Store.whoAmI();
    toast(done);
  } catch (e) { toast(e.message || 'That did not work.'); }
  render();
}

async function adminClick(t) {
  const tab = t.closest('[data-adm-tab]');
  if (tab) { adminUi.tab = tab.dataset.admTab; render(); return true; }
  if (t.closest('[data-adm-refresh]')) { await loadAdmin(true); toast('Dashboard updated.'); return true; }
  const prog = t.closest('[data-adm-prog]');
  if (prog) { adminUi.progFilter = prog.dataset.admProg; render(); return true; }
  const open = t.closest('[data-adm-open-prog]');
  if (open) {
    const id = open.dataset.admOpenProg;
    if (id !== activeProgramme()) await switchProgramme(id);
    state.view = 'programme'; render(); window.scrollTo(0, 0); return true;
  }
  const end = t.closest('[data-adm-end]');
  if (end) {
    const slug = end.dataset.admEnd;
    if (!confirm('Sign ' + adminName(slug) + ' out on every device?')) return true;
    try { const r = await Store.adminCall('sessions/end', { slug }); toast(r.ended + ' session' + (r.ended === 1 ? '' : 's') + ' ended.'); }
    catch (e) { toast(e.message); }
    await loadAdmin(true); return true;
  }
  if (t.closest('[data-adm-endall]')) {
    if (!confirm('Sign everyone except you out on every device? They can sign straight back in.')) return true;
    try { const r = await Store.adminCall('sessions/end', { all: true }); toast(r.ended + ' sessions ended.'); }
    catch (e) { toast(e.message); }
    await loadAdmin(true); return true;
  }
  if (t.closest('[data-adm-csv]')) { adminCsv(); return true; }
  if (t.closest('[data-adm-save-banner]')) {
    await adminSaveSettings({ banner: $('#admBanner').value, bannerTone: $('#admBannerWarn').checked ? 'warn' : 'info' },
      $('#admBanner').value.trim() ? 'Message saved. Everyone sees it on their next page load.' : 'Message removed.');
    return true;
  }
  const ro = t.closest('[data-adm-readonly]');
  if (ro) {
    const on = ro.dataset.admReadonly === 'on';
    if (on && !confirm('Make the portal read-only for everyone except superadmins?')) return true;
    await adminSaveSettings({ readOnly: on }, on ? 'The portal is now read-only.' : 'Everyone can work normally again.');
    return true;
  }
  return false;
}

function adminInput(t) {
  if (t.matches('[data-adm-peopleq]')) {
    adminUi.peopleQ = t.value; const pos = t.selectionStart; render();
    const el = document.querySelector('[data-adm-peopleq]'); if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    return true;
  }
  if (t.matches('[data-adm-fac]')) { adminUi.facFilter = t.value; render(); return true; }
  if (t.matches('[data-adm-act]')) { adminUi.actFilter = t.value; render(); return true; }
  return false;
}

/* The banner a superadmin set, shown above every page. */
function portalBanner() {
  const n = Store.isServer() && Store.notice ? Store.notice() : null;
  if (!n) return '';
  const parts = [];
  if (n.readOnly && !(state.me && state.me.superadmin)) parts.push(['warn', 'The portal is read-only for now while it is being set up. You can look at everything, but changes will not be saved.']);
  if (n.banner) parts.push([n.tone, n.banner]);
  return parts.map(([tone, text]) => `<div class="portal-banner ${tone}" role="status">${esc(text)}</div>`).join('');
}
