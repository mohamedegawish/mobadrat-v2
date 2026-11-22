# النشر وترحيل البيانات

الإنتاج عبارة عن حاويتين من `docker-compose.yml`:

| الحاوية | الوصف |
|---|---|
| `app` | الباك + الواجهة المبنية على نفس الدومين (المنفذ 4000). فيها كل المبادرات والمهام الخلفية |
| `mysql` | MySQL 8.4، داخلية فقط وبدون منفذ منشور |

الملفات المرفوعة في الـ volume `app-data` على المسار `/data/uploads`، والقاعدة في الـ volume `mysql-data`.

## 1) أول نشر

### على Coolify

1. أنشئ Resource من الريبو بنوع **Docker Compose**، وملفه `/docker-compose.yml`.
2. اربط الدومين بخدمة `app` مع المنفذ، مثل `https://initiatives.example.gov.eg:4000`.
3. أدخل المتغيرات من [.env.example](../.env.example). الإجباري منها:
   - `APP_URL` و`CORS_ORIGIN` (الدومين نفسه)؛
   - `JWT_SECRET` (قيمة عشوائية من 64 حرفًا أو أكثر)؛
   - `MYSQL_PASSWORD` و`MYSQL_ROOT_PASSWORD`.
4. ثم Deploy. عند كل إقلاع يطبّق التطبيق الـ migrations تلقائيًا (المنصة ثم كل مبادرة)، وتُنشأ صفحة كل مبادرة في الكتالوج.

### على أي خادم فيه Docker

```bash
cp .env.example .env      # واملأ القيم
docker compose up -d --build
docker compose ps         # app و mysql بحالة healthy
```

يحتاج الخادم reverse proxy (مثل nginx أو Caddy) يوجّه الدومين إلى `app:4000` ويتولى TLS.

### أول مدير للمنصة

```bash
# مع بريد مضبوط: يصله رابط تعيين كلمة المرور (صالح 72 ساعة)
docker compose exec app node dist/cli/createSuperAdmin.js --email admin@example.gov.eg --name "اسم المدير"
# بدون بريد بعد: يُطبع الرابط في الطرفية (ويُسجَّل ذلك في التدقيق) — سلّمه للمدير فقط
docker compose exec app node dist/cli/createSuperAdmin.js --email admin@example.gov.eg --name "اسم المدير" --print-link
```

بعدها يمنح مدير المنصة باقي أدوار المنصة من «لوحة الإدارة ← الحسابات». فِرق كل مبادرة تُدار من لوحة المبادرة نفسها.

### فحص الجاهزية

```bash
docker compose exec app node dist/cli/checkReadiness.js
```

يفحص البريد، وقناة الاستفسار، ووجود مدير منصة، وجاهزية كل مبادرة (موظفو كل جهة مراجعة، دورة مفتوحة، شركات منفذة…).

## 2) ترحيل البيانات من التطبيقات القديمة (مرة واحدة)

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
2. **انشر المنصة الجديدة على قاعدة فارغة** مع `SEED_ON_BOOT=0`، ثم أوقف `app` وأبقِ `mysql` شغالة:
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
