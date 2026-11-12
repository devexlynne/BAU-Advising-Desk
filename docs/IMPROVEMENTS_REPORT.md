# What changed in the November 2026 pass

This is a record of the work done on the `hardening-and-features` branch, starting from
`b7a2664` (the merge of the university-programmes work). I went through the server, the client and
the tests against the OWASP Top 10 (2025), ASVS 5.0 and the Node.js security guide, fixed what I
found, added the features we had been putting off, and then spent a day on the interface with
screenshots of every main screen. Nothing here touches real student data. Every test uses invented
staff and the demo students (IDs starting 99).

Storage is still the encrypted file on the volume (`/data/store.json` with `STORE_KEY`).
PostgreSQL support is in the code but stays switched off, as agreed.

## Summary

| # | Change | Why | Source | Risk if left | Main files |
|---|---|---|---|---|---|
| 1 | Password hashing raised to 600,000 PBKDF2 rounds, old hashes upgraded at sign-in | 310,000 was the old OWASP figure | OWASP Password Storage | Medium | `server/passwords.js`, `server.js` |
| 2 | Emailed links built only from `PUBLIC_URL`; production will not start without an https one | Host header could steer reset links | ASVS 5.0, OWASP A01/A02 | High | `server.js` |
| 3 | Header, request and keep-alive timeouts | Slow clients could hold connections open | Node.js security guide (CWE-400) | Medium | `server/http-guards.js` |
| 4 | JSON bodies with `__proto__`, `constructor` or `prototype` keys refused | Prototype pollution | OWASP cheat sheet (CWE-1321) | Medium | `server/http-guards.js` |
| 5 | Arabic subjects encoded properly, mail bodies sent as base64 | Arabic names broke subjects; a line with one dot could cut a message | RFC 2047, RFC 5322 | Low | `mail.js` |
| 6 | Script CSP uses hashes, no `unsafe-inline`; `object-src 'none'` | An injected script would have run | OWASP CSP cheat sheet | High | `server.js` |
| 7 | Crash handler exits instead of carrying on | A half-failed write could be confirmed | OWASP A10:2025 | Medium | `server.js` |
| 8 | No install scripts, exact versions, Node 22, CI with `npm audit` | Supply chain | OWASP A03:2025 (CWE-1357) | Medium | `.npmrc`, `package.json`, `.github/workflows/ci.yml` |
| 9 | Backups can leave the server; restore and key change scripts | Backups lived on the same disk as the data | ASVS 5.0 (V14) | High | `server/backup-files.js`, `scripts/` |
| 10 | Reads of another advisor's students are audited | We could not say who looked at whose list | OWASP Logging cheat sheet | Medium | `server.js` |
| 11 | Browser-side password code removed | Dead code with a 32-bit fallback hash | | Low | `src/store.js` |
| 12 | Browser tests rewritten for invite-only accounts | Three suites were broken and hung | | Medium | `tests/*.e2e.js` |
| 13 | Advisors see only their own students; admins keep scoped access | Same-programme advisors could read and change each other's students | OWASP A01:2025 | High | `server.js` |

Features: saved term plans with a print view, overriding a blocked check with a reason, a list of
your own sessions with "sign out everywhere else", and an Activity and backups page for
superadmins.

Interface: Arabic layout, several phone problems (one of them meant you could not change your
password on a phone at all), empty states, form labels and placeholders.

## Security changes

### 1. Password hashing

New and changed passwords are hashed with PBKDF2-HMAC-SHA256 at 600,000 iterations, which is what
OWASP recommends today. Existing accounts were hashed at 310,000. Their records have no iteration
count, so the server treats a missing count as 310,000, checks the password at that cost, and if
it is right, hashes it again at 600,000 with a new salt. The person notices nothing. Each upgrade
is written to the audit log as `password-rehashed`.

All of this now lives in `server/passwords.js` instead of being spread through `server.js`. The
module also keeps the dummy hash we run when an email has no account, so a wrong email and a wrong
password take the same time to answer.

### 2. Links in emails

Invitation and reset links were built from `PUBLIC_URL` when it was set, and from the request's
Host header when it was not. Someone who can send a request with a forged Host header could get a
real reset email pointing at their own site. Now there is one function, `linkBase()`, used for every
emailed link. In production it uses `PUBLIC_URL` only, and the server refuses to start unless
`PUBLIC_URL` is an `https://` address. The Host fallback is kept for a developer's own machine.

### 3. Time limits on connections

Plain `http.createServer` waits a long time for a client that sends its headers one byte at a
time. Twenty such connections can tie the server up. The server now sets a headers timeout (20 s),
a request timeout (120 s), a keep-alive timeout (5 s) and a cap on requests per connection. A
client that runs out of time gets `408 Request Timeout` and the socket is closed. All four can be
changed through environment variables and are range-checked at start-up like the others.

### 4. JSON bodies

Every request body is parsed with a reviver that throws if it meets `__proto__`, `constructor` or
`prototype` as a key, at any depth. The request gets a 400 and nothing is stored. Student records
are merged and copied in several places, so this closes the door before any of that code runs.

### 5. Mail encoding

Subjects with Arabic names went out as raw UTF-8 in the header, which some mail servers mangle.
They are now encoded as RFC 2047 words and folded so no header line passes 78 characters. Bodies
are sent base64 encoded, which also removes the old dot-stuffing code: a line holding a single dot
can no longer end a message early. Header injection was already blocked (CR and LF are stripped
from every header value) and that is unchanged.

### 6. Content Security Policy

The whole app is inlined into one page, so the policy used to allow `'unsafe-inline'` for
scripts. That meant an injected `<script>` would have run. The server now computes the SHA-256 of
each inline script in the page it serves and lists those hashes instead. I added `object-src
'none'` while I was there.

One thing caught me: print windows are blank pages the app writes into, and they inherit the
policy. Their small auto-print script was being blocked. Its hash is now in the list too, and
`tests/features.test.js` checks it. Styles still allow inline, because the interface sets many
style attributes and CSS cannot run code. That is noted under "Not done".

### 7. Unexpected errors

An uncaught exception used to be logged and ignored. The process then carried on in an unknown
state, possibly halfway through a write. It now logs the error and exits, and Railway restarts it.
This is OWASP's new A10 (mishandling exceptional conditions).

### 8. Supply chain

`.npmrc` now has `ignore-scripts=true` (install scripts from dependencies do not run),
`save-exact=true` and `engine-strict=true`. Versions in `package.json` are pinned, Node 22 is
required, and the lock file is committed. A GitHub Actions workflow installs with `npm ci`, fails
on any high or critical `npm audit` finding, builds, and runs all four test commands. `npm audit`
reports 0 vulnerabilities today. The app still has only two runtime dependencies.

### 9. Backups

The hourly backups were encrypted, which is good, but they sat on the same volume as the data.
Losing the volume meant losing both. Three things fix that:

- A superadmin can download the newest backup from the new Activity and backups page. The file is
  the encrypted envelope as it is on disk, so it is useless without `STORE_KEY`. Downloads are
  refused when the store is not encrypted. The page shows when a copy was last taken off the
  server and warns after a week.
- `scripts/restore-backup.js` checks a backup with the key and reports what is in it. With `--yes`
  it puts it in place, keeping the replaced store as `store.json.before-restore-<time>`.
- `scripts/rotate-store-key.js` re-encrypts the store, every backup and every audit line with a
  new key. It decrypts everything first, so a wrong old key changes nothing.

`DEPLOY.md` has a new section on all of this. `tests/backup-tools.test.js` runs a real encrypted
server, downloads, restores (including with a wrong key) and rotates, then starts the server on the
new key and reads a record back.

### 10. Auditing reads

Writes were audited, reads were not. Superadmins and faculty admins can still open any advisor's
list in their scope (section 13), so those reads are now logged: `/api/get` and `/api/list` write
`read-other-students` with whose list and how many records, and the all-students view records the
count per advisor. Names and records never go into the log. Reading your own list
is not logged, since it happens on every page load.

I left the sign-in rate limits in memory on purpose and wrote down why in `DEPLOY.md`: storing the
counters would mean a full encrypted write of the store for every wrong password, which hands an
attacker a cheap way to load the disk.

### 11. Dead code

`src/store.js` still had the in-browser password hashing from the early prototype, including a
fallback to a 32-bit string hash. Nothing called it any more: the offline demo has no accounts and
the server does all password work. It is gone, with the helpers built on it.

### 12. Tests that had stopped working

The email, verification and full browser tests clicked a staff picker that was removed when
accounts became invite-only, and when a step failed they left the server running, so the command
hung. They now share `tests/helpers/e2e.js`, which starts the server on a seeded store, signs in
through the real form and always stops what it started. The email test covers the whole
invitation and reset path against a stand-in mail server and decodes the base64 bodies to find the
links. The verification test was folded into it.

### 13. Each advisor sees only their own students

Access used to follow the programme: any advisor in Computer Science could open, and even change,
the students of every other Computer Science advisor, and so could viewers and approvers in that
programme. The department decided that only the advisor should see their students. Now:

- An advisor reaches their own list and nothing else, whatever programme they share.
- A superadmin, or a faculty admin whose scope covers the advisor, can still open the list. They
  need it for the Everyone page and for importing on an advisor's behalf, and every such read is
  logged.
- Programme editors, approvers and viewers no longer reach student records at all.

The rule lives in one function, `canForOwner()` in `server.js`. Moving a student from one advisor
to another during an import was already an admin-only path, so imports still work. The browser
security test and `tests/features.test.js` check that a second advisor and a viewer in the same
programme get 403 on list, open and change, and that the advisor and a superadmin still get in.

## New features

### Saved term plans

On *Plan next term* the trial schedule can now be saved on the student's record. It comes back
the next time anyone opens that student for that term, and the panel says when it was saved and by
whom, or that it has changed since. *Print plan* opens a one-page plan with times, the checks and
signature lines for advisor and student. The server checks the shape of a saved plan (term, at
most 20 valid course codes) in `server/saved-plan.js`.

### Overriding a blocked check

The engine has always marked BLOCK findings as `overridable`, but nothing used the flag. Now a
blocked check on a plan has an *Override with a reason* link. The reason must be at least ten
characters. The server, not the browser, stamps who overrode it and when, keeps the original
author if the same override is saved again, and writes `block-overridden` to the audit log with
the student ID, the rule and the reason. The check then shows in green with the reason under it,
on screen and on the printed plan.

### Where you are signed in

*Your account* now lists each session for your account with a plain label ("Firefox on Windows"),
when it started and when it was last used, and a button to end it, or all of them except this one.
Only the browser family and system are stored, never the full user agent, and the list uses a
handle derived from the stored key so no session token is ever sent back.

### Activity and backups (superadmins)

A new page shows the audit log, decrypted on the server and sent 50 lines at a time, newest first,
with filters for the action and the person. Actions are shown in words ("Overrode a registration
check"), and slugs in the details are replaced with names. Reading the log is itself logged. The
backup status and download from section 9 are at the top of the same page.

## Interface

I wrote `scripts/ui-tour.js`, which starts any checkout on synthetic data and saves screenshots of
21 screens in English, Arabic, dark mode and at phone width. The "before" set was taken from
`b7a2664` and the "after" set from this branch, in `docs/screenshots/before` and
`docs/screenshots/after`. The BAU colours, fonts and layout are unchanged; `tests/theme.test.js`
still passes, and I had to adjust a few of my own sizes and labels to keep it passing.

- On a phone the avatar disappeared along with the name, and the avatar is the only way into *Your
  account*. So on a phone there was no way to change a password or switch theme. Only the name is
  hidden now. (17, 18)
- In Arabic the student name sat at the far side of the row from the avatar while the ID line
  stayed next to it. The list styles used `text-align:left`; they now use `start` and `end`, and
  the row padding and hover nudge follow the reading direction. (14)
- On a phone the term chip was cut to "F…". It now shows the term, and the planning note, which is
  on the student pages anyway, is hidden there. The light/dark button moves into *Your account* on
  small screens to make room. (17)
- The filter chips wrapped into tall pills. They stay on one line and scroll sideways. (17)
- Toasts covered the bottom navigation, and the floating Ask Me button showed as an empty circle on
  top of it. Toasts now sit above the bar, and the floating button is hidden where Ask Me is already
  in the bar. (17, 18)
- A search with no results showed an empty grey circle and "Nobody matches that." It now repeats
  what was searched for and offers *Show everyone*. (04)
- Form labels were set in spaced capitals, which the theme tests already ban for panel captions.
  They are sentence case now. Placeholders were the same colour as typed text, so "At least 10
  characters" looked like a filled-in password; they are lighter and regular weight. (01, 13)
- "1 advisors" in the admin sidebar now reads "1 advisor".

## Not done, and why

- **University single sign-on and two-factor sign-in.** Both need the university's identity
  service. Passwords, rate limits and session controls are as strong as I could make them without it.
- **PostgreSQL** stays off. The code and its tests are still there.
- **Styles still allow inline.** Removing it means moving hundreds of `style=""` attributes into
  classes. CSS cannot run script, so the gain is small for the work.
- **server.js is still large.** I moved four self-contained pieces into `server/` (passwords,
  HTTP guards, backup files, saved plans). Splitting the routes further without broader route-level
  tests would risk changing behaviour, so I stopped there.
- **The activity log is read from the file on each page.** That is fine for years of normal use
  (tens of megabytes). If the log grows much beyond that, it should be indexed or rotated.
- **Rate limits reset on restart.** Explained in section 10.

## Test results

All run on Node 22.

| Command | Result |
|---|---|
| `npm test` | 24 suites, all passing. New: `hardening.test.js` 21, `backup-tools.test.js` 22, `features.test.js` 35 |
| `npm run test:security` | 22 passed, 0 failed |
| `npm run test:email` | 19 passed, 0 failed |
| `npm run test:full` | 30 passed, 0 failed, no JavaScript errors |
| `npm audit` | 0 vulnerabilities |

## Commits

```
46d8bd6 Rewrite the browser security test for invite-only sign-in
e5ca485 Security hardening: password cost, emailed links, time limits, JSON guard, mail encoding, CSP hashes
0cc0e34 Supply chain: no install scripts, exact versions, Node 22, CI with npm audit
ad816f3 Backups you can take off the server, restore and re-key; audit reads of other advisors' students
65ae9c5 Rewrite the email and full browser tests for invite-only accounts
7b011ae Sessions page, activity log viewer, saved term plans with overrides
7f7ecbf Interface: plan save and override, sessions, activity page; phone and Arabic fixes
de64650 Remove the browser-side password code; document backups, restore, key change and new settings
63f8b7f Mark the shared-list access rule as a decision for the department
18cb687 Add the improvements report
9d349c5 Advisors see only their own students
```

## Sources

- OWASP Top 10:2025, https://owasp.org/Top10/2025/
- OWASP Application Security Verification Standard 5.0, https://owasp.org/www-project-application-security-verification-standard/
- OWASP Password Storage Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Content Security Policy Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- OWASP Prototype Pollution Prevention Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html
- OWASP Logging Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- Node.js security best practices, https://nodejs.org/en/learn/getting-started/security-best-practices
- RFC 2047, encoded words in mail headers, https://www.rfc-editor.org/rfc/rfc2047
- npm `ignore-scripts` setting, https://docs.npmjs.com/cli/v10/using-npm/config#ignore-scripts
