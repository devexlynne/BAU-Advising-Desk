# Offline demo

A demo of the portal that runs on your own computer, with 32 fictional
students (twelve examples and twenty test cases). No real student data is used, nothing is sent anywhere, and nothing
is saved: reload the page and it starts over.

## Run it

```
npm run demo
```

The browser opens at http://127.0.0.1:3005, signed in as the demo advisor.
Press Ctrl+C in the terminal to stop it.

To show an import, open Import and drop in `demo/demo-transcripts.pdf`, then
`demo/demo-schedules.pdf`. They follow the registrar's advisee printouts
(same page size, columns, grey total bars and schedule table), and every page
is marked DEMO DATA with a footer saying the student is fictional.

## The students

All names are invented and every ID uses the 99xxx block (for example
202499104), which is kept for demo records.

| ID | Student | What the demo shows |
|---|---|---|
| 202599101 | Karim Fouad Haddad | second-year student, on track |
| 202499102 | Nour Hassan Khalil | strong student, WRNL200 required for 2024/2025 admissions |
| 202399103 | Rami Walid Saad | final year, close to graduation, electives counted by credits |
| 202499104 | Lea Georges Mansour | failed CMPS242 and passed it on the retake |
| 202399105 | Omar Bilal Fares | withdrew from two core courses, behind on prerequisites |
| 202499106 | Maya Samir Azar | low GPA, failed courses to repeat |
| 202499107 | Hadi Mahmoud Nasser | spring intake, a term behind the standard plan |
| 202499108 | Yara Nabil Chami | transfer credits and a D- that must be repeated |
| 202399109 | Ziad Antoine Rahal | final semester, Cybersecurity track |
| 202599110 | Sara Elie Tannous | Debbieh campus |
| 202499111 | Jana Khaled Moussa | good standing, WRNL200 still missing |
| 202599112 | Ali Hussein Hamdan | first-year student who withdrew from a course |

### Test cases

Twenty more fictional students, made from synthetic test PDFs, cover the
harder situations side by side. They live in `demo/tools/test-cases.json`.

| ID | Student | What the case covers |
|---|---|---|
| 202299301 | Maya Rami Karam | failed courses, retakes, withdrawals, CGPA below 2, close to graduation |
| 202299302 | Jad Fadi Khoury | failed courses, retakes, withdrawals |
| 202599303 | Lara Samir Haddad | failed courses, CGPA below 2, intensive English |
| 202399304 | Tarek Nabil Saad | withdrawals |
| 202599305 | Rana Elias Nassar | high CGPA |
| 202399306 | Karim Ziad Mourad | retakes, close to graduation |
| 202499307 | Nour Hadi Salameh | on track |
| 202599308 | Rami Walid Azar | failed courses, CGPA below 2, intensive English |
| 202299309 | Lea Georges Habib | failed courses, retakes, withdrawals, intensive English |
| 202599310 | Omar Bassam Najjar | high CGPA |
| 202699311 | Yara Michel Farah | transfer student, first term at BAU, CGPA below 2 |
| 202199312 | Hassan Riad Hamdan | failed courses, retakes, withdrawals |
| 202599313 | Celine Fouad Daher | failed courses, CGPA below 2 |
| 202399314 | Ali Marwan Saba | retakes, close to graduation |
| 202399315 | Dalia Wissam Rached | failed courses, retakes, withdrawals, intensive English |
| 202699316 | Fadi Ghassan Mansour | new student, no transcript yet, intensive English |
| 202299317 | Hiba Rayan Zoghbi | failed courses, retakes, withdrawals, D- to repeat, CGPA below 2, close to graduation |
| 202599318 | Nadim Joseph Ghanem | failed courses, withdrawals, CGPA below 2 |
| 202599319 | Sarah Kamal Ayoub | high CGPA |
| 202599320 | Bilal Tamer Harb | high CGPA |

## Rebuilding the data

Only needed if the students are changed.

```
node demo/tools/generate-demo.js        # students-spec.json (the 12 plus test-cases.json)
python3 demo/tools/make-pdfs.py         # the two PDFs (pip install reportlab arabic-reshaper python-bidi)
npm i --no-save pdfjs-dist@3.11.174
node demo/tools/build-seed.js           # demo/students.json, read back from the PDFs
```

Each student's Fall 2026/2027 registration is built by `plan-schedules.js`
the way an advisor would: the portal's own recommendations, one real section
per course from the course offering, no time clashes, labs with their
lecture, nothing already passed, and no more credits than the student's load
limit. The portal's registration check runs on every schedule and the build
stops if it finds an error.

`build-seed.js` reads the PDFs with the portal's own importer and stops if
anything read back differs from what was printed, so the demo records are
exactly what a real import of these PDFs produces.

## Online demo (Railway)

`node scripts/public-demo.js` serves the same demo from a host, with only the
fictional students above. It has no database and no sign-in, and nothing is
saved. On Railway, set the service's config file to `railway.demo.json`.

## Private copy from real PDFs (this computer only)

`node scripts/private-demo.js --transcripts <pdf> --schedules <pdf> --count 5`
builds `private-demo/private-demo.html` from a few real students with their
names, IDs and nationality replaced. Their courses and grades are still real,
so the `private-demo/` folder is ignored by git and must stay on this
computer: never upload, deploy or share it, and delete it when done.

## Trial with sign-in on Railway (encrypted file storage)

Set `STORE_KEY` (32 random bytes as 64 hex characters) and attach a volume at
`/data`; the server then keeps its store, backups and activity log encrypted
with AES-256-GCM instead of using PostgreSQL. Case students go in with
`node scripts/private-demo.js ... --cases` (on this computer) followed by
`node scripts/upload-cases.js --url <trial link> --as <admin> --advisor <slug>`.
