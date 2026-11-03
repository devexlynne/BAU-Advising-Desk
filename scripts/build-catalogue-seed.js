'use strict';
/*
 * Builds data/catalogue-2020.json: BAU's faculties, departments and programmes,
 * and the study plans that could be read from the BAU 2020-2021 undergraduate
 * catalogue. A superadmin loads it from University structure; every plan comes
 * in marked "from the catalogue, to check" and can be edited in Programme setup.
 *
 * Sources (each plan records its own):
 *   https://www.bau.edu.lb/Undergraduate/Programs                    programmes, credits, campuses
 *   https://www.bau.edu.lb/BAUUpload/BAU-Library/files/Undergraduate/Catalogue-2020-2021/<Faculty>.pdf
 *
 * Rows are "CODE|Title|credits|BLOCK|semester|prerequisites". Prerequisites the
 * catalogue marks with * (remedial courses for some admission certificates only)
 * are left out; those are not programme prerequisites.
 *
 *   node scripts/build-catalogue-seed.js
 */
const fs = require('fs');
const path = require('path');
const Programme = require('../src/programme');

const CAT = 'https://www.bau.edu.lb/BAUUpload/BAU-Library/files/Undergraduate/Catalogue-2020-2021/';
const PROGRAMS_PAGE = 'https://www.bau.edu.lb/Undergraduate/Programs';
const B = 'Beirut', D = 'Debbieh', T = 'Tripoli', K = 'Bekaa';

// ---- structure ----------------------------------------------------------------
const p = (id, name, campuses) => ({ id, name, campuses });
const TREE = {
  id: 'bau', name: 'Beirut Arab University',
  faculties: [
    { id: 'science', name: 'Faculty of Science', departments: [
      { id: 'mathematics-and-computer-science', name: 'Mathematics and Computer Science', programmes: [
        p('cs', 'BSc Computer Science', [B, D, T, K]), p('bsc-mathematics', 'BSc Mathematics', [D, T])] },
      { id: 'physics', name: 'Physics', programmes: [p('bsc-physics', 'BSc Physics', [D, T])] },
      { id: 'chemistry', name: 'Chemistry', programmes: [p('bsc-chemistry', 'BSc Chemistry', [D, T])] },
      { id: 'biological-sciences', name: 'Biological Sciences', programmes: [
        p('bsc-biology', 'BSc Biology', [D, T]), p('bsc-biochemistry', 'BSc Biochemistry', [D, T])] }] },
    { id: 'business-administration', name: 'Faculty of Business Administration', departments: [
      { id: 'business-administration-dept', name: 'Business Administration', programmes: [
        p('bba-management', 'BBA Management', [B, D, T, K]), p('bba-banking-finance', 'BBA Banking and Finance', [B, T]),
        p('bba-marketing', 'BBA Marketing', [B, T, K]), p('bba-mis', 'BBA Management Information Systems', [B])] },
      { id: 'accounting', name: 'Accounting', programmes: [p('bba-accounting', 'BBA Accounting', [B, D, T])] },
      { id: 'economics', name: 'Economics', programmes: [p('bba-economics', 'BBA Economics', [B])] }] },
    { id: 'engineering', name: 'Faculty of Engineering', departments: [
      { id: 'civil-and-environmental-engineering', name: 'Civil and Environmental Engineering', programmes: [p('be-civil', 'BE Civil Engineering', [D, T])] },
      { id: 'electrical-and-computer-engineering', name: 'Electrical and Computer Engineering', programmes: [
        p('be-computer', 'BE Computer Engineering', [D, T, K]), p('be-communications-electronics', 'BE Communications and Electronics Engineering', [D, T]),
        p('be-electrical-power', 'BE Electrical Power and Machines Engineering', [D, T])] },
      { id: 'industrial-engineering-and-engineering-management', name: 'Industrial Engineering and Engineering Management', programmes: [p('be-industrial', 'BE Industrial Engineering', [D])] },
      { id: 'mechanical-engineering', name: 'Mechanical Engineering', programmes: [p('be-mechanical', 'BE Mechanical Engineering', [D, T])] },
      { id: 'chemical-and-petroleum-engineering', name: 'Chemical and Petroleum Engineering', programmes: [
        p('be-chemical', 'BE Chemical Engineering', [D]), p('be-petroleum', 'BE Petroleum Engineering', [D])] },
      { id: 'engineering-department-to-confirm', name: 'Department to confirm', programmes: [
        p('be-biomedical', 'BE Biomedical Engineering', [D]), p('be-renewable-energy', 'BE Renewable Energy Engineering', [D])] }] },
    { id: 'pharmacy', name: 'Faculty of Pharmacy', departments: [
      { id: 'pharmacy-faculty-wide', name: 'Faculty-wide programme', programmes: [p('bsc-pharmacy', 'BSc Pharmacy', [B, T])] }] },
    { id: 'medicine', name: 'Faculty of Medicine', departments: [
      { id: 'medicine-faculty-wide', name: 'Faculty-wide programme', programmes: [p('mbbch', 'Bachelor of Medicine and Surgery (MBBCh)', [B])] }] },
    { id: 'dentistry', name: 'Faculty of Dentistry', departments: [
      { id: 'dentistry-faculty-wide', name: 'Faculty-wide programme', programmes: [p('bds', 'Bachelor of Oral and Dental Surgery (BDS)', [B])] }] },
    { id: 'law-and-political-science', name: 'Faculty of Law and Political Science', departments: [
      { id: 'law-faculty-wide', name: 'Faculty-wide programme', programmes: [p('law', 'Bachelor of Law', [B])] }] },
    { id: 'health-sciences', name: 'Faculty of Health Sciences', departments: [
      { id: 'health-sciences-department-to-confirm', name: 'Department to confirm', programmes: [
        p('bsc-nursing', 'BSc Nursing', [B, T]), p('bsc-medical-laboratory', 'BSc Medical Laboratory Technology', [B, T]),
        p('bsc-nutrition', 'BSc Nutrition and Dietetics', [B, T]), p('bsc-physical-therapy', 'BSc Physical Therapy', [B])] }] },
    { id: 'human-sciences', name: 'Faculty of Human Sciences', departments: [
      { id: 'human-sciences-department-to-confirm', name: 'Department to confirm', programmes: [
        p('ba-arabic', 'BA Arabic Language and Literature', [B]), p('ba-french', 'BA French Language and Literature', [B]),
        p('ba-psychology', 'BA Psychology', [B]), p('ba-history', 'BA History', [B]), p('ba-sociology', 'BA Sociology', [B]),
        p('ba-mass-communication', 'BA Mass Communication', [B]), p('educ-early-childhood', 'Education: Early Childhood', [B]),
        p('educ-arabic', 'Education: Arabic Language', [B]), p('educ-english', 'Education: English Language', [B]),
        p('educ-sciences-mathematics', 'Education: Sciences and Mathematics', [B]), p('educ-social-sciences', 'Education: Social Sciences', [B])] }] },
    { id: 'architecture-design-built-environment', name: 'Faculty of Architecture, Design and Built Environment', departments: [
      { id: 'architecture-faculty-wide', name: 'Programme units (no departments printed)', programmes: [
        p('barch', 'Bachelor of Architecture', [D, T]), p('graphic-design', 'Bachelor of Graphic Design', [D, T]),
        p('interior-design', 'Bachelor of Interior Design', [D, T]), p('fashion-design', 'Bachelor of Fashion Design', [D])] }] }
  ]
};

// ---- study plans --------------------------------------------------------------
const rows = text => text.trim().split('\n').map(l => l.trim()).filter(Boolean).map(l => {
  const [code, title, cr, bucket, sem, pre] = l.split('|');
  const c = { code, title, cr: Number(cr), bucket, pre: (pre || '').split(/[ ,;&+]+/).filter(Boolean), co: [] };
  if (sem) c.planSem = Number(sem);
  return c;
});
const blocks = list => {
  const out = {};
  list.forEach(([k, label, credits]) => { out[k] = { label, credits }; });
  return out;
};
function plan(meta, courseRows) {
  const base = Programme.blankCatalog({ program: meta.program, faculty: meta.faculty, department: meta.department });
  const cat = Object.assign(base, {
    catalogYear: 2020, totalCredits: meta.totalCredits, standardSemesters: meta.semesters, maxSemesters: meta.maxSemesters || meta.semesters * 2,
    courses: courseRows, setupStatus: 'draft', needsReview: true,
    source: { catalogue: 'BAU undergraduate catalogue 2020-2021', url: meta.url, note: meta.note || '' }
  });
  Object.entries(meta.blocks).forEach(([k, v]) => { cat.buckets[k] = v; });
  return Programme.normalize(cat);
}

// Business: the 48-credit common requirements and university courses are shared by every BBA major
const BBA_COMMON = `
BACC201|Principles of Accounting I|3|FACULTY_CORE|1|
BECO201|Micro Economics|3|FACULTY_CORE|1|
BUSN201|Business Law|2|FACULTY_CORE|1|
BUSN203|Business Communications|2|FACULTY_CORE|1|
BMTH201|Business Math|3|FACULTY_CORE|1|
ARAB001|Arabic Language|2|UNIV_MANDATORY|1|
BACC202|Principles of Accounting II|3|FACULTY_CORE|2|BACC201
BECO202|Macro Economics|3|FACULTY_CORE|2|BECO201
BMGT202|Principles of Management|3|FACULTY_CORE|2|
BUSN204|Business Ethics|2|FACULTY_CORE|2|
BMTH202|Business Statistics|3|FACULTY_CORE|2|
ENGL001|General English|2|UNIV_MANDATORY|2|
BLAW001|Human Rights|1|UNIV_MANDATORY|2|
BMGT301|Organizational Behavior|3|FACULTY_CORE|3|BMGT202
BMIS301|Management Information Systems I|3|FACULTY_CORE|3|BMGT202
BMKT301|Principles of Marketing|3|FACULTY_CORE|3|BMGT202
BMGT302|Operations Management|3|FACULTY_CORE|4|BMGT202
BMGT304|Strategic Management|3|FACULTY_CORE|4|BMGT202
BFSC302|Taxation Systems|3|FACULTY_CORE|4|
BFIN302|Financial Management|3|FACULTY_CORE|4|`;
const BBA_BLOCKS = {
  UNIV_MANDATORY: { label: 'University Mandatory Courses', credits: 5 },
  UNIV_ELECTIVE: { label: 'University Elective Courses', credits: 11 },
  FACULTY_CORE: { label: 'Common Requirement Courses', credits: 48 },
  MAJOR_CORE: { label: 'Major Core Courses', credits: 27 },
  DEPT_ELECTIVE: { label: 'Major Elective Courses', credits: 9 }
};
const bba = (id, major, dept, core, electives, note) => [id, plan({
  program: 'BBA ' + major, faculty: 'Faculty of Business Administration', department: dept,
  totalCredits: 100, semesters: 6, maxSemesters: 12, blocks: BBA_BLOCKS, url: CAT + 'Faculty-of-Business-Administration.pdf',
  note: 'University electives are chosen from the university list. MATH 112, MATH 113 and ECON 110 are asked of some admission certificates only and are not listed as prerequisites.' + (note ? ' ' + note : '')
}, rows(BBA_COMMON + '\n' + core + '\n' + electives))];

const PLANS = [
  bba('bba-accounting', 'Accounting', 'Accounting', `
BACC301|Intermediate Accounting I|3|MAJOR_CORE|3|BACC202
BACC302|Intermediate Accounting II|3|MAJOR_CORE|4|BACC301
BACC401|Corporation and Partnership Accounting|3|MAJOR_CORE|5|BACC302
BACC403|Cost Accounting|3|MAJOR_CORE|5|BACC202
BACC405|Accounting Information Systems|3|MAJOR_CORE|5|BACC301
BACC402|Auditing|3|MAJOR_CORE|6|BACC401
BACC404|Managerial Accounting|3|MAJOR_CORE|6|BACC202
BACC406|Tax Accounting|3|MAJOR_CORE|6|BACC401
BACC410|Senior Project and Internship|3|MAJOR_CORE|6|`, `
BMIS302|Management Information Systems II|3|DEPT_ELECTIVE||BMIS301
BMGT404|Entrepreneurship and Venture Management|3|DEPT_ELECTIVE||BMGT202
BECO406|Managerial Economics|3|DEPT_ELECTIVE||
BACC411|Governmental Accounting|3|DEPT_ELECTIVE||BACC302
BACC412|International Accounting|3|DEPT_ELECTIVE||BACC302
BACC413|Advanced Cost and Managerial Accounting|3|DEPT_ELECTIVE||BACC403
BACC414|Advanced Financial Accounting|3|DEPT_ELECTIVE||BACC401
BACC415|Cost Accounting for Restaurants and Hotels|3|DEPT_ELECTIVE||BACC202
BACC416|Hospitality Managerial Accounting|3|DEPT_ELECTIVE||BACC202
BUSN420|Corporate Social Responsibility|3|DEPT_ELECTIVE||BMGT202`, 'BUSN420 prerequisite printed as "3TBMGT202", read as BMGT202.'),
  bba('bba-management', 'Management', 'Business Administration', `
BMGT303|International Business|3|MAJOR_CORE|3|BMGT202
BMGT306|Human Resource Management|3|MAJOR_CORE|4|BMGT202 BMGT301
BMGT401|Leadership|3|MAJOR_CORE|5|BMGT202 BMGT301
BMKT401|Marketing Research|3|MAJOR_CORE|5|BMKT301
BUSN401|E-Business|3|MAJOR_CORE|5|BMGT202
BMGT402|Organizational Analysis and Design|3|MAJOR_CORE|6|BMGT202
BMGT404|Entrepreneurship and Venture Management|3|MAJOR_CORE|6|BMGT202
BACC404|Managerial Accounting|3|MAJOR_CORE|6|BACC202
BMGT410|Senior Project and Internship|3|MAJOR_CORE|6|`, `
BHOT301|Introduction to Hospitality Management|3|DEPT_ELECTIVE||BMGT202
BMIS302|Management Information Systems II|3|DEPT_ELECTIVE||BMIS301
BFIN314|Investments|3|DEPT_ELECTIVE||BFIN302
BACC403|Cost Accounting|3|DEPT_ELECTIVE||BACC202
BECO406|Managerial Economics|3|DEPT_ELECTIVE||
BMGT411|Human Resource Planning and Development|3|DEPT_ELECTIVE||BMGT306
BMGT412|Quantitative Techniques for Management|3|DEPT_ELECTIVE||BMGT302
BFIN412|Financial Institutions and Capital Markets|3|DEPT_ELECTIVE||BFIN302
BMGT413|Logistics and Supply Chain Management|3|DEPT_ELECTIVE||BMGT202
BUSN420|Corporate Social Responsibility|3|DEPT_ELECTIVE||BMGT202`, 'BUSN420 prerequisite printed as "BGMT202", read as BMGT202.'),
  bba('bba-banking-finance', 'Banking and Finance', 'Business Administration', `
BACC301|Intermediate Accounting I|3|MAJOR_CORE|3|BACC202
BACC302|Intermediate Accounting II|3|MAJOR_CORE|4|BACC301
BFIN401|Security Analysis|3|MAJOR_CORE|5|BFIN302
BFIN403|Portfolio Management|3|MAJOR_CORE|5|BFIN302
BFIN405|Principles of Insurance|3|MAJOR_CORE|5|BMTH201
BFIN402|Islamic Banking|3|MAJOR_CORE|6|BFIN302
BFIN404|Bank Management|3|MAJOR_CORE|6|BFIN302
BFIN406|Fundamentals of Risk Management|3|MAJOR_CORE|6|BFIN302
BFIN410|Senior Project and Internship|3|MAJOR_CORE|6|`, `
BMIS302|Management Information Systems II|3|DEPT_ELECTIVE||BMIS301
BECO402|Money and Banking|3|DEPT_ELECTIVE||BECO202
BECO405|Public Finance and Fiscal Policy|3|DEPT_ELECTIVE||BECO202
BFIN411|Real Estate Finance|3|DEPT_ELECTIVE||BECO202
BFIN412|Financial Institutions and Capital Markets|3|DEPT_ELECTIVE||BFIN302
BFIN413|Derivatives|3|DEPT_ELECTIVE||BECO202
BFIN414|International Finance|3|DEPT_ELECTIVE||BECO202
BFIN415|Credit and Risk Analysis|3|DEPT_ELECTIVE||BECO202
BECO417|Applied Econometrics|3|DEPT_ELECTIVE||BMTH202
BUSN420|Corporate Social Responsibility|3|DEPT_ELECTIVE||BMGT202`),
  bba('bba-marketing', 'Marketing', 'Business Administration', `
BUSN401|E-Business|3|MAJOR_CORE|3|BMGT202
BMKT302|Services Marketing|3|MAJOR_CORE|4|BMKT301
BMKT401|Marketing Research|3|MAJOR_CORE|5|BMKT301
BMKT403|International Marketing|3|MAJOR_CORE|5|BMKT301
BMKT405|Consumer Behavior|3|MAJOR_CORE|5|BMKT301
BMKT402|Strategic Marketing Management|3|MAJOR_CORE|6|BMKT301 BMGT304
BMKT404|Brand Management|3|MAJOR_CORE|6|BMKT301
BMKT406|Advertising Marketing Communications|3|MAJOR_CORE|6|BMKT301
BMKT410|Senior Project and Internship|3|MAJOR_CORE|6|`, `
BMIS302|Management Information Systems II|3|DEPT_ELECTIVE||BMIS301
BMGT306|Human Resource Management|3|DEPT_ELECTIVE||BMGT202 BMGT301
BACC403|Cost Accounting|3|DEPT_ELECTIVE||BACC202
BMGT404|Entrepreneurship and Venture Management|3|DEPT_ELECTIVE||BMGT202
BMKT411|Social Marketing|3|DEPT_ELECTIVE||BMKT301
BMKT412|Professional Selling|3|DEPT_ELECTIVE||BMKT301
BMKT413|Retail Management|3|DEPT_ELECTIVE||BMKT301
BMGT413|Logistics and Supply Chain Management|3|DEPT_ELECTIVE||BMGT202
BMKT414|Public Relations|3|DEPT_ELECTIVE||BMKT301
BUSN420|Corporate Social Responsibility|3|DEPT_ELECTIVE||BMGT202`)
];

// Science: faculty core is the same 19 credits for Mathematics, Physics and Chemistry
const SCI_CORE = `
CHEM241|Principles of Chemistry|3|FACULTY_CORE|1|
CHEM241L|Principles of Chemistry Laboratory|1|FACULTY_CORE|1|
PHYS243|General Physics|3|FACULTY_CORE|1|
PHYS243L|General Physics Laboratory|1|FACULTY_CORE|1|
MATH241|Calculus and Analytical Geometry|3|FACULTY_CORE|1|
CMPS241|Introduction to Programming|3|FACULTY_CORE|1|
MATH242|Probability and Statistics|3|FACULTY_CORE|2|
TSHS341|Teaching Science in High Schools|2|FACULTY_CORE|3|`;
const sciBlocks = (major, dept) => ({
  UNIV_MANDATORY: { label: 'University Mandatory Courses', credits: 5 },
  UNIV_ELECTIVE: { label: 'University Elective Courses', credits: 11 },
  FACULTY_CORE: { label: 'Faculty Core Courses', credits: 19 },
  MAJOR_CORE: { label: 'Major Core Courses', credits: major },
  DEPT_ELECTIVE: { label: 'Departmental Elective Courses', credits: dept },
  GEN_SCI_ELECTIVE: { label: 'Faculty Electives', credits: 6 }
});
const UNIV_SCI = `
ARAB001|Arabic Language|2|UNIV_MANDATORY|1|
ENGL001|English Language|2|UNIV_MANDATORY|2|
BLAW001|Human Rights|1|UNIV_MANDATORY|2|`;
const sci = (id, name, dept, major, deptEl, body, note) => [id, plan({
  program: 'BSc ' + name, faculty: 'Faculty of Science', department: dept, totalCredits: 97, semesters: 6, maxSemesters: 12,
  blocks: sciBlocks(major, deptEl), url: CAT + 'Faculty-of-Science.pdf', note
}, rows(SCI_CORE + '\n' + UNIV_SCI + '\n' + body))];
PLANS.push(
  sci('bsc-mathematics', 'Mathematics', 'Mathematics and Computer Science', 44, 12, `
MATH244|Ordinary Differential Equations|3|MAJOR_CORE|2|MATH241
MATH246|Real Analysis I|3|MAJOR_CORE|2|MATH241
MATH248|Multivariable Calculus|3|MAJOR_CORE|2|MATH241
MATH341|Linear Algebra|3|MAJOR_CORE|3|
MATH343|Special Functions|3|MAJOR_CORE|3|MATH244
MATH345|Discrete Mathematics|3|MAJOR_CORE|3|
MATH342|Vector Calculus|3|MAJOR_CORE|4|MATH241
MATH344|Real Analysis II|3|MAJOR_CORE|4|MATH246
MATH346|Abstract Algebra I|3|MAJOR_CORE|4|MATH345
MATH348|Numerical Methods|3|MAJOR_CORE|4|MATH241
MATH441|Introduction to Complex Analysis|3|MAJOR_CORE|5|MATH241
MATH443|Topology|3|MAJOR_CORE|5|MATH246
MATH442|Abstract Algebra II|3|MAJOR_CORE|6|MATH346
MATH446|Fourier Series and Applications|3|MAJOR_CORE|6|MATH246
MATH444|Senior Project|2|MAJOR_CORE|6|`, 'The fourth-semester courses are printed without their heading; placed in semester 4 because they add up to its 17 credits. Faculty core and major core are not labelled in the study plan; split so that they match the printed 19 and 44 credits.'),
  sci('bsc-physics', 'Physics', 'Physics', 47, 9, `
PHYS242|Thermal Physics|2|MAJOR_CORE|2|
PHYS242L|Thermal Physics Laboratory|1|MAJOR_CORE|2|
PHYS244|Physical Optics|2|MAJOR_CORE|2|
PHYS244L|Physical Optics Laboratory|1|MAJOR_CORE|2|
MATH244|Ordinary Differential Equations|3|MAJOR_CORE|2|MATH241
PHYS341|Classical Mechanics and Waves|3|MAJOR_CORE|3|
PHYS341L|Classical Mechanics and Waves Laboratory|1|MAJOR_CORE|3|
PHYS347|Modern Physics|2|MAJOR_CORE|3|
PHYS347L|Modern Physics Laboratory|1|MAJOR_CORE|3|
PHYS345|Mathematical Methods for Physics|3|MAJOR_CORE|3|MATH241
PHYS342|Quantum Mechanics I|3|MAJOR_CORE|4|PHYS347
PHYS346|Electromagnetic Theory|3|MAJOR_CORE|4|
PHYS346L|Electromagnetic Theory Laboratory|1|MAJOR_CORE|4|
PHYS441|Electrodynamics|3|MAJOR_CORE|5|PHYS346
PHYS443|Quantum Mechanics II|3|MAJOR_CORE|5|PHYS342
PHYS445|Relativity|3|MAJOR_CORE|5|PHYS346
PHYS442|Solid State Physics|3|MAJOR_CORE|6|PHYS342
PHYS442L|Solid State Physics Laboratory|1|MAJOR_CORE|6|
PHYS446|Statistical Physics|3|MAJOR_CORE|6|PHYS242
PHYS440|Electronics|2|MAJOR_CORE|6|
PHYS440L|Electronics Laboratory|1|MAJOR_CORE|6|
PHYS444|Senior Project|2|MAJOR_CORE|6|`, 'Semesters 4 and 6 are printed under one heading; split by their printed totals (17 and 15). Laboratories are co-requisites of their lectures.'),
  sci('bsc-chemistry', 'Chemistry', 'Chemistry', 44, 12, `
CHEM242|Analytical Chemistry|3|MAJOR_CORE|2|CHEM241
CHEM242L|Analytical Chemistry Laboratory|1|MAJOR_CORE|2|
CHEM248|Physical Chemistry I|3|MAJOR_CORE|2|CHEM241
CHEM244|Organic Chemistry I|3|MAJOR_CORE|2|
CHEM341|Organic Chemistry II|3|MAJOR_CORE|3|CHEM244
CHEM341L|Organic Chemistry Laboratory|1|MAJOR_CORE|3|
CHEM343|Chemical Kinetics|2|MAJOR_CORE|3|CHEM248
CHEM349|Physical Chemistry II|3|MAJOR_CORE|3|CHEM248
CHEM349L|Physical Chemistry Laboratory|1|MAJOR_CORE|3|
CHEM345|Inorganic Chemistry I|3|MAJOR_CORE|3|CHEM241
CHEM342|Instrumental Analysis|3|MAJOR_CORE|4|CHEM242
CHEM342L|Instrumental Analysis Laboratory|1|MAJOR_CORE|4|
CHEM346|Bioorganic Chemistry|3|MAJOR_CORE|4|CHEM341
CHEM348|Inorganic Chemistry II|3|MAJOR_CORE|4|CHEM345
CHEM348L|Inorganic Chemistry Laboratory|1|MAJOR_CORE|4|
CHEM441|Electrochemistry and Applications|3|MAJOR_CORE|5|
CHEM441L|Electrochemistry and Applications Laboratory|1|MAJOR_CORE|5|
CHEM442|Spectroscopic Identification of Chemical Compounds|3|MAJOR_CORE|6|CHEM341
CHEM442L|Spectroscopic Identification of Chemical Compounds Laboratory|1|MAJOR_CORE|6|
CHEM444|Senior Project|2|MAJOR_CORE|6|`, 'Semesters 2 to 4 are printed without headings; placed in order because they add up to the printed 16, 17 and 17 credits.')
);
// Co-requisites for the laboratories
PLANS.forEach(([, cat]) => cat.courses.forEach(c => {
  if (/L$/.test(c.code) && cat.courses.some(x => x.code === c.code.slice(0, -1))) c.co = [c.code.slice(0, -1)];
}));

// Human Sciences: Arabic Language and Literature
PLANS.push(['ba-arabic', plan({
  program: 'BA Arabic Language and Literature', faculty: 'Faculty of Human Sciences', department: 'Department to confirm',
  totalCredits: 99, semesters: 6, maxSemesters: 12, url: CAT + 'Faculty-of-Human-Sciences.pdf',
  blocks: {
    UNIV_MANDATORY: { label: 'University Mandatory Courses', credits: 5 },
    UNIV_ELECTIVE: { label: 'University Elective Courses', credits: 11 },
    MAJOR_CORE: { label: 'Major Core Courses', credits: 51 },
    DEPT_ELECTIVE: { label: 'Minor', credits: 20 },
    GEN_SCI_ELECTIVE: { label: 'Faculty Elective Courses', credits: 12 }
  },
  note: 'The study plan prints Arabic titles only. The minor (20 credits) and faculty electives (12 credits) are chosen from lists not printed in the plan.'
}, rows(`
ARAB251|النحو والصرف|2|MAJOR_CORE|1|
ARAB253|البلاغة والأسلوبية|2|MAJOR_CORE|1|
ARAB255|الاتجاهات الحديثة في تحليل الخطاب|2|MAJOR_CORE|1|
ARAB257|العروض وموسيقى الشعر|2|MAJOR_CORE|1|
ARAB259|قضايا الأدب الجاهلي|2|MAJOR_CORE|1|
ARAB261|الأدب أنواعه ومذاهبه|2|MAJOR_CORE|1|
ENGL001|English Language|2|UNIV_MANDATORY|1|
FREN111|French Language|2|UNIV_MANDATORY|1|
BLAW001|Human Rights|1|UNIV_MANDATORY|1|
ARAB250|النحو والتراكيب|3|MAJOR_CORE|2|
ARAB252|الأدب في عصر صدر الإسلام والعصر الأموي|3|MAJOR_CORE|2|
ARAB254|الحضارة العربية والأدب|3|MAJOR_CORE|2|
ARAB351|النحو والصرف في ألفية ابن مالك|3|MAJOR_CORE|3|
ARAB353|الأدب في العصر العباسي|3|MAJOR_CORE|3|
ARAB355|علم الأصوات|3|MAJOR_CORE|3|
ARAB350|التدريب اللغوي العملي|3|MAJOR_CORE|4|
ARAB352|الأدب العربي في الأندلس|3|MAJOR_CORE|4|
ARAB451|مناهج البحث في اللغة والأدب|3|MAJOR_CORE|5|
ARAB453|اللسانيات النظرية والتطبيقية|3|MAJOR_CORE|5|
ARAB455|طرائق تدريس اللغة العربية|3|MAJOR_CORE|5|
ARAB450|فن الكتابة والتعبير|3|MAJOR_CORE|6|
ARAB452|الأدب العربي الحديث|3|MAJOR_CORE|6|`))]);

// Medicine: modules; the clinical blocks run in either semester of their year
const MED_Y4 = 'USRP301 NESC303 MSYS302 MSYS304 REPG306', MED_Y5 = 'PEDT403 INTM404 OBGY401 SURG402', MED_Y6 = 'FAMI501 INTM504 NEPS502 SURG503', MED_Y2 = 'FABL201 LOCO202 COHD203 HEMA204', MED_Y3 = 'CARD205 GITN206 RENR208 RESP207';
PLANS.push(['mbbch', plan({
  program: 'Bachelor of Medicine and Surgery (MBBCh)', faculty: 'Faculty of Medicine', department: 'Faculty-wide programme',
  totalCredits: 204, semesters: 12, maxSemesters: 18, url: CAT + 'Faculty-of-Medicine.pdf',
  blocks: {
    UNIV_MANDATORY: { label: 'University Mandatory Courses', credits: 5 },
    UNIV_ELECTIVE: { label: 'Student Selected Components (university electives)', credits: 9 },
    MAJOR_CORE: { label: 'Major Core Courses', credits: 190 }
  },
  note: 'Clinical modules of semesters 7 to 12 are taken as Block I or Block II in either semester of their year; each is placed in one semester here. A comprehensive MBBCh exit exam closes the programme and is not a course.'
}, rows(`
FABL201|Life Cycle|5|MAJOR_CORE|1|
COHD203|Health and Disease|7|MAJOR_CORE|1|
BLAW001|Human Rights|1|UNIV_MANDATORY|1|
ENGL001|English Language|2|UNIV_MANDATORY|1|
LOCO202|Locomotor System|9|MAJOR_CORE|2|
HEMA204|Hematology|3|MAJOR_CORE|2|
ARAB001|Arabic Language|2|UNIV_MANDATORY|2|
CARD205|Cardiovascular System|7|MAJOR_CORE|3|${MED_Y2}
RESP207|Respiratory System|5|MAJOR_CORE|3|${MED_Y2}
GITN206|Gastrointestinal System|7|MAJOR_CORE|4|${MED_Y2}
RENR208|Endocrine and Reproductive System I|7|MAJOR_CORE|4|${MED_Y2}
USRP301|Urinary System and Reproductive System II|6|MAJOR_CORE|5|${MED_Y3}
NESC303|Neurosciences|8|MAJOR_CORE|5|${MED_Y3}
MSYS302|Multisystem I|7|MAJOR_CORE|6|${MED_Y3}
MSYS304|Multisystem II|7|MAJOR_CORE|6|${MED_Y3}
REPG306|Research Project|3|MAJOR_CORE|6|${MED_Y3}
IPEH308|Interprofessional Education for Health Care|1|MAJOR_CORE|6|${MED_Y3}
OBGY401|Obstetrics and Gynecology|9|MAJOR_CORE|7|${MED_Y4}
PEDT403|Pediatrics 1|9|MAJOR_CORE|7|${MED_Y4}
SURG402|Surgery 1|9|MAJOR_CORE|8|${MED_Y4}
INTM404|Medicine 1|9|MAJOR_CORE|8|${MED_Y4}
FAMI501|Family Medicine|9|MAJOR_CORE|9|${MED_Y5}
SURG503|Surgery 2|9|MAJOR_CORE|9|${MED_Y5}
NEPS502|Neurology and Psychiatry|9|MAJOR_CORE|10|${MED_Y5}
INTM504|Medicine 2|9|MAJOR_CORE|10|${MED_Y5}
PEDM601|Medicine 3 and Pediatrics 2|9|MAJOR_CORE|11|${MED_Y6}
SMED602|Medicine 4 and Surgery 3|9|MAJOR_CORE|11|${MED_Y6}
SUME603|Elective 1|9|MAJOR_CORE|12|${MED_Y6}
SUME604|Elective 2|9|MAJOR_CORE|12|${MED_Y6}`))]);
PLANS.find(([id]) => id === 'mbbch')[1].courses.forEach(c => { if (c.planSem >= 7) c.runsIn = ['FALL', 'SPRING']; });


// Law and Dentistry: codes, titles, credits and prerequisites are from the printed
// course tables; the semester of each course comes from a reading of the study plan
// that could not be checked line by line, so check the semesters first.
const UNVERIFIED_SEM = 'Semester placement could not be checked against the printed study plan; codes, credits and prerequisites come from the printed course table.';
PLANS.push(['law', plan({
  program: 'Bachelor of Law', faculty: 'Faculty of Law and Political Science', department: 'Faculty-wide programme',
  totalCredits: 138, semesters: 8, maxSemesters: 16, url: CAT + 'Faculty-of-Law-and-Political-Science.pdf',
  blocks: {
    UNIV_MANDATORY: { label: 'University Mandatory Courses', credits: 2 },
    UNIV_ELECTIVE: { label: 'University Elective Courses', credits: 10 },
    MAJOR_CORE: { label: 'Major Core Courses', credits: 114 },
    DEPT_ELECTIVE: { label: 'Major Elective Courses', credits: 12 }
  },
  note: UNVERIFIED_SEM + ' The 2 mandatory university credits are not named in the plan. Faculty electives are taken by level (1, 2, 4, 5) from a list not included here.'
}, rows(`
BLAW221|Introduction to Law I (Theory of Legal Rule)|2|MAJOR_CORE|1|
BLAW223|Political Institutions|2|MAJOR_CORE|1|
BLAW225|History of Social and Legal Institutions|2|MAJOR_CORE|1|
BLAW227|Islamic Law I|3|MAJOR_CORE|1|
BLAW229|International Organization|3|MAJOR_CORE|1|
BLAW222|Penal Law I|3|MAJOR_CORE|2|
BLAW224|Constitutional Law|3|MAJOR_CORE|2|
BLAW226|Legal Methodology|2|MAJOR_CORE|2|
BLAW228|Citizenship and Foreigners Status|2|MAJOR_CORE|2|
BLAW230|Principles of Political Economy|2|MAJOR_CORE|2|
BLAW232|Introduction to Law II (Theory of Rights)|2|MAJOR_CORE|2|
BLAW251|Penal Law II (General Part)|3|MAJOR_CORE|3|
BLAW253|Public International Law|3|MAJOR_CORE|3|
BLAW255|Law of Civil Procedures I|3|MAJOR_CORE|3|
BLAW257|Personal Status Laws of Different Religions|2|MAJOR_CORE|3|
BLAW259|Administrative Law I|3|MAJOR_CORE|3|
BLAW261|Civil Law I (Sources of Obligation)|3|MAJOR_CORE|3|BLAW232
BLAW252|Public Finance|3|MAJOR_CORE|4|
BLAW254|Islamic Law II (Marriage, Divorce and Children Rights)|3|MAJOR_CORE|4|
BLAW256|Law of Civil Procedures II|2|MAJOR_CORE|4|BLAW255
BLAW258|Law of Proof|2|MAJOR_CORE|4|
BLAW260|Administrative Law II|3|MAJOR_CORE|4|BLAW259
BLAW262|Civil Law II (Rules of Obligation)|2|MAJOR_CORE|4|BLAW261
BLAW301|Criminal Law I|3|MAJOR_CORE|5|
BLAW303|Commercial Law I|2|MAJOR_CORE|5|
BLAW305|Labor and Social Security Law|3|MAJOR_CORE|5|
BLAW307|Introduction to Intellectual Property Law|2|MAJOR_CORE|5|
BLAW309|Administrative Judicature I|3|MAJOR_CORE|5|
BLAW311|Civil Law I (Special Contracts)|2|MAJOR_CORE|5|BLAW261 BLAW262
BLAW302|Criminal Law II|3|MAJOR_CORE|6|BLAW301
BLAW304|Commercial Law II (Trade Companies)|2|MAJOR_CORE|6|
BLAW306|Islamic Law III (Inheritances, Wills and Waqf)|3|MAJOR_CORE|6|
BLAW308|Money and Banking|2|MAJOR_CORE|6|
BLAW310|Administrative Judicature II|3|MAJOR_CORE|6|BLAW309
BLAW312|Civil Law II (Special Contracts)|2|MAJOR_CORE|6|BLAW311
BLAW403|Maritime and Air Law|2|MAJOR_CORE|7|
BLAW405|Fundamentals of Islamic Doctrines|3|MAJOR_CORE|7|
BLAW407|Private International Law I|2|MAJOR_CORE|7|
BLAW409|Law of Penal Procedures I|3|MAJOR_CORE|7|
BLAW411|Civil Law III (Real Rights)|2|MAJOR_CORE|7|
BLAW402|International Commercial Arbitration|2|MAJOR_CORE|8|
BLAW404|Commercial Law III (Bank Operations and Bankruptcy)|2|MAJOR_CORE|8|
BLAW406|Forced Execution|3|MAJOR_CORE|8|BLAW255 BLAW256
BLAW408|Private International Law II|2|MAJOR_CORE|8|
BLAW410|Law of Penal Procedures II|3|MAJOR_CORE|8|BLAW409
BLAW412|Civil Law IV (Real and Personal Collaterals and Real Estates Registration)|2|MAJOR_CORE|8|BLAW411`))]);

PLANS.push(['bds', plan({
  program: 'Bachelor of Oral and Dental Surgery (BDS)', faculty: 'Faculty of Dentistry', department: 'Faculty-wide programme',
  totalCredits: 180, semesters: 10, maxSemesters: 16, url: CAT + 'Faculty-of-Dentistry.pdf',
  blocks: {
    UNIV_MANDATORY: { label: 'University Mandatory Courses', credits: 5 },
    UNIV_ELECTIVE: { label: 'University Elective Courses', credits: 7 },
    MAJOR_CORE: { label: 'Faculty Core Courses (basic, biomedical, preclinical, clinical)', credits: 163 },
    DEPT_ELECTIVE: { label: 'Faculty Elective Courses', credits: 5 }
  },
  note: UNVERIFIED_SEM + ' Co-requisites printed with * are entered as co-requisites. MICR222 needs BCHM221 or BIOL221, entered without a prerequisite because a choice of two cannot be expressed yet. Faculty electives (DENT501 to DENT517) are not listed.'
}, rows(`
ARAB001|Arabic Language|2|UNIV_MANDATORY||
ENGL001|English Language|2|UNIV_MANDATORY||
BLAW001|Human Rights|1|UNIV_MANDATORY||
ANAT221|Gross Anatomy|2|MAJOR_CORE|1|
BCHM221|Biochemistry|2|MAJOR_CORE|1|
BIOL221|Molecular Genetics|1|MAJOR_CORE|1|
BIOM221|Principles of Dental Biomaterials|1|MAJOR_CORE|1|
DANT221|Dental Anatomy|2|MAJOR_CORE|1|
PHRM221|Medical Botany|2|MAJOR_CORE|1|
PHYL221|Physiology|2|MAJOR_CORE|1|
ANAT222|Head and Neck Anatomy|3|MAJOR_CORE|2|ANAT221
DANT222|Dental Anatomy and Occlusion|3|MAJOR_CORE|2|DANT221
GHST222|General Histology|1|MAJOR_CORE|2|
MICR222|Microbiology and Immunology|2|MAJOR_CORE|2|
OPER222|Preclinical Operative Dentistry I|2|MAJOR_CORE|2|DANT221
BIOM224|Applied Dental Biomaterials I|3|MAJOR_CORE|2|BIOM221
FPRO223|Preclinical Fixed Prosthodontics I|2|MAJOR_CORE|3|OPER222
MICR223|Applied Microbiology and Infection Control|1|MAJOR_CORE|3|MICR222
OCLS223|Fundamentals of Occlusion|1|MAJOR_CORE|3|DANT222
OPER223|Preclinical Operative Dentistry II|2|MAJOR_CORE|3|OPER222
ORBL223|Oral Biology I|3|MAJOR_CORE|3|GHST222
PATH223|Pathology|2|MAJOR_CORE|3|ANAT221
PHBS223|Behavioural Sciences|1|MAJOR_CORE|3|
RPRO223|Preclinical Removable Prosthodontics I|2|MAJOR_CORE|3|DANT222
BIOM225|Applied Dental Biomaterials II|3|MAJOR_CORE|3|BIOM221
FPRO224|Preclinical Fixed Prosthodontics II|2|MAJOR_CORE|4|FPRO223
OPER224|Preclinical Operative Dentistry III|2|MAJOR_CORE|4|OPER223
OPTH224|Oral Pathology I|2|MAJOR_CORE|4|ORBL223
ORAD224|Oral Radiology|1|MAJOR_CORE|4|ANAT222
ORBL224|Oral Biology II|2|MAJOR_CORE|4|ORBL223
PHBS224|Research and Evidence Based Dentistry|2|MAJOR_CORE|4|
PHRM224|Pharmacology|2|MAJOR_CORE|4|PHRM221 PHYL221
RPRO224|Preclinical Removable Prosthodontics II|2|MAJOR_CORE|4|RPRO223
PHBS226|Preventive and Public Health Dentistry|2|MAJOR_CORE|4|
FPRO321|Preclinical Fixed Prosthodontics III|2|MAJOR_CORE|5|FPRO224
GMED321|General Medicine|2|MAJOR_CORE|5|PATH223
ODTP321|Oral Diagnosis, Radiology and Treatment Planning|3|MAJOR_CORE|5|ORAD224
OPER321|Preclinical Operative Dentistry IV|2|MAJOR_CORE|5|OPER224
PHBS321|Practice Management|1|MAJOR_CORE|5|PHBS223
RPRO321|Preclinical Removable Prosthodontics III|2|MAJOR_CORE|5|RPRO224
ENDO323|Preclinical Endodontics I|3|MAJOR_CORE|5|ORAD224 OPER224 MICR223
OSRG323|Anesthesia and Introduction to Oral Surgery|2|MAJOR_CORE|5|PHRM224
PERI323|Preventive Periodontology|1|MAJOR_CORE|5|MICR223
FPRO322|Preclinical Fixed Prosthodontics IV|2|MAJOR_CORE|6|FPRO321
GSRG322|General Surgery, ENT and Ophthalmology|2|MAJOR_CORE|6|PATH223
OPER322|Operative Dentistry I|2|MAJOR_CORE|6|OPER321
OPTH322|Oral Pathology II|2|MAJOR_CORE|6|OPTH224
RPRO322|Preclinical Removable Prosthodontics IV|2|MAJOR_CORE|6|RPRO321
ENDO324|Preclinical Endodontics II|3|MAJOR_CORE|6|ENDO323
OMED324|Oral Medicine|2|MAJOR_CORE|6|ORBL224
PERI324|Periodontology I|2|MAJOR_CORE|6|PERI323
FPRO421|Fixed Prosthodontics I|3|MAJOR_CORE|7|FPRO322
OPER421|Operative Dentistry II|2|MAJOR_CORE|7|OPER322
OSRG421|Oral Surgery I|3|MAJOR_CORE|7|OSRG323
PEDI421|Preventive and Pediatric Dentistry I|2|MAJOR_CORE|7|PHBS226
RPRO421|Removable Prosthodontics I|2|MAJOR_CORE|7|RPRO322
ENDO423|Endodontics I|2|MAJOR_CORE|7|ENDO324
ORTD423|Orthodontics I|2|MAJOR_CORE|7|OCLS223
PERI423|Periodontology II|1|MAJOR_CORE|7|PERI324
FPRO422|Fixed Prosthodontics II|3|MAJOR_CORE|8|FPRO421
OPER422|Operative Dentistry III|3|MAJOR_CORE|8|OPER421
OSRG422|Oral Surgery II|3|MAJOR_CORE|8|OSRG421
RPRO422|Removable Prosthodontics II|2|MAJOR_CORE|8|RPRO421
ENDO424|Endodontics II|3|MAJOR_CORE|8|ENDO423
ORTD424|Orthodontics II|2|MAJOR_CORE|8|ORTD423
PEDI424|Preventive and Pediatric Dentistry II|1|MAJOR_CORE|8|PEDI421
FPRO521|Fixed Prosthodontics III|3|MAJOR_CORE|9|FPRO422
OPER521|Operative Dentistry IV|2|MAJOR_CORE|9|OPER422
OSRG521|Oral Surgery and Implantology|2|MAJOR_CORE|9|OSRG422
PEDI521|Pediatric Dentistry I|2|MAJOR_CORE|9|PEDI424
PERI521|Periodontology III|1|MAJOR_CORE|9|PERI423
PHBS521|Ethics and Professionalism in Dentistry|1|MAJOR_CORE|9|PHBS321
RPRO521|Removable Prosthodontics III|2|MAJOR_CORE|9|RPRO422
ENDO523|Endodontics III|3|MAJOR_CORE|9|ENDO424
CLNC522|Comprehensive Clinical Care|2|MAJOR_CORE|10|
PEDI522|Pediatric Dentistry II|3|MAJOR_CORE|10|PEDI521
PHBS522|Interprofessional Education for Health Care|1|MAJOR_CORE|10|PHBS521
OSRG524|Oral and Maxillofacial Surgery|2|MAJOR_CORE|10|OSRG521
PROS524|Prosthodontics|5|MAJOR_CORE|10|FPRO521 RPRO521
REST524|Restorative Dentistry|5|MAJOR_CORE|10|ENDO523 OPER521`))]);
// co-requisites printed with * in the Dentistry table
const BDS_CO = { OPER222: ['BIOM224'], BIOM224: ['OPER222'], RPRO223: ['BIOM225'], BIOM225: ['RPRO223'], PHBS224: ['PHBS226'], PHBS226: ['PHBS224'],
  ODTP321: ['PERI323'], PERI323: ['ODTP321'], OPTH322: ['OMED324'], OMED324: ['OPTH322'], CLNC522: ['PROS524'] };
PLANS.find(([id]) => id === 'bds')[1].courses.forEach(c => { if (BDS_CO[c.code]) c.co = BDS_CO[c.code]; });

// ---- checks and output --------------------------------------------------------
const treeCheck = require('../src/org-tree').validateTree(TREE);
if (!treeCheck.ok) { console.error('structure: ' + treeCheck.error); process.exit(1); }
const known = require('../data/catalog.json').universityElectives.map(c => c.code);
const out = { builtFrom: 'BAU undergraduate catalogue 2020-2021 and the undergraduate programmes page', builtAt: new Date().toISOString().slice(0, 10),
  programmesPage: PROGRAMS_PAGE, tree: TREE, plans: {} };
let bad = 0;
PLANS.forEach(([id, cat]) => {
  const v = Programme.validate(cat, known);
  const sums = {};
  cat.courses.forEach(c => { sums[c.bucket] = (sums[c.bucket] || 0) + c.cr; });
  const line = Object.keys(cat.buckets).filter(k => cat.buckets[k].credits).map(k => k + ' ' + (sums[k] || 0) + '/' + cat.buckets[k].credits).join(', ');
  console.log((v.errors.length ? 'ERR ' : 'ok  ') + id.padEnd(22) + line);
  v.errors.forEach(e => console.log('      ' + e)); v.warnings.forEach(w => console.log('      warn: ' + w));
  if (v.errors.length) bad++;
  out.plans[id] = Programme.forStorage(cat);
});
if (bad) { console.error(bad + ' plan(s) have errors; nothing written'); process.exit(1); }
fs.writeFileSync(path.join(__dirname, '..', 'data', 'catalogue-2020.json'), JSON.stringify(out, null, 1) + '\n');
console.log('wrote data/catalogue-2020.json with ' + Object.keys(out.plans).length + ' study plans');
