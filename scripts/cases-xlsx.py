"""The same twelve cases as a workbook.

Three sheets: one row per student for scanning, one row per course not passed,
and the full case written out for reading. Everything comes from the
transcripts and schedules already on file; the only typed-in column is the
note, which is Lynne's own comment.
"""
import json, os, tempfile

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

NAVY = "1B3668"
INK = "141B28"
MUTED = "77839A"
RED = "B32D21"
AMBER = "8A5B07"
GREEN = "136B4C"
LINE = "D3DAE6"
BAND = "EDF1F8"

cases = json.load(open(os.environ.get("CASES_JSON", os.path.join(tempfile.gettempdir(), "cases.json"))))

wb = Workbook()
thin = Side(style="thin", color=LINE)
edge = Border(bottom=thin)


def head(ws, row, labels, widths):
    for i, (label, width) in enumerate(zip(labels, widths), start=1):
        c = ws.cell(row=row, column=i, value=label)
        c.font = Font(name="Arial", size=9, bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor=NAVY)
        c.alignment = Alignment(vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.row_dimensions[row].height = 26
    ws.freeze_panes = ws.cell(row=row + 1, column=1)


def title(ws, text, span):
    ws["A1"] = "Beirut Arab University  ·  Faculty of Science  ·  Advisees of Dr. Julie Bu Daher"
    ws["A1"].font = Font(name="Arial", size=11, bold=True, color=NAVY)
    ws["A2"] = text
    ws["A2"].font = Font(name="Arial", size=9, color=MUTED)
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=span)
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=span)


def body(cell, size=9, bold=False, color=INK, wrap=False, align="left"):
    cell.font = Font(name="Arial", size=size, bold=bold, color=color)
    cell.alignment = Alignment(vertical="top", wrap_text=wrap, horizontal=align)
    cell.border = edge


# ── one row per student ───────────────────────────────────────────────────
ws = wb.active
ws.title = "Students"
title(ws, "Fall 2026/2027. One row per student. The numbers are read from the transcripts, the note is from the review.", 12)
cols = ["Student", "ID", "Level", "Sem", "CGPA", "Credits\nof 100", "Standing",
        "Limit", "Registered", "Registered courses", "The case in one line", "Note from the review"]
widths = [24, 11, 9, 5, 7, 8, 15, 7, 10, 30, 52, 42]
head(ws, 4, cols, widths)

for r, c in enumerate(cases, start=5):
    reg = ", ".join(x["code"] for x in c["registered"]) or "none"
    first = c["alerts"][0]["title"] + ": " + c["alerts"][0]["detail"] if c["alerts"] else "On track, nothing outstanding."
    vals = [c["name"], c["id"], c["level"], c["semester"],
            c["cgpa"] if c["cgpa"] is not None else "none yet",
            c["credits"], c["standing"], c["loadMax"],
            (str(c["registeredCredits"]) + " cr") if c["registered"] else "not registered",
            reg, first, c["comment"]]
    for i, v in enumerate(vals, start=1):
        cell = ws.cell(row=r, column=i, value=v)
        body(cell, wrap=i in (10, 11, 12), align="center" if i in (3, 4, 5, 6, 8, 9) else "left")
    ws.cell(row=r, column=3).font = Font(name="Arial", size=9, bold=True,
                                         color=RED if c["level"] == "Urgent" else AMBER if c["level"] == "Priority" else GREEN)
    if c["cgpa"] is not None and c["cgpa"] < 2:
        ws.cell(row=r, column=5).font = Font(name="Arial", size=9, bold=True, color=RED)
    if c["standing"] != "good standing":
        ws.cell(row=r, column=7).font = Font(name="Arial", size=9, color=RED)
    ws.row_dimensions[r].height = 42

last = 4 + len(cases)
tot = last + 2
ws.cell(row=tot, column=1, value="Urgent").font = Font(name="Arial", size=9, bold=True, color=RED)
ws.cell(row=tot, column=2, value='=COUNTIF(C5:C%d,"Urgent")' % last).font = Font(name="Arial", size=9, bold=True)
ws.cell(row=tot + 1, column=1, value="Priority").font = Font(name="Arial", size=9, bold=True, color=AMBER)
ws.cell(row=tot + 1, column=2, value='=COUNTIF(C5:C%d,"Priority")' % last).font = Font(name="Arial", size=9, bold=True)
ws.cell(row=tot + 2, column=1, value="Not registered").font = Font(name="Arial", size=9, bold=True)
ws.cell(row=tot + 2, column=2, value='=COUNTIF(I5:I%d,"not registered")' % last).font = Font(name="Arial", size=9, bold=True)

# ── one row per course not passed ─────────────────────────────────────────
ws2 = wb.create_sheet("Courses not passed")
title(ws2, "Every failed or withdrawn course still outstanding, and what it means this semester.", 8)
head(ws2, 4, ["Student", "ID", "Course", "Title", "Grade", "When", "This semester", "What the rule says"],
     [24, 11, 11, 30, 7, 12, 40, 34])

r = 5
for c in cases:
    for f in c["failed"]:
        this = ("open this semester" + (", %d credits behind it" % f["unlocks"] if f["unlocks"] else "")) if f["open"] == "yes" \
            else "normally open, check for a section" if f["open"] == "likely" \
            else "not open this semester" + ((", runs in " + f["runsIn"]) if f["runsIn"] else "") + ", plan for " + f["plannedFor"]
        rule = "required course, must be taken again" if f["kind"] == "must" \
            else "elective, repeat it or replace it from the same block" if f["kind"] == "replace" \
            else "the degree no longer needs it"
        for i, v in enumerate([c["name"], c["id"], f["code"], f["title"], f["grade"], f["term"], this, rule], start=1):
            body(ws2.cell(row=r, column=i, value=v), wrap=i in (7, 8))
        ws2.cell(row=r, column=5).font = Font(name="Arial", size=9, bold=True, color=RED)
        ws2.row_dimensions[r].height = 26
        r += 1
    for w in c["withdrew"]:
        for i, v in enumerate([c["name"], c["id"], w["code"], w["title"], w["grade"], w["term"],
                               "withdrawn and never taken again", "no repeat rule applies, but the course is still missing"], start=1):
            body(ws2.cell(row=r, column=i, value=v), wrap=i in (7, 8))
        ws2.row_dimensions[r].height = 26
        r += 1

# ── the full case, written out ────────────────────────────────────────────
ws3 = wb.create_sheet("Full cases")
ws3.column_dimensions["A"].width = 30
ws3.column_dimensions["B"].width = 110
r = 1
for c in cases:
    ws3.cell(row=r, column=1, value=c["name"] + "  ·  " + c["id"]).font = Font(name="Arial", size=12, bold=True, color=NAVY)
    ws3.cell(row=r, column=2, value=c["level"]).font = Font(
        name="Arial", size=10, bold=True,
        color=RED if c["level"] == "Urgent" else AMBER if c["level"] == "Priority" else GREEN)
    for col in ("A", "B"):
        ws3[col + str(r)].fill = PatternFill("solid", fgColor=BAND)
    r += 1

    def line(label, value):
        global r
        a = ws3.cell(row=r, column=1, value=label)
        a.font = Font(name="Arial", size=9, bold=True, color=MUTED)
        a.alignment = Alignment(vertical="top")
        b = ws3.cell(row=r, column=2, value=value)
        b.font = Font(name="Arial", size=9)
        b.alignment = Alignment(vertical="top", wrap_text=True)
        r += 1

    line("Note from the review", c["comment"])
    line("Who", "semester %d · %s campus · ID year %s · %s" % (c["semester"], c["campus"], c["idYear"], c["email"]))
    line("Numbers", "CGPA %s · %d of 100 credits toward the degree · %d on the transcript (%d not counted) · standing: %s (%s) · credit limit %d"
         % (("%.2f" % c["cgpa"]) if c["cgpa"] is not None else "none yet", c["credits"], c["transcriptCredits"],
            c["notCounted"], c["standing"], c["standingWhy"], c["loadMax"]))
    line("Registered now", (", ".join("%s %s (%d cr, %s, %s)" % (x["code"], x["title"], x["cr"], x["section"], x["when"])
                                      for x in c["registered"]) + "  =  %d credits" % c["registeredCredits"])
         if c["registered"] else "Not registered for Fall 2026/2027.")
    for a in c["alerts"]:
        line(a["title"], a["detail"])
    if c["failed"] or c["withdrew"]:
        line("Not passed", "; ".join(["%s %s graded %s in %s" % (f["code"], f["title"], f["grade"], f["term"]) for f in c["failed"]]
                                     + ["%s %s withdrawn in %s" % (w["code"], w["title"], w["term"]) for w in c["withdrew"]]))
    for d in c["delays"]:
        line("Waiting costs a year", "%s %s is open now. Leaving it pushes %s." % (d["code"], d["title"], d["pushes"]))
    line("Term by term", " | ".join("%s: SGPA %s — %s" % (t["term"], ("%.2f" % t["sgpa"]) if t["sgpa"] is not None else "-", t["courses"])
                                    for t in c["terms"]))
    line("Degree blocks", " · ".join("%s %d/%d" % (b["label"], b["earned"], b["required"]) for b in c["blocks"]))
    line("Suggested for Spring", " · ".join(c["next"]) if c["next"] else "Nothing outstanding.")
    r += 1

wb.save("/mnt/user-data/outputs/students-to-review.xlsx")
print("wrote students-to-review.xlsx with", len(cases), "students")
