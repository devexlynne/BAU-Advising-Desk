# Deploying the Online Advising System

Railway hosts the portal. Initial setup requires a database administrator to back up and inspect
existing data, apply the schema, configure restricted access, and verify restore procedures before
real student records are imported.

## What the advisors get

One web address. Each of them taps their photo, sets a password the first time, and from then on
sees their own advisees on any device, phone included. What one advisor imports is there for
them everywhere, and is not visible to anyone else.

## Moving or restoring deployment

Do not create another public service or copy data yet. Choose a university-approved host first,
then provision an empty target database and test the application with no real records. The
Railway inventory and backup process below comes before any decision to move existing data.

> **Do not import real student records yet.** Production now requires PostgreSQL, but your
> existing Railway database and volume have not been inspected from this checkout. Preserve both.
> This version does not automatically import old JSON files or adopt an unknown existing schema.
> Inventory and back up both sources, verify the new schema and restore process, and reconcile
> existing data before opening imports to advisors.

When Railway access is restored, an authorized administrator can run `npm run inventory:volume`
in the app container and `npm run inventory:postgres` in a private environment with the database
URL referenced privately. The PostgreSQL command prints only table names, estimated row counts
and sizes—never student names, IDs, transcripts, or row values. Estimates can be stale. Never
paste connection strings, student records, raw store files, or screenshots containing them into
GitHub or chat.

## 1. Put the folder in a Git repository

```bash
cd portal
git init
git add .
git commit -m "Online Advising System"
```

Do not commit or push real student records, registrar PDFs, screenshots, or recordings. Imports
must be made by each authenticated advisor; records must not be stored in source control.

Or skip Git entirely with Railway's own tool, from inside the folder:

```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

## 2. Create the Railway project

1. railway.app, open the existing project and select the private repository.
2. Add the PostgreSQL connection and complete the database steps below before expecting the
   app to become healthy. Production intentionally refuses to start with file storage or an
   unconfigured database.
3. Generate a public app domain only after storage, access control, mail, and backup checks pass.

## 3. Connect PostgreSQL

1. For a clean deployment, add a new empty PostgreSQL service in the new Railway project. Do not
   connect it to the old app's volume or overwrite/restore any existing database. Keep old data
   sources untouched until their contents have been safely inventoried.
2. In the app service, reference the new database's private `DATABASE_URL` variable. Do not expose
   the database through public TCP access for the app.
3. The server verifies TLS certificates and hostnames. Railway's official PostgreSQL template
   enables TLS with a private CA; set `DATABASE_SSL_CA` to the PostgreSQL service's trusted root
   certificate (the official template stores it at `/var/lib/postgresql/data/certs/root.crt`).
   The default hostname check uses the host in `DATABASE_URL`. If the database certificate is
   issued for a different DNS name, set `DATABASE_SSL_SERVER_NAME` to the exact certificate
   hostname (for example, `localhost` only if that is the certificate's name). The app explicitly
   verifies the certificate against that name while still validating its chain against the trusted
   CA; it does not disable TLS verification. Never set `DATABASE_SSL=disable` in production.
   Test a connection from the app service before importing.
4. Use separate credentials: a database administrator URL only for the one-off schema migration,
   and a non-owner runtime role for the app. The runtime role must not be a superuser, database
   owner, or schema/table owner, and must not have schema/database create privileges. Grant it
   `USAGE` on schema `public`; `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on
   `advising_app_data`; `INSERT` on `advising_audit_log`; and `USAGE` on
   `advising_audit_log_id_seq`. The app refuses broader effective grants. Set
   `DATABASE_MIGRATION_URL` only in the one-off migration environment; never set it on the app.
5. Apply the additive schema explicitly with `npm run db:migrate` from a one-off private
   environment inside the same Railway project. Do not run it until the PostgreSQL service is
   confirmed empty and the administrator confirms this schema does not conflict with existing
   tables.
6. Deploy the app only after the migration succeeds. On Railway, the application checks
   `/data/store.json` for a non-empty legacy store and fails closed instead of ignoring it.
   It also fails closed if the database URL or required tables are missing.
   `ENABLE_STUDENT_IMPORTS` defaults to `false` in production; leave it off until the
   administrator has verified the data inventory and storage protections.

Application records are persisted in PostgreSQL tables `advising_app_data` and
`advising_audit_log`. The schema migration does not copy, delete or rewrite any existing data.
The application currently supports one running server instance; do not scale the service to
multiple replicas.

## 4. Set these variables

Required:

| Variable | Example | Purpose |
|---|---|---|
| `DATABASE_URL` | Railway private variable reference | PostgreSQL connection |
| `PUBLIC_URL` | `https://advising.example.edu` | base of the activation and reset links |
| `MAIL_FROM` | `Online Advising System <advising@example.edu>` | sender of every email |
| `SMTP_URL`, or `MAIL_API_URL` + `MAIL_API_KEY` | see step 5 | how email is sent |

Optional (defaults in brackets):

| Variable | Purpose |
|---|---|
| `DATABASE_SSL_CA` | trusted CA PEM; required for Railway's official self-signed PostgreSQL template |
| `DATABASE_SSL_SERVER_NAME` | certificate DNS name to verify when it differs from the database URL hostname |
| `DATABASE_MIGRATION_URL` | one-off migration environment only; never set on the running app service |
| `ADMIN_SLUGS` | portal admins, comma-separated (faculty.json entries with `"admin": true`) |
| `IDEAS_TO` | where suggestions are emailed (the admins' addresses) |
| `ALLOW_SIGNUP` | `false` closes sign-up once everyone has an account (`true`) |
| `ENABLE_STUDENT_IMPORTS` | keep `false` until storage and prior-data checks are complete |
| `SESSION_HOURS` / `SESSION_IDLE_MINUTES` | session lifetime and idle timeout (`12` / `120`) |
| `RESET_MINUTES` / `VERIFY_HOURS` | lifetime of reset and activation links (`30` / `24`) |
| `MAIL_DOMAINS` | domains the portal may email (`bau.edu.lb,student.bau.edu.lb`) |
| `MAIL_PER_DAY` | messages one advisor may send per day (`200`) |
| `TRUST_PROXY` | `false` when the server is reached directly, not behind a proxy (`true`) |
| `ALLOW_UNVERIFIED_SIGNUP` | local development only; the server refuses to start in production if enabled (`false`) |

For a fresh Railway deployment, provision a separate PostgreSQL service first. The existing
app-only project and its `/data` volume are not a database. Keep the old volume intact and do not
attach it to the new service or enable imports until its contents are inventoried and preserved.

Numeric values are checked at start-up; an invalid one stops the server with a message instead of
running with unsafe settings.

**Sign-up requires working email.** Without `MAIL_FROM`, a mail transport and `PUBLIC_URL`, new
accounts are refused (anyone who knows an advisor's address could otherwise claim the account).
Once every advisor has an account, set `ALLOW_SIGNUP=false`.

## 5. Let them reset a forgotten password from their BAU inbox

The portal resets forgotten passwords with a one-time link sent to the BAU address on the
account. Opening that link proves the advisor can read that mailbox.

Set **one** of these, then redeploy:

| Way | Variables |
|---|---|
| The university's mail server | `SMTP_URL=smtp://user:password@smtp.bau.edu.lb:587` (STARTTLS) or `smtps://…:465` |
| A mail service (Resend, Postmark and the like) | `MAIL_API_URL=https://api.resend.com/emails` and `MAIL_API_KEY=…` |

New accounts are activated from a link sent to the advisor's BAU address: they open it and type
the password they chose. For good deliverability, send from an address on a domain whose SPF and
DKIM records authorise the mail service (ask the university's IT department).

How it behaves:

- The advisor taps their photo, then **I forgot my password**, then **Email me a reset link**.
- The answer is the same whether or not that account exists, so the page cannot be used to find
  out who has one.
- The link lasts thirty minutes, works once, and the token is stored only as a hash.
- Opening it asks for a new password, signs them in, and ends every other session that account had.
- With mail switched on, confirming the BAU address by typing it is refused: the link is the only
  email-based route, because reading the mailbox is the thing being proved.
- The portal admin can also clear an advisor's password from the Everyone page (Forgotten
  password, Clear password); the advisor then creates the account again. Student records remain.

## 5b. Tell the doctors

> The advising portal is at `https://…`. Open it, tap your photo, and choose a password of at
> least ten characters. If you forget it, ask the portal to email a one-time reset link to your
> BAU inbox. Your students are yours; no other advisor can see them.

## What is protected, and how

- **Passwords never leave the server.** The browser sends the password once over HTTPS; the
  server checks it with PBKDF2-SHA256, 310,000 rounds, a fresh salt per account, and a
  constant-time comparison. Nothing reversible is stored.
- **Sessions are cookies the page cannot read**: HttpOnly, SameSite=Lax, Secure over HTTPS,
  twelve hours by default with a two-hour idle timeout. Only a hash of each session is stored. Signing out ends the session on the server, not just in the browser.
  Changing a password ends every other session for that advisor; resetting one ends all of them.
- **Every record is checked against who is asking.** An advisor can read and write only
  `advisors/<their own slug>/…`, plus the shared course offering and cover photo. Another
  advisor's students come back 403. Account records are never served to any page. Portal admins
  can manage every advisor's list (to import on their behalf or move a student).
- **Security-relevant activity is audited.** Sign-ins (and failed ones), account changes,
  imports, record changes, admin actions and portal email sends are stored transactionally in
  PostgreSQL. Audit entries do not include student names, transcript contents or student IDs.
  Reads of individual student records are not currently logged.
- **Database transport is verified.** PostgreSQL connections use TLS certificate validation;
  the application does not encrypt individual student fields. Confirm Railway's at-rest and
  backup encryption and access controls meet university policy before import.
- **Outgoing mail is limited** to university addresses (`MAIL_DOMAINS`) with a daily cap.
- **The page build does not embed student records.** The authenticated server supplies them
  after sign-in. Local browser storage is disabled unless the page is explicitly marked as an
  offline demo; the local preview server is loopback-only and refuses to start on Railway or in
  production.
- **Guessing is slowed down.** Five tries, then a wait that doubles up to fifteen minutes, per
  account and per address.
- **Headers**: a content security policy, `nosniff`, `frame-ancestors 'none'`, no referrer, and
  HSTS when the connection is HTTPS. Railway terminates TLS, so it is.

## Where the advisors' suggestions go

The Ideas tab posts to the shared board inside the portal and, once mail is set up, emails the
same thing to `IDEAS_TO` (by default, the portal admins' addresses). The email carries
the advisor's name, their BAU address and what they wrote, so a reply goes straight back to them.
The server writes the author from the session, not from the page, so a suggestion cannot be
posted under somebody else's name.

## Backups and recovery

- Configure Railway PostgreSQL backups or point-in-time recovery on the PostgreSQL service before
  importing records, and confirm the retention period meets the university's requirements. These
  are Railway project settings and cannot be enabled by this application.
- Keep an independent encrypted backup in an institution-approved location and test restoring it
  to a separate database. A backup is not verified until a restore has been tested.
- The service checks storage writes before confirming API changes and returns an error when the
  database or audit log cannot be written.
- Keep the old mounted volume intact until its records and any JSON backups are inventoried and
  either migrated by a reviewed process or formally confirmed unnecessary.

## Before it becomes the department's system of record

- **University single sign-on**, so accounts are managed centrally.
- **Off-site, encrypted backups** on a schedule, with a tested restore.
- **A data protection note.** Real student records are personal data. Whoever owns the service in
  the department should be able to say where it is hosted and who can reach it.
- **Institutional approval** of PostgreSQL hosting, encryption at rest, access roles, retention
  and breach-response procedures before the system becomes the official record.
- **A recovery and availability plan.** This app currently holds a single-instance database
  lock and is not configured for multiple replicas or automatic failover.

## Running it on your own machine first

```bash
ALLOW_UNVERIFIED_SIGNUP=true npm start   # local only; records use ignored files in ./data-store
npm test                 # rules, imports, rendering and server safeguards
npm run test:security    # a real browser against a real server: sessions, scoping, rate limits
npm run test:email       # the forgotten-password flow, against a stand-in mail server
npm run test:full        # one run through the whole portal the way an advisor uses it
```

`npm run test:email` starts a small test-only mail server in `tests/fake-smtp.js`, so it proves the
whole path without sending anything to a real address. Tests do not seed Railway or production
storage.
