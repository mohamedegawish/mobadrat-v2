# النشر

الإنتاج عبارة عن حاويتين من `docker-compose.yml`:

| الحاوية | الوصف |
|---|---|
| `app` | الباك + الواجهة المبنية على نفس الدومين (المنفذ 4000). فيها كل المبادرات والمهام الخلفية |
| `mysql` | **MySQL 8.4** (قاعدة البيانات الوحيدة للمنصة)، داخلية فقط وبدون منفذ منشور |

الملفات المرفوعة والأسرار اللي التطبيق بيولّدها في الـ volume `app-data` (`/data/uploads` و `/data/secrets`)، والقاعدة في الـ volume `mysql-data`.

## 1) أول نشر

### على Coolify (من غير أي إعداد)

1. أنشئ Resource من الريبو بنوع **Docker Compose**، وملفه `/docker-compose.yml`.
2. اضغط **Deploy**.

خلاص كده. Coolify بيولّد لوحده:

| المتغير | بيستخدم في |
|---|---|
| `SERVICE_URL_APP_4000` | الدومين (https) اللي بيوصل لخدمة `app` على المنفذ 4000، ومنه `APP_URL` و `CORS_ORIGIN` |
| `SERVICE_PASSWORD_MYSQL` و `SERVICE_PASSWORD_MYSQLROOT` | كلمات سر MySQL، ونفس القيمة بتروح للتطبيق ولـ MySQL |
| `SERVICE_PASSWORD_64_JWT` | مفتاح الجلسات `JWT_SECRET` |
| `SERVICE_PASSWORD_SEED` | كلمة مرور أول دخول للحسابات (`SEED_PASSWORD`) |

**عن القيم دي:**
- بتفضل ثابتة بين كل نشر والتاني.
- تلاقيها وتقدر تعدّلها في **Environment Variables** في الـ Resource.
- أي قيمة بتحطها بنفسك بتغلب القيمة المتولدة. مثلًا تحط دومينك من **Domains** في خدمة `app` بالشكل `https://initiatives.example.gov.eg:4000`، و `APP_URL` و `CORS_ORIGIN` بيمشوا وراه.

**مع كل إقلاع للتطبيق:**
- بيطبّق الـ migrations (المنصة وبعدين كل مبادرة).
- بيعمل صفحة كل مبادرة في الكتالوج.
- بيعمل **حساب لكل دور** (شوف تحت).

### على أي سيرفر فيه Docker

حط في `.env` جنب `docker-compose.yml` القيم دي (مش موجودة بره Coolify):

```bash
APP_URL=https://initiatives.example.gov.eg
CORS_ORIGIN=https://initiatives.example.gov.eg
SERVICE_PASSWORD_MYSQL=<قيمة عشوائية>
SERVICE_PASSWORD_MYSQLROOT=<قيمة عشوائية>
```

وبعدين:

```bash
docker compose up -d --build
docker compose ps                    # app و mysql بحالة healthy
docker compose logs app | grep -E "secrets|seed:deploy"   # كلمة مرور أول دخول وقائمة الحسابات
```

- `JWT_SECRET` وكلمة مرور أول دخول بيولّدهم التطبيق في أول إقلاع، وبيحفظهم في `/data/secrets` جوه الـ volume.
- كلمة مرور أول دخول بتظهر **مرة واحدة** في لوج أول إقلاع، وبتفضل موجودة في `/data/secrets/seed-password`.
- السيرفر محتاج reverse proxy (زي nginx أو Caddy) يوجّه الدومين لـ `app:4000` ويتولى TLS.

### حسابات لكل دور

**إيه اللي بيعمله:**
- شغال افتراضيًا (`SEED_ON_DEPLOY=1`).
- في أول نشر بيعمل حساب لكل دور في المنصة والمبادرتين، ومعاهم البيانات التجريبية اللي محتاجينها.
- في كل نشر بعد كده بيعمل **اللي ناقص بس**، و **ما بيلمسش أي حساب موجود** (كلمة المرور، الدور، الحالة).

**أول دخول:**
1. بالإيميل من الجدول، وكلمة المرور `SEED_PASSWORD`. على Coolify هي `SERVICE_PASSWORD_SEED` في Environment Variables.
2. بعدها **لازم صاحب الحساب يحط كلمة مرور خاصة بيه**.
3. اللوج بيطبع قائمة الحسابات اللي اتعملت.

| المكان | الدور | الحساب |
|---|---|---|
| المنصة | مدير المنصة | `admin@mobadrat.local` |
| | متابع الوزارة | `ministry@mobadrat.local` |
| | مدقق | `auditor@mobadrat.local` |
| | مدير المحتوى | `content@mobadrat.local` |
| شمس الصناعة | مدير النظام | `admin@shams.local` |
| | مراجع IMC | `imc1@shams.local` و `imc2@shams.local` |
| | مراجع ENCPC | `encpc@shams.local` |
| | مراجع PMU | `pmu@shams.local` |
| | مالك مصنع (ومعاه مصنع تجريبي) | `factory@shams.local` و `factory2@shams.local` |
| صُنّاع المستقبل | مدير النظام | `admin@sona3.local` |
| | مسؤول IMC | `imc@sona3.local` |
| | مقيّم | `evaluator1@sona3.local` و `evaluator2@sona3.local` |
| | مسؤول جهة التمويل (في جهة تمويل تجريبية خاصة بيه) | `funder@sona3.local` |
| | متقدم (ومعاه ملفه) | `applicant@sona3.local` |

لو عايز الإيميلات على دومينك، حط `SEED_EMAIL_DOMAIN=<الدومين>` قبل أول نشر، وساعتها `imc1@shams.local` هتبقى `imc1.shams@<الدومين>`.

**البيانات التجريبية:**
- المصانع والمتقدم وجهة التمويل التجريبية خاصة بالحسابات دي بس.
- البنوك، ومقدمو الخدمة، ودورة صُنّاع المستقبل، والخبراء بتتضاف **بس لو المبادرة مفيهاش أي حاجة منهم**.
- جهة التمويل التجريبية بتظهر في قائمة جهات التمويل عند IMC، ومكتوب جنبها «تجريبية».

**لما الفرق يبقى ليها حسابات حقيقية:**
- أوقف الحسابات التجريبية من «لوحة الإدارة ← الحسابات ← إيقاف الحساب». الحساب الموقوف بيفضل موقوف، والسيدر ما بيرجّعهوش.
- لو حبيت، خلّي `SEED_ON_DEPLOY=0`.

تقدر كمان تشغّل السيدر يدويًا في أي وقت:

```bash
docker compose exec app node dist/cli/seedDeploy.js
```

### اللي محتاج يتظبط بعد أول نشر

- **البريد** (`SMTP_*` أو `GMAIL_*`): من غيره التسجيل العام ما بيوصلوش رابط التفعيل، ولا روابط استعادة كلمة المرور. الحسابات اللي السيدر عملها مفعّلة ومش محتاجاه.
- **السجل الصناعي لشمس الصناعة** (`REGISTRY_API_URL` و `REGISTRY_API_KEY`):
  - لما مصنع يقدّم طلبه لـ IMC، رقم سجله بيتفحص. من غير الرابط ده التقديم بيرجع «تعذر التحقق من السجل».
  - للتجربة بس لحد ما الرابط يجهز: `REGISTRY_ADAPTER=mock` و `ALLOW_MOCK_REGISTRY_IN_PRODUCTION=1`. **خلي بالك إن ده بيقبل أي رقم.**
- **قناة الاستفسار** (`SUPPORT_EMAIL` و `SUPPORT_PHONE`).

### أول مدير منصة بإيميل حقيقي

```bash
# مع بريد مضبوط: بيوصله رابط تعيين كلمة المرور (صالح 72 ساعة)
docker compose exec app node dist/cli/createSuperAdmin.js --email admin@example.gov.eg --name "اسم المدير"
# من غير بريد: الرابط بيتطبع في الطرفية (وده بيتسجل في التدقيق)، سلّمه للمدير بس
docker compose exec app node dist/cli/createSuperAdmin.js --email admin@example.gov.eg --name "اسم المدير" --print-link
```

بعدها مدير المنصة بيمنح باقي أدوار المنصة من «لوحة الإدارة ← الحسابات». فِرق كل مبادرة بتتدار من لوحة المبادرة نفسها.

### فحص الجاهزية

```bash
docker compose exec app node dist/cli/checkReadiness.js
```

يفحص البريد، وقناة الاستفسار، ووجود مدير منصة، وجاهزية كل مبادرة (موظفو كل جهة مراجعة، دورة مفتوحة، شركات منفذة…).

## 2) (اختياري) ترحيل بيانات التطبيقات القديمة

**مش مطلوب لنشر جديد.** ده بس لو احتجت بيانات تطبيقات شمس وصُنّاع المستقبل القديمة. الترحيل محتاج قاعدة **فاضية**، يعني انشر بـ `SEED_ON_DEPLOY=0` الأول، وبعد ما الترحيل يخلص رجّعها `1`، وحط `SEED_EMAIL_DOMAIN` لأن الحسابات التجريبية القديمة بتتنقل موقوفة.

أداة `legacy-import` تنقل كل البيانات في عملية واحدة: إما أن تنجح كلها أو لا يُكتب شيء. مصادرها:

| المصدر | قاعدة البيانات | الملفات |
|---|---|---|
| شمس الصناعة | MySQL (`--shams-mysql mysql://…`) أو SQLite (`--shams-sqlite app.db`) | `--shams-uploads` |
| صُنّاع المستقبل | SQLite (`--sona3-sqlite app.db`، ومعه `app.db-wal` و`app.db-shm` إن وُجدا) | `--sona3-uploads` |
| المنصة القديمة | SQLite (`--platform-sqlite app.db`) | `--platform-uploads` (اختياري) |

**ما تفعله الأداة:**
- **الحسابات:** تدمج الحسابات بالبريد، فالشخص الموجود في أكثر من تطبيق يصبح حسابًا واحدًا بعضويات في كل مبادرة. تُحفظ كلمة مرور آخر دخول، فلا يحتاج أحد لكلمة مرور جديدة. الجلسات القديمة لا تُنقل، فيسجّل الجميع الدخول من جديد.
- **بيانات المبادرات:** تنسخ كل جداول المبادرات (الطلبات، المراحل، المستندات، التقييمات، التمويل…) بلا أي تعديل. سجل التدقيق والإشعارات ينتقل مع اسم مبادرته.
- **الملفات المشتركة:** تبني الملف الشخصي وملف المصنع لكل شخص من آخر طلب له، مع مستنداته. بذلك لا يُعاد طلب بياناته عند التقديم على مبادرة أخرى.
- **المنصة القديمة:**
  - أدوار الوزارة تتحول إلى أدوار المنصة (`ministry_admin` إلى مدير منصة، `auditor` إلى مدقق، `initiative_manager` إلى مدير محتوى).
  - مبادراتها غير المبنية تصبح صفحات معلومات في الكتالوج.
  - طلباتها العامة تُحفظ للقراءة فقط في `legacy_platform_archive`.
- **التحقق:** تقرأ كل صف بعد كتابته وتقارنه بالأصل، وتفحص كل المفاتيح الأجنبية، وتطابق كل ملف مع الـ sha256 المسجّل له. أي خلل يعني تراجعًا كاملًا.
- **الملفات تُنسخ ولا تُنقل.** والقواعد القديمة لا تُفتح أبدًا للكتابة، إذ تقرأ الأداة نسخة منها.

### الخطوات

1. **أوقف التطبيقات القديمة** أو ضعها في وضع الصيانة، حتى لا يتغير شيء أثناء النقل.
2. **انشر المنصة الجديدة على قاعدة فارغة** مع `SEED_ON_BOOT=0` و`SEED_ON_DEPLOY=0`، ثم أوقف `app` وأبقِ `mysql` شغالة:
   ```bash
   docker compose up -d && docker compose stop app
   ```
3. **انسخ قواعد SQLite وملفاتها إلى الخادم الجديد.** خذ كل `app.db` **مع** `app.db-wal` و`app.db-shm` بعد إيقاف التطبيق. معظم بيانات صُنّاع المستقبل تكون في ملف الـ WAL.
   ```bash
   docker compose cp ./legacy/. app:/data/legacy/
   # المتوقع: /data/legacy/sona3/app.db(+wal/shm), /data/legacy/sona3/uploads/, /data/legacy/shams/uploads/, /data/legacy/platform/app.db
   ```
   قاعدة شمس على MySQL تُقرأ مباشرة بالرابط، بشرط أن يصل إليها الخادم الجديد. مثلًا: انشر منفذها مؤقتًا على عنوان داخلي، أو صدّرها واستوردها في MySQL مؤقتة.
4. **تجربة أولى بدون كتابة** (`--dry-run`)، ثم راجع `report.md`:
   ```bash
   docker compose run --rm app node dist/cli/legacy-import/index.js \
     --shams-mysql "mysql://USER:PASS@HOST:3306/shams" --shams-uploads /data/legacy/shams/uploads \
     --sona3-sqlite /data/legacy/sona3/app.db --sona3-uploads /data/legacy/sona3/uploads \
     --platform-sqlite /data/legacy/platform/app.db \
     --disable-demo-accounts --dry-run --report /data/legacy/report-dry
   docker compose run --rm app cat /data/legacy/report-dry/report.md
   ```
   في التقرير: الحسابات المدموجة، والمعرّفات التي تغيّرت، والحسابات بلا دور، والقيم التي لم تدخل الملف المشترك، والتكرارات المطلوب مراجعتها (رقم قومي أو سجل صناعي في أكثر من حساب)، والملفات المفقودة.
   الخيار `--disable-demo-accounts` يعطّل الحسابات التجريبية للتطبيقات القديمة (`@shams.local` و`@sona3.local` وحسابات ديمو المنصة القديمة)، لأن كلمات مرورها معروفة. بياناتها تبقى كما هي.
5. **التنفيذ الفعلي:** نفس الأمر بدون `--dry-run` ومع `--report /data/legacy/report`. الأداة ترفض العمل إذا كانت القاعدة فيها حسابات بالفعل. لإعادة الترحيل أنشئ القاعدة من جديد.
6. **التشغيل والتحقق:**
   ```bash
   docker compose up -d app
   docker compose exec app node dist/cli/checkReadiness.js
   ```
   عايز حسابات لكل دور؟ دلوقتي شغّل السيدر (شوف «حسابات لكل دور» فوق).
   ادخل بحساب مصنع وحساب متقدم وحساب موظف من كل مبادرة، وراجع «لوحة الإدارة» (الأعداد لكل مبادرة).
7. **الروابط القديمة:** وجّه الدومين القديم لكل تطبيق إلى صفحة تحويل ثابتة تحافظ على المسار:
   ```html
   <!doctype html><meta charset="utf-8"><title>…</title>
   <script>location.replace('https://initiatives.example.gov.eg/#i/shams/' + location.hash.replace(/^#\/?/, ''));</script>
   ```
   استبدل `shams` بـ `sona3` في صفحة صُنّاع المستقبل.
8. **احتفظ بالتطبيقات القديمة للقراءة فقط** فترة كافية، فهي خطة الرجوع. واحذف `/data/legacy` من الخادم بعد التأكد، لأن فيها نسخة من البيانات.

## 3) النسخ الاحتياطي

```bash
# قاعدة البيانات (نسخة متسقة بدون إيقاف)
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --triggers "$MYSQL_DATABASE"' | gzip > db-$(date +%F).sql.gz
# الملفات المرفوعة
docker compose exec -T app tar czf - -C /data uploads > uploads-$(date +%F).tgz
```

**الاسترجاع** (على بيئة تجربة أولًا):

```bash
gunzip -c db-YYYY-MM-DD.sql.gz | docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot "$MYSQL_DATABASE"'
docker compose exec -T app tar xzf - -C /data < uploads-YYYY-MM-DD.tgz
```

جدولهما يوميًا (cron) واحفظ النسخ خارج الخادم.

## 4) التحديث

```bash
git pull && docker compose up -d --build
```

الـ migrations الجديدة تُطبَّق تلقائيًا عند الإقلاع، وتحت قفل. التطبيق يرفض الإقلاع إذا عُدِّل ملف migration سبق تطبيقه، فأي تغيير في القاعدة يكون بملف جديد.
