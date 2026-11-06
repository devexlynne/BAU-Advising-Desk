# Deploying the Online Advising System

Railway hosts the portal. Initial setup requires a database administrator to back up and inspect
existing data, apply the schema, configure restricted access, and verify restore procedures before
real student records are imported.

## What the advisors get

One web address. Staff sign in with their BAU email and password. A scoped administrator invites
staff through the People page; invitees set their own password from a single-use email link.
Advisors see their own advisees, and administrators only see records allowed by their assigned
scope.

## Moving or restoring deployment

Do not create another public service or copy data yet. Choose a university-approved host first,
then provision an empty target database and test the application with no real records. The
Railway inventory and backup process below comes before any decision to move existing data.

> **Where the data is today.** The live service keeps everything in one AES-256-GCM encrypted
> file on its Railway volume (`/data/store.json`, unlocked with `STORE_KEY`). That is a supported
> production setup: the server refuses to start in production without either `STORE_KEY` or
> PostgreSQL. Sections 3 and "Moving the Railway volume into PostgreSQL" only apply on the day the
> portal moves to a database.

> **Do not import real student records yet.** If you move to PostgreSQL, note that your
> existing Railway database and volume have not been inspected from this checkout. Preserve both.
> Old JSON files are copied only when `MIGRATE_FROM_VOLUME=true` is set, and an unknown existing schema is never adopted.
> Inventory and back up both sources, verify the new schema and restore process, and reconcile
> existing data before opening imports to advisors.

When Railway access is restored, an authorized administrator can run `npm run inventory:volume`
in the app container and `npm run inventory:postgres` in a private environment with the database
URL referenced privately. The PostgreSQL command prints only table names, estimated row counts
and sizes—never student names, IDs, transcripts, or row values. Estimates can be stale. Never
paste connection strings, student records, raw store files, or screenshots containing them into
GitHub or chat.

## Moving the Railway volume into PostgreSQL (one time, later)

The live service started on encrypted files on the `/data` volume (`STORE_KEY`). These steps move
everything (people, accounts, students, settings and the activity log) into PostgreSQL. The
volume files are only set aside after every record has been copied and read back identically;
if anything fails, the server stops and the volume is left as it was.

1. **Deploy this version first** (`railway up`). It still runs on the volume.
2. **Add PostgreSQL** to the same project: *+ New → Database → PostgreSQL*. Wait until it is
   running. Do not attach the app's volume to it.
3. **Prepare the database.** Copy `DATABASE_URL` from the PostgreSQL service's *Variables* tab
   (it starts with `postgresql://postgres:`). Then, on your computer, in the project folder:

   ```
   railway ssh
   DATABASE_MIGRATION_URL='paste-it-here' npm run db:setup
   exit
   ```

   It installs the tables, creates the limited `advising_app` account, checks that account the way
   the server will, and prints the variables for step 4, including the database's root
   certificate. Running it again gives `advising_app` a new password.
4. **Pick a quiet moment** (nobody signed in), then set on the **app** service: `DATABASE_URL`,
   `DATABASE_SSL_CA`, `DATABASE_SSL_SERVER_NAME` and `MIGRATE_FROM_VOLUME=true`, exactly as printed.
   Keep `STORE_KEY`. Railway redeploys; the start-up log shows
   `moved the volume store into PostgreSQL: … keys … student records` and the names the old files
   were kept under (`store.json.migrated-…`).
5. **Check:** sign in as superadmin. *Admin dashboard → System health → Storage* says **PostgreSQL**.
   Then remove `MIGRATE_FROM_VOLUME` (it does nothing once the volume store is set aside).

If the database certificate is renewed by Railway (about every 820 days), run
`npm run db:setup -- --ca-only` the same way and replace `DATABASE_SSL_CA`.

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
| `ADMIN_SLUGS` | bootstrap superadmin slugs, comma-separated; retain this setting to preserve emergency admin access |
| `SUPERADMIN_EMAIL` | the dedicated superadmin account, created at start-up (`bau.advisingdesk@gmail.com`; `none` turns it off) |
| `ADVISOR_ONLY_EMAILS` | one-time correction at the next start-up: these people keep only their advisor roles (`j.budaher@bau.edu.lb`) |
| `STAFF_EMAIL_DOMAINS` | email domains staff may sign in and be invited with (`bau.edu.lb`) |
| `API_PER_MINUTE` | API requests allowed per address per minute, on top of the sign-in limits (`600`) |
| `IDEAS_TO` | where suggestions are emailed (the admins' addresses) |
| `ENABLE_STUDENT_IMPORTS` | keep `false` until storage and prior-data checks are complete |
| `SESSION_HOURS` / `SESSION_IDLE_MINUTES` | session lifetime and idle timeout (`12` / `120`) |
| `RESET_MINUTES` / `VERIFY_HOURS` | lifetime of reset and activation links (`30` / `24`) |
| `MAIL_DOMAINS` | domains the portal may email (`bau.edu.lb,student.bau.edu.lb`) |
| `MAIL_PER_DAY` | messages one advisor may send per day (`200`) |
| `TRUST_PROXY` | `false` when the server is reached directly, not behind a proxy (`true`) |
| `ALLOW_UNVERIFIED_SIGNUP` | development-only email-verification escape; never allows uninvited sign-up (`false`) |

For a fresh Railway deployment, provision a separate PostgreSQL service first. The existing
app-only project and its `/data` volume are not a database. Keep the old volume intact and do not
attach it to the new service or enable imports until its contents are inventoried and preserved.

Numeric values are checked at start-up; an invalid one stops the server with a message instead of
running with unsafe settings.

**Accounts are invitation-only.** Public sign-up is refused regardless of `ALLOW_SIGNUP`.
Invitations require a working mail transport and `PUBLIC_URL`, except local `test.*@bau.edu.lb`
addresses, whose invite links are logged for synthetic testing. Existing accounts keep their
password hashes and sign in using the BAU email stored in their migrated person profile.

On the first server start after deployment, the app seeds `org/tree` if missing and imports
`data/faculty.json` into `people/<slug>` only when there are no people records. This is idempotent.
Existing `advisors/<slug>/account` entries and their password hashes are retained. The staff list
is no longer public or the source of truth after migration. Back up the current store and verify
that existing accounts are present before starting the new version; do not upload student records
to perform the staff migration.

Keep the current admin slugs in `ADMIN_SLUGS` during and after migration. The role UI prevents
removing or demoting the last superadmin. Use People to invite and manage staff once a superadmin
can sign in.

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
