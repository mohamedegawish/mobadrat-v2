# المنصة الوطنية للمبادرات الصناعية

منصة واحدة فيها:
- موقع عام يعرض كل المبادرات؛
- لوحة إدارة موحّدة لإحصائياتها؛
- كل مبادرة مبنية كوحدة كود مستقلة داخل المنصة بمنطق أعمالها وشاشاتها.

| المبادرة | الوحدة | لمن |
|---|---|---|
| شمس الصناعة | `shams` | المصانع: طاقة شمسية للاستهلاك الذاتي |
| صُنّاع المستقبل | `sona3` | رواد الأعمال: تقديم، تقييم، تمويل، متابعة |

**حساب واحد لكل شخص.** من يسجّل في مبادرة ثم يقدّم على أخرى يرى فقط البيانات والمستندات الناقصة لها. بياناته المحفوظة تُعبّأ تلقائيًا. ومن له أكثر من مبادرة يختار لوحة أيها يدخل.

- المعمارية وطريقة إضافة مبادرة جديدة: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- النشر وترحيل البيانات القديمة: [docs/DEPLOY.md](docs/DEPLOY.md)

## المكونات

```
backend/     Node 22 + Express + TypeScript + MySQL 8.4
  src/core/                 المنصة: الحسابات، العضويات، الملفات المشتركة، الكتالوج، الإدارة، الإشعارات، التدقيق
  src/initiatives/shams/    وحدة شمس الصناعة (كودها، جداولها shams_*، اختباراتها)
  src/initiatives/sona3/    وحدة صُنّاع المستقبل (كودها، جداولها sona3_*، اختباراتها)
  src/cli/                  migrate · seed · createSuperAdmin · checkReadiness · legacy-import
frontend/    React 18 + Vite
  src/platform/             الموقع العام، الدخول، اختيار المبادرة، الملف الشخصي، التقديم، لوحة الإدارة
  src/initiatives/<id>/     واجهة كل مبادرة (تُحمَّل عند الحاجة تحت #i/<id>/…)
docker-compose.dev.yml      MySQL للتطوير والاختبارات
docker-compose.yml + Dockerfile   الإنتاج (التطبيق + MySQL)
```

## التشغيل محليًا

المتطلبات: Node 22+ وDocker Desktop.

```bat
RUN.bat          REM يشغّل MySQL في Docker والباك (:5000) والواجهة (:5173) ويفتح المتصفح
```

أو يدويًا:

```bash
docker compose -f docker-compose.dev.yml up -d mysql
cd backend  && npm install && SEED_ON_BOOT=1 REGISTRY_ADAPTER=mock npm run dev   # http://localhost:5000
cd frontend && npm install && npm run dev                                         # http://localhost:5173
```

### حسابات تجريبية

على قاعدة فارغة مع `SEED_ON_BOOT=1`، وكلمة المرور `Mobadrat@2026`:

| الحساب | الدور |
|---|---|
| `admin@mobadrat.local` | مدير المنصة (يدخل أي مبادرة كمدير نظامها) |
| `ministry@mobadrat.local` · `auditor@mobadrat.local` · `content@mobadrat.local` | متابع الوزارة · مدقق · مدير محتوى |
| `factory@shams.local` · `factory2@shams.local` | مصنع في شمس الصناعة |
| `imc1@shams.local` · `encpc@shams.local` · `pmu@shams.local` · `admin@shams.local` | فريق شمس الصناعة |
| `applicant@sona3.local` | متقدم في صُنّاع المستقبل |
| `imc@sona3.local` · `evaluator1@sona3.local` · `funder@sona3.local` · `admin@sona3.local` | فريق صُنّاع المستقبل |

## الاختبارات

```bash
docker compose -f docker-compose.dev.yml --profile test up -d mysql-test
cd backend && npm test          # المنصة + شمس + صُنّاع المستقبل
cd backend && npm run typecheck && npm run lint:async
cd frontend && npm run build
cd e2e && npx playwright test   # رحلات المستخدم من المتصفح
node perf/run.mjs prepare && node perf/run.mjs load   # اختبار الحمل (محلي فقط)
```

التفاصيل (الـ hard tests، رحلات الـ e2e، اختبار الحمل ونتائجه): [docs/TESTING.md](docs/TESTING.md) · [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
