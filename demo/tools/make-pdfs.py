"""Draws the demo transcript and schedule PDFs from students-spec.json.

    pip install reportlab arabic-reshaper python-bidi
    python3 demo/tools/make-pdfs.py

Writes demo/demo-transcripts.pdf and demo/demo-schedules.pdf in the same
layout as the registrar's advisee printouts (positions, fonts, grey bars,
table borders), so the import screen reads them exactly like the real ones.
Every page also carries a light DEMO DATA watermark and a footer saying the
student is fictional, so the files can never be taken for real records.
"""
import json
import os

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib.pagesizes import letter, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
DEMO = os.path.dirname(HERE)
ROOT = os.path.dirname(DEMO)
students = json.load(open(os.path.join(HERE, 'students-spec.json'), encoding='utf-8'))


def font(name, candidates):
    for path in candidates:
        if os.path.exists(path):
            pdfmetrics.registerFont(TTFont(name, path))
            return name
    return None


# Arial look-alikes; Arabic names need a font with Arabic letters
SANS = font('Sans', ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', 'C:/Windows/Fonts/arial.ttf']) or 'Helvetica'
BOLD = font('SansBold', ['/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf']) or 'Helvetica-Bold'
ARAB = font('Arabic', ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf'])

NOTICE = 'DEMO DATA: fictional student created for demonstration. Not an official document.'


def arabic(text):
    # stored the way the registrar's PDFs store it: shaped letters, visual order
    return get_display(arabic_reshaper.reshape(text))


def num(n):
    """1.50 -> 1.5, 3.00 -> 3, 2.36 -> 2.36, as the printouts show them."""
    if n is None:
        return ''
    return ('%.2f' % n).rstrip('0').rstrip('.')


def fit(text, face, size, width):
    # cut a long course title so it never runs into the CR column
    while text and pdfmetrics.stringWidth(text, face, size) > width:
        text = text[:-1]
    return text.rstrip()


def watermark(c, w, h):
    c.saveState()
    c.setFillColorRGB(0.88, 0.9, 0.94)
    c.setFont(BOLD, 80)
    c.translate(w / 2, h / 2)
    c.rotate(30)
    c.drawCentredString(0, 0, 'DEMO DATA')
    c.restoreState()


def footer(c):
    c.saveState()
    c.setFont(SANS, 6.5)
    c.setFillColorRGB(0.45, 0.45, 0.45)
    c.drawString(13.5, 12, NOTICE)
    c.restoreState()


def season_label(term):
    # "FALL 2023/2024" -> "FALL 2023 / 2024"
    season, years = term.split(' ')
    a, b = years.split('/')
    return '%s %s / %s' % (season, a, b)


# ---------------------------------------------------------------- transcripts
TW, TH = landscape(letter)          # 792 x 612
COL = [4.5, 270.0, 535.5]           # column left edges
COL_W = 265.5
SHIFT = [0, 0, -27]                 # the third column's CR/GR/ERN sit further left (page edge)
ROW = 13.5
BODY_TOP = 94.5                     # top of the first body row
BODY_END = 580.0


def y_of(top):
    """Text baseline for a row whose top edge is `top` (measured from the page top)."""
    return TH - top - 9.5


def t_header(c, s):
    watermark(c, TW, TH)
    c.setFont(BOLD, 10)
    c.drawString(4.5, TH - 41, 'Name:')
    c.drawString(40.5, TH - 41, s['name'])
    if ARAB:
        c.setFont(ARAB, 10)
        c.drawString(261.0, TH - 41, arabic(s['arabName']))
        c.setFont(BOLD, 10)
    c.drawString(490.5, TH - 41, 'Nationality:')
    c.drawString(589.5, TH - 41, s['nationality'].upper())
    c.drawString(4.5, TH - 54.5, 'Student ID:')
    c.drawString(67.5, TH - 54.5, s['id'])
    c.drawString(180.0, TH - 54.5, 'Faculty of:')
    c.drawString(234.0, TH - 54.5, 'Science / Computer Science')
    c.drawString(418.5, TH - 54.5, 'Bachelor in Computer Science')
    a, b = s['admission'].split('/')
    c.drawString(4.5, TH - 68, 'Admission Year:')
    c.drawString(90.0, TH - 68, '%s / %s' % (a, b))
    c.setFont(SANS, 8)
    for x, d in zip(COL, SHIFT):
        c.drawString(x + (11.3 if not d else 6.7), TH - 89, 'Code')
        c.drawString(x + 116.7 + d, TH - 89, 'Course')
        c.drawString(x + 208.1 + d, TH - 89, 'CR')
        c.drawString(x + 226.2 + d, TH - 89, 'GR')
        c.drawString(x + 240.3 + d, TH - 89, 'ERN')
        c.drawString(x + 258.5 + d, TH - 89, 'R')
    footer(c)


def t_lines(s):
    """The body in reading order: headings, course rows, grey total bars."""
    out = []
    rows = s['history']
    for block, heading in (('bacc', 'LEBANESE BACCALAUREATE OR EQV.'), ('transfer', 'TRANSFER FROM OTHER UNIVERSITY')):
        part = [h for h in rows if h.get('block') == block]
        if not part:
            continue
        out.append(('head', heading))
        out += [('course', h) for h in part]
        out.append(('bar', (0, sum(h['earned'] for h in part), None)))
    totals = {t['term']: t for t in s['termTotals']}
    seen = []
    for h in rows:
        if h['term'] != 'TRANSFER' and h['term'] not in seen:
            seen.append(h['term'])
    for term in seen:
        out.append(('head', season_label(term)))
        out += [('course', h) for h in rows if h['term'] == term]
        t = totals[term]
        out.append(('bar', (t['attempted'], t['earned'], t['sgpa'])))
    out.append(('final', (s['totalCredits'], s['cgpa'])))
    return out


def draw_transcript(c, s):
    t_header(c, s)
    # a term is never split across columns (the importer reads each column
    # on its own), so a block that does not fit starts the next column
    blocks, cur = [], []
    for item in t_lines(s):
        if item[0] == 'head' and cur:
            blocks.append(cur)
            cur = []
        cur.append(item)
    blocks.append(cur)
    col, top = 0, BODY_TOP
    for block in blocks:
        if top + ROW * len(block) > BODY_END and top > BODY_TOP:
            col += 1
            top = BODY_TOP
            if col == len(COL):
                c.showPage()
                t_header(c, s)
                col = 0
        for kind, data in block:
            draw_line(c, COL[col], top, kind, data, SHIFT[col])
            top += ROW
    c.showPage()


def draw_line(c, x, top, kind, data, d=0):
    base = y_of(top)
    if kind == 'head':
        c.setFont(BOLD, 10)
        c.drawCentredString(x + COL_W / 2, base - 0.5, data)
    elif kind == 'course':
        c.setFont(SANS, 8)
        c.drawString(x, base, data['code'])
        c.drawString(x + 45, base, fit(data['title'].upper(), SANS, 8, 160 + d))
        c.drawString(x + 211.5 + d, base, num(data['cr']))
        c.drawString(x + 225 + d, base, data['grade'])
        c.drawString(x + 238.5 + d, base, num(data['earned']))
        if data['flag']:
            c.drawString(x + 252 + d, base, data['flag'])
    else:
        c.saveState()
        c.setFillColorRGB(0.75, 0.75, 0.75)
        c.rect(x, TH - top - ROW, COL_W, ROW, stroke=0, fill=1)
        c.restoreState()
        c.setFont(BOLD, 8)
        if kind == 'bar':
            att, earned, gpa = data
            c.drawString(x, base, 'Att.Cr.')
            c.drawString(x + 31.5, base, num(att))
            c.drawString(x + 72, base, 'Earnd Cr.')
            c.drawString(x + 112.5, base, num(earned))
            c.drawString(x + 175.5, base, 'Sem GPA')
            c.drawString(x + 229.5, base, num(gpa))
        else:
            credits, cgpa = data
            c.drawString(x, base, 'Tot. Cr. Compl.')
            c.drawString(x + 67.5, base, num(credits))
            c.drawString(x + 126, base, 'Cum. GPA:')
            c.drawString(x + 180, base, num(cgpa))


tc = canvas.Canvas(os.path.join(DEMO, 'demo-transcripts.pdf'), pagesize=landscape(letter))
tc.setTitle('Advisees Transcript (DEMO, fictional students)')
tc.setAuthor('')
for s in students:
    draw_transcript(tc, s)
tc.save()

# ---------------------------------------------------------------- schedules
SW, SH = letter                    # 612 x 792
DAY_NAMES = [('MON', 'Monday'), ('TUE', 'Tuesday'), ('WED', 'Wednesday'), ('THU', 'Thursday'), ('FRI', 'Friday'), ('SAT', 'Saturday')]
LOGO = os.path.join(ROOT, 'report', 'bau-logo.png')
TABLE_L, TABLE_R, DAYS_L = 13.5, 589.5, 207.0


def Y(top, size=10):
    return SH - top - size * 0.86


def hhmm(t):
    return t.replace(':', '')


logo = None
if os.path.exists(LOGO):
    # trim the white margin around the logo so it fills the box like the printout's
    from PIL import Image, ImageChops
    from reportlab.lib.utils import ImageReader
    im = Image.open(LOGO).convert('RGB')
    box = ImageChops.difference(im, Image.new('RGB', im.size, (255, 255, 255))).point(lambda v: 255 if v > 20 else 0).getbbox()
    logo = ImageReader(im.crop(box) if box else im)

sc = canvas.Canvas(os.path.join(DEMO, 'demo-schedules.pdf'), pagesize=letter)
sc.setTitle('Advisees Schedules (DEMO, fictional students)')
sc.setAuthor('')
for s in students:
    watermark(sc, SW, SH)
    if logo:
        sc.drawImage(logo, 13.5, SH - 104, width=203.8, height=77, preserveAspectRatio=True, anchor='w')
    sc.setFont(SANS, 10)
    sc.drawString(482.4, Y(93.1), '24-OCT-26 10:00 AM')
    sc.setFont(BOLD, 12)
    sc.drawCentredString(296.1, Y(100.3, 12), s['id'])
    sc.drawCentredString(296.1, Y(117.0, 12), s['name'])
    if ARAB:
        sc.setFont(ARAB, 11)
        sc.drawCentredString(296.1, Y(134.0, 11), arabic(s['arabName']))
    sc.setFont(BOLD, 10)
    sc.drawString(211.5, Y(158.6), s['schedule']['termCode'])
    sc.drawString(13.5, Y(181.1), 'Faculty:')
    sc.drawString(63.0, Y(181.1), 'Science')
    sc.drawString(13.5, Y(194.6), 'Program:')
    sc.drawString(63.0, Y(194.6), 'Bachelor in Computer Science')

    courses = s['schedule']['courses']
    used = [d for d in DAY_NAMES if any(m['day'] == d[0] for c in courses for m in c['meetings'])]
    col_w = (TABLE_R - DAYS_L) / max(len(used), 1)
    dayx = {d[0]: DAYS_L + i * col_w for i, d in enumerate(used)}

    # header row: grey cells with borders
    top = 211.5
    sc.setLineWidth(0.75)
    sc.setFillColorRGB(0.75, 0.75, 0.75)
    edges = [TABLE_L, DAYS_L] + [DAYS_L + (i + 1) * col_w for i in range(len(used))]
    for a, b in zip(edges, edges[1:]):
        sc.rect(a, SH - top - 13.5, b - a, 13.5, stroke=1, fill=1)
    sc.setFillColorRGB(0, 0, 0)
    sc.setFont(BOLD, 10)
    for label, x in (('CRN', 22.5), ('REG.C', 49.5), ('Course', 85.5), ('Sec', 148.5), ('Credit', 166.5), ('#', 198.2)):
        sc.drawString(x, Y(top + 1.1), label)
    for code, name in used:
        sc.drawString(dayx[code], Y(top + 1.1), name)

    # one bordered block per course; a second meeting on the same day adds a line
    top += 13.5
    total = 0
    for course in courses:
        by_day = {}
        for m in course['meetings']:
            by_day.setdefault(m['day'], []).append(m)
        lines = max(len(v) for v in by_day.values()) if by_day else 1
        h = 13.5 * lines
        sc.rect(TABLE_L, SH - top - h, TABLE_R - TABLE_L, h, stroke=1, fill=0)
        sc.setFont(BOLD, 10)
        sc.drawString(13.5, Y(top + 1.1), course['crn'])
        sc.drawString(58.5, Y(top + 1.1), 'RE')
        sc.drawString(85.5, Y(top + 1.1), course['code'])
        sc.drawString(148.5, Y(top + 1.1), course['section'])
        sc.drawString(180.0, Y(top + 1.1), str(int(course['cr'])))
        sc.setFont(SANS, 9)
        for day, ms in by_day.items():
            for i, m in enumerate(ms):
                x = dayx[day]
                yy = Y(top + 0.7 + i * 13.5, 9)
                sc.drawString(x, yy, hhmm(m['start']))
                sc.drawString(x + 22.5, yy, 'to')
                sc.drawString(x + 32.5, yy, hhmm(m['end']))
        total += course['cr']
        top += h
    sc.setFont(BOLD, 10)
    sc.drawString(31.5, Y(top + 5.6), 'Total Number of Credits:')
    sc.drawString(153.0, Y(top + 5.6), num(total))
    footer(sc)
    sc.showPage()
sc.save()
print('wrote demo-transcripts.pdf and demo-schedules.pdf for %d students' % len(students))
