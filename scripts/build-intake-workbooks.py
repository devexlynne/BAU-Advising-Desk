"""
Makes one study-plan file per programme, each with a single sheet to fill.

Files are grouped in one folder per faculty, so each dean's office forwards
its folder to the chairpersons. Every file is pre-filled with what the system
already has (the 2020-2021 catalogue, the built-in Computer Science plan), so
the department corrects instead of typing from nothing. One extra file per
faculty, "New programme", is for a degree the system does not have yet.

The section titles and column names are what src/intake.js reads back, so do
not rename them.

    python scripts/build-intake-workbooks.py [output folder]
"""
import json
import os
import sys

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'intake')

SPEC = json.load(open(os.path.join(ROOT, 'data', 'intake-rules.json'), encoding='utf8'))
SEED = json.load(open(os.path.join(ROOT, 'data', 'catalogue-2020.json'), encoding='utf8'))
CS = json.load(open(os.path.join(ROOT, 'data', 'catalog.json'), encoding='utf8'))
RULES = json.load(open(os.path.join(ROOT, 'data', 'rules.json'), encoding='utf8'))
FORMAT = SPEC['format']
BLOCK_LABEL = {b['key']: b['label'] for b in SPEC['blocks']}
OFFERED = ['Fall', 'Spring', 'Summer', 'Fall and Spring', 'Every semester']
CAMPUSES = ['Beirut', 'Debbieh', 'Tripoli', 'Bekaa']
ROLES = ['Advisor', 'Programme editor']

# the five section titles, in the order they appear (read back by src/intake.js)
S_PROGRAMME, S_BLOCKS, S_RULES, S_PEOPLE, S_COURSES = (
    '1. Programme', '2. Requirement blocks', '3. Rules that are different for this programme',
    '4. People who advise or edit this programme', '5. Courses')


def university_value(rule):
    if rule.get('key', '').startswith('R.'):
        node = RULES
        for k in rule['key'][2:].split('.'):
            node = node.get(k) if isinstance(node, dict) else None
        if node is not None:
            return node
    return {'MIN_GRADE_MAJOR': 'D', 'REMEDIAL_AFTER': 2}.get(rule['id'], 'None')


FONT = 'Arial'
NAVY = '1F3A5F'
f_title = Font(name=FONT, size=15, bold=True, color=NAVY)
f_section = Font(name=FONT, size=12, bold=True, color=NAVY)
f_sub = Font(name=FONT, size=10, color='555555')
f_head = Font(name=FONT, size=10, bold=True, color='FFFFFF')
f_body = Font(name=FONT, size=10)
f_bold = Font(name=FONT, size=10, bold=True)
f_example = Font(name=FONT, size=10, italic=True, color='808080')
fill_head = PatternFill('solid', fgColor=NAVY)
fill_input = PatternFill('solid', fgColor='FFF7D6')     # fill in
fill_prefill = PatternFill('solid', fgColor='E8EEF7')   # already filled, please check
fill_calc = PatternFill('solid', fgColor='E6F4EA')      # worked out for you
fill_example = PatternFill('solid', fgColor='F2F2F2')
thin = Side(style='thin', color='C9D1DB')
box = Border(left=thin, right=thin, top=thin, bottom=thin)
WIDTHS = [13, 38, 9, 24, 14, 22, 16, 16, 34, 26]


def offered_label(runs):
    runs = {r.upper() for r in (runs or [])}
    if runs >= {'FALL', 'SPRING', 'SUMMER'}:
        return 'Every semester'
    if runs == {'FALL'}:
        return 'Fall'
    if runs == {'SPRING'}:
        return 'Spring'
    if runs == {'SUMMER'}:
        return 'Summer'
    return 'Fall and Spring'


def cell(ws, r, c, value=None, font=f_body, fill=None, wrap=False):
    x = ws.cell(row=r, column=c, value=value)
    x.font = font
    x.border = box
    if fill:
        x.fill = fill
    x.alignment = Alignment(vertical='top', wrap_text=wrap)
    return x


def heads(ws, r, names):
    for i, name in enumerate(names, start=1):
        x = ws.cell(row=r, column=i, value=name)
        x.font, x.fill, x.border = f_head, fill_head, box
        x.alignment = Alignment(wrap_text=True, vertical='center')
    ws.row_dimensions[r].height = 28


def section(ws, r, title, hint):
    ws.cell(row=r, column=1, value=title).font = f_section
    ws.cell(row=r, column=3, value=hint).font = f_sub


def listv(ws, rng, source, strict=True):
    dv = DataValidation(type='list', formula1=source, allow_blank=True, showErrorMessage=True,
                        errorStyle='stop' if strict else 'warning')
    if not strict:
        dv.errorTitle = 'Not in the list'
        dv.error = 'This is not one of the usual values. Keep it only if you are sure.'
    ws.add_data_validation(dv)
    dv.add(rng)


def numv(ws, rng, low, high, whole=True):
    dv = DataValidation(type='whole' if whole else 'decimal', operator='between', formula1=str(low),
                        formula2=str(high), allow_blank=True, showErrorMessage=True)
    dv.error = 'Enter a number from {} to {}.'.format(low, high)
    ws.add_data_validation(dv)
    dv.add(rng)


def red_unless_ok(ws, rng, first):
    ws.conditional_formatting.add(rng, FormulaRule(formula=['AND({0}<>"",{0}<>"OK")'.format(first)],
                                                   fill=PatternFill('solid', fgColor='F8D7DA'), font=Font(name=FONT, color='9C0006')))


def build(faculty, dept, prog, plan):
    wb = Workbook()
    ws = wb.active
    ws.title = 'Study plan'
    ws.sheet_view.showGridLines = False
    for i, w in enumerate(WIDTHS, start=1):
        ws.column_dimensions[chr(64 + i)].width = w

    # hidden lists for the dropdowns, plus what the system needs to know about this file
    ls = wb.create_sheet('Lists')
    for i, b in enumerate(SPEC['blocks'], start=2):
        ls['A{}'.format(i)] = b['label']
    for i, v in enumerate(OFFERED, start=2):
        ls['B{}'.format(i)] = v
    for i, rule in enumerate(SPEC['rules'], start=2):
        ls['C{}'.format(i)] = rule['text']
        ls['D{}'.format(i)] = university_value(rule)
    depts = [d['name'] for d in faculty['departments']]
    for i, name in enumerate(depts, start=2):
        ls['E{}'.format(i)] = name
    for i, v in enumerate(CAMPUSES, start=2):
        ls['F{}'.format(i)] = v
    for i, v in enumerate(ROLES, start=2):
        ls['G{}'.format(i)] = v
    ls['Y1'] = 'format'
    ls['Y2'] = FORMAT
    ls['Z1'] = 'faculty'
    ls['Z2'] = faculty['id']
    ls['Z3'] = prog['id'] if prog else ''
    ls.sheet_state = 'hidden'
    nb, nr, nd = len(SPEC['blocks']) + 1, len(SPEC['rules']) + 1, len(depts) + 1

    name = prog['name'] if prog else 'New programme'
    ws['A1'] = 'Study plan: ' + name
    ws['A1'].font = f_title
    ws['A2'] = faculty['name'] + ('  ·  ' + dept['name'] if dept else '')
    ws['A2'].font = f_sub
    ws['A3'] = 'Fill the yellow cells. Blue cells were copied from the 2020-2021 catalogue: check them and correct anything out of date. Green cells check themselves.'
    ws['A3'].font = Font(name=FONT, size=9, italic=True, color='666666')

    # ---- 1. Programme ------------------------------------------------------------
    r = 5
    section(ws, r, S_PROGRAMME, 'The degree itself.')
    plan = plan or {}
    fields = [
        ('Faculty', faculty['name'], 'calc'),
        ('Department', dept['name'] if dept else None, 'dept'),
        ('Programme name (English)', prog['name'] if prog else None, 'text'),
        ('Programme name (Arabic)', prog.get('nameAr') if prog else None, 'text'),
        ('Campuses', ', '.join(prog.get('campuses', [])) if prog else None, 'text'),
        ('Catalogue year', 2026, 'year'),
        ('Total credits to graduate', plan.get('totalCredits'), 'credits'),
        ('Standard length (semesters)', plan.get('standardSemesters'), 'sem'),
        ('Maximum length (semesters)', plan.get('maxSemesters'), 'sem'),
        ('Filled in by (name and email)', None, 'text'),
        ('Checked by the chairperson (name)', None, 'text'),
        ('Everything on this sheet is correct', 'No', 'yesno'),
    ]
    rows = {}
    for i, (label, value, kind) in enumerate(fields, start=r + 1):
        cell(ws, i, 1, label, f_bold)
        ws.merge_cells(start_row=i, start_column=1, end_row=i, end_column=2)
        x = cell(ws, i, 3, value, fill=fill_calc if kind == 'calc' else fill_prefill if value not in (None, '', 'No') else fill_input)
        ws.merge_cells(start_row=i, start_column=3, end_row=i, end_column=6)
        rows[label] = i
        if kind == 'dept':
            listv(ws, 'C{}'.format(i), '=Lists!$E$2:$E${}'.format(nd), strict=False)
        elif kind == 'yesno':
            listv(ws, 'C{}'.format(i), '"Yes,No"')
        elif kind == 'credits':
            numv(ws, 'C{}'.format(i), 1, 300)
        elif kind == 'sem':
            numv(ws, 'C{}'.format(i), 1, 30)
        elif kind == 'year':
            numv(ws, 'C{}'.format(i), 2000, 2100)
    ws.cell(row=rows['Campuses'], column=7, value='Any of: Beirut, Debbieh, Tripoli, Bekaa').font = f_sub
    ws.cell(row=rows['Maximum length (semesters)'], column=7, value='At most double the standard length (R&R VIII.1).').font = f_sub
    ws.cell(row=rows['Everything on this sheet is correct'], column=7, value='Change to Yes only when the chairperson has checked it.').font = f_sub
    total_cell = 'C{}'.format(rows['Total credits to graduate'])

    # ---- 2. Blocks ---------------------------------------------------------------------
    r = r + len(fields) + 2
    section(ws, r, S_BLOCKS, 'How the degree is divided, as the study plan prints it.')
    heads(ws, r + 1, ['Block', '', 'Credits required', 'Name as printed (optional)', '', 'Credits of the courses below', 'Check'])
    ws.merge_cells(start_row=r + 1, start_column=1, end_row=r + 1, end_column=2)
    ws.merge_cells(start_row=r + 1, start_column=4, end_row=r + 1, end_column=5)
    blocks = []
    for key, b in (plan.get('buckets') or {}).items():
        if key in ('FRESHMAN', 'OTHER') or (b.get('credits', 0) == 0 and key not in {c.get('bucket') for c in plan.get('courses', [])}):
            continue
        blocks.append((BLOCK_LABEL.get(key, b['label']), b.get('credits', 0), b['label']))
    used = {c.get('bucket') for c in plan.get('courses', [])}
    for key in ('REMEDIAL', 'INTENSIVE', 'NON_CREDIT'):
        if key in used and not (plan.get('buckets') or {}).get(key):
            blocks.append((BLOCK_LABEL[key], 0, None))
    if not blocks:
        blocks = [(BLOCK_LABEL[k], None, None) for k in ('UNIV_MANDATORY', 'UNIV_ELECTIVE', 'FACULTY_CORE', 'MAJOR_CORE', 'DEPT_ELECTIVE')]
    first_block = r + 2
    block_rows = list(range(first_block, first_block + len(blocks) + 3))
    last_block = block_rows[-1]

    # rules and people sizes decide where the courses start
    rules_start = last_block + 3
    rules_rows = list(range(rules_start + 2, rules_start + 2 + 6))
    people_start = rules_rows[-1] + 2
    people_rows = list(range(people_start + 2, people_start + 2 + 8))
    courses_start = people_rows[-1] + 2
    courses_first = courses_start + 3            # header, example, then data
    courses_last = courses_first + 400

    for i, row in enumerate(block_rows):
        label, credits, printed = blocks[i] if i < len(blocks) else (None, None, None)
        cell(ws, row, 1, label, fill=fill_prefill if label else fill_input)
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=2)
        cell(ws, row, 3, credits, fill=fill_prefill if credits is not None else fill_input)
        cell(ws, row, 4, printed if printed and printed.lower() != str(label).lower() else None, fill=fill_input)
        ws.merge_cells(start_row=row, start_column=4, end_row=row, end_column=5)
        cell(ws, row, 6, '=IF(A{0}="","",SUMIFS($C${1}:$C${2},$D${1}:$D${2},A{0}))'.format(row, courses_first, courses_last), fill=fill_calc)
        cell(ws, row, 7, ('=IF(A{0}="","",IF(C{0}="","Give the credits",IF(AND(F{0}<C{0},OR(A{0}="{1}",A{0}="{2}",A{0}="{3}")),'
                          '"Courses add up to only "&F{0},"OK")))').format(row, BLOCK_LABEL['FACULTY_CORE'], BLOCK_LABEL['MAJOR_CORE'], BLOCK_LABEL['UNIV_MANDATORY']), fill=fill_calc)
    listv(ws, 'A{}:A{}'.format(block_rows[0], last_block), '=Lists!$A$2:$A${}'.format(nb), strict=False)
    numv(ws, 'C{}:C{}'.format(block_rows[0], last_block), 0, 300)
    red_unless_ok(ws, 'G{}:G{}'.format(block_rows[0], last_block), 'G{}'.format(block_rows[0]))
    tr = last_block + 1
    cell(ws, tr, 1, 'Total', f_bold)
    ws.merge_cells(start_row=tr, start_column=1, end_row=tr, end_column=2)
    counted = '+'.join('SUMIFS(C{0}:C{1},A{0}:A{1},"{2}")'.format(block_rows[0], last_block, BLOCK_LABEL[k]) for k in ('REMEDIAL', 'INTENSIVE', 'NON_CREDIT'))
    cell(ws, tr, 3, '=SUM(C{0}:C{1})-({2})'.format(block_rows[0], last_block, counted), f_bold, fill_calc)
    cell(ws, tr, 7, '=IF({0}="","Give the total credits in section 1",IF(C{1}={0},"OK","Blocks add up to "&C{1}&", the degree needs "&{0}))'.format(total_cell, tr), f_bold, fill_calc)
    red_unless_ok(ws, 'G{}'.format(tr), 'G{}'.format(tr))

    # ---- 3. Rules that differ ---------------------------------------------------------
    section(ws, rules_start, S_RULES, 'Leave empty if the university rules apply. Otherwise pick the rule and say where it is written.')
    heads(ws, rules_start + 1, ['Rule', '', '', 'University rule', 'This programme', 'Where it is written', '', '', 'Notes'])
    ws.merge_cells(start_row=rules_start + 1, start_column=1, end_row=rules_start + 1, end_column=3)
    ws.merge_cells(start_row=rules_start + 1, start_column=6, end_row=rules_start + 1, end_column=8)
    for row in rules_rows:
        cell(ws, row, 1, None, fill=fill_input)
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=3)
        cell(ws, row, 4, '=IF(A{0}="","",IFERROR(INDEX(Lists!$D$2:$D${1},MATCH(A{0},Lists!$C$2:$C${1},0)),""))'.format(row, nr), fill=fill_calc)
        cell(ws, row, 5, None, fill=fill_input)
        cell(ws, row, 6, None, fill=fill_input)
        ws.merge_cells(start_row=row, start_column=6, end_row=row, end_column=8)
        cell(ws, row, 9, None, fill=fill_input)
    listv(ws, 'A{}:A{}'.format(rules_rows[0], rules_rows[-1]), '=Lists!$C$2:$C${}'.format(nr))

    # ---- 4. People ------------------------------------------------------------------
    section(ws, people_start, S_PEOPLE, 'Staff only. Each person gets an email to set their own password.')
    heads(ws, people_start + 1, ['Title', 'Full name', '', 'BAU email', '', 'Role', 'Check'])
    ws.merge_cells(start_row=people_start + 1, start_column=2, end_row=people_start + 1, end_column=3)
    ws.merge_cells(start_row=people_start + 1, start_column=4, end_row=people_start + 1, end_column=5)
    for row in people_rows:
        cell(ws, row, 1, None, fill=fill_input)
        cell(ws, row, 2, None, fill=fill_input)
        ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=3)
        cell(ws, row, 4, None, fill=fill_input)
        ws.merge_cells(start_row=row, start_column=4, end_row=row, end_column=5)
        cell(ws, row, 6, None, fill=fill_input)
        cell(ws, row, 7, '=IF(B{0}="","",IF(ISERROR(SEARCH("@bau.edu.lb",D{0})),"Needs a @bau.edu.lb email",IF(F{0}="","Pick a role","OK")))'.format(row), fill=fill_calc)
    listv(ws, 'A{}:A{}'.format(people_rows[0], people_rows[-1]), '"Dr.,Prof.,Mr.,Ms.,Eng."', strict=False)
    listv(ws, 'F{}:F{}'.format(people_rows[0], people_rows[-1]), '=Lists!$G$2:$G$3')
    red_unless_ok(ws, 'G{}:G{}'.format(people_rows[0], people_rows[-1]), 'G{}'.format(people_rows[0]))

    # ---- 5. Courses (last, so it can grow) ---------------------------------------------------
    section(ws, courses_start, S_COURSES, 'Every course of the degree, one per row. Add rows at the bottom as needed.')
    heads(ws, courses_start + 1, ['Code', 'Title', 'Credits', 'Block', 'Semester in plan', 'Prerequisites', 'Corequisites', 'Offered in', 'Notes', 'Check'])
    ws.cell(row=courses_start + 1, column=6).comment = Comment('Codes separated by commas: all are needed. For "one of", write OR: MATH241 OR MATH243.', 'Advising system')
    ws.cell(row=courses_start + 1, column=9).comment = Comment('Anything special: needs 90 credits first, pass/fail, lowest grade C, clinical, ...', 'Advising system')
    example = ['CMPS241', 'Introduction to Programming', 3, BLOCK_LABEL['MAJOR_CORE'], 1, 'MATH241', 'CMPS241L', 'Fall and Spring', 'Example row, leave it', '']
    for i, v in enumerate(example, start=1):
        cell(ws, courses_start + 2, i, v, f_example, fill_example)
    courses = [c for c in plan.get('courses', []) if c.get('bucket') not in ('FRESHMAN', 'OTHER')]
    for n, c in enumerate(courses):
        row = courses_first + n
        values = [c['code'], c.get('title'), c.get('cr'), BLOCK_LABEL.get(c.get('bucket'), c.get('bucket')), c.get('planSem'),
                  ', '.join(c.get('pre') or []) or None, ', '.join(c.get('co') or []) or None, offered_label(c.get('runsIn')), None]
        for i, v in enumerate(values, start=1):
            cell(ws, row, i, v, fill=fill_prefill if v not in (None, '') else fill_input, wrap=(i == 2))
    for row in range(courses_first + len(courses), courses_first + len(courses) + 60):
        for i in range(1, 10):
            cell(ws, row, i, None, fill=fill_input)
    for row in range(courses_first, courses_first + len(courses) + 60):
        cell(ws, row, 10, ('=IF(A{0}="","",IF(COUNTIF($A${1}:$A${2},A{0})>1,"Listed twice",IF(C{0}="","Give the credits",'
                           'IF(COUNTIF($A${3}:$A${4},D{0})=0,"Block not in section 2","OK"))))').format(row, courses_first, courses_last, block_rows[0], last_block), fill=fill_calc)
    listv(ws, 'D{}:D{}'.format(courses_first, courses_last), '=Lists!$A$2:$A${}'.format(nb), strict=False)
    listv(ws, 'H{}:H{}'.format(courses_first, courses_last), '=Lists!$B$2:$B$6')
    numv(ws, 'C{}:C{}'.format(courses_first, courses_last), 0, 12, whole=False)
    numv(ws, 'E{}:E{}'.format(courses_first, courses_last), 1, 16)
    red_unless_ok(ws, 'J{}:J{}'.format(courses_first, courses_last), 'J{}'.format(courses_first))

    ws.freeze_panes = 'A5'
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.sheet_properties.tabColor = NAVY
    return wb


def safe(name):
    return ''.join(ch for ch in name if ch not in '\\/:*?"<>|,').strip()


def main():
    plans = dict(SEED['plans'])
    plans['cs'] = CS
    made = 0
    for faculty in SEED['tree']['faculties']:
        folder = os.path.join(OUT, safe(faculty['name']))
        os.makedirs(folder, exist_ok=True)
        for dept in faculty['departments']:
            for prog in dept['programmes']:
                build(faculty, dept, prog, plans.get(prog['id'])).save(os.path.join(folder, safe(prog['name']) + '.xlsx'))
                made += 1
        build(faculty, None, None, None).save(os.path.join(folder, 'New programme (blank).xlsx'))
        made += 1
    print(made, 'files in', OUT)


if __name__ == '__main__':
    main()
