# BAU Advising Desk: the developer's guide

This guide explains the whole system: what each file does, how the pieces talk to
each other, and why they were built this way. It is written for learning. Read it
next to the code, open the files it points to, and try the exercises at the end.

- Repository: https://github.com/devexlynne/BAU-Advising-Desk
- Live site: https://advising-production.up.railway.app
- Branch with the latest work: `university-programmes`

---

## Part 1. The system in one page

The **Online Advising System** helps BAU advisors follow their students. An advisor
imports the registrar's transcript and schedule PDFs. The portal reads them, checks
every student against the university regulations and the programme's study plan,
and shows who needs attention: probation, a missing prerequisite, too many or too
few credits, a required course to repeat, a graduation that will slip, and so on.

It has three layers:

```
 ┌───────────────────────────── the browser ─────────────────────────────┐
 │  build/index.html  (one page; everything is inlined into it)          │
 │                                                                       │
 │   app.js + structure.js + rulesadmin.js + admin.js ...  ← the screens │
 │        │                                                              │
 │   engine.js   ← the regulations, as pure functions (no I/O)           │
 │   pdfimport.js, merge.js ← read PDFs, fold them into the student list │
 │        │                                                              │
 │   store.js    ← the only file that talks to the server                │
 └────────┼──────────────────────────────────────────────────────────────┘
          │  HTTPS, JSON, session cookie  (POST /api/...)
 ┌────────▼───────────────────────── the server (Node.js) ──────────────┐
 │  server.js   sign-in, sessions, permissions, the JSON API, audit log  │
 │  permissions.js + org-tree.js   who may do what, where                │
 │  mail.js     invitation and reset emails                              │
 │  postgres-store.js / encrypted-file.js   where the data is kept       │
 └────────┼──────────────────────────────────────────────────────────────┘
          │
 ┌────────▼──────────── storage ───────────┐
 │  PostgreSQL on Railway (production)     │
 │    advising_app_data  key → JSON value  │
 │    advising_audit_log append-only       │
 │  or encrypted/plain JSON files (local)  │
 └─────────────────────────────────────────┘
```

Three ideas run through the whole codebase. Keep them in mind:

1. **The rules engine is pure.** `src/engine.js` takes data in (rules, catalogue,
   a student) and returns findings. It never reads files, never calls the network
   and never touches the page. That makes it easy to test (`tests/rules.test.js`)
   and lets the same code run in the browser and in Node.
2. **The server decides, the page only hides.** The page hides buttons a person
   cannot use, but every permission is checked again on the server. Assume anyone
   can send any request with `curl`; the server must still say no.
3. **Everything is a key with a JSON value.** The server keeps one big object
   (`store`) such as `{ "people/julie-bu-daher": {...}, "advisors/julie-bu-daher/students/202599313": {...} }`.
   PostgreSQL stores it as one row per key. That simple design keeps the code short.

---

## Part 2. What happens when you use it (the request lifecycle)

Following one action from click to database is the fastest way to understand a
web system. Here is **an advisor signing in and opening their students**.

1. **The browser asks for `/`.** `server.js` → `http.createServer(...)` sees a
   `GET` that is not `/api/...` and sends `build/index.html` with security headers
   (`securityHeaders()`: Content-Security-Policy, `X-Frame-Options: DENY`, HSTS...).
2. **The page boots.** At the bottom of `src/app.js`, `boot()` runs. It calls
   `Store.init()` and then `Store.whoAmI()`, which is `GET /api/session`. No
   cookie yet, so the answer is `{ slug: null }` and `drawGate()` shows the
   sign-in form.
3. **The advisor types email and password.** `Store.signIn()` sends
   `POST /api/signin` with `{ email, password }`.
4. **The server checks it** (`server.js`, `if (p === '/api/signin')`):
   - `staffEmailOk()`: is it a `@bau.edu.lb` address (or the superadmin mailbox)?
   - `tooMany()`: has this email or address failed too often? (rate limiting)
   - `hash(password, acct.salt)`: PBKDF2 with 310,000 rounds, run off the main
     thread. It is compared with `sameSecret()`, a constant-time compare, so the
     time taken does not leak how many characters matched.
   - An unknown email is hashed too, so a wrong email and a wrong password take
     the same time. Attackers cannot use timing to find out which accounts exist.
5. **A session is created.** `newSession(slug)` makes 32 random bytes, stores only
   their **SHA-256 hash** under `_sessions`, and sends the raw value in a cookie:
   `sid=...; HttpOnly; SameSite=Lax; Secure`. HttpOnly means page JavaScript cannot
   read it (this limits XSS). SameSite=Lax means other websites cannot send it
   along with their forms (this limits CSRF).
6. **The page loads the data.** `signedIn()` in `app.js` calls
   `Store.loadStudents(slug)`, which is `POST /api/list { path: "advisors/<slug>/students" }`.
7. **The server checks permission.** `mayTouch(slug, key, 'read')` → `canForOwner()`
   → `canUser()` → `Permissions.can(person, 'students:read', scope, tree)`. Only if
   that is true does it return the records.
8. **The page judges each student.** For every student, `look(s)` in `app.js` calls
   `E.snapshot(R, C, s)` (credits, GPA, standing) and `E.alerts(...)` (problems). The
   results are cached by `id + updatedAt + term`, so nothing is computed twice.
9. **The page draws.** `render()` builds an HTML string with template literals,
   puts it in `#view`, and one `document.addEventListener('click', onClick)` handles
   every button on every page. This is called **event delegation**.
10. **Every change is saved and logged.** A write goes through `POST /api/set`. The
    server updates `store`, calls `save()` (writes are batched for 100 ms), and
    `audit()` records who did what. `json()` waits for the write to finish before
    answering, so "saved" on screen really means saved.

---

## Part 3. Every file, explained

### 3.1 Root files

| File | What it is |
|---|---|
| `package.json` | The project card for Node: name, scripts (`npm start`, `npm test`, `npm run demo`...), and the only two dependencies: `esbuild` (minifies the page) and `pg` (PostgreSQL driver). Few dependencies means less supply-chain risk. |
| `package-lock.json` | The exact versions of every dependency, so every install is identical. Never edit it by hand. |
| `build.js` | Builds `build/index.html` from `web/shell.html`. It inlines the data files as `window.CATALOG=...`, glues the client scripts together, and minifies them with esbuild. The `.replace(/</g, '\\u003c')` stops a value such as `</script>` from ending the script tag early. |
| `server.js` | The whole backend in one file. See 3.2. |
| `mail.js` | Sends email with no library: either SMTP over `net`/`tls` sockets (it speaks the SMTP protocol itself, including STARTTLS), or a JSON API such as Brevo or Resend over `https`. `configured()` tells the server whether mail can go out. |
| `railway.json` | Tells Railway how to run the app: `npm start`, health check at `/health`, restart on failure. |
| `railway.demo.json` | The same for the public demo, which runs `scripts/public-demo.js` instead. |
| `.gitignore` | Files Git must never commit: `node_modules/`, `data-store/` (real data), `.env` (secrets), `build/`, test data. |
| `.gitattributes` | Marks PDFs and images as binary and sends videos to Git LFS. |
| `.railwayignore` | Files not uploaded to Railway. |
| `README.md`, `DEPLOY.md` | How to run, configure and deploy it. `DEPLOY.md` lists every environment variable. |

### 3.2 `server.js`, section by section

Open it and follow the `// ----` headings.

- **Configuration** (top). Every setting comes from an environment variable.
  `numberEnv()` refuses to start if a number is mistyped: a typo must stop the
  server, not silently switch off session expiry. `PRODUCTION` is true on Railway,
  and several unsafe settings are refused when it is.
- **Storage**. `store` is the in-memory copy of all data. `loadStore()` reads it
  from disk at start-up and refuses to continue if the file is damaged, so a
  half-read file is never saved over the real one. `writeStoreFile()` writes to a
  temporary file, calls `fsync`, then renames it. A rename is atomic, so a power
  cut leaves either the old file or the new one, never half of each.
- **`save()` and `flushStore()`**. `save()` only marks the store dirty and starts a
  100 ms timer, so ten changes in a row become one write. `flushStore()` writes
  only what changed (PostgreSQL) and keeps retrying if a write fails.
  `storageFailure` makes the API answer 503 until storage works again.
- **Audit log**. `audit(actor, action, details)` adds an event with a UUID and a
  time. With PostgreSQL the events go in the same transaction as the data change,
  so you never get a change without its log entry. `rememberActivity()` keeps a
  short summary for the admin dashboard.
- **Passwords**. PBKDF2-SHA256 with a random salt per account. The salt means two
  people with the same password still get different hashes.
- **Sessions, reset links, verify links**. They all follow one pattern: a random
  token goes to the user and only its hash is stored. Reset links are single-use
  and expire (`RESET_MINUTES`).
- **Rate limiting**. `tooMany()` / `failed()` give each email + address pair five
  free tries, then a wait that doubles each time (30 s, 1 min, 2 min... up to
  15 min). This is **exponential backoff**. `tooManyFrom()` limits sign-in
  attempts per address across all accounts. `apiFlood()` limits all API calls per
  address per minute.
- **`mayTouch()`**. The gatekeeper for the generic `/api/get|list|set|delete`
  routes. It decides from the key's shape: `advisors/<slug>/students/<id>` needs
  `students:read` or `students:write` on that advisor's programme, and
  `programmes/<id>/catalog` needs `rules:write`. Keys starting with `_` (sessions,
  tokens) and `/account` keys can never be read through it.
- **`api()`**. The router: a long list of `if (p === '/api/...')` blocks. The order
  matters. Public routes (session, sign-in, reset) come first. Then the line
  `const me = sessionOf(req); if (!me) return 401` divides the file: everything
  below needs a session.
- **People routes** (`/api/people/*`). Invite, re-invite, update, deactivate.
  `rolePairs()` / `managesPair()` split a person's roles into (role, scope) pairs,
  so an admin can only ever change the pairs inside their own authority. Guards
  such as "the last superadmin cannot be demoted" stop the system from locking
  itself out.
- **Admin dashboard** (`adminOverview()`, `adminApi()`). Superadmin-only numbers,
  activity, sessions and settings.
- **Serving the page**. `CSP` lists where scripts, styles and images may come
  from. `sameOrigin()` checks the `Origin` header on every POST (a second layer
  against CSRF). `healthy()` backs `/health`, which Railway calls to know the app
  is alive.
- **Start-up** (`startServer()`). Connect to storage, take the database lock,
  migrate old data, create the superadmin account, load the catalogue once, apply
  one-time corrections, then `listen()`.
- **Shutdown**. On `SIGTERM` (Railway stopping the app) it stops taking requests,
  saves pending data, closes the database, then exits. This is a **graceful
  shutdown**.

### 3.3 `src/`: shared and server modules

| File | What it does | Concepts to learn from it |
|---|---|---|
| `src/engine.js` | The regulations as code: grade points, GPA, passing and repeat rules, Intensive English, prerequisites, when courses run, load limits, academic standing, validating a planned set of courses (`validateBasket`), recommendations (`recommend`), graduation and minor audits, delay risks, the registration check, alerts, next-term planning, and building a student's BAU email. Each check returns a *finding*: `{ ruleId, severity: BLOCK/WARN/INFO/OK, message, fix, citation }`. | Pure functions; data-driven rules (the numbers live in `data/rules.json`, not in the code); a prerequisite graph (`buildUnlockScores` ranks courses by how many later courses they unlock). |
| `src/permissions.js` | `can(person, action, scope, tree)`: the whole permission model in 50 lines. Some actions are scoped (`students:read` applies within a programme or faculty), others are global. | Role-based access control (RBAC) with scopes, sometimes called hierarchical RBAC. |
| `src/org-tree.js` | The university as a tree: university → faculties → departments → programmes. `validateTree` checks it, `isWithin(tree, scope, target)` answers "is this programme inside that faculty?", and `migrateStore` upgrades old data. | Tree traversal; validating input before trusting it; idempotent migrations (running one twice changes nothing). |
| `src/programme.js` | One study plan per programme, with `validate()` so a broken plan is refused. Used by both the server and the page. | The UMD wrapper (see Part 4) lets one file run in Node and in the browser. |
| `src/postgres-store.js` | Talks to PostgreSQL. `createPool` sets up TLS and refuses unverified certificates in production. `load()` takes an **advisory lock**, so a second copy of the server cannot run and overwrite the first. `check()` verifies that the database user has only the permissions it needs. `save()` writes changed keys and audit rows in **one transaction**. | Connection pooling, transactions (BEGIN/COMMIT/ROLLBACK), distributed locks, least privilege, upserts (`ON CONFLICT DO UPDATE`). |
| `src/postgres-inventory.js` | Counts tables and sizes from the database's metadata, without reading any rows. Used before migrations. | Inspecting a database safely. |
| `src/encrypted-file.js` | AES-256-GCM encryption for file storage (`STORE_KEY`). GCM also detects tampering. | Encryption at rest; authenticated encryption. |

### 3.4 `src/`: the browser side

All of these end up inside `build/index.html`.

| File | What it does |
|---|---|
| `src/app.js` | The main client: state, sign-in screens, the side menu, every page (`viewToday`, `viewStudents`, `viewStudent`, `viewImport`, `viewEveryone`, `viewPeople`...), printing, emails to students, the bell, light and dark mode, syncing across tabs, and the event handlers. The `// ----` headings work as a table of contents. |
| `src/store.js` | The client's storage layer. On the server, every read and write is a `post('/api/...')`. Opened as a local file in demo mode, it keeps data in memory instead. The rest of the app does not need to know which. |
| `src/structure.js` | Several programmes in one portal: the programme picker, switching programme, the University structure page, and the Programme setup page (editing a study plan, with checks and a preview). |
| `src/rulesadmin.js` | The Rules studio. Rules appear as sentences whose numbers you can edit. Edits stay a draft until published, "See the effect" lists which students would change, publishing needs a reason, and history allows undo. |
| `src/exceptions.js` | Per-student exceptions (substitute or waive a course). The transcript is never changed. Instead, `withExceptions()` gives every check a copy with the exceptions applied. |
| `src/admin.js` | The superadmin dashboard (new). |
| `src/pdfimport.js` | Reads BAU transcript and schedule PDFs **in the browser** with pdf.js, so student PDFs never leave the advisor's computer for parsing. It places words by their x/y position, because PDF text has no rows or columns. It also fixes Arabic, which the PDFs store reversed. |
| `src/merge.js` | Folds a new import into an existing list: a new transcript adds a student, and an existing one is updated. Notes and phone numbers typed by hand are kept, while the transcript wins on grades. |
| `src/askme.js` | "Ask Me": turns a typed question such as "registered for less than 12 credits on the Debbieh campus" into filters, in English or Arabic, with typo tolerance (`lev()` is the Levenshtein edit distance). It runs only in the page, so no student data goes to an outside AI service. |
| `src/i18n.js` | The Arabic translation. It translates the rendered text, swapping numbers for `#` so one entry covers "3 students" and "12 students", and switches the page to right-to-left. |

### 3.5 `web/`

| File | What it is |
|---|---|
| `web/shell.html` | The page skeleton plus **all the CSS**. The top defines design tokens (`--brand`, `--ink`, `--surface`...) for light mode, then redefines them for dark mode. Components only use the tokens, so dark mode is just a second set of values. Markers such as `/*__APP__*/` are where `build.js` inserts the scripts. |
| `web/vendor/pdf.min.js`, `pdf.worker.min.js` | Mozilla's pdf.js, copied in so the page works offline and under the strict CSP. |

### 3.6 `data/`

| File | What it holds |
|---|---|
| `data/rules.json` | University regulations as data: the grade scale, passing grades, probation, load limits per term, Intensive English, the calendar... Change a number here (or in the Rules studio) and the engine follows. |
| `data/catalog.json` | The BSc Computer Science study plan: courses with credits, requirement block (`bucket`), prerequisites (`pre`), corequisites (`co`), planned semester and the terms each course runs. |
| `data/catalogue-2020.json` | All 10 faculties and 45 programmes, plus 11 study plans read from the 2020–2021 catalogue (marked "to check"). Built by `scripts/build-catalogue-seed.js`. |
| `data/offering.json` | This term's sections: CRN, course, campus, meeting times, room and teacher. Used for clash checks. |
| `data/faculty.json` | The original staff list, read once to set up `people/...` records. |
| `data/brand.json` | The BAU logos as embedded images. |

### 3.7 `db/`

`db/migrations/001_advising_storage.sql` creates the two tables, an index on audit
time, and revokes public access. Run it with `npm run db:migrate`, using a separate
admin connection (`DATABASE_MIGRATION_URL`). The app's own user cannot change the
schema. That is **least privilege**: if the app is ever compromised, it still cannot
drop tables or rewrite the audit log.

### 3.8 `scripts/`

| Script | Purpose |
|---|---|
| `db-migrate.js` | Applies the SQL migration. |
| `inventory-postgres.js`, `inventory-volume.js` | Report what is stored, without printing any records. Used before moving data. |
| `seed-demo-org.js` | A fictional organisation and staff for tests. |
| `build-catalogue-seed.js` | Turns BAU's catalogue PDFs into `data/catalogue-2020.json`. |
| `demo.js`, `demo-page.js`, `public-demo.js`, `private-demo.js` | Demo versions: offline on your computer, public on Railway with fictional students, or private from real PDFs with the names changed. All refuse to run in production. |
| `static-server.js` | Serves `build/` locally without the API, for previews. Refused in production. |
| `upload-cases.js` | Uploads demo cases into a trial portal's advisor list. |
| `shot.js`, `local-fonts.js`, `tour-compose.py` | Screenshots and the video tour for the manual. |
| `cases-xlsx.py`, `build_technical_defense_guide.py` | Make the Excel workbook and Word guide used in presentations. |

### 3.9 `demo/`

Fictional students (IDs in the `99xxx` block, which is reserved for demo data), the
tools that generate them (`generate-demo.js`, `plan-schedules.js`), PDFs drawn in
the registrar's layout (`make-pdfs.py`), and `build-seed.js`. That last one reads
those PDFs back through the real importer, so the demo shows exactly what a real
import produces.

### 3.10 `tests/`

Run everything with `npm test`. Each file is a small program that prints `ok` or
`FAILED`.

| Test | What it proves |
|---|---|
| `rules.test.js` | The regulations, on purpose-built cases (67 checks). |
| `email.test.js` | Student email addresses are built correctly from name and ID. |
| `import-synthetic.test.js` | The PDF parser on fake word positions. |
| `demo-data.test.js`, `demo-org-seed.test.js` | The demo data is fictional and consistent. |
| `client-phase1.test.js` | The public page does not contain the staff directory. |
| `permissions.test.js`, `org-migration.test.js` | The permission model and the data upgrade. |
| `invites.test.js` | Inviting, signing in, scopes, recovery, superadmin rules and the audit, against a real server. |
| `programmes.test.js`, `catalogue-exceptions.test.js` | Several programmes, study plan checks and exceptions. |
| `theme.test.js` | Every text colour meets WCAG AA contrast (4.5 to 1) in light and dark mode, and font sizes come from a scale. |
| `storage-safety.test.js`, `preview-safety.test.js` | Demo storage stays in memory, and preview servers refuse production. |
| `volume-inventory.test.js`, `postgres-*.test.js` | Inventories and the PostgreSQL store, with a fake database client. |
| `bulk-save.test.js`, `recovery.test.js`, `server-safety.test.js`, `encrypted-store.test.js` | Atomic imports, email-only recovery, a damaged store is never overwritten, and encryption works. |
| `admin-dashboard.test.js` | The new dashboard, the advisor-only correction, read-only mode and the new hardening. |
| `*.e2e.js` | End-to-end runs in a real browser. They need Playwright (`npm i --no-save playwright`), which is not installed by default. |
| `helpers/auth-fixture.js`, `fake-smtp.js` | Test helpers: synthetic accounts and a stand-in mail server. |

---

## Part 4. Patterns worth learning from this code

1. **The UMD wrapper.** `engine.js`, `merge.js`, `programme.js` and `store.js` start with:
   ```js
   (function (root, factory) {
     if (typeof module === 'object' && module.exports) module.exports = factory(); // Node
     else root.Engine = factory();                                                 // browser
   })(this, function () { ... return { snapshot, alerts, ... }; });
   ```
   One file, two environments. The tests `require()` it, and the page uses `window.Engine`.
2. **Rendering with template strings.** There is no React. Each `viewX()` returns
   HTML text, and `render()` replaces the page. It is simple and fast enough here.
   The risk is XSS, which is why every value from data goes through `esc()`.
   Exercise: search for `${` in `app.js` and find which values are not escaped and why that is safe.
3. **Event delegation.** One click listener reads `data-*` attributes
   (`data-view`, `data-open`, `data-adm-tab`) to know what was clicked. New buttons
   need no new listeners.
4. **Caching by version key.** `look(s)` caches by `id + updatedAt + term`. When the
   record changes, `updatedAt` changes and the cache misses. That is cache
   invalidation done with a version number.
5. **Hash what you store.** Sessions, reset links and passwords are stored only as
   hashes. A leaked database copy contains nothing an attacker can use to sign in.
6. **Fail closed.** When storage fails the API says 503 rather than pretending.
   When the store cannot be read the server refuses to start. When a setting is
   mistyped it exits.
7. **One-time markers.** `store._seeds['catalogue-2020']` and
   `_seeds['advisor-only-2026-11']` record that a start-up job ran, so it never runs
   twice. This is idempotency.

---

## Part 5. Your 82-item checklist, mapped to this system

A system for one university with a few hundred users is small. Many items on that
list are for systems with millions of users. Here is what each one means here, and
where it lives.

**Done in the code**

| Topic | Where |
|---|---|
| Rate limiting, exponential backoff | `tooMany()`/`failed()`, `tooManyFrom()`, `apiFlood()` in `server.js` |
| Timeouts | `headersTimeout`, `requestTimeout`, `keepAliveTimeout` on the server (slow-client protection), and the 10 s shutdown timeout |
| Idempotency | one-time `_seeds` markers; `CREATE TABLE IF NOT EXISTS`; event UUIDs |
| Transactions | `PostgresStore.save()`: data and audit in one BEGIN/COMMIT |
| Distributed lock, leader election | `pg_try_advisory_lock`: only one server instance may run |
| Race conditions | Node runs one request at a time on one thread; writes are serialised by `flushStore()` |
| Connection pooling | `pg.Pool` in `postgres-store.js` |
| Database indexing | the `occurred_at` index on the audit log; `key` is the primary key |
| Migrations, schema versioning | `db/migrations/001_...sql`, `OrgTree.migrateStore()` |
| Health checks, liveness | `/health` checks storage and the page; Railway restarts the app on failure |
| Logging, audit | `audit()` → `advising_audit_log` (append-only; the app user cannot change it) |
| Monitoring, metrics, alerts | the new Admin dashboard: sign-ins, failures, lock-outs, storage, memory, uptime |
| Feature flags | `ENABLE_STUDENT_IMPORTS`, `ALLOW_SIGNUP`, and the new read-only mode and banner |
| Secrets management | all secrets in Railway variables, never in Git (`.env` is ignored) |
| IAM | the role and scope model in `permissions.js` |
| Encryption in transit, TLS | HTTPS on Railway plus HSTS; verified TLS to PostgreSQL |
| Encryption at rest | PostgreSQL disk encryption on Railway; AES-256-GCM for file storage |
| CORS | no CORS headers are sent, so other sites cannot read API answers |
| CSRF | SameSite=Lax cookie plus the `Origin` check in `sameOrigin()` |
| XSS | `esc()` everywhere, a strict CSP, and HttpOnly cookies |
| SQL injection | only parameterised queries (`$1`, `$2`) in `postgres-store.js` |
| SSRF | the server never fetches a URL a user supplies; mail only goes to configured hosts |
| Reverse proxy | Railway's edge in front of the app; `TRUST_PROXY` and `clientIp()` handle `X-Forwarded-For` safely |
| CI/CD (partly) | `npm test`, then `git push` and `railway up`. See below for the next step. |
| Rollbacks | Railway can redeploy an earlier version; the rules studio has undo; Git history |
| Backpressure | request body caps (256 KB, or 40 MB for imports) and per-record size caps |

**Not needed at this size, and why**

| Topic | Why not (yet) |
|---|---|
| Load balancing, horizontal scaling, autoscaling, sharding, partitioning, read replicas | One small server easily handles one university, and the advisory lock deliberately allows one instance. You would need these at tens of thousands of active users. |
| Kubernetes, service discovery, API gateway | One service on Railway. Kubernetes manages hundreds of services. |
| Message queues, pub/sub, event-driven design, sagas, dead-letter queues, distributed transactions | There is one database and one process, so one transaction covers everything. Queues help when several services must agree. |
| Circuit breakers, retries | The only outside services are mail and the database. Mail failures are reported to the user, and a database failure stops the app on purpose. |
| WebSockets, SSE, long polling | `watchForChanges()` re-reads data when the tab comes back and every 2 minutes, which is enough for advising. |
| CDN, edge caching | The page is one file, sent with `no-store` because it changes with each deploy. A CDN would mainly help static images. |
| Blue-green and canary deployments | Possible on Railway, but with a few dozen users a test run before deploying gives the same safety. |
| Garbage collection, memory leaks, thread safety | Handled by Node's runtime. The in-memory maps (`attempts`, `byAddress`, `apiHits`) are swept regularly so they cannot grow without limit. |
| Optimistic and pessimistic locking | One server process serialises writes. Two advisors editing the same student at the same moment is the remaining case: the last save wins. See the next steps. |
| N+1 queries, query optimisation | The whole store is loaded into memory once, so a page never makes many small database queries. |
| CAP theorem, eventual consistency | One database, so there is nothing to keep in agreement. |
| OAuth, JWT rotation | Sessions are server-side and can be ended instantly (the dashboard's "Sign out"). JWTs are harder to revoke. University single sign-on (OAuth with Microsoft) is a good future step. |
| WAF, DDoS protection | Partly covered by Railway's edge and by the rate limits. A service such as Cloudflare in front adds more. |
| SLOs, SLIs, error budgets, distributed tracing | Useful when a team runs a service with promises to many users. A simple goal, such as "the portal answers within 2 s, 99.5% of the time during registration", is enough here. |

**Worth doing next**

1. **CI on GitHub**: a `.github/workflows/test.yml` that runs `npm ci && node build.js && npm test`
   on every push, so a broken change is caught before `railway up`.
2. **Optimistic locking on student records**: send the `updatedAt` you loaded, and let the
   server refuse the save if someone else saved in between.
3. **University single sign-on** with BAU's Microsoft accounts, so nobody needs a separate password.
4. **Two-step sign-in (2FA) for superadmins**: that account can see every student.
5. **An uptime check** (for example UptimeRobot on `/health`) that emails you when the site is down.
6. **Database backups you have tested**: restore one to a test database once a term.

---

## Part 6. Making it work for any faculty

What BAU looks like, from its catalogues and website: 10 faculties (Architecture –
Design & Built Environment, Business Administration, Dentistry, Engineering, Health
Sciences, Human Sciences, Law & Political Science, Medicine, Pharmacy, Science) on
four campuses (Beirut, Debbieh, Tripoli and Bekaa). Not every faculty runs on every
campus: Tripoli, for example, has Business Administration, Architecture,
Engineering, Science and Health Sciences. All programmes use the credit-hour
system, but load limits differ. Humanities faculties allow 9 to 18 credits in fall
and spring, for example.

How the system already handles this:

- **The organisation tree** holds any faculty, department and programme, each
  programme with its own campuses.
- **Each programme has its own study plan** (Programme setup) and its own rule
  overrides (Rules studio, stored under `config/<programme>/rules`). University-wide
  rules stay shared.
- **Scoped roles**: a faculty admin manages only their faculty, and a programme
  editor only their study plan. A new faculty can run itself without a superadmin.
- **The admin dashboard's Programmes tab** shows which programmes are ready (a checked
  plan plus at least one advisor) and which need work.

What I changed to help:

- `STAFF_EMAIL_DOMAINS` makes the staff email domain a setting, not code.
- Student emails are signed with each advisor's own title and the university name
  from the tree, instead of always "Dr." and a fixed name.

Steps to roll out a new faculty, in order:

1. Superadmin: University structure → check the faculty, departments and programmes.
2. Invite a **faculty admin** for that faculty (People → Invite, role Faculty admin).
3. The faculty admin or a programme editor opens **Programme setup**, checks the
   catalogue plan course by course, and marks it ready.
4. In the **Rules studio**, set that faculty's own limits (for example 9–18 credits
   for a humanities faculty) and publish with a reason.
5. Invite the advisors with role Advisor, scoped to their programme.
6. Advisors import their PDFs. Then watch the dashboard's Programmes tab turn green.

Gaps to discuss with the faculties:

- Each faculty's transcript and schedule PDF layout must be tested with the importer
  (`src/pdfimport.js` was built from Science printouts).
- Some rules differ by faculty and are still university-wide in `rules.json`
  (probation thresholds in Medicine and Dentistry, for example). Each one needs to
  be confirmed against that faculty's regulations before it is turned into a
  per-faculty setting.
- Campus is stored on the programme. If an advisor works on one campus only, a campus
  field on the advisor role would let the lists filter by campus automatically.

---

## Part 7. Running it yourself

```bash
npm install
node build.js
npm test
npm run demo
```

`npm run demo` opens an offline demo with fictional students, where nothing is saved.
To run the real server locally with your own data, use `npm start` with
`ALLOW_UNVERIFIED_SIGNUP=true` (for development only) and a `DATA_DIR`.

Deploying (after the tests pass):

```bash
git push
railway up
```

---

## Part 8. Exercises to learn from the code

1. **Trace a rule.** Find `REG-LOAD-01` in `data/rules.json`, then find every place it
   is used (`grep -n "REG-LOAD-01" src/*.js`). Change the maximum from 18 to 19 and run
   `node tests/rules.test.js`. Which tests break, and why?
2. **Follow a permission.** A faculty admin of Business tries to read a CS student.
   Walk through `mayTouch` → `canForOwner` → `Permissions.can` → `isWithin` and
   write down where it says no.
3. **Break it on purpose.** In a copy, remove `esc()` from a student's name in
   `viewStudents()`, import a student named `<img src=x onerror=alert(1)>`, and see
   the XSS happen. Then see how the CSP limits the damage. Put it back.
4. **Add an API route.** Add `/api/admin/ping`, superadmin-only, that returns the
   server time. Add a test for it in `tests/admin-dashboard.test.js`.
5. **Read a transaction.** In `postgres-store.js`, what happens if the audit insert
   fails after the data was written? (Hint: ROLLBACK.)
6. **Measure the hash.** Time `crypto.pbkdf2Sync('x', 'y', 310000, 32, 'sha256')`.
   Why is a slow hash good for passwords and bad for everything else?

---

## Part 9. What changed on 5 November 2026

- **Roles**: the dedicated superadmin account is `bau.advisingdesk@gmail.com` (created
  by default). A one-time correction leaves Dr. Julie Bu Daher (`j.budaher@bau.edu.lb`)
  as an advisor only, keeping her 32 students. It runs only if the superadmin account
  exists, so the portal is never left without one.
- **Admin dashboard** (`src/admin.js`, `adminApi()` in `server.js`): Overview, Programmes,
  People and access (sign people out), Activity (with CSV export) and Settings (a
  message for everyone, read-only mode).
- **Security fixes**: reset links and password clears need authority over every role the
  person holds (before, one shared scope was enough, so a faculty admin could take over
  an account that also worked elsewhere). Advisors can only write the storage keys the
  portal uses. Records have size caps. All API calls are rate limited. Slow clients
  are timed out. Crashes save pending data before exiting.
- **Design fixes**: the page had no mobile viewport tag, so phones showed the shrunken
  desktop layout. That is fixed, along with the Ask Me button and programme switcher on
  phones and the student filter chips.
