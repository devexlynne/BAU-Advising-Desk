/*
 * store.js - client storage layer.
 * On the portal server, every read and write goes through the authenticated
 * API. Opened as a local file (no server), data is kept in this browser's
 * localStorage instead, for demos and offline use.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Store = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let db = null;
  const demoStorage = new Map();
  let ready = false;
  let lastError = '';
  let lastUnverified = false;   // last sign-in hit an account still waiting for its email link
  let api = false;          // true = the portal server is behind the page
  let offlineDemo = false;

  let mailOn = false;
  let amAdmin = false;

  async function init() {
    if (ready) return db;
    // Backends, best first: 1. the portal server (whole department shares data)
    // 2. this browser only.
    // Only probe /health over http(s). From file:// or a preview
    // there's no server and the fetch just spams the console.
    const onWeb = /^https?:$/.test(location.protocol);
    // A page served by the portal server is marked SERVED: it always uses the
    // server, even if the health check below fails (no silent local fallback).
    api = !!(typeof window !== 'undefined' && window.SERVED);
    offlineDemo = !!(typeof window !== 'undefined' && window.OFFLINE_DEMO === true);
    if (onWeb) {
      try {
        const r = await fetch('/health', { cache: 'no-store' });
        const j = await r.json();
        if (r.ok && j && j.ok) api = true;
        mailOn = !!(j && j.mail);
      } catch (e) { /* api keeps the SERVED value */ }
    }
    if (!api && !offlineDemo) {
      throw new Error('Offline storage is disabled. Open the official advising portal to continue.');
    }
    // Offline demo only: start from the fictional students in demo/students.json.
    // They live in memory like everything else in the demo and vanish on reload.
    const demo = !api && offlineDemo && typeof window !== 'undefined' ? window.DEMO_DATA : null;
    if (demo && demo.advisor && Array.isArray(demo.students) && !demoStorage.size) {
      const list = {};
      demo.students.forEach(s => { if (s && s.id && s.demo === true) list[s.id] = s; });
      lsSet('bau.col.advisors/' + demo.advisor + '/students', list);
    }
    ready = true;
    return db;
  }

  // ---- server calls -------------------------------------------------------

  // Session cookie goes with every call. Access control is the server's job.
  async function post(route, payload) {
    const r = await fetch(route, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    let body = {};
    try { body = await r.json(); } catch (e) { /* no body */ }
    if (!r.ok) { const err = new Error(body.error || 'that did not work'); err.status = r.status; throw err; }
    return body;
  }
  const apiGet = async path => (await post('/api/get', { path })).data;
  const apiList = async path => (await post('/api/list', { path })).data;
  const apiPut = async (path, value) => { await post('/api/set', { path, value }); };
  const apiDel = async path => { await post('/api/delete', { path }); };

  // ---- memory-only demo storage ------------------------------------------
  function lsGet(key, dflt) {
    return demoStorage.has(key) ? demoStorage.get(key) : dflt;
  }
  function lsSet(key, value) {
    demoStorage.set(key, value);
    return true;
  }

  async function docGet(path, dflt) {
    if (api) {
      // careful: no local fallback in server mode, it would show records the
      // server just refused. Let it throw.
      const v = await apiGet(path);
      return (v === null || v === undefined) ? dflt : v;
    }
    if (db) {
      try { const d = await db.doc(path).get(); if (d && d.data) return d.data; }
      catch (e) { /* fall through to local */ }
    }
    return lsGet('bau.' + path, dflt);
  }
  async function docSet(path, value) {
    if (api) { await apiPut(path, value); return value; }
    lsSet('bau.' + path, value);
    if (db) { try { await db.doc(path).set(value); } catch (e) { /* kept locally */ } }
    return value;
  }
  async function colList(path) {
    const out = {};
    if (api) {
      const v = await apiList(path);
      Object.keys(v || {}).forEach(k => { out[k] = v[k]; });
      return out;
    }
    const local = lsGet('bau.col.' + path, {});
    Object.keys(local).forEach(k => { out[k] = local[k]; });
    if (db) {
      try {
        const docs = await db.collection(path).get();
        (docs || []).forEach(d => { const v = d.data || d; if (v && v.id) out[v.id] = v; });
      } catch (e) { /* local only */ }
    }
    return out;
  }
  async function colSet(path, id, value) {
    if (api) { await apiPut(path + '/' + id, value); return; }
    const local = lsGet('bau.col.' + path, {});
    local[id] = value;
    lsSet('bau.col.' + path, local);
    if (db) { try { await db.doc(path + '/' + id).set(value); } catch (e) { /* kept locally */ } }
  }
  async function colDel(path, id) {
    if (api) { await apiDel(path + '/' + id); return; }
    const local = lsGet('bau.col.' + path, {});
    delete local[id];
    lsSet('bau.col.' + path, local);
    if (db) { try { await db.doc(path + '/' + id).delete(); } catch (e) { /* kept locally */ } }
  }

  // ---- passwords ----------------------------------------------------------
  function toHex(buf) {
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function randomSalt() {
    const a = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a) : a.fill(7);
    return toHex(a.buffer);
  }
  async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    try {
      const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode('bau:' + salt), iterations: 150000, hash: 'SHA-256' }, key, 256);
      return 'pbkdf2$' + toHex(bits);
    } catch (e) {
      try {
        const d = await crypto.subtle.digest('SHA-256', enc.encode('bau:' + salt + ':' + password));
        return 'sha256$' + toHex(d);
      } catch (e2) {
        let h = 0; const s = salt + password;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
        return 'weak$' + h;
      }
    }
  }

  // ---- accounts -----------------------------------------------------------
  const acctPath = slug => 'advisors/' + slug + '/account';

  // Server never sends account records or password hashes.
  async function getAccount(slug) {
    if (api) return null;
    return await docGet(acctPath(slug), null);
  }

  async function createAccount(slug, email, password) {
    if (api) {
      const r = await post('/api/signup', { slug, email, password });
      return { account: { slug, email }, verify: !!r.verify, email: r.email || email };
    }
    const salt = randomSalt();
    const hash = await hashPassword(password, salt);
    const rec = { slug, email, salt, hash, createdAt: Date.now(), lastSignIn: Date.now() };
    await docSet(acctPath(slug), rec);
    return { account: rec };
  }

  async function checkPassword(slug, password) {
    if (api) {
      lastUnverified = false;
      try { const r = await post('/api/signin', { slug, password }); amAdmin = !!r.admin; return true; }
      catch (e) { lastError = e.message; lastUnverified = e.status === 403; return false; }
    }

    const acct = await getAccount(slug);
    if (!acct) return false;
    const hash = await hashPassword(password, acct.salt);
    if (hash !== acct.hash) return false;
    acct.lastSignIn = Date.now();
    await docSet(acctPath(slug), acct);
    return true;
  }

  async function signIn(email, password) {
    if (!api) return { ok: false, error: 'Sign-in needs the official advising portal.' };
    lastUnverified = false;
    try {
      const result = await post('/api/signin', { email, password });
      amAdmin = !!result.admin;
      return result;
    } catch (e) {
      lastError = e.message;
      lastUnverified = e.status === 403;
      return { ok: false, error: e.message, unverified: lastUnverified };
    }
  }

  async function setPassword(acct, password) {
    const salt = randomSalt();
    acct.salt = salt;
    acct.hash = await hashPassword(password, salt);
    acct.changedAt = Date.now();
    await docSet(acctPath(acct.slug), acct);
    return true;
  }

  // needs the current password
  async function changePassword(slug, current, next) {
    if (api) {
      try { await post('/api/password', { current, next }); return 'ok'; }
      catch (e) { lastError = e.message; return e.status === 401 ? 'wrong-password' : 'failed'; }
    }
    const acct = await getAccount(slug);
    if (!acct) return 'no-account';
    const hash = await hashPassword(current, acct.salt);
    if (hash !== acct.hash) return 'wrong-password';
    await setPassword(acct, next);
    return 'ok';
  }

  async function accountsThatExist(slugs) {
    if (api) {
      const r = await fetch('/api/accounts', { credentials: 'same-origin', cache: 'no-store' });
      const body = await r.json();
      const out = {};
      slugs.forEach(s => { out[s] = !!(body.accounts || {})[s]; });
      return out;
    }
    const out = {};
    for (const s of slugs) out[s] = !!(await getAccount(s));
    return out;
  }

  // ---- email reset + session ----------------------------------------------

  // server emails a reset link to the account's address
  async function requestResetEmail(email) {
    if (!api) return { ok: false, mail: false };
    try { return await post('/api/reset-request', { email }); }
    catch (e) { lastError = e.message; return { ok: false, mail: mailOn, error: e.message }; }
  }

  // second half: token from that email link
  async function resetWithLink(token, password) {
    try {
      const result = await post('/api/reset-with-link', { token, password });
      amAdmin = !!result.admin;
      return result;
    }
    catch (e) { lastError = e.message; return { ok: false, error: e.message }; }
  }

  // new-account email link: token + the password chosen at sign-up
  async function verifyAccount(token, password) {
    try { const r = await post('/api/verify', { token, password }); amAdmin = !!r.admin; return r; }
    catch (e) { lastError = e.message; return { ok: false, error: e.message }; }
  }
  async function resendVerify(slug, password) {
    try { return await post('/api/verify-resend', { slug, password }); }
    catch (e) { lastError = e.message; return { ok: false, error: e.message }; }
  }

  // who's signed in, per the server
  async function whoAmI() {
    if (!api) return null;
    try {
      const r = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
      const body = await r.json();
      amAdmin = !!body.admin;
      mailOn = !!body.mail;
      return body.slug || null;
    } catch (e) { return null; }
  }

  // ---- admin view ---------------------------------------------------------

  // every advisor's list, keyed by advisor. Server checks admin rights.
  async function allStudents() {
    if (!api) return {};
    // a failure throws: an empty answer would look like 'nobody has any students'
    // and an import would then treat everyone as new
    const r = await post('/api/all-students', {});
    if (!r || typeof r.advisors !== 'object') throw new Error('Could not load the department lists.');
    return r.advisors;
  }

  async function loadPeople() {
    if (!api) return [];
    return (await post('/api/people/list', {})).people || [];
  }

  async function loadOrgTree() {
    if (!api) return null;
    return (await post('/api/org/tree', {})).tree || null;
  }

  async function invitePerson(person, roles) {
    return post('/api/people/invite', { person, roles });
  }

  async function updatePerson(slug, person, roles) {
    return post('/api/people/update', { slug, person, roles });
  }

  async function deactivatePerson(slug) {
    return post('/api/people/deactivate', { slug });
  }

  // Sends from the dept mailbox, full message, no length limit.
  // Server only, and only if a mailbox is configured.
  async function sendMail(payload) {
    if (!api) throw new Error('Sending needs the department server.');
    return post('/api/send', payload);
  }
  async function signOutServer() {
    if (!api) return;
    try { await post('/api/signout', {}); } catch (e) { /* the cookie expires anyway */ }
  }

  // ---- students -----------------------------------------------------------
  const studentsPath = slug => 'advisors/' + slug + '/students';
  const metaPath = slug => 'advisors/' + slug + '/meta';

  async function loadStudents(slug, baseline) {
    const meta = (await docGet(metaPath(slug), { removed: [] })) || { removed: [] };
    const removed = new Set(meta.removed || []);
    const saved = await colList(studentsPath(slug));
    const out = [];
    const seen = new Set();
    (baseline || []).forEach(s => {
      if (removed.has(s.id)) return;
      if (saved[s.id]) { out.push(saved[s.id]); seen.add(s.id); return; }
      out.push(s); seen.add(s.id);
    });
    Object.keys(saved).forEach(id => {
      if (seen.has(id) || removed.has(id)) return;
      out.push(saved[id]);
    });
    return out;
  }

  async function saveStudent(slug, student) {
    student.updatedAt = Date.now();
    await colSet(studentsPath(slug), student.id, student);
    const meta = (await docGet(metaPath(slug), { removed: [] })) || { removed: [] };
    if ((meta.removed || []).includes(student.id)) {
      meta.removed = meta.removed.filter(x => x !== student.id);
      await docSet(metaPath(slug), meta);
    }
    return student;
  }

  async function saveStudents(slug, list) {
    // Imports can touch hundreds of large transcript records. One authenticated
    // request is faster and cannot leave half an import behind if a tab closes.
    if (api) {
      await post('/api/students/save', { students: list, advisor: slug });
      return;
    }
    for (const s of list) await saveStudent(slug, s);
  }

  async function removeStudent(slug, id) {
    await colDel(studentsPath(slug), id);
    const meta = (await docGet(metaPath(slug), { removed: [] })) || { removed: [] };
    meta.removed = (meta.removed || []).concat([id]).filter((v, i, a) => a.indexOf(v) === i);
    await docSet(metaPath(slug), meta);
  }

  // Start over: drop every record this advisor saved and the removed list.
  async function clearStudents(slug) {
    if (api) return (await post('/api/students/clear', { advisor: slug })).cleared || 0;
    const saved = await colList(studentsPath(slug));
    for (const id of Object.keys(saved)) await colDel(studentsPath(slug), id);
    await docSet(metaPath(slug), { removed: [] });
    return Object.keys(saved).length;
  }

  // ---- course offering ----------------------------------------------------
  async function loadOffering(termCode, bundled) {
    const saved = await docGet('offering/' + termCode, null);
    if (saved && saved.sections && saved.sections.length) return saved;
    return bundled;
  }
  async function saveOffering(termCode, payload) {
    return await docSet('offering/' + termCode, payload);
  }

  // ---- suggestions board --------------------------------------------------
  async function loadIdeas() {
    const all = await colList('ideas');
    return Object.keys(all).map(k => all[k]).filter(Boolean)
      .sort((a, b) => (b.at || 0) - (a.at || 0));
  }
  // With a server: it signs it and emails whoever maintains the portal.
  // Without one it just lands on this browser's board.
  // admin only: a single-use reset link for an advisor, to send by hand
  async function adminClearPassword(slug) {
    if (!api) throw new Error('This needs the department server.');
    return post('/api/admin/clear-password', { slug });
  }
  async function adminResetLink(slug) {
    if (!api) throw new Error('Reset links need the department server.');
    return post('/api/admin/reset-link', { slug });
  }
  async function postIdea(kind, text, by) {
    if (api) {
      const r = await post('/api/idea', { kind, text, by });
      return { idea: r.idea, emailed: !!r.emailed, to: r.to };
    }
    const idea = { id: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      kind, text, by, at: Date.now(), votes: [] };
    await colSet('ideas', idea.id, idea);
    return { idea, emailed: false, to: null };
  }
  async function saveIdea(idea) { await colSet('ideas', idea.id, idea); return idea; }
  async function removeIdea(id) { await colDel('ideas', id); }

  // ---- branding, advisor settings, dept rules -----------------------------

  // sign-in page cover photo (dept picks it)
  async function getCover() { return await docGet('brand/cover', null); }
  async function saveCover(dataUrl) { return await docSet('brand/cover', dataUrl); }

  async function getSettings(slug) {
    return (await docGet('advisors/' + slug + '/settings', { dismissed: [], term: null })) || { dismissed: [], term: null };
  }
  async function saveSettings(slug, s) { return await docSet('advisors/' + slug + '/settings', s); }

  // only the admin's overrides, shipped rules stay in rules.json
  // one study plan per programme; the server checks it before keeping it
  async function getProgramme(id) { return await docGet('programmes/' + id + '/catalog', null); }
  async function saveProgramme(id, catalog) {
    if (api) return await post('/api/set', { path: 'programmes/' + id + '/catalog', value: catalog });
    lsSet('bau.programmes/' + id + '/catalog', catalog);
    return { ok: true, warnings: [] };
  }
  async function saveOrgTree(tree) {
    if (!api) throw new Error('Changing the university structure needs the portal server.');
    return (await post('/api/org/tree', { tree })).tree;
  }

  async function getConfig(dept) { return await docGet('config/' + dept + '/rules', null); }
  async function saveConfig(dept, cfg) { return await docSet('config/' + dept + '/rules', cfg); }

  return {
    getConfig, saveConfig, getProgramme, saveProgramme, saveOrgTree,
    init, isShared: () => api || !!db, isServer: () => api,
    whoAmI, signOutServer, lastError: () => lastError,
    isAdmin: () => amAdmin, mailReady: () => mailOn, allStudents, loadPeople, loadOrgTree,
    invitePerson, updatePerson, deactivatePerson, sendMail, adminResetLink, adminClearPassword,
    mailReset: () => mailOn, requestResetEmail, resetWithLink,
    verifyAccount, resendVerify, signIn, lastUnverified: () => lastUnverified,
    getAccount, createAccount, checkPassword, accountsThatExist,
    changePassword,
    loadStudents, saveStudent, saveStudents, removeStudent, clearStudents,
    loadOffering, saveOffering, getSettings, saveSettings, getCover, saveCover,
    loadIdeas, postIdea, saveIdea, removeIdea
  };
});
