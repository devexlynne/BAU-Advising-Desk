# Offline demo

A demo of the portal that runs on your own computer, with twelve fictional
students. No real student data is used, nothing is sent anywhere, and nothing
is saved: reload the page and it starts over.

## Run it

```
npm run demo
```

The browser opens at http://127.0.0.1:3005, signed in as the demo advisor.
Press Ctrl+C in the terminal to stop it.

To send someone the demo as a single file instead, run
`npm run demo -- --file`. It writes `build/advising-demo.html`, which opens
with a double-click in any browser, without Node or a server.

To show an import, open Import and drop in `demo/demo-transcripts.pdf`, then
`demo/demo-schedules.pdf`. Every page of both files is marked DEMO DATA.

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
| 202599107 | Hadi Mahmoud Nasser | spring intake, a term behind the standard plan |
| 202499108 | Yara Nabil Chami | transfer credits and a D- that must be repeated |
| 202399109 | Ziad Antoine Rahal | final semester, Cybersecurity track |
| 202599110 | Sara Elie Tannous | Debbieh campus |
| 202499111 | Jana Khaled Moussa | good standing, WRNL200 still missing |
| 202599112 | Ali Hussein Hamdan | first-year student who withdrew from a course |

## Rebuilding the data

Only needed if the students are changed.

```
node demo/tools/generate-demo.js        # students-spec.json
python3 demo/tools/make-pdfs.py         # the two PDFs (needs reportlab)
npm i --no-save pdfjs-dist@3.11.174
node demo/tools/build-seed.js           # demo/students.json, read back from the PDFs
```

`build-seed.js` reads the PDFs with the portal's own importer and stops if
anything read back differs from what was printed, so the demo records are
exactly what a real import of these PDFs produces.
