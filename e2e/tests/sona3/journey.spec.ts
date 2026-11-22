// رحلة «صُنّاع المستقبل» كاملة من الصفر عبر الواجهة، كما في docs/ACCOUNTS.md للتطبيق القديم «تجربة رحلة كاملة»:
// زائر يسجّل من صفحة المبادرة → تفعيل البريد → استمارة التقديم ومستنداتها → فحص أهلية IMC → دراسة الجدوى → إسناد المقيّم →
// تقييم اللجنة → اعتماد النتيجة → الاختيار → اعتماد الوزير → الإحالة لجهة التمويل → موافقة التمويل → مراحل الصرف (إبلاغ →
// تحقق IMC → صرف الجهة) → بدء التشغيل → تقرير الأثر → إنهاء المتابعة = COMPLETED.
import { test, expect } from '@playwright/test';
import { shot } from '../support/platform';
import {
  act, activateFromMail, apiToken, asRole, choose, expectState, login, mailMatching, nationalIdFor, open, pdfFile, settle, tab, tableRows, text, upload, yesNo,
} from './helpers';

const STAMP = Date.now();
const EMAIL = `e2e.founder.${STAMP}@test.local`;
const PASSWORD = 'Founder2026';
const NAME = 'كريم أحمد محمود سالم';
const BIRTH = '1998-04-12';
const NID = nationalIdFor(BIRTH, STAMP);

test('a new founder and every reviewer complete the Sona3 journey to COMPLETED', async ({ page, browser, request }) => {
  // ── الزائر: صفحة المبادرة → «سجّل وقدّم (أول مرة)» → نموذج التسجيل الخاص بالمبادرة ──
  await page.goto('/#initiative/sona3');
  await shot(page, 'sona3-01-initiative-page');
  await page.getByText('سجّل وقدّم (أول مرة)').click();
  await expect(page).toHaveURL(/#i\/sona3\/register/);
  await page.locator('#fullName').fill(NAME);
  await page.locator('#regEmail').fill(EMAIL);
  await page.locator('#mobile').fill('01055556666');
  await page.locator('#regPassword').fill(PASSWORD);
  await page.locator('#confirm').fill(PASSWORD);
  await page.getByTestId('register-submit').click();
  await expect(page.getByTestId('register-done')).toContainText(EMAIL);
  await shot(page, 'sona3-02-registered');

  // ── تفعيل البريد من رسالة التفعيل، ثم الدخول (مبادرة واحدة → لوحتها مباشرة) ──
  await activateFromMail(page, EMAIL);
  await shot(page, 'sona3-03-verified');
  await login(page, EMAIL, PASSWORD);
  await expect(page).toHaveURL(/#i\/sona3\/applicant-dashboard/);
  await shot(page, 'sona3-04-applicant-dashboard');

  // ── استمارة التقديم ──
  await page.getByRole('button', { name: 'ابدأ طلبًا جديدًا' }).click();
  await expect(page).toHaveURL(/#i\/sona3\/apply\//);
  const appId = decodeURIComponent(page.url().split('apply/')[1]);

  await tab(page, 'البيانات الشخصية للمتقدم');
  await text(page, 'fullName', NAME);
  await text(page, 'nationalId', NID);
  await text(page, 'birthDate', BIRTH);
  await choose(page, 'nationality', 'egyptian');
  await choose(page, 'governorate', 'cairo');
  await text(page, 'address', '12 شارع التحرير، القاهرة');
  await text(page, 'phone', '01055556666');
  await text(page, 'email', EMAIL);
  await text(page, 'qualification', 'بكالوريوس هندسة ميكانيكا');
  await text(page, 'experience', 'خمس سنوات في تصنيع قطع الغيار');
  await upload(page, 'nationalIdFile', 'national-id.pdf');
  await shot(page, 'sona3-05-application-form');

  await tab(page, 'فريق العمل والشركاء');
  await choose(page, 'applicationType', 'individual');

  await tab(page, 'الملخص والمجال الاستثماري');
  await text(page, 'projectName', 'مصنع قطع غيار صناعية');
  await choose(page, 'sector', 'manufacturing');
  await choose(page, 'projectStage', 'new_idea');
  await choose(page, 'projectGovernorate', 'sharqia');
  await text(page, 'projectLocation', 'العاشر من رمضان');

  await tab(page, 'تفاصيل الفكرة والمنتج');
  await text(page, 'ideaDescription', 'تصنيع قطع غيار صناعية بديلة للمستورد بجودة عالية');
  await text(page, 'problem', 'الاعتماد على الاستيراد');
  await text(page, 'targetCustomers', 'مصانع محلية');
  await text(page, 'competitiveAdvantage', 'سعر أقل وتوريد أسرع');

  await tab(page, 'الجاهزية والاحتياجات التمويلية');
  await choose(page, 'startTimeline', 'immediate');
  await text(page, 'estimatedCost', 500000);
  await text(page, 'requestedFunding', 300000);
  await yesNo(page, 'hasOwnFunding', false);

  await tab(page, 'الإقرارات والتعهدات');
  for (const box of await page.locator('label.chk input[type=checkbox]').all()) await box.check();
  await settle(page);

  await page.locator('.sticky-bar').getByRole('button', { name: 'إرسال الطلب' }).click();
  await expect(page).toHaveURL(new RegExp(`#i/sona3/my-application/${appId}`));
  const founder = await apiToken(request, EMAIL, PASSWORD);
  await expectState(request, founder, appId, 'ELIGIBILITY_REVIEW');
  await mailMatching(EMAIL, /تم استلام طلبك/);
  await shot(page, 'sona3-06-submitted');

  // ── IMC: فحص الأهلية → دراسة الجدوى ──
  const imc = await asRole(browser, 'imc@sona3.local');
  await open(imc, `#application/${appId}`);
  await act(imc, 'مستوفٍ للأهلية — الانتقال لدراسة الجدوى');
  await shot(imc, 'sona3-07-imc-eligible');
  await expectState(request, founder, appId, 'STUDY_PREPARATION');

  // ── المتقدم: دراسة الجدوى ──
  await open(page, `#my-application/${appId}`);
  await page.getByRole('button', { name: 'فتح دراسة الجدوى' }).click();
  await expect(page).toHaveURL(new RegExp(`#i/sona3/study/${appId}`));
  await tab(page, 'دراسة السوق');
  for (const [k, v] of Object.entries({ productName: 'قطع غيار', technicalDescription: 'وصف فني تفصيلي', marketProblem: 'نقص المعروض المحلي', competitiveEdge: 'تكلفة أقل',
    targetSegment: 'مصانع', annualDemand: '10000 وحدة', competitors: 'مستوردون', pricing: 'أقل 15%', salesChannels: 'مباشر' })) await text(page, k, v);
  await yesNo(page, 'importSubstitution', false);
  await tab(page, 'الدراسة الفنية والهندسية');
  await text(page, 'productionCapacity', '1000 وحدة شهريًا');
  await choose(page, 'technologyLevel', 'semi_auto');
  await tableRows(page, 'الأصول الثابتة والمعدات', [{ 'البيان': 'ماكينة CNC', 'المواصفات الفنية': '3 محاور', 'العدد': 1, 'التكلفة التقديرية (جنيه)': 250000 }]);
  for (const [k, v] of Object.entries({ directWorkers: 5, indirectWorkers: 2, monthlyPayroll: 60000, siteArea: 200, utilities: 'كهرباء ومياه', licenses: 'ترخيص صناعي' })) await text(page, k, v);
  await tab(page, 'الدراسة المالية وخطة التمويل');
  for (const [k, v] of Object.entries({ establishmentCosts: 50000, workingCapital: 150000, requestedFinancing: 300000, firstYearRevenue: 1200000, firstYearCosts: 800000, paybackYears: 2.5, breakEvenPercent: 55 })) await text(page, k, v);
  await choose(page, 'preferredModel', 'soft_loan');
  await tab(page, 'تحليل المخاطر وإدارتها');
  for (const [k, v] of Object.entries({ marketRisk: 'انخفاض الطلب', marketMitigation: 'تنويع العملاء', operationalRisk: 'تأخر الخامات', operationalMitigation: 'مخزون أمان',
    financialRisk: 'تقلب الأسعار', financialMitigation: 'عقود آجلة' })) await text(page, k, v);
  await tab(page, 'الاستدامة والأثر الاقتصادي والمجتمعي');
  for (const [k, v] of Object.entries({ directJobs: 7, indirectJobs: 10, localValueAdded: 'مكوّن محلي مرتفع', environmentalImpact: 'أثر بيئي محدود' })) await text(page, k, v);
  await tab(page, 'خطة التنفيذ ومراحلها');
  await tableRows(page, 'مراحل التنفيذ', [
    { 'المرحلة': 'تجهيز الموقع والمعدات', 'المدة (أسابيع)': 8, 'التمويل المطلوب للمرحلة (جنيه)': 100000 },
    { 'المرحلة': 'التشغيل التجريبي', 'المدة (أسابيع)': 8, 'التمويل المطلوب للمرحلة (جنيه)': 200000 },
  ]);
  await shot(page, 'sona3-08-feasibility-study');
  await settle(page);
  await page.locator('.sticky-bar').getByRole('button', { name: 'إرسال دراسة الجدوى' }).click();
  await expectState(request, founder, appId, 'STUDY_REVIEW');

  // ── IMC: إسناد مقيّم ثم إحالة الدراسة للجنة ──
  await open(imc, `#application/${appId}`);
  const evaluatorPick = imc.locator('.card.sec', { hasText: 'لجنة التقييم' }).locator('select');
  await expect(evaluatorPick.locator('option', { hasText: 'مقيّم لجنة التقييم الأول' })).toHaveCount(1);
  await evaluatorPick.selectOption({ label: 'مقيّم لجنة التقييم الأول (تجريبي)' });
  await imc.getByRole('button', { name: 'إسناد', exact: true }).click();
  await expect(imc.locator('.card.sec', { hasText: 'لجنة التقييم' })).toContainText('مقيّم لجنة التقييم الأول');
  await shot(imc, 'sona3-09-evaluator-assigned');
  await act(imc, 'الدراسة مكتملة — إحالة للجنة التقييم');
  await expectState(request, founder, appId, 'COMMITTEE_EVALUATION');

  // ── المقيّم: إقرار عدم التضارب → الدرجات والتوصية → التسليم ──
  const evaluator = await asRole(browser, 'evaluator1@sona3.local');
  await open(evaluator, `#application/${appId}`);
  await evaluator.getByRole('button', { name: 'أقر بعدم وجود تضارب' }).click();
  const scores = evaluator.locator('.card.sec', { hasText: 'تقييمي' }).locator('input[type=number]');
  await expect(scores).toHaveCount(6);
  for (const s of await scores.all()) await s.fill('80');
  await evaluator.locator('.card.sec', { hasText: 'تقييمي' }).locator('select').selectOption('recommend');
  await evaluator.getByRole('button', { name: 'تسليم التقييم' }).click();
  await expect(evaluator.locator('.card.sec', { hasText: 'تقييمي' })).toContainText('سُلّم');
  await shot(evaluator, 'sona3-10-evaluation-submitted');

  // ── IMC: اعتماد النتيجة → الاختيار → اعتماد الوزير → الإحالة لجهة تمويل ──
  await open(imc, `#application/${appId}`);
  await act(imc, 'اعتماد نتيجة التقييم');
  await expectState(request, founder, appId, 'EVALUATED');
  await act(imc, 'اختيار المشروع');
  await expectState(request, founder, appId, 'SELECTED');
  await act(imc, 'تسجيل اعتماد الوزير', async (d) => {
    await d.locator('input[type=date]').fill(new Date().toISOString().slice(0, 10));
    await d.locator('.fld', { hasText: 'مرجع الاعتماد' }).locator('input').fill('قرار وزاري 15/2026');
    await d.locator('input[type=file]').setInputFiles(pdfFile('approval.pdf'));
  });
  await expectState(request, founder, appId, 'FUNDING_SEARCH');
  await act(imc, 'إحالة لجهة تمويل', async (d) => {
    const funder = d.locator('select');
    await expect(funder.locator('option')).not.toHaveCount(1);
    await funder.selectOption({ index: 1 });
  });
  await expectState(request, founder, appId, 'FUNDER_REVIEW');
  await shot(imc, 'sona3-11-referred-to-funder');

  // ── جهة التمويل: الموافقة (المبلغ = إجمالي خطة التنفيذ؛ تُبنى مراحل الصرف منها) ──
  const funder = await asRole(browser, 'funder@sona3.local');
  await open(funder, `#application/${appId}`);
  await act(funder, 'الموافقة على التمويل', async (d) => {
    await d.locator('.fld', { hasText: 'مبلغ التمويل' }).locator('input').fill('300000');
    await d.locator('.fld', { hasText: 'نموذج التمويل' }).locator('select').selectOption('soft_loan');
    await d.locator('.fld', { hasText: 'الشروط' }).locator('textarea').fill('قرض ميسر على 5 سنوات بفترة سماح سنة');
  });
  await expectState(request, founder, appId, 'IMPLEMENTATION');
  await shot(funder, 'sona3-12-funding-approved');

  // ── مراحل الصرف: المتقدم يبلغ بالإنجاز مع دليل → IMC تتحقق → جهة التمويل تسجل الصرف ──
  await open(page, `#my-application/${appId}`);
  const plan = page.locator('.card.sec', { has: page.locator('h3', { hasText: 'مراحل التنفيذ والصرف' }) });
  await expect(plan.locator('tbody tr')).toHaveCount(2);
  const first = plan.locator('tbody tr').first();
  await first.getByPlaceholder('وصف الإنجاز').fill('تم تجهيز الموقع وتركيب الماكينة');
  await first.locator('input[type=file]').setInputFiles(pdfFile('milestone-1.pdf'));
  await first.getByRole('button', { name: 'إبلاغ' }).click();
  await expect(first).toContainText('بانتظار التحقق');
  await shot(page, 'sona3-13-milestone-reported');

  await open(imc, `#application/${appId}`);
  const imcMilestones = imc.locator('.card.sec', { has: imc.locator('h3', { hasText: 'مراحل الصرف' }) });
  await imcMilestones.getByRole('button', { name: 'تحقق' }).click();
  await expect(imcMilestones).toContainText('verified');

  await open(funder, `#application/${appId}`);
  funder.once('dialog', (d) => void d.accept('صرف-2026-001'));
  await funder.locator('.card.sec', { hasText: 'مراحل الصرف' }).getByRole('button', { name: 'تسجيل الصرف' }).click();
  await expect(funder.locator('.card.sec', { hasText: 'مراحل الصرف' })).toContainText('disbursed');
  await shot(funder, 'sona3-14-disbursed');

  // ── IMC: بدء التشغيل → المتقدم: تقرير الأثر → IMC: إنهاء المتابعة ──
  await open(imc, `#application/${appId}`);
  await act(imc, 'بدء التشغيل');
  await expectState(request, founder, appId, 'OPERATING');

  await open(page, `#my-application/${appId}`);
  const impact = page.locator('.card.sec', { has: page.locator('h3', { hasText: 'تقارير الأثر الدورية' }) });
  const field = (label: string) => impact.locator('.fld', { has: page.locator('label', { hasText: new RegExp(`^${label}$`) }) }).locator('input');
  await field('من').fill('2026-01-01');
  await field('إلى').fill('2026-03-31');
  await field('الإيرادات').fill('250000');
  await field('التكاليف').fill('180000');
  await field('الإنتاج').fill('3000 وحدة');
  await field('فرص عمل مباشرة').fill('7');
  await field('فرص عمل غير مباشرة').fill('10');
  await impact.getByRole('button', { name: 'إرسال التقرير' }).click();
  await expect(impact).toContainText('2026-01-01');
  await shot(page, 'sona3-15-impact-report');

  await open(imc, `#application/${appId}`);
  await act(imc, 'إنهاء المتابعة');
  await expectState(request, founder, appId, 'COMPLETED');

  // ── المتقدم يرى النتيجة النهائية ولا إجراء متبقٍ ──
  await open(page, `#my-application/${appId}`);
  await expect(page.locator('.card.actions')).toHaveCount(0);
  await shot(page, 'sona3-16-completed');
});
