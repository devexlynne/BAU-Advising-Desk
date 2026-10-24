"""Draws the demo transcript and schedule PDFs from students-spec.json.

    python3 demo/tools/make-pdfs.py

Writes demo/demo-transcripts.pdf and demo/demo-schedules.pdf. The layout
follows the registrar's printouts closely enough for the portal's importer,
and every page carries a large DEMO watermark and a footer saying the
document is fictional.
"""
import json
import os
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
DEMO = os.path.dirname(HERE)
students = json.load(open(os.path.join(HERE, 'students-spec.json'), encoding='utf-8'))

NOTICE = 'Fictional student created for demonstration. Not an official document.'


def watermark(c, w, h):
    c.saveState()
    c.setFillColorRGB(0.85, 0.87, 0.92)
    c.setFont('Helvetica-Bold', 72)
    c.translate(w / 2, h / 2)
    c.rotate(30)
    c.drawCentredString(0, 0, 'DEMO DATA')
    c.restoreState()


def footer(c, w):
    c.setFont('Helvetica', 6.5)
    c.setFillColorRGB(0.4, 0.4, 0.4)
    c.drawString(30, 18, NOTICE)
    c.setFillColorRGB(0, 0, 0)


def fmt(n):
    return ('%.2f' % n) if isinstance(n, float) and not float(n).is_integer() else str(int(n)) if float(n).is_integer() else str(n)


# ---------------------------------------------------------------- transcripts
W, H = A4
COLS = [30, 215, 400]          # left edge of each of the three columns
ROW = 9.5
TOP = H - 112
BOTTOM = 40


def transcript_header(c, s):
    watermark(c, W, H)
    c.setFont('Helvetica-Bold', 10)
    c.drawString(30, H - 40, 'Unofficial Transcript (Demo)')
    c.setFont('Helvetica', 7.5)
    c.drawString(30, H - 60, 'Name: ' + s['name'])
    c.drawString(330, H - 60, 'Nationality: ' + s['nationality'])
    c.drawString(30, H - 72, 'ID ' + s['id'])
    c.drawString(120, H - 72, 'Faculty of: Science')
    c.drawString(230, H - 72, 'Bachelor in Computer Science')
    c.drawString(30, H - 84, 'Faculty: Science   Admission Term: ' + s['admissionTerm'])
    c.setFont('Helvetica-Bold', 6.5)
    for x in COLS:
        c.drawString(x, H - 100, 'Code')
        c.drawString(x + 38, H - 100, 'Course')
        c.drawString(x + 128, H - 100, 'Cr')
        c.drawString(x + 140, H - 100, 'Gr')
        c.drawString(x + 155, H - 100, 'Ern')
    c.setFont('Helvetica', 6.5)
    footer(c, W)
    c.setFont('Helvetica', 6.5)


def transcript_lines(s):
    """Everything printed in the body, in reading order, as (kind, data)."""
    out = []
    order = []
    for h in s['history']:
        if h['term'] not in order:
            order.append(h['term'])
    totals = {t['term']: t for t in s['termTotals']}
    for term in order:
        out.append(('term', 'Transfer from another university' if term == 'TRANSFER' else term))
        for h in [x for x in s['history'] if x['term'] == term]:
            out.append(('course', h))
        if term in totals:
            t = totals[term]
            out.append(('totals', 'Att.Cr. %s Earnd Cr. %s Sem GPA %.2f' % (t['attempted'], t['earned'], t['sgpa'])))
        out.append(('gap', None))
    out.append(('final', 'Tot. Cr. Compl. %s Cum. GPA: %.2f' % (s['totalCredits'], s['cgpa'] or 0)))
    return out


def draw_transcript(c, s):
    lines = transcript_lines(s)
    transcript_header(c, s)
    col, y = 0, TOP
    for kind, data in lines:
        if y < BOTTOM:
            col += 1
            y = TOP
            if col == len(COLS):
                c.showPage()
                transcript_header(c, s)
                col = 0
        x = COLS[col]
        if kind == 'term':
            c.setFont('Helvetica-Bold', 6.5)
            c.drawString(x, y, data.upper() if data != 'Transfer from another university' else data)
            c.setFont('Helvetica', 6.5)
        elif kind == 'course':
            title = data['title'] if len(data['title']) <= 22 else data['title'][:22].rsplit(' ', 1)[0]
            c.drawString(x, y, data['code'])
            c.drawString(x + 38, y, title)
            c.drawString(x + 128, y, fmt(data['cr']))
            c.drawString(x + 140, y, data['grade'])
            c.drawString(x + 155, y, fmt(data['earned']))
            if data['flag']:
                c.drawString(x + 170, y, data['flag'])
        elif kind in ('totals', 'final'):
            c.setFont('Helvetica-Oblique', 6)
            c.drawString(x, y, data)
            c.setFont('Helvetica', 6.5)
        y -= ROW if kind != 'gap' else ROW * 0.6
    c.showPage()


tc = canvas.Canvas(os.path.join(DEMO, 'demo-transcripts.pdf'), pagesize=A4)
tc.setTitle('Demo transcripts (fictional students)')
tc.setAuthor('')
for s in students:
    draw_transcript(tc, s)
tc.save()

# ---------------------------------------------------------------- schedules
LW, LH = landscape(A4)
DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
SHORT = {'MON': 'Monday', 'TUE': 'Tuesday', 'WED': 'Wednesday', 'THU': 'Thursday', 'FRI': 'Friday', 'SAT': 'Saturday'}
DAYX = {d: 300 + i * 85 for i, d in enumerate(DAYS)}


def hhmm(t):
    return t.replace(':', '')


sc = canvas.Canvas(os.path.join(DEMO, 'demo-schedules.pdf'), pagesize=landscape(A4))
sc.setTitle('Demo schedules (fictional students)')
sc.setAuthor('')
for s in students:
    watermark(sc, LW, LH)
    sc.setFont('Helvetica-Bold', 10)
    sc.drawString(30, LH - 40, 'Student Schedule (Demo)')
    sc.setFont('Helvetica', 8)
    sc.drawString(30, LH - 62, s['id'])
    sc.drawString(30, LH - 76, s['name'])
    sc.drawString(30, LH - 90, s['schedule']['termCode'])
    y = LH - 115
    sc.setFont('Helvetica-Bold', 7.5)
    sc.drawString(30, y, 'CRN')
    sc.drawString(80, y, 'Course')
    sc.drawString(150, y, 'Sec')
    sc.drawString(190, y, 'Credit')
    for d in DAYS:
        sc.drawString(DAYX[d], y, d)
    sc.setFont('Helvetica', 7.5)
    total = 0
    for course in s['schedule']['courses']:
        y -= 16
        sc.drawString(30, y, course['crn'])
        sc.drawString(80, y, course['code'])
        sc.drawString(150, y, course['section'])
        sc.drawString(198, y, str(int(course['cr'])))
        total += course['cr']
        by_day = {}
        for m in course['meetings']:
            by_day.setdefault(m['day'], []).append(m)
        extra = []
        for day, ms in by_day.items():
            first = ms[0]
            x = DAYX[SHORT[day]]
            sc.drawString(x, y, hhmm(first['start']))
            sc.drawString(x + 24, y, hhmm(first['end']))
            extra += [(day, m) for m in ms[1:]]
        for day, m in extra:   # a second meeting on the same day goes on its own row
            y -= 12
            x = DAYX[SHORT[day]]
            sc.drawString(x, y, hhmm(m['start']))
            sc.drawString(x + 24, y, hhmm(m['end']))
    y -= 22
    sc.drawString(30, y, 'Total Number of Credits: %d' % total)
    footer(sc, LW)
    sc.showPage()
sc.save()
print('wrote demo-transcripts.pdf and demo-schedules.pdf for %d students' % len(students))
