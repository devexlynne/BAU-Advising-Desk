from pathlib import Path
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "report" / "BAU-e-Advising-Technical-Defense-Guide.docx"

NAVY = "193F73"
PALE = "EEF3F9"
LIGHT = "F6F8FB"
BORDER = "D9D9D9"
TEXT = RGBColor(28, 37, 54)
MUTED = RGBColor(84, 96, 116)


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=82, start=115, bottom=82, end=115):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for name, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn("w:" + name))
        if node is None:
            node = OxmlElement("w:" + name)
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table):
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = borders.find(qn("w:" + edge))
        if tag is None:
            tag = OxmlElement("w:" + edge)
            borders.append(tag)
        tag.set(qn("w:val"), "single")
        tag.set(qn("w:sz"), "4")
        tag.set(qn("w:color"), BORDER)


def repeat_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    flag = OxmlElement("w:tblHeader")
    flag.set(qn("w:val"), "true")
    tr_pr.append(flag)


def set_repeat_table_header(row):
    repeat_header(row)


def prevent_row_split(row):
    tr_pr = row._tr.get_or_add_trPr()
    tag = OxmlElement("w:cantSplit")
    tr_pr.append(tag)


def set_font(run, name="Aptos", size=None, bold=None, color=None):
    run.font.name = name
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = color


def keep_with_next(paragraph):
    paragraph.paragraph_format.keep_with_next = True


def add_table(doc, headers, rows, widths):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_borders(table)
    hdr = table.rows[0]
    set_repeat_table_header(hdr)
    for i, (cell, text) in enumerate(zip(hdr.cells, headers)):
        cell.width = Inches(widths[i])
        cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        set_cell_shading(cell, NAVY)
        set_cell_margins(cell)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.keep_with_next = True
        r = p.add_run(text)
        set_font(r, size=9.2, bold=True, color=RGBColor(255, 255, 255))
    for row_i, values in enumerate(rows):
        row = table.add_row()
        prevent_row_split(row)
        cells = row.cells
        for i, (cell, text) in enumerate(zip(cells, values)):
            cell.width = Inches(widths[i])
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            set_cell_margins(cell)
            if row_i % 2:
                set_cell_shading(cell, LIGHT)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.08
            r = p.add_run(str(text))
            set_font(r, size=8.6, color=TEXT)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    return table


def add_heading(doc, text, level=1):
    p = doc.add_paragraph(text, style=f"Heading {level}")
    if level == 1:
        keep_with_next(p)
    return p


def add_body(doc, text, bold_lead=None):
    p = doc.add_paragraph()
    if bold_lead:
        r = p.add_run(bold_lead)
        set_font(r, bold=True, color=TEXT)
    r = p.add_run(text)
    set_font(r, color=TEXT)
    return p


def add_bullet(doc, text, bold_lead=None):
    p = doc.add_paragraph(style="List Bullet")
    if bold_lead:
        r = p.add_run(bold_lead)
        set_font(r, bold=True, color=TEXT)
    r = p.add_run(text)
    set_font(r, color=TEXT)
    return p


def add_q(doc, title, answer, detail=None, page_break_before=False):
    heading = add_heading(doc, title, 2)
    heading.paragraph_format.page_break_before = page_break_before
    p = add_body(doc, answer)
    if detail:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(7)
        r = p.add_run(detail)
        set_font(r, size=9.2, color=MUTED)
        # A small explicit line break prevents Word's PDF exporter from
        # visually crowding a following kept-with-next heading onto this line.
        br = p.add_run()
        set_font(br, size=2, color=MUTED)
        br.add_break(WD_BREAK.LINE)
    return p


doc = Document()
section = doc.sections[0]
section.page_width = Inches(8.5)
section.page_height = Inches(11)
section.top_margin = Inches(0.72)
section.bottom_margin = Inches(0.68)
section.left_margin = Inches(0.78)
section.right_margin = Inches(0.78)

styles = doc.styles
normal = styles["Normal"]
normal.font.name = "Aptos"
normal._element.rPr.rFonts.set(qn("w:ascii"), "Aptos")
normal._element.rPr.rFonts.set(qn("w:hAnsi"), "Aptos")
normal.font.size = Pt(10.3)
normal.font.color.rgb = TEXT
normal.paragraph_format.space_after = Pt(6)
normal.paragraph_format.line_spacing = 1.12

title_style = styles["Title"]
title_style.font.name = "Aptos Display"
title_style._element.rPr.rFonts.set(qn("w:ascii"), "Aptos Display")
title_style._element.rPr.rFonts.set(qn("w:hAnsi"), "Aptos Display")
title_style.font.size = Pt(27)
title_style.font.bold = True
title_style.font.color.rgb = RGBColor(0, 0, 0)
if title_style._element.pPr is not None:
    style_border = title_style._element.pPr.find(qn("w:pBdr"))
    if style_border is not None:
        title_style._element.pPr.remove(style_border)

for name, size, before, after in (("Heading 1", 17, 16, 7), ("Heading 2", 12.2, 10, 4), ("Heading 3", 10.5, 8, 3)):
    st = styles[name]
    st.font.name = "Aptos Display"
    st._element.rPr.rFonts.set(qn("w:ascii"), "Aptos Display")
    st._element.rPr.rFonts.set(qn("w:hAnsi"), "Aptos Display")
    st.font.size = Pt(size)
    st.font.bold = True
    st.font.color.rgb = RGBColor(0, 0, 0)
    st.paragraph_format.space_before = Pt(before)
    st.paragraph_format.space_after = Pt(after)
    st.paragraph_format.keep_with_next = (name == "Heading 1")

styles["List Bullet"].font.name = "Aptos"
styles["List Bullet"].font.size = Pt(10.2)
styles["List Bullet"].paragraph_format.space_after = Pt(4)
styles["List Bullet"].paragraph_format.left_indent = Inches(0.24)
styles["List Bullet"].paragraph_format.first_line_indent = Inches(-0.16)

# Footer with a neutral document label and dynamic page number.
footer = section.footer
fp = footer.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
r = fp.add_run("BAU e-Advising technical defense guide   ")
set_font(r, size=8.2, color=MUTED)
fld_begin = OxmlElement("w:fldChar")
fld_begin.set(qn("w:fldCharType"), "begin")
instr = OxmlElement("w:instrText")
instr.set(qn("xml:space"), "preserve")
instr.text = " PAGE "
fld_end = OxmlElement("w:fldChar")
fld_end.set(qn("w:fldCharType"), "end")
r2 = fp.add_run()
r2._r.append(fld_begin)
r2._r.append(instr)
r2._r.append(fld_end)
set_font(r2, size=8.2, color=MUTED)

# Cover
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(42)
p.paragraph_format.space_after = Pt(10)
r = p.add_run("BAU E ADVISING SYSTEM")
set_font(r, name="Aptos", size=10, bold=True, color=RGBColor(25, 63, 115))
p = doc.add_paragraph("Technical Defense Guide for Dr Julie Abu Daher", style="Title")
p.paragraph_format.space_after = Pt(12)
# Word's built-in Title style may carry a theme border. The title should rely
# on type and whitespace only.
p_pr = p._p.get_or_add_pPr()
p_bdr = p_pr.find(qn("w:pBdr"))
if p_bdr is not None:
    p_pr.remove(p_bdr)
p = doc.add_paragraph("Features  Technical design  Security  Honest limitations")
set_font(p.runs[0], size=13, color=MUTED)
p.paragraph_format.space_after = Pt(24)

add_body(doc, "This guide gives short answers Dr. Julie can use in a discussion or defense. The first sentence under each heading is the answer to say aloud. The smaller technical line is supporting evidence if the examiner asks how it works.")
add_body(doc, "The central claim is simple: the system reads the university's existing transcript and schedule files, applies explicit academic rules, and presents evidence to the advisor. It supports professional judgment; it does not replace it.")

add_heading(doc, "The six points to remember", 1)
add_bullet(doc, "The transcript and schedule remain separate sources because they answer different questions: completed work versus current registration.")
add_bullet(doc, "PDF reading happens in the browser with a local copy of PDF.js; the original PDF is not sent to an outside parsing service.")
add_bullet(doc, "Every recommendation comes from named rules, prerequisites, course history, and the offering. Ask Me is rule based and uses no external AI.")
add_bullet(doc, "The server authenticates each advisor and limits records by advisor. The admin can view the department, but each student still displays the responsible advisor.")
add_bullet(doc, "Passwords are salted PBKDF2 hashes, sessions use protected cookies, and the public page contains no student records before sign in.")
add_bullet(doc, "The honest remaining work is university SSO, scheduled backups, a full student-change audit log, and formal data-governance approval.")

doc.add_page_break()

add_heading(doc, "System overview", 1)
add_q(doc, "What the system does", "It turns the PDFs the university already produces into an advisor workspace. It shows academic progress, checks the current schedule, suggests possible next courses, and explains why a student needs attention.", "Technical basis: src/pdfimport.js reads files, src/engine.js calculates, and src/app.js presents the result.")
add_q(doc, "What the system does not do", "It does not register students, change official university records, or make final advising decisions. The advisor reviews the evidence and decides.", "The interface uses recommendations, warnings, and manual decisions. No route connects to the SIS or writes back to it.")
add_q(doc, "Why it is one page", "A single browser application keeps the interface fast and makes the rules easy to test without a large framework. A small Node server handles only authentication, storage, mail, and access control.", "build.js combines the page shell, data, and JavaScript into build/index.html. server.js serves it and exposes the protected API.")

add_table(doc,
          ["Layer", "Responsibility", "Main files"],
          [
              ["Browser", "Import PDFs, calculate advising results, display screens, Arabic, reports and Ask Me", "src/app.js, engine.js, pdfimport.js, askme.js, i18n.js"],
              ["Server", "Sign in, sessions, authorization, shared storage, password reset and email", "server.js, mail.js"],
              ["Data", "Rules, curriculum, offerings, faculty and built-in advisor lists", "data/*.json"],
              ["Build", "Create one deployable HTML page and embed the local PDF reader", "build.js, web/shell.html, web/vendor/pdf*.js"],
          ], [1.05, 3.25, 2.55])

add_heading(doc, "The data flow", 2)
add_table(doc,
          ["Step", "What happens", "Control"],
          [
              ["1", "The advisor selects a transcript, schedule, or course-offering file.", "The browser checks file type and readable text."],
              ["2", "PDF.js extracts positioned words. The importer reconstructs student headers, terms, courses, grades, sections and meetings.", "Nothing is sent to an outside PDF service."],
              ["3", "The merge matches records by student ID.", "Advisor notes, review state, contacts and schedules are preserved where appropriate."],
              ["4", "The browser sends the validated student list in one authenticated save request.", "The server chooses the advisor from the session, not from the uploaded data."],
              ["5", "The engine builds a snapshot and the interface displays checks and recommendations.", "Rules and source citations remain visible to the advisor."],
          ], [0.45, 3.65, 2.75])

doc.add_page_break()
add_heading(doc, "Current project scope", 2)
add_body(doc, "The private repository contains 77 built-in records for Dr. Julie and 209 for Dr. Mahmoud El Skafi, 90 catalogue courses, 207 known sections, and nine faculty entries. Other advisors, including Dr. Layal, import their records into server storage; those records are not hard-coded into the repository.")

add_heading(doc, "Imports and data quality", 1)
add_q(doc, "Why the university network originally stopped PDF import", "The first version loaded PDF.js from a public content-delivery network. The university network's security filtering blocked that external file, so the browser had no PDF reader.", "Fix: PDF.js and its worker are now stored in web/vendor and embedded by build.js. PDF import no longer depends on cdnjs being reachable.")
add_q(doc, "What PDF.js is", "PDF.js is the PDF-reading library. It extracts the text and its position from a digital PDF so the application can rebuild rows and columns. It is not an AI service and it does not understand the academic rules.", "The importer requires a text-based SIS export. A scanned image has no text layer and is rejected with a clear message.")
add_q(doc, "Why schedules once failed for new students", "The earlier merge expected a transcript-created student record before a schedule could attach. A genuinely new student with no completed transcript therefore had no target record.", "Fix: Merge.applySchedules now creates a schedule-only record by student ID. It is kept under To decide, with its registered courses visible, until the advisor classifies it.")
add_q(doc, "Whether transcripts must be imported first", "No. The order dependency has been removed. A schedule can create the student first; a later transcript enriches the same record and keeps the schedule.", "The regression test schedules imported first are kept until their transcripts arrive verifies this behavior in tests/import-merge.test.js.")
add_q(doc, "Why a new student is not automatically called a freshman", "No transcript means new to the available data, but it does not prove which academic group the student belongs to. The safest action is to keep the schedule and ask the advisor to place the student in Computer Science or Freshmen.", "Schedule-only records use group unsorted and noTranscript true. Academic degree checks wait until the record is classified.")
add_q(doc, "Why some transcript pages have no course rows", "A header-only page can be valid for a new student with no completed courses. The portal labels it as an empty transcript instead of inventing grades or credits.", "The import result separates transcripts with completed courses from empty pages and explains that the schedule can still supply current courses.")
add_q(doc, "How the import checks itself", "For every transcript with courses, the portal recomputes earned credits and CGPA and compares them with the totals printed by the registrar. Any difference is named for review.", "Merge.verifyTranscripts returns matching, differing, and empty records. The printed official figure remains visible when a discrepancy exists.")
add_q(doc, "What wins during a reimport", "The transcript is authoritative for course history, grades, official credits and CGPA. Advisor-entered work such as notes, review state, critical status, meetings, contact corrections, campus decisions and the current schedule is preserved.", "src/merge.js keeps the advisor-owned fields before applying the new transcript data.")
add_q(doc, "How a large import is saved", "The current student list is validated and sent in one authenticated request, which avoids saving half an import if the tab closes or the network drops between individual records.", "POST /api/students/save validates the list and IDs first, then writes every record under the signed-in advisor. The store file itself is written to a temporary file and renamed.")
add_q(doc, "How the course offering is imported", "The advisor imports a term-specific CSV or Excel file containing course, section, CRN, credits, campus and meeting times. Recommendations use the real offering when it is available.", "Schedules also add their known registered sections. If the offering is partial, a missing course is reported as not in the synced list, never falsely declared not offered.")
add_q(doc, "How campuses are identified", "Section labels beginning with B are Beirut and labels beginning with D are Debbieh. The portal records each course's campus and identifies students whose current week uses both campuses.", "A mixed-campus week is displayed as information for planning; it is not automatically treated as an academic violation.")
add_q(doc, "How mistakes are reversed", "Undo restores the state from immediately before the last imported file. The Import page can also clear schedules only or clear that advisor's imported records and start again.", "Clearing all imported records also removes notes and decisions stored inside them. The confirmation text states this because the original PDFs cannot restore those manual details.")

doc.add_page_break()
add_heading(doc, "Advising logic", 1)
add_q(doc, "How the engine avoids contradictory answers", "It creates one snapshot of the student's history and current registration, then every check reads that same snapshot. GPA, completed credits, standing, progress, alerts and recommendations therefore use the same interpretation of the record.", "The central function is snapshot in src/engine.js.")
add_q(doc, "How grades and repeats are handled", "Passing, failed, withdrawn, transferred and annulled attempts are not treated alike. P and TR can earn credit without entering the GPA; W, AW and I do not enter it; a later counted attempt controls whether a course is still owed.", "The engine follows the transcript's I, A and N attempt flags where present and prevents one course from filling a requirement twice.")
add_q(doc, "How probation and remedial status are decided", "Probation follows BAU's published rule: the semester GPA and the CGPA are both below 2.00, which brings a 12-credit cap. Two consecutive academic warnings produce the one-time remedial stage. A low semester average with a CGPA of at least 2.00 is a note, not probation.", "Thresholds are data in rules.json and editable by the department admin through Rules and study plan.")
add_q(doc, "How the track is shown", "A transcript does not prove that a student formally chose a track, so the portal only shows a potential track once three completed or current courses match one BAU list. A spread across lists is shown as general or mixed.", "snapshot() returns trackEstimate: recorded, potential, developing, mixed or none.")
add_q(doc, "What the campus travel check does", "When two consecutive classes are on different campuses with less than one hour between them, the registration and the trial plan show a warning. It is department advising guidance, not a BAU registration block.", "campusTravelGaps() in engine.js; the hour is REG-PREQ-11 in rules.json.")
add_q(doc, "How credit limits are selected", "The engine applies the rule that is actually relevant to the term and student, then uses the lower cap when two restrictions overlap. It handles summer, Intensive English, probation, high-CGPA allowances and the normal 12-to-18 range.", "loadLimits returns both the number and the rule reason, so the interface never shows a limit without an explanation.")
add_q(doc, "How next-course recommendations work", "The engine removes passed courses, missing prerequisites, courses not expected in the target term, and courses too far ahead. It then prioritizes foundation work, overdue core courses, repeats, courses that unlock more of the plan, and suitable electives, while respecting the credit cap.", "recommend scores candidates, adds owed repeats, and checks prerequisites, co-requisites, timetable clashes and campus information. It suggests; the advisor chooses.")
add_q(doc, "How failed courses are treated", "A failed required course remains owed. A failed elective can be repeated or replaced if the requirement block is still short; it disappears from the warning list when that block is already satisfied.", "repeatKind distinguishes required blocks from replaceable elective blocks.")
add_q(doc, "How graduation is checked", "The audit checks every curriculum block plus humanities, social science, general science, WRNL200, IC3, repeats and incomplete work. Requirement blocks are capped so extra courses cannot inflate progress.", "Graduation still depends on total degree credits and the minimum CGPA even when those two conditions are summarized elsewhere on screen.")
add_q(doc, "How special student groups are protected from wrong rules", "Freshmen, Master's students, other programmes, graduates and unsorted new students are kept outside the undergraduate Computer Science checks until the correct rules or a human decision applies.", "The Master's view uses its separate 36-credit programme model. Freshmen retain records, schedules and notes without being judged against the CS degree.")
add_q(doc, "How the mathematics minor is counted", "The minor needs 18 separate MATH credits and must include MATH246 or MATH346. Courses already used as Computer Science core, departmental electives, or General Science are excluded from the minor total.", "The rule is tested in tests/rules.test.js.")

add_heading(doc, "Advisor features", 1)
add_table(doc,
          ["Feature", "What Dr Julie can say", "Technical point"],
          [
              ["Today and notices", "The system puts urgent and planning cases first and explains each reason.", "alerts and statusOf assign urgent, watch, or on-track status."],
              ["All students", "I can search and filter by critical, needs attention, on track, registration status, and credit load.", "Filter limits come from the active rules rather than fixed labels."],
              ["Review state", "I can mark a case reviewed, but a new problem brings it back automatically.", "The review stores the alert keys seen for the current term."],
              ["Critical cases", "A manually critical case stays prominent until the advisor resolves it.", "The admin sees department-wide critical cases read-only."],
              ["Progress", "Each curriculum block shows earned and in-progress credits and what remains.", "The block totals are capped at the requirement."],
              ["This term", "The current registration is checked for load, repeats, prerequisites, clashes and campus travel.", "Meetings come from the schedule PDF."],
              ["Plan next term", "I can try recommended sections without changing registration.", "The trial plan checks credits, prerequisites, co-requisites, clashes and campus."],
              ["Course chain", "I can see what a course requires and what it unlocks.", "Passed, current, available and blocked states come from the same snapshot."],
              ["Contract sheet", "The printable sheet follows the department's familiar advising format.", "It is rendered in a separate print frame to avoid printing the portal shell."],
              ["Transcript", "Completed courses and current courses are shown separately.", "Transcript history never pretends current registration is already passed."],
              ["Notes meetings and holds", "The advisor can preserve context that the SIS PDFs do not contain.", "These fields survive transcript reimport."],
          ], [1.25, 3.1, 2.35])

doc.add_page_break()
add_q(doc, "How Ask Me works", "Ask Me is a deterministic, rule-based search over the advisor's own data. It recognizes names, common comparisons, registration conditions and rule questions, then shows how it interpreted the words.", "src/askme.js contains the parser and rule search. There is no LLM call, API key, or external AI route.")
add_q(doc, "How email works", "The portal prepares only messages that match the student's current state. It can open the advisor's mail application or, when department mail is configured, send through the server with the advisor's BAU address as Reply-To.", "The server validates the recipient and message size. Sending through SMTP or a mail API means that provider processes the email content; this is separate from Ask Me and PDF import.")
add_q(doc, "What the reports contain", "The account panel creates an Excel-compatible workbook with student summaries and transcript courses, and a printable PDF-style summary for the advisor's own list.", "The report is generated in the browser from the records already loaded for that advisor.")
add_q(doc, "How Arabic works", "The interface can switch to Arabic and right-to-left layout, while course codes and other technical identifiers remain stable. Student names use the Arabic form extracted from the transcript when available.", "src/i18n.js uses a controlled dictionary and patterns. A MutationObserver translates content after each screen redraw.")
add_q(doc, "What accessibility support exists", "The interface supports keyboard focus, readable contrast, reduced motion, light and dark themes, and print colors designed for white paper.", "tests/theme.test.js checks color contrast and interaction details; tests/render.smoke.js checks that every major view renders.")

add_heading(doc, "Admin and department features", 1)
add_q(doc, "What the admin can see", "The admin can view students across all advisors and filter by advisor, but every student continues to display the responsible advisor. Account secrets are never included.", "POST /api/all-students is admin-only and returns lists grouped by advisor slug. The student page and department list display advisor ownership, including in Arabic mode.")
add_q(doc, "What the admin can change", "The admin can publish department rule and study-plan changes and can clear the imported records of one explicitly selected advisor. The admin cannot silently edit a student's advising decisions from the department view.", "The clear action is scoped to the selected advisor and has a second confirmation explaining exactly what will be lost.")
add_q(doc, "Who loads the course offering", "Only the department admin. The offering is shared by every advisor, so one person keeps it current and every recommendation uses the same sections.", "onOffering() refuses non-admins and server.js returns 403 for any non-admin write under offering/.")
add_q(doc, "How rule changes are controlled", "Rules are shown as readable sentences with editable numbers. Before publishing, the admin can compare the old and proposed rules across every student. Publishing records who changed what, when, and why; undo creates another history entry.", "src/rulesadmin.js currently exposes 15 controlled rule entries plus course additions, edits and removals. Advisors see the active rules read-only.", page_break_before=True)
add_q(doc, "How suggestions are handled", "Advisors can report an idea, problem, or question to a shared board. The server records the signed-in advisor as the author and can email the maintainer when mail is configured.", "The author slug comes from the session, so the page cannot submit a suggestion under another advisor's identity.")

add_heading(doc, "Security and privacy", 1)
add_body(doc, "The accurate defense is to name the controls that exist and the controls still required. The portal has real authentication and authorization, but it is not yet a university identity or records-management platform.")

add_table(doc,
          ["Risk", "Implemented control", "Important qualification"],
          [
              ["Stolen password database", "PBKDF2-SHA256 with 310,000 iterations and a fresh 16-byte salt per account; constant-time comparison.", "A password is sent over HTTPS for verification but is never stored in clear text."],
              ["Session theft", "A random 32-byte session ID in an HttpOnly, SameSite=Lax cookie; Secure on HTTPS; 12-hour default lifetime.", "Expiry is absolute from sign-in, not a sliding timeout."],
              ["Advisor reads another list", "Every storage path is checked against the signed-in advisor; unauthorized access returns 403.", "Configured portal admins may read all advisor lists by design."],
              ["Student data before sign in", "The server removes embedded student records from the HTML sent over the network and returns records only after authentication.", "The private repository and local build still contain real baseline records."],
              ["Password guessing", "Per-account and per-address rate limits add increasing delays after repeated failures.", "This is application-level throttling, not a university security-monitoring service."],
              ["Cross-site requests", "SameSite cookies plus an Origin host check on browser POST requests.", "This protects the browser flow; API clients without Origin still need a valid session."],
              ["Malicious browser content", "Content Security Policy, frame blocking, no-referrer, nosniff, restricted browser permissions and HSTS on HTTPS.", "The current CSP still permits Google Fonts and cdnjs, although PDF.js itself is bundled locally."],
              ["Path traversal", "Strict key and slug patterns, rejection of '..', and account/session paths blocked from general storage calls.", "Account operations use dedicated endpoints."],
              ["Oversized requests", "Normal requests are capped at 256 KB and import-sized writes at 40 MB.", "Very large valid departmental imports above that limit must be split."],
              ["Password recovery abuse", "Email reset tokens are hashed, expire, work once, and revoke older sessions.", "Email recovery depends on secure mail configuration and control of the BAU mailbox."],
              ["Partial or corrupt saves", "Imports validate before mutation; the server writes store.json.tmp and renames it; shutdown signals flush pending changes.", "This is crash resistance, not a substitute for backups."],
              ["External AI exposure", "Ask Me is local and deterministic; PDF parsing is local.", "Email content may pass through the configured SMTP or mail service."],
          ], [1.25, 3.1, 2.35])

add_q(doc, "Why the repository must remain private", "The repository contains real baseline student records and built output. Publishing it would disclose personal and academic data even though the deployed server hides those records before sign in.", "package.json marks the project private, but that flag does not enforce GitHub visibility. Repository visibility and collaborator access must be managed on GitHub.")
add_q(doc, "How accounts are first claimed", "During setup, an advisor chooses their listed name, enters a BAU email, and sets a password of at least ten characters. Sign-up must then be closed for production.", "ALLOW_SIGNUP defaults to true. The department must set it to false after onboarding because BAU email format is checked but ownership is not verified at initial sign-up.")
add_q(doc, "Whether account existence is private", "Student records and passwords remain private, but the sign-in page can learn which listed advisor accounts have already been created so it can show sign-in versus setup.", "The unauthenticated /api/accounts route returns advisor slugs only. The reset-request response itself is deliberately identical for existing and nonexistent accounts.")
add_q(doc, "Whether stored records are encrypted", "Railway provides encrypted HTTPS transport. The application stores its JSON file on the mounted volume without field-level encryption, so hosting access and backups must be governed carefully.", "Do not claim application-level encryption at rest unless the deployment adds and verifies it.")
add_q(doc, "Who can delete data", "An advisor can clear their own imported records. A portal admin can clear one selected advisor's imported records after confirmation. Account clearing additionally needs a secret ADMIN_TOKEN and an authenticated session.", "Deleting imported records can remove notes and decisions that cannot be recreated from PDFs. Back up before using it on live data.")

doc.add_page_break()
add_heading(doc, "Deployment and continuity", 1)
add_q(doc, "Why Railway is used", "Railway runs the Node server, provides HTTPS, and mounts persistent storage so the same advisor data is available across devices and deployments.", "railway.json starts npm start and checks /health. DATA_DIR must point to the mounted volume.")
add_q(doc, "What happens without the volume", "The container filesystem is temporary, so a redeploy can erase accounts, imports and notes. The mounted volume is mandatory for real use.", "The live file is DATA_DIR/store.json. A volume prevents routine redeploy loss but does not create historical backups.")
add_q(doc, "Which settings matter most", "Production needs DATA_DIR, closed sign-up, administrator slugs, a strong admin token, the public URL, session and reset durations, and secure mail credentials if email is enabled.", "Secrets belong in Railway environment variables, never in the repository or the technical document.")

add_table(doc,
          ["Setting", "Purpose", "Production position"],
          [
              ["DATA_DIR", "Persistent store location", "Mounted Railway volume"],
              ["ALLOW_SIGNUP", "Allow first-time account creation", "true only during controlled onboarding, then false"],
              ["ADMIN_SLUGS", "Department-wide admin visibility", "Small approved list"],
              ["ADMIN_TOKEN", "Emergency account-clear authorization", "Long random secret"],
              ["SESSION_HOURS", "Session lifetime", "12 hours by default"],
              ["PUBLIC_URL", "Links in password-reset email", "Exact HTTPS portal address"],
              ["SMTP_URL or mail API", "Reset, suggestion and optional advisor email", "Stored as platform secrets"],
          ], [1.5, 2.55, 2.65])

add_heading(doc, "Testing and evidence", 1)
add_q(doc, "How the system is tested", "The main automated suite checks academic rules, the real baseline data, PDF parsing, import merging, email construction, a second advisor dataset, themes, every major screen, and atomic bulk saving. Separate browser tests exercise server security, password-reset email, and a full advisor journey.", "npm test is the required fast regression suite. npm run test:security, npm run test:email, and npm run test:full are end-to-end scripts that require the browser test environment.")

add_table(doc,
          ["Evidence", "What it proves"],
          [
              ["rules.test.js", "Grades, GPA, load limits, probation, remedial, English levels, repeats, prerequisites, electives, degree progress and recommendations"],
              ["real-data.test.js", "For Dr. Julie's 77 baseline students, computed CGPA, credits and term results match the registrar data"],
              ["import.test.js and import-merge.test.js", "Transcript and schedule layouts parse correctly; order-independent imports preserve advisor work"],
              ["skafi.test.js", "The system handles 209 records, Arabic names, freshmen, empty transcripts and schedule-only students for another advisor"],
              ["render.smoke.js and theme.test.js", "Advisor and admin views render, Arabic ownership appears, and visual interaction rules remain consistent"],
              ["bulk-save.test.js", "A schedule import is saved through the authenticated atomic endpoint and returns registered"],
              ["security.e2e.js", "Unauthenticated denial, advisor isolation, hidden account records, rate limiting, session end and security headers"],
          ], [2.15, 4.55])

add_q(doc, "What testing cannot prove", "Automated tests show that known cases behave consistently; they do not certify every future SIS PDF layout, every university rule interpretation, or the hosting provider's security. A registrar or department owner must validate rule changes and deployment controls.")

add_heading(doc, "Known limits and the safe answer", 1)
add_table(doc,
          ["Question", "Short honest answer"],
          [
              ["Is it the official SIS", "No. It is an advising support layer that reads SIS exports and never writes back."],
              ["Can it replace the advisor", "No. It explains evidence and recommendations; the advisor decides."],
              ["Does it have BAU single sign on", "Not yet. It has its own secure accounts. SSO is the next identity improvement."],
              ["Are backups automatic", "Persistent storage is configured, but a scheduled independent backup and restore test are still required."],
              ["Is there a full audit trail", "Rules have history and student records have update timestamps, but there is no immutable log of every student-data change."],
              ["Is data encrypted inside store.json", "No field-level encryption is implemented. HTTPS protects transport; platform and backup access must protect storage."],
              ["Can it read scans", "No. It needs the text-based PDF exported by the SIS, not a photograph or scanned printout."],
              ["Can every future PDF be guaranteed", "No. The parser is tested against the current BAU layouts. A changed SIS layout must be tested and may require an update."],
              ["Can static hosting hold real records", "No. A static copy lacks server authentication and shared protected storage; it is for demonstration only."],
              ["Does it use AI", "No external AI is used. Ask Me is rule based, and PDF.js only extracts document text."],
          ], [2.05, 4.65])

add_heading(doc, "Operational protections before formal adoption", 2)
add_bullet(doc, "Keep the GitHub repository private and review collaborator access regularly.")
add_bullet(doc, "Close ALLOW_SIGNUP after controlled onboarding and use BAU SSO when available.")
add_bullet(doc, "Schedule encrypted backups of store.json outside the running service and test restoration.")
add_bullet(doc, "Define an owner for access approval, account removal, retention, incident response and rule publication.")
add_bullet(doc, "Add an immutable audit log for imports, edits, deletion, admin viewing and exports before calling it a system of record.")
add_bullet(doc, "Document Railway's region, subprocessors, retention and institutional approval for real student data.")
add_bullet(doc, "Run the main and browser security tests after authentication, parser or server changes.")

add_heading(doc, "Rapid defense answers", 1)
rapid = [
    ("Why not connect directly to the SIS", "The SIS is not exposed as an approved API. PDF and CSV import is the controlled path using files the department already receives."),
    ("Why not use AI for advising", "Academic rules must be reproducible and explainable. A deterministic engine gives the same answer from the same data and can cite the rule."),
    ("How do you prevent a wrong recommendation", "The engine filters by completed work, prerequisites, term, plan position, current registration and credit limits, then shows the reasons. The advisor still approves the plan."),
    ("What if the network blocks external libraries", "The PDF reader is now bundled locally. Fonts may fall back, but PDF import no longer depends on the blocked CDN."),
    ("What if the schedule arrives before the transcript", "The schedule creates a temporary student record and is saved immediately. The later transcript joins by student ID without deleting the schedule."),
    ("What if a transcript has no courses", "The portal keeps the student and labels the transcript as empty. Current courses can still come from the schedule."),
    ("How do you know the PDF was read correctly", "The portal recomputes CGPA and credits from course rows and compares them with the registrar's printed totals."),
    ("Can two advisors have the same student", "Yes. Records are namespaced by advisor, so the same student ID can exist independently in two advisor lists."),
    ("Can the admin see everything", "The configured portal admin can read department student lists and critical cases but cannot retrieve account hashes. Ownership remains visible on every student."),
    ("Can imports be undone", "The latest file import can be undone. Broader clearing is available with confirmation, but manually entered notes need backups because PDFs cannot recreate them."),
    ("What happens during a redeploy", "The running code is replaced, while the mounted DATA_DIR volume keeps accounts and advisor data. The server flushes pending writes during normal shutdown."),
    ("What is the strongest security limitation", "The system still needs university SSO, formal data governance, independent backups, and a complete audit log before it should be treated as the university system of record."),
]
for question, answer in rapid:
    add_q(doc, question, answer, page_break_before=(question == "Can imports be undone"))

add_heading(doc, "Technical reference", 1)
add_table(doc,
          ["File", "Responsibility"],
          [
              ["src/engine.js", "Academic snapshot, GPA, standing, load, progress, recommendations, repeats, graduation and alerts"],
              ["src/pdfimport.js", "BAU transcript and schedule text parsing, multi-page joining and section extraction"],
              ["src/merge.js", "ID-based transcript and schedule merge, schedule-only records, validation summaries"],
              ["src/store.js", "Server/local storage abstraction, accounts, advisor data, reports and configuration calls"],
              ["src/app.js", "Advisor and admin screens, import workflow, student tools, reports and interaction"],
              ["src/askme.js", "Deterministic natural-language matching over rules and advisor records"],
              ["src/rulesadmin.js", "Readable rule editing, impact preview, publish history and undo"],
              ["src/i18n.js", "Arabic translation and right-to-left behavior"],
              ["server.js", "Authentication, sessions, authorization, storage, security headers and API"],
              ["mail.js", "SMTP or mail-API delivery for reset links, suggestions and advisor messages"],
              ["build.js", "Single-page build and local PDF.js embedding"],
              ["tests/", "Rules, real data, imports, multiple advisors, interface, persistence and security"],
          ], [2.0, 4.7])

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(10)
r = p.add_run("Final sentence to use  ")
set_font(r, bold=True, color=TEXT)
r = p.add_run("The system is defensible because its academic decisions are explicit, its import checks are visible, and its access boundaries are enforced on the server. It should be presented as a secure advising support system under active university governance, not yet as the official student record.")
set_font(r, color=TEXT)

OUT.parent.mkdir(parents=True, exist_ok=True)
doc.save(OUT)
print(OUT)
