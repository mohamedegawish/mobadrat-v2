# المنصة الوطنية للتمويل والمبادرات الصناعية — ملخص للـ AI Agent

> الملف ده بيوصف **الكود الموجود فعلاً** (مش الخطط). ملفات `docs/*_PLAN.md` و`PLATFORM_EXPLAINED_AR.md` فيها رؤية أوسع من المنفذ — لو فيه تعارض، الكود ده هو الصح.
> مصدر الحقيقة لشكل الـ API: `contracts/api.contracts.ts` + `contracts/openapi.json` + `docs/API_CONTRACTS.md`.

---

## 1. المنصة بتعمل ايه

منصة حكومية لوزارة الصناعة المصرية. الوزارة **بتبني مبادرات صناعية من لوحة التحكم** (مثال حقيقي في البذرة: «شمس الصناعة» — طاقة شمسية للمصانع بتمويل بنكي). المصانع بتتصفح المبادرات، بتسجل مرة واحدة، وبتقدّم طلبات. كل طلب بيمشي على **مسار مراحل** (workflow) كل مرحلة فيه مسندة لجهة (هيئة / مركز / بنك / شركة منفذة / شركة كهرباء) وهي اللي بتقرر فيها.

الفكرة الأساسية: **المبادرة = إعدادات (configuration) مش كود**. المراحل والجهات والفورم وصفحة العرض كلها JSON متخزن في الداتابيز ويتعدل من الأدمن.

---

## 2. الـ Stack والتقسيم

| الجزء | التقنية | المكان |
|---|---|---|
| Backend | Node + Express 4 + TypeScript، SQLite (`node:sqlite`)، JWT، bcrypt، multer، nodemailer | `backend/` (بورت 4000) |
| Frontend | React 18 + Vite + TypeScript، بدون router library (views عبر `activeView` + `location.hash`)، store يدوي | `frontend/` (بورت 3000) |
| العقد | Types مشتركة + OpenAPI | `contracts/` |
| النشر | Docker حاوية واحدة (الباك بيخدم الفرونت بـ `SERVE_FRONTEND=1`) أو compose مع nginx | `Dockerfile`, `docker-compose*.yml`, `docs/DEPLOY.md` |

هيكل الباك: `routes/` (راوت نحيف + تحقق) → `store/` (SQL + منطق) → `db/schema.sql`. الموتور في `store/workflow.ts`.
هيكل الفرونت: `src/api/` هو **المكان الوحيد** اللي فيه `fetch`. الحالة العامة في `src/store/state.ts`. الشاشات في `src/components/{showcase,factory,admin,chat,auth}`.

---

## 3. الأدوار والجهات

**أنواع الجهات (`organizations.type`):** `ministry | authority | center | bank | utility | provider | factory`.
كل مستخدم تابع لجهة واحدة (`organizationId`)، ومالك المصنع كمان مربوط بـ `factoryId`.

| الدور | مين | بيعمل ايه |
|---|---|---|
| `ministry_admin` | مشرف عام الوزارة | كل حاجة: مبادرات، مسارات، جهات، حسابات، تقارير، سجل، بانرات. الوحيد اللي يحذف مبادرة/مستخدم |
| `initiative_manager` | مدير مبادرة (وزارة) | زي الأدمن تقريباً من غير الحذف |
| `ida_reviewer` / `imc_reviewer` / `bank_reviewer` / `solar_provider` | موظفين الجهات | يشوفوا ويقرروا في الطلبات المسندة لجهتهم بس |
| `auditor` | مدقق | قراءة فقط: كل الطلبات + سجل التدقيق + الشات (من غير إرسال) |
| `factory_owner` | صاحب مصنع | ملف مصنعه + التقديم + متابعة طلباته بس |

`ADMIN_ROLES = [ministry_admin, initiative_manager]` — `AUDIT_ROLES = ADMIN_ROLES + auditor`.

---

## 4. نموذج البيانات (الجداول المهمة)

| الجدول | فيه ايه |
|---|---|
| `organizations` | الجهات (الوزارة id ثابت `org-ministry`) |
| `users` | الحسابات + الدور + `mustChangePassword` + `isVerified` |
| `initiatives` | المبادرة كاملة. أعمدة JSON: `formSections`, `workflow {version, stages[]}`, `customization` (حجم الملف/إلزام ملف PDF/إعدادات الصفحة `page`)، `benefits`, `faqs`, `preEligibilityQuestions`, `requiredDocsList`, `financialTerms`, `kpis` (للأدمن بس)… الحالة: `active | draft | coming_soon | closed | archived | completed` |
| `factories` | ملف المصنع الموحد — عمود `data` JSON واحد (سجلات، قطاع، محافظة، كهرباء، أسطح…) |
| `details_files` | ملفات PDF مرفوعة للمصنع، اختيارياً مربوطة بمبادرة/طلب. حالة: `pending | verified | rejected` |
| `applications` | الطلب: `currentStageId`, `currentAssignedOrgId`, `status`, `slaDays`, `formData` JSON, `timeline` JSON (كل حدث بـ snapshot لمين عمله وجهته و`fromStage/toStage`) |
| `messages` | رسائل مربوطة بطلب معين بين جهتين |
| `chat_conversations` / `chat_messages` / `chat_attachments` | مركز المراسلات: محادثة ثنائية بين أي جهتين (مش مصانع) |
| `email_outbox` | طابور البريد الصادر (pending/sent/failed/skipped) |
| `home_banners` | بانرات الصفحة الرئيسية |
| `audit_logs` | سجل تدقيق **append-only** (triggers بتمنع UPDATE/DELETE) |
| `refresh_tokens`, `meta` | جلسات + عداد أرقام الطلبات |

---

## 5. الفلوهات الأساسية

### 5.1 الزائر يكتشف المبادرات (بدون تسجيل دخول)
`home` → `initiatives` (كتالوج + فلاتر) → `initiative-detail` (صفحة المبادرة بأقسام قابلة للتخصيص) → **حاسبة الأهلية** (`PreEligibilityModal`: أسئلة `preEligibilityQuestions` بتطلع نسبة توافق، في الفرونت بس) → `compare` لمقارنة مبادرات.
الـ API العام: `GET /initiatives`, `GET /initiatives/:id`, `GET /highlights`. المبادرات `draft/archived` مخفية عن غير `AUDIT_ROLES`.

### 5.2 تسجيل المصنع (مرة واحدة)
`POST /factories/register` (عام، rate-limited) — فورم «شمس الصناعة — البيانات العامة» أقسام A–E (العنوان والتواصل، المنتجات والعمليات وعدد العمال، مصدر الكهرباء والاستهلاك والتكلفة، مساحات الأسطح والأرض، إجراءات ترشيد الطاقة). **كل الحقول إجبارية في التسجيل**، والتعديل بعدين (`PUT /factories/:id`) جزئي.
في transaction واحدة بيتعمل: جهة نوع `factory` + ملف مصنع + مستخدم `factory_owner`. `totalAvailableM2` بيتحسب في السيرفر. بعدها تفعيل الإيميل ثم الدخول.

### 5.3 التقديم على مبادرة
`DynamicApplicationWizard`: الخطوة 0 تأكيد بيانات المصنع (مسحوبة من الملف) ← خطوات بعدد `formSections` (حقول ديناميكية: text/number/select/radio/checkbox/file/repeating_table… مع `condition` لإظهار شرطي) ← إرسال.
`POST /applications` بيتحقق: المبادرة `active`، المالك بيقدم لمصنعه بس، ملف PDF إجباري لو `customization.requireDetailsFile`. الطلب بيبدأ على **أول مرحلة** بحالة `submitted` ورقم `EGY-SOL-2026-XXXX`. بعدها الفرونت بيرفع الملفات `POST /factories/:id/details-files` مربوطة بالطلب. بيتبعت إيميل «تم استلام طلبكم».

### 5.4 موتور المسار والقرارات (قلب النظام) — `backend/src/store/workflow.ts`
**قواعد الحوكمة:**
1. أول مرحلة في **أي** مسار ثابتة: `stage-intake` «المراجعة الأولية — الوزارة» مسندة لـ `org-ministry`. السيرفر بيضيفها تلقائياً (`normalizeWorkflowStages`)، والأدمن يقدر يغير مدتها بس.
2. الوزارة ممنوع تتسند لأي مرحلة تانية — الأدمن بيقرر المرحلة الأولى وبعدها **متابعة فقط** (`MONITOR_ONLY`).
3. اللي يقرر في أي مرحلة = مستخدم دوره reviewer/admin **وجهته = `stage.assignedOrgId`**.
4. الـ auditor والـ factory_owner عمرهم ما يقرروا.

`POST /applications/:id/decisions { action, comments }`:

| action | النتيجة |
|---|---|
| `approve` | ينقل للمرحلة اللي بعدها (status `in_progress`، الجهة والـ SLA يتغيروا). لو آخر مرحلة → `completed` |
| `request_rework` | status `pending_documents` (الطلب يفضل في نفس المرحلة) — التعليق إجباري |
| `reject` | status `rejected` (مقفول) — التعليق إجباري |
| `escalate` | تنبيه للإدارة بس، **مفيش نقل ولا تغيير حالة** — التعليق إجباري، ومش متاح في مرحلة الوزارة |

`canReject/canRequestRework` لكل مرحلة بيتحكموا في الأزرار المتاحة. الحالات المقفولة: `completed | rejected | cancelled` (أي قرار → 409).
السيرفر بيرجع مع كل طلب `viewerCanDecide` و`allowedActions` — **الفرونت ما بيحسبش الصلاحية بنفسه**.
كمان بيرجع ملخص متابعة محسوب من الـ timeline: `stageTrack[]` (حالة كل مرحلة approved/current/rework/rejected/pending/skipped + أيام + تجاوز SLA)، `isSlaViolated`, `isEscalated`, `slaDueDate`.
كل قرار → سجل تدقيق (قبل/بعد) + إيميل للمصنع (`stage_approved | completed | rework | rejected`؛ التصعيد بدون إيميل).

**مثال مسار «شمس الصناعة» في البذرة:** المراجعة الأولية (الوزارة) → تسجيل المصنع (IDA) → مراجعة IDA → دراسة ما قبل الجدوى (أبيكس) → مراجعة الملف الفني (IMC) → التقييم الائتماني (البنك الأهلي) → التعاقد والتركيب (أبيكس) → موافقة شركة الكهرباء (EEHC) → الربط والتشغيل (EEHC).

### 5.5 الأدمن بيبني مبادرة (الاستوديو)
`admin-initiatives` → `admin-initiative` (`InitiativeWorkspace`) فيه تبويبات: البيانات الأساسية والمالية، صفحة العرض (`customization.page`: layout `standard|spotlight|compact`، حتى 12 قسم من أنواع stats/benefits/timeline/faqs/…)، باني الفورم (`FormSchemaBuilder` → `formSections`)، رسام المسار (`VisualWorkflowEditor` → `PUT /initiatives/:id/workflow`)، مؤشرات الأداء KPIs (للأدمن بس).
فيه `POST /initiatives/:id/duplicate` (نسخ كمسودة)، وحماية تزامن في `PUT` عن طريق `expectedUpdatedAt` (409 لو حد عدّل قبلك). الحذف ممنوع لو فيه طلبات مربوطة.

### 5.6 التواصل
- **رسائل الطلب** (`/applications/:id/messages`): رسالة بين جهتين بخصوص طلب معين (المصنع أو الجهة المسندة أو الأدمن يقدروا يبعتوا).
- **مركز المراسلات** (`/chat/*`, view `chat`): محادثات ثنائية بين أي جهتين غير مصانع + مرفقات (فحص magic-bytes، حتى 5 ملفات) + حالة قراءة. الأدمن/المدقق عندهم شاشة `oversight` يشوفوا كل المحادثات. **المصانع ممنوعة من الشات**.
- **تذكير بالإيميل** (`jobs/chatReminders.ts`): لو رسالة فضلت مش مقروءة ≥ 15 دقيقة، إيميل واحد مجمّع للجهة.
- **إيميلات المصنع** بتتسجل في `email_outbox` ويبعتها عامل (`jobs/mailQueue.ts`) بإعادة محاولة — القرار نفسه ما بيستناش SMTP. البريد عبر Gmail SMTP (`GMAIL_USER` / `GMAIL_APP_PASSWORD`)؛ برا الإنتاج بيتحول لـ `MAIL_REDIRECT_TO`.

### 5.7 المتابعة والتقارير
- `GET /dashboard/summary` (AUDIT_ROLES): إجمالي، معتمد، تحت المراجعة، مطلوب تعديل، نسبة الالتزام بالـ SLA.
- `GET /reports/applications.csv` و`initiatives.csv`، و`ReportsStudioView` في الفرونت بيصدّر Excel (`xlsx`).
- `GET /audit-logs` + export (AUDIT_ROLES).
- شاشات: `admin-dashboard`, `admin-stats`, `impact` (الأثر الوطني — أدمن بس)، `ministry-overview` (قراءة فقط).

### 5.8 حاجات تانية
- **بانرات الرئيسية** `/highlights` (اتسمت كده عشان مانعات الإعلانات بتحجب كلمة banner): صورة + رابط لمبادرة/URL + مكان + فترة عرض.
- **مساعد المنصة (Chatbot)** `frontend/src/chatbot/`: محلي بالكامل (FAQ عربي + كلمات مفتاحية + IDF)، **مش LLM**، وبيستعلم بس عن `listInitiatives/getInitiative/myApps` بجلسة المستخدم.

---

## 6. الصلاحيات (ملخص)

| | زائر | مصنع | جهة (reviewer) | مدقق | أدمن |
|---|---|---|---|---|---|
| تصفح المبادرات | ✅ | ✅ | ✅ | ✅ (+ المسودات) | ✅ (+ المسودات) |
| التقديم | ❌ | لمصنعه بس | ❌ | ❌ | ❌ |
| رؤية الطلبات | ❌ | طلبات مصنعه | المسند لجهته + اللي شاركت فيه قبل كده (قراءة) | الكل | الكل |
| القرار | ❌ | ❌ | المرحلة المسندة لجهته | ❌ | المرحلة الأولى بس |
| بناء مبادرة/مسار | ❌ | ❌ | ❌ | ❌ | ✅ |
| الشات | ❌ | ❌ | ✅ | قراءة | ✅ + oversight |
| السجل/التقارير | ❌ | ❌ | ❌ | ✅ | ✅ |

الفحص الحقيقي في الباك على كل endpoint. `ROLE_PERMISSIONS` في `frontend/src/types/index.ts` للعرض والتوجيه بس (`allowedViews` + `defaultView`).

---

## 7. خريطة الـ API (كلها تحت `/api/v1`)

| المجموعة | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/change-password`, `/auth/switch-user` (ديمو) |
| Users/Orgs | `GET /users/me`, `GET|POST /users`, `PUT|DELETE /users/:id`, `GET|POST /organizations`, `PUT /organizations/:id` |
| Initiatives | `GET /initiatives` (عام)، `GET /initiatives/:id` (عام)، `POST`, `PUT`, `DELETE`, `POST /:id/duplicate`, `GET|PUT /:id/kpis`, `GET|PUT /:id/customization`, `GET|PUT /:id/workflow` |
| Factories | `POST /factories/register` (عام)، `GET /factories/mine`, `GET /factories`, `GET|PUT /factories/:id`, `GET|POST /factories/:id/details-files`, `DELETE /factories/:id/details-files/:fileId` |
| Applications | `GET|POST /applications`, `GET /applications/:id`, `POST /applications/:id/decisions`, `GET|POST /applications/:id/messages` |
| Chat | `GET /chat/conversations`, `/chat/unread`, `GET|POST /chat/conversations/:orgId/messages`, `POST /chat/conversations/:orgId/read`, `GET /chat/oversight`, `/chat/oversight/:conversationId/messages`, `GET /chat/attachments/:id` |
| System | `GET /dashboard/summary`, `/reports/applications.csv`, `/reports/initiatives.csv`, `GET /audit-logs`, `POST /audit-logs/export`, `GET /health`, `GET /openapi.json` |
| Banners | `GET /highlights` (عام)، `GET /highlights/:id/image`, `POST /highlights`, `POST /highlights/reorder`, `PUT|DELETE /highlights/:id` |

---

## 8. قواعد ثابتة في الكود

- الرد الناجح `{ message, status, data }`؛ الخطأ `{ code, messageAr, messageEn, details?[] }` (`apiError`).
- `camelCase`، تواريخ ISO UTC، مبالغ بالجنيه كأرقام، أي نص ظاهر له `Ar` و`En`، والواجهة RTL عربي أولاً مع تبديل إنجليزي.
- ممنوع تثبيت اسم مرحلة أو جهة أو حقل فورم في الكود — كله من الداتابيز.
- ممنوع `fetch` برا `frontend/src/api/`.
- الجلسة: access token في الذاكرة (15 دقيقة) + refresh في كوكي httpOnly دوّار. قفل الحساب 15 دقيقة بعد 5 محاولات فاشلة. كلمة سر قوية (8+ حرف ورقم).
- في التطوير مسموح `x-user-id` header بدل JWT (`ALLOW_DEMO_AUTH`)؛ مقفول في الإنتاج.
- ملفات الطلب PDF بس (امتداد + magic bytes) وحجمها من `customization.maxFileSizeMB` (افتراضي 15).
- rate limits منفصلة: الدخول، التسجيل، القراءات العامة، الرفع، القرارات، الرسائل.
- كل كتابة حساسة → `addAuditLog`.

---

## 9. فروقات بين الخطط والكود (مهم قبل ما تعدّل)

- **مفيش قفل نسخة للمسار:** `workflow.version` بيزيد مع كل حفظ، بس الطلبات القديمة بتقرأ المسار **الحالي** (`getStages`)، مش النسخة اللي اتقدمت عليها. وفيه `alignWorkflowsAndAssignments()` بتشتغل مع كل إقلاع وبتظبط الطلبات على المسار الحالي.
- **مفيش endpoint لإعادة التقديم بعد `request_rework`:** المصنع بيرد برسالة/رفع ملف، والمراجع بيرجع يقرر في نفس المرحلة.
- **`formData` ما بيتحققش منه في السيرفر** على حسب `formSections` (بس إنه object).
- رقم الطلب prefix ثابت `EGY-SOL-2026-` لكل المبادرات.
- حالات `draft`, `under_review`, `approved` موجودة في الـ types بس الموتور ما بيستخدمهاش (الموتور: `submitted → in_progress / pending_documents / rejected / completed`).
- نسبة الـ SLA في الداشبورد بتتحسب من `submittedAt` مش من بداية المرحلة الحالية (عكس `buildProcessSummary`).
- تفعيل الإيميل: التوكن بيرجع في رد التسجيل والفرونت بيفعّل تلقائياً — مفيش إيميل تفعيل بيتبعت فعلاً.
- مفيش صلاحيات على مستوى الحقل، ولا تنبيهات داخل النظام (in-app) غير إشعارات الشات.

---

## 10. التشغيل وبيانات التجربة

```bash
cd backend && npm install && npm run dev     # :4000 (بيعمل seed تلقائي لو الداتابيز فاضية)
cd frontend && npm install && npm run dev    # :3000 (proxy /api/v1 → :4000)
cd backend && npm test                       # الاختبارات (node --test)
```

- كل حسابات البذرة كلمة سرها `Egypt@2026` (مطلوب تغييرها أول دخول). القائمة كاملة في `docs/CREDENTIALS_AND_SEED_DATA.md`.
- أمثلة: أدمن `tarek.mansour@industry.gov.eg`، IDA `a.sherif@ida.gov.eg`، بنك `yasser.fawzy@nbe.com.eg`، منفذ `k.nabil@apexsolar.eg`، مدقق `heba.farouk@audit.gov.eg`، مصنع `m.sewedy@elsewedy-ind.com`.
- الداتابيز: `data/app.db` (SQLite). أوامر: `db:reset`, `db:seed`, `seed:file`, `backup`, `restore`, `check:prod`.
- متغيرات الإنتاج الأساسية: `JWT_SECRET` (إجباري)، `CORS_ORIGIN` (ممنوع `*`)، `SEED_ON_BOOT=0`، `ALLOW_DEMO_AUTH=0`، `TRUST_PROXY=1` ورا nginx، `GMAIL_*` للبريد.
