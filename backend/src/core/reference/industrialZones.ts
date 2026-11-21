/**
 * المناطق الصناعية في مصر لكل محافظة — بيانات مرجعية تُزرع تلقائيًا في جدول industrial_zones عند كل تشغيل
 * (db/referenceSeed.ts)، في كل البيئات بما فيها الإنتاج.
 *
 * المصدر: دليل المناطق الصناعية — الهيئة العامة للتنمية الصناعية (IDA)
 *   https://www.ida.gov.eg/ar/industrial-areas  (فلتر المحافظة g=1..27) — اطُّلع عليه في 2026-11-06: 158 منطقة في 26 محافظة.
 * مقارنة: egyin.com (29-09-2025) — جدول بـ124 صفًا، أقل اكتمالًا؛ لم يُضف منه شيء غير وارد في دليل الهيئة.
 *
 * تعديلات على نص المصدر (موثقة):
 *  - الأسماء العربية كما في الدليل مع تنظيف شكلي فقط: حذف علامة (*) والمسافات وحروف التطويل، وتصحيح أخطاء إملائية ظاهرة
 *    (مثل «يأسيوط» → «بأسيوط»، «ببئر العبــــد» → «ببئر العبد»).
 *  - نُقلت ثلاث مناطق إلى محافظتها الجغرافية لأن المصنع يختار المحافظة أولًا:
 *      «القنطرة غرب (أبو خليفة)» — مدرجة في الدليل تحت القاهرة → الإسماعيلية.
 *      «السويس الجديدة (شمال خليج السويس)» — مدرجة تحت القاهرة → السويس.
 *      «المنطقة الصناعية بمطوبس» — مدرجة تحت دمياط، ومطوبس مركز بكفر الشيخ → كفر الشيخ.
 *  - الأسماء الإنجليزية ترجمة عملية (الدليل عربي فقط).
 *  - الغربية: لا مناطق في الدليل (الصفحة فارغة) — يبقى لها خيار «أخرى» فقط.
 *
 * `value` معرّف ثابت يُخزَّن في الطلبات: لا يُغيَّر ولا يُعاد استخدامه بعد النشر. القيم القديمة (10th-ramadan، 6th-october، obour،
 * khanka، sadat-city، sczone) محفوظة كما هي. لإضافة منطقة: أضف سطرًا بقيمة جديدة؛ لإلغائها: احذف سطرها (تُعلَّم غير مفعّلة ولا تُحذف).
 */

export type ZoneAuthority = 'governorate' | 'nuca' | 'ida' | 'gafi' | 'sczone' | 'moi' | 'ncdc' | 'nuca_ida';

export const ZONE_AUTHORITY_LABELS: Record<ZoneAuthority, { ar: string; en: string }> = {
  governorate: { ar: 'المحافظة', en: 'Governorate' },
  nuca: { ar: 'هيئة المجتمعات العمرانية الجديدة', en: 'New Urban Communities Authority' },
  ida: { ar: 'الهيئة العامة للتنمية الصناعية', en: 'Industrial Development Authority' },
  gafi: { ar: 'الهيئة العامة للاستثمار والمناطق الحرة', en: 'General Authority for Investment and Free Zones' },
  sczone: { ar: 'الهيئة العامة للمنطقة الاقتصادية لقناة السويس', en: 'Suez Canal Economic Zone Authority' },
  moi: { ar: 'وزارة الصناعة', en: 'Ministry of Industry' },
  ncdc: { ar: 'الشركة القومية للتشييد والتعمير', en: 'National Company for Construction and Development' },
  nuca_ida: { ar: 'هيئة المجتمعات العمرانية الجديدة / الهيئة العامة للتنمية الصناعية', en: 'NUCA / Industrial Development Authority' },
};

export interface ZoneSeed { governorate: string; value: string; labelAr: string; labelEn: string; authority: ZoneAuthority }

type Row = [value: string, labelAr: string, labelEn: string, authority: ZoneAuthority];

const BY_GOVERNORATE: Record<string, Row[]> = {
  cairo: [
    ['zahraa-maadi', 'المنطقة الصناعية بزهراء المعادي (الشطر الخامس والشطر السادس)', 'Zahraa El Maadi Industrial Zone (5th & 6th sectors)', 'governorate'],
    ['emad-nasr-km18', 'المنطقة الصناعية أرض عماد نصر ك 18 - حي السلام أول', 'Emad Nasr Land Industrial Zone, Km 18 – El Salam 1st', 'governorate'],
    ['el-marg', 'المنطقة الصناعية بحي المرج', 'El Marg District Industrial Zone', 'governorate'],
    ['nozha-renewal', 'المنطقة الصناعية بمنطقة الإحلال والتجديد بين شارع جوزيف تيتو وسكة حديد السويس - حي النزهة', 'Renewal Area Industrial Zone (Josip Tito St. – Suez railway), El Nozha', 'governorate'],
    ['nozha-km19', 'المنطقة الصناعية بكيلو 19 بين سكة حديد جسر السويس وشارع جسر السويس - حي النزهة', 'Km 19 Industrial Zone (Gesr El Suez), El Nozha', 'governorate'],
    ['salam-km6-5', 'المنطقة الصناعية كيلو 6.5 مدينة السلام - حي النزهة', 'Km 6.5 Industrial Zone, El Salam City', 'governorate'],
    ['shaq-el-thoban', 'المنطقة الصناعية شق الثعبان وبدر الليثي والشيماء - حي طرة', 'Shaq El Thoban, Badr El Leithy & El Shaimaa Industrial Zone, Tora', 'governorate'],
    ['south-helwan', 'المنطقة الصناعية بجنوب حلوان', 'South Helwan Industrial Zone', 'governorate'],
    ['qattamia', 'المنطقة الصناعية بالقطامية - حي البساتين', 'Qattamia Industrial Zone, El Basatin', 'governorate'],
    ['basatin-general', 'البساتين العمومي - حي البساتين', 'El Basatin General Zone', 'governorate'],
    ['salam-km17', 'المنطقة الصناعية كيلو 17 - حي السلام أول', 'Km 17 Industrial Zone, El Salam 1st', 'governorate'],
    ['obour-market', 'المنطقة الصناعية بجوار سوق العبور - حي السلام ثان', 'Obour Market Industrial Zone, El Salam 2nd', 'governorate'],
    ['abbasiya', 'المنطقة الصناعية بالعباسية - قسم الوايلي', 'Abbasiya Industrial Zone, El Waili', 'governorate'],
    ['tebbin', 'المنطقة الصناعية بالتبين (أرض البودرة / كفر العلو)', 'El Tebbin Industrial Zone (Ard El Bodra / Kafr El Elw)', 'governorate'],
    ['wadi-hof', 'منطقة شرق أتوستراد مصر/حلوان (وادي حوف - تقسيم إيكون - حي المعصرة)', 'East Cairo–Helwan Autostrade Zone (Wadi Hof, El Maasara)', 'governorate'],
    ['nasr-city-free-zone', 'المنطقة الحرة العامة بمدينة نصر', 'Nasr City Public Free Zone', 'gafi'],
    ['badr-city', 'المنطقة الصناعية بمدينة بدر (مجمع صناعي / منطقة صناعية)', 'Badr City Industrial Zone', 'nuca'],
    ['15-may', 'منطقة الصناعات الصغيرة والجديدة بمدينة 15 مايو', '15 May City Small Industries Zone', 'nuca'],
    ['new-cairo', 'المنطقة الصناعية بالقاهرة الجديدة', 'New Cairo Industrial Zone', 'nuca'],
    ['capital-gardens', 'المنطقة الصناعية بمدينة حدائق العاصمة', 'Capital Gardens City Industrial Zone', 'nuca'],
    ['robbiki-a', 'المنطقة الصناعية بالروبيكي (أ) - المراحل الأولى والثانية والثالثة', 'El Robbiki Industrial Zone (A) – phases 1–3', 'ida'],
    ['robbiki-b', 'المنطقة الصناعية بالروبيكي (ب)', 'El Robbiki Industrial Zone (B)', 'ida'],
  ],
  giza: [
    ['abu-rawash', 'المنطقة الصناعية بأبو رواش وتوسعاتها', 'Abu Rawash Industrial Zone and extensions', 'governorate'],
    ['gerza-ayat', 'المنطقة الصناعية بناحية وصلة جرزا - مركز العياط', 'Gerza Link Industrial Zone, El Ayat', 'governorate'],
    ['arab-abu-saed', 'المنطقة الصناعية بناحية عرب أبو ساعد - مركز الصف', 'Arab Abu Saed Industrial Zone, El Saff', 'governorate'],
    ['6th-october-media-free-zone', 'المنطقة الحرة العامة الإعلامية بمدينة 6 أكتوبر', '6th of October Media Public Free Zone', 'gafi'],
    ['saff-wadi-investment', 'منطقة استثمارية بناحية الوادي - مركز الصف', 'El Wadi Investment Zone, El Saff', 'gafi'],
    ['6th-october', 'المنطقة الصناعية بمدينة 6 أكتوبر', '6th of October City Industrial Zone', 'nuca'],
    ['new-6th-october', 'المنطقة الصناعية بمدينة 6 أكتوبر الجديدة (المناطق الأولى إلى السادسة)', 'New 6th of October Industrial Zone (zones 1–6)', 'nuca'],
    ['el-wahat', 'الواحات (صناعات ثقيلة)', 'El Wahat (heavy industries)', 'ida'],
    ['atfih', 'المنطقة الصناعية بمدينة أطفيح', 'Atfih City Industrial Zone', 'ida'],
  ],
  alexandria: [
    ['manshiya-west', 'المنطقة الصناعية بالمنشية الجديدة (حي غرب)', 'New Manshiya Industrial Zone (West district)', 'governorate'],
    ['manshiya-center', 'المنطقة الصناعية بالمنشية الجديدة (حي وسط)', 'New Manshiya Industrial Zone (Middle district)', 'governorate'],
    ['mergham', 'المنطقة الصناعية بمرغم قبلي وبحري', 'Mergham Industrial Zone (south & north)', 'governorate'],
    ['um-zughaiw', 'المنطقة الصناعية بأم زغيو قبلي وبحري', 'Um Zughaiw Industrial Zone (south & north)', 'governorate'],
    ['wadi-el-qamar-mex', 'المنطقة الصناعية بوادي القمر والمكس', 'Wadi El Qamar & El Max Industrial Zone', 'governorate'],
    ['um-zughaiw-taameer', 'المنطقة الصناعية بأم زغيو (قبلي أم زغيو وغرب وصلة الذراع البحري وقبلي محور التعمير)', 'Um Zughaiw Industrial Zone (Taameer axis)', 'governorate'],
    ['alexandria-free-zone', 'المنطقة الحرة العامة بالإسكندرية', 'Alexandria Public Free Zone', 'gafi'],
    ['borg-el-arab', 'المنطقة الصناعية ببرج العرب', 'Borg El Arab Industrial Zone', 'nuca'],
    ['new-borg-free-2', 'المنطقة الصناعية الحرة 2 بمدينة برج العرب الجديدة', 'New Borg El Arab Free Industrial Zone 2', 'ida'],
    ['new-borg-free-3', 'المنطقة الصناعية الحرة 3 بمدينة برج العرب الجديدة', 'New Borg El Arab Free Industrial Zone 3', 'ida'],
    ['new-borg-343', 'المنطقة الصناعية 343 فدان بمدينة برج العرب الجديدة', 'New Borg El Arab 343-feddan Industrial Zone', 'ida'],
  ],
  qalyubia: [
    ['khanka', 'منطقة الشروق الصناعية - أبو زعبل مركز الخانكة', 'El Shorouk Industrial Zone, Abu Zaabal (El Khanka)', 'governorate'],
    ['safa-foundries', 'منطقة الصفا الصناعية للمسابك (حوض الزهار 27)', 'El Safa Foundries Industrial Zone (Hod El Zohar 27)', 'governorate'],
    ['akrasha', 'المنطقة الصناعية بالعكرشة', 'El Akrasha Industrial Zone', 'governorate'],
    ['abu-zaabal-nasr', 'المنطقة الصناعية بجهة أبو زعبل - مركز الخانكة (أرض جمعية النصر)', 'Abu Zaabal Industrial Zone, El Khanka (El Nasr association land)', 'governorate'],
    ['obour', 'المنطقة الصناعية بمدينة العبور', 'Obour City Industrial Zone', 'nuca'],
    ['benha-farouqiya', 'منطقة استثمارية ببنها بناحية الفاروقية عزبة نجيب', 'Benha Investment Zone (El Farouqiya)', 'gafi'],
  ],
  sharqia: [
    ['belbeis', 'منطقة بلبيس الصناعية (طريق بلبيس/العاشر ك 5)', 'Belbeis Industrial Zone (Belbeis–10th of Ramadan road, km 5)', 'governorate'],
    ['zawamel', 'المنطقة الصناعية ببساتين الإسماعيلية (الزوامل)', 'Basateen El Ismailiya (El Zawamel) Industrial Zone', 'governorate'],
    ['husseiniya-105', 'منطقة الـ 105 فدان بناحية الحسينية', 'El Husseiniya 105-feddan Zone', 'governorate'],
    ['new-salhiya', 'المنطقة الصناعية بالصالحية الجديدة', 'New Salhiya Industrial Zone', 'nuca'],
    ['10th-ramadan', 'المنطقة الصناعية بالعاشر من رمضان', '10th of Ramadan City Industrial Zone', 'nuca'],
  ],
  dakahlia: [
    ['gamasa-south-west', 'المنطقة الصناعية جنوب غرب جمصة', 'South-West Gamasa Industrial Zone', 'governorate'],
    ['mit-ghamr-investment', 'المنطقة الصناعية الاستثمارية بميت غمر', 'Mit Ghamr Investment Industrial Zone', 'gafi'],
  ],
  gharbia: [],
  monufia: [
    ['kafour-el-raml', 'منطقة مبارك الصناعية - كفور الرمل مركز قويسنا (المراحل الأولى إلى الرابعة)', 'Kafour El Raml (Mubarak) Industrial Zone, Quesna (phases 1–4)', 'governorate'],
    ['quesna-old', 'المنطقة الصناعية القديمة بقويسنا', 'Old Quesna Industrial Zone', 'governorate'],
    ['shebin-free-zone', 'المنطقة الحرة العامة بشبين الكوم', 'Shebin El Kom Public Free Zone', 'gafi'],
    ['sadat-city', 'المنطقة الصناعية بمدينة السادات (المجمع الصناعي / المنطقة الصناعية)', 'Sadat City Industrial Zone', 'nuca'],
    ['sadat-developers', 'منطقة المطورين بمدينة السادات', 'Sadat City Developers Zone', 'ida'],
  ],
  beheira: [
    ['wadi-el-natrun', 'المنطقة الصناعية بوادي النطرون', 'Wadi El Natrun Industrial Zone', 'governorate'],
    ['tarana-hosh-eissa', 'المنطقة الصناعية بناحية الطرانة - مركز حوش عيسى', 'El Tarana Industrial Zone, Hosh Eissa', 'governorate'],
    ['nubariya', 'المنطقة الصناعية بالنوبارية (الأولى والثانية)', 'El Nubariya Industrial Zone (1st & 2nd)', 'nuca'],
  ],
  'kafr-el-sheikh': [
    ['baltim', 'المنطقة الصناعية ببلطيم', 'Baltim Industrial Zone', 'governorate'],
    ['mutubas', 'المنطقة الصناعية بمطوبس', 'Mutubas Industrial Zone', 'governorate'],
  ],
  damietta: [
    ['damietta-free-zone', 'المنطقة الحرة العامة بدمياط', 'Damietta Public Free Zone', 'gafi'],
    ['new-damietta', 'المنطقة الصناعية بمدينة دمياط الجديدة', 'New Damietta City Industrial Zone', 'nuca'],
  ],
  'port-said': [
    ['south-port-said-raswa', 'جنوب بورسعيد (الرسوة) - المناطق الصناعية (الحوض السمكي / بحري الحوض السمكي / قبلي C9 / C7 / C8 / C9)', 'South Port Said (El Raswa) Industrial Zones', 'governorate'],
    ['new-port-said-salam', 'المنطقة الصناعية ببورسعيد الجديدة (سلام)', 'New Port Said (Salam) Industrial Zone', 'nuca'],
    ['west-port-said', 'مدينة غرب بورسعيد', 'West Port Said City', 'nuca'],
    ['ps-free-east-portex', 'المنطقة الحرة العامة ببورسعيد (منطقة شرق بورتكس)', 'Port Said Public Free Zone (East Portex)', 'gafi'],
    ['ps-free-dry-dock', 'المنطقة الحرة العامة ببورسعيد (منطقة الحوض الجاف)', 'Port Said Public Free Zone (Dry Dock)', 'gafi'],
    ['ps-free-sigico', 'المنطقة الحرة العامة ببورسعيد (سيجيكو)', 'Port Said Public Free Zone (SIGICO)', 'gafi'],
    ['ps-free-main', 'المنطقة الحرة العامة ببورسعيد (المنطقة الرئيسية)', 'Port Said Public Free Zone (main zone)', 'gafi'],
    ['ps-free-second', 'المنطقة الحرة العامة ببورسعيد (المنطقة الثانية)', 'Port Said Public Free Zone (second zone)', 'gafi'],
    ['ps-free-third', 'المنطقة الحرة العامة ببورسعيد (المنطقة الثالثة)', 'Port Said Public Free Zone (third zone)', 'gafi'],
    ['east-port-said', 'المنطقة الصناعية بشرق بورسعيد (منطقة اقتصادية)', 'East Port Said Industrial Zone (economic zone)', 'sczone'],
    ['south-port-said-raswa-ext', 'امتداد المنطقة الصناعية جنوب بورسعيد (الرسوة) (المجمع الصناعي / المنطقة الصناعية)', 'South Port Said (El Raswa) Industrial Zone extension', 'ida'],
  ],
  ismailia: [
    ['qantara-east', 'المنطقة الصناعية بالقنطرة شرق', 'El Qantara East Industrial Zone', 'governorate'],
    ['ismailia-1-2', 'المنطقة الصناعية الأولى والثانية', 'Ismailia Industrial Zones 1 & 2', 'governorate'],
    ['technology-valley', 'وادي التكنولوجيا (منطقة اقتصادية)', 'Technology Valley (economic zone)', 'sczone'],
    ['ismailia-free-zone', 'المنطقة الحرة العامة بالإسماعيلية', 'Ismailia Public Free Zone', 'gafi'],
    ['abu-khalifa', 'المنطقة الصناعية بالقنطرة غرب (أبو خليفة)', 'El Qantara West (Abu Khalifa) Industrial Zone', 'sczone'],
  ],
  suez: [
    ['medium-industries', 'منطقة الصناعات المتوسطة', 'Medium Industries Zone', 'governorate'],
    ['port-tawfiq-free-zone', 'المنطقة الحرة العامة ببور توفيق', 'Port Tawfiq Public Free Zone', 'gafi'],
    ['adabiya-free-zone', 'المنطقة الحرة العامة بالأدبية', 'El Adabiya Public Free Zone', 'gafi'],
    ['ataqa-free-zone', 'المنطقة الحرة العامة بعتاقة', 'Ataqa Public Free Zone', 'gafi'],
    ['sczone', 'المنطقة الصناعية بالسخنة (المنطقة الاقتصادية شمال غرب خليج السويس)', 'Ain Sokhna Industrial Zone (North-West Gulf of Suez economic zone)', 'sczone'],
    ['north-ataqa', 'شمال عتاقة (صناعات ثقيلة)', 'North Ataqa (heavy industries)', 'moi'],
    ['west-ataqa', 'غرب عتاقة (صناعات ثقيلة)', 'West Ataqa (heavy industries)', 'moi'],
    ['new-suez', 'المنطقة الصناعية بالسويس الجديدة (شمال خليج السويس)', 'New Suez Industrial Zone (north of the Gulf of Suez)', 'nuca'],
  ],
  'north-sinai': [
    ['bir-el-abd', 'المنطقة الصناعية ببئر العبد', 'Bir El Abd Industrial Zone', 'governorate'],
    ['central-sinai', 'المنطقة الصناعية بوسط سيناء', 'Central Sinai Industrial Zone', 'governorate'],
  ],
  'south-sinai': [
    ['abu-zenima', 'المنطقة الصناعية بأبو زنيمة', 'Abu Zenima Industrial Zone', 'governorate'],
  ],
  faiyum: [
    ['kom-oshim', 'المنطقة الصناعية بكوم أوشيم (الفتح)', 'Kom Oshim (El Fath) Industrial Zone', 'governorate'],
    ['qouta', 'المنطقة الصناعية بقوته', 'Qouta Industrial Zone', 'governorate'],
    ['new-faiyum', 'المنطقة الصناعية بالفيوم الجديدة (الأولى والثانية والمجمع المعدني والمجمع الخرساني)', 'New Faiyum Industrial Zone (1st, 2nd, metal & concrete complexes)', 'nuca_ida'],
    ['north-faiyum', 'المنطقة الصناعية شمال الفيوم (كوم أوشيم)', 'North Faiyum Industrial Zone (Kom Oshim)', 'ida'],
  ],
  'beni-suef': [
    ['bayad-el-arab', 'المنطقة الصناعية ببياض العرب', 'Bayad El Arab Industrial Zone', 'governorate'],
    ['kom-abu-radi', 'المنطقة الصناعية بكوم أبو راضي', 'Kom Abu Radi Industrial Zone', 'governorate'],
    ['zone-31-1', 'المنطقة الصناعية 31/1', 'Industrial Zone 31/1', 'governorate'],
    ['zone-31-2', 'المنطقة الصناعية 31/2', 'Industrial Zone 31/2', 'governorate'],
    ['zone-31-3', 'المنطقة الصناعية 31/3', 'Industrial Zone 31/3', 'governorate'],
    ['zone-31-4', 'المنطقة الصناعية 31/4', 'Industrial Zone 31/4', 'governorate'],
    ['samasta-investment', 'المنطقة الاستثمارية بمركز سمسطا', 'Samasta Investment Zone', 'governorate'],
    ['new-beni-suef', 'المنطقة الصناعية بمدينة بني سويف الجديدة', 'New Beni Suef City Industrial Zone', 'nuca'],
    ['new-fashn', 'المنطقة الصناعية بالفشن الجديدة', 'New El Fashn Industrial Zone', 'nuca'],
    ['gabal-ghorab', 'جبل غراب (صناعات ثقيلة)', 'Gabal Ghorab (heavy industries)', 'ida'],
    ['bayad-el-arab-ext', 'توسعات المنطقة الصناعية ببياض العرب (المجمع الصناعي / المراحل الأخرى)', 'Bayad El Arab Industrial Zone extensions', 'ida'],
    ['kom-abu-radi-ext-50', 'توسعات 50 فدان بالمنطقة الصناعية بكوم أبو راضي', 'Kom Abu Radi 50-feddan extension', 'ida'],
    ['kom-abu-radi-ext-370', 'توسعات 370.48 فدان بالمنطقة الصناعية بكوم أبو راضي', 'Kom Abu Radi 370.48-feddan extension', 'ida'],
  ],
  minya: [
    ['matahra', 'المنطقة الصناعية بالمطاهرة شرق النيل (المجمع الصناعي / المنطقة الصناعية)', 'El Matahra East Nile Industrial Zone', 'governorate'],
    ['new-minya', 'المنطقة الصناعية بالمنيا الجديدة', 'New Minya Industrial Zone', 'nuca'],
    ['new-mallawi', 'المنطقة الصناعية بملوي الجديدة', 'New Mallawi Industrial Zone', 'nuca'],
    ['wadi-sereirya', 'وادي سريرية (صناعات ثقيلة)', 'Wadi Sereirya (heavy industries)', 'ida'],
    ['matahra-ext', 'توسعات المنطقة الصناعية بالمطاهرة', 'El Matahra Industrial Zone extensions', 'ida'],
  ],
  asyut: [
    ['arab-awamer-abnoub', 'المنطقة الصناعية بعرب العوامر - أبنوب (المجمع الصناعي / المنطقة الصناعية)', 'Arab El Awamer Industrial Zone, Abnoub', 'governorate'],
    ['zarabi-abu-tig', 'المنطقة الصناعية بالزرابي - أبوتيج (المنطقة الأولى / الامتداد)', 'El Zarabi Industrial Zone, Abu Tig', 'governorate'],
    ['safa-bani-ghaleb', 'المنطقة الصناعية بالصفا (بني غالب)', 'El Safa Industrial Zone (Bani Ghaleb)', 'governorate'],
    ['dashlout-dairut', 'المنطقة الصناعية بدشلوط - ديروط', 'Dashlout Industrial Zone, Dairut', 'governorate'],
    ['badari-kom-ahmar', 'المنطقة الصناعية بالبداري (الكوم الأحمر)', 'El Badari Industrial Zone (El Kom El Ahmar)', 'governorate'],
    ['new-asyut', 'المنطقة الصناعية بأسيوط الجديدة', 'New Asyut Industrial Zone', 'nuca'],
    ['asyut-plateau-nasser', 'المنطقة الصناعية بمدينة هضبة أسيوط (ناصر)', 'Asyut Plateau (Nasser) City Industrial Zone', 'nuca'],
    ['zarabi-wadi-sarga', 'المنطقة الصناعية بالزرابي بجبل وادي سرجة', 'El Zarabi Industrial Zone, Gabal Wadi Sarga', 'moi'],
  ],
  sohag: [
    ['kawthar', 'المنطقة الصناعية بحي الكوثر', 'El Kawthar District Industrial Zone', 'ida'],
    ['ahaywa-akhmim', 'المنطقة الصناعية بالأحايوة - مركز أخميم', 'El Ahaywa Industrial Zone, Akhmim', 'ida'],
    ['beit-dawood-west-girga', 'المنطقة الصناعية ببيت داود - غرب جرجا (المرحلة الأولى والتوسعات والمجمع الصناعي)', 'Beit Dawood Industrial Zone, West Girga', 'ida'],
    ['west-tahta', 'المنطقة الصناعية غرب طهطا (المراحل الأولى والثانية والثالثة)', 'West Tahta Industrial Zone (phases 1–3)', 'ida'],
    ['new-sohag', 'المنطقة الصناعية بسوهاج الجديدة', 'New Sohag Industrial Zone', 'nuca'],
    ['new-akhmim', 'المنطقة الصناعية بأخميم الجديدة', 'New Akhmim Industrial Zone', 'nuca'],
    ['mataheer', 'المنطقة الصناعية الاستثمارية بالمطاهير', 'El Mataheer Investment Industrial Zone', 'ncdc'],
    ['west-tahta-juhayna-1', 'المنطقة الصناعية بجهة غرب مدينتي طهطا وجهينة (القطعة الأولى)', 'West Tahta & Juhayna Industrial Zone (plot 1)', 'ida'],
    ['west-tahta-juhayna-2', 'المنطقة الصناعية بجهة غرب مدينتي طهطا وجهينة (القطعة الثانية)', 'West Tahta & Juhayna Industrial Zone (plot 2)', 'ida'],
  ],
  qena: [
    ['kalaheen-qift', 'المنطقة الصناعية بالكلاحين - مركز قفط', 'El Kalaheen Industrial Zone, Qift', 'ida'],
    ['hu-nag-hammadi', 'المنطقة الصناعية بناحية هو - مركز نجع حمادي (المجمع الصناعي / المنطقة القائمة / التوسعات)', 'Hu Industrial Zone, Nag Hammadi', 'ida'],
    ['qift-free-zone', 'المنطقة الحرة العامة بقفط', 'Qift Public Free Zone', 'gafi'],
    ['new-qena', 'المنطقة الصناعية والحرفية بمدينة قنا الجديدة', 'New Qena City Industrial & Crafts Zone', 'nuca'],
    ['new-west-qena', 'المنطقة الصناعية بمدينة غرب قنا الجديدة', 'New West Qena City Industrial Zone', 'nuca'],
    ['gabal-el-geer', 'المنطقة الاستثمارية بجبل الجير', 'Gabal El Geer Investment Zone', 'ncdc'],
  ],
  luxor: [
    ['baghdadi', 'المنطقة الصناعية بالبغدادي (المراحل الأولى والثانية والثالثة)', 'El Baghdadi Industrial Zone (phases 1–3)', 'governorate'],
    ['new-tiba', 'مدينة طيبة الجديدة', 'New Tiba City', 'nuca'],
    ['armant', 'المنطقة الصناعية بأرمنت', 'Armant Industrial Zone', 'ida'],
  ],
  aswan: [
    ['shallalat', 'المنطقة الصناعية بالشلالات - طريق وادي العلاقي', 'El Shallalat Industrial Zone (Wadi El Allaqi road)', 'governorate'],
    ['wadi-helal-sebaiya', 'المنطقة الصناعية بوادي هلال السباعية', 'Wadi Helal El Sebaiya Industrial Zone', 'governorate'],
    ['new-aswan', 'المنطقة الصناعية بأسوان الجديدة', 'New Aswan Industrial Zone', 'nuca'],
    ['new-toshka', 'المنطقة الصناعية بمدينة توشكى الجديدة', 'New Toshka City Industrial Zone', 'nuca'],
    ['allaqi-1', 'العلاقي (1) - صناعات ثقيلة', 'El Allaqi (1) – heavy industries', 'ida'],
    ['allaqi-2', 'العلاقي (2) - صناعات ثقيلة', 'El Allaqi (2) – heavy industries', 'ida'],
    ['nasr-nuba-genina', 'المنطقة الصناعية / الحرفية بمركز نصر النوبة شرق الجنينة (مجمع صناعي)', 'Nasr El Nuba Industrial & Crafts Zone, East El Genina', 'ida'],
  ],
  'red-sea': [
    ['berenice-1', 'برنيس (1) - صناعات ثقيلة', 'Berenice (1) – heavy industries', 'ida'],
    ['berenice-2', 'برنيس (2) - صناعات ثقيلة', 'Berenice (2) – heavy industries', 'ida'],
    ['safaga-qena-road', 'المنطقة الصناعية بطريق سفاجا - قنا', 'Safaga–Qena Road Industrial Zone', 'ida'],
  ],
  'new-valley': [
    ['kharga', 'المنطقة الصناعية بالخارجة', 'El Kharga Industrial Zone', 'governorate'],
    ['dakhla-mut', 'المنطقة الصناعية بالداخلة (موط)', 'El Dakhla (Mut) Industrial Zone', 'governorate'],
    ['west-wadi-waer', 'غرب وادي واعر (صناعات ثقيلة)', 'West Wadi Waer (heavy industries)', 'moi'],
  ],
  matrouh: [
    ['south-fuka-dabaa', 'المنطقة الصناعية بجهة جنوب فوكة - مركز الضبعة', 'South Fuka Industrial Zone, El Dabaa', 'governorate'],
    ['new-alamein', 'المنطقة الصناعية بالعلمين الجديدة', 'New Alamein Industrial Zone', 'nuca'],
    ['south-ras-el-hekma', 'المنطقة الصناعية بناحية جنوب مدينة رأس الحكمة', 'South Ras El Hekma Industrial Zone', 'ida'],
  ],
};

/** القائمة المسطحة بترتيب العرض (ترتيب الدليل داخل كل محافظة). */
export const INDUSTRIAL_ZONES: readonly ZoneSeed[] = Object.entries(BY_GOVERNORATE)
  .flatMap(([governorate, rows]) => rows.map(([value, labelAr, labelEn, authority]) => ({ governorate, value, labelAr, labelEn, authority })));

export const INDUSTRIAL_ZONES_SOURCE = { url: 'https://www.ida.gov.eg/ar/industrial-areas', retrievedAt: '2026-11-06' } as const;
