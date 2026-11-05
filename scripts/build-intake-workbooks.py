"""
Builds one set-up workbook per faculty, ready to send.

Each workbook is pre-filled with what the system already knows about that
faculty (departments, programmes and the study plans read from the 2020-2021
catalogue), so the faculty checks and corrects instead of typing from nothing.
The sheet and column names are what scripts/intake.js and the "Load a faculty
workbook" button read back, so do not rename them.

    python scripts/build-intake-workbooks.py [output folder]
"""
import json
import os
import re
import sys

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'intake')
FORMAT_VERSION = 'BAU-INTAKE-1'

SEED = json.load(open(os.path.join(ROOT, 'data', 'catalogue-2020.json'), encoding='utf8'))
CS = json.load(open(os.path.join(ROOT, 'data', 'catalog.json'), encoding='utf8'))
RULES = json.load(open(os.path.join(ROOT, 'data', 'rules.json'), encoding='utf8'))


def rule_value(path, fallback=None):
    node = RULES
    for key in path.split('.'):
        if not isinstance(node, dict) or key not in node:
            return fallback
        node = node[key]
    return node


# ---- the rule catalogue -----------------------------------------------------
# id, group, question, unit, system key ('' = recorded, checked by hand for now),
# university default, source
RULE_ROWS = [
    ('LOAD_MIN', 'Credit load', 'Minimum credits a student registers in fall or spring', 'credits', 'R.load.REG-LOAD-01.min', rule_value('load.REG-LOAD-01.min'), 'R&R V.5 (scientific faculties 12, humanities faculties 9)'),
    ('LOAD_MAX', 'Credit load', 'Maximum credits in fall or spring', 'credits', 'R.load.REG-LOAD-01.max', rule_value('load.REG-LOAD-01.max'), 'R&R V.5'),
    ('SUMMER_MAX', 'Credit load', 'Maximum credits in summer', 'credits', 'R.load.REG-LOAD-05.max', rule_value('load.REG-LOAD-05.max'), 'R&R V.3-3'),
    ('HIGH_LOAD_CGPA', 'Credit load', 'CGPA needed to take an overload', 'GPA', 'R.load.REG-LOAD-02.requiresCgpa', rule_value('load.REG-LOAD-02.requiresCgpa'), 'R&R V.2-4'),
    ('HIGH_LOAD_EARNED', 'Credit load', 'Credits earned needed to take an overload', 'credits', 'R.load.REG-LOAD-02.requiresEarned', rule_value('load.REG-LOAD-02.requiresEarned'), 'R&R V.2-4'),
    ('HIGH_LOAD_MAX', 'Credit load', 'Maximum credits with an overload', 'credits', 'R.load.REG-LOAD-02.max', rule_value('load.REG-LOAD-02.max'), 'R&R V.2-4'),
    ('SENIOR_CGPA', 'Credit load', 'CGPA a graduating student needs to take extra credits', 'GPA', 'R.load.REG-LOAD-03.requiresCgpa', rule_value('load.REG-LOAD-03.requiresCgpa'), 'R&R V.2-6'),
    ('SENIOR_MAX', 'Credit load', 'Maximum credits for a graduating student', 'credits', 'R.load.REG-LOAD-03.max', rule_value('load.REG-LOAD-03.max'), 'R&R V.2-6'),
    ('PROBATION_GPA', 'Academic standing', 'Semester GPA and CGPA both below this give an academic warning', 'GPA', 'R.probation.warningThresholdCgpa', rule_value('probation.warningThresholdCgpa'), 'R&R VII'),
    ('PROBATION_CAP', 'Academic standing', 'Maximum credits the semester after a warning', 'credits', 'R.probation.warningLoadCap', rule_value('probation.warningLoadCap'), 'R&R V.2-5, VII'),
    ('REMEDIAL_AFTER', 'Academic standing', 'Warnings in a row that put a student in the remedial stage', 'warnings', 'R.probation.remedialAfter', 2, 'R&R VII'),
    ('REMEDIAL_CAP', 'Academic standing', 'Maximum credits in fall or spring in the remedial stage', 'credits', 'R.probation.remedialFallSpringCap', rule_value('probation.remedialFallSpringCap'), 'R&R VII'),
    ('REMEDIAL_SUMMER', 'Academic standing', 'Maximum credits in summer in the remedial stage', 'credits', 'R.probation.remedialSummerCap', rule_value('probation.remedialSummerCap'), 'R&R VII'),
    ('DISMISS_CGPA', 'Academic standing', 'CGPA below which a student on probation is dismissed', 'GPA', 'R.probation.dismissCgpaBelow', rule_value('probation.dismissCgpaBelow'), 'R&R VII'),
    ('GRAD_CGPA', 'Graduation', 'Minimum CGPA to graduate', 'GPA', 'R.graduation.minCgpa', rule_value('graduation.minCgpa'), 'R&R VIII.3 (a faculty may ask for more, VIII.4)'),
    ('IC3_DUE', 'Graduation', 'Semester by which the ICDL/IC3 certificate is due', 'semester', 'R.nonCredit.REG-UE-06.dueBySemester', rule_value('nonCredit.REG-UE-06.dueBySemester'), 'R&R VIII.2'),
    ('UE_TOTAL', 'University courses', 'University elective credits', 'credits', 'R.universityElectives.REG-UE-03.totalCredits', rule_value('universityElectives.REG-UE-03.totalCredits'), 'R&R III.3.2 (12 to 21 university credits per faculty)'),
    ('UE_MIN_HUM', 'University courses', 'Minimum humanities university electives', 'courses', 'R.universityElectives.REG-UE-03.minHumanitiesCourses', rule_value('universityElectives.REG-UE-03.minHumanitiesCourses'), 'Contract sheet'),
    ('UE_MIN_SOC', 'University courses', 'Minimum social science university electives', 'courses', 'R.universityElectives.REG-UE-03.minSocialCourses', rule_value('universityElectives.REG-UE-03.minSocialCourses'), 'Contract sheet'),
    ('WRNL_FROM', 'University courses', 'Work Ready Now (WRNL200) required for students admitted from this year', 'year', 'R.universityElectives.REG-UE-05.appliesFromAdmissionYear', rule_value('universityElectives.REG-UE-05.appliesFromAdmissionYear'), 'University notice'),
    ('WRNL_AFTER', 'University courses', 'Work Ready Now is taken once a student passes this many credits', 'credits', 'R.universityElectives.REG-UE-05.requiredAboveEarnedCredits', rule_value('universityElectives.REG-UE-05.requiredAboveEarnedCredits'), 'University notice'),
    ('CORE_AHEAD', 'Advising', 'How many semesters ahead of the plan a core course may be recommended', 'semesters', 'C.coreAheadSemesters', 1, 'Department practice'),
    ('ELECTIVE_SLOTS', 'Advising', 'Semesters where the plan places a major elective (e.g. 4, 5, 6)', 'list', 'C.deptElectiveSlots', '', 'Study plan'),
    # recorded now, applied by hand until the system has a rule for them
    ('HONOURS_CGPA', 'Graduation', 'CGPA for graduating with honours', 'GPA', '', rule_value('graduation.honorsCgpa'), 'R&R VIII.5'),
    ('MIN_GRADE_MAJOR', 'Grades', 'Lowest grade accepted in major courses, if stricter than D', 'grade', '', 'D', 'R&R VIII.4 allows a faculty rule'),
    ('MIN_GRADE_PREREQ', 'Grades', 'Lowest grade in a prerequisite that still opens the next course', 'grade', '', 'D', 'Faculty practice'),
    ('ATTENDANCE_AW', 'Attendance', 'Absence (%) at which a student is withdrawn from a course', 'percent', '', rule_value('calendar.attendanceAwPct'), 'R&R XI.4'),
    ('YEAR_PROGRESSION', 'Progression', 'Must a whole year (or module block) be passed before the next one?', 'Yes/No', '', 'No', 'Faculty regulations'),
    ('INTERNSHIP', 'Training', 'Internship or clinical training: when, how long, and what it needs first', 'text', '', '', 'Faculty regulations'),
    ('EXIT_EXAM', 'Graduation', 'Exit or comprehensive exam, licensing exam, colloquium', 'text', '', '', 'Faculty regulations'),
    ('ENTRY_TEST', 'Admission', 'Entrance or placement test that changes what a new student registers', 'text', '', '', 'Faculty regulations'),
    ('TRANSFER_MIN_GRADE', 'Transfer', 'Lowest grade accepted for a transferred course', 'grade', '', rule_value('transfer.minGrade'), 'R&R X'),
    ('OTHER', 'Other', 'Any other rule a student or advisor must follow (one row each)', 'text', '', '', ''),
]

BLOCKS = [
    ('UNIV_MANDATORY', 'University requirements (mandatory)'),
    ('UNIV_ELECTIVE', 'University electives'),
    ('FACULTY_CORE', 'Faculty requirements (common to the faculty)'),
    ('MAJOR_CORE', 'Major requirements'),
    ('DEPT_ELECTIVE', 'Major electives'),
    ('GEN_SCI_ELECTIVE', 'Free or general electives'),
    ('INTERNSHIP', 'Internship, training or project'),
    ('REMEDIAL', 'Remedial or foundation (not toward the degree)'),
    ('INTENSIVE', 'Intensive English (not toward the degree)'),
    ('NON_CREDIT', 'Non-credit requirement (e.g. ICDL/IC3)'),
]
OFFERED = ['Fall', 'Spring', 'Summer', 'Fall and Spring', 'Every semester']
DEGREES = ['BSc', 'BA', 'BBA', 'BE', 'BArch', 'BDS', 'MD / MBBCh', 'PharmD', 'BPharm', 'LLB', 'Diploma', 'Other']
CAMPUSES = ['Beirut', 'Debbieh', 'Tripoli', 'Bekaa']
ACTIONS = ['Keep', 'Change', 'Add', 'Remove']
CHECKED = ['To check', 'Checked', 'Changed', 'New']
HOW = ['All courses listed', 'Choose from a list', 'Choose from the university list', 'Any course of the faculty']
KINDS = ['Lecture', 'Lab', 'Lecture + lab', 'Clinical', 'Studio', 'Project', 'Internship', 'Seminar']
LIST_TYPES = ['Track', 'Elective list', 'Minor', 'Concentration', 'Module']
ROLES = ['Faculty admin', 'Programme editor', 'Approver', 'Advisor', 'Viewer']
YESNO = ['Yes', 'No']
LOAD_GROUP = ['Scientific (12 to 18 credits)', 'Humanities (9 to 18 credits)', 'Own rule (see sheet 7)']
SYSTEMS = ['Credit hours, course by course', 'Credit hours, year must be passed', 'Modules / blocks']

# ---- styles -----------------------------------------------------------------
FONT = 'Arial'
NAVY = '1F3A5F'
f_title = Font(name=FONT, size=15, bold=True, color=NAVY)
f_sub = Font(name=FONT, size=10, color='444444')
f_head = Font(name=FONT, size=10, bold=True, color='FFFFFF')
f_body = Font(name=FONT, size=10)
f_example = Font(name=FONT, size=10, italic=True, color='7F7F7F')
f_bold = Font(name=FONT, size=10, bold=True)
f_link = Font(name=FONT, size=10, color='0563C1', underline='single')
fill_head = PatternFill('solid', fgColor=NAVY)
fill_input = PatternFill('solid', fgColor='FFF7D6')    # you fill in
fill_prefill = PatternFill('solid', fgColor='EEF2F7')  # pre-filled, please check
fill_calc = PatternFill('solid', fgColor='E6F4EA')     # worked out for you
fill_example = PatternFill('solid', fgColor='F2F2F2')
thin = Side(style='thin', color='D0D7DE')
box = Border(left=thin, right=thin, top=thin, bottom=thin)
wrap = Alignment(wrap_text=True, vertical='top')

HEADER_ROW = 5
FIRST_ROW = 7          # row 6 is the example
LAST_ROW = 600         # validations and checks reach this far


def slug(text):
    return re.sub(r'(^-|-$)', '', re.sub(r'[^a-z0-9]+', '-', str(text).lower()))[:60]


def title_block(ws, title, subtitle, legend=True):
    ws['A1'] = title
    ws['A1'].font = f_title
    ws['A2'] = subtitle
    ws['A2'].font = f_sub
    ws['A2'].alignment = Alignment(wrap_text=False)
    if legend:
        ws['A3'] = 'Yellow: fill in.   Blue: copied from the 2020-2021 catalogue, please check.   Green: worked out for you.   Grey row 6: an example, leave it.'
        ws['A3'].font = Font(name=FONT, size=9, italic=True, color='666666')
    ws.sheet_view.showGridLines = False


def table(ws, columns, rows, example, notes=None):
    """columns: (header, width, kind) where kind is 'input', 'calc' or 'key'."""
    for i, (head, width, _kind) in enumerate(columns, start=1):
        c = ws.cell(row=HEADER_ROW, column=i, value=head)
        c.font, c.fill, c.alignment, c.border = f_head, fill_head, Alignment(wrap_text=True, vertical='center'), box
        ws.column_dimensions[get_column_letter(i)].width = width
        if notes and head in notes:
            c.comment = Comment(notes[head], 'Advising system')
    ws.row_dimensions[HEADER_ROW].height = 32
    for i, value in enumerate(example, start=1):
        c = ws.cell(row=HEADER_ROW + 1, column=i, value=value)
        c.font, c.fill, c.border = f_example, fill_example, box
    for r, row in enumerate(rows, start=FIRST_ROW):
        for i, value in enumerate(row, start=1):
            c = ws.cell(row=r, column=i, value=value)
            c.font, c.border = f_body, box
            c.alignment = Alignment(vertical='top', wrap_text=isinstance(value, str) and len(value) > 40)
            kind = columns[i - 1][2]
            if kind == 'calc':
                c.fill = fill_calc
            elif value not in (None, '') and not str(value).startswith('='):
                c.fill = fill_prefill
            else:
                c.fill = fill_input
    # empty rows ready to type into
    start = FIRST_ROW + len(rows)
    for r in range(start, start + 40):
        for i, (_h, _w, kind) in enumerate(columns, start=1):
            c = ws.cell(row=r, column=i)
            c.border = box
            c.font = f_body
            c.fill = fill_calc if kind == 'calc' else fill_input
    ws.freeze_panes = ws.cell(row=HEADER_ROW + 1, column=3)
    ws.auto_filter.ref = 'A{}:{}{}'.format(HEADER_ROW, get_column_letter(len(columns)), start + 39)
    return start + 40


def dropdown(ws, col, source, prompt=None, strict=True):
    dv = DataValidation(type='list', formula1=source, allow_blank=True,
                        showErrorMessage=True, errorStyle='stop' if strict else 'warning')
    if not strict:
        dv.error = 'This is not one of the usual values. Keep it only if you are sure.'
        dv.errorTitle = 'Unusual value'
    if prompt:
        dv.prompt = prompt
        dv.showInputMessage = True
    ws.add_data_validation(dv)
    dv.add('{0}{1}:{0}{2}'.format(col, FIRST_ROW, LAST_ROW))


def number_rule(ws, col, low, high, whole=True):
    dv = DataValidation(type='whole' if whole else 'decimal', operator='between',
                        formula1=str(low), formula2=str(high), allow_blank=True, showErrorMessage=True)
    dv.error = 'Enter a number from {} to {}.'.format(low, high)
    ws.add_data_validation(dv)
    dv.add('{0}{1}:{0}{2}'.format(col, FIRST_ROW, LAST_ROW))


def flag_rule(ws, rng, formula):
    ws.conditional_formatting.add(rng, FormulaRule(formula=[formula], fill=PatternFill('solid', fgColor='F8D7DA'),
                                                   font=Font(name=FONT, color='9C0006')))


def offered_label(runs):
    runs = [r.upper() for r in (runs or [])]
    if set(runs) >= {'FALL', 'SPRING', 'SUMMER'}:
        return 'Every semester'
    if set(runs) == {'FALL', 'SPRING'}:
        return 'Fall and Spring'
    if runs == ['FALL']:
        return 'Fall'
    if runs == ['SPRING']:
        return 'Spring'
    if runs == ['SUMMER']:
        return 'Summer'
    return 'Fall and Spring'


# ---- one workbook -----------------------------------------------------------
def build(faculty):
    fid = faculty['id']
    plans = dict(SEED['plans'])
    plans['cs'] = CS
    programmes = [(d, p) for d in faculty['departments'] for p in d['programmes']]

    wb = Workbook()
    start = wb.active
    start.title = 'Start here'

    # Lists (hidden) holds every dropdown
    lists = wb.create_sheet('Lists')
    columns = {
        'A': ['Block keys'] + [b[0] for b in BLOCKS],
        'B': ['Offered'] + OFFERED,
        'C': ['Degree'] + DEGREES,
        'D': ['Campus'] + CAMPUSES,
        'E': ['Action'] + ACTIONS,
        'F': ['Status'] + CHECKED,
        'G': ['How chosen'] + HOW,
        'H': ['Course type'] + KINDS,
        'I': ['List type'] + LIST_TYPES,
        'J': ['Role'] + ROLES,
        'K': ['Yes/No'] + YESNO,
        'L': ['Load group'] + LOAD_GROUP,
        'M': ['Study system'] + SYSTEMS,
        'N': ['Rule ID'] + [r[0] for r in RULE_ROWS],
        'O': ['Rule'] + [r[2] for r in RULE_ROWS],
        'P': ['University value'] + [r[5] for r in RULE_ROWS],
        'Q': ['Unit'] + [r[3] for r in RULE_ROWS],
        'R': ['Applied by the system'] + [('Automatically' if r[4] else 'Recorded, checked by hand for now') for r in RULE_ROWS],
        'S': ['Source'] + [r[6] for r in RULE_ROWS],
        'T': ['Grades'] + ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'D-'],
    }
    for col, values in columns.items():
        for i, v in enumerate(values, start=1):
            lists['{}{}'.format(col, i)] = v
    # IDs a row may point at: ALL, then every programme, department and the faculty
    lists['V1'] = 'Programme IDs'
    lists['V2'] = 'ALL'
    for i in range(60):
        lists['V{}'.format(i + 3)] = "=IF('3 Programmes'!A{0}=\"\",\"\",'3 Programmes'!A{0})".format(FIRST_ROW + i)
    lists['W1'] = 'Scope IDs'
    lists['W2'] = fid
    for i in range(30):
        lists['W{}'.format(i + 3)] = "=IF('2 Departments'!A{0}=\"\",\"\",'2 Departments'!A{0})".format(FIRST_ROW + i)
    for i in range(60):
        lists['W{}'.format(i + 33)] = "=IF('3 Programmes'!A{0}=\"\",\"\",'3 Programmes'!A{0})".format(FIRST_ROW + i)
    lists['Y1'] = 'Format'
    lists['Y2'] = FORMAT_VERSION
    lists['Y3'] = fid
    lists.sheet_state = 'hidden'

    def src(col, n):
        return '=Lists!${0}$2:${0}${1}'.format(col, n + 1)

    # ---- 1 Faculty -----------------------------------------------------------
    ws = wb.create_sheet('1 Faculty')
    title_block(ws, '1. The faculty', 'Who we are talking to, and the few facts that hold for the whole faculty.')
    ws.column_dimensions['A'].width = 46
    ws.column_dimensions['B'].width = 52
    ws.column_dimensions['C'].width = 60
    for i, h in enumerate(['Question', 'Answer', 'Why we ask'], start=1):
        c = ws.cell(row=HEADER_ROW, column=i, value=h)
        c.font, c.fill, c.border = f_head, fill_head, box
    fields = [
        ('Faculty ID', fid, 'Used by the system. Do not change it.'),
        ('Faculty name (English)', faculty['name'], 'As printed on transcripts.'),
        ('Faculty name (Arabic)', faculty.get('nameAr', ''), 'Shown on Arabic pages and printouts.'),
        ('Dean', '', 'Signs off sheet 11.'),
        ('Faculty coordinator for this workbook (name)', '', 'The one person we ask questions to.'),
        ('Coordinator email (@bau.edu.lb)', '', ''),
        ('Coordinator phone or extension', '', ''),
        ('Campuses where the faculty teaches', ', '.join(sorted({c for _d, p in programmes for c in p.get('campuses', [])})), 'Comma separated: Beirut, Debbieh, Tripoli, Bekaa.'),
        ('Load group under R&R V.5', '', 'Scientific faculties register 12 to 18 credits, humanities faculties 9 to 18.'),
        ('Study system', '', 'Most programmes are course by course. Medicine-type programmes often require a whole year to be passed.'),
        ('Catalogue year these answers describe', '2026-2027', 'Students keep the plan of the year they entered, so older plans stay valid.'),
        ('Earlier catalogue years still followed by current students', '', 'For example 2020-2021, 2023-2024. We will ask for those plans separately.'),
        ('Faculty regulations document (link or file name)', '', 'So every rule in sheet 7 can be traced to a page.'),
        ('Anything special about this faculty we should know', '', 'Free text.'),
    ]
    for r, (q, a, why) in enumerate(fields, start=HEADER_ROW + 1):
        ws.cell(row=r, column=1, value=q).font = f_bold
        c = ws.cell(row=r, column=2, value=a or None)
        c.fill = fill_prefill if a else fill_input
        c.font = f_body
        c.alignment = wrap
        w = ws.cell(row=r, column=3, value=why)
        w.font = f_sub
        w.alignment = wrap
        for col in range(1, 4):
            ws.cell(row=r, column=col).border = box
    for label, col in (('Load group under R&R V.5', 'L'), ('Study system', 'M')):
        row = HEADER_ROW + 1 + [f[0] for f in fields].index(label)
        dv = DataValidation(type='list', formula1='=Lists!${0}$2:${0}${1}'.format(col, len(LOAD_GROUP if col == 'L' else SYSTEMS) + 1), allow_blank=True)
        ws.add_data_validation(dv)
        dv.add('B{}'.format(row))
    ws.cell(row=HEADER_ROW + 1, column=2).fill = fill_calc
    ws.freeze_panes = 'A6'

    # ---- 2 Departments -------------------------------------------------------
    ws = wb.create_sheet('2 Departments')
    title_block(ws, '2. Departments', 'One row per department. Mark a department Remove only if it no longer exists; nothing is deleted without asking.')
    cols = [('Department ID', 30, 'key'), ('Department name (English)', 40, 'input'), ('Department name (Arabic)', 32, 'input'),
            ('Chairperson', 26, 'input'), ('Chairperson email', 30, 'input'), ('Action', 12, 'input'), ('Notes', 44, 'input')]
    rows = [[d['id'], d['name'], d.get('nameAr'), None, None, 'Keep',
             'Placeholder from the catalogue: please give the real department.' if 'to-confirm' in d['id'] or 'faculty-wide' in d['id'] else None]
            for d in faculty['departments']]
    table(ws, cols, rows, ['example-department', 'Mathematics and Computer Science', 'الرياضيات وعلوم الحاسوب', 'Dr. A. Example', 'a.example@bau.edu.lb', 'Keep', ''],
          notes={'Department ID': 'Short, lowercase, dashes only. Leave blank for a new department: the system makes one from the name.'})
    dropdown(ws, 'F', src('E', len(ACTIONS)))

    # ---- 3 Programmes ---------------------------------------------------------
    ws = wb.create_sheet('3 Programmes')
    title_block(ws, '3. Programmes', 'One row per degree the faculty awards. Green columns check themselves against sheets 4 and 5.')
    cols = [('Programme ID', 24, 'key'), ('Department ID', 28, 'input'), ('Degree name (English)', 36, 'input'), ('Degree name (Arabic)', 30, 'input'),
            ('Degree type', 12, 'input'), ('Campuses', 26, 'input'), ('Language of teaching', 14, 'input'), ('Catalogue year', 12, 'input'),
            ('Total credits', 10, 'input'), ('Standard semesters', 11, 'input'), ('Maximum semesters', 11, 'input'),
            ('Study system', 26, 'input'), ('Admits new students', 11, 'input'), ('Action', 10, 'input'), ('Status', 12, 'input'),
            ('Programme contact (email)', 28, 'input'), ('Notes', 36, 'input'),
            ('Suggested ID', 24, 'calc'), ('Courses entered', 10, 'calc'), ('Blocks add up to', 11, 'calc'), ('Check', 34, 'calc')]
    rows = []
    for d, p in programmes:
        plan = plans.get(p['id']) or {}
        rows.append([p['id'], d['id'], p['name'], p.get('nameAr'), (p['name'].split(' ')[0] if p['name'].split(' ')[0] in DEGREES else None),
                     ', '.join(p.get('campuses', [])), 'English', plan.get('catalogYear'), plan.get('totalCredits'),
                     plan.get('standardSemesters'), plan.get('maxSemesters'), None, 'Yes', 'Keep',
                     'To check' if plan else 'New', None,
                     None if plan else 'No study plan in the system yet: please fill sheets 4 and 5.'])
    end = table(ws, cols, rows, ['example-programme', 'example-department', 'BSc Example Science', 'بكالوريوس', 'BSc', 'Beirut, Debbieh',
                                  'English', 2026, 100, 6, 12, SYSTEMS[0], 'Yes', 'Keep', 'Checked', 'a.example@bau.edu.lb', '', '', '', '', ''],
                notes={'Maximum semesters': 'R&R VIII.1: at most double the standard length.',
                       'Programme ID': 'Leave blank for a new programme; copy the Suggested ID if you like it.',
                       'Status': 'Change "To check" to "Checked" once the plan in sheets 4 and 5 is right.'})
    for r in range(FIRST_ROW, end):
        ws['R{}'.format(r)] = '=IF(C{0}="","",LOWER(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(TRIM(C{0})," ","-"),".",""),",","")))'.format(r)
        ws['S{}'.format(r)] = "=IF(A{0}=\"\",\"\",COUNTIF('5 Courses'!$A$7:$A${1},A{0})+COUNTIF('5 Courses'!$A$7:$A${1},\"ALL\"))".format(r, LAST_ROW)
        ws['T{}'.format(r)] = "=IF(A{0}=\"\",\"\",SUMIFS('4 Blocks'!$D$7:$D${1},'4 Blocks'!$A$7:$A${1},A{0},'4 Blocks'!$E$7:$E${1},\"Yes\"))".format(r, LAST_ROW)
        ws['U{}'.format(r)] = ('=IF(A{0}="","",IF(I{0}="","Give the total credits",IF(T{0}<>I{0},"Blocks add up to "&T{0}&", total is "&I{0},'
                               'IF(S{0}=0,"No courses yet in sheet 5",IF(AND(K{0}<>"",J{0}<>"",K{0}>2*J{0}),"Maximum is more than double the standard length","OK")))))').format(r)
    dropdown(ws, 'B', '=Lists!$W$3:$W$32', strict=False)
    dropdown(ws, 'E', src('C', len(DEGREES)), strict=False)
    dropdown(ws, 'G', '"English,Arabic,French,English and Arabic"', strict=False)
    dropdown(ws, 'L', src('M', len(SYSTEMS)))
    dropdown(ws, 'M', src('K', 2))
    dropdown(ws, 'N', src('E', len(ACTIONS)))
    dropdown(ws, 'O', src('F', len(CHECKED)))
    number_rule(ws, 'H', 2000, 2100)
    number_rule(ws, 'I', 1, 300)
    number_rule(ws, 'J', 1, 16)
    number_rule(ws, 'K', 1, 30)
    flag_rule(ws, 'U{}:U{}'.format(FIRST_ROW, end), 'AND($U{0}<>"",$U{0}<>"OK")'.format(FIRST_ROW))

    # ---- 4 Blocks ---------------------------------------------------------------
    ws = wb.create_sheet('4 Blocks')
    title_block(ws, '4. Requirement blocks', 'How each degree is divided, exactly as the study plan prints it (e.g. University requirements 5, Major core 27).')
    cols = [('Programme ID', 24, 'key'), ('Block key', 20, 'input'), ('Block name as printed', 40, 'input'), ('Credits required', 10, 'input'),
            ('Counts toward the degree', 11, 'input'), ('How courses are chosen', 28, 'input'), ('Courses to pass (if a number)', 12, 'input'),
            ('Status', 12, 'input'), ('Notes', 40, 'input'), ('Credits listed in sheet 5', 12, 'calc'), ('Check', 36, 'calc')]
    rows = []
    for _d, p in programmes:
        plan = plans.get(p['id'])
        if plan:
            for key, b in plan['buckets'].items():
                if key in ('FRESHMAN', 'OTHER') or (b.get('credits', 0) == 0 and key == 'GEN_SCI_ELECTIVE'):
                    continue
                how = {'UNIV_ELECTIVE': HOW[2], 'DEPT_ELECTIVE': HOW[1], 'GEN_SCI_ELECTIVE': HOW[3]}.get(key, HOW[0])
                rows.append([p['id'], key, b['label'], b.get('credits', 0), 'Yes', how, None, 'To check', None])
            used = {c.get('bucket') for c in plan['courses']}
            for key, label in BLOCKS[7:]:
                if key in used:
                    rows.append([p['id'], key, label, 0, 'No', HOW[0], None, 'To check', 'Needed by some students only; not part of the degree credits.'])
        else:
            for key, label in BLOCKS[:5]:
                rows.append([p['id'], key, label, None, 'Yes', {'UNIV_ELECTIVE': HOW[2], 'DEPT_ELECTIVE': HOW[1]}.get(key, HOW[0]), None, 'New', None])
    end = table(ws, cols, rows, ['example-programme', 'MAJOR_CORE', 'Major Core Courses', 27, 'Yes', HOW[0], '', 'Checked', '', '', ''],
                notes={'Block key': 'Pick a standard key. Need a new kind of block? Type a short key in capitals, e.g. CLINICAL_YEAR.',
                       'How courses are chosen': '"All courses listed" means every course in sheet 5 for this block is required.'})
    for r in range(FIRST_ROW, end):
        ws['J{}'.format(r)] = ("=IF(A{0}=\"\",\"\",SUMIFS('5 Courses'!$E$7:$E${1},'5 Courses'!$A$7:$A${1},A{0},'5 Courses'!$F$7:$F${1},B{0})"
                               "+SUMIFS('5 Courses'!$E$7:$E${1},'5 Courses'!$A$7:$A${1},\"ALL\",'5 Courses'!$F$7:$F${1},B{0}))").format(r, LAST_ROW)
        ws['K{}'.format(r)] = ('=IF(A{0}="","",IF(D{0}="","Give the credits",IF(AND(F{0}="All courses listed",J{0}<D{0}),'
                               '"Courses in sheet 5 add up to only "&J{0},IF(AND(F{0}="Choose from a list",J{0}<D{0}),"The list is shorter than the credits required","OK"))))').format(r)
    dropdown(ws, 'A', '=Lists!$V$3:$V$62', strict=False)
    dropdown(ws, 'B', src('A', len(BLOCKS)), strict=False)
    dropdown(ws, 'E', src('K', 2))
    dropdown(ws, 'F', src('G', len(HOW)))
    dropdown(ws, 'H', src('F', len(CHECKED)))
    number_rule(ws, 'D', 0, 300)
    flag_rule(ws, 'K{}:K{}'.format(FIRST_ROW, end), 'AND($K{0}<>"",$K{0}<>"OK")'.format(FIRST_ROW))

    # ---- 5 Courses ------------------------------------------------------------
    ws = wb.create_sheet('5 Courses')
    title_block(ws, '5. Courses', 'Every course of every programme, one row each. A course common to the whole faculty can be entered once with Programme ID = ALL.')
    cols = [('Programme ID', 22, 'key'), ('Course code', 12, 'input'), ('Course title (English)', 38, 'input'), ('Course title (Arabic)', 28, 'input'),
            ('Credits', 8, 'input'), ('Block key', 18, 'input'), ('Plan semester', 9, 'input'), ('Usually offered', 15, 'input'),
            ('Prerequisites', 20, 'input'), ('Corequisites', 16, 'input'), ('Credits earned before registering', 12, 'input'),
            ('Lowest passing grade (if not D)', 11, 'input'), ('Counts in GPA', 9, 'input'), ('Course type', 13, 'input'),
            ('Status', 11, 'input'), ('Notes', 36, 'input'), ('Check', 30, 'calc')]
    rows = []
    for _d, p in programmes:
        plan = plans.get(p['id'])
        if not plan:
            continue
        for c in plan['courses']:
            if c.get('bucket') in ('FRESHMAN', 'OTHER'):
                continue
            rows.append([p['id'], c['code'], c.get('title'), None, c.get('cr'), c.get('bucket'), c.get('planSem'),
                         offered_label(c.get('runsIn')), ', '.join(c.get('pre') or []) or None, ', '.join(c.get('co') or []) or None,
                         c.get('minEarned'), None, None, None, 'To check', None])
    end = table(ws, cols, rows, ['example-programme', 'CMPS241', 'Introduction to Programming', 'مقدمة في البرمجة', 3, 'MAJOR_CORE', 1,
                                  'Fall and Spring', 'MATH241', 'CMPS241L', '', '', 'Yes', 'Lecture + lab', 'Checked', '', ''],
                notes={'Prerequisites': 'Course codes separated by commas: all of them are needed. For "one of", write OR between codes: MATH241 OR MATH243.',
                       'Credits earned before registering': 'For courses opened by credits, e.g. 90 for a senior project.',
                       'Plan semester': 'The semester the printed plan puts it in (1, 2, 3 ...). Leave blank for electives.',
                       'Counts in GPA': 'No for pass/fail courses such as some internships.'})
    for r in range(FIRST_ROW, end):
        ws['Q{}'.format(r)] = ("=IF(B{0}=\"\",\"\",IF(COUNTIFS($A$7:$A${1},A{0},$B$7:$B${1},B{0})>1,\"Listed twice\","
                               "IF(E{0}=\"\",\"Give the credits\",IF(IF(A{0}=\"ALL\",COUNTIF('4 Blocks'!$B$7:$B${1},F{0}),"
                               "COUNTIFS('4 Blocks'!$A$7:$A${1},A{0},'4 Blocks'!$B$7:$B${1},F{0}))=0,\"Block not in sheet 4\",\"OK\"))))").format(r, LAST_ROW)
    dropdown(ws, 'A', '=Lists!$V$2:$V$62', strict=False)
    dropdown(ws, 'F', src('A', len(BLOCKS)), strict=False)
    dropdown(ws, 'H', src('B', len(OFFERED)))
    dropdown(ws, 'L', src('T', 10))
    dropdown(ws, 'M', src('K', 2))
    dropdown(ws, 'N', src('H', len(KINDS)), strict=False)
    dropdown(ws, 'O', src('F', len(CHECKED)))
    number_rule(ws, 'E', 0, 12, whole=False)
    number_rule(ws, 'G', 1, 16)
    number_rule(ws, 'K', 0, 250)
    flag_rule(ws, 'Q{}:Q{}'.format(FIRST_ROW, end), 'AND($Q{0}<>"",$Q{0}<>"OK")'.format(FIRST_ROW))

    # ---- 6 Lists and tracks ----------------------------------------------------
    ws = wb.create_sheet('6 Lists and tracks')
    title_block(ws, '6. Elective lists, tracks, minors', 'One row per course in a list. Repeat the list name on each row. A track is earned by passing the given number of its courses.')
    cols = [('Programme ID', 22, 'key'), ('List key', 16, 'input'), ('List name', 34, 'input'), ('List type', 14, 'input'),
            ('Courses to pass from the list', 12, 'input'), ('Credits to pass from the list', 12, 'input'), ('Course code', 12, 'input'),
            ('Course title', 34, 'input'), ('Credits', 8, 'input'), ('Status', 11, 'input'), ('Notes', 34, 'input')]
    rows = []
    for _d, p in programmes:
        plan = plans.get(p['id'])
        if not plan:
            continue
        titles = {c['code']: c for c in plan['courses']}
        for key, t in (plan.get('tracks') or {}).items():
            for code in t.get('courses', []):
                c = titles.get(code, {})
                rows.append([p['id'], key, t.get('label'), 'Track', t.get('coursesRequired'), None, code, c.get('title'), c.get('cr'), 'To check', None])
    end = table(ws, cols, rows, ['example-programme', 'SEC', 'Cybersecurity track', 'Track', 3, '', 'CMPS325', 'Network Security', 3, 'Checked', ''])
    dropdown(ws, 'A', '=Lists!$V$3:$V$62', strict=False)
    dropdown(ws, 'D', src('I', len(LIST_TYPES)))
    dropdown(ws, 'J', src('F', len(CHECKED)))

    # ---- 7 Rules ----------------------------------------------------------------
    ws = wb.create_sheet('7 Rules')
    title_block(ws, '7. Rules', 'The university value is already filled. Write a value only where this faculty or programme is different, with where it is written.')
    cols = [('Applies to', 22, 'key'), ('Rule ID', 18, 'input'), ('Rule', 52, 'calc'), ('University value', 12, 'calc'), ('Unit', 10, 'calc'),
            ('Faculty value', 14, 'input'), ('Where it is written', 30, 'input'), ('Notes', 40, 'input'), ('Applied by the system', 22, 'calc')]
    rows = [['ALL', r[0]] for r in RULE_ROWS]
    end = table(ws, cols, rows, ['example-programme', 'GRAD_CGPA', '', '', '', 2.3, 'Faculty regulations art. 12', 'Higher for this programme only', ''],
                notes={'Applies to': 'ALL = every programme of the faculty. Put a programme ID to set a different value for one programme only.',
                       'Faculty value': 'Leave blank when the university value applies.'})
    n = len(RULE_ROWS) + 1
    for r in range(FIRST_ROW, end):
        for col, lcol in (('C', 'O'), ('D', 'P'), ('E', 'Q'), ('I', 'R')):
            ws['{}{}'.format(col, r)] = '=IF(B{0}="","",IFERROR(INDEX(Lists!${1}$2:${1}${2},MATCH(B{0},Lists!$N$2:$N${2},0)),"Unknown rule ID"))'.format(r, lcol, n)
            ws['{}{}'.format(col, r)].fill = fill_calc
            ws['{}{}'.format(col, r)].alignment = wrap
        ws['A{}'.format(r)].fill = fill_prefill if r < FIRST_ROW + len(rows) else fill_input
    dropdown(ws, 'A', '=Lists!$V$2:$V$62', strict=False)
    dropdown(ws, 'B', src('N', len(RULE_ROWS)))

    # ---- 8 People ---------------------------------------------------------------
    ws = wb.create_sheet('8 People')
    title_block(ws, '8. People and their access', 'Staff only, never students. Each person gets an invitation to set their own password; nobody shares passwords.')
    cols = [('Full name', 28, 'input'), ('Title', 8, 'input'), ('BAU email', 30, 'input'), ('Role', 16, 'input'), ('Scope', 26, 'input'),
            ('Also advises students in', 24, 'input'), ('Campus', 12, 'input'), ('Notes', 36, 'input'), ('Check', 26, 'calc')]
    end = table(ws, cols, [], ['Dr. A. Example', 'Dr.', 'a.example@bau.edu.lb', 'Advisor', 'example-programme', '', 'Beirut', '', ''],
                notes={'Role': 'Faculty admin: everything in the faculty. Programme editor: study plan and rules of the scope. Approver: signs exceptions. Advisor: advises students. Viewer: read only.',
                       'Scope': 'The faculty, a department or a programme ID from the lists.'})
    for r in range(FIRST_ROW, end):
        ws['I{}'.format(r)] = '=IF(A{0}="","",IF(ISERROR(SEARCH("@bau.edu.lb",C{0})),"Needs a @bau.edu.lb email",IF(OR(D{0}="",E{0}=""),"Give a role and a scope","OK")))'.format(r)
    dropdown(ws, 'B', '"Dr.,Prof.,Mr.,Ms.,Eng."', strict=False)
    dropdown(ws, 'D', src('J', len(ROLES)))
    dropdown(ws, 'E', '=Lists!$W$2:$W$92', strict=False)
    dropdown(ws, 'F', '=Lists!$V$3:$V$62', strict=False)
    dropdown(ws, 'G', src('D', len(CAMPUSES)))
    flag_rule(ws, 'I{}:I{}'.format(FIRST_ROW, end), 'AND($I{0}<>"",$I{0}<>"OK")'.format(FIRST_ROW))

    # ---- 9 Approvals --------------------------------------------------------------
    ws = wb.create_sheet('9 Approvals')
    title_block(ws, '9. Who approves what', 'When a student needs an exception, who proposes it and who signs it. The system will route requests this way.')
    cols = [('Exception', 34, 'key'), ('Proposed by', 22, 'input'), ('Approved by', 22, 'input'), ('Dean also signs', 10, 'input'),
            ('Reason required', 10, 'input'), ('Limit or condition', 36, 'input'), ('Where it is written', 28, 'input')]
    rows = [[x] for x in ['Course substitution', 'Course waiver', 'Overload above the maximum', 'Load below the minimum',
                          'Prerequisite override', 'Taking a course outside the plan', 'Transfer credit equivalence',
                          'Change of programme or track', 'Graduation check (degree plan form)', 'Late withdrawal']]
    end = table(ws, cols, rows, ['Course substitution', 'Advisor', 'Chairperson', 'Yes', 'Yes', 'Same credits or more', 'Faculty council decision 2024/7'])
    for col in ('B', 'C'):
        dropdown(ws, col, '"Advisor,Chairperson,Programme editor,Approver,Faculty admin,Dean,Registrar,University"', strict=False)
    for col in ('D', 'E'):
        dropdown(ws, col, src('K', 2))

    # ---- 10 Questions -----------------------------------------------------------
    ws = wb.create_sheet('10 Questions')
    title_block(ws, '10. Questions and anything that did not fit', 'Write here instead of bending a sheet to fit. We read every row.')
    cols = [('Sheet', 16, 'input'), ('Row or course', 16, 'input'), ('Question or note', 70, 'input'), ('Asked by', 20, 'input'), ('Answer', 50, 'input')]
    table(ws, cols, [], ['5 Courses', 'ACCT301', 'This course changed title in 2024; which title should advisors see?', 'Chairperson', ''])

    # ---- 11 Sign-off --------------------------------------------------------------
    ws = wb.create_sheet('11 Sign-off')
    title_block(ws, '11. Sign-off', 'Nothing goes live until this sheet is complete. The system keeps these names with the import.', legend=False)
    for i, h in enumerate(['Step', 'Name', 'Email', 'Date', 'Comment'], start=1):
        c = ws.cell(row=HEADER_ROW, column=i, value=h)
        c.font, c.fill, c.border = f_head, fill_head, box
    for i, w in enumerate([36, 28, 30, 14, 40], start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for r, step in enumerate(['Filled in by (coordinator)', 'Checked by chairperson(s)', 'Approved by the dean', 'Received by the system administrator'], start=HEADER_ROW + 1):
        ws.cell(row=r, column=1, value=step).font = f_bold
        for col in range(1, 6):
            c = ws.cell(row=r, column=col)
            c.border = box
            if col > 1:
                c.fill = fill_input
        ws.cell(row=r, column=4).number_format = 'yyyy-mm-dd'

    # ---- Start here (written last so the counts can point at every sheet) -----------
    ws = start
    title_block(ws, 'Advising system set-up: ' + faculty['name'], 'What the system needs to know to advise every student of this faculty correctly.', legend=False)
    ws.column_dimensions['A'].width = 6
    ws.column_dimensions['B'].width = 40
    ws.column_dimensions['C'].width = 90
    steps = [
        ('1 Faculty', 'Faculty name, coordinator, load group and study system.'),
        ('2 Departments', 'Check the departments. Replace any "to confirm" placeholder.'),
        ('3 Programmes', 'Every degree, with total credits and length. The Check column must say OK.'),
        ('4 Blocks', 'How each degree is divided, exactly as the study plan prints it.'),
        ('5 Courses', 'Every course with credits, block, plan semester and prerequisites. Mark each row Checked.'),
        ('6 Lists and tracks', 'Elective lists, tracks, minors, modules.'),
        ('7 Rules', 'Only where the faculty differs from the university rule. Say where it is written.'),
        ('8 People', 'Staff who need access and what they may do. Staff only.'),
        ('9 Approvals', 'Who proposes and who approves each kind of exception.'),
        ('10 Questions', 'Anything unclear or that did not fit.'),
        ('11 Sign-off', 'Coordinator, chairpersons and dean.'),
    ]
    for i, h in enumerate(['#', 'Sheet', 'What to do'], start=1):
        c = ws.cell(row=HEADER_ROW, column=i, value=h)
        c.font, c.fill, c.border = f_head, fill_head, box
    for r, (sheet, what) in enumerate(steps, start=HEADER_ROW + 1):
        ws.cell(row=r, column=1, value=r - HEADER_ROW).font = f_body
        c = ws.cell(row=r, column=2, value=sheet)
        c.hyperlink = "#'{}'!A1".format(sheet)
        c.font = f_link
        ws.cell(row=r, column=3, value=what).font = f_body
        for col in range(1, 4):
            ws.cell(row=r, column=col).border = box
    r = HEADER_ROW + len(steps) + 2
    ws.cell(row=r, column=2, value='Progress (updates as you type)').font = f_bold
    progress = [
        ('Programmes', "=COUNTA('3 Programmes'!C7:C{})".format(LAST_ROW)),
        ('Programmes whose check is not OK', "=COUNTIFS('3 Programmes'!U7:U{0},\"<>OK\",'3 Programmes'!U7:U{0},\"?*\")".format(LAST_ROW)),
        ('Courses entered', "=COUNTA('5 Courses'!B7:B{})".format(LAST_ROW)),
        ('Courses still marked "To check"', "=COUNTIF('5 Courses'!O7:O{},\"To check\")".format(LAST_ROW)),
        ('Course rows with a problem', "=COUNTIFS('5 Courses'!Q7:Q{0},\"<>OK\",'5 Courses'!Q7:Q{0},\"?*\")".format(LAST_ROW)),
        ('Block rows with a problem', "=COUNTIFS('4 Blocks'!K7:K{0},\"<>OK\",'4 Blocks'!K7:K{0},\"?*\")".format(LAST_ROW)),
        ('Rules where the faculty differs', "=COUNTA('7 Rules'!F7:F{})".format(LAST_ROW)),
        ('People listed', "=COUNTA('8 People'!A7:A{})".format(LAST_ROW)),
        ('Open questions', "=COUNTA('10 Questions'!C7:C{})-COUNTA('10 Questions'!E7:E{})".format(LAST_ROW, LAST_ROW)),
        ('Sign-off complete', "=IF(COUNTA('11 Sign-off'!B6:B8)=3,\"Yes\",\"Not yet\")"),
    ]
    for i, (label, formula) in enumerate(progress, start=r + 1):
        ws.cell(row=i, column=2, value=label).font = f_body
        c = ws.cell(row=i, column=3, value=formula)
        c.font, c.fill, c.alignment = f_bold, fill_calc, Alignment(horizontal='left')
        ws.cell(row=i, column=2).border = box
        c.border = box
    r = r + len(progress) + 2
    rules = [
        'Fill only the yellow cells, and check the blue ones: they were copied from the 2020-2021 catalogue and some will be out of date.',
        'Do not rename sheets or column headings, and do not insert columns. The system reads this file back by those names.',
        'One fact, one place. A course common to the whole faculty goes once in sheet 5 with Programme ID = ALL.',
        'Leave a cell blank rather than guessing. Put the doubt in sheet 10.',
        'No student information of any kind belongs in this workbook.',
        'Format: ' + FORMAT_VERSION + '. Return the file as .xlsx to the system administrator.',
    ]
    ws.cell(row=r, column=2, value='Ground rules').font = f_bold
    for i, text in enumerate(rules, start=r + 1):
        c = ws.cell(row=i, column=2, value=text)
        c.font = f_body
        ws.merge_cells(start_row=i, start_column=2, end_row=i, end_column=3)

    for sheet in wb.worksheets:
        sheet.sheet_properties.tabColor = {'Start here': NAVY, '11 Sign-off': '2E7D32', '10 Questions': '9E9E9E'}.get(sheet.title, '5B7DB1')
        sheet.page_setup.orientation = 'landscape'
        sheet.page_setup.fitToWidth = 1
        sheet.page_setup.fitToHeight = 0
        sheet.sheet_properties.pageSetUpPr.fitToPage = True
    wb.move_sheet('Lists', offset=len(wb.sheetnames))
    wb.active = 0
    return wb


def main():
    os.makedirs(OUT, exist_ok=True)
    made = []
    for faculty in SEED['tree']['faculties']:
        wb = build(faculty)
        name = 'BAU set-up - {}.xlsx'.format(faculty['name'].replace(',', ''))
        wb.save(os.path.join(OUT, name))
        made.append(name)
    print('\n'.join(made))


if __name__ == '__main__':
    main()
