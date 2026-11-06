/* ── Arabic ───────────────────────────────────────────────────────────────
   Translates the rendered page text. Numbers are swapped for # before the
   lookup ("12 not registered" -> "# not registered") and put back after.
   Names, course codes/titles and registrar wording stay as on the transcript.
   Page switches to RTL; student names use the Arabic name when the
   transcript has one. */

let LANG = (() => { try { return localStorage.getItem('bau.lang') || 'en'; } catch (e) { return 'en'; } })();

// ---- dictionary -----------------------------------------------------------
// keys must match the English on screen exactly, with numbers written as #
const AR_DICT = {
  'Online Advising System': 'نظام الإرشاد الأكاديمي الإلكتروني', 'Online Advising System - Summary': 'نظام الإرشاد الأكاديمي الإلكتروني - ملخص',
  'Faculty of Science': 'كلية العلوم', 'Mathematics and Computer Science': 'الرياضيات وعلوم الحاسوب',
  'Good evening. A quick look before you go?': 'مساء الخير. نظرة سريعة قبل أن تغادر؟',
  'Good morning. Let us see who needs you today.': 'صباح الخير. لنرَ من يحتاجك اليوم.',
  'Good afternoon. The lists are ready.': 'مساء الخير. القوائم جاهزة.',
  'Choose your name. First time here? Create a password.': 'اختر اسمك. هذه أول مرة؟ أنشئ كلمة مرور.',
  'Assistant Professor': 'أستاذ مساعد', 'Professor': 'أستاذ', 'Associate Professor': 'أستاذ مشارك', 'Graduate Assistant': 'مساعد دراسات عليا',
  'Department admin': 'مسؤول القسم', 'Department administrator': 'مسؤول القسم', 'Set up': 'إعداد',
  'Computer Science advising. More programmes can be added later.': 'إرشاد علوم الحاسوب. يمكن إضافة برامج أخرى لاحقًا.',
  'Sign out': 'تسجيل الخروج', 'Switch between light and dark': 'التبديل بين الوضع الفاتح والداكن',
  'Assistant Professor of Computer Science': 'أستاذ مساعد في علوم الحاسوب',
  'BAU email': 'البريد الجامعي', 'Choose a password': 'اختر كلمة مرور', 'Repeat it': 'أعد كتابتها', 'Create my account': 'إنشاء حسابي',
  'Back': 'رجوع', 'Password': 'كلمة المرور', 'Sign in': 'تسجيل الدخول', 'At least # characters': '# أحرف على الأقل',
  'Marked for review': 'عُلّم للمراجعة', 'No longer marked for review': 'أُزيل تعليم المراجعة',
  'The study plan has one departmental elective in each of semesters #, # and # (from #, # and # credits earned).': 'في الخطة الدراسية مقرر اختياري للقسم في كل من الفصول # و# و# (ابتداءً من # و# و# ساعة مكتسبة).',
  'Failed before, take it again': 'راسب سابقًا، يُعاد', 'Withdrawn before': 'انسحب منه سابقًا',
  'Required for students admitted from #/# on': 'مطلوب للطلاب المقبولين ابتداءً من #/#',
  'Activate your account': 'تفعيل حسابك', 'Opened from your BAU email': 'فُتح من بريدك الجامعي',
  'Type the password you chose when you created the account.': 'اكتب كلمة المرور التي اخترتها عند إنشاء الحساب.',
  'Activate and sign in': 'تفعيل وتسجيل الدخول', 'Check your BAU email': 'تحقق من بريدك الجامعي',
  'We sent an activation link to your BAU email:': 'أرسلنا رابط تفعيل إلى بريدك الجامعي:',
  'Open it and type your password to finish. The link lasts # hours.': 'افتحه واكتب كلمة المرور لإكمال التسجيل. يبقى الرابط صالحًا # ساعة.',
  'Send the link again': 'أرسل الرابط مرة أخرى', 'Sent. Only the newest link works.': 'تم الإرسال. يعمل أحدث رابط فقط.',
  'Your account is active.': 'حسابك مفعّل.', 'Type your password.': 'اكتب كلمة المرور.',
  'Forgotten password': 'نسيت كلمة المرور', 'Email me a reset link': 'أرسل رابط إعادة التعيين إلى بريدي',
  'We will send a reset link to the BAU email on this account.': 'سنرسل رابط إعادة التعيين إلى البريد الجامعي المسجل في هذا الحساب.',
  'Password reset email is not configured. Contact the department administrator. Your imported records will stay unchanged.': 'بريد إعادة تعيين كلمة المرور غير مُعدّ. تواصل مع مسؤول القسم. ستبقى السجلات المستوردة كما هي.',
  'This preview keeps everything in this browser alone. The portal at its own address checks your password on the server and keeps each advisor\'s students apart.': 'هذه النسخة التجريبية تحفظ كل شيء في هذا المتصفح فقط. أما البوابة على عنوانها الخاص فتتحقق من كلمة المرور على الخادم وتفصل طلاب كل مرشد عن غيره.',
  'now': 'الآن', 'planning': 'التخطيط لفصل', 'Fall #/#': 'خريف #/#', 'Spring #/#': 'ربيع #/#', 'Summer #/#': 'صيف #/#',
  'FALL #/#': 'خريف #/#', 'SPRING #/#': 'ربيع #/#', 'SUMMER #/#': 'صيف #/#',
  'Advising': 'الإرشاد', 'Department': 'القسم', 'Import': 'الاستيراد', 'All students': 'جميع الطلاب', 'Notices': 'التنبيهات', 'To decide': 'بانتظار القرار',
  'Ask Me': 'اسألني', 'Rules in force': 'القواعد المعتمدة', 'Rules and study plan': 'القواعد والخطة الدراسية', 'Portal suggestions': 'اقتراحات للبوابة',
  'Everyone': 'الجميع', 'Freshmen': 'السنة التحضيرية', 'This term': 'هذا الفصل', '# advisees': '# طالبًا', '# not registered': '# غير مسجلين',
  '# sections synced': '# شعبة محمّلة', '# students': '# طالبًا', '# advisors': '# مرشدين', 'loading': 'جارٍ التحميل',
  'Drop the transcripts and schedules you requested for your advisees, and the course offering for the term. Nothing is typed twice.': 'أفلت كشوف العلامات والبرامج التي طلبتها لطلابك، وقائمة المقررات المطروحة لهذا الفصل.',
  '#. Transcripts': '#. كشوف العلامات', 'creates and updates students': 'تنشئ الطلاب وتحدّثهم', 'Drop the transcripts PDF': 'أفلت ملف كشوف العلامات (PDF)',
  'One file with every advisee. Names, IDs, every course, grade and the official CGPA are read from it.': 'ملف واحد لجميع الطلاب. تُقرأ منه الأسماء والأرقام الجامعية والمقررات والعلامات والمعدل التراكمي الرسمي.',
  '#. Schedules': '#. البرامج', 'what they registered this term': 'ما سجلوه هذا الفصل', 'Drop the schedules PDF': 'أفلت ملف البرامج (PDF)',
  'Course, section, credits and weekly times for the term. Load a new one at the start of each semester.': 'المقرر والشعبة والساعات والأوقات الأسبوعية. حمّل ملفًا جديدًا في بداية كل فصل.',
  '#. Course offering': '#. المقررات المطروحة', 'by semester': 'حسب الفصل', 'This file is for': 'هذا الملف لفصل',
  'Drop a course offering CSV': 'أفلت ملف المقررات المطروحة (CSV)', 'Semester': 'الفصل', 'Sections': 'الشعب', 'Courses': 'المقررات', 'Campuses': 'الفروع', 'Source': 'المصدر',
  '# notices to act on': '# تنبيهات تحتاج إلى إجراء', 'Your account': 'حسابك', 'Ask the rule-based advising guide': 'اسأل دليل الإرشاد القائم على القواعد',
  'Your advisees for Fall #/#. Students who need attention come first:': 'طلابك في خريف #/#. يظهر أولًا من يحتاج إلى متابعة:',
  'Your advisees for Spring #/#. Students who need attention come first:': 'طلابك في ربيع #/#. يظهر أولًا من يحتاج إلى متابعة:',
  'red, act now': 'أحمر: تصرّف الآن', 'orange, plan ahead': 'برتقالي: خطّط مسبقًا',
  'All': 'الكل', 'Critical': 'حرجة', 'Needs attention': 'يحتاج إلى متابعة', 'On track': 'على المسار', 'Not registered': 'غير مسجل',
  'Under # credits': 'أقل من # ساعة', 'Over # credits': 'أكثر من # ساعة', 'Act now': 'تصرّف الآن', 'Plan ahead': 'خطّط مسبقًا',
  '# courses': '# مقررات', '# courses, # credits': '# مقررات، # ساعة', 'sem #': 'الفصل #', 'CGPA': 'المعدل التراكمي', 'degree credits': 'ساعات الشهادة',
  'not registered': 'غير مسجل', 'Search by name or ID': 'ابحث بالاسم أو الرقم الجامعي', 'Nobody matches that.': 'لا أحد يطابق البحث.',
  '# credits completed toward the #-credit degree': '# ساعة منجزة من أصل # ساعة للشهادة',
  'and # credits of freshman equivalency. # credits completed toward the #-credit degree': 'و# ساعة معادلة للسنة التحضيرية. # ساعة منجزة من أصل # ساعة للشهادة',
  'What the system found across your # students, and what to do about each one. It is worked out from the records and the rules, so it changes as soon as a record does.': 'ما وجده النظام لدى طلابك الـ#، وما يجب فعله في كل حالة. يُستخرج من السجلات والقواعد، فيتغير فور تغيّر أي سجل.',
  'Needs you this week': 'يحتاجك هذا الأسبوع', 'Goes into the next plan': 'يدخل في الخطة القادمة', 'Good to know': 'للعلم',
  'Worth a word in the meeting': 'يستحق كلمة في اللقاء', 'What to do': 'ما العمل', 'and # more': 'و# آخرون', 'Show only this notice': 'اعرض هذا التنبيه وحده',
  '‹ All notices': '‹ كل التنبيهات', '# of your students.': '# من طلابك.', '# credits registered': '# ساعة مسجلة',
  'Still in the remedial stage': 'ما زال في المرحلة العلاجية', 'Two consecutive academic warnings.': 'إنذاران أكاديميان متتاليان.',
  'Keep the load at # credits (# in summer) and register again the courses that pulled the average down.': 'أبقِ العبء عند # ساعة (# في الصيف) وأعد تسجيل المقررات التي خفّضت المعدل.',
  'At risk of dismissal': 'معرّض للفصل', 'CGPA is low enough that one more weak semester can end the degree (BAU rules on academic standing).': 'المعدل منخفض إلى حد أن فصلًا ضعيفًا آخر قد ينهي الدراسة (أنظمة الجامعة للوضع الأكاديمي).',
  'See them before they register. Keep the load light and put the repeats first.': 'قابلهم قبل التسجيل. خفّف العبء وقدّم المقررات المعادة.',
  'On academic probation': 'تحت الإنذار الأكاديمي', 'Both the semester GPA and CGPA are below #.': 'معدل الفصل والمعدل التراكمي دون #.',
  'Keep next term at # credits or less and plan the failed required courses first.': 'اجعل الفصل القادم # ساعة أو أقل وخطّط أولًا للمقررات الإلزامية الراسبة.',
  'Not registered for Fall #/#': 'غير مسجل في خريف #/#', 'Not registered for Spring #/#': 'غير مسجل في ربيع #/#',
  'They have no schedule for the current term.': 'ليس لديهم برنامج للفصل الحالي.', 'Send each one a reminder so they register before add and drop closes.': 'أرسل لكل منهم تذكيرًا ليسجل قبل انتهاء فترة الإضافة والحذف.',
  'Not seen for a while': 'منقطع منذ مدة', 'No registration since the term shown on their record.': 'لا تسجيل منذ الفصل المذكور في سجله.',
  'Contact them to find out whether they are still studying.': 'تواصل معهم لمعرفة ما إذا كانوا لا يزالون يدرسون.',
  'A failed required course is not registered': 'مقرر إلزامي راسب غير مسجل', 'A failed required course has to be repeated (BAU rules on repeating courses).': 'يجب إعادة المقرر الإلزامي الراسب (أنظمة الجامعة لإعادة المقررات).',
  'Add the repeat to the plan for the next term it runs.': 'أضف المقرر المعاد إلى خطة أول فصل يُطرح فيه.',
  'IC# certificate not recorded': 'شهادة IC# غير مسجلة', 'IC# is required of every student and carries no credits.': 'شهادة IC# مطلوبة من كل طالب ولا تحمل ساعات.',
  'Ask for the IC# certificate. The student cannot graduate without it.': 'اطلب شهادة IC#. لا يمكن للطالب التخرج بدونها.',
  'A repeat runs this semester': 'مقرر معاد يُطرح هذا الفصل', 'The course runs only once a year.': 'يُطرح المقرر مرة واحدة في السنة.',
  'Register the repeat now. The next chance may be a full year away.': 'سجّل المقرر المعاد الآن، فقد تكون الفرصة التالية بعد سنة كاملة.',
  'Behind on departmental electives': 'متأخر في مقررات القسم الاختيارية', 'The study plan has one departmental elective in each of semesters #, # and #.': 'في الخطة الدراسية مقرر اختياري للقسم في كل من الفصول # و# و#.',
  'Plan one in the next term, from the student’s track if they have one.': 'خطّط لواحد في الفصل القادم، من مسار الطالب إن وُجد.',
  'Under the credit minimum': 'دون الحد الأدنى من الساعات', 'Twelve credits is the minimum in Fall and Spring.': 'الحد الأدنى اثنتا عشرة ساعة في الخريف والربيع.',
  'Add a course or check the reason for the light load.': 'أضف مقررًا أو تحقق من سبب العبء الخفيف.',
  'No social science elective yet': 'لا يوجد بعد مقرر اختياري في العلوم الاجتماعية', 'University electives must include a social science course.': 'يجب أن تتضمن المقررات الاختيارية الجامعية مقررًا في العلوم الاجتماعية.',
  'Put one in the next plan. At least one is needed to graduate.': 'ضع واحدًا في الخطة القادمة. يلزم واحد على الأقل للتخرج.',
  'No humanities elective yet': 'لا يوجد بعد مقرر اختياري في الإنسانيات', 'University electives must include a humanities course.': 'يجب أن تتضمن المقررات الاختيارية الجامعية مقررًا في الإنسانيات.',
  'One course is holding up a whole year': 'مقرر واحد يؤخر سنة كاملة', 'The course runs once a year and later courses need it.': 'يُطرح المقرر مرة في السنة وتحتاجه مقررات لاحقة.',
  'Plan it the next time it runs, or the student loses a year.': 'خطّط له في أول طرح قادم، وإلا خسر الطالب سنة.',
  'A hard last semester': 'فصل أخير صعب', 'Last semester GPA well under the CGPA.': 'معدل الفصل الأخير أدنى بكثير من المعدل التراكمي.',
  'Ask how it went before planning the next one.': 'اسأل عمّا حدث قبل التخطيط للفصل القادم.',
  'Classes on both campuses': 'محاضرات في الفرعين', 'The schedule has sections in Beirut and in Debbieh.': 'البرنامج يتضمن شعبًا في بيروت والدبية.',
  'Check there is time to travel between back to back classes.': 'تأكد من وجود وقت كافٍ للتنقل بين المحاضرات المتتالية.',
  'A failed elective': 'مقرر اختياري راسب', 'Electives can be replaced; required courses cannot.': 'يمكن استبدال المقررات الاختيارية، أما الإلزامية فلا.',
  'Repeat it or replace it with another elective from the same group.': 'أعده أو استبدله بمقرر اختياري آخر من المجموعة نفسها.',
  'Work Ready Now to plan': 'مقرر Work Ready Now للتخطيط', 'University requirement from catalogue year #.': 'متطلب جامعي ابتداءً من دليل عام #.',
  'Keep as graduated': 'إبقاؤه كمتخرج', 'Still studying': 'ما زال يدرس', 'Looks to have graduated': 'يبدو أنه تخرج',
  'Nothing was taken off your list. Say what each one is and they move.': 'لم يُحذف أحد من قائمتك. حدّد وضع كل منهم لينتقل.',
  'Try': 'جرّب', 'Ask': 'اسأل', 'Type a question: a student, a course code, or a rule': 'اكتب سؤالًا: عن طالب، أو رمز مقرر، أو قاعدة',
  'Ask Me works entirely inside the portal. Nothing is sent anywhere. Anything that changes a student\'s official record must still be checked against the registrar.': 'تعمل «اسألني» بالكامل داخل البوابة ولا يُرسل شيء إلى الخارج. ما يغيّر السجل الرسمي للطالب يجب التحقق منه لدى دائرة التسجيل.',
  'Students registered for less than # credits': 'الطلاب المسجلون في أقل من # ساعة', 'Who has a CGPA below # and is not registered?': 'من معدله دون # وغير مسجل؟',
  'Top # students by CGPA': 'أعلى # طلاب في المعدل', 'Who failed CMPS#?': 'من رسب في CMPS#؟', 'When will Hussein graduate?': 'متى يتخرج حسين؟',
  'How many students are on probation?': 'كم طالبًا تحت الإنذار؟', 'Who is close to graduating?': 'من اقترب من التخرج؟', 'Average CGPA of students in semester #': 'متوسط المعدل لطلاب الفصل #',
  'Rules': 'القواعد', 'Study plan': 'الخطة الدراسية', 'History': 'السجل', 'Credit load': 'العبء الدراسي', 'Academic standing': 'الوضع الأكاديمي',
  'Graduation': 'التخرج', 'Electives and tracks': 'المقررات الاختيارية والمسارات', 'Minor': 'التخصص الفرعي',
  'What the portal checks, in plain sentences, exactly as the department has set it.': 'ما تتحقق منه البوابة، بجمل واضحة، كما حدده القسم تمامًا.',
  'The rules every student is checked with. Only the department admin can change them; ask them if something here is wrong.': 'القواعد التي يُقاس عليها كل طالب. لا يغيّرها إلا مسؤول القسم؛ راجعه إن وجدت خطأ.',
  'Change the rules': 'تعديل القواعد', 'See the effect': 'اعرض الأثر', 'Publish': 'نشر', 'Discard': 'تجاهل', 'Undo this change': 'التراجع عن هذا التغيير',
  'Suggestions for the portal': 'اقتراحات للبوابة', 'Share a clear idea or report something that needs improvement.': 'شارك فكرة واضحة أو أبلغ عن أمر يحتاج إلى تحسين.',
  'Idea': 'فكرة', 'Something is wrong': 'هناك خطأ', 'Question': 'سؤال', 'Send it': 'إرسال',
  'Signed with your name and kept on the shared suggestions board.': 'يوقَّع باسمك ويُحفظ في لوحة الاقتراحات المشتركة.', 'Nothing here yet. Yours would be the first.': 'لا شيء هنا بعد. سيكون اقتراحك الأول.',
  'What would make your advising easier?': 'ما الذي يجعل الإرشاد أسهل عليك؟', '‹ All students': '‹ جميع الطلاب', '‹ Everyone': '‹ الجميع',
  'Back to all students': 'العودة إلى جميع الطلاب', 'Back to everyone': 'العودة إلى الجميع',
  'ID year #': 'سنة الرقم الجامعي #', 'semester #': 'الفصل #', 'Beirut': 'بيروت', 'Debbieh': 'الدبية', 'Beirut and Debbieh': 'بيروت والدبية',
  'Cybersecurity track': 'مسار الأمن السيبراني', 'Software Development track': 'مسار تطوير البرمجيات', 'AI & Data Science track': 'مسار الذكاء الاصطناعي وعلم البيانات',
  'Computer Science track evidence': 'مؤشرات مسار علوم الحاسوب', 'Potential Cybersecurity track': 'مسار محتمل في الأمن السيبراني',
  'Potential Software Development track': 'مسار محتمل في تطوير البرمجيات', 'Potential AI & Data Science track': 'مسار محتمل في الذكاء الاصطناعي وعلم البيانات',
  'General / mixed electives': 'مقررات عامة / مختلطة بين المسارات', 'No track evidence yet.': 'لا توجد مؤشرات لمسار بعد.',
  'No potential track yet.': 'لا يوجد مسار محتمل بعد.', '# / # courses': '# / # مقررات',
  'joined #/#': 'التحق #/#', 'Email student': 'مراسلة الطالب', 'Print sheet': 'طباعة الورقة', 'Mark as critical': 'تعليم كحالة حرجة',
  'Progress': 'التقدّم', 'Plan next term': 'خطة الفصل القادم', 'Course chain': 'سلسلة المقررات', 'Contract sheet': 'ورقة العقد', 'Transcript': 'كشف العلامات',
  'What to do next': 'الخطوة التالية', 'On track for FALL #/#.': 'على المسار في خريف #/#.', 'On track for SPRING #/#.': 'على المسار في ربيع #/#.',
  'Next semester, point them at': 'في الفصل القادم، وجّهه إلى', '(# credits).': '(# ساعة).', 'Build the plan': 'إعداد الخطة', 'Send a reminder': 'إرسال تذكير',
  'Not registered for FALL #/#.': 'غير مسجل في خريف #/#.', 'Start with': 'ابدأ بـ',
  'registrar figure': 'رقم دائرة التسجيل', 'Credits completed': 'الساعات المنجزة', 'Standing': 'الوضع الأكاديمي', 'Good standing': 'وضع جيد', 'On probation': 'تحت الإنذار', 'At risk': 'معرّض للخطر',
  'Degree requirements': 'متطلبات الشهادة', 'credits left to graduate': 'ساعة متبقية للتخرج', 'of them this term': 'منها هذا الفصل', 'still to plan': 'ما زالت للتخطيط',
  'University Requirements': 'المتطلبات الجامعية', '# of # credits': '# من # ساعة', 'done': 'مكتمل', 'University Electives': 'المقررات الاختيارية الجامعية',
  '# left': 'متبقٍ #', '# credits still to choose': '# ساعة للاختيار', 'Faculty Core': 'متطلبات الكلية', '+# this term': '+# هذا الفصل', 'done after this term': 'يكتمل بعد هذا الفصل',
  'Major Core': 'متطلبات التخصص', 'Still to take:': 'ما زال عليه:', 'Departmental Electives': 'مقررات القسم الاختيارية', '# credits still to choose after this term': '# ساعة للاختيار بعد هذا الفصل',
  'General Science Electives': 'مقررات العلوم العامة الاختيارية', 'Minor in Mathematics': 'التخصص الفرعي في الرياضيات', 'possible': 'ممكن', 'minor completed': 'مكتمل',
  '# minor credits completed · # required': '# ساعة منجزة للتخصص الفرعي · المطلوب #',
  'Graduation check': 'التحقق من التخرج', 'Humanities elective': 'مقرر اختياري في الإنسانيات', 'Social Science elective': 'مقرر اختياري في العلوم الاجتماعية',
  '— Completed': '— مكتمل', '— Missing': '— ناقص', '— Clear': '— لا شيء', '— Obtained': '— حاصل عليها', 'No unresolved F': 'لا رسوب عالق', 'No incomplete grades': 'لا علامات غير مكتملة',
  'Within # semesters': 'خلال # فصلًا', '— # used': '— استُخدم #', 'Why this student needs attention': 'لماذا يحتاج هذا الطالب إلى متابعة', 'Notes': 'ملاحظات',
  'Meetings': 'اللقاءات', 'Log this meeting': 'تسجيل هذا اللقاء', 'No meetings logged yet.': 'لم يُسجَّل أي لقاء بعد.', 'Your note': 'ملاحظتك', 'Mark as reviewed': 'تعليم كمُراجَع',
  'Mark this student for review': 'تعليم الطالب للمراجعة', 'Save note': 'حفظ الملاحظة', 'Contact': 'التواصل', 'Email': 'البريد', 'Phone': 'الهاتف', 'Nationality': 'الجنسية',
  'Programme': 'البرنامج', 'Advisor': 'المرشد', 'What you agreed today': 'ما اتفقتما عليه اليوم', 'What you want to remember or pass on': 'ما تريد تذكّره أو نقله',
  'Lebanese': 'لبناني', 'Syrian': 'سوري', 'Palestinian': 'فلسطيني', 'Science / Computer Science': 'العلوم / علوم الحاسوب',
  'Registered for FALL #/#': 'مسجل في خريف #/#', 'Course': 'المقرر', 'Title': 'العنوان', 'Sec': 'الشعبة', 'Cr': 'س', 'When': 'الموعد', 'Where': 'المكان', 'Counts as': 'يُحتسب ضمن',
  'Checks': 'التحققات', 'Nothing breaks the rules.': 'لا مخالفة للقواعد.', 'Prerequisites, load and timetable all check out.': 'المتطلبات السابقة والعبء والجدول سليمة.',
  'To take again': 'للإعادة', 'take this one first': 'ابدأ بهذا', 'graded W': 'منسحب (W)', 'Week': 'الأسبوع', 'Load': 'العبء', 'max #': 'الحد #',
  'Mo': 'ن', 'Tu': 'ث', 'We': 'ر', 'Th': 'خ', 'Fr': 'ج', 'Sa': 'س', 'Email about this registration': 'مراسلة بشأن هذا التسجيل',
  'What to take in Spring #/#': 'ما يُسجَّل في ربيع #/#', 'What to take in Fall #/#': 'ما يُسجَّل في خريف #/#', 'The Spring #/# offering is not out yet.': 'لم تصدر بعد مقررات ربيع #/#.',
  '# cr': '# س', 'runs in Spring': 'يُطرح في الربيع', 'runs in Fall': 'يُطرح في الخريف', 'add to the trial plan': 'أضف إلى الخطة التجريبية', 'Add': 'إضافة', 'Added': 'أُضيف', 'track': 'مسار',
  'Trial schedule': 'البرنامج التجريبي', 'of # credits': 'من # ساعة', 'Nothing picked yet. Add a course on the left and it appears here.': 'لم يُختر شيء بعد. أضف مقررًا ليظهر هنا.',
  'Checks on this plan': 'التحقق من الخطة', 'Clear all': 'مسح الكل', 'no section': 'بلا شعبة',
  'The course chain': 'سلسلة المقررات', 'How to read it:': 'طريقة القراءة:', 'each column is a semester of the study plan, and each box is a required course.': 'كل عمود فصل من الخطة الدراسية، وكل مربع مقرر إلزامي.',
  'Tap a course': 'اضغط على مقرر', 'to see its links:': 'لرؤية روابطه:', 'green arrows': 'الأسهم الخضراء', 'come from prerequisites already done,': 'تأتي من متطلبات سابقة منجزة،',
  'red arrows': 'الأسهم الحمراء', 'from prerequisites still missing, and': 'من متطلبات سابقة ناقصة، و', 'blue arrows': 'الأسهم الزرقاء',
  'go to the courses it opens. The number on a box (for example +#) is how many credits of later courses wait on it.': 'تتجه إلى المقررات التي يفتحها. الرقم على المربع (مثل +#) هو عدد ساعات المقررات اللاحقة التي تنتظره.',
  '# passed': '# ناجح', '# taking now': '# قيد الدراسة', '# open next term': '# متاح الفصل القادم', '# waiting': '# بالانتظار', '# waiting · faded grey': '# بالانتظار · رمادي باهت', 'show all links': 'اعرض كل الروابط', 'hide all links': 'أخفِ الروابط',
  'Needs first': 'يحتاج أولًا', 'This course': 'هذا المقرر', 'Opens next': 'يفتح لاحقًا', 'Nothing later depends on it': 'لا يعتمد عليه شيء لاحقًا', 'No prerequisite': 'بلا متطلب سابق',
  'open next term': 'متاح الفصل القادم', 'taking it now': 'قيد الدراسة', 'passed': 'ناجح', 'waiting': 'بالانتظار', 'Credits': 'الساعات', 'Prerequisite': 'المتطلب السابق', 'Still needs': 'ما زال يحتاج', 'Opens': 'يفتح',
  'Print this sheet': 'طباعة هذه الورقة', 'Beirut Arab University': 'جامعة بيروت العربية', 'Department of Mathematics and Computer Science': 'قسم الرياضيات وعلوم الحاسوب',
  'Advising contract sheet': 'ورقة عقد الإرشاد', 'Student': 'الطالب', 'Prereq': 'المتطلب', 'Term': 'الفصل', 'Grade': 'العلامة', 'taking now': 'قيد الدراسة',
  'Taking now': 'قيد الدراسة الآن', 'Official transcript': 'كشف العلامات الرسمي', '# rows': '# سطرًا', 'Transferred / equivalency': 'منقول / معادلة', 'transferred': 'منقول',
  '# credits earned': '# ساعة مكتسبة', 'term GPA #': 'معدل الفصل #', 'replaced by a retake': 'استُبدل بالإعادة', 'counted attempt': 'المحاولة المحتسبة',
  'Cancel': 'إلغاء', 'Mail app': 'تطبيق البريد', 'Open in Outlook': 'فتح في Outlook', 'To': 'إلى', 'Subject': 'الموضوع', 'Message': 'الرسالة', 'Send it now': 'أرسل الآن',
  'See all notices ›': 'كل التنبيهات ›', 'Notices': 'التنبيهات', 'Nothing to act on': 'لا شيء يحتاج إلى إجراء',
  'Appearance': 'المظهر', 'Light': 'فاتح', 'Dark': 'داكن', 'Match my computer': 'مثل جهازي', 'Reports and copies': 'التقارير والنسخ',
  'Download Excel report': 'تنزيل تقرير Excel', 'Open PDF summary': 'فتح ملخص PDF', 'Change your password': 'تغيير كلمة المرور', 'Current password': 'كلمة المرور الحالية',
  'New password': 'كلمة المرور الجديدة', 'Change password': 'تغيير كلمة المرور', 'Close': 'إغلاق',
  'Records are kept in this browser only.': 'تُحفظ السجلات في هذا المتصفح فقط.', 'Language': 'اللغة',
  'Repeat waits for next semester': 'المقرر المعاد ينتظر الفصل القادم', 'Failed elective, repeat or replace': 'مقرر اختياري راسب: يُعاد أو يُستبدل',
  'Failed elective, already covered': 'مقرر اختياري راسب ومغطّى', 'IC# not recorded': 'شهادة IC# غير مسجلة', 'Beirut and Debbieh this term': 'بيروت والدبية هذا الفصل',
  'Close to graduating': 'قريب من التخرج', 'Load capped this term': 'العبء محدود هذا الفصل', 'Work Ready Now recommended': 'يُنصح بمقرر Work Ready Now',
  'Work Ready Now still missing': 'مقرر Work Ready Now ما زال ناقصًا', 'In the remedial stage': 'في المرحلة العلاجية', 'Repeat not registered': 'المقرر المعاد غير مسجل',
  'Over the credit limit': 'فوق الحد الأقصى للساعات', 'One SOCI or PSYC course is required.': 'يلزم مقرر واحد من SOCI أو PSYC.',
  'Courses on both campuses in the same week. Common enough, just worth knowing when you talk about timings.': 'مقررات في الفرعين في الأسبوع نفسه. أمر شائع، لكن يستحق الانتباه عند الحديث عن الأوقات.',
  'Due by semester #. This student is in semester #.': 'مستحقة قبل الفصل #. الطالب في الفصل #.',
  'No student would change': 'لن يتغيّر وضع أي طالب', 'Draft.': 'مسودة.', 'Nobody is affected until you publish.': 'لا يتأثر أحد قبل النشر.',
  'Brought up to date': 'تم التحديث', 'Note saved': 'حُفظت الملاحظة', 'Outlook is opening': 'يُفتح Outlook', 'Your mail app is opening': 'يُفتح تطبيق البريد',
  'Import the transcript and schedule PDFs to add your students.': 'استورد ملفي كشوف العلامات والجداول لإضافة طلابك.',
  'Import transcripts, schedules and the term offering.': 'استورد كشوف العلامات والجداول والمقررات المطروحة.',
  'Import transcripts and schedules.': 'استورد كشوف العلامات والجداول.',
  'No current schedule was imported. The student may not be registered, or may be missing from the file.': 'لم يُستورد جدول حالي. قد لا يكون الطالب مسجلًا أو قد يكون غير موجود في الملف.',
  'Prints only the contract sheet.': 'يطبع ورقة العقد فقط.',
  'Grades and credits come from the official transcript.': 'العلامات والساعات من كشف العلامات الرسمي.',
  'Current courses come from the schedule and have no grade yet.': 'المقررات الحالية من الجدول ولا علامة لها بعد.',
  'Excel includes student summaries and transcript courses. The PDF is print-ready.': 'يشمل Excel ملخصات الطلاب ومقرراتهم، وملف PDF جاهز للطباعة.',
  'Nothing is sent outside the portal. Check official record changes with the registrar.': 'لا يُرسل شيء خارج البوابة. تحقق من تغييرات السجل الرسمي مع دائرة التسجيل.',
  'Students with something to check.': 'طلاب يحتاجون إلى مراجعة.', 'Registered and within the rules.': 'مسجلون وملتزمون بالقواعد.',
  'Send a registration reminder.': 'أرسل تذكيرًا بالتسجيل.', 'Meet before registration; keep repeats first.': 'قابل الطالب قبل التسجيل؛ قدّم المقررات المعادة.',
  'Maximum # credits; failed requirements first.': 'الحد الأقصى # ساعة؛ ابدأ بالمتطلبات الراسبة.',
  '# credits, or # in summer; choose GPA-improving courses.': '# ساعة، أو # صيفًا؛ اختر مقررات تحسّن المعدل.',
  'Required repeat missing': 'مقرر إعادة مطلوب ناقص', 'Add it next time it is offered.': 'أضفه عند طرحه القادم.',
  'Repeat offered now': 'مقرر إعادة مطروح الآن', 'Register it now.': 'سجّله الآن.',
  'Ask for the certificate.': 'اطلب الشهادة.', 'Social science elective missing': 'مقرر اختياري اجتماعي ناقص',
  'Humanities elective missing': 'مقرر اختياري إنساني ناقص', 'Add one to the next plan.': 'أضف واحدًا إلى الخطة القادمة.',
  'Course may delay a year': 'مقرر قد يؤخر سنة', 'Plan it at the next offering.': 'خطّط له عند الطرح القادم.',
  'Plan Work Ready Now': 'خطّط لمقرر Work Ready Now', 'Add WRNL# to an upcoming plan.': 'أضف WRNL# إلى خطة قادمة.',
  'Two campuses': 'فرعان', 'Check travel time.': 'تحقق من وقت التنقل.', 'Low last-semester GPA': 'معدل الفصل الأخير منخفض',
  'Discuss it before planning.': 'ناقشه قبل التخطيط.', 'Repeat it or choose another in the same group.': 'أعده أو اختر غيره من المجموعة نفسها.',
  'Under # credits': 'أقل من # ساعة', 'Add a course or confirm the exception.': 'أضف مقررًا أو أكّد الاستثناء.',
  'The freshman year has its own rules. Computer Science degree checks do not apply.': 'للسنة التحضيرية قواعدها الخاصة، ولا تطبق عليها تحققات شهادة علوم الحاسوب.'
};
// sign-in directory (src/directory.js)
Object.assign(AR_DICT, {
  'Beirut Arab University': 'جامعة بيروت العربية', 'Choose your faculty': 'اختر كليتك',
  'Ten faculties across the Beirut, Debbieh, Tripoli and Bekaa campuses.': 'عشر كليات في حرم بيروت والدبية وطرابلس والبقاع.',
  'Choose your department': 'اختر قسمك', 'Choose your account': 'اختر حسابك',
  'Search results': 'نتائج البحث', 'Choose your card to sign in.': 'اختر بطاقتك لتسجيل الدخول.',
  'Search your name or BAU email': 'ابحث عن اسمك أو بريدك الجامعي', 'Search staff': 'البحث عن أعضاء الهيئة',
  'Faculty of': 'كلية', 'One department': 'قسم واحد', '# departments': '# أقسام', '# staff': '# من أعضاء الهيئة',
  '# members of staff': '# من أعضاء الهيئة', '# member of staff': 'عضو واحد من الهيئة',
  '# people found': 'عُثر على # أشخاص', '# person found': 'عُثر على شخص واحد',
  'Welcome back': 'أهلًا بعودتك', 'Not you? Choose another account': 'لست أنت؟ اختر حسابًا آخر',
  'No portal account yet? Your faculty administrator sends you an invitation to your BAU email.': 'ليس لديك حساب بعد؟ يرسل لك مسؤول الكلية دعوة إلى بريدك الجامعي.',
  'Not on the list? Sign in with your BAU email': 'لست في القائمة؟ سجّل الدخول ببريدك الجامعي',
  'Staff accounts are created by invitation. Names, titles and photos come from the BAU website.': 'تُنشأ حسابات أعضاء الهيئة بدعوة. الأسماء والألقاب والصور مأخوذة من موقع الجامعة.',
  'Sign in with your email': 'تسجيل الدخول بالبريد الإلكتروني', 'Use your BAU email address': 'استخدم بريدك الجامعي',
  'Back to the staff list': 'العودة إلى قائمة أعضاء الهيئة', 'Dean’s office': 'مكتب العميد', 'Where you are': 'موقعك',
  'Science': 'العلوم', 'Engineering': 'الهندسة', 'Business Administration': 'إدارة الأعمال',
  'Architecture, Design and Built Environment': 'العمارة - التصميم والبيئة العمرانية', 'Pharmacy': 'الصيدلة',
  'Medicine': 'الطب', 'Dentistry': 'طب الأسنان', 'Health Sciences': 'العلوم الصحية', 'Human Sciences': 'العلوم الإنسانية',
  'Law and Political Science': 'الحقوق والعلوم السياسية',
  'Faculty of Engineering': 'كلية الهندسة', 'Faculty of Business Administration': 'كلية إدارة الأعمال',
  'Faculty of Architecture, Design and Built Environment': 'كلية العمارة - التصميم والبيئة العمرانية',
  'Faculty of Pharmacy': 'كلية الصيدلة', 'Faculty of Medicine': 'كلية الطب', 'Faculty of Dentistry': 'كلية طب الأسنان',
  'Faculty of Health Sciences': 'كلية العلوم الصحية', 'Faculty of Human Sciences': 'كلية العلوم الإنسانية',
  'Faculty of Law and Political Science': 'كلية الحقوق والعلوم السياسية',
  'Biological Sciences': 'العلوم البيولوجية', 'Chemistry': 'الكيمياء', 'Physics': 'الفيزياء'
});

// phrases with a variable part (a name, free text), done by regex instead
const AR_PATTERNS = [
  [/^Good (morning|afternoon|evening), (.+?)\. (.*)$/, (m, a, n, rest) => ({ morning: 'صباح الخير', afternoon: 'مساء الخير', evening: 'مساء الخير' }[a]) + '، ' + n + '. ' + arText(rest)],
  [/^(\d+) (students?)$/, (m, n) => n + ' طالبًا'],
  [/^How I read it: (.*)$/, (m, x) => 'كيف فهمت السؤال: ' + x]
];

// ---- lookup + DOM pass ----------------------------------------------------
// exact match, then the #-key, then the patterns; null = leave it in English
function arKey(t) { const nums = []; const k = t.replace(/\d+(?:\.\d+)?/g, n => { nums.push(n); return '#'; }); return { k, nums }; }
function arText(raw) {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t || !/[A-Za-z]/.test(t)) return null;
  if (AR_DICT[t]) return AR_DICT[t];
  const { k, nums } = arKey(t);
  if (AR_DICT[k]) { let i = 0; return AR_DICT[k].replace(/#/g, () => nums[i++] != null ? nums[i - 1] : '#'); }
  for (const [re, fn] of AR_PATTERNS) { const m = t.match(re); if (m) return fn(...m); }
  return null;
}

// every English string swapped for Arabic, so switching back can restore it
// in place instead of reloading the page
let arUndo = [];
function translateTree(root) {
  if (LANG !== 'ar' || !root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const edits = [];
  let n;
  while ((n = w.nextNode())) {
    const p = n.parentElement;
    // left alone: scripts, inputs, code/.mono, .bub, plan table cells, data-no-ar
    if (!p || p.closest('script,style,textarea,.mono,code,[data-no-ar],.bub,.ptable td')) continue;
    const v = n.nodeValue;
    if (!/[A-Za-z]/.test(v)) continue;
    const ar = arText(v);
    if (ar) edits.push([n, v.replace(v.trim(), ar)]);
  }
  edits.forEach(([node, v]) => { arUndo.push([node, node.nodeValue]); node.nodeValue = v; });
  (root.querySelectorAll ? root.querySelectorAll('[placeholder],[title],[aria-label]') : []).forEach(el => {
    ['placeholder', 'title', 'aria-label'].forEach(a => { const v = el.getAttribute(a); if (v) { const ar = arText(v); if (ar) { arUndo.push([el, v, a]); el.setAttribute(a, ar); } } });
  });
  // forget nodes that are gone from the page (a re-render replaced them)
  if (arUndo.length > 4000) arUndo = arUndo.filter(([n]) => n.isConnected);
}

// ---- switching language ---------------------------------------------------
// in Arabic, a MutationObserver re-translates after each re-render (once per frame)
let arObserver = null;
function applyLang() {
  const ar = LANG === 'ar';
  document.documentElement.setAttribute('dir', ar ? 'rtl' : 'ltr');
  document.documentElement.setAttribute('lang', ar ? 'ar' : 'en');
  if (ar && !arObserver && window.MutationObserver) {
    let queued = false;
    arObserver = new MutationObserver(() => {
      if (queued) return; queued = true;
      requestAnimationFrame(() => { queued = false; translateTree(document.body); });
    });
    arObserver.observe(document.body, { childList: true, subtree: true, characterData: false });
  }
  if (!ar && arObserver) { arObserver.disconnect(); arObserver = null; }
  translateTree(document.body);
}
function setLang(l) {
  const was = LANG;
  LANG = l === 'ar' ? 'ar' : 'en';
  try { localStorage.setItem('bau.lang', LANG); } catch (e) { /* no storage, choice lasts this visit only */ }
  // Back to English: put the original strings back where they still are,
  // then redraw. No reload, so the page and its scroll position stay.
  if (was === 'ar' && LANG === 'en') {
    if (arObserver) { arObserver.disconnect(); arObserver = null; }
    for (let i = arUndo.length - 1; i >= 0; i--) {
      const [n, v, attr] = arUndo[i];
      if (!n.isConnected) continue;
      if (attr) n.setAttribute(attr, v); else n.nodeValue = v;
    }
    arUndo = [];
  }
  applyLang();
  if (state.me) render(); else if (typeof drawGate === 'function') drawGate();
  applyLang();
}
/* Arabic names read off some transcript PDFs come out in visual order, every
   letter reversed ("يويطعلا دمحم نمحرلا دبع" for عبد الرحمن محمد العطيوي).
   Whichever way round has more name-like words wins: words starting with ال,
   and common name parts. Already-correct names are left as they are. */
const AR_NAME_PARTS = ['محمد', 'احمد', 'أحمد', 'علي', 'عبد', 'حسن', 'حسين', 'ابو', 'أبو', 'بن', 'عمر', 'خالد', 'محمود', 'مصطفى', 'ابراهيم', 'إبراهيم', 'يوسف', 'فاطمة', 'زينب', 'مريم', 'نور', 'سارة', 'رنا', 'هادي', 'عباس', 'جاد', 'كريم', 'جهاد', 'وليد', 'سامي', 'رامي', 'بلال', 'حمزة', 'طارق', 'زياد', 'فادي', 'ربيع', 'سمير', 'حسام', 'ريم', 'لين', 'رشا', 'ديما', 'هبة', 'آية', 'اية', 'جنى', 'لمى', 'ياسمين', 'نادين', 'رياض', 'ماهر', 'غسان', 'نبيل'];
function arNameScore(t) {
  // ة and ى only end a word, so one at the start means the text is reversed
  return t.split(/\s+/).filter(Boolean).reduce((n, w) => n + (/^ال/.test(w) ? 1 : 0) + (AR_NAME_PARTS.includes(w) ? 2 : 0) + (/^عبد/.test(w) ? 1 : 0)
    + (/[ةى]$/.test(w) ? 1 : 0) - (/^[ةى]/.test(w) ? 2 : 0) - (/.{2,}لا$/.test(w) ? 1 : 0), 0);
}
function fixArabicOrder(raw) {
  const t = String(raw || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!/[\u0600-\u06FF]/.test(t)) return t;
  const flipped = Array.from(t).reverse().join('');
  return arNameScore(flipped) > arNameScore(t) ? flipped : t;
}
const displayName = s => (LANG === 'ar' && s && s.arabName) ? fixArabicOrder(s.arabName) : (s ? s.name : '');
