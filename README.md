# Online Advising System

The advising portal for Beirut Arab University, Faculty of Science, Department of Mathematics
and Computer Science.

Everything the portal knows about a student is read from the two PDFs the department already
prints from the student system: the transcript and the schedule. Nothing is typed twice.

## Data

- **Student records** are imported by authenticated advisors and stored server-side. Railway
  deployments require PostgreSQL; local JSON files are only for development and isolated tests.
  This repository contains no student records or registrar documents. Do not import real records
  until the existing Railway data is inventoried, the database schema is installed, and backups,
  TLS, permissions and restore procedures are verified.
- **Course sections** across Beirut and Debbieh, merged from the offering and from the sections
  supplied in the current course offering.
- **Staff directory** is stored as `people/<slug>` records with scoped role assignments.
  The encrypted application store also keeps the organisation hierarchy at `org/tree`.
  `data/faculty.json` is retained only as a one-time migration source; it is not bundled into
  the public page and is no longer an account allowlist.
- **Automated tests** cover synthetic academic cases, rendering and server security safeguards.

## This semester and the one being advised for

The department is in the first week of **Fall 2026/2027**. So:

- The **schedules** describe the semester running now. They are what "this term" checks against.
- The **Fall offering** describes the semester running now too, so it is not a filter for next term.
- **Recommendations target Spring 2026/2027**, the semester being advised for.

Until the Spring offering is published the recommendations follow the study plan, which alternates:
semesters 1, 3 and 5 are Fall courses, semesters 2, 4 and 6 are Spring courses. That was checked
against the Fall offering. Course seasons are configuration metadata, not generated from student
transcripts.

When the Spring offering comes out, load it in Import, choose Spring 2026/2027 as the semester it
is for, and every recommendation switches to real sections, times and campuses.

## Two sources, because neither is enough on its own

A transcript only lists courses that are finished and graded. What a student is sitting in right
now exists only on their schedule. The portal reads both and keeps them apart:

- **Passed** comes from the transcript and fills requirements.
- **Taking now** comes from the schedule. It is shown with a hatched bar on the progress view,
  marked on the contract sheet, and listed above the transcript.
- **Planning next term** assumes this term's courses will be passed, so the prerequisites that
  open up are the ones that will actually be open by registration.

## Campus

BAU section labels carry the campus: B is Beirut, D is Debbieh. Each student's campus is read
from their own schedule, the offering keeps the campus of every section, and a student with
courses on two campuses in one week is flagged, because that is a travel problem the advisor
should see.

## Trying courses before registration

On **Plan next term** the advisor picks a recommended course, chooses one of its real sections,
and it drops onto a week grid. Credits count up against the student's limit, clashes turn red,
a Debbieh section next to a Beirut one raises the campus warning, and prerequisites are checked
against what the student will have passed by then. Nothing is registered: it is a trial.

## The course chain

Every faculty and major core course laid out in its study-plan semester, with an arrow from each
course to what it opens. Four states: passed, taking now, can take next, still blocked. Tap a
course to trace its line up and down the chain.

## Which semester a course runs in

A course only has to be taken in a semester it actually opens in. The portal uses the course
season configuration and the offering it holds, which settles it for the term the offering
covers.

That is why a spring course failed last year is no longer held against a fall registration. It
is listed under **To take again**, in the group that waits for the next semester, and the
advisor is not sent chasing a section that does not exist.

## Which failed courses actually have to be taken again

Not all of them, and treating them alike sends students back into courses the degree does not
need, which can cost a whole semester.

- **Required courses** (university mandatory, faculty core, major core, foundation courses and
  intensive English levels) have to be taken again. Nothing else fills their place.
- **Electives** (university, departmental, general science) do not. The block can be filled from
  the same pool, so the portal says "repeat or replace" and leaves the choice with the advisor.
  Worth knowing when deciding: repeating the same course replaces the grade in the CGPA, while a
  different elective fills the requirement and leaves the failed attempt in the average.
- **Anything the degree no longer needs**, including courses from another programme and blocks
  that are already full, is not raised at all.

## What skipping a course costs

A prerequisite missed in the fall does not cost a semester when the course behind it runs every
term. It costs a year when that course runs in the spring only. The portal works this out and
says it in the sentence: leaving CMPS248 this fall pushes Theory of Computation from Spring
2026/2027 to Spring 2027/2028. The same check catches a withdrawal nobody went back for, which
no repeat rule would have caught, because a W is not a fail.

## Which course to take again first

Repeats are ordered by how much of the degree sits behind them. The portal uses the number of degree credits blocked by each repeat to help prioritize
recommendations and explain what is delaying registration.

## Where the numbers come from

The transcript is the authority. Two counts are kept apart on purpose:

| Question | How it is counted |
|---|---|
| CGPA, and the total the transcript prints | Every attempt except the ones the registrar annulled. |
| Credits toward the degree | The same, minus the blocks that are not part of the degree: the 30 credit freshman equivalency block and any course belonging to another programme. This is the number shown everywhere in the portal, out of 100. |
| Has a requirement been met | One attempt per course. Passing a course twice fills the requirement once, and a block never reads as more than full. |

The transcript marks each row `I` (the attempt that counts), `A` (annulled by a retake) or
`N` (transferred). Where those marks exist the engine follows them instead of guessing which
attempt was better.

The configured grade scale is A+ and A 4.00, A- 3.67, B+ 3.33, B 3.00, B- 2.67, C+ 2.33,
C 2.00, C- 1.67, **D 1.33**, F 0.00.

## Rules the portal applies

- **Load**: 12 to 18 credits in a normal semester; up to 21 with CGPA 3.33 and 34 credits
  earned; 12 while on academic probation; 9 in summer.
- **Standing**: probation when the term GPA and CGPA are both under 2.00; dismissal risk under
  1.60. A term with no graded courses (foundation-only or pass/fail) has no average, so it never
  triggers either.
- **Prerequisites**: enforced, and a prerequisite taken in the same semester does not count.
- **Timetable**: two sections overlapping on the same day and hour are a clash.
  Consecutive classes on different campuses get a warning when the gap is under one hour.
- **Work Ready Now (WRNL200)**: required for students admitted from 2024/2025 on (by admission
  term, not ID, since transfer students keep an older ID). Past 50 credits it is a note for an
  upcoming contract; it becomes something to chase when 12 credits or fewer are left.
- **Semester number**: counted from the admission term, so earlier terms of a transfer student
  are not counted as semesters in this programme.
- **IC3**: due by semester 4.
- **University electives**: 8 credits for the 2026 catalogue, including at least one humanities
  course and one social science course, where SOCI and PSYC both count as social science.
- **Repeats**: D- and F must be taken again; a passed course may be repeated for a better grade.
- **Tracks**: three departmental electives from one list earn Software Development, Cybersecurity,
  or AI and Data Science. Without a track the nine credits can come from any departmental elective.
  The portal works out which track a student is heading for from what they have taken.
- **Senior Project**: no course prerequisite and no credit threshold are published, so the
  portal does not invent one. The department decides when a student takes it.
- **Degree**: 100 credits and CGPA 2.00. Checked against the BAU programme page: 16 university,
  17 faculty core, 53 major core, 9 departmental electives, and 5 general science. Progress is
  the sum of capped requirement blocks, so extra courses never inflate a block or the total.
- **Mathematics minor**: 18 separate MATH credits including MATH246 Real Analysis I or MATH346
  Abstract Algebra I. Courses already used by Computer Science core, departmental electives, or
  General Science are excluded from the minor count.
- **Foundation students**: foundation courses come first; CMPS241 may be taken with them in the
  first semester, while courses such as MATH241 wait until the foundation work is completed.

## What the advisor sees

- **All students** — the whole caseload, searchable, with the students who need attention first.
  The same page keeps the summary counts, including how many students have no schedule, so there
  is no separate “To review” page.
- **A student** — six tabs: Progress (requirement blocks with what is on the way, graduation
  check, Mathematics minor when it applies, contact), This term (what they registered, checked
  against every rule, campus per course, the week laid out), Plan next term (recommendations and
  the trial schedule), Course chain, Contract sheet (printable), Transcript (with what they are
  taking now above it).
- **Import** — transcripts, schedules and a course offering CSV.
- **Suggestions for the portal** — a shared board where any advisor writes what the portal should do next, or what
  looks wrong. Everyone sees it, anyone can add "I want this too", and it is what the next
  version is built from.
- **Ask Me** — a deterministic, rule-based guide for the rules, the offering, or any student. It
  runs entirely inside the page, uses no AI model or external API, and sends nothing anywhere.
- **Reports and copies** — one place in the advisor profile for an Excel report containing the
  student summary and all transcript courses, plus a clean PDF summary.
- **Email** — five ready messages that open in the advisor's own mail app, so they are sent
  from their BAU address.
- **What to do next** — one line at the top of every student, in plain words: register them,
  fix this term, or here is what to take next semester.
- **Sign in** — photo, BAU email, own password. A forgotten password is reset through a
  single-use link sent to the advisor's BAU mailbox, so typing or knowing the address is not
  enough to take the account. Changing a password still needs the current one.
- **People** — superadmins and faculty admins can search staff in their authorised scope,
  invite BAU email addresses, update profiles and roles, and deactivate accounts without
  deleting student records. The server checks every scope and permission; invitation links are
  single-use and expire.
- **Organisation and roles** — the tree is University > Faculty > Department > Programme.
  The first startup seeds the Science > Mathematics and Computer Science > `cs` tree and imports
  legacy staff profiles idempotently. Existing account hashes are retained. The existing
  `ADMIN_SLUGS` setting remains a bootstrap superadmin list.

## When another doctor loads their own students

Each advisor imports their own two files; nothing of another advisor's list is involved. What the import
does is deliberately narrow:

- a transcript **creates** the student, or **updates** the one already in that advisor's list;
- the transcript wins on the courses, the grades and the official CGPA and credits, because that
  is what it is the authority for;
- the advisor's own work is never overwritten: their note, the email and phone they typed, the
  campus, and this term's schedule;
- a schedule attaches by student ID, sets the campus from the section label, and any ID in the
  file that is not in that advisor's list is **named in the result** rather than quietly dropped;
- every transcript is checked against its own printed CGPA and credit total, and any page that
  does not reconcile is listed by name;
- **Undo** puts the records back exactly as they were before the last file, in case the wrong one
  was loaded.

Import tests use isolated test-only data and do not seed production storage.

## Files

```
server.js           HTTP server: sign-in, sessions, email verification, per-advisor storage
src/postgres-store.js PostgreSQL persistence for application data and audit events
db/migrations/      explicit PostgreSQL schema migrations
mail.js             outgoing mail over SMTP or an HTTPS mail API
build.js            builds build/index.html (minified client)
src/engine.js       the rules: GPA, standing, prerequisites, registration checks, alerts
src/pdfimport.js    reading the registrar's transcript and schedule PDFs in the browser
src/merge.js        folding an import into an advisor's list
src/store.js        client data layer (server API; demo mode is memory-only)
src/app.js          the interface (with askme.js, rulesadmin.js and i18n.js inlined)
web/shell.html      markup and styling
data/catalog.json   curriculum, requirement blocks, electives, prerequisites
data/rules.json     the regulations, with a citation on each rule
data/faculty.json   legacy staff data, read only by the one-time migration
src/org-tree.js     organisation tree validation and legacy staff migration
src/permissions.js  role permissions and inherited scope checks
data/offering.json  course sections for the current term
tests/              unit, rendering, server-safety and browser end-to-end tests
```

## Running it

```bash
npm install                                   # build and PostgreSQL dependencies
npm start                                     # local only: http://localhost:3000
npm test                                      # unit, rendering and server tests
npm run test:security                         # browser end-to-end checks (Playwright)
```

On Windows (Command Prompt) set variables first, then `npm start`. Public sign-up is disabled;
`ALLOW_UNVERIFIED_SIGNUP` does not bypass invitations. Use an existing migrated account or ask
an active administrator to send an invitation. The app migrates the organisation tree and staff
profiles automatically at startup; it does not import student records. Production settings,
email and backups are described in `DEPLOY.md`.

The optional synthetic organisation extension is run manually, never at server startup:

```powershell
$env:BAU_DEMO_BASE_URL = "http://localhost:3000"
$env:BAU_DEMO_ADMIN_COOKIE = "sid=<session-cookie>"
npm run seed-demo-org
```

It adds only the invented demo faculties and people; `test.*@bau.edu.lb` invitations are logged
for local testing instead of emailed.

## Printing

The contract sheet prints as its own document, built and sent to the printer from its own frame.
That matters because the portal runs inside a frame, where asking the browser to print can print
the wrong page. If a browser blocks it, the sheet opens in a new tab instead.

## Known limits

- **Opened as a file, the page has no server**: records stay in that browser and sign-in is
  only a local check. Use it for demonstrations, never for real records.
- **The offering is partial.** It covers the pages that were shared plus every section a student
  is registered in. A course missing from it is reported as "not in the synced list", never as
  "not offered". Upload a full CSV to replace it.
- **The student-facing side of the older prototype is gone on purpose.** Students no longer fill
  in their own contract sheet, because the transcript and schedule already carry everything.
- **`mis.bau.edu.lb` cannot be read directly** from a server. The CSV and PDF imports are the
  supported path.
