/* ── Sign-in directory ──────────────────────────────────────────────────
   The sign-in page opens on the university: pick your faculty, then your
   department, then your own card (photo, name, title and BAU email), and
   type your password. Search finds anyone by name or email from any step.

   The directory is window.BAU_DIRECTORY, built from the public academic
   staff pages of www.bau.edu.lb (data/directory.json). It holds only what
   BAU already publishes: name, title, department, BAU email and the photo's
   address on bau.edu.lb (the department's own photos of its advisors are
   embedded). No roles, no accounts, nothing about students.
   Whether a card can sign in is decided by the server, as before: staff
   still need an account (an invitation) and their password. */

const DIR = window.BAU_DIRECTORY || { faculties: [], people: [] };
let dirFac = null, dirDept = null, dirQuery = '', dirPerson = null;
let dirAnim = true;   // cards animate in when a step opens, not while typing

(function restoreDirPlace() {
  try {
    const saved = JSON.parse(localStorage.getItem('bau.gate.place') || 'null');
    if (saved && DIR.faculties.some(f => f.id === saved.f)) {
      dirFac = saved.f;
      const fac = DIR.faculties.find(f => f.id === saved.f);
      if (saved.d && fac.departments.some(d => d.id === saved.d)) dirDept = saved.d;
    }
  } catch (e) { /* storage blocked: start at the top */ }
})();
function saveDirPlace() {
  try { localStorage.setItem('bau.gate.place', JSON.stringify({ f: dirFac, d: dirDept })); } catch (e) { /* not kept */ }
}

const dirFaculty = id => DIR.faculties.find(f => f.id === id) || null;
const dirDepartment = (fac, id) => (fac ? fac.departments.find(d => d.id === id) : null) || null;
// photos the department supplied are embedded; the rest load from bau.edu.lb
const dirPhoto = p => !p ? '' : /^data:image\/(png|jpe?g|webp);base64,/.test(p.photoData || '') ? p.photoData
  : p.photo ? (DIR.photoBase || '') + p.photo : '';
const dirKey = p => p.email;

// the faculty a single department view means: one-department faculties skip that step
function dirOnlyDept(fac) { return fac && fac.departments.length === 1 ? fac.departments[0].id : null; }

/* line icons, one per faculty, drawn here so nothing loads from elsewhere */
const FAC_ICON = {
  science: '<circle cx="24" cy="24" r="3.2"/><ellipse cx="24" cy="24" rx="17" ry="6.6"/><ellipse cx="24" cy="24" rx="17" ry="6.6" transform="rotate(60 24 24)"/><ellipse cx="24" cy="24" rx="17" ry="6.6" transform="rotate(120 24 24)"/>',
  engineering: '<circle cx="24" cy="24" r="6"/><path d="M24 7v5M24 36v5M7 24h5M36 24h5M12 12l3.5 3.5M32.5 32.5 36 36M12 36l3.5-3.5M32.5 15.5 36 12"/><circle cx="24" cy="24" r="12"/>',
  'business-administration': '<path d="M9 38h30"/><path d="M13 38V26M21 38V19M29 38V23M37 38V12"/><path d="m11 20 9-7 7 5 11-9"/><path d="M34 9h4v4"/>',
  'architecture-design-built-environment': '<path d="M8 40h32"/><path d="M11 40V20l13-10 13 10v20"/><path d="M19 40V29a5 5 0 0 1 10 0v11"/><path d="M16 22h16"/>',
  pharmacy: '<rect x="9" y="19" width="30" height="11" rx="5.5" transform="rotate(-40 24 24.5)"/><path d="m19 31-9-10" transform="translate(5 -2)"/><path d="M33 38h8M37 34v8"/>',
  medicine: '<path d="M24 40s-14-8.3-14-19a7.5 7.5 0 0 1 14-3.8A7.5 7.5 0 0 1 38 21c0 10.7-14 19-14 19z"/><path d="M14 25h6l2.5-5 4 10 2.5-5h5"/>',
  dentistry: '<path d="M16 9c-5 0-8 4-8 9 0 6 3 8 4 14 1 5 2 8 4.5 8 3 0 2.5-10 7.5-10s4.5 10 7.5 10c2.5 0 3.5-3 4.5-8 1-6 4-8 4-14 0-5-3-9-8-9-3.5 0-5 2-8 2s-4.5-2-8-2z"/>',
  'health-sciences': '<path d="M19 8h10v11h11v10H29v11H19V29H8V19h11z"/>',
  'human-sciences': '<path d="M24 13c-4-3-10-4-16-3v26c6-1 12 0 16 3 4-3 10-4 16-3V10c-6-1-12 0-16 3z"/><path d="M24 13v26"/>',
  'law-and-political-science': '<path d="M24 8v32M15 40h18"/><path d="M10 14h28"/><path d="m10 14-5 12a5 5 0 0 0 10 0zM38 14l-5 12a5 5 0 0 0 10 0z"/>'
};
function facIcon(id) {
  return `<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2"
    stroke-linecap="round" stroke-linejoin="round">${FAC_ICON[id] || FAC_ICON['human-sciences']}</svg>`;
}

function dirFace(p, cls) {
  const src = dirPhoto(p);
  const drawn = `<span class="dface-i" style="${avatar(p.name)}">${initials(p.name)}</span>`;
  return `<span class="dface${cls ? ' ' + cls : ''}">${drawn}${src
    ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-dirimg="1">` : ''}</span>`;
}

// highlights the typed text inside a name or email
function dirMark(text, q) {
  const s = String(text || '');
  if (!q) return esc(s);
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(s);
  return esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length));
}

function dirMatches(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return DIR.people.filter(p => {
    const hay = (p.name + ' ' + p.email + ' ' + p.title).toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

function dirCrumbs(fac, dept) {
  const items = [`<button type="button" class="crumb" data-dir-to="root">Beirut Arab University</button>`];
  if (fac) items.push(dept || dirOnlyDept(fac) ? `<button type="button" class="crumb" data-dir-to="fac">${esc(fac.name)}</button>`
    : `<span class="crumb on" aria-current="page">${esc(fac.name)}</span>`);
  if (fac && dept && !dirOnlyDept(fac)) items.push(`<span class="crumb on" aria-current="page">${esc(dept.name)}</span>`);
  return `<nav class="crumbs" aria-label="Where you are">${items.join('<span class="crumb-sep" aria-hidden="true">›</span>')}</nav>`;
}

function personCard(p, i, q) {
  const fac = dirFaculty(p.faculty);
  const dept = dirDepartment(fac, p.department);
  const where = q ? `<span class="pc-where">${esc(fac ? fac.short : '')}${dept && !dirOnlyDept(fac) ? ' · ' + esc(dept.name) : ''}</span>` : '';
  return `<button type="button" class="pcard" data-dir-person="${esc(dirKey(p))}" style="--i:${Math.min(i, 24)}">
    ${dirFace(p)}
    <b class="pc-name">${dirMark(p.name, q)}</b>
    <span class="pc-title">${esc(p.title)}</span>
    ${where}
    <span class="pc-mail">${dirMark(p.email, q)}</span>
  </button>`;
}

function dirResultsHtml() {
  const q = dirQuery.trim();
  if (q) {
    const found = dirMatches(q);
    if (!found.length) {
      return `<div class="dir-empty"><b>No one matches “${esc(q)}”.</b>
        <span>Try part of your name or your BAU email, or sign in with your email below.</span></div>`;
    }
    return `<p class="dir-count">${found.length} ${found.length === 1 ? 'person' : 'people'} found</p>
      <div class="pgrid${dirAnim ? ' anim' : ''}">${found.slice(0, 60).map((p, i) => personCard(p, i, q)).join('')}</div>`;
  }
  const fac = dirFaculty(dirFac);
  if (!fac) {
    return `<div class="fgrid${dirAnim ? ' anim' : ''}">${DIR.faculties.map((f, i) => `
      <button type="button" class="fcard" data-dir-fac="${esc(f.id)}" style="--i:${i}">
        <span class="fc-icon">${facIcon(f.id)}</span>
        <span class="fc-body">
          <span class="fc-kicker">${/^Faculty of /.test(f.name) ? 'Faculty of' : 'Faculty'}</span>
          <b class="fc-name">${esc(f.name.replace(/^Faculty of /, ''))}</b>
          <span class="fc-meta">${f.departments.length === 1 ? 'One department' : f.departments.length + ' departments'}<i aria-hidden="true">·</i>${f.count} staff</span>
        </span>
        <span class="fc-go" aria-hidden="true">→</span>
      </button>`).join('')}</div>`;
  }
  const deptId = dirDept || dirOnlyDept(fac);
  const dept = dirDepartment(fac, deptId);
  if (!dept) {
    return `<div class="dgrid${dirAnim ? ' anim' : ''}">${fac.departments.map((d, i) => {
      const faces = DIR.people.filter(p => p.faculty === fac.id && p.department === d.id).slice(0, 4);
      return `<button type="button" class="dcard" data-dir-dept="${esc(d.id)}" style="--i:${i}">
        <b class="dc-name">${esc(d.name)}</b>
        <span class="dc-meta">${d.count} ${d.count === 1 ? 'member' : 'members'} of staff</span>
        <span class="dc-faces">${faces.map(p => dirFace(p, 'sm')).join('')}${d.count > faces.length ? `<span class="dc-more">+${d.count - faces.length}</span>` : ''}</span>
      </button>`;
    }).join('')}</div>`;
  }
  const staff = DIR.people.filter(p => p.faculty === fac.id && p.department === dept.id);
  return `<div class="pgrid${dirAnim ? ' anim' : ''}">${staff.map((p, i) => personCard(p, i, '')).join('')}</div>`;
}

function dirHeading() {
  if (dirQuery.trim()) return ['Search results', 'Choose your card to sign in.'];
  const fac = dirFaculty(dirFac);
  if (!fac) return ['Choose your faculty', 'Ten faculties across the Beirut, Debbieh, Tripoli and Bekaa campuses.'];
  const dept = dirDepartment(fac, dirDept || dirOnlyDept(fac));
  if (!dept) return ['Choose your department', fac.name + (fac.dean ? ' · Dean: ' + fac.dean : '')];
  return ['Choose your account', dirOnlyDept(fac) ? fac.name : dept.name + ' · ' + fac.name];
}

function drawDirectory(g) {
  if (dirPerson) { drawDirectoryPerson(g); return; }
  const fac = dirFaculty(dirFac);
  const dept = fac ? dirDepartment(fac, dirDept) : null;
  const [title, lede] = dirHeading();
  const deep = !!(fac || dirQuery.trim());
  g.innerHTML = `<div class="gate-inner gate-wide${deep ? ' compact' : ''}">
    ${coverBanner()}
    <section class="dir" aria-labelledby="dirTitle">
      <div class="dir-top">
        ${dirCrumbs(fac, dept)}
        <label class="dir-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
          <span class="sr">Search staff</span>
          <input id="dirSearch" type="search" value="${esc(dirQuery)}" placeholder="Search your name or BAU email" autocomplete="off" spellcheck="false">
        </label>
      </div>
      <div class="dir-headline">
        ${deep ? `<button type="button" class="dir-back" data-dir-to="up" aria-label="Back">←</button>` : ''}
        <div><h2 id="dirTitle">${esc(title)}</h2><p class="dir-lede" id="dirLede">${esc(lede)}</p></div>
      </div>
      <div id="dirResults">${dirResultsHtml()}</div>
    </section>
    <div class="gate-foot">
      <button class="linkbtn" type="button" data-dir-email="1">Not on the list? Sign in with your BAU email</button>
      <p class="note">Staff accounts are created by invitation. Names, titles and photos come from the BAU website.</p>
    </div>
  </div>`;
  dirAnim = false;
}

// only the results and headings change while typing, so the search box keeps focus
function redrawDirectoryResults() {
  const box = $('#dirResults'); if (!box) return;
  box.innerHTML = dirResultsHtml();
  const [title, lede] = dirHeading();
  $('#dirTitle').textContent = title; $('#dirLede').textContent = lede;
}

function drawDirectoryPerson(g) {
  const p = dirPerson;
  const fac = dirFaculty(p.faculty);
  const dept = dirDepartment(fac, p.department);
  g.innerHTML = `<div class="gate-inner gate-wide compact">
    ${coverBanner()}
    <section class="dir dir-signin">
      <div class="dir-top">${dirCrumbs(fac, dept)}</div>
      <div class="me-card">
        <div class="me-side">
          ${dirFace(p, 'xl')}
          <b class="me-name">${esc(p.name)}</b>
          <span class="me-title">${esc(p.title)}</span>
          <span class="me-where">${esc(dept && !dirOnlyDept(fac) ? dept.name : '')}${dept && !dirOnlyDept(fac) ? '<br>' : ''}${esc(fac ? fac.name : '')}</span>
        </div>
        <form class="stack me-form" id="signForm" autocomplete="on">
          <h2>Welcome back</h2>
          <label class="f" for="fEmail">BAU email
            <input id="fEmail" type="email" autocomplete="username" value="${esc(p.email)}" readonly class="locked">
          </label>
          <label class="f" for="fPass">Password
            <input id="fPass" type="password" autocomplete="current-password" required>
          </label>
          <p class="err" id="gateErr" hidden></p>
          <button class="btn primary big" type="submit">Sign in</button>
          <div class="me-links">
            <button class="linkbtn" type="button" data-reset="1">Forgot your password, or first time here?</button>
            <button class="linkbtn quiet" type="button" data-dir-to="list">Not you? Choose another account</button>
          </div>
          <p class="note">No portal account yet? Your faculty administrator sends you an invitation to your BAU email.</p>
        </form>
      </div>
    </section>
  </div>`;
  setTimeout(() => { const el = $('#fPass'); if (el) el.focus(); }, 60);
}

function drawEmailSignIn(g) {
  g.innerHTML = `<div class="gate-inner">
    ${coverBanner()}
    <div class="card">
      <div class="pic"><div><b>Sign in with your email</b><span>Use your BAU email address</span></div></div>
      <form class="stack" id="signForm" autocomplete="on">
        <label class="f" for="fEmail">BAU email
          <input id="fEmail" type="email" autocomplete="username" required>
        </label>
        <label class="f" for="fPass">Password
          <input id="fPass" type="password" autocomplete="current-password" required>
        </label>
        <p class="err" id="gateErr" hidden></p>
        <button class="btn primary" type="submit" style="justify-content:center">Sign in</button>
        <button class="linkbtn" type="button" data-reset="1">Forgot your password, or first time here?</button>
        <button class="btn ghost" type="button" data-dir-back="1" style="justify-content:center">Back to the staff list</button>
        <p class="note" style="text-align:center">Staff accounts are created by invitation. Use your BAU email address.</p>
      </form>
    </div>
  </div>`;
  setTimeout(() => { const el = $('#fEmail'); if (el) el.focus(); }, 60);
}

// a photo that does not load leaves the initials showing underneath
document.addEventListener('error', e => {
  const img = e.target;
  if (img && img.tagName === 'IMG' && img.dataset && img.dataset.dirimg) img.remove();
}, true);
document.addEventListener('load', e => {
  const img = e.target;
  if (img && img.tagName === 'IMG' && img.dataset && img.dataset.dirimg) img.classList.add('in');
}, true);

// the directory's own clicks; returns true when it handled one
function directoryClick(t) {
  const g = $('#gate'); if (!g || g.hidden) return false;
  const facBtn = t.closest('[data-dir-fac]');
  if (facBtn) {
    dirFac = facBtn.dataset.dirFac; dirDept = null; dirQuery = ''; dirAnim = true;
    saveDirPlace(); drawDirectory(g); g.scrollTop = 0; return true;
  }
  const deptBtn = t.closest('[data-dir-dept]');
  if (deptBtn) {
    dirDept = deptBtn.dataset.dirDept; dirQuery = ''; dirAnim = true;
    saveDirPlace(); drawDirectory(g); g.scrollTop = 0; return true;
  }
  const personBtn = t.closest('[data-dir-person]');
  if (personBtn) {
    dirPerson = DIR.people.find(p => dirKey(p) === personBtn.dataset.dirPerson) || null;
    if (dirPerson) {
      dirFac = dirPerson.faculty; dirDept = dirPerson.department; saveDirPlace();
      resetEmail = dirPerson.email;
    }
    drawDirectory(g); g.scrollTop = 0; return true;
  }
  const to = t.closest('[data-dir-to]');
  if (to) {
    const where = to.dataset.dirTo;
    dirAnim = true;
    if (where === 'root') { dirFac = null; dirDept = null; dirQuery = ''; dirPerson = null; }
    else if (where === 'fac') { dirDept = null; dirQuery = ''; dirPerson = null; }
    else if (where === 'list') { dirPerson = null; }
    else if (where === 'up') {
      const fac = dirFaculty(dirFac);
      if (dirQuery.trim()) dirQuery = '';
      else if (dirDept && fac && !dirOnlyDept(fac)) dirDept = null;
      else { dirFac = null; dirDept = null; }
    }
    saveDirPlace(); drawDirectory(g); return true;
  }
  if (t.closest('[data-dir-email]')) { gateStep = 'email'; drawGate(); return true; }
  if (t.closest('[data-dir-back]')) { gateStep = 'pick'; dirPerson = null; drawGate(); return true; }
  return false;
}

function directoryInput(target) {
  if (target.id !== 'dirSearch') return false;
  dirQuery = target.value;
  dirAnim = false;
  redrawDirectoryResults();
  return true;
}

// Escape steps back up the directory
function directoryKey(e) {
  const g = $('#gate'); if (!g || g.hidden || gateStep !== 'pick' || e.key !== 'Escape') return false;
  if (!dirPerson && !dirFac && !dirQuery) return false;
  if (dirPerson) dirPerson = null;
  else if (dirQuery) dirQuery = '';
  else {
    const fac = dirFaculty(dirFac);
    if (dirDept && fac && !dirOnlyDept(fac)) dirDept = null; else { dirFac = null; dirDept = null; }
  }
  dirAnim = true; saveDirPlace(); drawDirectory(g);
  return true;
}

// staff records without their own photo show the one on the BAU website
// (kept apart from .photo so it is never saved back into the record)
function withDirectoryPhotos(list) {
  (list || []).forEach(person => {
    if (!person || person.photo) return;
    const match = DIR.people.find(p => p.email === String(person.email || '').toLowerCase());
    if (match && dirPhoto(match)) person.dirPhoto = dirPhoto(match);
  });
  return list;
}
