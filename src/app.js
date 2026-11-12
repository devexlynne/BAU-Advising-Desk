(function () {
'use strict';

const E = window.Engine, C = window.CATALOG, R = window.RULES;
let FACULTY = [];
const BASE_OFFERING = window.OFFERING;
const BRAND = window.BRAND || {};
let MAP = E.byCode(C);

// title is per person (most of the dept are Dr., one isn't), so it lives on
// the person record instead of being hardcoded everywhere
const honorificOf = p => (p && p.honorific !== undefined) ? p.honorific : 'Dr.';
const fullName = p => (honorificOf(p) ? honorificOf(p) + ' ' : '') + (p ? p.name : '');
const personName = p => (honorificOf(p) ? honorificOf(p) + ' ' : '') + String(p && p.name || '').split(' ')[0];

const $ = s => document.querySelector(s);
/*__I18N__*/
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nice = s => String(s || '')
  .replace(/\b([A-Z])([A-Z']+)\b/g, (m, a, b) => a + b.toLowerCase())
  .replace(/\b(i|ii|iii|iv|v)\b/gi, m => m.toUpperCase());

const state = {
  me: null, students: [], people: [], orgTree: null, offering: BASE_OFFERING,
  // two terms, don't mix them up:
  // term     - semester running now (what the schedules describe)
  // planTerm - semester we're advising for (what recommendations target)
  term: BASE_OFFERING.term,
  planTerm: null,
  view: 'students', sel: null, tab: 'progress', q: '', filter: 'all', cover: null,
  chat: [], ideas: [], help: [], advisorFilter: 'all',
  // admin's cross-department view, fetched once per sign-in
  everyone: null, everyoneErr: ''
};
state.planTerm = E.nextTermAfter(state.term);

// ---- the academic calendar ------------------------------------------------
/* Which term is "now", and whether students can still register, comes from
   the dates the admin keeps in Rules › Calendar. ?today=YYYY-MM-DD in the
   address bar lets you preview another day. */
const todayISO = () => {
  const q = /[?&]today=(\d{4}-\d{2}-\d{2})/.exec(location.search || '');
  if (q) return q[1];
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
function syncTerm() {
  const cal = E.calendarNow(R, todayISO());
  state.cal = cal;
  if (cal) { state.term = cal.term; state.nextTerm = cal.next; }
  else state.nextTerm = E.nextTermAfter(state.term);
  state.planTerm = state.nextTerm;
}
const fmtDay = iso => { const d = new Date(iso + 'T12:00:00'); return d.getDate() + ' ' + d.toLocaleString('en-GB', { month: 'short' }); };
function phaseLine() {
  const c = state.cal;
  if (!c) return 'planning <b>' + esc(shortTerm(state.nextTerm)) + '</b>';
  if (c.phase === 'upcoming') return c.dates.regOpens ? 'registration opens <b>' + fmtDay(c.dates.regOpens) + '</b>' : 'registration soon';
  if (c.phase === 'registration') return '<b>registration open</b>';
  if (c.phase === 'adddrop') return 'add/drop until <b>' + fmtDay(c.dates.addDropEnds) + '</b>';
  return 'planning <b>' + esc(shortTerm(c.next)) + '</b>';
}
// registered for the running term?
const regFor = s => !!(s.registration && (s.registration.courses || []).length
  && (!s.registration.term || s.registration.term === state.term));
/* the term to plan for this student: the running term while registration or
   add/drop is open and they are not registered yet, otherwise the next one.
   No calendar loaded: unregistered students plan this term. */
const planTargetFor = s => (!regFor(s) && (!state.cal || state.cal.canRegister)) ? state.term : state.nextTerm;

/* logo is inlined so we don't depend on an image host. Full colour for light
   backgrounds, white for the maroon bar. Falls back to the drawn mark below. */
function logoFull(h) {
  if (!BRAND.full) return crest(h);
  return `<img class="logo" src="${BRAND.full}" alt="Beirut Arab University" style="height:${h}px">`;
}
function logoWhite(h) {
  if (!BRAND.white) return crest(h);
  return `<img class="logo" src="${BRAND.white}" alt="Beirut Arab University" style="height:${h}px">`;
}

// drawn campus arcade (arches + palms). Put a JPEG in data/brand.json as
// `campus` to use a photo instead.
// greeting by hour
function hello() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning. Let us see who needs you today.';
  if (h < 18) return 'Good afternoon. The lists are ready.';
  return 'Good evening. A quick look before you go?';
}

// cover: dept banner if loaded, drawn version otherwise
function coverBanner() {
  return `<div class="hero">
    ${campusArt()}
    <div class="hero-in">
      <div class="crest">${logoWhite(58)}</div>
      <h1>Online Advising System</h1>
      <p>Beirut Arab University<i class="sep-dot" aria-hidden="true"></i>Academic advising</p>
      <div class="sub">${esc(hello())}</div>
    </div>
  </div>`;
}

function campusArt() {
  const photo = state.cover || BRAND.campus;
  if (photo) return `<img class="hero-photo" src="${esc(/^data:image\/(png|jpe?g|webp);base64,/.test(String(photo)) ? photo : BRAND.campus || '')}" alt="Beirut Arab University campus">`;
  const arch = (x, w, h) => `<path d="M${x} 150 V${150 - h + w / 2} a${w / 2} ${w / 2} 0 0 1 ${w} 0 V150 Z"
    fill="rgba(0,0,0,.18)"/>`;
  let arches = '';
  for (let i = 0; i < 9; i++) arches += arch(18 + i * 52, 34, 74);
  const palm = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" fill="none"
    stroke="rgba(255,255,255,.34)" stroke-width="3" stroke-linecap="round">
    <path d="M0 0 V-46"/><path d="M0 -46c-14 -3 -24 3 -30 13"/><path d="M0 -46c14 -3 24 3 30 13"/>
    <path d="M0 -46c-9 -10 -21 -13 -33 -10"/><path d="M0 -46c9 -10 21 -13 33 -10"/>
    <path d="M0 -46c0 -13 -6 -21 -15 -26"/><path d="M0 -46c0 -13 6 -21 15 -26"/></g>`;
  return `<svg class="hero-art" viewBox="0 0 500 150" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <circle cx="410" cy="34" r="20" fill="rgba(255,255,255,.10)"/>
    ${arches}
    <rect x="0" y="146" width="500" height="4" fill="rgba(0,0,0,.22)"/>
    ${palm(58, 150, 1)}${palm(455, 150, .86)}
  </svg>`;
}

function crest(size) {
  const w = size || 54;
  return `<svg width="${w}" height="${w}" viewBox="0 0 64 64" role="img" aria-label="Beirut Arab University">
    <defs><clipPath id="cShield"><path d="M32 3 57 12v22c0 14-10 23-25 27C17 57 7 48 7 34V12z"/></clipPath></defs>
    <path d="M32 3 57 12v22c0 14-10 23-25 27C17 57 7 48 7 34V12z" fill="var(--topbar)"/>
    <g clip-path="url(#cShield)">
      <path d="M7 41h50v6H7z" fill="#fff" opacity=".1"/>
      <path d="M7 48h50v6H7z" fill="#fff" opacity=".07"/>
    </g>
    <path d="M32 3 57 12v22c0 14-10 23-25 27C17 57 7 48 7 34V12z" fill="none"
      stroke="var(--on-topbar)" stroke-opacity=".5" stroke-width="1.4"/>
    <text x="32" y="30" text-anchor="middle" font-family="var(--serif)" font-weight="700"
      font-size="17" letter-spacing="1" fill="var(--on-topbar)">BAU</text>
    <text x="32" y="43" text-anchor="middle" font-family="var(--sans)" font-weight="600"
      font-size="6.5" letter-spacing=".8" fill="var(--on-topbar)" opacity=".85">1960</text>
  </svg>`;
}

/* students needing attention, colour = severity: red = act now, orange =
   goes into the next plan. Labels match the lanes on Notices. */
const LEVEL = {
  urgent: { word: 'Act now', chip: 'urgent', order: 0 },
  watch: { word: 'Plan ahead', chip: 'watch', order: 1 },
  ok: { word: 'On track', chip: 'ok', order: 2 }
};
const REVIEW_MEANS = 'Students with something to check.';
const OK_MEANS = 'Registered and within the rules.';

const hue = s => { let h = 0; for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) % 360; return h; };
/* avatar colour is hashed from the name so it's stable. Only the hue is set
   here, the stylesheet picks lightness (pastel in light mode, deeper in dark). */
const avatar = n => `--h:${hue(n)}`;

// no photo on the dept page -> initials, tinted from the name
function faceOf(p, cls) {
  const c = 'face' + (cls ? ' ' + cls : '');
  if (p && p.photo) return `<img class="${c}" src="${esc(p.photo)}" alt="">`;
  return `<span class="${c} drawn" style="${avatar(p ? p.name : '')}">${initials(p ? p.name : '')}</span>`;
}
const shortTerm = t => String(t || '').replace(/(\d{4})\/(\d{4})/, (m, a, b) => a.slice(2) + '/' + b.slice(2))
  .replace('FALL', 'Fall').replace('SPRING', 'Spring').replace('SUMMER', 'Summer');
const initials = n => esc(String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase());

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
  document.body.appendChild(el);
  chime('toast');
  setTimeout(() => el.remove(), 2600);
}

// ---- sign in --------------------------------------------------------------
let gateStep = 'pick', gatePerson = null, resetEmail = '';

let resetToken = '';
// new-account email check: token from the link, and what was typed at sign-up (kept in memory only, for "send it again")
let verifyToken = '';
let ideaKind = 'idea';
// help dialog keeps the half-typed text in case it gets closed by accident
let holdKind = '', holdStudent = null;
// Admin reset is deliberately two-step. The selected advisor remains visible
// while the warning is shown, so there is no ambiguity about whose data goes.
let adminClearSlug = null, adminClearAt = 0;


async function boot() {
  applyLang();
  await Store.init();
  const fromVerify = new URLSearchParams(location.search).get('verify');
  if (fromVerify && Store.isServer()) {
    verifyToken = fromVerify;
    gateStep = 'verify';
    drawGate();
    return;
  }
  const fromLink = new URLSearchParams(location.search).get('reset');
  if (fromLink && Store.isServer()) {
    resetToken = fromLink;
    gateStep = 'link';
    drawGate();
    return;
  }
  const who = Store.isServer() ? await Store.whoAmI() : sessionStorage.getItem('bau.session');
  if (who) {
    if (Store.isServer()) {
      FACULTY = await Store.loadPeople();
      state.people = FACULTY;
      state.orgTree = await Store.loadOrgTree();
    } else if (window.OFFLINE_DEMO) {
      const demo = window.DEMO_DATA || {};
      FACULTY = [demo.profile || {
        slug: who, name: 'Demo Advisor', title: 'Demo advisor',
        email: 'demo.advisor@bau.edu.lb', roles: [{ role: 'advisor', scopes: ['cs'] }]
      }];
      state.people = FACULTY;
    }
    const p = FACULTY.find(f => f.slug === who);
    if (p) {
      try { state.cover = await Store.getCover(); } catch (e) { state.cover = null; }
      await signedIn(p, true);
      return;
    }
  }
  if (!Store.isServer()) { try { state.cover = await Store.getCover(); } catch (e) { state.cover = null; } }
  drawGate();
}

function showStartupError(error) {
  console.error('Portal startup failed:', error);
  const app = $('#app'), gate = $('#gate');
  if (app) app.hidden = true;
  if (gate) {
    gate.hidden = false;
    gate.innerHTML = '';
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = 'The secure portal could not start. Open the official advising portal and try again. Your data was not saved in this browser.';
    gate.appendChild(message);
  }
}

function drawGate() {
  $('#app').hidden = true;
  const g = $('#gate'); g.hidden = false;

  // came in from the reset email link
  if (gateStep === 'link') {
    g.innerHTML = `<div class="gate-inner"><div class="card">
      <div class="pic"><div><b>Choose a new password</b><span>Opened from your BAU email</span></div></div>
      <form class="stack" id="linkForm">
        <p class="note">Choose a new password. Your imported records will stay unchanged.</p>
        <label class="f" for="lPass">New password<input id="lPass" type="password" autocomplete="new-password" placeholder="At least 10 characters"></label>
        <label class="f" for="lPass2">Repeat it<input id="lPass2" type="password" autocomplete="new-password"></label>
        <p class="err" id="gateErr" hidden></p>
        <button class="btn primary" type="submit" style="justify-content:center">Set it and sign in</button>
      </form>
    </div></div>`;
    setTimeout(() => { const el = $('#lPass'); if (el) el.focus(); }, 60);
    return;
  }

  // came in from the new-account email link
  if (gateStep === 'verify') {
    g.innerHTML = `<div class="gate-inner"><div class="card">
      <div class="pic"><div><b>Activate your account</b><span>Opened from your BAU email</span></div></div>
      <form class="stack" id="verifyForm">
        <p class="note">Choose a password to activate your invitation. If this is an older account waiting for email verification, enter the password you originally chose.</p>
        <label class="f" for="vPass">Password<input id="vPass" type="password" autocomplete="new-password"></label>
        <label class="f" for="vPass2">Repeat password<input id="vPass2" type="password" autocomplete="new-password"></label>
        <p class="err" id="gateErr" hidden></p>
        <button class="btn primary" type="submit" style="justify-content:center">Activate and sign in</button>
        <button class="btn ghost" type="button" data-back="1" style="justify-content:center">Back</button>
      </form>
    </div></div>`;
    setTimeout(() => { const el = $('#vPass'); if (el) el.focus(); }, 60);
    return;
  }
  // just signed up: waiting for them to open the email
  if (gateStep === 'sent') {
    g.innerHTML = `<div class="gate-inner"><div class="card">
      <div class="pic"><div><b>Check your BAU email</b><span>Account activation</span></div></div>
      <div class="stack">
        <p class="note">This account is not activated yet. Open the invitation link sent to your BAU email, or contact your administrator.</p>
        <button class="btn ghost" type="button" data-back="1" style="justify-content:center">Back</button>
      </div>
    </div></div>`;
    return;
  }
  if (gateStep === 'pick') {
    g.innerHTML = `<div class="gate-inner">
      ${coverBanner()}
      <div class="card">
        <form class="stack" id="signForm" autocomplete="on">
          <label class="f" for="fEmail">BAU email
            <input id="fEmail" type="email" autocomplete="username" required>
          </label>
          <label class="f" for="fPass">Password
            <input id="fPass" type="password" autocomplete="current-password" required>
          </label>
          <p class="err" id="gateErr" hidden></p>
          <button class="btn primary" type="submit" style="justify-content:center">Sign in</button>
          <button class="linkbtn" type="button" data-reset="1">I forgot my password</button>
          <p class="note" style="text-align:center">Staff accounts are created by invitation. Use your BAU email address.</p>
        </form>
      </div>
    </div>`;
    return;
  }

  if (gateStep === 'reset') {
    g.innerHTML = `<div class="gate-inner"><div class="card">
      <div class="pic"><div><b>Forgot your password?</b><span>Reset using your BAU email</span></div></div>
      <form class="stack" id="resetRequestForm">
        <label class="f" for="resetEmail">BAU email
          <input id="resetEmail" type="email" value="${esc(resetEmail)}" autocomplete="username" required>
        </label>
        <p class="err" id="gateErr" hidden></p>
        <p class="okmsg" id="mailSent" hidden></p>
        <button class="btn primary" type="submit" style="justify-content:center">Email me a reset link</button>
        <button class="btn ghost" type="button" data-back="1" style="justify-content:center">Back</button>
      </form>
    </div></div>`;
    return;
  }
}

async function trySignIn(ev) {
  ev.preventDefault();
  const email = $('#fEmail').value.trim().toLowerCase();
  const pass = $('#fPass').value;
  const err = $('#gateErr');
  const fail = m => { err.hidden = false; err.textContent = m; };
  if (!/^[^@\s]+@bau\.edu\.lb$/i.test(email)) return fail('Use your BAU email address, ending in bau.edu.lb.');
  const result = await Store.signIn(email, pass);
  if (!result.ok) {
    if (result.unverified) { gateStep = 'sent'; drawGate(); return; }
    return fail(result.error || 'That email and password do not match.');
  }
  await loadSignedInDirectory();
  const person = FACULTY.find(member => member.slug === result.slug);
  if (!person) return fail('Your staff profile is unavailable. Contact your administrator.');
  await signedIn(person, false);
}

async function requestPasswordReset(ev) {
  ev.preventDefault();
  const email = $('#resetEmail').value.trim().toLowerCase();
  const err = $('#gateErr'), note = $('#mailSent');
  err.hidden = true;
  if (!/^[^@\s]+@bau\.edu\.lb$/.test(email)) {
    err.hidden = false;
    err.textContent = 'Use your BAU email address, ending in bau.edu.lb.';
    return;
  }
  const result = await Store.requestResetEmail(email);
  note.hidden = false;
  note.textContent = result.ok
    ? 'If this account exists, a reset link was sent to its BAU inbox.'
    : (result.error || 'That request could not be completed. Contact your administrator.');
}

// finish a reset started from the email link
async function tryLinkReset(ev) {
  ev.preventDefault();
  const err = $('#gateErr');
  const fail = m => { err.hidden = false; err.textContent = m; };
  const pass = $('#lPass').value;
  if (pass.length < 10) return fail('Make the password at least 10 characters.');
  if (pass !== $('#lPass2').value) return fail('The two passwords are different.');
  const r = await Store.resetWithLink(resetToken, pass);
  if (!r.ok) return fail(r.error || 'That link has expired. Ask for another one.');
  resetToken = '';
  history.replaceState(null, '', location.pathname);
  await loadSignedInDirectory();
  gatePerson = FACULTY.find(f => f.slug === r.slug) || null;
  if (!gatePerson) return fail('Your staff profile is unavailable. Contact your administrator.');
  await signedIn(gatePerson, false);
  toast('Password changed.');
}

// finish sign-up from the email link
async function tryVerify(ev) {
  ev.preventDefault();
  const err = $('#gateErr');
  const fail = m => { err.hidden = false; err.textContent = m; };
  const pass = $('#vPass').value;
  if (!pass) return fail('Type your password.');
  if (pass !== $('#vPass2').value) return fail('The two passwords are different.');
  const r = await Store.verifyAccount(verifyToken, pass);
  if (!r.ok) return fail(r.error ? r.error.charAt(0).toUpperCase() + r.error.slice(1) + '.' : 'That link has expired. Create the account again.');
  verifyToken = '';
  history.replaceState(null, '', location.pathname);
  await loadSignedInDirectory();
  gatePerson = FACULTY.find(f => f.slug === r.slug) || gatePerson;
  if (!gatePerson) return fail('Your staff profile is unavailable. Contact your administrator.');
  await signedIn(gatePerson, false);
  toast('Your account is active.');
}

async function loadSignedInDirectory() {
  if (Store.isServer()) {
    FACULTY = await Store.loadPeople();
    state.people = FACULTY;
    state.orgTree = await Store.loadOrgTree();
  }
}

async function signedIn(person, silent) {
  state.me = person;
  sessionStorage.setItem('bau.session', person.slug);
  const roles = Array.isArray(person.roles) ? person.roles : [];
  state.me.superadmin = Store.isServer() ? Store.isAdmin()
    : roles.some(assignment => assignment.role === 'superadmin');
  state.me.facultyAdmin = roles.some(assignment => assignment.role === 'faculty-admin');
  state.me.admin = state.me.superadmin || state.me.facultyAdmin;
  state.me.peopleManager = roles.some(assignment =>
    assignment.role === 'superadmin' || assignment.role === 'faculty-admin');
  const scopeRows = orgScopeRows();
  const programmeScopes = roles.flatMap(assignment => assignment.scopes || [])
    .filter(scope => scopeRows.some(row => row.id === scope && row.kind === 'programme'));
  const facultyScopes = roles.flatMap(assignment => assignment.scopes || [])
    .filter(scope => scopeRows.some(row => row.id === scope && row.kind === 'faculty'));
  state.me.programme = programmeScopes[0]
    || scopeRows.find(row => row.kind === 'programme'
      && facultyScopes.some(scope => uiNodeContains(scope, row.id)))?.id
    || 'cs';
  state.me.canEditRules = state.me.admin || roles.some(assignment =>
    assignment.role === 'programme-editor' && (assignment.scopes || []).includes(state.me.programme));
  // the programme last worked on in this tab, if this person may still open it
  let lastProgramme = null;
  try { lastProgramme = sessionStorage.getItem('bau.programme'); } catch (e) { /* not kept */ }
  state.programme = lastProgramme && programmesFor().includes(lastProgramme) ? lastProgramme
    : (programmesFor().includes(state.me.programme) ? state.me.programme : programmesFor()[0] || 'cs');
  if (state.me.admin) {
    /* admin advises nobody, so their list is the whole department. Fetched once,
           then it's just a normal list (same pages, rules, arithmetic). */
    try {
      state.everyone = await loadEveryone();
      state.everyoneErr = Object.keys(state.everyone).length ? '' : 'No advisor has imported a list yet.';
    } catch (e) {
      state.everyone = {}; state.everyoneErr = 'Could not reach the department lists just now.';
    }
    state.students = everyoneFlat();
    try { const n = await repairSplitRecords(); if (n) setTimeout(() => toast(n + ' transcripts joined to their students\' advisors'), 1200); }
    catch (e) { /* tried again next sign-in */ }
  } else {
    state.students = inActiveProgramme(await Store.loadStudents(person.slug, []), person.slug);
  }
  // missing/mistyped email -> build it from name + ID so mail buttons always work
  state.students.forEach(s => {
    const r = E.fixEmail(s.name, s.id, s.email);
    if (r.email && r.email !== s.email) s.email = r.email;
    if (r.guessed) s.emailGuessed = true;
  });
  try { state.ideas = await Store.loadIdeas(); } catch (e) { state.ideas = []; }
  await useProgramme(activeProgramme());
  if (Store.isServer() && !state.cover) {
    try { state.cover = await Store.getCover(); } catch (e) { /* the drawn cover stands in */ }
  }
  const off = await Store.loadOffering(BASE_OFFERING.termCode, BASE_OFFERING);
  state.offering = off; state.term = off.term;
  syncTerm();
  $('#gate').hidden = true;
  $('#app').hidden = false;
  state.view = state.me.admin ? 'everyone' : (state.students.length ? 'students' : 'import');
  render();
  watchForChanges();
  if (!silent) toast(welcomeLine(person));
}

// ---- light and dark -------------------------------------------------------
/* light / dark / system (default). Saved on this computer; the page head
   applies it before first paint so there's no flash. */
const THEME_KEY = 'bau.theme';

function themeChoice() {
  try { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'auto'; }
  catch (e) { return 'auto'; }
}

// what's actually showing, however it was decided
function themeShown() {
  const c = themeChoice();
  if (c !== 'auto') return c;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function setTheme(choice) {
  const root = document.documentElement;
  // short colour transition, then remove it so normal hovers stay snappy
  root.classList.add('theme-easing');
  try {
    if (choice === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch (e) { /* not kept, but still applied for this visit */ }
  if (choice === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  // match the browser bar colour on phones
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeShown() === 'dark' ? '#111B31' : '#162C57');
  setTimeout(() => root.classList.remove('theme-easing'), 400);
}

// ---- sound ----------------------------------------------------------------
/* soft tones generated in the browser (nothing to load): a light tick on
   buttons, two rising notes when something is saved or arrives, one low note
   when something went wrong. All muted from the account page. */
const SOUND_KEY = 'bau.sound';
const soundOn = () => { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) { return true; } };
let audioCtx = null;

let lastChime = 0;
function chime(kind) {
  if (!soundOn()) return;
  // a save already chimed: its toast doesn't chime again
  if (kind === 'toast') { if (Date.now() - lastChime < 400) return; kind = 'done'; }
  if (kind !== 'click') lastChime = Date.now();
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    // arrive: two rising notes. trouble: one low note
    if (kind === 'click') {
      // a short, quiet wooden tick
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = 'triangle';
      const t = audioCtx.currentTime;
      osc.frequency.setValueAtTime(1500, t);
      osc.frequency.exponentialRampToValueAtTime(700, t + 0.04);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.035, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t); osc.stop(t + 0.08);
      return;
    }
    const notes = kind === 'bad' ? [[311.1, 0]] : kind === 'done' ? [[587.3, 0], [880, 0.09]] : [[659.3, 0], [987.8, 0.08], [1318.5, 0.16]];
    notes.forEach(([hz, at]) => {
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = 'sine'; osc.frequency.value = hz;
      const t = audioCtx.currentTime + at;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(kind === 'bad' ? 0.07 : 0.05, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t); osc.stop(t + 0.3);
    });
  } catch (e) { /* no sound is not a failure worth reporting */ }
}

// ---- what may have slipped ------------------------------------------------
/* things waiting on this advisor specifically: critical case untouched for a
   week, unregistered students while registration is open, students waiting on
   a decision. The only place the portal nags. */
function nudges() {
  if (!state.me || state.me.admin) return [];
  const out = [];
  const days = ms => Math.floor((Date.now() - ms) / 86400000);

  const stale = criticalList().filter(s => days(s.critical.at) >= 7);
  if (stale.length) {
    out.push({ k: 'stale', tone: 'urgent', open: stale[0].id,
      text: stale.length === 1
        ? esc(stale[0].name) + ' has been critical for ' + days(stale[0].critical.at) + ' days with nothing since.'
        : stale.length + ' critical cases have sat for over a week.' });
  }
  const unreg = advisees().filter(s => !s.registration);
  if (unreg.length) {
    out.push({ k: 'unreg', tone: 'warn', view: 'students', filter: 'unregistered',
      text: unreg.length + ' student' + (unreg.length === 1 ? ' has' : 's have') + ' no schedule for ' + shortTerm(state.term) + '.' });
  }
  const decide = state.students.filter(needsDecision).length;
  if (decide) {
    out.push({ k: 'decide', tone: 'quiet', view: 'decide',
      text: decide + ' student' + (decide === 1 ? '' : 's') + ' waiting for you to say what they are.' });
  }
  return out;
}

function nudgePanel() {
  const list = nudges();
  if (!list.length) return '';
  return `<div class="nudges">
    ${list.map(n => `<button class="nudge ${n.tone}" ${n.open ? `data-open="${esc(n.open)}"`
      : `data-nudge="${esc(n.view || '')}:${esc(n.filter || '')}"`}>
      <span class="nudge-dot"></span><span>${n.text}</span><span class="go">&rsaquo;</span></button>`).join('')}
  </div>`;
}

// ---- notices --------------------------------------------------------------
/* same findings as the student page, grouped across the caseload: each
   problem once, how many students, why it matters, what to do. Every notice
   is an existing engine rule, nothing made up for this page. */
const NOTICE_KINDS = [
  { re: /^Not registered/, title: t => 'Not registered for ' + t, act: 'Send a registration reminder.', rule: 'No current schedule.' },
  { re: /^At risk of dismissal/, title: () => 'At risk of dismissal', act: 'Meet before registration; keep repeats first.', rule: 'Academic standing risk.' },
  { re: /^On probation/, title: () => 'On academic probation', act: 'Maximum 12 credits; failed requirements first.', rule: 'Semester GPA and CGPA below 2.00.' },
  { re: /^In the remedial stage/, title: () => 'Still in the remedial stage', act: '12 credits, or 6 in summer; choose GPA-improving courses.', rule: 'Two consecutive academic warnings.' },
  { re: /^Repeat not registered/, title: () => 'Required repeat missing', act: 'Add it next time it is offered.', rule: 'Failed required course.' },
  { re: /^Repeat [A-Z]{4}\d{3}[A-Z]? this semester/, title: () => 'Repeat offered now', act: 'Register it now.', rule: 'Offered once a year.' },
  { re: /IC3 not recorded/, title: () => 'IC3 not recorded', act: 'Ask for the certificate.', rule: 'Required for graduation.' },
  { re: /^No social science elective/, title: () => 'Social science elective missing', act: 'Add one to the next plan.', rule: 'Graduation requirement.' },
  { re: /^No humanities elective/, title: () => 'Humanities elective missing', act: 'Add one to the next plan.', rule: 'Graduation requirement.' },
  { re: /holds up a year/, title: () => 'Course may delay a year', act: 'Plan it at the next offering.', rule: 'Annual course.' },
  { re: /^Work Ready Now/, title: () => 'Plan Work Ready Now', act: 'Add WRNL200 to an upcoming plan.', rule: 'Catalogue requirement.' },
  { re: /^Failed elective/, title: () => 'Failed elective', act: 'Repeat it or choose another in the same group.', rule: 'Elective choice.' },
  { re: /^Withdrawn elective$/, title: () => 'Withdrawn elective', act: 'Take it again or choose another in the same group.', rule: 'Withdrawn, not failed.' },
  { re: /^Withdrawn course/, title: () => 'Withdrawn course to take again', act: 'Plan it again when it is offered.', rule: 'Withdrawn, not failed.' },
  { re: /^Under the credit minimum/, title: () => 'Under 12 credits', act: 'Add a course or confirm the exception.', rule: 'Fall and spring minimum.' }
];

function notices() {
  if (!state.me || state.me.admin) return [];
  const groups = {};
  const add = (level, key, title, rule, act, s, detail) => {
    const g = groups[key] || (groups[key] = { key, level, title, rule, act, students: [], detail });
    if (!g.students.some(x => x.id === s.id)) g.students.push(s);
    const rank = { urgent: 3, watch: 2, info: 1 };
    if (rank[level] > rank[g.level]) g.level = level;
  };
  advisees().forEach(s => {
    const { alerts, snap } = look(s);
    (alerts || []).forEach(a => {
      const k = NOTICE_KINDS.find(x => x.re.test(a.title));
      if (k) add(a.level, k.re.source, k.title(shortTerm(state.term)), k.rule, k.act, s);
    });
    /* dept electives behind the study plan: one slot each in semesters 4, 5, 6
       (BAU website plan). The stage comes from credits earned, not the number
       of terms on the transcript: semester 4 starts at 50 credits, then about
       17 a semester (202502765 has 33 credits, so semester 3, not due yet). */
    const de = snap.buckets && snap.buckets.DEPT_ELECTIVE;
    const deFrom = C.deptElectiveCredits || [50, 67, 84];
    if (de && snap.earned >= deFrom[0]) {
      const slots = deFrom.filter(n => snap.earned >= n).length;
      const doing = Array.from(snap.inProgress || []).filter(c => (C.courses.find(x => x.code === c) || {}).bucket === 'DEPT_ELECTIVE').length * 3;
      if (de.earned + doing < slots * 3 && de.earned < de.required) {
        add('watch', 'dept-behind', 'Behind on departmental electives',
          'The study plan has one departmental elective in each of semesters 4, 5 and 6 (from 50, 67 and 84 credits earned).',
          'Add one to the next plan.', s);
      }
    }
  });
  const rank = { urgent: 0, watch: 1, info: 2 };
  return Object.values(groups).sort((a, b) => rank[a.level] - rank[b.level] || b.students.length - a.students.length);
}

// single notice view (from the bell or a tap here), with all its students. "All notices" goes back
let noticeFocus = null;
function viewNotices() {
  const all = notices();
  const focus = noticeFocus && all.find(n => n.key === noticeFocus);
  if (focus) {
    return `<div class="wrap">
      <button class="btn ghost sm" data-notice="" style="align-self:flex-start">&lsaquo; All notices</button>
      <div class="page-h"><h1>${esc(focus.title)}</h1><p>${focus.students.length} students</p></div>
      <p class="notice-act notice-solo">${esc(focus.act)}</p>
      <div class="panel"><div class="slist">${focus.students.map(s => {
        const { snap, level } = look(s);
        return `<button class="srow" data-open="${esc(s.id)}">
          <span class="lvl ${level}"></span>
          <span class="av" style="${avatar(s.name)}">${initials(s.name)}</span>
          <span><span class="nm">${esc(s.name)} ${levelTag(s, level)}</span>
            <span class="sub"><span class="mono">${esc(s.id)}</span><span>${s.registration ? regCredits(s) + ' credits registered' : 'not registered'}</span>${s.noTranscript ? '' : '<span>sem ' + (snap.completedSemesters + 1) + '</span>'}</span></span>
          <span class="num hide-s">${s.officialCgpa != null ? s.officialCgpa.toFixed(2) : '&mdash;'}<small>CGPA</small></span>
          <span class="num">${snap.earned}<small>degree credits</small></span></button>`;
      }).join('')}</div></div>
    </div>`;
  }
  const list = all;
  const lanes = [['urgent', 'Act now'], ['watch', 'Plan ahead']];
  const count = l => list.filter(n => n.level === l).length;
  const card = n => `<div class="notice ${n.level}">
      <div class="notice-top"><span class="notice-n">${n.students.length}</span>
        <h3><button class="notice-open" data-notice="${esc(n.key)}" title="Show students">${esc(n.title)} <span aria-hidden="true">&rsaquo;</span></button></h3></div>
      <div class="notice-act">${esc(n.act)}</div>
      <div class="notice-who">${n.students.slice(0, 3).map(s => `<button class="who-chip" data-open="${esc(s.id)}">${esc((w => w.length > 2 ? w[0] + ' ' + w[w.length - 1] : w.join(' '))(s.name.split(' ')))}</button>`).join('')}
        ${n.students.length > 3 ? `<button class="more" data-notice="${esc(n.key)}">+${n.students.length - 3}</button>` : ''}</div>
    </div>`;
  return `<div class="wrap">
    <div class="page-h"><h1>Notices</h1></div>
    <div class="pulse">${lanes.map(([l, t]) => `<div class="pulse-c ${l}"><b>${count(l)}</b><span>${t}</span></div>`).join('')}</div>
    ${lanes.map(([l, t]) => count(l) ? `<div class="sec"><div class="sec-h"><h2>${t}</h2><span class="c">${count(l)}</span></div>
      <div class="notices">${list.filter(n => n.level === l).map(card).join('')}</div></div>` : '').join('')}
  </div>`;
}

// ---- sync across devices --------------------------------------------------
/* data already lives on the server; the problem was stale tabs. So we
   re-read when the tab comes back to front and every couple of minutes.
   Read only, never overwrites anything. */
let lastSync = Date.now(), syncing = false;

async function syncNow(reason) {
  if (syncing || !state.me || !Store.isServer()) return;
  syncing = true;
  try {
    const before = JSON.stringify({
      s: state.students.map(x => x.id + ':' + (x.updatedAt || 0)),
    }) + ((state.offering.syncedAt || 0) + ':' + ((state.offering.sections || []).length));
    if (state.me.admin) {
      state.everyone = await loadEveryone();
      state.students = everyoneFlat();
    } else {
      state.students = inActiveProgramme(await Store.loadStudents(state.me.slug, []), state.me.slug);
      state.students.forEach(s => {
        const r = E.fixEmail(s.name, s.id, s.email);
        if (r.email && r.email !== s.email) s.email = r.email;
        if (r.guessed) s.emailGuessed = true;
      });
    }
    state.ideas = await Store.loadIdeas();
    // the course offering is department-wide: the admin's upload reaches every advisor
    const offKey = o => (o.syncedAt || 0) + ':' + ((o.sections || []).length);
    const offBefore = offKey(state.offering);
    try { const off = await Store.loadOffering(BASE_OFFERING.termCode, BASE_OFFERING); if (off && offKey(off) !== offBefore) state.offering = off; } catch (e) { /* next pass */ }
    const after = JSON.stringify({
      s: state.students.map(x => x.id + ':' + (x.updatedAt || 0)),
    }) + offKey(state.offering);
    lastSync = Date.now();
    if (before !== after) {
      flush(); render();
      if (reason === 'focus') toast('Brought up to date');
    }
  } catch (e) { /* offline for a moment; the next pass will catch up */ }
  finally { syncing = false; }
}

function watchForChanges() {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastSync > 20000) syncNow('focus');
  });
  window.addEventListener('focus', () => { if (Date.now() - lastSync > 60000) syncNow('focus'); });
  setInterval(() => { if (!document.hidden) syncNow('timer'); }, 120000);
}

// ---- earned credits -------------------------------------------------------
/* BAU transcripts start with ~30 entry credits (freshman year or the Bacc
   equivalence) under TRANSFER. Not earned here, so we show the per-semester
   total and list the entry block separately. */
function studied(s) {
  const dated = t => /(FALL|SPRING|SUMMER|WINTER)\s*\d{4}/i.test(String(t || ''));
  const snap = look(s).snap;
  let transfer = 0;
  /* Undated entry rows that are not part of the degree (Lebanese
     Baccalaureate equivalency, freshman/intensive courses) are excluded.
     Transferred courses that count toward the degree are kept, so this total
     matches the degree-credit count shown on the Progress tab. */
  const counts = new Set((snap.counting || []).filter(r => !dated(r.term)).map(r => r.code + '|' + r.term));
  (s.history || []).forEach(r => {
    if (dated(r.term) || r.flag === 'A') return;
    if (counts.has(r.code + '|' + r.term)) return;
    if (E.isPassing(R, r.grade)) transfer += Number(r.cr) || 0;
  });
  return { credits: Math.max(0, snap.officialEarned - transfer), transfer, total: snap.officialEarned };
}

// ---- the bell -------------------------------------------------------------
/* everything waiting on this person: colleague questions, handed-over
   students, stale critical cases, unregistered students. Same list as the top
   of To review, with a count badge. */
let bellOpen = false;
// notices already seen this session (kind + exact students), so the red
// counter goes down once the advisor has looked instead of staying stuck
let noticesSeen = new Set();
let noticesSeenOwner = '';
function loadNoticesSeen() {
  const owner = state.me && state.me.slug ? state.me.slug : 'guest';
  if (owner === noticesSeenOwner) return;
  noticesSeenOwner = owner;
  try { noticesSeen = new Set(JSON.parse(sessionStorage.getItem('bau.seen.' + owner) || '[]')); }
  catch (e) { noticesSeen = new Set(); }
}
const seenKey = n => n.key + ':' + n.students.map(s => s.id).sort().join(',');
const unseenUrgent = () => {
  loadNoticesSeen();
  return notices().filter(n => n.level === 'urgent' && !noticesSeen.has(seenKey(n))).length;
};
function updateNoticeCountBadge() {
  const badge = document.querySelector('[data-notice-count]');
  if (!badge) return;
  const n = unseenUrgent();
  badge.textContent = n ? String(n) : '';
  badge.hidden = !n;
}
function markNoticesSeen() {
  loadNoticesSeen();
  notices().forEach(n => noticesSeen.add(seenKey(n)));
  try { sessionStorage.setItem('bau.seen.' + noticesSeenOwner, JSON.stringify(Array.from(noticesSeen))); } catch (e) { /* this visit only */ }
  updateNoticeCountBadge();
}

let bellLastCount = -1;   // -1 = first draw after sign-in, no sound
function drawBell() {
  const el = $('#bell');
  if (!el) return;
  const admin = state.me && state.me.admin;
  const list = admin ? adminNudges() : notices().filter(n => n.level !== 'info');
  if (!admin && (bellOpen || state.view === 'notices')) markNoticesSeen();
  const n = admin ? list.length : unseenUrgent();
  // a new notice arrived since the bell was last drawn
  if (n > bellLastCount && bellLastCount >= 0) chime('new');
  bellLastCount = n;
  el.innerHTML = `<button class="bell-btn ${n ? 'has' : ''}" id="bellBtn" aria-expanded="${bellOpen}"
      title="${n ? n + ' notices to act on' : 'No notices'}" aria-label="Notices">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8.5a6 6 0 1 0-12 0c0 6-2 7.5-2 7.5h16s-2-1.5-2-7.5"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/></svg>
      ${n ? `<span class="bell-n">${n}</span>` : ''}</button>
    ${bellOpen ? `<div class="bell-pop">
      <div class="bell-h">${list.length ? 'Notices' : 'Nothing to act on'}</div>
      ${list.slice(0, 6).map(x => admin
        ? `<button class="bell-item ${x.tone}" data-nudge="${esc(x.view || '')}:${esc(x.filter || '')}"><span class="nudge-dot"></span><span>${x.text}</span></button>`
        : `<button class="bell-item ${x.level === 'urgent' ? 'urgent' : 'warn'}" data-notice="${esc(x.key)}"><span class="nudge-dot"></span>
            <span><b>${x.students.length}</b> ${esc(x.title.charAt(0).toLowerCase() + x.title.slice(1))}</span></button>`).join('')}
      ${admin ? '' : '<button class="bell-all" data-view="notices">See all notices &rsaquo;</button>'}
    </div>` : ''}`;
}

// admin version: what the dept is waiting on
function adminNudges() {
  const out = [];
  const crit = state.students.filter(isCritical).length;
  if (crit) out.push({ k: 'crit', tone: 'urgent', view: 'everyone',
    text: crit + ' critical case' + (crit === 1 ? '' : 's') + ' across the department.' });
  const ideas = state.ideas.filter(i => !i.done).length;
  if (ideas) out.push({ k: 'ideas', tone: 'quiet', view: 'ideas',
    text: ideas + ' thing' + (ideas === 1 ? '' : 's') + ' on the wishlist.' });
  return out;
}

// ---- time of day ----------------------------------------------------------
// normal greeting during the day, something gentler late at night
// (the work can wait)

const NIGHT_LINES = [
  n => n + ', it is very late. Whatever is on the list will still be there in the morning.',
  n => n + ', it is past midnight. Leave the rest to the admin and get some rest.',
  n => n + ', the department is asleep. This is a good moment to stop.',
  n => n + ', nothing here needs you at this hour. Rest, and come back to it.',
  n => n + ', it is late. If something is worrying you, hand it to the admin and go to bed.'
];
const LATE_LINES = [
  n => 'Working late, ' + n + '? Take it gently.',
  n => n + ', the evening is getting on. A short one tonight?',
  n => 'Still here, ' + n + '? Do not let this keep you up.'
];

// pick one line per day so re-renders don't shuffle the text while someone reads
function pickForToday(list, salt) {
  const d = new Date();
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate() + (salt || 0);
  return list[seed % list.length];
}

function greetingFor(person, opts) {
  const name = personName(person);
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning, ' + name;
  if (h >= 12 && h < 17) return 'Good afternoon, ' + name;
  if (h >= 17 && h < 21) return 'Good evening, ' + name;
  if (h >= 21 && h < 24) return (opts && opts.short) ? 'Good evening, ' + name : pickForToday(LATE_LINES, 1)(name);
  return (opts && opts.short) ? 'Still up, ' + name : pickForToday(NIGHT_LINES, 2)(name);
}

const isLateHour = () => { const h = new Date().getHours(); return h >= 22 || h < 5; };

// welcome line: time of day + one true fact about the list
function welcomeLine(person) {
  const greet = greetingFor(person, { short: true });
  if (person.admin) return greet + '. The department is all here.';
  const c = counts();
  const review = c.critical + c.urgent + c.watch;
  if (!state.students.length) return greet + '. Bring your students in from Import.';
  if (isLateHour()) return greet + '. It can keep until tomorrow.';
  if (c.critical) return greet + '. ' + (c.critical === 1 ? 'One critical case is' : c.critical + ' critical cases are') + ' at the top of your list.';
  if (!review) return greet + '. Everyone is on track today.';
  if (review === 1) return greet + '. One student needs you.';
  if (review < 6) return greet + '. ' + review + ' students need a look.';
  return greet + '. ' + review + ' to get through, most of them small.';
}

async function signOut() {
  await Store.signOutServer();
  sessionStorage.removeItem('bau.session');
  state.me = null; state.students = []; state.people = []; state.orgTree = null; state.programme = null;
  FACULTY = []; gateStep = 'pick'; gatePerson = null; resetEmail = '';
  drawGate();
}

// ---- shared computations --------------------------------------------------
const cache = new Map();
// ---- who the degree rules apply to ----------------------------------------
/* rules here are the BSc in CS (loads, prereqs, probation, 100 credits).
   Freshmen (university-wide year, rules not written yet), Master's, the Law
   student and graduates are out of scope. Their record and plain arithmetic
   still show, but nothing gets flagged: a rule that doesn't apply can only be
   wrong about them.
   TODO: freshman-year rules once we have them. */
const groupOf = s => (s && s.group) || 'cs';
// a schedule-only record has no courses to judge, so say that instead of a level
const levelTag = (s, level) => s.noTranscript ? '<span class="tag watch">No transcript</span>' : `<span class="tag ${level}">${LEVEL[level].word}</span>`;
const GROUP_WORD = { freshman: 'Freshman', masters: "Master's", other: 'Other programme', unsorted: 'Not sorted yet' };
const OFF_PROGRAMME = ['freshman', 'masters', 'other', 'unsorted'];

const isMastersCode = c => /^(CMPS|GREM)6\d\d/.test(String(c || ''));

/* looks graduated? Transcripts don't say: BAU leaves "Graduation Term" empty,
   and our audit uses the current catalogue so older cohorts look incomplete.
   So we go by: moved on to the Master's, or has a full degree of credits.
   Only a suggestion, the advisor confirms. */
function graduateEvidence(s) {
  if (!s || groupOf(s) === 'freshman' || groupOf(s) === 'masters') return null;
  const now = ((s.registration || {}).courses || []).map(c => c.code);
  const msNow = now.filter(isMastersCode);
  if (msNow.length) return "Taking Master's courses this term (" + msNow.join(', ') + ')';
  if ((s.history || []).some(h => isMastersCode(h.code))) return "Has taken Master's courses";
  const cr = Number(s.officialCredits);
  if (cr >= 130) {
    return cr + ' credits on the transcript, a full degree, and '
      + (now.length ? now.length + ' course' + (now.length === 1 ? '' : 's') + ' this term' : 'nothing registered this term');
  }
  return null;
}

const decisionOf = s => (s && s.decided && s.decided.what) || null;
// graduated: advisor said so, or the evidence holds and nobody overrode it
const isGraduated = s => decisionOf(s) === 'graduated' || (!!graduateEvidence(s) && decisionOf(s) !== 'studying');
// waiting for someone to decide what this student is. Freshmen excluded,
// the transcript already says freshman year
const NEEDS_PLACING = ['masters', 'other', 'unsorted'];
const needsDecision = s => !decisionOf(s)
  && (!!graduateEvidence(s) || NEEDS_PLACING.indexOf(groupOf(s)) >= 0);
const offProgramme = s => OFF_PROGRAMME.indexOf(groupOf(s)) >= 0 || isGraduated(s);
// normal advising list: students the rules actually cover
const advisees = () => state.students.filter(s => !offProgramme(s));

function look(s) {
  fillRegCredits(s);
  const key = s.id + ':' + (s.updatedAt || 0) + ':' + state.term + ':' + (offProgramme(s) ? 'off' : 'on');
  if (cache.has(key)) return cache.get(key);
  const snap = E.snapshot(R, C, s);
  if (offProgramme(s)) {
    // record, credits, GPA, no judgement
    /* empty object instead of null so callers don't need to know the
           student's programme */
    const registered = ((s.registration || {}).courses || []);
    const v = {
      snap, alerts: [], level: 'ok', quiet: true,
      reg: { findings: [], registered, credits: registered.reduce((n, c) => n + (Number(c.cr) || 0), 0), limits: null, ok: true }
    };
    cache.set(key, v);
    return v;
  }
  const alerts = E.alerts(R, C, s, state.term, state.offering.sections);
  const reg = E.checkRegistration(R, C, s, state.term, state.offering.sections);
  const level = alerts.some(a => a.level === 'urgent') ? 'urgent' : alerts.some(a => a.level === 'watch') ? 'watch' : 'ok';
  const v = { snap, alerts, reg, level };
  cache.set(key, v);
  return v;
}
const flush = () => cache.clear();

// ---- reviewed -------------------------------------------------------------
/* "reviewed" takes a student off the day's list. Three rules so it can't
   hide a problem:
   - per term: a new term resets everyone to unreviewed
   - snapshots the flags at review time; any new flag lapses the review and
     the student comes back with a note
   - stored separately from the note, so clearing a note can't un-review */
function flagKeys(s) {
  return Array.from(new Set(look(s).alerts
    .filter(a => a.level !== 'info')
    .map(a => a.kind + ':' + a.title)))
    .sort();
}

function reviewOf(s) {
  const r = s.reviewed;
  if (!r || r.term !== state.term) return null;
  const seen = new Set(r.keys || []);
  const fresh = flagKeys(s).filter(k => !seen.has(k));
  return { at: r.at, by: r.by, fresh };
}

const isReviewed = s => { const r = reviewOf(s); return !!r && !r.fresh.length; };

/* marked = "come back to this", reviewed = "done". A reviewed student drops
   off the marked list everywhere (To review, colleague email, printed hand-over). */
/* marked and not dealt with. Checks all students on purpose, not only the
   advising list: marking a freshman still counts, and a mark that shows up
   nowhere is worse than none. */
const markedPending = () => state.students.filter(st =>
  (st.note || {}).flag && !isReviewed(st) && !isCritical(st));

// ---- critical cases -------------------------------------------------------
/* records catch prereqs and probation, but not things like a student who
   stopped coming or a family situation. Critical is the advisor flagging that.
   Stronger than marked/reviewed: neither clears it, only Resolved does.
   Until then it sits at the top of the advisor's list and of the admin's
   dept view, so the admin sees it without an email. */
const isCritical = s => !!(s && s.critical);
const criticalList = () => advisees().filter(isCritical)
  .sort((a, b) => (b.critical.at || 0) - (a.critical.at || 0));

const CRITICAL_REASONS = [
  'At risk of dismissal',
  'May not graduate on time',
  'Has stopped attending',
  'Personal or health situation'
];

function drawCritical(s) {
  const c = s.critical || {};
  const first = s.name.split(' ')[0];
  $('#dlgBody').innerHTML = `
    <div class="dlg-h"><h3>${c.at ? 'Critical case: ' + esc(first) : 'Mark ' + esc(first) + ' as a critical case?'}</h3>
      <p class="note">Shown first until resolved. The admin can also see it.</p></div>
    <div class="dlg-b">
      <div class="crit-picks">${CRITICAL_REASONS.map(r =>
        `<button class="chip" data-critical-pick="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      <label class="f" for="critText">What makes it critical
        <textarea id="critText" rows="3" placeholder="One line is enough, for you and for the admin.">${esc(c.reason || '')}</textarea></label>
      <p class="err" id="critErr" hidden></p>
    </div>
    <div class="dlg-f"><button class="btn" data-close="1">Cancel</button>
      <button class="btn danger-solid" data-critical-save="${esc(s.id)}">${c.at ? 'Save' : 'Mark as critical'}</button></div>`;
  $('#dlg').showModal();
  setTimeout(() => { const el = $('#critText'); if (el) el.focus(); }, 50);
}

// banner on a critical student's page
function criticalBanner(s) {
  if (!isCritical(s)) return '';
  const c = s.critical;
  const who = c.by ? 'Dr. ' + c.by : 'the advisor';
  return `<div class="crit-banner">
    <span class="crit-dot" aria-hidden="true"></span>
    <div class="crit-body">
      <b>Critical case</b><span class="crit-meta">marked ${esc(whenWord(c.at))} by ${esc(who)}</span>
      ${c.reason ? `<p>${esc(c.reason)}</p>` : ''}
    </div>
    ${state.me.admin ? '' : `<div class="crit-acts no-print">
      <button class="btn sm" data-critical-open="${esc(s.id)}">Edit</button>
      <button class="btn sm ok-btn" data-critical-clear="${esc(s.id)}">Resolved</button></div>`}
  </div>`;
}

function counts() {
  let urgent = 0, watch = 0, ok = 0, unreg = 0, done = 0, critical = 0;
  const freshmen = state.students.filter(s => groupOf(s) === 'freshman').length;
  const decide = state.students.filter(needsDecision).length;
  const graduated = state.students.filter(s => isGraduated(s) && groupOf(s) === 'cs').length;
  advisees().forEach(s => {
    const l = look(s).level;
    if (isCritical(s)) critical++;           // first, reviewed or not
    else if (l === 'ok') ok++;
    else if (isReviewed(s)) done++;          // seen, nothing new since
    else if (l === 'urgent') urgent++;
    else watch++;
    if (!s.registration) unreg++;
  });
  return { urgent, watch, ok, unreg, done, critical, freshmen, decide, graduated,
           total: advisees().length, everyone: state.students.length };
}

// ---- shell ----------------------------------------------------------------
/* ---- page history: the browser's back button and the in-app Back go to the
   page you came from (a notice, a filtered list, another student), not home.
   Tabs inside a student page are not separate pages. */
let lastNavKey = '';
const navKey = n => [n.view, n.sel || '', n.nf || ''].join('|');
function navSnap() {
  return { app: 1, view: state.view, sel: state.sel, tab: state.tab, nf: noticeFocus, filter: state.filter, q: state.q };
}
function syncHistory() {
  if (typeof history === 'undefined' || !history.replaceState) return;
  const n = navSnap(), k = navKey(n);
  const cur = history.state && history.state.app ? history.state : null;
  if (k === lastNavKey) { if (cur) history.replaceState(Object.assign({}, cur, { tab: state.tab, filter: state.filter, q: state.q }), ''); return; }
  try {
    if (!lastNavKey || !cur) history.replaceState(Object.assign(n, { d: 0 }), '');
    else {
      history.replaceState(Object.assign({}, cur, { y: navPrevY }), '');
      history.pushState(Object.assign(n, { d: (cur.d || 0) + 1 }), '');
    }
  } catch (e) { /* history not available (file preview); Back falls back to the list */ }
  lastNavKey = k;
}
if (window.addEventListener) window.addEventListener('popstate', e => {
  const n = e.state;
  if (!state.me || !n || !n.app) return;
  state.view = n.view; state.sel = n.sel; state.tab = n.tab || 'progress';
  noticeFocus = n.nf || null; state.filter = n.filter || 'all'; state.q = n.q || '';
  if (state.view === 'student' && !state.students.some(x => x.id === state.sel)) state.view = state.me.admin ? 'everyone' : 'students';
  lastNavKey = navKey(navSnap());
  bellOpen = false;
  render();
  $('#view').scrollTop = n.y || 0;   // back to where you were on that page
});
function goBack() {
  const cur = typeof history !== 'undefined' ? history.state : null;
  if (cur && cur.app && cur.d > 0) { history.back(); return; }
  state.view = state.me.admin ? 'everyone' : 'students'; state.sel = null; render(); window.scrollTo(0, 0);
}

function render() {
  if (!state.me) return;
  const c = counts();
  // logo already says BAU, so just one word next to it; semester kept apart
  $('#mark').innerHTML = logoWhite(30) + '<span class="bar"></span><span class="word">Online Advising System</span>';
  $('#termChip').innerHTML = `<b>${esc(shortTerm(state.term))}</b><span class="phase"><i class="sep-dot" aria-hidden="true"></i>${phaseLine()}</span>`;
  $('#meBox').innerHTML = `<button class="meBtn" data-account="1" title="Your account">
    ${faceOf(state.me)}<span class="me-name">${esc(fullName(state.me))}</span></button>`;
  const admin = !!state.me.admin;
  const items = admin
    ? [
        ['everyone', 'Everyone', state.everyone ? String(allStudentCount()) : '', ''],
        ...(state.me.peopleManager ? [['people', 'People', String(state.people.length), '']] : []),
        ...(canEditStructure() ? [['structure', 'University structure', '', '']] : []),
        ['programme', 'Programme setup', state.programmeReady ? '' : 'new', state.programmeReady ? '' : 'hot'],
        ['rules', 'Rules and study plan', '', ''],
        ['ideas', 'Portal suggestions', state.ideas.length ? String(state.ideas.length) : '', ''],
        ...(state.me.superadmin && Store.isServer() ? [['activity', 'Activity and backups', '', '']] : []),
        ['ask', 'Ask Me', '', ''],
        ['import', 'Import', '', '']
      ]
    : [
        ['import', 'Import', '', ''],
        ['students', 'All students', String(c.total), (c.critical || c.urgent) ? 'hot' : ''],
        ['notices', 'Notices', String((state.view === 'notices' ? (markNoticesSeen(), 0) : unseenUrgent()) || ''), 'hot'],
        ...(c.freshmen ? [['freshmen', 'Freshmen', String(c.freshmen), '']] : []),
        ...(c.decide || c.graduated ? [['decide', 'To decide', c.decide ? String(c.decide) : '', '']] : []),
        ...(state.me.peopleManager ? [['people', 'People', String(state.people.length), '']] : []),
        ['ask', 'Ask Me', '', ''],
        ...(canEditPlan(activeProgramme()) ? [['programme', 'Programme setup', '', '']] : []),
        ['rules', 'Rules in force', '', ''],
        ['ideas', 'Portal suggestions', state.ideas.length ? String(state.ideas.length) : '', '']
      ];

  $('#rail').innerHTML = programmePicker() + `<div class="lab">${admin ? 'Department' : 'Advising'}</div>`
    + items.map(([k, label, n, cls]) =>
      `<button data-view="${k}" aria-current="${state.view === k
        || (k === 'students' && state.view === 'student')
        || (k === 'everyone' && state.view === 'student')}">
        ${k === 'ask' ? askIcon(20, 'rail') : ''}<span>${esc(label)}</span>${n ? `<span class="n ${cls}"${k === 'notices' ? ' data-notice-count' : ''}>${n}</span>` : ''}</button>`).join('')
    + `<div class="sep railinfo"></div><div class="lab railinfo">This term</div>
       <div class="railinfo railfacts">
         <div>${admin ? (state.everyone ? allStudentCount() + ' students' : 'loading') : c.total + ' advisees'}</div>
         <div>${admin ? (n => n + (n === 1 ? ' advisor' : ' advisors'))(Object.keys(state.everyone || {}).length) : c.unreg + ' not registered'}</div>
         <div>${state.offering.sections.length} sections synced</div>
       </div>`;

  /* A button on the same page (add a course, a chain link, save a note,
     import) redraws in place: same scroll position, no fade-in. Only going
     to another page starts at the top. A new tab keeps the tab bar in view. */
  const v = $('#view');
  const pageKey = [state.view, state.sel || '', noticeFocus || ''].join('|');
  const samePage = pageKey === lastPageKey;
  const tabChanged = samePage && state.view === 'student' && state.tab !== lastPageTab;
  const keepY = v.scrollTop;
  lastPageKey = pageKey; lastPageTab = state.tab; navPrevY = keepY;
  if (state.view === 'today') v.innerHTML = admin ? viewEveryone() : viewToday();
  else if (state.view === 'students') v.innerHTML = viewStudents();
  else if (state.view === 'everyone') v.innerHTML = viewEveryone();
  else if (state.view === 'student') v.innerHTML = viewStudent();
  else if (state.view === 'import') v.innerHTML = viewImport();
  else if (state.view === 'ask') { v.innerHTML = viewAsk(); scrollChat(); }
  else if (state.view === 'freshmen') v.innerHTML = viewFreshmen();
  else if (state.view === 'decide') v.innerHTML = viewDecide();
  else if (state.view === 'ideas') v.innerHTML = viewIdeas();
  else if (state.view === 'notices') v.innerHTML = viewNotices();
  else if (state.view === 'rules') v.innerHTML = viewRules();
  else if (state.view === 'people') v.innerHTML = viewPeople();
  else if (state.view === 'structure') v.innerHTML = viewStructure();
  else if (state.view === 'programme') v.innerHTML = viewProgrammeSetup();
  else if (state.view === 'activity') v.innerHTML = viewActivity();
  drawFloat();
  drawBell();
  syncHistory();
  if (samePage) {
    let y = keepY;
    if (tabChanged) {
      const tb = v.querySelector('.tabs');
      if (tb) { const top = tb.getBoundingClientRect().top - v.getBoundingClientRect().top + v.scrollTop - 12; if (y > top) y = Math.max(0, top); }
    }
    if (state.view !== 'ask') v.scrollTop = y;
    return;
  }
  v.scrollTop = 0;
  // short fade-in on view change, skipped for prefers-reduced-motion
  v.classList.remove('settle');
  void v.offsetWidth;
  v.classList.add('settle');
}
let lastPageKey = '', lastPageTab = '', navPrevY = 0;

/* floating corner buttons: assistant + contact a person. Assistant button
   hides while the chat is open. */
function drawFloat() {
  const f = $('#float');
  if (!f) return;
  const onAsk = state.view === 'ask';
  f.innerHTML = `
    <button class="fbtn ask ${onAsk ? 'away' : ''}" data-view="ask" title="Ask the rule-based advising guide">
      ${askIcon(30, 'float')}<span>Ask Me</span></button>`;
}

// ---- today ----------------------------------------------------------------
function viewToday() {
  const c = counts();
  const greet = greetingFor(state.me);
  // one row per student, not per alert, so one student with 3 problems doesn't push others off
  const rank = { urgent: 0, watch: 1, info: 2 };
  const grouped = [];
  advisees().forEach(s => {
    const list = look(s).alerts.slice().sort((a, b) => rank[a.level] - rank[b.level]);
    // only notes = on track, skip
    if (!list.length || look(s).level === 'ok') return;
    grouped.push({ s, a: list[0], more: list.length - 1, level: look(s).level });
  });
  grouped.sort((x, y) => rank[x.level] - rank[y.level] || y.more - x.more || x.s.name.localeCompare(y.s.name));
  // reviewed students go to the bottom section in case the advisor wants them
  // back. Reviewed + new flag since = stays on the list, marked as such.
  // Includes students the advisor marked, so marked ones have a place here too.
  const doneRows = state.students
    .filter(st => isReviewed(st) && !isCritical(st) && (look(st).level !== 'ok' || (st.note || {}).flag))
    .map(st => {
      const al = look(st).alerts.filter(a => a.level !== 'info');
      return { s: st, a: al[0] || { title: (st.note || {}).text || 'Marked by you' }, more: Math.max(0, al.length - 1) };
    })
    .sort((x, y) => (reviewOf(y.s).at || 0) - (reviewOf(x.s).at || 0));
  const pending = grouped.filter(g => !isReviewed(g.s) && !isCritical(g.s));
  const crit = criticalList();
  const reasonsOf = st => look(st).alerts;
  const review = c.urgent + c.watch;

  const marked = markedPending();

  if (!state.students.length) {
    return `<div class="wrap"><div class="page-h"><h1>${esc(greet)}</h1>
      <p>No students here yet.</p></div>
      <div class="panel"><div class="bd stack">
        <p>Import the transcript and schedule PDFs to add your students.</p>
        <button class="btn primary" data-view="import" style="align-self:flex-start">Go to import</button>
      </div></div></div>`;
  }

  return `<div class="wrap">
    <div class="page-h">
      <h1>${esc(greet)}</h1>
      <p>${(review || c.critical)
        ? (c.critical ? '<b class="crit-word">' + c.critical + ' critical</b>, ' : '')
          + '<b>' + c.urgent + ' urgent</b>, <b>' + c.watch + ' to plan</b>, ' + c.ok + ' on track.'
          + (c.done ? ' ' + c.done + ' reviewed.' : '')
        : c.done
          ? '<b>All clear.</b> ' + c.done + ' reviewed, ' + c.ok + ' on track.'
          : '<b>All ' + c.total + ' students are on track.</b>'}</p>
    </div>

    ${nudgePanel()}
    ${crit.length ? `<div class="sec crit-sec">
      <div class="sec-h"><h2>Critical</h2><span class="c crit">${crit.length}</span></div>
      <div class="panel crit-panel"><div class="alist">
        ${crit.map(st => `<button class="al urgent rv crit-row" data-open="${esc(st.id)}">
            <span class="stripe"></span>
            <span class="body"><span class="t">${esc(st.name)}
              <span class="who-meta"><span class="mono">${esc(st.id)}</span><i class="sep-dot" aria-hidden="true"></i>marked ${esc(whenWord(st.critical.at))}</span></span>
              <span class="rlist"><span class="r">${esc(st.critical.reason || 'No reason written')}</span></span>
            </span><span class="go">&rsaquo;</span></button>`).join('')}
      </div></div></div>` : ''}
    ${marked.length ? `<div class="sec">
      <div class="sec-h"><h2>Marked by you</h2><span class="c">${marked.length}</span>
        <span class="act" style="display:flex;gap:7px">
          <button class="btn sm" data-print-list="marked">Print</button></span></div>
      <div class="panel"><div class="alist">
        ${marked.map(st => {
          const lv = look(st).level;
          return `<button class="al ${lv === 'ok' ? 'info' : lv} rv" data-open="${esc(st.id)}">
            <span class="stripe"></span>
            <span class="body"><span class="t">${esc(st.name)}
              <span class="who-meta"><span class="mono">${esc(st.id)}</span><i class="sep-dot" aria-hidden="true"></i>${lv === 'ok' ? 'on track' : 'needs attention'}</span></span>
              <span class="rlist"><span class="r">${esc((st.note || {}).text || 'Marked, no note written')}</span></span>
            </span><span class="go">&rsaquo;</span></button>`;
        }).join('')}
      </div></div></div>` : ''}
    ${reviewPanel('Your list today', pending, reasonsOf, REVIEW_MEANS, 'Nothing needs attention.')}
    ${doneRows.length ? `<details class="sec done-sec">
      <summary class="sec-h"><h2>Reviewed this term</h2><span class="c">${doneRows.length}</span></summary>
      <div class="panel"><div class="alist">
        ${doneRows.map(g => {
          const r = reviewOf(g.s);
          return `<button class="al ok rv" data-open="${esc(g.s.id)}">
            <span class="stripe"></span>
            <span class="body"><span class="t">${esc(g.s.name)}
              <span class="who-meta"><span class="mono">${esc(g.s.id)}</span><i class="sep-dot" aria-hidden="true"></i>reviewed ${esc(whenWord(r.at))}</span></span>
              <span class="rlist"><span class="r">${esc(g.a.title)}${g.more ? ' and ' + g.more + ' more' : ''}</span></span>
            </span><span class="go">&rsaquo;</span></button>`;
        }).join('')}
      </div></div></details>` : ''}
    ${c.ok ? `<div style="text-align:center"><button class="linkbtn" data-filter="ok">See ${c.ok} on-track students</button></div>` : ''}
  </div>`;
}

// several failed courses -> one line, not four reasons
function condense(list) {
  const out = [], repeats = [];
  list.forEach(a => {
    if (/^Repeat/.test(a.title)) repeats.push(a); else out.push(a);
  });
  if (repeats.length) {
    const now = repeats.filter(r => /open now|normally runs now/.test(r.brief || ''));
    const later = repeats.filter(r => now.indexOf(r) < 0);
    const codeOf = r => (r.brief || '').split(':')[0];
    if (now.length) out.push({ level: 'watch', title: 'Take again now',
      brief: now.map(codeOf).join(', ') });
    if (later.length) out.push({ level: 'info', title: 'Waits for next semester',
      brief: later.map(codeOf).join(', ') });
  }
  const rank = { urgent: 0, watch: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

// one block per student with all their reasons
function reviewPanel(title, items, reasonsOf, means, empty) {
  // urgent (blocking now) and priority (decide with the student) in one list
  // with a heading in between, so nothing needs clicking to see it all
  const urgent = items.filter(x => x.level === 'urgent');
  const soon = items.filter(x => x.level !== 'urgent');
  const row = ({ s, level }) => {
    const all = condense(reasonsOf(s));
    // max two reasons per row, the rest is on the student page
    const reasons = all.slice(0, 2), hidden = all.length - reasons.length;
    const { snap } = look(s);
    return `<button class="who-row ${level}" data-open="${esc(s.id)}">
      <span class="dot ${level}"></span>
      <span class="main">
        <span class="line1">
          <b>${esc(s.name)}</b>${(() => {
            const r = reviewOf(s);
            return r && r.fresh.length ? `<span class="back-tag">New since you reviewed</span>` : '';
          })()}
          <span class="meta">semester ${snap.completedSemesters + 1}
           <i class="sep-dot" aria-hidden="true"></i>CGPA ${s.officialCgpa != null ? s.officialCgpa.toFixed(2) : 'none yet'}
           <i class="sep-dot" aria-hidden="true"></i>${s.registration ? s.registration.courses.length + ' courses' : 'not registered'}</span>
        </span>
        <span class="line2">${reasons.map(r => `<span class="bit ${r.level}">
          <b>${esc(r.title)}</b><span>${esc(r.brief || r.detail)}</span></span>`).join('')}${
          hidden > 0 ? `<span class="bit more">+${hidden} more</span>` : ''}</span>
      </span>
      <span class="chev">&rsaquo;</span>
    </button>`;
  };

  const group = (list, head) => list.length ? `
    <div class="ghead"><span class="gt ${list === urgent ? 'urgent' : 'watch'}">${head}</span>
      <span class="gc">${list.length}</span></div>
    <div class="who-list">${list.map(row).join('')}</div>` : '';

  return `<div class="sec">
    <div class="sec-h" style="margin-bottom:2px"><h2>${title}</h2>
      <span class="act" style="display:flex;gap:7px">
        <button class="btn sm" data-print-list="review">Print</button></span></div>
    ${items.length
      ? group(urgent, 'Urgent') + group(soon, 'Plan ahead')
      : `<div class="panel"><p class="empty">${empty}</p></div>`}
  </div>`;
}

// ---- students list --------------------------------------------------------
/* registered load vs the Faculty's normal 12-18. Not registered is its own
   filter, not "under 12". */
// the admin sees each student's own advisor, an advisor sees themselves
const advisorOfStudent = s => (state.me.admin && s && s.advisorSlug) ? advisorNamed(s.advisorSlug) : fullName(state.me);
// some schedule PDFs print 0 in the credit column; the catalogue knows the real value
function fillRegCredits(s) {
  ((s.registration || {}).courses || []).forEach(c => {
    if (!(Number(c.cr) > 0)) {
      const m = MAP[c.code] || (state.offering.sections || []).find(x => x.code === c.code && Number(x.cr) > 0);
      if (m && Number(m.cr) > 0) c.cr = Number(m.cr);
    }
  });
}
const regCredits = s => ((s.registration || {}).courses || []).reduce((n, c) => n + (Number(c.cr) || 0), 0);
const underLoad = s => !!s.registration && regCredits(s) > 0 && regCredits(s) < R.load['REG-LOAD-01'].min;
const overLoad = s => !!s.registration && regCredits(s) > R.load['REG-LOAD-01'].max;

function viewStudents() {
  const c = counts();
  const q = state.q.trim().toLowerCase();
  let list = advisees().slice();
  if (q) list = list.filter(s => (s.name + ' ' + s.id + ' ' + (s.email || '')).toLowerCase().includes(q));
  if (state.filter === 'critical') list = list.filter(isCritical);
  else if (state.filter === 'unregistered') list = list.filter(s => !s.registration);
  else if (state.filter === 'review') list = list.filter(s => look(s).level !== 'ok');
  else if (state.filter === 'ok') list = list.filter(s => look(s).level === 'ok');
  else if (state.filter === 'under') list = list.filter(underLoad);
  else if (state.filter === 'over') list = list.filter(overLoad);
  list.sort((a, b) => {
    const r = { urgent: 0, watch: 1, ok: 2 };
    return (isCritical(b) - isCritical(a)) || r[look(a).level] - r[look(b).level] || a.name.localeCompare(b.name);
  });
  const needs = c.critical + c.urgent + c.watch;
  // counts sit on the filter chips, no banner needed
  const seg = [['all', 'All', c.total], ['critical', 'Critical', c.critical], ['review', 'Needs attention', needs],
               ['ok', 'On track', c.ok], ['unregistered', 'Not registered', c.unreg],
               ['under', 'Under ' + R.load['REG-LOAD-01'].min + ' credits', advisees().filter(underLoad).length],
               ['over', 'Over ' + R.load['REG-LOAD-01'].max + ' credits', advisees().filter(overLoad).length]];
  return `<div class="wrap">
    <div class="page-h"><h1>All students</h1><p>${esc(shortTerm(state.term))}</p></div>
    <div class="filters">
      <div class="search"><input id="q" placeholder="Search by name or ID" value="${esc(state.q)}" autocomplete="off"></div>
      <div class="seg">${seg.map(([k, l, n]) => `<button data-filter="${k}" aria-pressed="${state.filter === k}">${l}<span class="segn">${n}</span></button>`).join('')}</div>
    </div>
    <div class="panel"><div class="slist">
      ${list.length ? list.map(s => {
        const { snap, level } = look(s);
        return `<button class="srow" data-open="${esc(s.id)}">
          <span class="lvl ${level}"></span>
          <span class="av" style="${avatar(s.name)}">${initials(s.name)}</span>
          <span>
            <span class="nm">${esc(displayName(s))} ${levelTag(s, level)}${isCritical(s) ? '<span class="tag crit">Critical</span>' : ''}</span>
            <span class="sub"><span class="mono">${esc(s.id)}</span>
              <span>${s.registration ? s.registration.courses.length + ' courses' + (state.filter === 'under' || state.filter === 'over' ? ', ' + regCredits(s) + ' credits' : '') : 'not registered'}</span>
              ${s.noTranscript ? '' : '<span>sem ' + (snap.completedSemesters + 1) + '</span>'}</span>
          </span>
          <span class="num hide-s">${s.officialCgpa != null ? s.officialCgpa.toFixed(2) : '&mdash;'}<small>CGPA</small></span>
          <span class="num" title="${studied(s).transfer ? 'and ' + studied(s).transfer + ' credits of freshman equivalency' : ''}${
            studied(s).transfer ? '. ' : ''}${snap.earned} credits completed toward the ${C.totalCredits}-credit degree">${snap.earned}<small>degree credits</small></span>
        </button>`;
      }).join('') : noMatch()}
    </div></div>
  </div>`;
}

// ---- student page ---------------------------------------------------------
function cur() { return state.students.find(s => s.id === state.sel); }

function trackBadge(snap) {
  const e = snap.trackEstimate;
  if (!e) return '';
  if (e.kind === 'recorded') return `<span class="chip brand">${esc(e.label)} track</span>`;
  if (e.kind === 'potential') return `<span class="chip brand">Potential ${esc(e.label)} track</span>`;
  return '';
}

function trackEvidencePanel(s, snap) {
  if (offProgramme(s) || !snap.trackEstimate) return '';
  const e = snap.trackEstimate;
  const explanation = e.kind === 'recorded'
    ? `<b>${esc(e.label)} is recorded.</b> The matching courses are shown below.`
    : e.kind === 'potential'
      ? `<b>Potential ${esc(e.label)} track.</b> ${e.count} completed or current courses match this track. This is an estimate, not an official track declaration.`
      : e.kind === 'mixed'
        ? '<b>General / mixed track evidence.</b> Courses match more than one track.'
        : e.kind === 'developing'
          ? `<b>No potential track yet.</b> ${e.count} of ${e.needed} matching courses point toward ${esc(e.label)}.`
          : '<b>No track evidence yet.</b>';
  const rows = Object.keys(C.tracks || {}).map(k => {
    const t = C.tracks[k], p = snap.trackProgress[k];
    return `<div class="track-row">
      <div class="track-row-head"><b>${esc(t.label)}</b><span>${p.count} / ${p.needed} courses</span></div>
      <div class="track-courses">${t.courses.map(code => {
        const done = p.done.includes(code), now = p.doing.includes(code);
        return `<span class="track-course ${done ? 'done' : now ? 'now' : 'future'}" title="${done ? 'completed' : now ? 'taking now' : 'not taken'}">${esc(code)}${done ? ' · done' : now ? ' · now' : ''}</span>`;
      }).join('')}</div>
    </div>`;
  }).join('');
  return `<div class="panel track-evidence"><div class="hd">${esc(C.program || 'Programme')} track evidence</div><div class="bd">
    <p class="note">${explanation}</p>
    <div class="track-grid">${rows}</div>
  </div></div>`;
}

function simpleEmailUrl(s) {
  const first = String(s.name || '').trim().split(/\s+/)[0] || 'Student';
  return composeUrl('outlook', s.email || '', '', 'Dear ' + first + ',\n\n');
}

function viewStudent() {
  const s = cur();
  if (!s) return '<div class="wrap"><p class="empty">Student not found.</p></div>';
  const { snap, level } = look(s);
  const planNow = planTargetFor(s) === state.term;
  const tabs = [['progress', 'Progress'], ['term', 'This term'], ['plan', planNow ? 'Plan this term' : 'Plan next term'],
                ['roadmap', 'Roadmap'], ['chain', 'Course chain'], ['sheet', 'Contract sheet'], ['transcript', 'Transcript']];
  const body = state.tab === 'term' ? tabTerm(s) : state.tab === 'plan' ? tabPlan(s) : state.tab === 'roadmap' ? tabRoadmap(s)
    : state.tab === 'chain' ? tabChain(s) : state.tab === 'sheet' ? tabSheet(s)
    : state.tab === 'transcript' ? tabTranscript(s) : tabProgress(s);
  const g = groupOf(s);
  // name styled as the record title
  const chip = (offProgramme(s)
    ? `<span class="chip quiet">${esc(isGraduated(s) && g === 'cs' ? 'Graduated' : (GROUP_WORD[g] || 'Off the degree'))}</span>`
    : `<span class="chip ${LEVEL[level].chip}" title="${esc(LEVEL[level].means)}">${LEVEL[level].word}</span>`);
  return `<div class="wrap">
    <button class="btn back-btn no-print" data-goback="1" aria-label="Back">
      <span class="back-arrow" aria-hidden="true">&larr;</span> Back
    </button>
    <div class="shead">
      <div class="id">
        <span class="bigav" style="${avatar(s.name)}">${initials(s.name)}</span>
        <div style="min-width:0">
          <h1>${esc(displayName(s))}</h1>
          ${state.me.admin ? `<div class="meta advisor-owner"><span>Advisor</span><b data-no-ar>${esc(advisorNamed(s.advisorSlug || ''))}</b></div>` : ''}
          <div class="meta"><span class="mono">${esc(s.id)}</span>
            <span>ID year ${s.catalogYear || String(s.id).slice(0, 4)}</span>
            <span>semester ${snap.completedSemesters + 1}</span>
            <span class="campus ${s.campus === 'Debbieh' ? 'deb' : ''}">${esc(s.campus || 'Beirut')}</span>
            ${trackBadge(snap)}
            ${s.admission ? `<span>joined ${esc(s.admission)}</span>` : ''}</div>
        </div>
        <div class="acts no-print">
          ${chip}
          ${s.email ? `<button class="btn sm" data-email="${esc(s.id)}">Email student</button>` : ''}
          ${state.me.admin
            ? ''
            : `${isCritical(s) ? '' : `<button class="btn sm crit-btn" data-critical-open="${esc(s.id)}"><span class="crit-dot" aria-hidden="true"></span>Mark as critical</button>`}`}
        </div>
      </div>
      <div class="tabs no-print">${tabs.map(([k, l]) => `<button data-tab="${k}" aria-selected="${state.tab === k}">${l}</button>`).join('')}</div>
    </div>
    ${criticalBanner(s)}
    ${scopeBanner(s)}
    ${recordNotes(s)}
    ${groupOf(s) === 'masters' ? mastersPanel(s) : ''}
    ${body}
    <p class="note" style="margin-top:14px">${esc(ADVISORY_LINE)}</p>
  </div>`;
}

function gradeClass(g) {
  if (['F', 'D-'].includes(g)) return 'bad';
  if (['D', 'C-'].includes(g)) return 'mid';
  if (['A+', 'A', 'A-', 'B+', 'B'].includes(g)) return 'good';
  return '';
}

function tabProgress(s) {
  const { snap, alerts, level } = look(s);
  // the standard blocks first, then any block a programme added (Internship, Basic sciences),
  // leaving out blocks this programme does not use
  const STANDARD = ['UNIV_MANDATORY', 'UNIV_ELECTIVE', 'FACULTY_CORE', 'MAJOR_CORE', 'DEPT_ELECTIVE', 'GEN_SCI_ELECTIVE'];
  const order = STANDARD.concat(Object.keys(snap.buckets).filter(k => !STANDARD.includes(k) && !['FRESHMAN', 'OTHER'].includes(k)))
    .filter(k => snap.buckets[k] && (snap.buckets[k].required > 0 || snap.buckets[k].earned > 0));
  const audit = E.graduationAudit(R, C, s);
  const blocks = order.filter(k => snap.buckets[k]).map(k => {
    const b = snap.buckets[k], label = (C.buckets[k] || {}).label || k;
    const pct = b.required ? Math.min(100, Math.round(b.earned / b.required * 100)) : 100;
    const doingPct = b.required ? Math.min(100 - pct, Math.round((b.inProgress || 0) / b.required * 100)) : 0;
    const missing = (b.missing || []).slice(0, 8);
    const left = b.required - b.earned - (b.inProgress || 0);
    return `<div class="blk">
      <div class="r1"><b>${esc(label)}</b>
        ${b.inProgress ? `<span class="doing-note">+${b.inProgress} this term</span>` : ''}
        <span class="n">${b.earned} of ${b.required} credits</span>
        ${pct === 100 ? '<span class="left-pill done">done</span>'
          : `<span class="left-pill ${left <= 0 ? 'soon' : ''}">${left > 0 ? left + ' left' : 'done after this term'}</span>`}</div>
      <div class="bar"><i class="${pct === 100 ? 'full' : ''}" style="width:${pct}%"></i>${doingPct > 0 ? `<i class="doing" style="width:${doingPct}%"></i>` : ''}</div>
    </div>`;
  }).join('');

  const contact = `<dl class="kv">
    ${s.email ? `<dt>Email</dt><dd><a href="${esc(simpleEmailUrl(s))}" target="_blank" rel="noopener noreferrer" title="Open Outlook with a new message beginning with Dear ${esc(String(s.name || '').split(/\s+/)[0] || 'Student')}">${esc(s.email)}</a>${
''}</dd>` : ''}
    ${s.phone ? `<dt>Phone</dt><dd class="mono">${esc(s.phone)}</dd>` : ''}
    ${s.nationality ? `<dt>Nationality</dt><dd>${esc(nice(s.nationality))}</dd>` : ''}
    <dt>Programme</dt><dd>${esc(s.program || C.program || 'Computer Science')}</dd>
    <dt>Advisor</dt><dd>${esc(advisorOfStudent(s))}</dd>
  </dl>`;

  const onlyIc3 = !audit.eligible && audit.blockers.length === 1 && audit.blockers[0].label === 'IC3 / ICDL';
  const completion = audit.eligible
    ? `<div class="completion success"><b>Degree requirements complete.</b></div>`
    : onlyIc3
      ? `<div class="completion almost"><b>Degree credits completed successfully.</b><span>Only IC3 / ICDL is still missing.</span></div>`
      : audit.remainingCredits === 0
        ? `<div class="completion almost"><b>${C.totalCredits} credits complete.</b><span>${audit.blockers.length} requirement${audit.blockers.length === 1 ? '' : 's'} left.</span></div>`
        : '';

  return `${completion}
  <div class="split">
    <div class="sec">
      <div class="tiles">
        <div class="tile"><div class="k">CGPA</div><div class="v" style="color:${s.officialCgpa >= 2 ? 'var(--ok)' : 'var(--urgent)'}">${s.officialCgpa != null ? s.officialCgpa.toFixed(2) : '&mdash;'}</div></div>
        <div class="tile"><div class="k">Credits completed</div>
          <div class="v">${snap.earned}<small> / ${C.totalCredits}</small></div></div>
        <div class="tile"><div class="k">Standing</div><div class="v" style="font-size:16px;font-family:var(--sans);font-weight:600">${esc(standingWord(snap.standing.state))}</div></div>
      </div>
      <div class="panel">
        <div class="hd">Degree requirements</div>
        <div class="bd">${(() => {
          const tot = order.filter(k => snap.buckets[k]).reduce((a, k) => {
            const b = snap.buckets[k]; a.req += b.required; a.done += b.earned; a.now += (b.inProgress || 0); return a; }, { req: 0, done: 0, now: 0 });
          const left = Math.max(0, tot.req - tot.done);
          return `<div class="req-sum"><div><b>${left}</b><span>credits left to graduate</span></div>
            <div><b>${tot.now}</b><span>of them this term</span></div>
            <div><b>${Math.max(0, left - tot.now)}</b><span>still to plan</span></div></div>`;
        })()}<div class="blocks">${blocks}</div></div>
      </div>
      ${(() => {
        const minor = E.minorAudit(R, C, s);
        if (!minor || minor.mathCoursesSeen.length < 2) return '';
        return `<div class="panel"><div class="hd">${esc(minor.label)}</div><div class="bd">
          <div class="blk"><div class="r1"><b>${minor.credits} minor credits completed · ${minor.min} required</b>
            ${minor.ok ? '<span class="chip ok">minor completed</span>' : '<span class="chip">possible</span>'}
</div>
            <div class="bar"><i class="${minor.ok ? 'full' : ''}" style="width:${Math.min(100, minor.credits / minor.min * 100)}%"></i></div>
          </div>
        </div></div>`;
      })()}
      <div class="panel">
        <div class="hd">Graduation check</div>
        <div class="bd">
          <div class="checks">
            ${audit.items.filter(i => !i.hidden).map(i => `<div class="chk ${i.ok ? 'info' : 'warn'}">
              <span class="ic">${i.ok ? '&check;' : '!'}</span>
              <span class="tx"><p><b>${esc(i.label)}</b>${/^(Completed|Missing|Clear)$/.test(i.detail) ? '' : ' <span class="gdet">' + esc(i.detail) + '</span>'}</p></span></div>`).join('')}
          </div>
        </div>
      </div>
    </div>
    <div class="sec">
      <div class="panel"><div class="hd">${level === 'ok' ? 'Notes' : 'Needs attention'}</div><div class="alist">
        ${alerts.length ? alerts.slice().sort((x, y) => (x.level === 'urgent' ? 0 : 1) - (y.level === 'urgent' ? 0 : 1)).map(a => `<div class="al ${a.level}" style="cursor:default">
          <span class="stripe"></span>
          <span class="body"><span class="t">${esc(a.title)}</span>${a.detail ? `<span class="d">${esc(a.detail)}</span>` : ''}</span>
        </div>`).join('') : '<p class="empty">On track. Nothing outstanding.</p>'}
      </div></div>
      ${notePanel(s)}
      ${exceptionsPanel(s)}
      <div class="panel"><div class="hd">Contact</div><div class="bd">${contact}</div></div>
    </div>
  </div>`;
}

// the one most useful sentence about this student
function nextStep(s) {
  const { snap, reg, alerts } = look(s);
  const audit = E.graduationAudit(R, C, s);
  if (audit.eligible) {
    return `<div class="nextstep complete"><div><div class="k">Completed</div>
      <div class="v"><b>Degree requirements completed successfully.</b> No academic requirement is still open.</div></div></div>`;
  }
  if (audit.remainingCredits === 0 && audit.blockers.length === 1 && audit.blockers[0].label === 'IC3 / ICDL') {
    return `<div class="nextstep"><div><div class="k">Only one item remains</div>
      <div class="v"><b>Only IC3 / ICDL is missing.</b> All degree credits and academic blocks are complete.</div></div></div>`;
  }
  const urgent = alerts.find(a => a.level === 'urgent');
  // no schedule yet -> can still register this term, so suggest this term's courses
  const plan = E.planNextTerm(R, C, s, s.registration ? state.planTerm : state.term, state.offering.sections);
  const picks = plan.recommendations.slice(0, 4);
  const cr = picks.reduce((n, c) => n + (Number(c.cr) || 0), 0);
  let head, body, action = '';
  if (!s.registration) {
    head = 'Not registered for ' + state.term;
    body = picks.length
      ? 'Start with ' + picks.map(c => `<code>${esc(c.code)}</code>`).join('') + ' (' + cr + ' credits).'
      : 'Nothing left in the plan to register.';
    action = `<button class="btn sm primary" data-email="${esc(s.id)}" data-template="register">Send a reminder</button>`;
  } else if (reg.findings.some(f => f.severity === 'BLOCK')) {
    head = 'Fix this term first';
    body = esc(reg.findings.find(f => f.severity === 'BLOCK').message);
    action = `<button class="btn sm" data-tab="term">Open this term</button>`;
  } else if (urgent) {
    head = urgent.title;
    body = esc(urgent.detail);
  } else {
    const done = snap.buckets.MAJOR_CORE.earned + snap.buckets.FACULTY_CORE.earned;
    head = 'On track for ' + state.term;
    body = picks.length
      ? 'Next semester, point them at ' + picks.map(c => `<code>${esc(c.code)}</code>`).join('') + ' (' + cr + ' credits).'
      : 'Nothing outstanding in the plan.';
    action = `<button class="btn sm" data-tab="plan">Build the plan</button>`;
  }
  return `<div class="nextstep no-print">
    <div><div class="k">What to do next</div><div class="v"><b>${esc(head)}.</b> ${body}</div></div>
    ${action ? `<span class="go">${action}</span>` : ''}
  </div>`;
}

/* repeats, ordered by how much they block: a failed course with 30 credits
   depending on it matters way more than one with nothing behind it. */
function repeatPanel(s, term) {
  // courses already on this term's registration are being taken again: not listed
  const registered = new Set(regFor(s) ? s.registration.courses.map(c => c.code) : []);
  const due = E.repeatsDue(R, C, s, term, state.offering.sections).filter(r => !registered.has(r.code));
  if (!due.length) return '';
  // one chip per course: CODE (grade), now or later, what it opens on hover
  const chip = r => {
    const now = r.open === 'yes' || r.open === 'likely';
    return `<span class="rchip ${now ? 'now' : 'later'}" title="${esc(nice(r.title))}${r.unlocks ? ' · opens ' + r.unlocks + ' credits' : ''}">
      <b>${esc(r.code)}</b> (${esc(String(r.grade || '').toUpperCase())})<i>${now ? 'now' : shortTerm(r.plannedFor)}</i></span>`;
  };
  return `<div class="panel"><div class="hd">To take again</div><div class="bd"><div class="rchips">${due.map(chip).join('')}</div></div></div>`;
}

/* advisor's own note, for what the records can't know (dropped out, an
   agreed exception, a talk still to have). Marking puts them at the top of
   To review and on the printed hand-over. */
// ---- meetings and holds ---------------------------------------------------
/* meeting = what was agreed and when, so there's something to read back next
   term. Hold = whatever blocks registration. iConnect knows first and we can't
   see it, so the advisor logs it when the student says, and clears it the same way. */
const HOLD_KINDS = [
  ['financial', 'Financial', 'Fees outstanding. Settled with the registrar, then dbregistrar@bau.edu.lb removes it.'],
  ['academic', 'Academic review', 'No timeticket on iConnect: the standing is under review.'],
  ['admission', 'Admission or registration', 'Papers or a registration matter to settle with the office.'],
  ['other', 'Something else', '']
];

function holdPanel(s) {
  const h = s.hold;
  if (state.me.admin) {
    return h ? `<div class="scope-banner"><div><b>On hold: ${esc((HOLD_KINDS.find(k => k[0] === h.kind) || [, 'Hold'])[1])}</b>
      <p>${esc(h.note || '')}</p><p class="note">Noted ${esc(whenWord(h.at))} by ${esc(h.by ? 'Dr. ' + h.by : 'the advisor')}.</p></div></div>` : '';
  }
  if (!h) return '';
  const label = (HOLD_KINDS.find(k => k[0] === h.kind) || [, 'Hold'])[1];
  return `<div class="crit-banner hold">
    <span class="hold-mark" aria-hidden="true">!</span>
    <div class="crit-body"><b>${esc(label)} hold</b>
      <span class="crit-meta">noted ${esc(whenWord(h.at))}</span>
      ${h.note ? `<p>${esc(h.note)}</p>` : ''}
      <p class="note">They cannot register online until this is lifted.</p></div>
    <div class="crit-acts no-print">
      <button class="btn sm" data-hold-open="${esc(s.id)}">Edit</button>
      <button class="btn sm ok-btn" data-hold-clear="${esc(s.id)}">Lifted</button></div>
  </div>`;
}

function drawHold(s) {
  holdStudent = s;
  const h = s.hold || {};
  holdKind = holdKind || h.kind || 'financial';
  $('#dlgBody').innerHTML = `
    <div class="dlg-h"><h3>${h.at ? 'The hold on ' : 'A hold on '}${esc(s.name.split(' ')[0])}</h3>
      <p class="note">Add a reported iConnect hold here. It stays visible until you mark it lifted.</p></div>
    <div class="dlg-b">
      <div class="reasons">${HOLD_KINDS.map(([k, label, hint]) => `
        <button class="reason" data-hold-kind="${k}" aria-pressed="${holdKind === k}">
          <b>${label}</b>${hint ? `<span>${hint}</span>` : ''}</button>`).join('')}</div>
      <label class="f" for="holdNote">Anything to remember
        <textarea id="holdNote" rows="3" placeholder="What they said, and what has to happen.">${esc(h.note || '')}</textarea></label>
    </div>
    <div class="dlg-f"><button class="btn" data-close="1">Cancel</button>
      <button class="btn primary" data-hold-save="${esc(s.id)}">${h.at ? 'Save' : 'Note the hold'}</button></div>`;
  $('#dlg').showModal();
}

function meetingPanel(s) {
  const list = (s.meetings || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  const rows = list.map(m => `<div class="meet">
      <div class="meet-h"><b>${esc(new Date(m.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))}</b>
        <span>${esc(m.by ? 'Dr. ' + m.by : '')}</span>
        ${state.me.admin ? '' : `<button class="linkbtn" data-meet-del="${esc(s.id)}:${m.at}">Remove</button>`}</div>
      <p>${esc(m.text)}</p></div>`).join('');
  return `<div class="panel no-print"><div class="hd">Meetings${list.length ? '<i class="sep-dot" aria-hidden="true"></i>' + list.length : ''}</div>
    <div class="bd stack">
      ${state.me.admin ? '' : `<textarea id="meetText" rows="2" placeholder="What you agreed today"></textarea>
      <div><button class="btn sm primary" data-meet-add="${esc(s.id)}">Log this meeting</button></div>`}
      ${rows || '<p class="note">No meetings logged yet.</p>'}
    </div></div>`;
}

function notePanel(s) {
  const n = s.note || {};
  const r = reviewOf(s);
  // needs review: a records flag or the advisor's mark
  const needs = look(s).level !== 'ok' || !!n.flag;
  const when = at => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  /* admin viewing someone else's student: read only. Anything saved here
       would go into the admin's records, not the advisor's. */
  if (state.me.admin) {
    return `<div class="panel no-print"><div class="hd">The advisor's note</div><div class="bd stack">
      ${r ? `<p class="rev-line ${r.fresh.length ? 'back' : 'done'}">${r.fresh.length
        ? 'Reviewed ' + esc(when(r.at)) + ', but something new has been flagged since.'
        : 'Reviewed ' + esc(when(r.at)) + ' by ' + esc(r.by ? 'Dr. ' + r.by : 'the advisor') + '.'}</p>` : ''}
      <p>${n.text ? esc(n.text) : '<span class="note">No note written.</span>'}</p>
      ${n.flag ? '<p class="note">Marked for review by the advisor.</p>' : ''}
    </div></div>`;
  }

  let review;
  if (r && !r.fresh.length) {
    review = `<div class="rev-line done">
      <span class="rev-tick" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M4.6 8.2l2.2 2.2 4.7-4.7" fill="none" stroke="var(--surface)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <span>Reviewed ${esc(when(r.at))}. Off today's list until something new comes up.</span>
      <button class="linkbtn" data-unreview="${esc(s.id)}">Undo</button></div>`;
  } else if (r && r.fresh.length) {
    review = `<div class="rev-line back">
      <span>You reviewed them ${esc(when(r.at))}, and something new has been flagged since.</span>
      <button class="btn sm ok-btn" data-review="${esc(s.id)}">Reviewed again</button></div>`;
  } else if (needs) {
    review = `<div class="rev-line">
      <button class="btn sm ok-btn" data-review="${esc(s.id)}"><span class="rev-tick" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M4.6 8.2l2.2 2.2 4.7-4.7" fill="none" stroke="var(--surface)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Mark as reviewed</button>
      </div>`;
  } else {
    review = '';   // on track, nothing to review
  }

  return `${meetingPanel(s)}<div class="panel no-print"><div class="hd">Your note</div><div class="bd stack">
    ${review}
    <label class="f check"><input type="checkbox" id="noteFlag" ${n.flag ? 'checked' : ''}> Mark this student for review</label>
    <textarea id="noteText" rows="3" placeholder="What you want to remember or pass on">${esc(n.text || '')}</textarea>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn sm primary" data-note-save="${esc(s.id)}">Save note</button>
      ${n.at ? `<span class="note">saved ${new Date(n.at).toLocaleDateString()}</span>` : ''}
      ${n.text || n.flag ? `<button class="btn sm" data-note-clear="${esc(s.id)}">Clear</button>` : ''}
    </div>
  </div></div>`;
}





async function saveNoteFlag(flag) {
  const st = state.students.find(x => x.id === state.sel);
  if (!st) return;
  const draft = $('#noteText') ? $('#noteText').value : null;
  st.note = Object.assign({}, st.note || { text: '' }, { flag, by: state.me.name, at: Date.now() });
  await Store.saveStudent(state.me.slug, st);
  flush(); render();
  if (draft != null && $('#noteText')) $('#noteText').value = draft;
  toast(flag ? 'Marked for review' : 'No longer marked for review');
}

// ---- handing a message to the mail app ------------------------------------
/* A mailto: link cannot carry a long message (Windows and Outlook truncate
   at about 2,000 characters). Long messages open a new email with recipient
   and subject, and the full text is copied to the clipboard in the same click.
   Two targets are offered because university PCs often have no default mail
   app: Outlook on the web and the system mail app. */
const LINK_LIMIT = 1800;
const PASTE_HINT = 'The full list is on your clipboard. Click here and press Ctrl+V to paste it.';

function composeUrl(kind, to, subject, body) {
  const q = (k, v) => k + '=' + encodeURIComponent(v);
  if (kind === 'outlook') {
    return 'https://outlook.office.com/mail/deeplink/compose?'
      + [q('to', to), q('subject', subject), q('body', body)].join('&');
  }
  // don't encode the address, some apps then show @ as %40
  return 'mailto:' + to + '?' + [q('subject', subject), q('body', body)].join('&');
}

/* keep all of this synchronous inside the click: clipboard and window.open
   need a user gesture, and an await in between breaks that. */
/* A long list is trimmed, not dropped: the draft keeps as many students as
   fit in the link, adds "N more", and the full text goes to the clipboard. */
function shorten(kind, to, subject, body) {
  /* whole paragraphs: opening, then one student at a time while the final
       link is short enough. Measure the encoded link, not the text (a newline
       costs 3 chars encoded). */
  /* opening = everything before the first student. Used to assume 2
       paragraphs, which made it say "6 more" when 4 were missing (header got
       counted as a student). */
  const paras = body.split(/\n\s*\n/);
  const isStudent = t => /\(\d{6,12}\)/.test(t);
  let firstStudent = paras.findIndex(isStudent);
  if (firstStudent < 0) firstStudent = paras.length;
  const head = paras.slice(0, firstStudent);
  const rest = paras.slice(firstStudent);
  const fits = parts => composeUrl(kind, to, subject, parts.join('\n\n')).length <= LINK_LIMIT - 120;
  if (!fits(head)) return null;                 // even the opening doesn't fit
  const kept = head.slice();
  let used = 0;
  for (const p of rest) {
    if (!fits(kept.concat([p]))) break;
    kept.push(p); used++;
  }
  // count students only, not a closing line
  const missed = rest.filter(isStudent).length - kept.filter(isStudent).length;
  if (missed > 0) {
    kept.push('(' + missed + ' more ' + (missed === 1 ? 'student is' : 'students are')
      + ' on your clipboard: click here and press Ctrl+V to paste the whole list.)');
  }
  return kept.join('\n\n');
}

function composeMail(kind, to, subject, body) {
  let url = composeUrl(kind, to, subject, body);
  let copied = null;
  if (url.length > LINK_LIMIT) {
    copied = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(body)
      : Promise.reject(new Error('no clipboard'));
    const trimmed = shorten(kind, to, subject, body);
    url = composeUrl(kind, to, subject, trimmed || PASTE_HINT);
  }
  if (kind === 'outlook') {
    /* exactly one tab. window.open with 'noopener' always returns null, so the
           old fallback also navigated this page = two Outlook tabs. A
           programmatic link click opens one tab and leaves the portal alone. */
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a); a.click(); a.remove();
  } else {
    window.location.href = url;
  }
  const where = kind === 'outlook' ? 'Outlook is opening' : 'Your mail app is opening';
  if (!copied) { toast(where); return; }
  copied.then(
    () => toast(where + ' with as much of the list as fits. The whole list is copied, if you want it all.'),
    () => toast(where + ', but the list could not be copied. Use "Copy the message" and paste it in.'));
}



function standingWord(k) {
  return { GOOD_STANDING: 'Good standing', PROBATION: 'On probation', DISMISSAL_RISK: 'At risk', LOAD_CAPPED: 'Load capped' }[k] || k;
}

function tabTerm(s) {
  const { reg, snap } = look(s);
  if (!s.registration) {
    return `<div class="sec"><div class="panel"><div class="bd stack">
      <h3 style="font-size:17px">Not registered for ${esc(state.term)}</h3>
      <p class="note">No current schedule was imported. The student may not be registered, or may be missing from the file.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${s.email ? `<button class="btn primary sm" data-email="${esc(s.id)}" data-template="register">Send a reminder</button>` : ''}
        <button class="btn sm" data-tab="plan">See what they should take</button>
      </div>
    </div></div>
    ${repeatPanel(s, state.term)}</div>`;
  }
  const courses = s.registration.courses;
  const problems = reg.findings.filter(f => f.severity === 'BLOCK');
  const warns = reg.findings.filter(f => f.severity === 'WARN');
  const infos = reg.findings.filter(f => f.severity === 'INFO');
  const verdict = problems.length
    ? `<div class="chk block"><span class="ic">!</span><span class="tx"><p><b>${problems.length} registration problem${problems.length > 1 ? 's' : ''}</b></p></span></div>`
    : warns.length
      ? `<div class="chk warn"><span class="ic">!</span><span class="tx"><p><b>Valid registration · ${warns.length} check${warns.length > 1 ? 's' : ''}</b></p></span></div>`
      : `<div class="chk info"><span class="ic">&check;</span><span class="tx"><p><b>Registration checks passed.</b></p></span></div>`;

  return `<div class="split">
    <div class="sec">
      <div class="panel">
        <div class="hd">Registered for ${esc(state.term)}<i class="sep-dot" aria-hidden="true"></i>${reg.credits} credits</div>
        <div class="tw"><table class="t">
          <thead><tr><th>Course</th><th>Title</th><th>Sec</th><th class="n">Cr</th><th>When</th><th>Where</th><th>Counts as</th></tr></thead>
          <tbody>${courses.map(c => {
            const m = MAP[c.code] || {};
            const bad = reg.findings.some(f => f.course === c.code && f.severity === 'BLOCK');
            return `<tr>
              <td class="c" style="${bad ? 'color:var(--urgent);font-weight:600' : ''}">${esc(c.code)}</td>
              <td>${esc(nice(m.title || ''))}</td>
              <td class="c">${esc(c.section || '')}</td>
              <td class="n">${esc(c.cr)}</td>
              <td style="font-size:12px">${c.meetings.map(x => `${esc(x.day)} ${esc(x.start)}`).join('<br>')}</td>
              <td style="font-size:12px">${(() => {
                const camp = (state.offering.sections.find(x => x.crn === c.crn) || {}).campus
                  || ({ B: 'Beirut', D: 'Debbieh' })[(c.section || '')[0]] || '';
                return camp ? `<span class="campus ${camp === 'Debbieh' ? 'deb' : ''}">${esc(camp)}</span>` : '';
              })()}</td>
              <td style="font-size:12px;color:var(--muted)">${esc((C.buckets[m.bucket] || {}).label || '')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>
      <div class="panel"><div class="hd">Checks</div><div class="bd"><div class="checks">
        ${verdict}
        ${problems.concat(warns, infos).map(f => `<div class="chk ${f.severity === 'BLOCK' ? 'block' : f.severity === 'WARN' ? 'warn' : 'info'}">
          <span class="ic">${f.severity === 'INFO' ? 'i' : '!'}</span>
          <span class="tx"><p>${esc(f.message)}</p></span>
        </div>`).join('')}
      </div></div></div>
      ${repeatPanel(s, state.term)}
    </div>
    <div class="sec">
      <div class="panel"><div class="hd">Week</div><div class="bd">${weekGrid(courses, reg)}</div></div>
      <div class="panel"><div class="hd">Load</div><div class="bd">
        <div class="blk"><div class="r1"><b>${reg.credits} credits</b><span class="n">max ${reg.limits.max}</span></div>
          <div class="bar"><i class="${reg.credits > reg.limits.max ? '' : 'full'}" style="width:${Math.min(100, reg.credits / reg.limits.max * 100)}%"></i></div>
          <div class="miss">${esc(reg.limits.why)}</div></div>
      </div></div>
      ${s.email ? `<button class="btn no-print" data-email="${esc(s.id)}" data-template="${problems.length ? 'fix' : 'ok'}">Email about this registration</button>` : ''}
    </div>
  </div>`;
}

function weekGrid(courses, reg, planned) {
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  // only hours where two sections overlap count as a clash
  const at = (day, hour) => courses.filter(c => (c.meetings || []).some(m =>
    m.day === day && parseInt(m.start, 10) <= hour && parseInt(m.end, 10) > hour));
  let html = '<div class="week"><div class="dh"></div>' + days.map(d => `<div class="dh">${d[0] + d[1].toLowerCase()}</div>`).join('');
  for (let h = 8; h <= 19; h++) {
    html += `<div class="hh">${h}</div>`;
    days.forEach(d => {
      const hit = at(d, h);
      html += hit.length
        ? `<div class="cell ${planned ? 'plan' : 'on'} ${hit.length > 1 ? 'clash' : ''}"
             title="${esc(hit.map(c => c.code + ' ' + (c.section || '')).join(', '))}">${hit.length > 1 ? `<span>${hit.map(c => esc(c.code.replace(/^[A-Z]+/, ''))).join(' / ')}</span>` : `<span>${esc(hit[0].code)}</span>`}</div>`
        : '<div class="cell"></div>';
    });
  }
  return html + '</div>';
}

// courses being tried out for this student, by code
let basket = {};

// term choices: whatever is loaded + this term + the next two
function termChoices() {
  const set = {};
  state.offering.sections.forEach(x => { if (x.term) set[x.term] = 1; });
  let t = state.term;
  for (let i = 0; i < 3; i++) { set[t] = 1; t = E.nextTermAfter(t); }
  const rank = x => {
    const m = /(FALL|SPRING|SUMMER)\s+(\d{4})/.exec(x);
    return m ? +m[2] * 10 + { FALL: 0, SPRING: 1, SUMMER: 2 }[m[1]] : 0;
  };
  return Object.keys(set).sort((a, b) => rank(a) - rank(b));
}

function sectionsFor(code, term) {
  const t = term || state.planTerm;
  const forTerm = state.offering.sections.filter(x => x.code === code && x.term === t);
  return forTerm;
}

/* ---- saved term plans and overrides ----
   An advisor can save the trial schedule on the student's record, so it is there
   next time (and for a colleague covering). A BLOCK finding can be overridden with a
   written reason; the server stamps who and when and writes it to the audit log. */
let planLoadedFor = '';
const overrideKey = f => f.ruleId + '|' + f.message;
const savedPlanFor = s => (s.plan && s.plan.term === state.planTerm ? s.plan : null);
const canEditStudents = () => !state.me.admin;

function restoreSavedPlan(s) {
  const k = s.id + '|' + state.planTerm;
  if (planLoadedFor === k) return;
  planLoadedFor = k;
  const saved = savedPlanFor(s);
  if (!saved || Object.keys(basket).length) return;
  basket = {};
  saved.courses.forEach(c => {
    const sec = c.crn ? state.offering.sections.find(x => x.crn === c.crn) : null;
    basket[c.code] = sec
      ? { code: c.code, crn: sec.crn, section: sec.section, cr: sec.cr || (MAP[c.code] || {}).cr || 0, campus: sec.campus, meetings: sec.meetings }
      : { code: c.code, crn: null, section: c.section || '', cr: (MAP[c.code] || {}).cr || 0, campus: null, meetings: [] };
  });
}

function basketMatchesSaved(s) {
  const saved = savedPlanFor(s);
  if (!saved) return false;
  const now = Object.keys(basket).sort().map(code => code + ':' + (basket[code].crn || '')).join(',');
  const then = saved.courses.map(c => c.code + ':' + (c.crn || '')).sort().join(',');
  return now === then;
}

function planActions(s, picks) {
  const saved = savedPlanFor(s);
  const when = saved ? new Date(saved.savedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
  const who = saved ? ((FACULTY.find(f => f.slug === saved.savedBy) || {}).name || 'a colleague') : '';
  const status = !saved ? (picks.length ? 'Not saved yet.' : '')
    : basketMatchesSaved(s) ? `Saved ${esc(when)} by ${esc(who)}.`
    : `Changed since it was saved ${esc(when)}.`;
  if (!picks.length && !saved) return '';
  return `<div class="plan-actions no-print">
    ${status ? `<p class="note" role="status">${status}</p>` : ''}
    <div class="row-btns">
      ${canEditStudents() && picks.length ? `<button class="btn sm primary" data-plan-save="${esc(s.id)}"${saved && basketMatchesSaved(s) ? ' disabled' : ''}>Save plan</button>` : ''}
      ${picks.length ? `<button class="btn sm" data-plan-print="${esc(s.id)}">Print plan</button>` : ''}
    </div></div>`;
}

function findingRow(s, f) {
  const saved = savedPlanFor(s);
  const ov = f.severity === 'BLOCK' && saved && basketMatchesSaved(s)
    ? (saved.overrides || []).find(o => o.key === overrideKey(f)) : null;
  const cls = ov ? 'overridden' : f.severity === 'BLOCK' ? 'block' : f.severity === 'WARN' ? 'warn' : 'info';
  const by = ov ? ((FACULTY.find(p => p.slug === ov.by) || {}).name || 'an advisor') : '';
  return `<div class="chk ${cls}">
    <span class="ic">${f.severity === 'INFO' ? 'i' : ov ? '&check;' : '!'}</span>
    <span class="tx"><p>${esc(f.message)}</p>
      ${ov ? `<p class="ov-note">Overridden by ${esc(by)}: ${esc(ov.reason)}</p>` : ''}
      ${!ov && f.severity === 'BLOCK' && f.overridable && canEditStudents()
        ? `<button class="linkbtn" data-override="${esc(s.id)}" data-override-key="${esc(overrideKey(f))}">Override with a reason</button>` : ''}
    </span></div>`;
}

function planToSave(s, extraOverride) {
  const before = savedPlanFor(s);
  const keep = before && basketMatchesSaved(s) ? (before.overrides || []) : [];
  const overrides = keep.filter(o => !extraOverride || o.key !== extraOverride.key).concat(extraOverride ? [extraOverride] : []);
  return {
    term: state.planTerm,
    courses: Object.keys(basket).map(code => ({ code, crn: basket[code].crn || null, section: basket[code].section || '' })),
    overrides
  };
}

async function saveTermPlan(s, extraOverride) {
  const before = s.plan;
  s.plan = planToSave(s, extraOverride);
  try { await Store.saveStudent(state.me.slug, s); }
  catch (err) { s.plan = before; toast(err.message || 'The plan could not be saved.'); render(); return false; }
  s.plan.savedAt = Date.now(); s.plan.savedBy = state.me.slug;
  (s.plan.overrides || []).forEach(o => { if (!o.by) { o.by = state.me.slug; o.at = Date.now(); } });
  flush(); render();
  return true;
}

let overrideFor = null;
function drawOverride(s, key) {
  overrideFor = { id: s.id, key };
  const message = key.split('|').slice(1).join('|');
  $('#dlgBody').innerHTML = `
    <div class="dlg-h"><h3>Override this check</h3>
      <p class="note">The plan is saved with your reason. It is recorded with your name in the activity log.</p></div>
    <div class="dlg-b">
      <div class="chk block"><span class="ic">!</span><span class="tx"><p>${esc(message)}</p></span></div>
      <label class="f" for="ovReason">Why it is acceptable for this student
        <textarea id="ovReason" rows="3" maxlength="500" placeholder="For example: approved by the chair on 3 Nov, prerequisite taken abroad."></textarea></label>
      <p class="err" id="ovErr" hidden></p>
    </div>
    <div class="dlg-f"><button class="btn" data-close="1">Cancel</button>
      <button class="btn primary" data-override-save="1">Override and save plan</button></div>`;
  $('#dlg').showModal();
  setTimeout(() => { const el = $('#ovReason'); if (el) el.focus(); }, 60);
}

function planDocument(s) {
  const picks = Object.keys(basket).map(code => basket[code]);
  const chk = E.checkPlan(R, C, s, picks, state.planTerm, state.offering.sections);
  const saved = savedPlanFor(s);
  const ovs = saved && basketMatchesSaved(s) ? (saved.overrides || []) : [];
  const rows = picks.map(p => `<tr><td>${esc(p.code)}</td><td>${esc(nice((MAP[p.code] || {}).title || ''))}</td>
    <td>${esc(p.cr)}</td><td>${esc(p.section || '-')}</td><td>${esc(p.campus || '')}</td>
    <td>${esc((p.meetings || []).map(m => m.day + ' ' + m.start + (m.end ? '-' + m.end : '')).join(', '))}</td></tr>`).join('');
  const checks = chk.findings.map(f => {
    const ov = ovs.find(o => o.key === overrideKey(f));
    return `<li><b>${f.severity === 'BLOCK' ? (ov ? 'Overridden' : 'Blocked') : f.severity === 'WARN' ? 'Warning' : 'Note'}:</b> ${esc(f.message)}${ov ? ` <i>Reason: ${esc(ov.reason)}</i>` : ''}</li>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Term plan - ${esc(s.name)}</title>
    <style>body{font:13px/1.45 system-ui,sans-serif;color:#111;margin:28px}h1{font-size:19px;margin:0 0 2px}
    .sub{color:#555;margin:0 0 16px}table{border-collapse:collapse;width:100%;margin:10px 0 14px}
    th,td{border:1px solid #bbb;padding:5px 7px;text-align:left;vertical-align:top}th{background:#f1f1f1}
    ul{padding-left:18px}.sign{display:flex;gap:40px;margin-top:40px}.sign div{flex:1;border-top:1px solid #333;padding-top:4px;color:#555}</style>
    </head><body>
    <h1>Term plan: ${esc(shortTerm(state.planTerm))}</h1>
    <p class="sub">${esc(s.name)}, ${esc(s.id)}${s.program ? ', ' + esc(s.program) : ''}${saved ? '. Saved ' + esc(new Date(saved.savedAt).toLocaleDateString()) : ''}</p>
    <table><thead><tr><th>Course</th><th>Title</th><th>Cr</th><th>Section</th><th>Campus</th><th>Times</th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr><th colspan="2">Total</th><th>${chk.credits}</th><th colspan="3">limit ${chk.limits.max}</th></tr></tfoot></table>
    ${checks ? `<h2 style="font-size:14px">Checks</h2><ul>${checks}</ul>` : '<p>All plan checks passed.</p>'}
    <div class="sign"><div>Advisor</div><div>Student</div><div>Date</div></div>
    </body></html>`;
}

function tabPlan(s) {
  const { snap } = look(s);
  /* no schedule for the running term -> can still register, so allow
       planning this term. Everyone else plans for next term. */
  // the calendar decides: this term while they can still register, else next
  const target = planTargetFor(s);
  if (state.planTerm !== target) { state.planTerm = target; basket = {}; }
  restoreSavedPlan(s);
  const termSwitch = '';
  const plan = E.planNextTerm(R, C, s, state.planTerm, state.offering.sections);
  const picks = Object.keys(basket).map(code => basket[code]);
  const chk = E.checkPlan(R, C, s, picks, state.planTerm, state.offering.sections);
  const top = plan.recommendations.slice(0, 16);
  const clashCodes = new Set();
  chk.findings.filter(f => f.ruleId === 'PLAN-CLASH').forEach(f =>
    (f.message.match(/[A-Z]{3,4}\d{3}[A-Z]?/g) || []).forEach(c => clashCodes.add(c)));

  const row = c => {
    const secs = sectionsFor(c.code);
    const chosen = basket[c.code];
    return `<div class="pick ${chosen ? 'on' : ''}">
      <div>
        <div class="ttl"><span class="cd">${esc(c.code)}</span> ${esc(nice(c.title || ''))}
          <span class="chip">${esc(c.cr)} cr</span>
          ${c.inTrack ? '<span class="chip brand">track</span>' : ''}
          ${c.season === 'match' ? `<span class="chip ok">runs in ${esc(shortTerm(state.planTerm).split(' ')[0])}</span>` : ''}
          ${c.season === 'off' ? `<span class="chip watch">${/SPRING/i.test(state.planTerm) ? 'Fall' : 'Spring'} course</span>` : ''}
          ${c.season === 'repeat' ? '<span class="chip">also runs then</span>' : ''}
          ${plan.hasOfferingForTerm && !secs.length ? '<span class="chip watch">not in the offering</span>' : ''}</div>
        <div class="why">${esc(c.reasons.slice(0, 2).join(' \u00b7 '))}</div>
        ${secs.length ? `<div class="secs">${secs.map(x => `
          <button class="sec ${x.campus === 'Debbieh' ? 'deb' : ''}" data-add-sec="${esc(x.crn)}" data-code="${esc(c.code)}"
            aria-pressed="${chosen && chosen.crn === x.crn}"
            title="${esc((x.campus || '') + ' ' + (x.teacher || ''))}">${esc(x.section || x.crn)}
            ${x.meetings.length ? esc(x.meetings.map(m => m.day + ' ' + m.start).join(' ')) : 'time to confirm'}</button>`).join('')}</div>`
          : !plan.hasOfferingForTerm ? '' : `<div class="secs"><button class="sec" data-add-sec="none" data-code="${esc(c.code)}"
               aria-pressed="${!!chosen}">add without a section</button></div>`}
      </div>
      <button class="btn sm ${chosen ? 'primary' : ''}" data-toggle="${esc(c.code)}">${chosen ? 'Added' : 'Add'}</button>
    </div>`;
  };

  return `<div class="split">
    <div class="sec">
      ${repeatPanel(s, state.planTerm)}
      <div class="panel">
        <div class="hd hd-row">What to take in ${esc(shortTerm(state.planTerm))}${termSwitch}</div>
${plan.hasOfferingForTerm ? '' : `<div class="bd" style="padding-bottom:6px"><p class="note">No ${esc(shortTerm(state.planTerm))} offering yet · study plan</p></div>`}
        <div>${top.map(row).join('')}</div>
      </div>
    </div>
    <div class="sec">
      <div class="panel"><div class="hd">Trial schedule</div><div class="bd">
        <div class="meter"><b>${chk.credits}</b><span>of ${chk.limits.max} credits</span></div>
        <div class="bar"><i class="${chk.credits > chk.limits.max ? '' : 'full'}"
          style="width:${Math.min(100, chk.credits / chk.limits.max * 100)}%"></i></div>
        ${(() => {
          /* room left under the limit: show how much + the next ranked courses that fit */
          const left = chk.limits.max - chk.credits;
          if (!picks.length || left <= 0) return '';
          // skip what the plan already covers: dept electives once the plan fills the
          // credits needed, and a 2nd course for a requirement already met
          const byC = code => C.courses.find(x => x.code === code) || {};
          const deB = (plan.snapshot && plan.snapshot.buckets.DEPT_ELECTIVE) || { required: 0, earned: 0 };
          const dePicked = picks.filter(p => byC(p.code).bucket === 'DEPT_ELECTIVE').reduce((n, p) => n + (Number(byC(p.code).cr) || 3), 0);
          const deLeft = deB.required - deB.earned - dePicked;
          const pickedReasons = new Set(plan.recommendations.filter(c => basket[c.code] && c.bucket === 'UNIV_ELECTIVE').map(c => c.reasons[0]));
          const next = plan.recommendations.filter(c => !basket[c.code] && (Number(c.cr) || 0) <= left
            && !(c.bucket === 'DEPT_ELECTIVE' && deLeft <= 0)
            && !(c.bucket === 'UNIV_ELECTIVE' && pickedReasons.has(c.reasons[0]))).slice(0, 3);
          return `<div class="room"><p class="note"><b>${left} credits available</b>${next.length ? ' · next:' : ''}</p>
            ${next.map(c => `<div class="room-row"><span class="cd">${esc(c.code)}</span><span class="t">${esc(nice(c.title || ''))} <small>${esc(c.cr)} cr \u00b7 ${esc(c.reasons[0] || '')}</small></span>
              <button class="btn sm" data-toggle="${esc(c.code)}">Add</button></div>`).join('')}</div>`;
        })()}
        <div style="margin-top:12px">${!picks.length
          ? '<p class="note">Nothing picked yet.</p>'
          : picks.some(p => (p.meetings || []).length) ? weekGrid(picks, { findings: chk.findings }, true)
          : '<p class="note">Import the offering to show class times.</p>'}</div>
        ${picks.length ? `<div class="basket" style="margin-top:12px">${picks.map(p => `
          <div class="bitem ${clashCodes.has(p.code) ? 'clash' : ''}">
            <span class="cd">${esc(p.code)}</span>
            <span>${esc(p.section || 'no section')}</span>
            ${p.campus ? `<span class="campus ${p.campus === 'Debbieh' ? 'deb' : ''}">${esc(p.campus)}</span>` : ''}
            <button class="x" data-drop="${esc(p.code)}" aria-label="Remove">&times;</button>
          </div>`).join('')}
          <button class="btn sm" data-clear-basket="1" style="align-self:flex-start;margin-top:4px">Clear all</button>
        </div>` : ''}
        ${planActions(s, picks)}
      </div></div>
      ${picks.length ? `<div class="panel"><div class="hd">Checks on this plan</div><div class="bd"><div class="checks">
        ${chk.findings.length ? chk.findings.map(f => findingRow(s, f)).join('')
          : '<div class="chk info"><span class="ic">&check;</span><span class="tx"><p>Plan checks passed.</p></span></div>'}
        ${chk.lookAhead && chk.lookAhead.opens.length ? `<div class="chk info"><span class="ic">i</span>
          <span class="tx"><p>Passing these opens ${chk.lookAhead.opens.slice(0, 6).join(', ')} the term after.</p></span></div>` : ''}
      </div></div></div>` : ''}
      ${plan.track ? `<div class="panel"><div class="hd">${esc(plan.track.label)} track</div><div class="bd">
        <p class="note">${snap.trackProgress[plan.track.key].count} of ${snap.trackProgress[plan.track.key].needed} courses.
        ${esc(snap.trackProgress[plan.track.key].done.concat(snap.trackProgress[plan.track.key].doing).join(', ') || 'None yet')}.</p>
        <div class="chips" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px">
          ${plan.track.courses.map(c => {
            const done = snap.passed.has(c), doing = snap.inProgress.has(c);
            return `<span class="chip ${done ? 'ok' : doing ? 'watch' : ''}">${c}${done ? ' done' : doing ? ' now' : ''}</span>`;
          }).join('')}</div>
      </div></div>` : ''}
    </div>
  </div>`;
}

// ---- course chain ---------------------------------------------------------
/* faculty core + major core laid out by study-plan semester, arrows to what
   each course opens. Click a course to trace it. */
let chainFocus = null, chainAll = false;

function tabChain(s) {
  const { snap } = look(s);
  const { scores, dependents } = E.buildUnlockScores(C);
  const spine = C.courses.filter(c => ['FACULTY_CORE', 'MAJOR_CORE'].includes(c.bucket)).map(c => c.code);
  const inSpine = new Set(spine);

  const walk = (code, dir, seen) => {
    seen = seen || new Set();
    const next = dir === 'up' ? ((MAP[code] || {}).pre || []) : (dependents[code] || []);
    next.forEach(n => { if (inSpine.has(n) && !seen.has(n)) { seen.add(n); walk(n, dir, seen); } });
    return seen;
  };
  let lit = null;
  if (chainFocus && MAP[chainFocus]) {
    lit = new Set([chainFocus]);
    walk(chainFocus, 'up').forEach(c => lit.add(c));
    walk(chainFocus, 'down').forEach(c => lit.add(c));
  }

  const state_ = c => snap.passed.has(c) ? 'p'
    : snap.inProgress.has(c) ? 'n'
    : (((MAP[c] || {}).pre || []).every(x => snap.afterThisTerm.has(x))
       && !((MAP[c] || {}).minCredits > snap.earned)) ? 'o' : 'l';
  const FILL = { p: 'var(--ok-soft)', n: 'var(--watch-soft)', o: 'var(--brand-soft)', l: 'var(--sunk)' };
  const EDGE = { p: 'var(--ok)', n: 'var(--watch)', o: 'var(--brand)', l: 'var(--line2)' };
  const TEXT = { p: 'var(--ok)', n: 'var(--watch)', o: 'var(--brand-ink)', l: 'var(--faint)' };
  const counts = { p: 0, n: 0, o: 0, l: 0 };
  spine.forEach(c => counts[state_(c)]++);

  const cols = {};
  spine.forEach(c => { const k = (MAP[c].planSem || 1) - 1; (cols[k] = cols[k] || []).push(c); });
  const nCol = Math.max.apply(null, Object.keys(cols).map(Number)) + 1;
  const CW = 150, NW = 124, NH = 36, RH = 46, PADX = 16, HEAD = 34, PADB = 12;
  const rows = Math.max.apply(null, Object.keys(cols).map(k => cols[k].length));
  const H = HEAD + rows * RH + PADB, W = PADX * 2 + nCol * CW;
  const pos = {};
  Object.keys(cols).forEach(k => cols[k]
    .sort((a, b) => (scores[b] || 0) - (scores[a] || 0) || a.localeCompare(b))
    .forEach((c, i) => { pos[c] = { x: PADX + Number(k) * CW, y: HEAD + i * RH }; }));

  let bands = '';
  for (let k = 0; k < nCol; k++) {
    if (k % 2 === 0) bands += `<rect x="${PADX + k * CW - 7}" y="${HEAD - 9}" width="${CW - 4}" height="${rows * RH - 2}" rx="10" fill="var(--sunk)" opacity=".55"/>`;
    bands += `<text x="${PADX + k * CW + NW / 2}" y="21" text-anchor="middle" fill="var(--muted)"
      font-family="var(--sans)" font-size="11.5" font-weight="600">Semester ${k + 1}</text>`;
  }

  /* arrows only for the traced course, one step each way: prereqs (green done,
       red missing) and what it opens (blue). All links at once was unreadable.
       "Show all links" is still there. */
  let edges = '';
  const arrow = (p, c, kind) => {
    const a = pos[p], b = pos[c];
    if (!a || !b) return;
    const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x - 8, y2 = b.y + NH / 2, mx = (x1 + x2) / 2;
    const col = kind === 'ok' ? 'var(--ok)' : kind === 'bl' ? 'var(--urgent)' : kind === 'op' ? 'var(--brand)' : 'var(--line2)';
    const w = kind === 'all' ? 1.2 : 2.4;
    edges += `<path d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" fill="none" stroke="${col}" stroke-width="${w}"
      opacity="${kind === 'all' ? 0.55 : 0.9}" marker-end="url(#ah${kind})"/>`;
  };
  if (chainFocus && MAP[chainFocus]) {
    ((MAP[chainFocus].pre) || []).filter(p => pos[p]).forEach(p =>
      arrow(p, chainFocus, snap.passed.has(p) || snap.inProgress.has(p) ? 'ok' : 'bl'));
    (dependents[chainFocus] || []).filter(d => pos[d]).forEach(d => arrow(chainFocus, d, 'op'));
  } else if (chainAll) {
    spine.forEach(c => ((MAP[c].pre) || []).filter(p => pos[p]).forEach(p => arrow(p, c, 'all')));
  }
  if (chainFocus) {
    lit = new Set([chainFocus].concat((MAP[chainFocus].pre || []), (dependents[chainFocus] || [])));
  }

  /* coloured left spine + a text line for state. Replaced ticks/crosses that
       meant nothing until learned, and colour alone fails for red/green
       colour blindness. */
  const WORD = { p: 'passed', n: 'taking it now', o: 'open next term', l: 'waiting' };
  let nodes = '';
  spine.forEach(c => {
    const st = state_(c), p = pos[c], u = scores[c] || 0;
    const dim = lit && !lit.has(c);
    const nodeOpacity = dim ? 0.22 : (st === 'l' && chainFocus !== c ? 0.58 : 1);
    const miss = ((MAP[c].pre) || []).filter(x => !snap.afterThisTerm.has(x))
      .concat(MAP[c].minCredits > snap.earned ? [MAP[c].minCredits + ' credits'] : []);
    let second = st === 'l' && miss.length ? 'after ' + miss.join(' and ')
      : st === 'o' ? 'open next term' : st === 'n' ? 'taking it now' : MAP[c].cr + ' credits';
    if (second.length > 20) second = second.slice(0, 19) + '\u2026';
    const on = chainFocus === c;
    nodes += `<g class="gn${on ? ' on' : ''}${st === 'l' ? ' waiting' : ''}" data-node="${c}" opacity="${nodeOpacity}" style="cursor:pointer">
      <title>${esc(nice(MAP[c].title) + ', ' + WORD[st])}</title>
      <rect x="${p.x}" y="${p.y}" width="${NW}" height="${NH}" rx="7" fill="${FILL[st]}"
        stroke="${on ? 'var(--ink)' : EDGE[st]}" stroke-width="${on ? 2 : 1}"/>
      <rect x="${p.x}" y="${p.y}" width="3.5" height="${NH}" rx="1.75" fill="${EDGE[st]}"/>
      <text x="${p.x + 12}" y="${p.y + 15}" font-family="var(--mono)" font-size="12" font-weight="600" fill="${TEXT[st]}">${c}</text>
      <text x="${p.x + 12}" y="${p.y + 28}" font-family="var(--sans)" font-size="10.5" fill="var(--muted)">${esc(second)}</text>
      ${u && st !== 'p' ? `<text x="${p.x + NW - 9}" y="${p.y + 21}" text-anchor="end" font-family="var(--sans)" font-size="10.5" font-weight="600" fill="${EDGE[st]}">+${u}</text>` : ''}
    </g>`;
  });

  // tracing highlights the course and its links on the map; no extra panel
  const detail = '';

  return `<div class="sec">
    <div class="panel">
      <div class="hd">The course chain${chainFocus ? '<i class="sep-dot" aria-hidden="true"></i>tracing ' + chainFocus : ''}</div>
      <div class="bd">
        <p class="chain-lead">${counts.p} of ${spine.length} required courses are behind ${esc(s.name.split(' ')[0])} · ${counts.o} open next term · ${counts.l} waiting</p>
        <p class="note">Tap a course to trace it: <span class="ln ok">green</span> done, <span class="ln bl">red</span> missing, <span class="ln op">blue</span> opens next.</p>
        <div class="legend" style="margin:10px 0">
          <span><i class="p"></i>${counts.p} passed</span>
          <span><i class="n"></i>${counts.n} taking now</span>
          <span><i class="o"></i>${counts.o} open next term</span>
          <span><i class="l"></i>${counts.l} waiting · faded grey</span>
          ${chainFocus ? '<button class="linkbtn" data-node="clear">stop tracing ' + esc(chainFocus) + '</button>'
            : `<button class="linkbtn" data-chain-all="1">${chainAll ? 'hide all links' : 'show all links'}</button>`}
        </div>
        <div class="chain">
          <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
            <defs>
              <marker id="ahok" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" fill="var(--ok)"/></marker>
              <marker id="ahbl" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" fill="var(--urgent)"/></marker>
              <marker id="ahop" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" fill="var(--brand)"/></marker>
              <marker id="ahall" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" fill="var(--line2)"/></marker>
            </defs>
            ${bands}${edges}${nodes}
          </svg>
        </div>
        ${detail}
      </div>
    </div>
  </div>`;
}

/* same thing as text: what's open now and what each missing course is
   holding up. */
function chainWords(s, snap, scores, dependents) {
  const spine = C.courses.filter(c => ['FACULTY_CORE', 'MAJOR_CORE'].includes(c.bucket)).map(c => c.code);
  const openNow = spine.filter(c => !snap.passed.has(c) && !snap.inProgress.has(c)
    && ((MAP[c] || {}).pre || []).every(x => snap.afterThisTerm.has(x)));
  const gates = spine.filter(c => !snap.afterThisTerm.has(c))
    .map(c => ({ code: c, holds: (dependents[c] || []).filter(d => !snap.afterThisTerm.has(d)), unlocks: scores[c] || 0 }))
    .filter(g => g.holds.length)
    .sort((a, b) => b.unlocks - a.unlocks)
    .slice(0, 6);
  if (!openNow.length && !gates.length) {
    return `<div class="panel"><div class="bd"><p class="note">Every required course is passed or being taken now. Nothing in the chain is waiting.</p></div></div>`;
  }
  return `<div class="panel">
    <div class="hd">What the chain means for ${esc(s.name.split(' ')[0])}</div>
    <div class="bd stack">
      ${openNow.length ? `<div><div class="lbl">Open next term, nothing in the way</div>
        <div class="codes">${openNow.slice(0, 12).map(c => `<span class="codechip" data-node="${c}">${c} <b>${esc(nice(MAP[c].title))}</b></span>`).join('')}</div></div>` : ''}
      ${gates.length ? `<div><div class="lbl">Still missing, and what each one is holding up</div>
        <div class="gates">${gates.map(g => `<div class="gate" data-node="${g.code}">
          <span class="cd">${g.code}</span>
          <span class="arrow">&rarr;</span>
          <span class="holds">${g.holds.slice(0, 5).map(h => `<code>${h}</code>`).join(' ')}${g.holds.length > 5 ? ' and ' + (g.holds.length - 5) + ' more' : ''}</span>
          ${g.unlocks ? `<span class="chip">${g.unlocks} credits</span>` : ''}
        </div>`).join('')}</div></div>` : ''}
    </div>
  </div>`;
}

/* Roadmap: the semesters left until graduation, worked out by running the
   recommender term after term. Each term takes the top courses that still
   fill something (block by block, never past the load limit), assumes they
   are passed, and moves on. A projection to plan with, not a promise. */
function roadmapFor(s) {
  const key = s.id + ':' + (s.updatedAt || 0) + ':' + state.term + ':' + planTargetFor(s);
  if (roadmapCache[key]) return roadmapCache[key];
  const map = MAP;
  let hist = (s.history || []).slice();
  let term = planTargetFor(s);
  // courses being taken now count as passed when the plan is for next term
  if (term !== state.term && regFor(s)) {
    hist = hist.concat(s.registration.courses.map(c => ({ code: c.code, cr: Number(c.cr) || (map[c.code] || {}).cr || 0, grade: 'B', term: state.term, flag: '' })));
  }
  const out = [];
  for (let k = 0; k < 10; k++) {
    const st = Object.assign({}, s, { history: hist, registration: null });
    const snap = E.snapshot(R, C, st);
    const audit = E.graduationAudit(R, C, st);
    if (audit.remainingCredits <= 0) break;
    const plan = E.recommend(R, C, st, term, null);
    const max = Math.min((plan.limits && plan.limits.max) || 18, /SUMMER/i.test(term) ? 9 : 18);
    const room = {};
    Object.keys(snap.buckets).forEach(b => { room[b] = snap.buckets[b].remaining; });
    const picks = []; let cr = 0;
    plan.recommendations.forEach(c => {
      const ccr = Number(c.cr) || 0;
      if (cr + ccr > max) return;
      const b = c.bucket === 'REMEDIAL' ? null : c.bucket;
      if (b && room[b] != null && room[b] <= 0) return;
      if (picks.some(p => p.code === c.code)) return;
      picks.push(c); cr += ccr; if (b && room[b] != null) room[b] -= ccr;
    });
    if (!picks.length) break;
    out.push({ term, picks, cr });
    hist = hist.concat(picks.map(c => ({ code: c.code, cr: Number(c.cr) || 0, grade: 'B', term, flag: '', bucketOverride: c.bucket })));
    term = E.nextTermAfter(term);
    if (/SUMMER/i.test(term)) term = E.nextTermAfter(term);
  }
  roadmapCache[key] = out;
  return out;
}
const roadmapCache = {};

function tabRoadmap(s) {
  const terms = roadmapFor(s);
  if (!terms.length) return `<div class="panel"><div class="bd"><p class="empty">Nothing left to plan. Every requirement is done or in progress.</p></div></div>`;
  const last = terms[terms.length - 1].term;
  const kind = c => c.bucket === 'MAJOR_CORE' || c.bucket === 'FACULTY_CORE' ? 'core'
    : c.bucket === 'DEPT_ELECTIVE' ? 'de' : c.bucket === 'REMEDIAL' ? 'rem' : 'el';
  return `<div class="roadmap-head">
      <div><span>Expected to graduate</span><b>${esc(shortTerm(last))}</b></div>
      <div><span>Semesters left</span><b>${terms.length}</b></div>
      <div class="legend-mini"><i class="core"></i>core<i class="de"></i>dept. elective<i class="el"></i>other elective</div>
    </div>
    <div class="roadmap">${terms.map((t, i) => `<div class="rm-col ${i === 0 ? 'first' : ''}">
      <div class="rm-h"><b>${esc(shortTerm(t.term))}</b><span>${t.cr} cr</span></div>
      ${t.picks.map(c => `<div class="rm-c ${kind(c)}" title="${esc(nice(c.title || ''))}"><b>${esc(c.code)}</b><span>${esc(nice(c.title || ''))}</span></div>`).join('')}
    </div>`).join('')}</div>
    <p class="note" style="margin-top:10px">A projection from the study plan, assuming every course is passed.</p>`;
}

function tabSheet(s) {
  const { snap } = look(s);
  const groups = [
    ['University Requirements', C.courses.filter(c => c.bucket === 'UNIV_MANDATORY' && !c.alternateFor).map(c => c.code).concat(['IC3'])],
    ['Faculty Core', C.courses.filter(c => c.bucket === 'FACULTY_CORE').map(c => c.code)],
    ['Major Core', C.courses.filter(c => c.bucket === 'MAJOR_CORE').map(c => c.code)]
  ];
  const taken = {};
  snap.best.forEach(r => { taken[r.code] = r; });
  const row = code => {
    const c = MAP[code] || { title: code, cr: '' };
    const r = taken[code];
    const now = !r && snap.inProgress.has(code);
    const pre = (c.pre || []).join(', ');
    return `<tr class="${r || now ? '' : 'dim'}">
      <td class="c">${esc(code)}</td><td>${esc(nice(c.title || ''))}</td>
      <td class="n">${esc(c.cr)}</td><td class="c" style="font-size:11px">${esc(pre)}</td>
      <td style="font-size:11.5px">${r ? esc(r.term) : now ? esc(state.term) : ''}</td>
      <td class="g ${r ? gradeClass(r.grade) : ''}" style="${now ? 'color:var(--watch);font-size:11px' : ''}">${r ? esc(r.grade) : now ? 'taking now' : ''}</td>
    </tr>`;
  };
  const freeBlock = (label, bucket) => {
    const b = snap.buckets[bucket];
    const rows = snap.best.filter(r => (MAP[r.code] || {}).bucket === bucket)
      .concat(Array.from(snap.inProgress).filter(code => (MAP[code] || {}).bucket === bucket)
        .map(code => ({ code, cr: (MAP[code] || {}).cr || 0, grade: '', term: state.term, now: true })));
    return `<div class="panel" style="margin-top:14px"><div class="hd">${label}<i class="sep-dot" aria-hidden="true"></i>${b ? b.earned + ' of ' + b.required + ' credits' : ''}</div>
      <div class="tw"><table class="t"><thead><tr><th>Course</th><th>Title</th><th class="n">Cr</th><th>Term</th><th>Grade</th></tr></thead>
      <tbody>${rows.length ? rows.map(r => `<tr><td class="c">${esc(r.code)}</td><td>${esc(nice((MAP[r.code] || {}).title || r.title || ''))}</td>
        <td class="n">${esc(r.cr)}</td><td style="font-size:11.5px">${esc(r.term)}</td>
        <td class="g ${gradeClass(r.grade)}" style="${r.now ? 'color:var(--watch);font-size:11px' : ''}">${r.now ? 'taking now' : esc(r.grade)}</td></tr>`).join('')
        : `<tr><td colspan="5" style="color:var(--muted);font-size:12.5px">Nothing recorded yet</td></tr>`}</tbody></table></div></div>`;
  };
  return `<div class="sec">
    <div class="no-print" style="display:flex;gap:8px;align-items:center">
      <button class="btn primary sm" data-print="${esc(s.id)}">Print this sheet</button>
    </div>
    <div class="panel"><div class="bd" style="text-align:center;border-bottom:1px solid var(--line)">
      <div style="font-family:var(--serif);font-weight:700;font-size:16px">Beirut Arab University</div>
      <div style="font-size:12.5px;color:var(--muted)">${esc(progFacultyName())}<i class="sep-dot" aria-hidden="true"></i>${esc(progDeptLine())}</div>
      <div style="font-size:11.5px;color:var(--muted)">${esc(ADVISORY_LINE)}</div>
      <div style="font-size:12.5px;color:var(--muted)">Advising contract sheet<i class="sep-dot" aria-hidden="true"></i>${esc(state.term)}</div>
    </div>
    <div class="bd">
      <dl class="kv" style="grid-template-columns:auto 1fr auto 1fr">
        <dt>Student</dt><dd>${esc(s.name)}</dd><dt>ID</dt><dd class="mono">${esc(s.id)}</dd>
        <dt>CGPA</dt><dd class="mono">${s.officialCgpa != null ? s.officialCgpa.toFixed(2) : '\u2014'}</dd>
        <dt>Credits completed</dt><dd class="mono">${studied(s).credits} (${snap.earned} of ${C.totalCredits} toward the degree)</dd>
        <dt>Advisor</dt><dd>${esc(advisorOfStudent(s))}</dd><dt>Semester</dt><dd>${snap.completedSemesters + 1}</dd>
      </dl>
    </div></div>
    ${groups.map(([label, codes]) => `<div class="panel" style="margin-top:14px">
      <div class="hd">${label}</div>
      <div class="tw"><table class="t">
        <thead><tr><th>Course</th><th>Title</th><th class="n">Cr</th><th>Prereq</th><th>Term</th><th>Grade</th></tr></thead>
        <tbody>${codes.map(row).join('')}</tbody></table></div></div>`).join('')}
    ${freeBlock('University Electives', 'UNIV_ELECTIVE')}
    ${freeBlock('Departmental Electives', 'DEPT_ELECTIVE')}
    ${freeBlock('General Science Electives', 'GEN_SCI_ELECTIVE')}
    <p class="note" style="margin-top:12px">Grades and credits come from the official transcript.</p>
  </div>`;
}

// ---- printing -------------------------------------------------------------
/* we run inside a frame, where window.print() can print the wrong doc or
   nothing. So the sheet is its own small document printed from its own frame. */
function sheetDocument(s) {
  const { snap } = look(s);
  const groups = [
    ['University Requirements', C.courses.filter(c => c.bucket === 'UNIV_MANDATORY' && !c.alternateFor).map(c => c.code).concat(['IC3'])],
    ['Faculty Core', C.courses.filter(c => c.bucket === 'FACULTY_CORE').map(c => c.code)],
    ['Major Core', C.courses.filter(c => c.bucket === 'MAJOR_CORE').map(c => c.code)]
  ];
  const taken = {};
  snap.best.forEach(r => { taken[r.code] = r; });
  const cell = code => {
    const c = MAP[code] || { title: code, cr: '' };
    const r = taken[code];
    const now = !r && snap.inProgress.has(code);
    return `<tr><td class="c">${esc(code)}</td><td>${esc(nice(c.title || ''))}</td><td class="n">${esc(c.cr)}</td>
      <td class="c small">${esc((c.pre || []).join(', '))}</td>
      <td class="small">${r ? esc(r.term) : now ? esc(state.term) : ''}</td>
      <td class="g">${r ? esc(r.grade) : now ? 'taking now' : ''}</td></tr>`;
  };
  const freeBlock = (label, bucket) => {
    const b = snap.buckets[bucket];
    const rows = snap.best.filter(r => (MAP[r.code] || {}).bucket === bucket)
      .concat(Array.from(snap.inProgress).filter(code => (MAP[code] || {}).bucket === bucket)
        .map(code => ({ code, cr: (MAP[code] || {}).cr || 0, grade: 'taking now', term: state.term })));
    return `<h3>${label} <span>${b ? b.earned + ' of ' + b.required + ' credits' : ''}</span></h3>
      <table><thead><tr><th>Course</th><th>Title</th><th class="n">Cr</th><th>Term</th><th>Grade</th></tr></thead>
      <tbody>${rows.length ? rows.map(r => `<tr><td class="c">${esc(r.code)}</td>
        <td>${esc(nice((MAP[r.code] || {}).title || ''))}</td><td class="n">${esc(r.cr)}</td>
        <td class="small">${esc(r.term)}</td><td class="g">${esc(r.grade)}</td></tr>`).join('')
        : '<tr><td colspan="5" class="small">Nothing recorded yet</td></tr>'}</tbody></table>`;
  };
  const plan = E.planNextTerm(R, C, s, planTargetFor(s), state.offering.sections).recommendations.slice(0, 6);

  return `<!doctype html><html><head><meta charset="utf-8"><title>Contract sheet ${esc(s.name)}</title>
  <style>
    @page { size: A4; margin: 14mm 12mm; }
    body { font: 11px/1.45 "Helvetica Neue", Arial, sans-serif; color: #141b28; margin: 0; }
    .head { text-align: center; border-bottom: 2px solid #1B3668; padding-bottom: 8px; margin-bottom: 12px; }
    .head .u { font-size: 15px; font-weight: 700; color: #1B3668; letter-spacing: .01em; }
    .head .f { font-size: 11px; color: #4a5468; margin-top: 2px; }
    .head .t { font-size: 12px; font-weight: 600; margin-top: 6px; }
    .id { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 14px; margin-bottom: 12px; font-size: 11px; }
    .id div { border-bottom: 1px solid #d3dae6; padding-bottom: 2px; }
    .id span { color: #77839A; }
    h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; background: #EDF1F8; color: #1B3668;
         padding: 4px 7px; margin: 12px 0 4px; display: flex; justify-content: space-between; }
    h3 span { color: #4a5468; font-weight: 500; letter-spacing: 0; text-transform: none; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #77839A;
         border-bottom: 1px solid #d3dae6; padding: 3px 5px; }
    td { padding: 3px 5px; border-bottom: 1px solid #e8edf5; }
    td.c { font-family: "Courier New", monospace; white-space: nowrap; }
    td.n, th.n { text-align: right; width: 34px; }
    td.g { font-family: "Courier New", monospace; font-weight: 700; width: 64px; }
    td.small, .small { font-size: 9.5px; color: #77839A; }
    .next { margin-top: 12px; border: 1px solid #1B3668; padding: 8px 10px; }
    .next b { color: #1B3668; }
    .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 26px; font-size: 10px; }
    .sign div { border-top: 1px solid #141b28; padding-top: 3px; color: #4a5468; }
    .foot { margin-top: 14px; font-size: 8.5px; color: #77839A; border-top: 1px solid #e8edf5; padding-top: 5px; }
    tbody tr { break-inside: avoid; } h3 { break-after: avoid; } table { break-inside: auto; }
  </style></head><body>
  <div class="head">
    <div class="u">Beirut Arab University</div>
    <div class="f">${esc(progFacultyName())}<i class="sep-dot" aria-hidden="true"></i>${esc(progDeptLine())}</div>
    <div class="f">${esc(ADVISORY_LINE)}</div>
    <div class="t">Advising contract sheet<i class="sep-dot" aria-hidden="true"></i>${esc(state.term)}</div>
  </div>
  <div class="id">
    <div><span>Student</span><br>${esc(s.name)}</div>
    <div><span>ID</span><br>${esc(s.id)}</div>
    <div><span>Campus</span><br>${esc(s.campus || 'Beirut')}</div>
    <div><span>Semester</span><br>${snap.completedSemesters + 1}</div>
    <div><span>CGPA</span><br>${s.officialCgpa != null ? s.officialCgpa.toFixed(2) : '-'}</div>
    <div><span>Credits toward the degree</span><br>${snap.earned} of ${C.totalCredits}</div>
    <div><span>Credits completed</span><br>${studied(s).credits}</div>
    <div><span>Advisor</span><br>${esc(advisorOfStudent(s))}</div>
  </div>
  ${groups.map(([label, codes]) => `<h3>${label}</h3>
    <table><thead><tr><th>Course</th><th>Title</th><th class="n">Cr</th><th>Prerequisite</th><th>Term</th><th>Grade</th></tr></thead>
    <tbody>${codes.map(cell).join('')}</tbody></table>`).join('')}
  ${freeBlock('University Electives', 'UNIV_ELECTIVE')}
  ${freeBlock('Departmental Electives', 'DEPT_ELECTIVE')}
  ${freeBlock('General Science Electives', 'GEN_SCI_ELECTIVE')}
  <div class="next"><b>Agreed for ${esc(planTargetFor(s))}:</b> ${plan.length
    ? esc(plan.map(c => c.code).join(', ')) + '  (suggested by the study plan, to be confirmed with the student)'
    : 'to be decided'}</div>
  <div class="sign"><div>Student signature</div><div>Advisor signature</div></div>
  <div class="foot">Filled in from the student's official transcript and their registered schedule.
    Printed ${new Date().toLocaleDateString()}.</div>
  </body></html>`;
}

function printSheet(s) { printDocument(sheetDocument(s)); }
function printTranscript(s) { printDocument(transcriptDocument(s)); }



// build the whole doc and print it from its own frame (see above)
function printDocument(html) {
  /* A new tab with the document, which opens the print dialog by itself
     ("Save as PDF" there downloads it). Opened inside the click, so pop-up
     blockers allow it. Blocked anyway: fall back to a hidden frame. */
  try {
    const w = window.open('', '_blank');
    if (w) { try { w.opener = null; } catch (e) { /* fine */ } }
    if (w) {
      const auto = '<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print();},350);});<\/script>';
      w.document.open(); w.document.write(html.replace('</body>', auto + '</body>')); w.document.close();
      return;
    }
  } catch (e) { /* fall through to the frame */ }
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0';
  document.body.appendChild(frame);
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      toast('Sending the sheet to your printer');
    } catch (e) {
      openSheetWindow(html);
    }
    setTimeout(() => frame.remove(), 2000);
  };
  try {
    const d = frame.contentWindow.document;
    d.open(); d.write(html); d.close();
    // wait for fonts, otherwise it prints in a fallback font
    const ready = () => (d.fonts && d.fonts.ready ? d.fonts.ready : Promise.resolve()).then(() => setTimeout(go, 60));
    if (d.readyState === 'complete') ready();
    else frame.onload = ready;
    setTimeout(go, 2500);
  } catch (e) {
    frame.remove();
    openSheetWindow(html);
  }
}

// frame printing blocked -> open the sheet standalone, advisor uses Ctrl+P
function openSheetWindow(html) {
  try {
    const w = window.open('', '_blank');
    if (w) { try { w.opener = null; } catch (e) { /* fine */ } }
    if (!w) throw new Error('blocked');
    w.document.open(); w.document.write(html); w.document.close();
    toast('Sheet opened in a new tab. Print it from there.');
  } catch (e) {
    toast('Your browser blocked printing. Use the print command in the browser menu.');
  }
}

function tabTranscript(s) {
  const byTerm = {};
  s.history.forEach(h => { (byTerm[h.term] = byTerm[h.term] || []).push(h); });
  const rank = t => {
    if (t === 'TRANSFER') return -1;
    const m = /(FALL|SPRING|SUMMER|WINTER)\s*(\d{4})/.exec(t || '');
    if (!m) return 1e9;
    return +m[2] * 10 + { FALL: 0, WINTER: 1, SPRING: 2, SUMMER: 3 }[m[1]];
  };
  const terms = Object.keys(byTerm).sort((a, b) => rank(a) - rank(b));
  const sum = (s.termSummary || []).reduce((m, t) => (m[t.term] = t, m), {});
  const reg = s.registration;
  const tot = transcriptTotals(s);
  return `<div class="sec">
    <div class="tx-sum no-print">
      <div><b>${tot.credits}</b><span>credits completed</span></div>
      <div><b>${tot.cgpa != null ? tot.cgpa.toFixed(2) : '&mdash;'}</b><span>CGPA</span></div>
      <div><b>${tot.terms}</b><span>semesters</span></div>
      <button class="btn primary sm" data-transcript="${esc(s.id)}">Download transcript</button>
    </div>
    ${reg ? `<div class="panel"><div class="hd">Taking now<i class="sep-dot" aria-hidden="true"></i>${esc(reg.term)}</div><div class="bd">
      <div class="tw"><table class="t"><tbody>
        ${reg.courses.map(c => `<tr>
          <td class="c" style="width:88px">${esc(c.code)}</td>
          <td>${esc(nice((MAP[c.code] || {}).title || ''))}</td>
          <td class="n" style="width:44px">${esc(c.cr)}</td>
          <td class="c" style="width:52px">${esc(c.section || '')}</td>
          <td style="width:150px;font-size:11.5px;color:var(--muted)">${esc(c.meetings.map(m => m.day + ' ' + m.start).join(', '))}</td>
        </tr>`).join('')}
      </tbody></table></div></div></div>` : ''}
    <div class="panel"><div class="hd">Official transcript<i class="sep-dot" aria-hidden="true"></i>${s.history.length} rows</div><div class="bd">
      ${terms.map(t => {
        const rows = byTerm[t], st = sum[t];
        return `<div class="termhead">${t === 'TRANSFER' ? 'Transferred / equivalency' : esc(t)}
          ${st ? `<span style="float:right;font-weight:500;color:var(--muted);text-transform:none;letter-spacing:0">
            ${esc(st.earned)} credits earned${st.sgpa != null ? '<i class="sep-dot" aria-hidden="true"></i>term GPA ' + esc(Number(st.sgpa).toFixed(2)) : ''}</span>` : ''}</div>
        <div class="tw"><table class="t">
          <tbody>${rows.map(h => `<tr class="${h.flag === 'A' ? 'dim' : ''}">
            <td class="c" style="width:88px">${esc(h.code)}</td>
            <td>${esc(nice(h.title))}</td>
            <td class="n" style="width:44px">${esc(h.cr)}</td>
            <td class="g ${gradeClass(h.grade)}" style="width:52px">${esc(h.grade)}</td>
            <td style="width:110px;font-size:11.5px;color:var(--muted)">${h.flag === 'A' ? 'replaced by a retake' : h.flag === 'I' ? 'counted attempt' : h.flag === 'N' ? 'transferred' : ''}</td>
          </tr>`).join('')}</tbody></table></div>`;
      }).join('')}
    </div></div>
  </div>`;
}


/* totals worked out from the rows themselves: every counted attempt (A rows
   are annulled by a retake), P/TR earned but out of the average. The
   registrar's printed CGPA wins when there is one. */
function transcriptTotals(s) {
  const rows = (s.history || []).filter(h => h.flag !== 'A');
  const g = E.computeGpa(R, rows);
  const terms = new Set(rows.map(h => h.term).filter(t => t && t !== 'TRANSFER')).size;
  // equivalency (Lebanese Baccalaureate) credits are not part of the total
  return { credits: studied(s).credits,
    cgpa: s.officialCgpa != null ? s.officialCgpa : g.gpa, terms };
}

// the transcript as its own printable page (Save as PDF to download it)
function transcriptDocument(s) {
  const byTerm = {};
  (s.history || []).forEach(h => { (byTerm[h.term] = byTerm[h.term] || []).push(h); });
  const rank = t => { if (t === 'TRANSFER') return -1; const m = /(FALL|SPRING|SUMMER|WINTER)\s*(\d{4})/.exec(t || ''); return m ? +m[2] * 10 + { FALL: 0, WINTER: 1, SPRING: 2, SUMMER: 3 }[m[1]] : 1e9; };
  const sum = (s.termSummary || []).reduce((m, t) => (m[t.term] = t, m), {});
  const tot = transcriptTotals(s);
  const body = Object.keys(byTerm).sort((a, b) => rank(a) - rank(b)).map(t => {
    const st = sum[t];
    return `<h3>${t === 'TRANSFER' ? 'Transferred / equivalency' : esc(t)}${st && st.sgpa != null ? '<span>GPA ' + st.sgpa.toFixed(2) + ' · ' + st.earned + ' cr</span>' : ''}</h3>
      <table>${byTerm[t].map(h => `<tr class="${h.flag === 'A' ? 'dim' : ''}"><td class="c">${esc(h.code)}</td><td>${esc(nice(h.title))}</td><td class="n">${esc(h.cr)}</td><td class="g">${esc(h.grade)}</td></tr>`).join('')}</table>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Transcript ${esc(s.name)} ${esc(s.id)}</title>
    <style>body{font:12.5px/1.45 system-ui,Segoe UI,Arial,sans-serif;color:#161d2b;margin:28px 34px}
    h1{font:700 19px Georgia,serif;margin:0 0 2px;color:#1b3668}.sub{color:#6b7686;margin-bottom:14px}
    .tot{display:flex;gap:28px;padding:10px 14px;background:#eef2f9;border-radius:8px;margin-bottom:16px}.tot b{display:block;font-size:18px;color:#1b3668}
    h3{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#1b3668;border-bottom:1px solid #d5dce8;padding-bottom:3px;margin:16px 0 4px}
    h3 span{float:right;text-transform:none;letter-spacing:0;color:#6b7686;font-weight:500}
    table{width:100%;border-collapse:collapse}td{padding:3px 6px;border-bottom:1px solid #eef1f6}.c{font-family:Consolas,monospace;width:80px}
    .n{text-align:right;width:36px}.g{width:40px;font-weight:600;text-align:center}tr.dim td{color:#9aa3b2;text-decoration:line-through}
    @page{margin:14mm}</style></head><body>
    <h1>${esc(s.name)}</h1><div class="sub">${esc(s.id)} · ${esc(s.program || C.program || 'Computer Science')} · Beirut Arab University</div>
    <div class="tot"><div><b>${tot.credits}</b>credits earned</div><div><b>${tot.cgpa != null ? tot.cgpa.toFixed(2) : '—'}</b>CGPA</div><div><b>${tot.terms}</b>semesters</div></div>
    ${body}</body></html>`;
}

/* advisor's own list on one page: who, why, and their notes. For their own
   records/meetings, only leaves the portal if they print it. */
function reviewListDocument(list, title) {
  const row = s => {
    const { snap, level } = look(s);
    const reasons = condense(look(s).alerts).slice(0, 4);
    const n = s.note || {};
    return `<tr>
      <td><b>${esc(s.name)}</b><br><span class="small">${esc(s.id)}<i class="sep-dot" aria-hidden="true"></i>semester ${snap.completedSemesters + 1}
       <i class="sep-dot" aria-hidden="true"></i>CGPA ${s.officialCgpa != null ? s.officialCgpa.toFixed(2) : 'none'}
       <i class="sep-dot" aria-hidden="true"></i>${studied(s).credits} credits</span></td>
      <td>${reasons.length ? '<ul>' + reasons.map(r => '<li><b>' + esc(r.title) + '</b> ' + esc(r.brief || r.detail) + '</li>').join('') + '</ul>'
        : '<span class="small">On track</span>'}</td>
      <td>${n.text ? esc(n.text) : '<span class="small">&mdash;</span>'}</td>
    </tr>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    @page { size: A4; margin: 13mm 11mm; }
    body { font: 11px/1.45 "Helvetica Neue", Arial, sans-serif; color: #141b28; margin: 0; }
    .head { text-align: center; border-bottom: 2px solid #1B3668; padding-bottom: 8px; margin-bottom: 12px; }
    .head .u { font-size: 15px; font-weight: 700; color: #1B3668; }
    .head .f { font-size: 11px; color: #4a5468; margin-top: 2px; }
    .head .t { font-size: 12px; font-weight: 600; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #77839A;
         border-bottom: 1px solid #d3dae6; padding: 4px 6px; }
    td { padding: 6px; border-bottom: 1px solid #e8edf5; vertical-align: top; }
    td:first-child { width: 27%; } td:last-child { width: 26%; }
    ul { margin: 0; padding-left: 15px; } li { margin: 2px 0; }
    .small { font-size: 9.5px; color: #77839A; }
    tbody tr { break-inside: avoid; }
    .foot { margin-top: 12px; font-size: 8.5px; color: #77839A; border-top: 1px solid #e8edf5; padding-top: 5px; }
  </style></head><body>
  <div class="head">
    <div class="u">Beirut Arab University</div>
    <div class="f">${esc(progFacultyName())}<i class="sep-dot" aria-hidden="true"></i>${esc(progDeptLine())}</div>
    <div class="f">${esc(ADVISORY_LINE)}</div>
    <div class="t">${esc(title)}<i class="sep-dot" aria-hidden="true"></i>${esc(state.term)}</div>
  </div>
  <table><thead><tr><th>Student</th><th>What the records say</th><th>Note from the advisor</th></tr></thead>
  <tbody>${list.map(row).join('')}</tbody></table>
  <div class="foot">${list.length} student${list.length === 1 ? '' : 's'}<i class="sep-dot" aria-hidden="true"></i>prepared by ${esc(fullName(state.me))}
   <i class="sep-dot" aria-hidden="true"></i>${new Date().toLocaleDateString()}. Read from the transcripts and schedules on file.</div>
  </body></html>`;
}

// ---- email ----------------------------------------------------------------
const TEMPLATES = {
  /* student progress written the way an advisor would explain it: where they
       stand, this term, what's owed, what's next. Plain text on purpose so it
       works in any mail client, prints fine and pastes anywhere. */
  sheet: {
    label: 'Progress sheet',
    applies: () => true,
    subject: s => 'Your academic progress \u2014 ' + shortTerm(state.term),
    body: (s, ctx) => {
      const snap = look(s).snap;
      const st = studied(s);
      const line = (k, v) => '  ' + (k + ':').padEnd(22) + v;
      const reg = ((s.registration || {}).courses || []);
      const owed = E.repeatsDue(R, C, s, state.term, state.offering.sections);
      const rule = '\n' + '-'.repeat(56) + '\n';
      return 'Dear ' + s.name.split(' ')[0] + ',\n\n'
        + 'Here is where your studies stand, as of ' + new Date().toLocaleDateString() + '.\n'
        + rule + 'WHERE YOU STAND\n'
        + line('Student ID', s.id) + '\n'
        + line('Semester', snap.completedSemesters + 1) + '\n'
        + line('Credits completed', st.credits + (st.transfer ? ' (plus ' + st.transfer + ' from entry)' : '')) + '\n'
        + line('Toward the degree', snap.earned + ' of ' + C.totalCredits) + '\n'
        + line('Cumulative GPA', s.officialCgpa != null ? s.officialCgpa.toFixed(2) : 'not yet') + '\n'
        + line('Standing', snap.standing.reason) + '\n'
        + rule + 'THIS TERM \u2014 ' + shortTerm(state.term) + '\n'
        + (reg.length
            ? reg.map(c => '  ' + String(c.code).padEnd(10) + nice(c.title || '')).join('\n') + '\n'
              + line('Total', reg.reduce((n, c) => n + (Number(c.cr) || 0), 0) + ' credits') + '\n'
            : '  You are not registered yet. Please come and see me.\n')
        + (owed.length ? rule + 'TO TAKE AGAIN\n'
            + owed.map(r => '  ' + String(r.code).padEnd(10) + nice(r.title || '')
              + '  (' + (r.grade === 'W' || r.grade === 'AW' ? 'withdrawn' : r.grade) + ')').join('\n') + '\n' : '')
        + (ctx.plan.length ? rule + 'SUGGESTED FOR NEXT TERM\n'
            + ctx.plan.map(c => '  ' + String(c.code).padEnd(10) + nice(c.title)).join('\n') + '\n' : '')
        + rule
        + 'This is a summary from your advising record. If anything looks wrong,\n'
        + 'tell me and we will check it against the registrar together.\n\n'
        + 'Best regards,\nDr. ' + state.me.name + '\n'
        + progDeptName() + ', ' + progFacultyName() + '\n';
    }
  },
  register: {
    label: 'Not registered',
    /* only for students with no schedule. Sending this to a registered student
           would be embarrassing. */
    applies: (s, ctx) => !ctx.registered,
    unless: (s, ctx) => 'Registered for ' + ctx.regCredits + ' credits',
    subject: s => 'Registration for ' + state.term,
    body: (s, ctx) => `Dear ${s.name.split(' ')[0]},

You are not yet registered for ${state.term}. Registration closes soon, and a late registration limits the courses still open to you.

${ctx.plan.length ? 'Based on your transcript, these are the courses to take next:\n' + ctx.plan.map(c => '  - ' + c.code + '  ' + nice(c.title)).join('\n') + '\n' : ''}
Please come and see me, or reply to this email, so we can settle your schedule.

Best regards,
Dr. ${state.me.name}
${progDeptLine()}
Beirut Arab University`
  },
  fix: {
    label: 'Registration problem',
    applies: (s, ctx) => ctx.problems.length > 0,
    unless: (s, ctx) => ctx.registered ? 'Nothing wrong with this registration' : 'Not registered yet',
    subject: s => 'Your registration for ' + state.term + ' needs a change',
    body: (s, ctx) => `Dear ${s.name.split(' ')[0]},

I have looked at your registration for ${state.term} and there ${ctx.problems.length === 1 ? 'is one thing' : 'are ' + ctx.problems.length + ' things'} that need to be corrected:

${ctx.problems.map((p, i) => (i + 1) + '. ' + p).join('\n')}

Please make the change before the add and drop period closes. Come to my office hours if you would like help choosing an alternative.

Best regards,
Dr. ${state.me.name}
${progDeptLine()}
Beirut Arab University`
  },
  progress: {
    label: 'Falling behind',
    applies: (s, ctx) => (s.officialCgpa != null && s.officialCgpa < 2)
      || ctx.repeats.length > 0
      || ['PROBATION', 'DISMISSAL_RISK', 'LOAD_CAPPED'].indexOf((ctx.snap.standing || {}).state) >= 0,
    unless: (s, ctx) => 'CGPA ' + ctx.cgpa + ', nothing to repeat',
    subject: s => 'Your academic progress',
    body: (s, ctx) => `Dear ${s.name.split(' ')[0]},

I am writing about your academic progress. Your CGPA is currently ${ctx.cgpa}, and a degree requires 2.00 or above.

${ctx.repeats.length ? 'These courses have to be repeated:\n' + ctx.repeats.map(c => '  - ' + c).join('\n') + '\n' : ''}
This is recoverable, but it needs a plan. Please book a meeting with me this week so we can look at your load for the coming semester together.

Best regards,
Dr. ${state.me.name}
${progDeptLine()}
Beirut Arab University`
  },
  meeting: {
    label: 'Ask them to come in',
    applies: () => true,
    subject: s => 'Advising meeting',
    body: (s, ctx) => `Dear ${s.name.split(' ')[0]},

Please come and see me during my office hours this week so we can go through your plan for ${state.term} together.

Bring your contract sheet if you have it with you.

Best regards,
Dr. ${state.me.name}
${progDeptLine()}
Beirut Arab University`
  },
  ok: {
    label: 'All good',
    /* says all is in order, so only offer it when that's true */
    applies: (s, ctx) => ctx.registered && ctx.problems.length === 0,
    unless: (s, ctx) => !ctx.registered ? 'Not registered yet'
      : ctx.problems.length + ' thing' + (ctx.problems.length === 1 ? '' : 's') + ' to fix first',
    subject: s => 'Your registration for ' + state.term,
    body: (s, ctx) => `Dear ${s.name.split(' ')[0]},

I have checked your registration for ${state.term}. Everything is in order: prerequisites are met, your load is within the limit, and there are no timetable clashes.

${ctx.courses.length ? 'You are registered for ' + ctx.regCredits + ' credits:\n'
  + ctx.courses.map(c => '  - ' + c.code + '  ' + nice((MAP[c.code] || {}).title || c.title || '')).join('\n') + '\n\n' : ''}Good luck this semester.

Best regards,
Dr. ${state.me.name}
${progDeptLine()}
Beirut Arab University`
  }
};

function emailContext(s) {
  const { snap, reg } = look(s);
  const courses = ((s.registration || {}).courses || []);
  const blocks = reg.findings.filter(f => f.severity === 'BLOCK');
  const warns = reg.findings.filter(f => f.severity === 'WARN');
  return {
    registered: courses.length > 0,
    courses,
    regCredits: courses.reduce((n, c) => n + (Number(c.cr) || 0), 0),
    blocks, warns,
    snap,
    plan: E.planNextTerm(R, C, s, planTargetFor(s), state.offering.sections).recommendations.slice(0, 5),
    problems: reg.findings.filter(f => f.severity === 'BLOCK' || f.severity === 'WARN').map(f => f.message),
    cgpa: s.officialCgpa != null ? s.officialCgpa.toFixed(2) : (snap.cgpa != null ? snap.cgpa.toFixed(2) : 'not yet available'),
    /* everything to retake, not just fails: a withdrawn and never-passed course
           is still owed. Filtering by grade only dropped those from the email and
           the sheet while the page itself flagged them. */
    repeats: E.repeatsDue(R, C, s, state.term, state.offering.sections)
      .map(r => r.code + ' (' + (r.grade === 'W' || r.grade === 'AW' ? 'withdrawn' : r.grade) + ')')
  };
}

let emailPick = 'meeting';
function openEmail(id, preset) {
  const s = state.students.find(x => x.id === id);
  if (!s || !s.email) return;
  emailPick = preset && TEMPLATES[preset] ? preset : suggestTemplate(s);
  drawEmail(s);
  $('#dlg').showModal();
}

/* order matters, most urgent true template wins. Each one already passed its
   applies() check, so the dialog never contradicts the record. */
function suggestTemplate(s) {
  const ctx = emailContext(s);
  const order = ['fix', 'register', 'progress', 'ok', 'sheet', 'meeting'];
  const hit = order.find(k => TEMPLATES[k].applies(s, ctx));
  return hit || 'meeting';
}

// one line under the title showing what the draft is based on
function emailState(s, ctx) {
  const bits = [];
  bits.push(ctx.registered ? 'Registered for ' + ctx.regCredits + ' credits' : 'Not registered');
  if (ctx.blocks.length) bits.push(ctx.blocks.length + ' blocking problem' + (ctx.blocks.length === 1 ? '' : 's'));
  else if (ctx.warns.length) bits.push(ctx.warns.length + ' warning' + (ctx.warns.length === 1 ? '' : 's'));
  else if (ctx.registered) bits.push('no problems found');
  bits.push('CGPA ' + ctx.cgpa);
  if (ctx.repeats.length) bits.push(ctx.repeats.length + ' to repeat');
  return bits.join(' \u00b7 ');
}

function drawEmail(s) {
  const ctx = emailContext(s);
  // record may change while the dialog is open, don't show a template that's no longer true
  if (!TEMPLATES[emailPick] || !TEMPLATES[emailPick].applies(s, ctx)) emailPick = suggestTemplate(s);
  const tpl = TEMPLATES[emailPick];
  $('#dlgBody').innerHTML = `
    <div class="dlg-h"><h3>Write to ${esc(s.name)}</h3>
      <p class="note" style="margin-top:4px">${esc(emailState(s, ctx))}</p></div>
    <div class="dlg-b">
      <div class="tpl">${Object.keys(TEMPLATES).map(k => {
        const t = TEMPLATES[k], ok = t.applies(s, ctx);
        const why = ok ? '' : (t.unless ? t.unless(s, ctx) : 'does not apply to this student');
        return `<button data-tpl="${k}" aria-pressed="${emailPick === k}" ${ok ? '' : 'disabled'}
          title="${ok ? esc(t.label) : esc(t.label + ' \u2014 ' + why)}">${t.label}${
          ok ? '' : '<span class="tpl-no">' + esc(why) + '</span>'}</button>`;
      }).join('')}</div>
      <label class="f" for="mTo">To<input id="mTo" value="${esc(s.email)}"></label>
      <label class="f" for="mSub">Subject<input id="mSub" value="${esc(tpl.subject(s))}"></label>
      <label class="f" for="mBody">Message<textarea id="mBody" rows="13">${esc(tpl.body(s, ctx))}</textarea></label>
    </div>
    <div class="dlg-f">
      <button class="btn" data-close="1">Cancel</button>
      <button class="btn" data-send="app">Mail app</button>
      <button class="btn${Store.mailReady() ? '' : ' primary'}" data-send="outlook">Open in Outlook</button>
      ${Store.mailReady() ? '<button class="btn primary" data-send-now="one">Send it now</button>' : ''}
    </div>`;
}

function sendEmail(kind) {
  const to = $('#mTo').value.trim(), sub = $('#mSub').value, body = $('#mBody').value;
  if (!to) { toast('Who is it going to?'); return; }
  composeMail(kind === 'outlook' ? 'outlook' : 'app', to, sub, body);
  $('#dlg').close();
}

// ---- your account ---------------------------------------------------------
// password change needs the current one, so a borrowed signed-in screen isn't enough
async function drawAccount(msg) {
  const acct = await Store.getAccount(state.me.slug);
  $('#dlgBody').innerHTML = `
    <div class="dlg-h"><h3>Your account</h3>
      <p class="note">${esc(fullName(state.me))}<i class="sep-dot" aria-hidden="true"></i>${esc((acct && acct.email) || state.me.email)}<br>
      ${Store.isServer()
        ? 'Signed in on the department server. Your records are kept there and nobody else can open them.'
        : Store.isShared() ? 'Records are kept with this page.' : 'Records are kept in this browser only.'}</p></div>
    <div class="dlg-b">
      ${msg ? `<p class="okmsg">${esc(msg)}</p>` : ''}
      <div class="stack">
        <h4 style="font-size:14px">Appearance</h4>
        <div class="theme-pick">${[['light', 'Light'], ['dark', 'Dark'], ['auto', 'Match my computer']].map(([k, l]) =>
          `<button data-theme-pick="${k}" aria-pressed="${themeChoice() === k}">${l}</button>`).join('')}</div>
        <h4 style="font-size:14px;margin-top:6px">Reports and copies</h4>
        <p class="note">Excel includes student summaries and transcript courses. The PDF is print-ready.</p>
        <div class="theme-pick">
          <button class="btn sm" data-export="excel">Download Excel report</button>
          <button class="btn sm" data-export="pdf">Open PDF summary</button>
        </div>
      </div>
      <div class="hr"></div>
      <form class="stack" id="pwForm">
        <h4 style="font-size:14px">Change your password</h4>
        <label class="f" for="pwOld">Current password<input id="pwOld" type="password" autocomplete="current-password"></label>
        <label class="f" for="pwNew">New password<input id="pwNew" type="password" autocomplete="new-password" placeholder="At least 10 characters"></label>
        <label class="f" for="pwNew2">Repeat it<input id="pwNew2" type="password" autocomplete="new-password"></label>
        <p class="err" id="pwErr" hidden></p>
        <button class="btn primary" type="submit" style="align-self:flex-start">Change password</button>
      </form>
      ${Store.isServer() ? `<div class="hr"></div>
      <div class="stack" id="sessBox">
        <h4 style="font-size:14px">Where you are signed in</h4>
        <p class="note">Loading&hellip;</p>
      </div>` : ''}
    </div>
    <div class="dlg-f"><button class="btn" data-close="1">Close</button></div>`;
  if (!$('#dlg').open) $('#dlg').showModal();
  if (Store.isServer()) drawSessions();
}

const ago = iso => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 2) return 'just now';
  if (min < 60) return min + ' minutes ago';
  const h = Math.round(min / 60);
  return h < 24 ? h + (h === 1 ? ' hour ago' : ' hours ago') : new Date(iso).toLocaleDateString();
};
async function drawSessions() {
  const box = $('#sessBox');
  if (!box) return;
  let list = [];
  try { list = await Store.listSessions(); }
  catch (e) { box.innerHTML = '<h4 style="font-size:14px">Where you are signed in</h4><p class="err">The list could not be loaded.</p>'; return; }
  const others = list.filter(x => !x.current);
  box.innerHTML = `<h4 style="font-size:14px">Where you are signed in</h4>
    <ul class="sess-list">${list.map(x => `<li>
      <div><b>${esc(x.device)}</b>${x.current ? ' <span class="chip ok">this browser</span>' : ''}
        <span class="note">signed in ${esc(ago(x.started))}<i class="sep-dot" aria-hidden="true"></i>last active ${esc(ago(x.lastSeen))}</span></div>
      ${x.current ? '' : `<button class="btn sm" data-sess-end="${esc(x.handle)}">Sign out</button>`}
    </li>`).join('')}</ul>
    ${others.length > 1 ? '<button class="btn sm" data-sess-end="others" style="align-self:flex-start">Sign out everywhere else</button>' : ''}
    ${!others.length ? '<p class="note">Only this browser.</p>' : ''}`;
}

// export of the advisor's own records
function exportMine(kind) {
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = state.me.name.replace(/[^A-Za-z]+/g, '-').toLowerCase();
  const summary = state.students.map(s => {
    const { snap, level } = look(s);
    const reg = (s.registration || {}).courses || [];
    return {
      id: s.id, name: s.name, email: s.email || '', phone: s.phone || '', campus: s.campus || '',
      semester: snap.completedSemesters + 1, cgpa: s.officialCgpa != null ? s.officialCgpa.toFixed(2) : '',
      degreeCredits: snap.earned, transcriptCredits: snap.officialEarned,
      standing: standingWord(snap.standing.state), registeredCredits: reg.reduce((n, c) => n + (+c.cr || 0), 0),
      registeredCourses: reg.map(c => c.code).join(' '), needsReview: level === 'ok' ? 'No' : 'Yes', note: (s.note || {}).text || ''
    };
  });
  if (kind === 'pdf') {
    const c = counts();
    const rows = summary.map(x => `<tr><td>${esc(x.id)}</td><td>${esc(x.name)}</td><td>${esc(x.standing)}</td><td>${esc(x.cgpa)}</td><td>${x.degreeCredits}</td><td>${x.registeredCredits || 'No schedule'}</td><td>${esc(x.needsReview)}</td></tr>`).join('');
    /* portal font so l and I don't look the same like in Arial. Verdana as
           fallback for the same reason. */
    printDocument(`<!doctype html><html><head><meta charset="utf-8"><title>Online Advising System - Summary</title>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&family=IBM+Plex+Sans+Arabic:wght@400;600&display=swap"><style>
      @page{size:A4 landscape;margin:13mm}body{font:11px "IBM Plex Sans","IBM Plex Sans Arabic",Verdana,sans-serif;color:#16213a}h1{color:#193f73;margin:0 0 4px}p{margin:3px 0 12px}table{width:100%;border-collapse:collapse}th,td{padding:6px;border-bottom:1px solid #d8dfeb;text-align:left}th{background:#193f73;color:white}.summary{font-size:13px;margin:12px 0 16px}</style></head><body>
      <h1>Online Advising System</h1><p>${esc(fullName(state.me))} · ${esc(shortTerm(state.term))} · ${esc(stamp)}</p>
      <div class="summary"><b>${c.total} students</b> · ${c.critical + c.urgent + c.watch} need attention · ${c.unreg} have no schedule</div>
      <table><thead><tr><th>ID</th><th>Student</th><th>Standing</th><th>CGPA</th><th>Degree credits</th><th>Registered credits</th><th>Needs attention</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
    return;
  }
  const cell = (v, type) => `<Cell><Data ss:Type="${type || 'String'}">${esc(v == null ? '' : v)}</Data></Cell>`;
  const heads = ['ID', 'Name', 'Email', 'Phone', 'Campus', 'Semester', 'CGPA', 'Degree credits', 'Transcript credits', 'Standing', 'Registered credits', 'Registered courses', 'Needs attention', 'Advisor note'];
  const summaryRows = summary.map(x => `<Row>${cell(x.id)}${cell(x.name)}${cell(x.email)}${cell(x.phone)}${cell(x.campus)}${cell(x.semester, 'Number')}${cell(x.cgpa || '')}${cell(x.degreeCredits, 'Number')}${cell(x.transcriptCredits, 'Number')}${cell(x.standing)}${cell(x.registeredCredits, 'Number')}${cell(x.registeredCourses)}${cell(x.needsReview)}${cell(x.note)}</Row>`).join('');
  const courseRows = state.students.flatMap(s => (s.history || []).map(h => `<Row>${cell(s.id)}${cell(s.name)}${cell(h.term || '')}${cell(h.code)}${cell(nice(h.title || (MAP[h.code] || {}).title || ''))}${cell(h.cr || 0, 'Number')}${cell(h.grade || '')}${cell(h.flag || '')}</Row>`)).join('');
  const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Student summary"><Table><Row>${heads.map(h => cell(h)).join('')}</Row>${summaryRows}</Table></Worksheet><Worksheet ss:Name="Transcript courses"><Table><Row>${['ID','Student','Term','Course','Title','Credits','Grade','Record flag'].map(h => cell(h)).join('')}</Row>${courseRows}</Table></Worksheet></Workbook>`;
  download('bau-e-advising-' + safe + '-' + stamp + '.xls', '\ufeff' + xml, 'application/vnd.ms-excel;charset=utf-8');
}

/* file download; if the browser refuses, copy to the clipboard instead. */
function download(name, text, type) {
  const canSave = true;
  if (canSave) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Saved to your downloads');
      return;
    } catch (e) { /* fall through to the clipboard */ }
  }
  try {
    navigator.clipboard.writeText(text);
    toast('Copied. Paste it into a file called ' + name);
  } catch (e) {
    toast('This preview cannot save files. Open the portal at its own address to download.');
  }
}

async function changeMyPassword(ev) {
  ev.preventDefault();
  const err = $('#pwErr');
  const fail = m => { err.hidden = false; err.textContent = m; };
  const next = $('#pwNew').value;
  if (next.length < 10) return fail('Make the new password at least 10 characters.');
  if (next !== $('#pwNew2').value) return fail('The two new passwords are different.');
  const res = await Store.changePassword(state.me.slug, $('#pwOld').value, next);
  if (res === 'wrong-password') return fail('That is not your current password.');
  if (res !== 'ok') return fail('That account could not be found.');
  await drawAccount('Password changed.');
}

// ---- import ---------------------------------------------------------------
let importState = { busy: false, result: null, out: { T: '', S: '', O: '' }, undo: null, confirm: null };

// snapshot before import so a wrong file can be rolled back
/* whose records an import writes to. An advisor imports for themselves; the
   admin picks the advisor in the Import page and the records land in that
   advisor's own list, so they show on the advisor's account at the next sync. */
function importTarget() {
  if (!state.me.admin) return { admin: false, slug: state.me.slug, name: state.me.name, list: state.students };
  const slugs = advisorSlugs();
  if (!slugs.includes(state.importFor)) state.importFor = slugs.includes(state.advisorFilter) ? state.advisorFilter : slugs[0];
  const f = FACULTY.find(x => x.slug === state.importFor) || {};
  return { admin: true, slug: state.importFor, name: f.name || state.importFor,
    list: ((state.everyone || {})[state.importFor] || []).map(x => { const c = Object.assign({}, x); delete c.advisorSlug; return c; }) };
}
const plainCopy = x => { const c = Object.assign({}, x); delete c.advisorSlug; return c; };
// which advisor already has this student (the admin's own list does not count)
function ownerOf(id) {
  const ev = state.everyone || {};
  return advisorSlugs().find(sl => (ev[sl] || []).some(x => String(x.id) === String(id))) || null;
}
/* The doctor picked in the drop-down owns every student in their PDF. A
   student found on another list is moved here with their notes and schedule,
   so one student is never split across two accounts. */
async function claimFromOthers(T, items) {
  if (!T.admin) return [];
  const moved = {};
  items.forEach(it => {
    const o = ownerOf(it.id);
    if (!o || o === T.slug || T.list.some(x => String(x.id) === String(it.id))) return;
    const rec = ((state.everyone || {})[o] || []).find(x => String(x.id) === String(it.id));
    if (!rec) return;
    T.list.push(plainCopy(rec));
    (moved[o] = moved[o] || { ids: [], recs: [] });
    moved[o].ids.push(String(it.id)); moved[o].recs.push(JSON.parse(JSON.stringify(plainCopy(rec))));
  });
  return Object.keys(moved).map(o => ({ slug: o, ids: moved[o].ids, recs: moved[o].recs, n: moved[o].ids.length }));
}
async function finishClaim(moved) {
  for (const m of moved) for (const id of m.ids) await Store.removeStudent(m.slug, id);
}
const movedNote = moved => moved.length ? `<p style="margin-top:5px">${moved.map(m => '<b>' + m.n + '</b> moved here from ' + esc(advisorNamed(m.slug))).join(', ')}.</p>` : '';

/* Repair for records split before routing existed: the same student ID on two
   lists, usually a schedule-only record on the right advisor and the
   transcript on another list (or the admin's own). The transcript joins the
   schedule-only record and the stray copy is removed. */
async function repairSplitRecords() {
  const ev = state.everyone || {};
  const seen = {};
  Object.keys(ev).forEach(sl => (ev[sl] || []).forEach(x => (seen[x.id] = seen[x.id] || []).push({ sl, x })));
  let fixed = 0;
  for (const id of Object.keys(seen)) {
    const g = seen[id];
    if (g.length < 2) continue;
    const stub = g.find(e => e.x.noTranscript && advisorSlugs().includes(e.sl));
    // prefer the copy on a list that is not an advisor's (the admin's own)
    const fulls = g.filter(e => !e.x.noTranscript && (e.x.history || []).length);
    const full = fulls.find(e => !advisorSlugs().includes(e.sl));
    if (!stub || !full || stub.sl === full.sl) continue;
    const f = FACULTY.find(x => x.slug === stub.sl) || {};
    const r = Merge.mergeTranscripts([plainCopy(stub.x)], [plainCopy(full.x)], f.name || stub.sl);
    await Store.saveStudents(stub.sl, r.students);
    await Store.removeStudent(full.sl, id);
    fixed++;
  }
  if (fixed) { state.everyone = await loadEveryone(); state.students = everyoneFlat(); flush(); }
  return fixed;
}

async function reloadTarget(T) {
  if (T.admin) { state.everyone = await loadEveryone(); state.students = everyoneFlat(); state.everyoneErr = ''; T.list = state.everyone[T.slug] || []; }
  else { state.students = await Store.loadStudents(T.slug, []); T.list = state.students; }
  return T.list;
}

// a copy of the list as it was before an import, taken before anything changes it
const snapshotOf = list => new Map(list.map(s => [String(s.id), JSON.parse(JSON.stringify(s))]));
/* pre = the list before the import; moved = students taken from other advisors.
   Undo puts both back exactly: changed records to their old state, new ones
   removed, moved ones returned to the advisor they came from. */
function rememberUndo(touching, label, T, pre, moved) {
  T = T || importTarget();
  pre = pre || snapshotOf(T.list);
  const claimed = new Set((moved || []).reduce((a, m) => a.concat(m.ids), []));
  const before = new Map();
  const addedIds = [];
  touching.forEach(s => {
    const id = String(s.id);
    if (claimed.has(id)) return;
    if (pre.has(id)) before.set(id, pre.get(id));
    else addedIds.push(id);
  });
  importState.undo = { label, at: Date.now(), before, addedIds, slug: T.slug, moved: moved || [] };
}

async function undoImport() {
  const u = importState.undo;
  if (!u) return;
  const T = importTarget(); T.slug = u.slug || T.slug;
  for (const id of u.addedIds) await Store.removeStudent(T.slug, id);
  const back = Array.from(u.before.values());
  if (back.length) await Store.saveStudents(T.slug, back);
  for (const m of (u.moved || [])) {          // students taken from another advisor go back to them
    if (m.recs && m.recs.length) await Store.saveStudents(m.slug, m.recs);
    for (const id of m.ids) await Store.removeStudent(T.slug, id);
  }
  await reloadTarget(T);
  importState.undo = null;
  importState.result = null;
  importState.out = { T: '', S: '', O: '' };
  flush(); render();
  toast('Put back the way it was');
}
/* Start over, for a wrong file or a first try that went badly.
   'schedules' = keep the students, forget this term's registrations.
   'all' = forget every imported record (built-in advisees come back as shipped).
   The shared course offering is not touched. Student-level notes, holds and
   meetings live inside imported records and are therefore removed by 'all'. */
async function clearImported(what) {
  const T = importTarget();
  if (what === 'schedules') {
    const had = T.list.filter(s => s.registration);
    had.forEach(s => { s.registration = null; });
    await Store.saveStudents(T.slug, had);
    toast(had.length ? 'Schedules cleared for ' + had.length + ' students. Drop the schedules PDF again.' : 'There were no schedules to clear.');
  } else {
    const n = await Store.clearStudents(T.slug);
    toast(n ? 'Cleared. Drop the transcripts PDF to start again.' : 'Nothing imported to clear yet.');
  }
  await reloadTarget(T);
  importState = { busy: false, result: null, out: { T: '', S: '', O: '' }, undo: null, confirm: null };
  flush(); render();
}

// show the result and keep it across the next re-render
function showImport(which, html) {
  importState.out[which] = html;
  const el = $('#out' + which);
  if (el) el.innerHTML = html;
}

function viewImport() {
  const r = importState.result;
  const T = importTarget();
  const who = T.admin ? esc(advisorNamed(T.slug)) + '\'s' : 'your';
  return `<div class="wrap">
    <div class="page-h"><h1>Import</h1>
      <p>${state.me.admin ? 'Import transcripts, schedules and the term offering.' : 'Import transcripts and schedules.'}</p></div>
    ${T.admin ? `<div class="panel imp-for"><div class="bd">
      <label class="f" for="impFor">Importing for
        <select id="impFor">${advisorSlugs().map(sl => `<option value="${esc(sl)}" ${sl === T.slug ? 'selected' : ''}>${esc(advisorNamed(sl))} · ${((state.everyone || {})[sl] || []).length} students${(() => { const k = ((state.everyone || {})[sl] || []).filter(x => x.noTranscript).length; return k ? ' · ' + k + ' no transcript' : ''; })()}</option>`).join('')}</select></label>
      <span class="note">Saved to this advisor's account and synced.</span>
    </div></div>` : ''}

    <div class="sec">
      <div class="sec-h"><h2>1. Transcripts</h2><span class="c">creates and updates students</span></div>
      <div class="panel"><div class="bd">
        <div class="drop" id="dropT">
          <b>Drop the transcripts PDF</b>
          <span>One PDF for all ${who} advisees.</span>
          <input type="file" id="fileT" accept=".pdf" hidden>
        </div>
        <div id="outT">${importState.out.T}</div>
      </div></div>
    </div>

    <div class="sec">
      <div class="sec-h"><h2>2. Schedules</h2><span class="c">what they registered this term</span></div>
      <div class="panel"><div class="bd">
        <div class="drop" id="dropS">
          <b>Drop the schedules PDF</b>
          <span>One PDF for all ${who} advisees.</span>
          <input type="file" id="fileS" accept=".pdf" hidden>
        </div>
        <div id="outS">${importState.out.S}</div>
      </div></div>
    </div>

    ${state.me.admin ? `<div class="sec">
      <div class="sec-h"><h2>3. Course offering</h2><span class="c">by semester</span></div>
      <div class="panel"><div class="bd">
        <p class="note">Choose the semester for this file. Import the planning term when published so recommendations use real sections and times.</p>
        <label class="f" for="offTerm" style="margin-top:12px;max-width:300px">This file is for
          <select id="offTerm">${termChoices().map(t =>
            `<option value="${esc(t)}" ${t === state.planTerm ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <div class="drop" id="dropO" style="margin-top:12px">
          <b>Drop the course offering (CSV or Excel)</b>
          <span>code, crn, section, credits, campus, day, start, end, teacher</span>
          <input type="file" id="fileO" accept=".csv,.txt,.xlsx,.xls" hidden>
        </div>
        <div id="outO">${importState.out.O}</div>
        <div class="tw" style="margin-top:14px"><table class="t">
          <thead><tr><th>Semester</th><th class="n">Sections</th><th class="n">Courses</th><th>Campuses</th><th>Source</th></tr></thead>
          <tbody>${termChoices().map(t => {
            const rows = state.offering.sections.filter(x => x.term === t);
            if (!rows.length) return '';
            const camps = Array.from(new Set(rows.map(x => x.campus).filter(Boolean)));
            const src = Array.from(new Set(rows.reduce((a, x) => a.concat(x.sources || []), [])));
            return `<tr><td>${esc(shortTerm(t))}${t === state.term ? ' <span class="chip">now</span>' : ''}${t === state.planTerm ? ' <span class="chip brand">planning</span>' : ''}</td>
              <td class="n">${rows.length}</td><td class="n">${new Set(rows.map(x => x.code)).size}</td>
              <td>${esc(camps.join(', '))}</td><td style="font-size:12px;color:var(--muted)">${esc(src.join(', '))}</td></tr>`;
          }).join('')}</tbody></table></div>
        ${state.offering.coverage === 'partial' ? `<p class="note" style="margin-top:10px">The
          ${esc(shortTerm(state.term))} list came from the offering pages that were shared plus every section a
          student is registered in, so it is not the full university list. A course missing from it is reported as
          not in the synced list, never as not offered.</p>` : ''}
      </div></div>
    </div>` : ''}

    ${r ? `<div class="panel"><div class="hd">Last import</div><div class="bd stack">${r}
      ${importState.undo ? `<div style="display:flex;gap:9px;align-items:center">
        <button class="btn sm" data-undo-import="1">Undo ${esc(importState.undo.label)}</button>
        <span class="note">Puts the records back the way they were before that file.</span>
      </div>` : ''}</div></div>` : ''}

    <div class="sec">
      <div class="sec-h"><h2>Start again</h2><span class="c">if an import went wrong</span></div>
      <div class="panel"><div class="bd stack">
        <p class="note">Clear imported student data, then import the files again. Notes and the course offering stay.</p>
        ${importState.confirm ? `<div class="chk warn"><span class="ic">!</span><span class="tx">
            <p><b>${importState.confirm === 'all'
              ? 'Clear all ' + T.list.length + ' students' + (T.admin ? ' of ' + advisorNamed(T.slug) : '') + ' and their schedules?'
              : 'Clear this term\'s schedules for ' + T.list.filter(s => s.registration).length + ' students?'}</b> This cannot be undone, but you can import the files again right after.</p>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="btn sm ghost" data-clear-cancel="1">Cancel</button>
              <button class="btn sm danger" data-clear-go="${importState.confirm}">Yes, clear</button></div></span></div>`
          : `<div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn sm" data-clear-ask="schedules">Clear schedules only</button>
              <button class="btn sm" data-clear-ask="all">Clear everything I imported</button></div>`}
      </div></div>
    </div>
  </div>`;
}

async function readPdf(file, onProgress) {
  const buf = await file.arrayBuffer();
  return await PdfImport.pagesOf(buf, onProgress);
}

function progressBox(el, label) {
  el.innerHTML = `<div class="result"><p class="note">${esc(label)}</p><div class="prog"><i style="width:8%"></i></div></div>`;
  return (done, total) => {
    const i = el.querySelector('.prog i');
    if (i) i.style.width = Math.round(8 + done / total * 92) + '%';
  };
}

// ---- what's in a PDF that didn't parse --------------------------------------
// A scanned print-out has no text layer at all, nothing to read. Otherwise the
// first words of page 1 usually say what the file is.
const wordCount = pages => pages.reduce((n, p) => n + p.words.length, 0);
const firstWords = pages => (pages[0] ? pages[0].words.slice(0, 16).map(w => w.text).join(' ') : '');
function notReadable(pages, what) {
  if (!pages.length) return 'That PDF has no pages.';
  if (wordCount(pages) < pages.length * 5) {
    return 'This PDF is a scan (pictures of the pages), so there is no text in it to read. Ask the faculty office '
      + 'for the ' + what + ' exported as a PDF from the system, not scanned or photographed.';
  }
  return 'No ' + what + ' found in that file. Page 1 starts with: <i>' + esc(firstWords(pages)) + '</i>';
}
const blockBox = msg => `<div class="chk block"><span class="ic">!</span><span class="tx"><p>${msg}</p></span></div>`;
const isPdf = f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';

async function onTranscripts(file) {
  const el = $('#outT');
  if (!isPdf(file)) { showImport('T', blockBox('That is not a PDF (' + esc(file.name) + '). The transcripts come as one PDF with every advisee.')); return; }
  const tick = progressBox(el, 'Reading ' + file.name);
  try {
    const pages = await readPdf(file, tick);
    const { students, skipped } = PdfImport.parseTranscripts(pages);
    // A schedules PDF also has names and IDs, so the transcript reader finds
    // "students" in it, just with no courses. That's the schedules file.
    const noCourses = students.every(x => !(x.history || []).length);
    if (!students.length || noCourses) {
      // dropped in the wrong box? the schedules file goes to its own reader
      if (PdfImport.parseSchedules(pages).registrations.length) {
        showImport('T', blockBox('That file is the <b>schedules</b>, not the transcripts. It has been read as schedules below.'));
        return onSchedules(file);
      }
      showImport('T', blockBox(notReadable(pages, 'transcripts') + '<br>It should be the transcript print-out, one student per page.'));
      return;
    }
    const T = importTarget();
    await reloadTarget(T);                     // merge into the latest saved records, not a stale copy
    const pre = snapshotOf(T.list);
    const moved = await claimFromOthers(T, students);
    const { students: merged, added, updated } = Merge.mergeTranscripts(T.list, students, T.name);
    // the transcript names the programme; a student from another one is filed there, not here
    const elsewhere = fileByTranscript(merged, students);
    rememberUndo(merged, 'the transcripts from ' + file.name, T, pre, moved);
    await Store.saveStudents(T.slug, merged);
    await finishClaim(moved);
    await reloadTarget(T);
    flush();
    importState.result = `${T.admin ? '<p class="note">For <b>' + esc(advisorNamed(T.slug)) + '</b></p>' : ''}<p><b>${added} new student${added === 1 ? '' : 's'}</b> and <b>${updated} updated</b> from ${esc(file.name)}.
      ${skipped.length ? skipped.length + ' page(s) could not be read.' : ''}</p>`;
    const check = Merge.verifyTranscripts(E, R, students);
    const rows = students.reduce((n, s) => n + s.history.length, 0);
    const withCourses = students.length - check.empty.length;
    showImport('T', `<div class="chk ${check.off.length ? 'warn' : 'info'}">
      <span class="ic">${check.off.length ? '!' : '&check;'}</span><span class="tx">
      <p><b>${students.length} transcripts read</b>${T.admin ? ' for ' + esc(advisorNamed(T.slug)) : ''} from ${esc(file.name)}: ${added} new, ${updated} updated, ${rows} course rows.</p>
      ${elsewhereHtml(elsewhere)}
      ${withCourses ? `<p style="margin-top:5px"><b>${check.ok.length} of ${withCourses} transcripts with completed courses</b> match the CGPA and credit total printed on the page.</p>` : ''}
      ${check.off.length ? `<p style="margin-top:5px"><b>${check.off.length} to look at:</b></p>
        <ul style="margin:4px 0 0 18px;font-size:13px">${check.off.slice(0, 8).map(o =>
          `<li>${esc(o.s.name)} (${esc(o.s.id)}) &mdash; page says ${o.s.officialCgpa != null ? o.s.officialCgpa.toFixed(2) : '?'} and ${esc(o.s.officialCredits)} credits, the rows add up to ${o.cgpa != null ? o.cgpa.toFixed(2) : '?'} and ${o.credits}</li>`).join('')}</ul>` : ''}
      ${check.empty.length ? `<p style="margin-top:5px"><b>${check.empty.length} new students have no completed courses yet.</b>
        Their transcript pages contain only the student header and empty course columns. This is expected, not a reading error; any current courses included in the schedules PDF will appear after that file is imported.</p>` : ''}
      ${skipped.length ? `<p style="margin-top:5px">${skipped.length} page(s) could not be read at all.</p>` : ''}
      ${movedNote(moved)}
      ${(() => { const still = T.list.filter(x => x.noTranscript);
        return still.length ? `<p style="margin-top:5px"><b>${still.length} still have no transcript</b> (schedule only): ${still.slice(0, 8).map(x => esc(x.name) + ' ' + x.id).join(', ')}${still.length > 8 ? '…' : ''}. Their pages are not in this PDF.</p>` : ''; })()}
      </span></div>`);
    render();
  } catch (e) {
    showImport('T', `<div class="chk block"><span class="ic">!</span><span class="tx"><p>Could not read that file: ${esc(e.message)}</p></span></div>`);
  }
}

async function onSchedules(file) {
  const el = $('#outS');
  if (!isPdf(file)) { showImport('S', blockBox('That is not a PDF (' + esc(file.name) + '). The schedules come as one PDF with every advisee.')); return; }
  const tick = progressBox(el, 'Reading ' + file.name);
  try {
    const pages = await readPdf(file, tick);
    const { registrations, skipped } = PdfImport.parseSchedules(pages);
    if (!registrations.length) {
      if (PdfImport.parseTranscripts(pages).students.length) {
        showImport('S', blockBox('That file is the <b>transcripts</b>, not the schedules. It has been read as transcripts above.'));
        return onTranscripts(file);
      }
      showImport('S', blockBox(notReadable(pages, 'schedules')));
      return;
    }
    const term = registrations[0].term;
    const T = importTarget();
    await reloadTarget(T);
    const pre = snapshotOf(T.list);
    const moved = await claimFromOthers(T, registrations);
    const { touched, unknown, created, matched } = Merge.applySchedules(T.list, registrations, {
      createMissing: true, advisorName: T.name
    });
    rememberUndo(touched, 'the schedules from ' + file.name, T, pre, moved);
    await Store.saveStudents(T.slug, touched);
    await finishClaim(moved);
    // Only the department admin changes the shared offering. Advisor schedule
    // imports update their students without changing department-wide data.
    let addSec = [];
    if (state.me.admin) {
      const extra = PdfImport.sectionsFromRegistrations(registrations);
      const known = new Set(state.offering.sections.map(x => x.crn));
      addSec = extra.filter(x => !known.has(x.crn));
      if (addSec.length) {
        state.offering = Object.assign({}, state.offering, { sections: state.offering.sections.concat(addSec) });
        await Store.saveOffering(state.offering.termCode, state.offering);
      }
    }
    await reloadTarget(T);
    flush();
    importState.result = `${T.admin ? '<p class="note">For <b>' + esc(advisorNamed(T.slug)) + '</b></p>' : ''}<p><b>${matched} schedules</b> matched for ${esc(term)} from ${esc(file.name)}.</p>`;
    showImport('S', `<div class="chk ${unknown.length ? 'warn' : 'info'}"><span class="ic">${unknown.length ? '!' : '&check;'}</span>
      <span class="tx"><p><b>${matched} of ${registrations.length} schedules matched</b>${T.admin ? ' for ' + esc(advisorNamed(T.slug)) : ''} · ${esc(term)}, covering
        ${touched.reduce((n, x) => n + x.registration.courses.length, 0)} registered courses.</p>
      ${created.length ? `<p style="margin-top:5px"><b>${created.length} schedules arrived before their transcripts.</b>
        They were kept, not discarded. Import the transcripts next and the records will join automatically.</p>` : ''}
      ${unknown.length ? `<p style="margin-top:5px"><b>${unknown.length} not in your list yet:</b>
        <span class="mono">${unknown.slice(0, 10).map(esc).join(', ')}</span>. Import their transcripts and load this file again.</p>` : ''}
      ${(() => { const without = T.list.filter(x => !x.registration).length;
        return without ? `<p style="margin-top:5px">${without} of ${T.list.length} students still have no schedule for ${esc(term)}.</p>` : ''; })()}
      ${movedNote(moved)}
      ${addSec.length ? `<div class="src">${addSec.length} new sections added to the offering from these schedules</div>` : ''}</span></div>`);
    render();
  } catch (e) {
    showImport('S', `<div class="chk block"><span class="ic">!</span><span class="tx"><p>Could not read that file: ${esc(e.message)}</p></span></div>`);
  }
}

/* Excel saves "CSV" with ; or a tab in Arabic/French settings, so the
   separator is whichever of , ; tab is most common on the first line. */
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const count = ch => first.split(ch).length - 1;
  const sep = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let cur = [], val = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { val += '"'; i++; }
      else if (ch === '"') q = false;
      else val += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { cur.push(val); val = ''; }
    else if (ch === '\n') { cur.push(val); rows.push(cur); cur = []; val = ''; }
    else if (ch !== '\r') val += ch;
  }
  if (val || cur.length) { cur.push(val); rows.push(cur); }
  return rows.filter(r => r.some(c => String(c).trim()));
}

/* .xlsx without a library: it's a zip of XML files. Read the zip directory,
   inflate sharedStrings + the first sheet with DecompressionStream, and turn
   the cells into rows of text like parseCsv gives. */
async function xlsxRows(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('that Excel file looks damaged');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
    files[name] = { method, csize, off };
    p += 46 + nl + el + cl;
  }
  const read = async name => {
    const f = files[name]; if (!f) return null;
    const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
    const raw = u8.subarray(start, start + f.csize);
    if (f.method === 0) return new TextDecoder().decode(raw);
    const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(ds).text();
  };
  const xml = t => new DOMParser().parseFromString(t, 'application/xml');
  const ssT = await read('xl/sharedStrings.xml');
  const shared = ssT ? Array.from(xml(ssT).getElementsByTagName('si')).map(si => Array.from(si.getElementsByTagName('t')).map(t => t.textContent).join('')) : [];
  const sheetName = Object.keys(files).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error('no sheet found in that Excel file');
  const doc = xml(await read(sheetName));
  const colOf = ref => { let c = 0; for (const ch of ref.replace(/\d+/g, '')) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
  return Array.from(doc.getElementsByTagName('row')).map(row => {
    const out = [];
    Array.from(row.getElementsByTagName('c')).forEach(c => {
      const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0], is = c.getElementsByTagName('is')[0];
      let val = t === 's' && v ? shared[+v.textContent] : t === 'inlineStr' && is ? is.textContent : v ? v.textContent : '';
      // Excel keeps times as a fraction of a day (0.354 = 08:30)
      if ((!t || t === 'n') && /^0?\.\d+$/.test(val)) { const m = Math.round(+val * 1440); val = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
      out[colOf(c.getAttribute('r') || '')] = val;
    });
    return Array.from(out, x => x == null ? '' : String(x));
  }).filter(r => r.some(c => String(c).trim()));
}

async function onOffering(file) {
  if (!state.me || !state.me.admin) {
    toast('Only the department admin can upload the course offering.');
    return;
  }
  const el = $('#outO');
  const sel = $('#offTerm');
  const forTerm = sel ? sel.value : state.planTerm;
  try {
    let rows;
    if (/\.xlsx$/i.test(file.name)) rows = await xlsxRows(await file.arrayBuffer());
    else if (/\.xls$/i.test(file.name)) throw new Error('this is an old Excel (.xls) file. Open it in Excel and save it as .xlsx or CSV, then drop that');
    else if (isPdf(file)) throw new Error('this is a PDF. The offering has to be a table: CSV or Excel (.xlsx)');
    else rows = parseCsv(await file.text());
    if (rows.length < 2) throw new Error('that file has no rows');
    const head = rows[0].map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
    const col = names => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
    const iCode = col(['course', 'code', 'coursecode', 'courseid']);
    // Banner exports split it: Subj CMPS + Crse 347
    const iSubj = col(['subj', 'subject']), iNum = col(['crse', 'number', 'coursenumber', 'courseno', 'no']);
    if (iCode < 0 && (iSubj < 0 || iNum < 0)) throw new Error('no "course" or "code" column found. The first row should hold the column names: code, crn, section, credits, campus, day, start, end, teacher');
    const iCrn = col(['crn']), iSec = col(['section', 'sec']), iCr = col(['credits', 'cr', 'credit']);
    const iDay = col(['day', 'days']), iStart = col(['start', 'from', 'timefrom']), iEnd = col(['end', 'to', 'timeto']);
    const iTitle = col(['title', 'coursetitle', 'name']), iTeach = col(['teacher', 'instructor']);
    const iRoom = col(['room']), iAttr = col(['attribute', 'group']), iTime = col(['time']);
    const iCamp = col(['campus', 'camp']);
    const byCrn = {};
    rows.slice(1).forEach((r, n) => {
      const code = (iCode >= 0 ? String(r[iCode] || '') : String(r[iSubj] || '') + String(r[iNum] || '')).toUpperCase().replace(/\s+/g, '');
      if (!/^[A-Z]{3,4}\d{3}[A-Z]?$/.test(code)) return;
      const crn = iCrn >= 0 ? String(r[iCrn]).trim().replace(/[^A-Za-z0-9-]/g, '') : code + '-' + n;
      if (!crn) return;
      const sec = byCrn[crn] || (byCrn[crn] = {
        crn, code, title: iTitle >= 0 ? String(r[iTitle]).trim() : '',
        section: iSec >= 0 ? String(r[iSec]).trim() : '', cr: iCr >= 0 ? Number(r[iCr]) || 0 : 0,
        teacher: iTeach >= 0 ? String(r[iTeach]).trim() : '', attribute: iAttr >= 0 ? String(r[iAttr]).trim() : null,
        campus: null, term: forTerm, termCode: state.offering.termCode, meetings: [], sources: ['csv']
      });
      if (!sec.campus) {
        const raw = iCamp >= 0 ? String(r[iCamp]).trim() : '';
        sec.campus = /deb/i.test(raw) ? 'Debbieh' : /bei/i.test(raw) ? 'Beirut'
          : ({ B: 'Beirut', D: 'Debbieh' })[(sec.section || '')[0]] || null;
      }
      let start = iStart >= 0 ? String(r[iStart]).trim() : '', end = iEnd >= 0 ? String(r[iEnd]).trim() : '';
      if (!start && iTime >= 0) {
        const m = /(\d{1,2}:?\d{2})\s*[-to]+\s*(\d{1,2}:?\d{2})/i.exec(String(r[iTime]));
        if (m) { start = m[1]; end = m[2]; }
      }
      const fix = t => { const d = String(t).replace(/\D/g, ''); return d.length === 4 ? d.slice(0, 2) + ':' + d.slice(2) : String(t); };
      // "MON", "Monday", or Banner letters "MW" / "TR" (R = Thursday)
      const rawDay = iDay >= 0 ? String(r[iDay]).trim().toUpperCase() : '';
      const LET = { M: 'MON', T: 'TUE', W: 'WED', R: 'THU', F: 'FRI', S: 'SAT', U: 'SUN' };
      const days = /^[MTWRFSU]{1,6}$/.test(rawDay) && !/^(MON|TUE|WED|THU|FRI|SAT|SUN)/.test(rawDay)
        ? rawDay.split('').map(ch => LET[ch]) : rawDay.split(/[\s,/]+/).filter(Boolean).map(d => d.slice(0, 3));
      if (start) days.forEach(day => sec.meetings.push({ day, start: fix(start), end: fix(end), kind: '', room: iRoom >= 0 ? String(r[iRoom]).trim() : '' }));
    });
    const sections = Object.keys(byCrn).map(k => byCrn[k]);
    // a meeting whose end is before its start is a typing slip in the file:
    // swapped back and reported; an empty one (start = end) or a repeat is dropped
    const mins = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
    const timeFixes = [];
    sections.forEach(sec => {
      const seen = new Set();
      sec.meetings = sec.meetings.filter(m => {
        const a = mins(m.start), b = mins(m.end);
        if (a != null && b != null && a > b) { timeFixes.push(sec.code + ' ' + sec.section + ' ' + m.day + ' ' + m.start + '–' + m.end); const t = m.start; m.start = m.end; m.end = t; }
        else if (a != null && a === b) { timeFixes.push(sec.code + ' ' + sec.section + ' ' + m.day + ' ' + m.start + ' (no length, dropped)'); return false; }
        const key = m.day + '|' + m.start + '|' + m.end;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
    });
    if (!sections.length) throw new Error('no course rows recognised. Course codes should look like CMPS347 (or Subj CMPS + Crse 347)');
    const kept = state.offering.sections.filter(s => s.term !== forTerm);
    state.offering = Object.assign({}, state.offering, {
      coverage: state.offering.coverage, syncedAt: Date.now(), syncedBy: state.me.name,
      sections: kept.concat(sections)
    });
    await Store.saveOffering(state.offering.termCode, state.offering);
    flush();
    importState.result = `<p><b>${sections.length} sections</b> synced for ${esc(forTerm)}.</p>`;
    showImport('O', `<div class="chk info"><span class="ic">&check;</span><span class="tx">
      <p><b>${sections.length} sections synced</b> for ${esc(forTerm)}, covering ${new Set(sections.map(s => s.code)).size} courses.
      ${forTerm === state.planTerm ? 'The ' + esc(shortTerm(forTerm)) + ' recommendations now use these sections.' : ''}</p>
      ${timeFixes.length ? `<p style="margin-top:5px"><b>${timeFixes.length} meeting time${timeFixes.length === 1 ? '' : 's'} had the end before the start</b> and ${timeFixes.length === 1 ? 'was' : 'were'} corrected. Check ${timeFixes.length === 1 ? 'it' : 'them'} against the registrar's file: ${esc(timeFixes.slice(0, 10).join('; '))}${timeFixes.length > 10 ? ' and ' + (timeFixes.length - 10) + ' more' : ''}.</p>` : ''}</span></div>`);
    render();
  } catch (e) {
    showImport('O', `<div class="chk block"><span class="ic">!</span><span class="tx"><p>Could not read that file: ${esc(e.message)}</p></span></div>`);
  }
}

// ---- ask ------------------------------------------------------------------
const SUGGESTIONS = [
  'Students registered for less than 12 credits',
  'Who is on probation?',
  'Who failed CMPS241?'
];

// ---- Ask Me icon -------------------------------------------------------------
/* The assistant's icon (a lighthouse), drawn inline as SVG so it follows the
   theme colours and needs no image file. */

function askIcon(size, mood) {
  const s = size || 40;
  return `<span class="ask-icon ${mood || ''}" style="width:${s}px;height:${s}px" aria-hidden="true">
    <svg viewBox="0 0 48 48" width="${s}" height="${s}">
      <defs>
        <linearGradient id="fnb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--ask-icon-light)"/>
          <stop offset="1" stop-color="var(--ask-icon-dark)"/>
        </linearGradient>
      </defs>
      <ellipse class="ask-icon-sea" cx="24" cy="43" rx="17" ry="3.4"/>
      <path class="ask-icon-beam" d="M24 17 L47 7 L47 27 Z"/>
      <path class="ask-icon-beam" d="M24 17 L1 7 L1 27 Z"/>
      <path class="ask-icon-body" fill="url(#fnb)" d="M17.5 40 L19.5 21 h9 l2 19 z"/>
      <path class="ask-icon-band" d="M18.9 28.5 h10.2 l.5 4.6 H18.4 z"/>
      <rect class="ask-icon-deck" x="17" y="18.4" width="14" height="3.1" rx="1.4"/>
      <circle class="ask-icon-lamp" cx="24" cy="14.2" r="4.2"/>
      <path class="ask-icon-roof" d="M24 6.2 L29.6 12.4 H18.4 Z"/>
      <circle class="ask-icon-eye" cx="22.3" cy="13.8" r=".95"/>
      <circle class="ask-icon-eye" cx="25.9" cy="13.8" r=".95"/>
    </svg>
  </span>`;
}

// ---- the assistant --------------------------------------------------------
/* all in-page from loaded data. No model, no account, no cost, and answers are
   only ever what the records say. */

function findStudents(q) {
  const t = q.toLowerCase();
  const byId = state.students.filter(s => t.indexOf(String(s.id)) >= 0);
  if (byId.length) return byId;
  const words = t.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const skip = ['what', 'should', 'take', 'next', 'for', 'the', 'who', 'and', 'her', 'his', 'does', 'need',
    'this', 'term', 'semester', 'student', 'students', 'about', 'tell', 'show', 'give', 'course', 'courses',
    'with', 'from', 'have', 'has', 'any', 'all', 'how', 'many', 'much', 'can', 'registered', 'register'];
  const hits = state.students.map(s => {
    const parts = s.name.toLowerCase().split(/\s+/);
    let score = 0;
    words.forEach(w => {
      if (skip.indexOf(w) >= 0) return;
      parts.forEach(p => { if (p === w) score += 3; else if (p.indexOf(w) === 0 && w.length > 3) score += 2; });
    });
    return { s, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  // a single clearly better match wins (full name beats a shared first name)
  if (hits.length > 1 && hits[0].score > hits[1].score) return [hits[0].s];
  return hits.slice(0, 5).map(x => x.s);
}

function findCourses(q) {
  const out = [];
  (q.toUpperCase().match(/[A-Z]{3,4}\s?\d{3}[A-Z]?/g) || []).forEach(m => {
    const code = m.replace(/\s/g, '');
    if (MAP[code]) out.push(code);
  });
  return out;
}

const listNames = arr => arr.map(s => s.name + ' (' + s.id + ')').join(', ');

/*__ASKME__*/

/*__RULES__*/

function answerFor(q) {
  const t = q.toLowerCase();
  const has = (...w) => w.some(x => t.indexOf(x) >= 0);
  const codes = findCourses(q);
  const people = findStudents(q);
  const withReg = state.students.filter(s => s.registration);

  // ---- one course ---------------------------------------------------------
  if (codes.length) {
    const code = codes[0], c = MAP[code];
    const secs = state.offering.sections.filter(x => x.code === code);
    const opens = E.buildUnlockScores(C).scores[code] || 0;
    const taking = withReg.filter(s => s.registration.courses.some(x => x.code === code));
    const bits = [];
    bits.push('**' + code + '** ' + nice(c.title || '') + ', ' + c.cr + ' credit' + (c.cr === 1 ? '' : 's') +
      ', counts as ' + ((C.buckets[c.bucket] || {}).label || c.bucket).toLowerCase() + '.');
    bits.push((c.pre && c.pre.length)
      ? 'Prerequisite: ' + c.pre.join(' and ') + '. A prerequisite taken in the same semester does not count.'
      : 'No prerequisite.' + (c.minCredits ? ' Normally taken with at least ' + c.minCredits + ' credits completed.' : ''));
    if (c.planSem) bits.push('The study plan puts it in semester ' + c.planSem + ', which is a ' +
      (c.studyPlanSeason === 'SPRING' ? 'spring' : 'fall') + ' course.');
    if (opens) bits.push('Passing it opens ' + opens + ' credits further down the plan.');
    bits.push(secs.length
      ? secs.length + ' section' + (secs.length === 1 ? '' : 's') + ' in the ' + shortTerm(secs[0].term) + ' offering: ' +
        secs.slice(0, 6).map(x => x.section + ' ' + (x.campus || '') + ' ' + x.meetings.map(m => m.day + ' ' + m.start).join(' ')).join('; ') + '.'
      : 'Not in the offering that is loaded, which covers ' + shortTerm(state.term) + '.');
    if (taking.length) bits.push(taking.length + ' of your students are taking it now: ' + listNames(taking.slice(0, 8)) + '.');
    return bits.join('\n\n');
  }

  // ---- one student --------------------------------------------------------
  const asksAboutPerson = people.length === 1 && (has('what', 'should', 'how', 'why', 'is ', 'does', 'tell') || people.length === 1);
  if (people.length === 1 && asksAboutPerson) {
    const s = people[0], { snap, reg, alerts } = look(s);
    const plan = E.planNextTerm(R, C, s, planTargetFor(s), state.offering.sections);
    const picks = plan.recommendations.slice(0, 5);
    const bits = [];
    bits.push('**' + s.name + '** (' + s.id + '), semester ' + (snap.completedSemesters + 1) + ' at ' + (s.campus || 'Beirut') +
      '. CGPA ' + (s.officialCgpa != null ? s.officialCgpa.toFixed(2) : 'not yet') + ', ' +
      snap.earned + ' of the ' + C.totalCredits + ' credits the degree needs' +
      (studied(s).credits > snap.earned ? ' (' + studied(s).credits + ' completed, ' + (studied(s).credits - snap.earned) + ' of them outside the degree).' : '.'));
    bits.push(s.registration
      ? 'Taking now: ' + s.registration.courses.map(c => c.code).join(', ') + ' (' + reg.credits + ' credits).'
      : 'Not registered for ' + shortTerm(state.term) + '.');
    if (has('next', 'take', 'recommend', 'plan', 'spring')) {
      bits.push('For ' + shortTerm(planTargetFor(s)) + ': ' + picks.map(c => c.code + ' ' + nice(c.title)).join(', ') + '.');
      bits.push(plan.hasOfferingForTerm ? 'Checked against the ' + shortTerm(state.planTerm) + ' offering.'
        : 'The ' + shortTerm(state.planTerm) + ' offering is not loaded, so this follows the study plan.');
    }
    if (alerts.length) bits.push('Needs a look: ' + alerts.map(a => a.title.toLowerCase()).join(', ') + '.');
    else bits.push('Nothing outstanding.');
    return bits.join('\n\n');
  }
  if (people.length > 1 && people.length < 6 && !has('who', 'how many', 'list')) {
    return 'More than one student matches. Did you mean ' + listNames(people) + '?';
  }

  // ---- caseload lists -----------------------------------------------------
  if (has('not registered', 'no registration', 'have not registered', 'unregistered')) {
    const list = advisees().filter(s => !s.registration);
    return list.length
      ? '**' + list.length + ' not registered for ' + shortTerm(state.term) + '**\n\n' +
        list.map(s => '- ' + s.name + ' (' + s.id + '), CGPA ' + (s.officialCgpa != null ? s.officialCgpa.toFixed(2) : 'none yet')).join('\n')
      : 'Everyone is registered for ' + shortTerm(state.term) + '.';
  }
  if (has('repeat', 'failed', 'fail')) {
    const rows = [];
    advisees().forEach(s => {
      // failed, withdrawn or never passed: all of it gets retaken
      const must = E.repeatsDue(R, C, s, state.term, state.offering.sections).map(r => r.code);
      const notNow = must.filter(c => !(s.registration && s.registration.courses.some(x => x.code === c)));
      if (notNow.length) rows.push('- ' + s.name + ' (' + s.id + '): ' + notNow.join(', '));
    });
    return rows.length ? '**' + rows.length + ' students have a course to take again (failed or withdrawn) that is not in this term**\n\n' + rows.join('\n')
      : 'Nobody has an outstanding course to repeat.';
  }
  if (has('graduat', 'finish', 'last semester')) {
    const rows = state.students.map(s => ({ s, a: E.graduationAudit(R, C, s) }))
      .filter(x => x.a.remainingCredits <= 20)
      .sort((a, b) => a.a.remainingCredits - b.a.remainingCredits);
    return rows.length ? '**' + rows.length + ' students are within 20 credits of finishing**\n\n' +
      rows.map(x => '- ' + x.s.name + ' (' + x.s.id + '): ' + x.a.remainingCredits + ' credits left' +
        (x.a.blockers.length ? ', ' + x.a.blockers.length + ' item(s) still open' : '')).join('\n')
      : 'Nobody is inside 20 credits of graduating yet.';
  }
  if (has('probation', 'risk', 'dismiss')) {
    const rows = state.students.map(s => ({ s, snap: look(s).snap }))
      .filter(x => x.snap.standing.state !== 'GOOD_STANDING');
    const rule = 'Probation applies when both the semester GPA and CGPA are below 2.00. The next load is capped at 12 credits. Two consecutive academic warnings lead to the remedial stage; a CGPA below 1.60 then signals dismissal risk.';
    return rows.length ? '**' + rows.length + ' students are not in good standing**\n\n' +
      rows.map(x => '- ' + x.s.name + ' (' + x.s.id + '): ' + x.snap.standing.state.toLowerCase().replace(/_/g, ' ') + ', ' + x.snap.standing.reason).join('\n') +
      '\n\n' + rule : 'Everyone is in good standing.\n\n' + rule;
  }
  if (has('campus', 'debbieh', 'beirut')) {
    const mixed = state.students.filter(s => s.campusMixed);
    const deb = state.students.filter(s => s.campus === 'Debbieh');
    return '**Campus**\n\nSection labels carry it: B is Beirut, D is Debbieh.\n\n' +
      (state.students.length - deb.length) + ' students are based in Beirut and ' + deb.length + ' in Debbieh.\n\n' +
      (mixed.length
        ? mixed.length + ' take courses on both campuses in the same week: ' + listNames(mixed)
          + '. Normal enough, but worth a word about the timings.'
        : 'Nobody is on both campuses this term.');
  }
  if (has('track', 'cybersecurity', 'software', 'data science')) {
    const byTrack = {};
    Object.keys(C.tracks).forEach(k => { byTrack[k] = []; });
    const mixed = [], developing = [];
    state.students.forEach(s => {
      const { snap } = look(s), e = snap.trackEstimate || { kind: 'none' };
      if (snap.likelyTrack) byTrack[snap.likelyTrack].push(s);
      else if (e.kind === 'mixed') mixed.push(s);
      else if (e.kind === 'developing') developing.push(s);
    });
    return '**Tracks**\n\nThree departmental electives from one list support a potential track. It remains an estimate unless the track is recorded.\n\n' +
      Object.keys(C.tracks).map(k => '- ' + C.tracks[k].label + ': ' + (byTrack[k].length
        ? byTrack[k].length + ' recorded or potential (' + byTrack[k].slice(0, 6).map(s => s.name.split(' ')[0] + ' ' + s.id).join(', ') + ')'
        : 'nobody yet') + '. Courses: ' + C.tracks[k].courses.join(', ')).join('\n') +
      '\n- General / mixed: ' + mixed.length + '.\n- Not enough evidence yet: ' + developing.length + '.';
  }
  if (has('credit limit', 'how many credits', 'load', 'maximum', 'minimum')) {
    return '**Credit load**\n\n- Normal semester: 12 to 18 credits.\n- Up to 21 with a CGPA of 3.33 and 34 credits earned.\n' +
      '- 12 maximum while on probation (semester GPA and CGPA below 2.00).\n- Summer: 9 maximum.\n\n' +
      'Registering under 12 gets cancelled after week two unless an exception is approved.';
  }
  if (has('wrn', 'work ready')) {
    return '**Work Ready Now (WRNL200)**\n\nA 3 credit University Requirements course. Required for students admitted from 2024/2025 on; earlier intakes do not need it. ' +
      'The portal raises it once a student is near 50 credits.\n\n' +
      state.students.filter(s => E.wrnlRequired(R, C, s) && !look(s).snap.passed.has('WRNL200')).length +
      ' of your students still need it.';
  }
  if (has('ic3', 'icdl')) {
    const missing = state.students.filter(s => !look(s).snap.ic3 && look(s).snap.completedSemesters >= 4);
    return '**IC3**\n\nRequired within the first four semesters, and it carries no degree credits.\n\n' +
      (missing.length ? missing.length + ' students are past semester 4 without it: ' + listNames(missing.slice(0, 10)) + '.' : 'Nobody is overdue.');
  }
  if (has('elective') && has('humanit', 'social', 'university')) {
    const noHum = state.students.filter(s => !look(s).snap.buckets.UNIV_ELECTIVE.hasHumanities);
    const noSoc = state.students.filter(s => !look(s).snap.buckets.UNIV_ELECTIVE.hasSocial);
    return '**University electives**\n\n8 credits for the 2026 catalogue, 11 before it. At least one humanities course and one social science course, where SOCI and PSYC both count as social.\n\n' +
      noHum.length + ' students have no humanities course yet, ' + noSoc.length + ' have no social science course.';
  }
  if (has('graduation requirement', 'to graduate', 'degree require')) {
    return '**To graduate**\n\n100 credits: 16 university, 17 faculty core, 53 major core, 9 departmental electives, 5 general science. ' +
      'CGPA at least 2.00, IC3 done, no unresolved F.';
  }
  if (has('offering', 'offered', 'sections', 'spring')) {
    const terms = {};
    state.offering.sections.forEach(x => { terms[x.term] = (terms[x.term] || 0) + 1; });
    return '**Course offering**\n\n' + Object.keys(terms).map(k => '- ' + shortTerm(k) + ': ' + terms[k] + ' sections').join('\n') +
      '\n\nThe ' + shortTerm(state.planTerm) + ' offering ' + (terms[state.planTerm] ? 'is loaded.' : 'is not out yet, so recommendations for it follow the study plan: semesters 1, 3 and 5 are fall courses, 2, 4 and 6 are spring.');
  }
  if (has('needs review', 'on track', 'attention', 'review', 'urgent', 'what does')) {
    const c = counts();
    return '**Needs attention or on track**\n\n- **Needs attention** (' + (c.urgent + c.watch) + '): ' + REVIEW_MEANS +
      '\n- **On track** (' + c.ok + '): ' + OK_MEANS;
  }
  if (has('how many', 'count', 'total')) {
    const c = counts();
    return 'You have **' + c.total + ' advisees**. ' + (c.done ? c.done + ' already reviewed, ' : '') + c.urgent + ' must fix, ' + c.watch + ' should check, ' + c.ok +
      ' nothing to do. ' + c.unreg + ' are not registered for ' + shortTerm(state.term) + '.';
  }

  // ---- newer features -----------------------------------------------------
  if (has('intensive', 'inte001', 'inte002', 'english 1', 'english 2')) {
    const cfg = R.intensiveEnglish || { levels: {} };
    const inIt = advisees().filter(s => look(s).snap.intensive);
    return '**Intensive English**\n\n'
      + Object.keys(cfg.levels).map(k => '- **' + cfg.levels[k].name + '** (' + k + '): up to '
          + cfg.levels[k].creditCap + ' credits alongside it, ' + cfg.levels[k].allowed + '.').join('\n')
      + '\n\nThe levels are taken in order, ENGL001 waits for 2B, and the programme must be finished by '
      + (cfg.finishBy || 'the end of the first year') + '.'
      + (inIt.length ? '\n\nOn your list: ' + listNames(inIt.slice(0, 8)) + '.' : '\n\nNobody on your list is in it.');
  }
  if (has('remedial')) {
    const rem = advisees().filter(s => look(s).snap.standing.remedial);
    return '**The remedial stage** follows two consecutive academic warnings. Each warning requires both the semester GPA and CGPA to be below 2.00. '
      + 'The load drops to 12 credits in fall and spring, and the advisor chooses courses that can improve the GPA.'
      + (rem.length ? '\n\nIn it now (' + rem.length + '): ' + listNames(rem.slice(0, 8)) + '.' : '\n\nNobody on your list is in it.');
  }
  if (has('critical')) {
    const crit = criticalList();
    return crit.length
      ? '**' + crit.length + ' critical case' + (crit.length === 1 ? '' : 's') + '**\n\n'
        + crit.map(s => '- **' + s.name + '** — ' + (s.critical.reason || 'no reason written')
          + ' (marked ' + whenWord(s.critical.at) + ')').join('\n')
      : 'No critical cases. You mark one from a student\u2019s page when it needs to stay at the top of your list until it is resolved.';
  }
  if (has('meeting', 'met with', 'logged')) {
    const withMeets = state.students.filter(s => (s.meetings || []).length);
    return 'Meetings are logged on a student\u2019s page: what you agreed and when, newest first, and they survive a re-import.'
      + (withMeets.length ? '\n\nLogged so far: ' + withMeets.length + ' student'
          + (withMeets.length === 1 ? '' : 's') + ', ' + listNames(withMeets.slice(0, 6)) + '.' : '\n\nNothing logged yet.');
  }
  if (has('minor')) {
    const m = C.mathMinor || {};
    return '**Minor in Mathematics**\n\nThe minor needs exactly ' + (m.minCredits || 18)
      + ' MATH credits and must include **MATH246 Real Analysis I** or **MATH346 Abstract Algebra I**. '
      + 'MATH courses used as general science or departmental electives are not counted, and neither are foundation courses (MATH111, MATH112) or freshman credit (MATH110).';
  }
  if (has('master', 'msc', 'graduate programme', 'graduate program')) {
    const ms = state.students.filter(s => groupOf(s) === 'masters');
    return '**The Master\u2019s in Computer Science** is ' + MASTERS.total + ' credits: '
      + MASTERS.coreCredits + ' core, ' + MASTERS.electiveCredits + ' departmental electives and a '
      + MASTERS.thesisCredits + '-credit thesis, with a CGPA of at least ' + MASTERS.minCgpa
      + ' and no less than ' + MASTERS.minYears + ' years.\n\nThe undergraduate rules do not apply to them.'
      + (ms.length ? '\n\nOn your list: ' + listNames(ms) + '.' : '');
  }
  if (has('freshman', 'freshmen')) {
    const fr = state.students.filter(s => groupOf(s) === 'freshman');
    return fr.length
      ? '**' + fr.length + ' freshmen** on your list, on their own page. The freshman year runs on its own rules, '
        + 'which are not in the portal yet, so nothing is checked against the Computer Science degree and none of them reach your review list.'
      : 'You have no freshmen. They only appear for an advisor who has them.';
  }
  if (has('backup', 'export', 'download', 'copy of')) {
    return 'Open your account at the top right. Under **Reports and copies**, download the Excel report or open the PDF summary. '
      + 'The Excel report includes the student summary and every transcript course.';
  }
  if (has('marked', 'reviewed')) {
    const c = counts();
    return 'Marking a student says come back to them; reviewing says you are done, and they leave the list '
      + 'until something new is flagged.\n\nMarked and waiting: ' + markedPending().length
      + '. Reviewed this term: ' + c.done + '.';
  }

  const fromRules = ASKME.ruleAnswer(q);
  if (fromRules) return fromRules;

  /* no match. Instead of dumping a list of everything it can do, offer three
       questions about their own students, ready to tap. */
  const sample = advisees().filter(s => look(s).level !== 'ok')[0] || advisees()[0];
  const ideas = [
    sample ? 'What should ' + sample.name.split(' ')[0] + ' take next?' : 'Who needs attention?',
    'Who is not registered?',
    'Who is close to graduating?'
  ];
  return 'I did not follow that one.\n\nI answer from the records loaded in this page: a student by name, '
    + 'a course code like CMPS347, or a rule. Try one of these:\n\n'
    + ideas.map(x => '- ' + x).join('\n');
}

function viewAsk() {
  const opener = state.me.admin
    ? `Hello. I can look across all ${allStudentCount()} students in the department, any course, or any rule.`
    : `Hello. Ask me about any of your ${state.students.length} students, any course, or any rule. I have read the transcripts, the schedules, the ${state.offering.sections.length} sections loaded, and the regulations.`;
  const bubble = m => m.role === 'you'
    ? `<div class="msg you">${esc(m.text)}</div>`
    : `<div class="msg bot">${askIcon(30, 'mini')}<span class="bub">${mdLite(m.text)}</span></div>`;
  return `<div class="wrap">
    <div class="page-h ask-icon-h">
      ${askIcon(58, 'big')}
      <div><h1>Ask Me</h1>
        <p>Ask about a student, a course or a rule. A rule-based guide, no AI model.</p></div>
    </div>
    <div class="chat">
      <div class="msgs" id="msgs">
        ${state.chat.length
          ? state.chat.map(bubble).join('')
          : `<div class="msg bot">${askIcon(30, 'mini')}<span class="bub">${esc(opener)}</span></div>`}
      </div>
      <div class="sugg"><span class="lab">Try</span>
        ${SUGGESTIONS.map(x => `<button data-sugg="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <div class="ask">
        <textarea id="askBox" placeholder="Type a question: a student, a course code, or a rule" rows="1"></textarea>
        <button class="btn primary" id="askGo">Ask</button>
      </div>
      <p class="note">Nothing is sent outside the portal. Check official record changes with the registrar.</p>
    </div>
  </div>`;
}


/* suggestion board for the portal. Whole dept sees it so ideas don't get lost
   and nobody posts the same request twice. */
/* ---- superadmin: activity log and backups ----
   The log is decrypted on the server and sent 50 lines at a time. */
const activity = { page: 0, action: '', actor: '', data: null, backup: null, loading: false, error: '' };
const ACTION_WORDS = {
  'signin': 'Signed in', 'signin-failed': 'Failed sign-in', 'password-rehashed': 'Password hash upgraded',
  'password-changed': 'Changed password', 'password-reset': 'Reset password', 'reset-requested': 'Asked for a reset link',
  'invite-accepted': 'Accepted invitation', 'person-invited': 'Invited someone', 'read-other-students': 'Read another advisor’s students',
  'read-all-students': 'Read every advisor’s students', 'block-overridden': 'Overrode a registration check',
  'backup-downloaded': 'Downloaded a backup', 'sessions-ended': 'Signed out other sessions', 'audit-log-read': 'Read the activity log',
  'account-verified': 'Activated account', 'admin-clear-password': 'Cleared someone\u2019s password', 'admin-reset-link': 'Made a reset link',
  'delete': 'Deleted a record', 'set': 'Changed a record', 'mail-sent': 'Sent an email', 'org-migration': 'Organisation data migrated',
  'org-tree-changed': 'Changed the university structure', 'person-deactivated': 'Deactivated someone', 'person-role-changed': 'Changed someone\u2019s role',
  'students-clear': 'Cleared a student list', 'students-save': 'Imported students', 'study-plan-saved': 'Saved a study plan'
};
async function loadActivity() {
  activity.loading = true; activity.error = '';
  try {
    const [log, backup] = await Promise.all([
      Store.auditLog({ page: activity.page, action: activity.action, actor: activity.actor }),
      Store.backupStatus()
    ]);
    activity.data = log; activity.backup = backup;
  } catch (e) { activity.error = e.message; }
  activity.loading = false;
  if (state.view === 'activity') render();
}
function activityDetails(e) {
  const d = Object.assign({}, e.details || {});
  const nameOf = slug => ((FACULTY.find(f => f.slug === slug) || {}).name) || slug;
  ['owner', 'advisor', 'target', 'by'].forEach(k => { if (typeof d[k] === 'string') d[k] = nameOf(d[k]); });
  if (d.advisors && typeof d.advisors === 'object') {
    const named = {};
    Object.keys(d.advisors).forEach(a => { named[nameOf(a)] = d.advisors[a]; });
    d.advisors = named;
  }
  const skip = new Set(['ip', 'before', 'after']);
  const parts = Object.keys(d).filter(k => !skip.has(k) && d[k] != null && typeof d[k] !== 'object').map(k => k + ': ' + d[k]);
  if (d.advisors && typeof d.advisors === 'object') parts.push(Object.keys(d.advisors).map(a => a + ' (' + d.advisors[a] + ')').join(', '));
  return parts.join(' · ');
}
function viewActivity() {
  if (!state.me.superadmin) return '<div class="wrap"><p class="note">Only a superadmin can see this page.</p></div>';
  if (!activity.data && !activity.loading && !activity.error) loadActivity();
  const b = activity.backup;
  const log = activity.data;
  const nameOf = slug => ((FACULTY.find(f => f.slug === slug) || {}).name) || slug || 'system';
  const backupPanel = !b ? '<p class="note">Loading&hellip;</p>' : `
    <div class="bk-facts">
      <div><span>Storage</span><b>${b.encrypted ? 'Encrypted (AES-256-GCM)' : 'Not encrypted (development)'}</b></div>
      <div><span>Newest backup</span><b>${b.latest ? esc(new Date(b.latest.at).toLocaleString()) : 'none yet'}</b></div>
      <div><span>Backups kept</span><b>${b.count} of ${b.keep}</b></div>
      <div><span>Last taken off the server</span><b>${b.lastDownload ? esc(new Date(b.lastDownload.at).toLocaleString()) + ' by ' + esc(nameOf(b.lastDownload.by)) : 'never'}</b></div>
    </div>
    ${!b.encrypted ? '<p class="note">Downloads are switched on when the store is encrypted (STORE_KEY is set), so a copy never leaves the server readable.</p>'
      : b.lastDownload && Date.now() - new Date(b.lastDownload.at).getTime() < 8 * 864e5 ? ''
      : '<p class="note warn-note">No copy has been downloaded in the last week. The hourly backups live on the same disk as the data, so keep one somewhere else too.</p>'}
    ${b.encrypted ? `<div class="bk-actions"><button class="btn sm primary" data-backup-download="1"${b.latest ? '' : ' disabled'}>Download the newest backup</button>
      <span class="note">The file stays encrypted. It can only be restored with the store key.</span></div>` : ''}`;
  const rows = log ? log.entries.map(e => `<tr>
      <td class="c">${esc(new Date(e.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</td>
      <td>${esc(nameOf(e.actor))}</td>
      <td>${esc(ACTION_WORDS[e.action] || e.action)}</td>
      <td class="det">${esc(activityDetails(e))}</td></tr>`).join('') : '';
  return `<div class="wrap">
    <div class="page-h"><h1>Activity and backups</h1>
      <p>Who did what, newest first, and the state of the backups.</p></div>
    <div class="panel"><div class="hd">Backups</div><div class="bd stack">${backupPanel}</div></div>
    <div class="panel"><div class="hd">Activity log</div><div class="bd stack">
      <div class="act-filters">
        <label class="f" for="actAction">What
          <select id="actAction"><option value="">Everything</option>
            ${((log && log.actions) || []).map(a => `<option value="${esc(a)}"${a === activity.action ? ' selected' : ''}>${esc(ACTION_WORDS[a] || a)}</option>`).join('')}
          </select></label>
        <label class="f" for="actActor">Who
          <select id="actActor"><option value="">Anyone</option>
            ${state.people.map(p => `<option value="${esc(p.slug)}"${p.slug === activity.actor ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select></label>
        <button class="btn sm" data-act-filter="1">Show</button>
      </div>
      ${activity.error ? `<p class="err">${esc(activity.error)}</p>` : ''}
      ${!log ? '<p class="note">Loading&hellip;</p>' : !log.entries.length ? '<p class="note">Nothing matches.</p>' : `
      <div class="tscroll"><table class="t act"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="pager">
        <button class="btn sm" data-act-page="${log.page - 1}"${log.page > 0 ? '' : ' disabled'}>Newer</button>
        <span class="note">Page ${log.page + 1} of ${Math.max(1, log.pages)}<i class="sep-dot" aria-hidden="true"></i>${log.total} entries</span>
        <button class="btn sm" data-act-page="${log.page + 1}"${log.page + 1 < log.pages ? '' : ' disabled'}>Older</button>
      </div>`}
      ${log && log.unreadable ? `<p class="note">${log.unreadable} lines could not be read with the current key.</p>` : ''}
    </div></div>
  </div>`;
}

/* What a filtered list says when nothing is left, with a way back out. */
function noMatch() {
  const narrowed = state.q.trim() || (state.filter && state.filter !== 'all');
  return `<div class="empty" role="status"><p>${state.q.trim() ? 'Nobody matches \u201c' + esc(state.q.trim()) + '\u201d.' : 'Nobody is in this group right now.'}</p>
    ${narrowed ? '<button class="btn sm" data-clear-search="1">Show everyone</button>' : ''}</div>`;
}

function viewIdeas() {
  const mine = st => st.by === state.me.name;
  const kindLabel = { idea: 'Idea', problem: 'Something is wrong', question: 'Question' };
  const list = state.ideas;
  return `<div class="wrap">
    <div class="page-h"><h1>Suggestions for the portal</h1>
      <p>Share a clear idea or report something that needs improvement.</p></div>

    <div class="panel"><div class="bd stack">
      <div class="seg" style="align-self:flex-start">
        ${['idea', 'problem', 'question'].map(k =>
          `<button data-idea-kind="${k}" aria-pressed="${ideaKind === k}">${kindLabel[k]}</button>`).join('')}
      </div>
      <textarea id="ideaText" rows="4" placeholder="${ideaKind === 'problem'
        ? 'What happened, and what you expected instead.'
        : ideaKind === 'question' ? 'What you are trying to do.'
        : 'What would make your advising easier?'}"></textarea>
      <div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">
        <button class="btn primary" data-idea-save="1">Send it</button>
        <span class="note">Signed with your name and kept on the shared suggestions board.</span>
      </div>
    </div></div>

    ${list.length ? `<div class="sec">
      <div class="sec-h"><h2>On the board</h2><span class="c">${list.length}</span></div>
      <div class="panel"><div class="alist">
        ${list.map(it => `<div class="al ${it.kind === 'problem' ? 'watch' : 'info'}" style="cursor:default">
          <span class="stripe"></span>
          <span class="body">
            <span class="t">${esc(kindLabel[it.kind] || 'Idea')}
              <span class="who-meta">Dr. ${esc(it.by)}<i class="sep-dot" aria-hidden="true"></i>${esc(new Date(it.at).toLocaleDateString())}
                ${it.votes && it.votes.length ? '<i class="sep-dot" aria-hidden="true"></i> ' + it.votes.length + ' also want this' : ''}</span></span>
            <span class="d">${esc(it.text)}</span>
            <span style="display:flex;gap:8px;margin-top:9px">
              <button class="btn sm" data-idea-vote="${esc(it.id)}">
                ${(it.votes || []).includes(state.me.name) ? 'You want this too' : 'I want this too'}</button>
              ${mine(it) ? `<button class="btn sm danger" data-idea-remove="${esc(it.id)}">Remove</button>` : ''}
            </span>
          </span>
        </div>`).join('')}
      </div></div>
    </div>` : '<p class="note" style="text-align:center">Nothing here yet. Yours would be the first.</p>'}
  </div>`;
}

// ---- admin portal ---------------------------------------------------------
/* admin advises nobody; they need the whole dept on one page: whose list each
   student is on, which advisor asked for what. Same student rows plus the
   advisor's name, filters work across everyone. */

let peopleQuery = '', peopleForm = null, peopleMessage = '';

function orgScopeRows() {
  const rows = [];
  const visit = (node, kind, path) => {
    if (!node) return;
    const nextPath = path.concat([{ id: node.id, name: node.name, kind }]);
    rows.push({ id: node.id, kind, label: nextPath.slice(1).map(part => part.name).join(' / ') || node.name,
      faculty: nextPath.find(part => part.kind === 'faculty')?.name || '',
      department: nextPath.find(part => part.kind === 'department')?.name || '' });
    (node.faculties || []).forEach(child => visit(child, 'faculty', nextPath));
    (node.departments || []).forEach(child => visit(child, 'department', nextPath));
    (node.programmes || []).forEach(child => visit(child, 'programme', nextPath));
  };
  if (state.orgTree) visit(state.orgTree, 'university', []);
  return rows;
}

function uiNodeContains(scopeId, targetId) {
  const node = orgScopeRows().find(row => row.id === scopeId);
  if (!node || !state.orgTree) return false;
  const has = (current, target) => current.id === target
    || ['faculties', 'departments', 'programmes'].some(key =>
      (current[key] || []).some(child => has(child, target)));
  const find = current => current.id === scopeId ? current
    : ['faculties', 'departments', 'programmes'].map(key =>
      (current[key] || []).map(find).find(Boolean)).find(Boolean);
  const source = find(state.orgTree);
  return !!source && has(source, targetId);
}

function manageableScopeRows() {
  const roles = state.me && Array.isArray(state.me.roles) ? state.me.roles : [];
  if (state.me && state.me.superadmin) return orgScopeRows();
  return orgScopeRows().filter(row => roles.some(assignment =>
    assignment.role === 'faculty-admin'
      && (assignment.scopes || []).some(scope => uiNodeContains(scope, row.id))));
}

function peopleRoleOptions() {
  const rows = manageableScopeRows();
  const kinds = new Set(rows.map(row => row.kind));
  const options = [];
  if (state.me && state.me.superadmin) options.push(['superadmin', 'Superadmin']);
  if (kinds.has('faculty')) options.push(['faculty-admin', 'Faculty admin']);
  if (kinds.has('programme')) {
    options.push(['programme-editor', 'Programme editor'], ['advisor', 'Advisor'], ['viewer', 'Viewer']);
  }
  if (kinds.has('faculty') || kinds.has('programme')) options.push(['approver', 'Approver']);
  return options;
}

function scopeKindsForRole(role) {
  if (role === 'superadmin') return ['university'];
  if (role === 'faculty-admin') return ['faculty'];
  if (role === 'approver') return ['faculty', 'programme'];
  return ['programme'];
}

function syncPeopleScopeOptions() {
  const select = $('#peopleScopes'), role = $('#peopleRole');
  if (!select || !role) return;
  const allowed = new Set(scopeKindsForRole(role.value));
  Array.from(select.options).forEach(option => {
    const show = allowed.has(option.dataset.kind);
    option.hidden = !show;
    if (!show) option.selected = false;
  });
}

function personRoleScope(person) {
  return (person.roles || []).flatMap(assignment => assignment.scopes || [])
    .map(scope => orgScopeRows().find(row => row.id === scope)?.label || scope).join(', ');
}

function viewPeople() {
  if (!state.me.peopleManager) return '<div class="wrap"><p class="note">You do not have permission to manage staff.</p></div>';
  const query = peopleQuery.trim().toLowerCase();
  const people = state.people.filter(person => {
    const haystack = [person.name, person.email, person.faculty, person.department,
      personRoleScope(person), ...(person.roles || []).map(role => role.role)].join(' ').toLowerCase();
    return !query || haystack.includes(query);
  });
  const groups = new Map();
  people.forEach(person => {
    const wholeUni = (person.roles || []).some(role => role.role === 'superadmin');
    const faculty = wholeUni ? 'Whole university' : person.faculty || 'Unassigned faculty';
    const department = wholeUni ? 'Superadmins' : person.department || 'Unassigned department';
    if (!groups.has(faculty)) groups.set(faculty, new Map());
    const depts = groups.get(faculty);
    if (!depts.has(department)) depts.set(department, []);
    depts.get(department).push(person);
  });
  const roleOptions = peopleRoleOptions();
  const editing = peopleForm;
  const currentRole = editing && editing.person && editing.person.roles && editing.person.roles[0];
  const defaultRole = (roleOptions.find(([value]) => value === 'advisor') || roleOptions[0] || [])[0] || '';
  const selectedRole = editing ? (currentRole && currentRole.role) || defaultRole : '';
  const allowedScopeKinds = new Set(scopeKindsForRole(selectedRole));
  const scopeOptions = manageableScopeRows();
  const selectedScopes = editing && currentRole ? currentRole.scopes || [] : [];
  const form = editing ? `<div class="panel"><div class="hd">${editing.mode === 'invite' ? 'Invite a staff member' : 'Edit staff member'}</div>
    <form class="bd stack" id="peopleForm">
      <label class="f">Staff ID (slug)
        <input name="slug" required pattern="[a-z0-9-]{2,60}" value="${esc(editing.person.slug || '')}" ${editing.mode === 'edit' ? 'readonly' : ''}>
      </label>
      <label class="f">Name<input name="name" required maxlength="200" value="${esc(editing.person.name || '')}"></label>
      <label class="f">Title<input name="title" maxlength="200" value="${esc(editing.person.title || '')}"></label>
      <label class="f">BAU email<input name="email" type="email" required value="${esc(editing.person.email || '')}" ${editing.mode === 'edit' ? 'readonly' : ''}></label>
      <label class="f">Role
        <select id="peopleRole" name="role" required>${roleOptions.map(([value, label]) =>
          `<option value="${value}" ${selectedRole === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
      </label>
      <label class="f">Scope
        <select id="peopleScopes" name="scopes" multiple required size="${Math.min(6, Math.max(2, scopeOptions.length))}">
          ${scopeOptions.map(row => `<option value="${esc(row.id)}" data-kind="${row.kind}" ${allowedScopeKinds.has(row.kind) ? '' : 'hidden'} ${selectedScopes.includes(row.id) ? 'selected' : ''}>${esc(row.label)}</option>`).join('')}
        </select>
      </label>
      <p class="note">Use Ctrl or Command to select more than one programme scope. Only BAU email addresses can be invited.</p>
      ${peopleMessage ? `<p class="note">${esc(peopleMessage)}</p>` : ''}
      <div style="display:flex;gap:8px"><button class="btn primary" type="submit">${editing.mode === 'invite' ? 'Send invitation' : 'Save changes'}</button>
        <button class="btn" type="button" data-people-cancel="1">Cancel</button></div>
    </form></div>` : '';
  const sections = Array.from(groups, ([faculty, departments]) =>
    `<section class="sec"><div class="sec-h"><h2>${esc(faculty)}</h2></div>
      ${Array.from(departments, ([department, members]) => `<div class="panel"><div class="hd">${esc(department)}</div>
        <div class="alist">${members.map(person => `<div class="al">
          <span class="body"><span class="t">${esc(fullName(person))}
            ${person.active === false ? '<span class="tag urgent">Deactivated</span>' : ''}
            ${person.verified === false ? '<span class="tag watch">Invite pending</span>' : ''}
            <span class="who-meta">${esc(person.email || '')}<i class="sep-dot" aria-hidden="true"></i>${esc((person.roles || []).map(role => role.role).join(', '))}
              <i class="sep-dot" aria-hidden="true"></i>${esc(personRoleScope(person))}</span></span>
          </span><span class="act" style="display:flex;gap:6px">
            <button class="btn sm" data-person-edit="${esc(person.slug)}">Edit</button>
            ${person.active !== false ? `<button class="btn sm danger" data-person-deactivate="${esc(person.slug)}">Deactivate</button>` : ''}
          </span>
        </div>`).join('')}</div></div>`).join('')}
    </section>`).join('');
  return `<div class="wrap"><div class="page-h"><h1>People</h1>
      <p>Manage staff access within your authorised scope. Invitations go to BAU email addresses.</p></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <input id="peopleSearch" type="search" placeholder="Search name, email, faculty or role" value="${esc(peopleQuery)}" style="max-width:440px">
      <button class="btn primary" data-person-add="1">Invite staff</button>
    </div>
    ${form}
    ${sections || '<p class="note">No people match this search.</p>'}
  </div>`;
}

function openPeopleForm(mode, person) {
  peopleMessage = '';
  peopleForm = {
    mode,
    person: person ? JSON.parse(JSON.stringify(person)) : {
      slug: '', name: '', title: '', email: '', faculty: '', department: '', roles: []
    }
  };
  render();
}

async function savePersonForm(ev) {
  ev.preventDefault();
  const form = ev.target;
  const values = new FormData(form);
  const scopes = Array.from(form.elements.scopes.selectedOptions).map(option => option.value);
  const role = String(values.get('role') || '');
  const firstScope = orgScopeRows().find(row => row.id === scopes[0]);
  const profile = {
    slug: String(values.get('slug') || '').trim().toLowerCase(),
    name: String(values.get('name') || '').trim(),
    title: String(values.get('title') || '').trim(),
    email: String(values.get('email') || '').trim().toLowerCase(),
    faculty: firstScope ? firstScope.faculty : '',
    department: firstScope ? firstScope.department : ''
  };
  const mode = peopleForm.mode;
  const roles = [{ role, scopes }];
  peopleForm = { mode, person: Object.assign({}, profile, { roles }) };
  peopleMessage = '';
  try {
    if (!role || !scopes.length) throw new Error('Choose a role and at least one scope.');
    if (mode === 'invite') await Store.invitePerson(profile, roles);
    else await Store.updatePerson(profile.slug, profile, roles);
    await loadSignedInDirectory();
    peopleForm = null;
    peopleMessage = '';
    toast(mode === 'invite' ? 'Invitation sent.' : 'Staff profile saved.');
    render();
  } catch (error) {
    peopleMessage = error.message || 'The staff profile could not be saved.';
    render();
  }
}

function allStudentCount() {
  if (!state.everyone) return state.students.length;
  return Object.keys(state.everyone).reduce((n, k) => n + state.everyone[k].length, 0);
}

// admin's list is the whole dept, flattened once at sign-in, so views just read it
function departmentList() {
  return (state.me && state.me.admin) ? state.students : everyoneFlat();
}

const advisorNamed = slug => {
  const f = FACULTY.find(x => x.slug === slug);
  return f ? fullName(f) : slug;
};
const hasRole = (person, role) => (person && Array.isArray(person.roles)
  ? person.roles.some(assignment => assignment && assignment.role === role) : false);
const isAdvisorPerson = person => hasRole(person, 'advisor');

// all students in the dept, each tagged with their advisor. The admin's own
// list is empty, so student pages read this
/* every advisor's list. The server answers for the admin; opened as a file the
   lists live in this browser, so read each advisor's saved records here. */
const advisorSlugs = () => FACULTY.filter(isAdvisorPerson).map(f => f.slug);
async function loadEveryone() {
  if (Store.isServer()) return filterEveryone(await Store.allStudents());
  const out = {};
  for (const slug of advisorSlugs()) {
    const list = await Store.loadStudents(slug, []);
    if (list.length) out[slug] = list;
  }
  return filterEveryone(out);
}
function everyoneFlat() {
  if (!state.everyone) return [];
  const out = [];
  Object.keys(state.everyone).forEach(slug => {
    state.everyone[slug].forEach(s => out.push(Object.assign({}, s, { advisorSlug: slug })));
  });
  return out;
}

/* Clear several advisors' records at once. Advisors marked keepOnBulkClear in
   faculty.json start unticked; nothing is cleared until "Yes, clear". */
let bulkClear = null;   // null = closed, else { picked: Set, confirm: bool, busy: bool }
const keepByDefault = () => FACULTY.filter(f => f.keepOnBulkClear).map(f => f.slug);
function bulkClearPanel(slugs) {
  if (!bulkClear) return `<div class="panel"><div class="bd"><button class="btn sm" data-bulk-open="1">Clear several advisors' records</button></div></div>`;
  const n = slugs.filter(sl => bulkClear.picked.has(sl)).reduce((a, sl) => a + (state.everyone[sl] || []).length, 0);
  const k = slugs.filter(sl => bulkClear.picked.has(sl)).length;
  return `<div class="panel"><div class="hd">Clear advisors' records</div><div class="bd stack">
    <div class="bulk-list">${slugs.map(sl => `<label class="chk-row"><input type="checkbox" data-bulk-pick="${esc(sl)}" ${bulkClear.picked.has(sl) ? 'checked' : ''}>
      <span>${esc(advisorSlugs().includes(sl) ? advisorNamed(sl) : advisorNamed(sl) + ' (admin list)')}</span><b>${(state.everyone[sl] || []).length}</b></label>`).join('')}</div>
    ${bulkClear.confirm ? `<div class="chk warn"><span class="ic">!</span><span class="tx"><p><b>Clear ${n} records from ${k} advisor${k === 1 ? '' : 's'}?</b> Notes and meetings on those records go too. Then import the transcripts first, then the schedules.</p>
        <div style="display:flex;gap:8px;margin-top:8px"><button class="btn sm danger" data-bulk-go="1" ${bulkClear.busy ? 'disabled' : ''}>${bulkClear.busy ? 'Clearing' : 'Yes, clear'}</button>
        <button class="btn sm ghost" data-bulk-cancel="1">Cancel</button></div></span></div>`
      : `<div style="display:flex;gap:8px"><button class="btn sm primary" data-bulk-ask="1" ${k ? '' : 'disabled'}>Clear ${k} advisor${k === 1 ? '' : 's'}</button>
        <button class="btn sm ghost" data-bulk-cancel="1">Cancel</button></div>`}
  </div></div>`;
}
async function bulkClearClick(t) {
  if (!state.me || !state.me.admin) return false;
  if (t.closest('[data-bulk-open]')) { bulkClear = { picked: new Set(Object.keys(state.everyone || {}).filter(sl => !keepByDefault().includes(sl))), confirm: false, busy: false }; render(); return true; }
  if (!bulkClear) return false;
  const pick = t.closest('[data-bulk-pick]');
  if (pick) { const sl = pick.dataset.bulkPick; if (pick.checked) bulkClear.picked.add(sl); else bulkClear.picked.delete(sl); bulkClear.confirm = false; render(); return true; }
  if (t.closest('[data-bulk-cancel]')) { bulkClear = null; render(); return true; }
  if (t.closest('[data-bulk-ask]')) { bulkClear.confirm = true; render(); return true; }
  if (t.closest('[data-bulk-go]') && !bulkClear.busy) {
    bulkClear.busy = true; render();
    let total = 0, done = 0;
    try {
      for (const sl of Array.from(bulkClear.picked)) { total += await Store.clearStudents(sl); done++; }
      toast('Cleared ' + total + ' records from ' + done + ' advisors.');
    } catch (e) { toast((e && e.message) || 'Some records could not be cleared.'); }
    state.everyone = await loadEveryone(); state.students = everyoneFlat(); state.everyoneErr = '';
    bulkClear = null; flush(); render();
    return true;
  }
  return false;
}

/* Forgotten passwords without a mail server: the admin makes the same
   single-use, 30-minute link the reset email would carry and sends it from
   their own mailbox (or WhatsApp). The link is shown once and never stored. */
let pwReset = { slug: '', link: '', busy: false, err: '', clearAsk: false };
function resetLinkPanel() {
  const opts = FACULTY.filter(isAdvisorPerson);
  const f = FACULTY.find(x => x.slug === pwReset.slug);
  const mail = f && pwReset.link ? 'mailto:' + encodeURIComponent(f.email || '') + '?subject=' + encodeURIComponent('Reset your Online Advising System password')
    + '&body=' + encodeURIComponent('Dear Dr. ' + (f.short || f.name) + ',\n\nOpen this link within 30 minutes and choose a new password. It works once:\n' + pwReset.link + '\n\n' + progDeptLine()) : '';
  return `<div class="panel"><div class="hd">Forgotten password</div><div class="bd stack">
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <label class="f" for="pwFor" style="max-width:300px;flex:1">Advisor
        <select id="pwFor"><option value="">Choose</option>${opts.map(o => `<option value="${esc(o.slug)}" ${o.slug === pwReset.slug ? 'selected' : ''}>${esc(advisorNamed(o.slug))}</option>`).join('')}</select></label>
      <button class="btn sm primary" data-pw-link="1" ${pwReset.slug && !pwReset.busy ? '' : 'disabled'}>${pwReset.busy ? 'Making' : 'Make a reset link'}</button>
      <button class="btn sm" data-pw-clear="ask" ${pwReset.slug && !pwReset.busy ? '' : 'disabled'}>Clear password</button>
    </div>
    ${pwReset.clearAsk && f ? `<div class="stack" style="gap:8px"><p class="note">Clear ${esc(advisorNamed(f.slug))}'s password? They create their account again and activate it from the email. Their students and notes stay.</p>
      <div style="display:flex;gap:8px"><button class="btn sm danger" data-pw-clear="go">Yes, clear it</button><button class="btn sm" data-pw-clear="no">Cancel</button></div></div>` : ''}
    ${pwReset.err ? `<p class="note" style="color:var(--urgent)">${esc(pwReset.err)}</p>` : ''}
    ${pwReset.link ? `<input class="mono" readonly value="${esc(pwReset.link)}" style="width:100%">
      <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn sm primary" href="${esc(mail)}">Email it to ${esc(f.email || 'the advisor')}</a>
        <button class="btn sm" data-pw-copy="1">Copy link</button></div>
      <p class="note">Works once, for 30 minutes.</p>` : ''}
  </div></div>`;
}

function viewEveryone() {
  if (state.everyoneErr) {
    return `<div class="wrap"><div class="page-h"><h1>Everyone</h1></div>
      <div class="panel"><p class="empty">${esc(state.everyoneErr)}</p></div></div>`;
  }
  if (!state.everyone) {
    return `<div class="wrap"><div class="page-h"><h1>Everyone</h1><p>Gathering the department's lists.</p></div>
      <div class="panel"><div class="bd"><div class="shimmer"></div><div class="shimmer"></div><div class="shimmer"></div></div></div></div>`;
  }
  const slugs = Object.keys(state.everyone).sort((a, b) => advisorNamed(a).localeCompare(advisorNamed(b)));
  const q = state.q.trim().toLowerCase();
  let list = departmentList();
  if (state.advisorFilter !== 'all') list = list.filter(s => s.advisorSlug === state.advisorFilter);
  if (q) list = list.filter(s => (s.name + ' ' + s.id + ' ' + (s.email || '')).toLowerCase().includes(q));
  if (state.filter === 'critical') list = list.filter(isCritical);
  else if (state.filter === 'unregistered') list = list.filter(s => !s.registration);
  else if (state.filter === 'review') list = list.filter(s => look(s).level !== 'ok');
  else if (state.filter === 'ok') list = list.filter(s => look(s).level === 'ok');
  list.sort((a, b) => {
    const r = { urgent: 0, watch: 1, ok: 2 };
    return (isCritical(b) - isCritical(a)) || r[look(a).level] - r[look(b).level] || a.name.localeCompare(b.name);
  });

  const tally = { urgent: 0, watch: 0, ok: 0 };
  departmentList().forEach(s => { tally[look(s).level]++; });
  const seg = [['all', 'All'], ['critical', 'Critical'], ['review', 'Needs review'], ['ok', 'On track'], ['unregistered', 'Not registered']];
  const pickedAdvisor = state.advisorFilter !== 'all' ? state.advisorFilter : null;
  const pickedCount = pickedAdvisor && state.everyone[pickedAdvisor] ? state.everyone[pickedAdvisor].length : 0;

  return `<div class="wrap">
    <div class="page-h"><h1>Everyone</h1>
      <p>${allStudentCount()} students · ${tally.urgent} urgent · ${tally.watch} to plan · ${tally.ok} on track</p></div>

    ${(() => {
      const crit = departmentList().filter(isCritical);
      if (!crit.length) return '';
      return `<div class="sec crit-sec">
        <div class="sec-h"><h2>Critical across the department</h2><span class="c crit">${crit.length}</span></div>
        <div class="panel crit-panel"><div class="alist">
          ${crit.map(st => `<button class="al urgent rv crit-row" data-open="${esc(st.id)}">
            <span class="stripe"></span>
            <span class="body"><span class="t">${esc(displayName(st))}
              <span class="who-meta">${esc(advisorNamed(st.advisorSlug))}<i class="sep-dot" aria-hidden="true"></i>marked ${esc(whenWord(st.critical.at))}</span></span>
              <span class="rlist"><span class="r">${esc(st.critical.reason || 'No reason written')}</span></span>
            </span><span class="go">&rsaquo;</span></button>`).join('')}
        </div></div></div>`;
    })()}
    <div class="advisor-strip">
      <button class="chip ${state.advisorFilter === 'all' ? 'on' : ''}" data-advisor="all">
        <span>Whole department</span><b>${allStudentCount()}</b></button>
      ${slugs.map(slug => {
        const f = FACULTY.find(x => x.slug === slug);
        const n = state.everyone[slug].length;
        const needs = state.everyone[slug].filter(s => look(s).level !== 'ok').length;
        return `<button class="chip ${state.advisorFilter === slug ? 'on' : ''}" data-advisor="${esc(slug)}">
          ${f ? faceOf(f, 'tiny') : ''}<span>${esc(advisorNamed(slug))}</span>
          <b>${n}</b>${needs ? `<i class="warn">${needs}</i>` : ''}</button>`;
      }).join('')}
    </div>

    ${!pickedAdvisor ? bulkClearPanel(slugs) : ''}
    ${resetLinkPanel()}
    ${pickedAdvisor ? `<div class="panel"><div class="bd stack">
      ${adminClearSlug === pickedAdvisor ? `
        <h3>Clear ${esc(advisorNamed(pickedAdvisor))}'s imported records?</h3>
        <p class="note">Deletes ${pickedCount} student records, schedules and advisor notes. The account, other advisors and course offering stay unchanged.</p>
        <div class="theme-pick">
          <button class="btn" data-admin-clear-cancel="1">Cancel</button>
          <button class="btn danger" data-admin-clear-go="${esc(pickedAdvisor)}">Yes, clear these records</button>
        </div>` : `
        <h3>${esc(advisorNamed(pickedAdvisor))}'s imported data</h3>
        <p class="note">For a clean re-import. This removes notes, holds, meetings and review state; they cannot be restored from the PDFs.</p>
        <button class="btn" data-admin-clear-ask="${esc(pickedAdvisor)}" style="align-self:flex-start">Clear this advisor's imported records</button>`}
    </div></div>` : ''}

    <div class="filters">
      <div class="search"><input id="q" placeholder="Search the whole department by name or ID" value="${esc(state.q)}" autocomplete="off"></div>
      <div class="seg">${seg.map(([k, l]) => `<button data-filter="${k}" aria-pressed="${state.filter === k}">${l}</button>`).join('')}</div>
    </div>

    <div class="panel"><div class="slist">
      ${list.length ? list.map(s => {
        const { snap, level } = look(s);
        return `<button class="srow" data-open="${esc(s.id)}">
          <span class="lvl ${level}"></span>
          <span class="av" style="${avatar(s.name)}">${initials(s.name)}</span>
          <span>
            <span class="nm">${esc(displayName(s))} ${levelTag(s, level)}${isCritical(s) ? '<span class="tag crit">Critical</span>' : ''}</span>
            <span class="sub"><span class="mono">${esc(s.id)}</span>
              <span>${esc(advisorNamed(s.advisorSlug))}</span>
              ${s.noTranscript ? '' : '<span>sem ' + (snap.completedSemesters + 1) + '</span>'}</span>
          </span>
          <span class="num hide-s">${s.officialCgpa != null ? s.officialCgpa.toFixed(2) : '&mdash;'}<small>CGPA</small></span>
          <span class="num" title="${studied(s).transfer ? 'and ' + studied(s).transfer + ' credits of freshman equivalency' : ''}${
            studied(s).transfer ? '. ' : ''}${snap.earned} of ${C.totalCredits} toward the degree">${studied(s).credits}<small>credits</small></span>
        </button>`;
      }).join('') : noMatch()}
    </div></div>
  </div>`;
}


// "3 minutes ago" for recent stuff, a date for older
function whenWord(at) {
  if (!at) return '';
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' minute' + (mins === 1 ? '' : 's') + ' ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + ' hour' + (hrs === 1 ? '' : 's') + ' ago';
  const days = Math.round(hrs / 24);
  if (days < 7) return days + ' day' + (days === 1 ? '' : 's') + ' ago';
  return new Date(at).toLocaleDateString();
}

// ---- Master's in CS -------------------------------------------------------
/* different degree, different arithmetic. From the program page:
   https://www.bau.edu.lb/Program/Science/Master/Computer-Science
   36 credits: 18 core + 12 dept electives + 6 thesis. CGPA >= 2.33, min two
   years. No undergrad rules, so this replaces them on the page.
   Thesis is CMPS690: registered in sem 3, continues into sem 4 at 0 credits. */
const MASTERS = {
  source: 'https://www.bau.edu.lb/Program/Science/Master/Computer-Science',
  total: 36, coursework: 30, coreCredits: 18, electiveCredits: 12, thesisCredits: 6,
  minCgpa: 2.33, minYears: 2, thesis: 'CMPS690',
  core: ['CMPS641', 'CMPS658', 'GREM600', 'CMPS642', 'CMPS648', 'CMPS682'],
  electives: ['CMPS643', 'CMPS644', 'CMPS646', 'CMPS647', 'CMPS650', 'CMPS651', 'CMPS652',
              'CMPS653', 'CMPS654', 'CMPS655', 'CMPS656', 'CMPS657', 'CMPS659', 'CMPS660',
              'CMPS661', 'CMPS662', 'CMPS663', 'CMPS664', 'CMPS665'],
  semesters: [
    ['First', ['CMPS641', 'CMPS658', 'GREM600'], 'and 6 credits of departmental electives'],
    ['Second', ['CMPS642', 'CMPS648', 'CMPS682'], 'and 6 credits of departmental electives'],
    ['Third', ['CMPS690'], 'thesis, 6 credits'],
    ['Fourth', ['CMPS690'], 'thesis continued, no further credits']
  ]
};

// master's progress vs the 36 credits. Graduate courses only, bachelor's ones don't count
function mastersProgress(s) {
  const done = {};
  (s.history || []).forEach(h => {
    if (!isMastersCode(h.code) || !E.isPassing(R, h.grade)) return;
    done[h.code] = Math.max(done[h.code] || 0, Number(h.cr) || 3);
  });
  const now = ((s.registration || {}).courses || []).filter(c => isMastersCode(c.code));
  const sum = codes => codes.reduce((n, c) => n + (done[c] || 0), 0);
  const core = sum(MASTERS.core);
  const elective = Math.min(sum(MASTERS.electives), MASTERS.electiveCredits);
  const thesis = done[MASTERS.thesis] || 0;
  return { core, elective, thesis, total: core + elective + thesis, now,
           cgpa: s.officialCgpa != null ? s.officialCgpa : null };
}

function mastersPanel(s) {
  const p = mastersProgress(s);
  const bar = (label, got, of) => `<div class="ms-row"><span>${label}</span>
    <span class="ms-bar"><i style="width:${of ? Math.min(100, Math.round(got / of * 100)) : 0}%"></i></span>
    <b>${got}<small> / ${of}</small></b></div>`;
  const short = MASTERS.minCgpa - (p.cgpa == null ? MASTERS.minCgpa : p.cgpa);
  return `<div class="panel"><div class="hd">The Master's, against the programme</div><div class="bd">
    ${bar('Core courses', p.core, MASTERS.coreCredits)}
    ${bar('Departmental electives', p.elective, MASTERS.electiveCredits)}
    ${bar('Thesis', p.thesis, MASTERS.thesisCredits)}
    ${bar('In all', p.total, MASTERS.total)}
    <p class="note">${p.cgpa != null
      ? (p.cgpa >= MASTERS.minCgpa
          ? 'CGPA ' + p.cgpa.toFixed(2) + ', above the 2.33 the degree needs.'
          : 'CGPA ' + p.cgpa.toFixed(2) + ', which is ' + short.toFixed(2) + ' below the 2.33 the degree needs.')
      : 'No CGPA on the transcript yet.'}
      ${p.now.length ? ' This term: ' + p.now.map(c => esc(c.code)).join(', ') + '.' : ''}</p>
  </div></div>`;
}

// ---- freshman year --------------------------------------------------------
/* The university-wide freshman year has its own rules, so these records are
   shown without degree checks. The page only appears for advisors who have
   freshman students. */
function viewFreshmen() {
  const all = state.students.filter(s => groupOf(s) === 'freshman');
  const q = state.q.trim().toLowerCase();
  let list = q ? all.filter(s => (s.name + ' ' + s.id + ' ' + (s.email || '')).toLowerCase().includes(q)) : all.slice();
  if (state.filter === 'unregistered') list = list.filter(s => !s.registration);
  else if (state.filter === 'new') list = list.filter(s => s.noTranscript);
  list.sort((a, b) => a.name.localeCompare(b.name));
  const unreg = all.filter(s => !s.registration).length;
  const fresh = all.filter(s => s.noTranscript).length;
  const seg = [['all', 'All'], ['unregistered', 'Not registered'], ['new', 'New this term']];

  return `<div class="wrap">
    <div class="page-h"><h1>Freshmen</h1>
      <p>${all.length} students in the freshman year${unreg ? ', ' + unreg + ' with no schedule yet' : ''}.</p></div>

    <div class="panel quiet-note"><div class="bd"><div>
      <b>Separate rules</b><p class="note">The freshman year has its own rules. Computer Science degree checks do not apply.</p>
    </div></div></div>

    <div class="filters">
      <div class="search"><input id="q" placeholder="Search freshmen by name or ID" value="${esc(state.q)}" autocomplete="off"></div>
      <div class="seg">${seg.map(([k, l]) => `<button data-filter="${k}" aria-pressed="${state.filter === k}">${l}${
        k === 'new' && fresh ? ' (' + fresh + ')' : ''}</button>`).join('')}</div>
    </div>

    <div class="panel"><div class="slist">
      ${list.length ? list.map(s => {
        const snap = look(s).snap;
        const reg = (s.registration || {}).courses || [];
        return `<button class="srow" data-open="${esc(s.id)}">
          <span class="lvl ok"></span>
          <span class="av" style="${avatar(s.name)}">${initials(s.name)}</span>
          <span>
            <span class="nm">${esc(s.name)}${s.noTranscript ? '<span class="tag">New</span>' : ''}</span>
            <span class="sub"><span class="mono">${esc(s.id)}</span>
              <span>${reg.length ? reg.length + ' course' + (reg.length === 1 ? '' : 's') + ' this term' : 'no schedule'}</span>
              ${s.transcriptEmpty ? '<span>transcript came through empty</span>' : ''}</span>
          </span>
          <span class="num hide-s">${s.officialCgpa != null ? s.officialCgpa.toFixed(2) : '&mdash;'}<small>CGPA</small></span>
          <span class="num">${s.officialCredits != null ? studied(s).credits : '&mdash;'}<small>credits</small></span>
        </button>`;
      }).join('') : noMatch()}
    </div></div>
  </div>`;
}

// ---- waiting on a decision ------------------------------------------------
/* all the same question, "still your student?": looks graduated, on another
   programme, or new with no clear year. Nothing happens automatically, a
   person decides each one. */
function decisionCard(s) {
  const ev = graduateEvidence(s);
  const g = groupOf(s);
  const scheduled = ((s.registration || {}).courses || []).length;
  // name styled as the record title
  const kind = ev ? 'graduated' : g;
  const title = ev ? 'Looks to have graduated'
    : g === 'masters' ? "On the Master's"
    : g === 'other' ? 'On another programme'
    : 'Not sorted yet';
  const why = ev || s.groupReason || '';
  const acts = ev
    ? `<button class="btn sm primary" data-decide="graduated:${esc(s.id)}">Keep as graduated</button>
       <button class="btn sm" data-decide="studying:${esc(s.id)}">Still studying</button>`
    : g === 'unsorted'
      ? `<button class="btn sm primary" data-decide="cs:${esc(s.id)}">Move to my CS list</button>
         <button class="btn sm" data-decide="freshman:${esc(s.id)}">Move to Freshmen</button>`
      : `<button class="btn sm primary" data-decide="kept:${esc(s.id)}">Keep on my list</button>`;
  return `<div class="req decide ${kind}">
    <div class="req-h">
      <span class="req-t">${title}</span>
      <button class="req-about" data-open="${esc(s.id)}">${esc(s.name)} <span class="mono">${esc(s.id)}</span></button>
      <span class="req-who">${s.officialCredits != null ? studied(s).credits + ' credits' : 'no transcript'}${scheduled
        ? '<i class="sep-dot" aria-hidden="true"></i>' + scheduled + ' course' + (scheduled === 1 ? '' : 's') + ' this term'
        : ''}</span>
    </div>
    ${why ? `<p class="req-text">${esc(why)}</p>` : ''}
    ${state.me.admin ? '' : `<div class="req-act"><div class="row">${acts}</div></div>`}
  </div>`;
}

function viewDecide() {
  const waiting = state.students.filter(needsDecision);
  const settled = state.students.filter(s => decisionOf(s) === 'graduated' || decisionOf(s) === 'kept');
  const byKind = k => waiting.filter(s => k === 'graduated' ? graduateEvidence(s) : (!graduateEvidence(s) && groupOf(s) === k));
  const groups = [
    ['graduated', 'Looks to have graduated'],
    ['masters', "On the Master's"],
    ['other', 'On another programme'],
    ['unsorted', 'Not sorted yet']
  ];
  return `<div class="wrap">
    <div class="page-h"><h1>To decide</h1>
      <p>${waiting.length ? waiting.length + ' waiting' : 'Nothing waiting.'}</p></div>

    ${groups.map(([k, title]) => {
      const list = byKind(k);
      if (!list.length) return '';
      return `<div class="sec"><div class="sec-h"><h2>${title}</h2><span class="c">${list.length}</span></div>
        <div class="reqs">${list.map(decisionCard).join('')}</div></div>`;
    }).join('')}

    ${settled.length ? `<details class="sec done-sec">
      <summary class="sec-h"><h2>Decided</h2><span class="c">${settled.length}</span></summary>
      <div class="panel"><div class="slist">
        ${settled.map(s => `<button class="srow" data-open="${esc(s.id)}">
          <span class="lvl ok"></span>
          <span class="av" style="${avatar(s.name)}">${initials(s.name)}</span>
          <span><span class="nm">${esc(s.name)}
            <span class="tag">${decisionOf(s) === 'graduated' ? 'Graduated' : esc(GROUP_WORD[groupOf(s)] || 'Kept')}</span></span>
            <span class="sub"><span class="mono">${esc(s.id)}</span>
              <span>${s.officialCredits != null ? studied(s).credits + ' credits' : 'no transcript'}</span></span></span>
          ${state.me.admin ? '' : `<span class="num hide-s"><span class="linkish" data-decide="undo:${esc(s.id)}">Change</span></span>`}
        </button>`).join('')}
      </div></div></details>` : ''}
  </div>`;
}



// say odd things about the record on the page instead of leaving weird numbers
function recordNotes(s) {
  const bits = [];
  if (s.transcriptEmpty) {
    bits.push('The transcript had no courses on it. Ask for a fresh copy.');
  }
  if (s.creditsNote) {
    bits.push('Printed credits: ' + s.creditsNote.printed + '; listed courses: ' + s.creditsNote.listed + '. The portal shows the printed total.');
  }
  if (s.noTranscript) {
    bits.push('Schedule imported; no transcript yet.');
  }
  if (!bits.length) return '';
  return `<div class="scope-banner note-banner"><div>
    <b>About this record</b>${bits.map(b => `<p>${esc(b)}</p>`).join('')}</div></div>`;
}

// explains why the page flags nothing for out-of-scope students
function scopeBanner(s) {
  if (!s || !offProgramme(s)) return '';
  const g = groupOf(s);
  // name styled as the record title
  const ev = graduateEvidence(s);
  const line = g === 'freshman'
    ? 'Freshman rules apply; Computer Science checks are off.'
    : g === 'masters' ? "On the Master's programme, so the undergraduate rules do not apply."
    : g === 'other' ? (s.groupReason || 'Another programme.') + ' CS checks are off.'
    : g === 'unsorted' ? (s.groupReason || 'Not sorted yet.') + ' Place the student to enable checks.'
    : 'Reads as graduated: ' + (ev || 'degree complete') + '.';
  const fix = state.me.admin ? '' : (needsDecision(s)
    ? `<button class="btn sm" data-view="decide">Decide</button>`
    : (decisionOf(s) ? `<button class="btn sm" data-decide="undo:${esc(s.id)}">Change</button>` : ''));
  return `<div class="scope-banner">
    <div><b>${esc(isGraduated(s) && g === 'cs' ? 'Graduated' : (GROUP_WORD[g] || 'Off the degree'))}</b>
      <p>${esc(line)}</p>
    </div>
    ${fix ? `<div class="no-print">${fix}</div>` : ''}
  </div>`;
}

function mdLite(t) {
  let h = esc(t);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  h = h.replace(/\[\[(\d{6,12})\|([^\]]+)\]\]/g, '<button class="slink" data-open="$1">$2</button>');
  h = h.replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,])/gm, '$1<i class="how">$2</i>');
  h = h.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/^- (.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>');
  return h.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
}

// chat grows down the page, so the page scrolls (not an inner box)
function scrollChat() {
  const v = $('#view');
  if (v) v.scrollTop = v.scrollHeight;
}

async function ask(text) {
  if (!text.trim()) return;
  state.chat.push({ role: 'you', text });
  let answer;
  try { answer = ASKME.answer(text) || answerFor(text); }
  catch (e) { answer = 'Something went wrong working that out. Try asking it another way.'; }
  state.chat.push({ role: 'bot', text: answer });
  render();
  scrollChat();

}

// ---- events ---------------------------------------------------------------
async function onClick(e) {
  const t = e.target;
  if (t.closest('[data-lang-toggle]')) { setLang(LANG === 'ar' ? 'en' : 'ar'); return; }
  if (state.me && state.view === 'rules' && await rulesClick(t)) return;
  if (state.me && (state.view === 'structure' || state.view === 'programme') && await structureClick(t)) return;
  if (state.me && state.view === 'student' && await exceptionsClick(t)) return;
  if (t.closest('[data-person-add]')) { openPeopleForm('invite'); return; }
  const personEdit = t.closest('[data-person-edit]');
  if (personEdit) {
    const person = state.people.find(member => member.slug === personEdit.dataset.personEdit);
    if (person) openPeopleForm('edit', person);
    return;
  }
  if (t.closest('[data-people-cancel]')) { peopleForm = null; peopleMessage = ''; render(); return; }
  const personDeactivate = t.closest('[data-person-deactivate]');
  if (personDeactivate) {
    const person = state.people.find(member => member.slug === personDeactivate.dataset.personDeactivate);
    if (!person || !window.confirm('Deactivate ' + fullName(person) + '? Their student records will be kept.')) return;
    await Store.deactivatePerson(person.slug);
    await loadSignedInDirectory();
    toast('Staff account deactivated. Student records were kept.');
    render();
    return;
  }
  if (t.closest('[data-back]')) {
    if (gateStep === 'verify') { verifyToken = ''; history.replaceState(null, '', location.pathname); }
    gateStep = 'pick'; drawGate(); return;
  }
  if (t.closest('[data-account]')) { drawAccount(''); return; }
  if (t.closest('[data-clear-search]')) { state.q = ''; state.filter = 'all'; render(); const q = $('#q'); if (q) q.focus(); return; }
  const actPage = t.closest('[data-act-page]');
  if (actPage) { activity.page = Math.max(0, Number(actPage.dataset.actPage) || 0); activity.data = null; loadActivity(); render(); return; }
  if (t.closest('[data-act-filter]')) {
    activity.action = $('#actAction').value; activity.actor = $('#actActor').value; activity.page = 0;
    activity.data = null; loadActivity(); render(); return;
  }
  if (t.closest('[data-backup-download]')) {
    try {
      const got = await Store.downloadBackup();
      const url = URL.createObjectURL(new Blob([got.file], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = got.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Backup downloaded. Keep it somewhere other than the server.');
      activity.backup = await Store.backupStatus(); render();
    } catch (e) { toast(e.message); }
    return;
  }
  const sessEnd = t.closest('[data-sess-end]');
  if (sessEnd) {
    try {
      const n = await Store.endSessions(sessEnd.dataset.sessEnd);
      toast(n === 1 ? 'Signed out of 1 other session' : 'Signed out of ' + n + ' other sessions');
    } catch (e) { toast(e.message); }
    drawSessions();
    return;
  }
  if (t.closest('[data-reset]')) {
    resetEmail = ($('#fEmail') && $('#fEmail').value.trim()) || '';
    gateStep = 'reset'; drawGate(); return;
  }
  if (t.id === 'signOut') { await signOut(); return; }
  if (t.closest('#themeBtn')) {
    setTheme(themeShown() === 'dark' ? 'light' : 'dark');
    return;
  }
  const sp = t.closest('[data-sound-pick]');
  if (sp) {
    try { localStorage.setItem(SOUND_KEY, sp.dataset.soundPick); } catch (e) { /* not kept */ }
    document.querySelectorAll('[data-sound-pick]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.soundPick === sp.dataset.soundPick)));
    if (sp.dataset.soundPick === 'on') chime('new');
    return;
  }
  const tp = t.closest('[data-theme-pick]');
  if (tp) {
    setTheme(tp.dataset.themePick);
    document.querySelectorAll('[data-theme-pick]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.themePick === tp.dataset.themePick)));
    return;
  }

  const pt = t.closest('[data-plan-term]');
  if (pt) { state.planTerm = pt.dataset.planTerm; basket = {}; render(); return; }
  if (t.closest('#bellBtn')) { bellOpen = !bellOpen; drawBell(); return; }
  if (bellOpen && !t.closest('.bell-pop')) { bellOpen = false; drawBell(); }
  if (t.closest('[data-goback]')) { goBack(); return; }
  if (t.closest('[data-pw-link]') && state.me.admin && pwReset.slug) {
    pwReset.busy = true; pwReset.err = ''; pwReset.link = ''; render();
    try { pwReset.link = (await Store.adminResetLink(pwReset.slug)).link; }
    catch (err) { pwReset.err = (err && err.message) || 'Could not make the link.'; }
    pwReset.busy = false; render(); return;
  }
  const pc = t.closest('[data-pw-clear]');
  if (pc && state.me.admin && pwReset.slug) {
    const what = pc.dataset.pwClear;
    if (what === 'ask') { pwReset.clearAsk = true; pwReset.link = ''; pwReset.err = ''; render(); return; }
    if (what === 'no') { pwReset.clearAsk = false; render(); return; }
    pwReset.busy = true; render();
    try {
      await Store.adminClearPassword(pwReset.slug);
      toast('Password cleared. ' + advisorNamed(pwReset.slug) + ' can create the account again.');
      pwReset = { slug: '', link: '', busy: false, err: '', clearAsk: false };
    } catch (err) { pwReset.busy = false; pwReset.clearAsk = false; pwReset.err = (err && err.message) || 'Could not clear it.'; }
    render(); return;
  }
  if (t.closest('[data-pw-copy]') && pwReset.link) {
    try { await navigator.clipboard.writeText(pwReset.link); toast('Link copied'); } catch (err) { toast('Select the link and copy it'); }
    return;
  }
  if (t.closest('[data-bulk-open],[data-bulk-pick],[data-bulk-cancel],[data-bulk-ask],[data-bulk-go]') && await bulkClearClick(t)) return;
  const nf = t.closest('[data-notice]');
  if (nf) { bellOpen = false; noticeFocus = nf.dataset.notice || null; state.view = 'notices'; render(); window.scrollTo(0, 0); return; }
  const nudge = t.closest('[data-nudge]');
  if (nudge) {
    bellOpen = false;
    const [v, f] = nudge.dataset.nudge.split(':');
    if (f) state.filter = f;
    state.view = v || 'today';
    render();
    return;
  }
  const view = t.closest('[data-view]');
  if (view) {
    state.view = view.dataset.view;
    if (state.view === 'notices') noticeFocus = null;
    // leaving a student clears the selection, leaving a list clears the search (so the next list isn't pre-filtered)
    if (state.view === 'students' || state.view === 'everyone' || state.view === 'freshmen') state.sel = null;
    if (state.view === 'freshmen' || state.view === 'students') state.filter = 'all';
    if (state.view !== 'student') { const b = $('#q'); if (b) state.q = b.value; }
    render();
    return;
  }
  const open = t.closest('[data-open]');
  if (open) { state.sel = open.dataset.open; state.view = 'student'; state.tab = 'progress'; state.planTerm = state.nextTerm; basket = {}; planLoadedFor = ''; chainFocus = null; render(); return; }
  const tab = t.closest('[data-tab]');
  if (tab) { state.tab = tab.dataset.tab; render(); return; }
  const ex = t.closest('[data-export]');
  if (ex) { exportMine(ex.dataset.export); return; }
  if (t.closest('[data-undo-import]')) { await undoImport(); return; }
  const cAsk = t.closest('[data-clear-ask]');
  if (cAsk) { importState.confirm = cAsk.dataset.clearAsk; importState.confirmAt = Date.now(); render(); return; }
  if (t.closest('[data-clear-cancel]')) { importState.confirm = null; render(); return; }
  const cGo = t.closest('[data-clear-go]');
  if (cGo) {
    /* Only a deliberate second click clears: the question has to be on
       screen first, and a double-click on "Clear everything" (whose second
       click lands on the new button) is ignored. */
    if (!importState.confirm || cGo.dataset.clearGo !== importState.confirm || Date.now() - (importState.confirmAt || 0) < 900) return;
    importState.confirm = null;
    cGo.disabled = true; cGo.textContent = 'Clearing';
    await clearImported(cGo.dataset.clearGo); return;
  }
  const ik = t.closest('[data-idea-kind]');
  if (ik) { ideaKind = ik.dataset.ideaKind; render(); return; }
  if (t.closest('[data-idea-save]')) {
    const text = $('#ideaText').value.trim();
    if (!text) { toast('Write something first'); return; }
    let r;
    try { r = await Store.postIdea(ideaKind, text, state.me.name); }
    catch (e) { toast(e.message || 'That did not send'); return; }
    state.ideas = await Store.loadIdeas();
    render();
    toast(r.emailed ? 'Sent to the portal team and posted on the board' : 'Posted on the board');
    return;
  }
  const iv = t.closest('[data-idea-vote]');
  if (iv) {
    const it = state.ideas.find(x => x.id === iv.dataset.ideaVote);
    if (!it) return;
    it.votes = it.votes || [];
    const i = it.votes.indexOf(state.me.name);
    if (i >= 0) it.votes.splice(i, 1); else it.votes.push(state.me.name);
    await Store.saveIdea(it);
    state.ideas = await Store.loadIdeas();
    render();
    return;
  }
  const ir = t.closest('[data-idea-remove]');
  if (ir) {
    await Store.removeIdea(ir.dataset.ideaRemove);
    state.ideas = await Store.loadIdeas();
    render();
    toast('Removed');
    return;
  }
  const pl = t.closest('[data-print-list]');
  if (pl) {
    const which = pl.dataset.printList;
    const list = which === 'marked'
      ? markedPending()
      : advisees().filter(x => look(x).level !== 'ok');
    if (!list.length) { toast('Nothing to print yet'); return; }
    printDocument(reviewListDocument(list, which === 'marked' ? 'Students marked for review' : 'Students needing review'));
    return;
  }
  const filt = t.closest('[data-filter]');
  if (filt) {
    state.filter = filt.dataset.filter;
    // Freshmen and Everyone have their own filters: stay on those pages
    if (state.view !== 'freshmen' && state.view !== 'everyone') {
      state.view = state.me.admin ? 'everyone' : 'students';
    }
    render(); return;
  }
  const adv = t.closest('[data-advisor]');
  if (adv) {
    state.advisorFilter = adv.dataset.advisor;
    adminClearSlug = null;
    state.view = 'everyone'; render(); return;
  }
  const adminClearAsk = t.closest('[data-admin-clear-ask]');
  if (adminClearAsk) {
    const slug = adminClearAsk.dataset.adminClearAsk;
    if (!state.me.admin || !state.everyone || !Object.prototype.hasOwnProperty.call(state.everyone, slug)) return;
    adminClearSlug = slug; adminClearAt = Date.now();
    render(); return;
  }
  if (t.closest('[data-admin-clear-cancel]')) { adminClearSlug = null; render(); return; }
  const adminClearGo = t.closest('[data-admin-clear-go]');
  if (adminClearGo) {
    const slug = adminClearGo.dataset.adminClearGo;
    if (Date.now() - adminClearAt < 900) return;   // a double-click on "Clear..." doesn't count as yes
    if (!state.me.admin || slug !== adminClearSlug || slug !== state.advisorFilter
        || !state.everyone || !Object.prototype.hasOwnProperty.call(state.everyone, slug)) return;
    adminClearGo.disabled = true;
    adminClearGo.textContent = 'Clearing';
    try {
      const n = await Store.clearStudents(slug);
      state.everyone = await loadEveryone();
      state.students = everyoneFlat();
      state.everyoneErr = '';
      adminClearSlug = null;
      flush(); render();
      toast(n ? 'Cleared ' + n + ' records for ' + advisorNamed(slug) + '.' : 'There were no imported records to clear.');
    } catch (e) {
      adminClearGo.disabled = false;
      adminClearGo.textContent = 'Yes, clear these records';
      toast((e && e.message) || 'Those records could not be cleared.');
    }
    return;
  }

  const mail = t.closest('[data-email]');
  if (mail) { openEmail(mail.dataset.email, mail.dataset.template); return; }
  const tpl = t.closest('[data-tpl]');
  if (tpl) { emailPick = tpl.dataset.tpl; drawEmail(state.students.find(x => x.id === state.sel)); return; }
  if (t.closest('[data-close]')) { $('#dlg').close(); return; }
  // test these two before [data-send] (single student email), otherwise
  // they'd never be reached
  const sendNow = t.closest('[data-send-now]');
  if (sendNow) {
    const list = sendNow.dataset.sendNow === 'list';
    const f = list ? sendListFields()
      : { to: $('#mTo').value.trim(), subject: $('#mSub').value, body: $('#mBody').value };
    const err = list ? $('#sendErr') : null;
    const problem = list ? sendListProblem(f) : (f.to ? null : 'Who is it going to?');
    if (problem) { if (err) { err.hidden = false; err.textContent = problem; } else toast(problem); return; }
    sendNow.disabled = true;
    sendNow.textContent = 'Sending';
    try {
      await Store.sendMail({ to: f.to, subject: f.subject, text: f.body });
      $('#dlg').close();
      chime('done');
      toast('Sent to ' + f.to);
    } catch (e) {
      sendNow.disabled = false;
      sendNow.textContent = list ? 'Send the whole list' : 'Send it now';
      const msg = e.message || 'that did not send';
      if (err) { err.hidden = false; err.textContent = msg; } else toast(msg);
    }
    return;
  }
  const sd = t.closest('[data-send]');
  if (sd) { sendEmail(sd.dataset.send); return; }
  const trd = t.closest('[data-transcript]');
  if (trd) { const st = state.students.find(x => x.id === trd.dataset.transcript) || cur(); if (st) printTranscript(st); return; }
  const pr = t.closest('[data-print]');
  if (pr) { const st = state.students.find(x => x.id === pr.dataset.print) || cur(); if (st) printSheet(st); return; }

  const ns = t.closest('[data-note-save]');
  if (ns) {
    const st = state.students.find(x => x.id === ns.dataset.noteSave);
    if (!st) return;
    st.note = { text: $('#noteText').value.trim(), flag: $('#noteFlag').checked, by: state.me.name, at: Date.now() };
    await Store.saveStudent(state.me.slug, st);
    flush(); render();
    toast(st.note.flag ? 'Saved and marked for review' : 'Note saved');
    return;
  }

  /* status decisions are the advisor's word: saved to the record and never
       re-inferred. */
  const hOpen2 = t.closest('[data-hold-open]');
  if (hOpen2) {
    const st = state.students.find(x => x.id === hOpen2.dataset.holdOpen);
    if (st) { holdKind = (st.hold || {}).kind || 'financial'; drawHold(st); }
    return;
  }
  const hKind = t.closest('[data-hold-kind]');
  if (hKind) { holdKind = hKind.dataset.holdKind; if (holdStudent) drawHold(holdStudent); return; }
  const hSave = t.closest('[data-hold-save]');
  if (hSave) {
    const st = state.students.find(x => x.id === hSave.dataset.holdSave);
    if (!st) return;
    const before = st.hold;
    st.hold = { kind: holdKind || 'other', note: ($('#holdNote') ? $('#holdNote').value : '').trim().slice(0, 600),
                at: (before && before.at) || Date.now(), by: state.me.name };
    try { await Store.saveStudent(state.me.slug, st); }
    catch (err) { if (before) st.hold = before; else delete st.hold; throw err; }
    $('#dlg').close(); flush(); render();
    toast('Noted. It shows on their page until it is lifted.');
    return;
  }
  const hClear = t.closest('[data-hold-clear]');
  if (hClear) {
    const st = state.students.find(x => x.id === hClear.dataset.holdClear);
    if (!st) return;
    const before = st.hold;
    delete st.hold;
    try { await Store.saveStudent(state.me.slug, st); }
    catch (err) { st.hold = before; throw err; }
    flush(); render(); chime('done');
    toast('Hold lifted');
    return;
  }
  const mAdd = t.closest('[data-meet-add]');
  if (mAdd) {
    const st = state.students.find(x => x.id === mAdd.dataset.meetAdd);
    const box = $('#meetText');
    const text = box ? box.value.trim() : '';
    if (!st) return;
    if (!text) { toast('Write what you agreed first'); return; }
    const before = st.meetings;
    st.meetings = (st.meetings || []).concat([{ at: Date.now(), by: state.me.name, text: text.slice(0, 2000) }]);
    try { await Store.saveStudent(state.me.slug, st); }
    catch (err) { st.meetings = before; throw err; }
    flush(); render();
    toast('Logged');
    return;
  }
  const mDel = t.closest('[data-meet-del]');
  if (mDel) {
    const [id, at] = mDel.dataset.meetDel.split(':');
    const st = state.students.find(x => x.id === id);
    if (!st) return;
    const before = st.meetings;
    st.meetings = (st.meetings || []).filter(m => String(m.at) !== at);
    try { await Store.saveStudent(state.me.slug, st); }
    catch (err) { st.meetings = before; throw err; }
    flush(); render();
    return;
  }
  const dec = t.closest('[data-decide]');
  if (dec) {
    const [what, id] = dec.dataset.decide.split(':');
    const st = state.students.find(x => x.id === id);
    if (!st) return;
    const before = { decided: st.decided, group: st.group };
    if (what === 'undo') delete st.decided;
    else {
      st.decided = { what: what === 'cs' || what === 'freshman' ? 'kept' : what, at: Date.now(), by: state.me.name };
      if (what === 'cs') st.group = 'cs';
      if (what === 'freshman') st.group = 'freshman';
    }
    try { await Store.saveStudent(state.me.slug, st); }
    catch (err) { st.decided = before.decided; st.group = before.group; throw err; }
    flush(); render();
    toast(what === 'undo' ? 'Back on the list to decide'
      : what === 'studying' ? st.name.split(' ')[0] + ' is back on your advising list'
      : what === 'freshman' ? 'Moved to Freshmen'
      : what === 'cs' ? 'Moved to your CS list'
      : what === 'graduated' ? 'Kept as graduated' : 'Kept on your list');
    return;
  }

  const co = t.closest('[data-critical-open]');
  if (co) { const st = state.students.find(x => x.id === co.dataset.criticalOpen); if (st) drawCritical(st); return; }
  const cp = t.closest('[data-critical-pick]');
  if (cp) {
    // quick reason gets dropped in the box, still editable
    const box = $('#critText');
    if (box) { const v = box.value.trim(); box.value = v ? v + '. ' + cp.dataset.criticalPick : cp.dataset.criticalPick; box.focus(); }
    return;
  }
  const cs = t.closest('[data-critical-save]');
  if (cs) {
    const st = state.students.find(x => x.id === cs.dataset.criticalSave);
    if (!st) return;
    const reason = ($('#critText') ? $('#critText').value : '').trim().slice(0, 600);
    const before = st.critical;
    st.critical = { at: (before && before.at) || Date.now(), by: state.me.name, reason, edited: before ? Date.now() : undefined };
    try { await Store.saveStudent(state.me.slug, st); }
    catch (err) { if (before) st.critical = before; else delete st.critical; throw err; }
    $('#dlg').close();
    flush(); render();
    chime('bad');
    toast(before ? 'Saved' : st.name.split(' ')[0] + ' is at the top of your list until the case is resolved.');
    return;
  }
  const cc = t.closest('[data-critical-clear]');
  if (cc) {
    const st = state.students.find(x => x.id === cc.dataset.criticalClear);
    if (!st) return;
    const before = st.critical;
    delete st.critical;
    try { await Store.saveStudent(state.me.slug, st); }
    catch (err) { st.critical = before; throw err; }
    flush(); render();
    chime('done');
    toast('Resolved. Good work.');
    return;
  }
  const rv = t.closest('[data-review]');
  if (rv) {
    const st = state.students.find(x => x.id === rv.dataset.review);
    if (!st) return;
    // snapshot current flags so a new one can bring the student back
    const before = st.reviewed;
    st.reviewed = { at: Date.now(), by: state.me.name, term: state.term, keys: flagKeys(st) };
    try { await Store.saveStudent(state.me.slug, st); }
    catch (err) { if (before) st.reviewed = before; else delete st.reviewed; throw err; }
    flush(); render();
    chime('done');
    toast(st.name.split(' ')[0] + ' is reviewed. Off the list until something new comes up.');
    return;
  }
  const urv = t.closest('[data-unreview]');
  if (urv) {
    const st = state.students.find(x => x.id === urv.dataset.unreview);
    if (!st) return;
    const before = st.reviewed;
    delete st.reviewed;
    try { await Store.saveStudent(state.me.slug, st); }
    catch (err) { st.reviewed = before; throw err; }
    flush(); render();
    toast('Back on your list');
    return;
  }
  const nc = t.closest('[data-note-clear]');
  if (nc) {
    const st = state.students.find(x => x.id === nc.dataset.noteClear);
    if (!st) return;
    delete st.note;
    await Store.saveStudent(state.me.slug, st);
    flush(); render();
    toast('Note cleared');
    return;
  }

  if (t.closest('[data-chain-all]')) { chainAll = !chainAll; render(); return; }
  const node = t.closest('[data-node]');
  if (node) { chainFocus = node.dataset.node === 'clear' || chainFocus === node.dataset.node ? null : node.dataset.node; render(); return; }
  const tog = t.closest('[data-toggle]');
  if (tog) {
    const code = tog.dataset.toggle;
    if (basket[code]) delete basket[code];
    else {
      const secs = sectionsFor(code);
      const pick = secs[0];
      basket[code] = pick
        ? { code, crn: pick.crn, section: pick.section, cr: pick.cr || (MAP[code] || {}).cr || 0, campus: pick.campus, meetings: pick.meetings }
        : { code, crn: null, section: '', cr: (MAP[code] || {}).cr || 0, campus: null, meetings: [] };
    }
    render(); return;
  }
  const addSec = t.closest('[data-add-sec]');
  if (addSec) {
    const code = addSec.dataset.code, crn = addSec.dataset.addSec;
    if (crn === 'none') {
      basket[code] = basket[code] && !basket[code].crn ? undefined : { code, crn: null, section: '', cr: (MAP[code] || {}).cr || 0, campus: null, meetings: [] };
      if (!basket[code]) delete basket[code];
    } else {
      const sec = state.offering.sections.find(x => x.crn === crn);
      if (basket[code] && basket[code].crn === crn) delete basket[code];
      else if (sec) basket[code] = { code, crn: sec.crn, section: sec.section, cr: sec.cr || (MAP[code] || {}).cr || 0, campus: sec.campus, meetings: sec.meetings };
    }
    render(); return;
  }
  const dropIt = t.closest('[data-drop]');
  if (dropIt) { delete basket[dropIt.dataset.drop]; render(); return; }
  if (t.closest('[data-clear-basket]')) { basket = {}; render(); return; }
  const psave = t.closest('[data-plan-save]');
  if (psave) {
    const st = state.students.find(x => x.id === psave.dataset.planSave);
    if (st && await saveTermPlan(st)) toast('Plan saved on the student record');
    return;
  }
  const pprint = t.closest('[data-plan-print]');
  if (pprint) {
    const st = state.students.find(x => x.id === pprint.dataset.planPrint);
    if (st) printDocument(planDocument(st));
    return;
  }
  const ovOpen = t.closest('[data-override]');
  if (ovOpen) {
    const st = state.students.find(x => x.id === ovOpen.dataset.override);
    if (st) drawOverride(st, ovOpen.dataset.overrideKey);
    return;
  }
  if (t.closest('[data-override-save]') && overrideFor) {
    const st = state.students.find(x => x.id === overrideFor.id);
    const reason = ($('#ovReason') ? $('#ovReason').value : '').trim();
    const err = $('#ovErr');
    if (reason.length < 10) { err.hidden = false; err.textContent = 'Write a reason of at least 10 characters.'; return; }
    const ruleId = overrideFor.key.split('|')[0];
    const course = ((overrideFor.key.split('|')[1] || '').match(/[A-Z]{2,5}\d{3}[A-Z]?/) || [''])[0];
    if (st && await saveTermPlan(st, { key: overrideFor.key, ruleId, course, reason })) {
      $('#dlg').close(); overrideFor = null;
      toast('Override saved with your reason');
    }
    return;
  }

  const drop = t.closest('.drop');
  if (drop) { const inp = drop.querySelector('input[type=file]'); if (inp) inp.click(); return; }

  const sugg = t.closest('[data-sugg]');
  if (sugg) { ask(sugg.dataset.sugg); return; }
  if (t.id === 'askGo') { const b = $('#askBox'); const v = b.value; b.value = ''; ask(v); return; }
}

/* every click goes through here so errors are caught in one place. Before,
   a refused save just vanished (handler threw, button looked dead). Usual
   cause is an expired sign-in (sessions last 12h, tabs stay open longer), which
   gets its own message and a sign-in prompt. Anything else shows the error. */
// light tick under every button and clickable row
document.addEventListener('pointerdown', e => {
  const b = e.target.closest && e.target.closest('button,.srow,[data-open],[data-tab],[data-view],.who');
  if (b && !b.disabled && !b.closest('[data-sound-pick]')) chime('click');
}, { passive: true });

document.addEventListener('click', e => {
  onClick(e).catch(err => {
    if (err && err.status === 401) {
      toast('You have been signed out, which happens after 12 hours. Sign in again and try that once more.');
      setTimeout(() => {
        sessionStorage.removeItem('bau.session');
        $('#app').hidden = true; $('#gate').hidden = false;
        gateStep = 'pick'; drawGate();
      }, 2200);
      return;
    }
    console.error(err);
    toast('That did not save: ' + ((err && err.message) || 'something went wrong') + '. Try again in a moment.');
  });
});

document.addEventListener('submit', e => {
  if (e.target.id === 'signForm') trySignIn(e);
  if (e.target.id === 'linkForm') tryLinkReset(e);
  if (e.target.id === 'verifyForm') tryVerify(e);
  if (e.target.id === 'resetRequestForm') requestPasswordReset(e);
  if (e.target.id === 'peopleForm') savePersonForm(e);
  if (e.target.id === 'pwForm') changeMyPassword(e);
});

document.addEventListener('input', e => {
  if (e.target.dataset && (e.target.dataset.rf || e.target.dataset.pc || e.target.dataset.cal)) { rulesInput(e.target); return; }
  if (e.target.dataset && e.target.dataset.pl) { planInput(e.target); return; }
  if (e.target.id === 'peopleSearch') {
    peopleQuery = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const input = $('#peopleSearch'); if (input) { input.focus(); input.setSelectionRange(pos, pos); }
    return;
  }
  if (e.target.id === 'q') {
    state.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const el = $('#q'); if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  }
});

document.addEventListener('change', e => {
  if (e.target.dataset && (e.target.dataset.rf || e.target.dataset.pc || e.target.dataset.cal)) { rulesInput(e.target); return; }
  if (e.target.dataset && e.target.dataset.pl) { planInput(e.target, true); return; }
  if (e.target.id === 'progPick') { switchProgramme(e.target.value); return; }
  if (e.target.id === 'peopleRole') { syncPeopleScopeOptions(); return; }
  if (e.target.id === 'sendTo') {
    const w = $('#sendOtherWrap');
    if (w) { w.hidden = !!e.target.value; if (!e.target.value) $('#sendOther').focus(); }
  }
  // "Mark this student for review" saves as soon as it's ticked; a note
  // being typed stays in the box, unsaved, until Save note
  if (e.target.id === 'noteFlag') { saveNoteFlag(e.target.checked); return; }
  if (e.target.id === 'pwFor') { pwReset = { slug: e.target.value, link: '', busy: false, err: '', clearAsk: false }; render(); return; }
  if (e.target.id === 'impFor') { state.importFor = e.target.value; importState.undo = null; importState.confirm = null; render(); return; }
  if (e.target.id === 'fileT' && e.target.files[0]) onTranscripts(e.target.files[0]);
  if (e.target.id === 'fileS' && e.target.files[0]) onSchedules(e.target.files[0]);
  if (e.target.id === 'fileO' && e.target.files[0]) onOffering(e.target.files[0]);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'askBox') {
    e.preventDefault();
    const v = e.target.value; e.target.value = ''; ask(v);
  }
});

['dragover', 'dragleave', 'drop'].forEach(ev => {
  document.addEventListener(ev, e => {
    const d = e.target.closest ? e.target.closest('.drop') : null;
    // a file let go anywhere else would make the browser open it and leave the portal
    if (!d) {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
        e.preventDefault();
        if (ev === 'drop') toast(state.view === 'import' ? 'Drop the file on one of the three boxes.' : 'Open Import first, then drop the file on its box.');
      }
      return;
    }
    e.preventDefault();
    if (ev === 'dragover') d.classList.add('over');
    else d.classList.remove('over');
    if (ev === 'drop' && e.dataTransfer.files[0]) {
      const f = e.dataTransfer.files[0];
      if (d.id === 'dropT') onTranscripts(f);
      else if (d.id === 'dropS') onSchedules(f);
      else if (d.id === 'dropO') onOffering(f);
    }
  });
});

// only needed when the page was built without the inlined worker
if (typeof pdfjsLib !== 'undefined' && !(window.pdfjsWorker && window.pdfjsWorker.WorkerMessageHandler)) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

boot().catch(showStartupError);
})();
