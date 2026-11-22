/**
 * The signed-in person: the initiative chooser (hub), the shared profile (person, factories, reusable documents), the
 * "apply to an initiative" step that shows only the missing data, and the unified notifications.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, FileUp, Plus, Download, LayoutDashboard, ShieldCheck, Building2, UserRound } from 'lucide-react';
import { api, errText, fieldErrors, type Governorate, type ProfileDoc, type ProfileField, type ProfileMeta, type Requirements } from '../api';
import { usePlatform, store } from '../store';
import { Alert, Loading } from '../layout';
import { issueText } from './auth';

// ── profile field input (driven by the platform's field catalog) ──────────

let metaCache: Promise<ProfileMeta> | null = null;
export function useProfileMeta(): ProfileMeta | null {
  const [m, setM] = useState<ProfileMeta | null>(null);
  useEffect(() => { metaCache ??= api.profileMeta(); metaCache.then(setM).catch(() => { metaCache = null; }); }, []);
  return m;
}

const RoofTable: React.FC<{ value: unknown; onChange: (v: unknown) => void }> = ({ value, onChange }) => {
  const { t } = usePlatform();
  const rows = Array.isArray(value) ? (value as Array<{ name: string; area: number | string }>) : [];
  const set = (i: number, k: 'name' | 'area', v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="pf-gap" style={{ gap: 8 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 140px auto', gap: 8 }}>
          <input placeholder={t('اسم السطح', 'Roof name')} value={r.name ?? ''} onChange={(e) => set(i, 'name', e.target.value)} />
          <input placeholder={t('المساحة م²', 'Area m²')} value={r.area ?? ''} onChange={(e) => set(i, 'area', e.target.value)} dir="ltr" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="btn btn-outline btn-sm" onClick={() => onChange([...rows, { name: '', area: '' }])}><Plus size={14} /> {t('إضافة سطح', 'Add a roof')}</button>
    </div>
  );
};

export const ProfileInput: React.FC<{ f: ProfileField; value: unknown; values: Record<string, unknown>; onChange: (v: unknown) => void; governorates: Governorate[]; disabled?: boolean }> = ({ f, value, values, onChange, governorates, disabled }) => {
  const { isAr, t } = usePlatform();
  const v = value === null || value === undefined ? '' : value;
  if (f.type === 'roofTable') return <RoofTable value={v} onChange={onChange} />;
  if (f.type === 'select') {
    let opts: Array<{ value: string; labelAr: string; labelEn: string }> = [];
    if (f.options === 'governorates') opts = governorates;
    else if (f.options === 'zones') opts = governorates.find((g) => g.value === values[f.dependsOn ?? ''])?.zones ?? [];
    else if (Array.isArray(f.options)) opts = f.options;
    return (
      <select value={String(v)} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">{t('— اختر —', '— choose —')}</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{isAr ? o.labelAr : o.labelEn}</option>)}
      </select>
    );
  }
  if (f.type === 'textarea') return <textarea value={String(v)} maxLength={f.max} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
  const type = f.type === 'date' || f.type === 'futureDate' ? 'date' : f.type === 'email' ? 'email' : f.type === 'number' || f.type === 'integer' ? 'number' : 'text';
  const ltr = ['phone', 'email', 'url', 'nationalId', 'number', 'integer', 'registryNumber', 'date', 'futureDate'].includes(f.type);
  return <input type={type} dir={ltr ? 'ltr' : undefined} value={String(v)} maxLength={f.max} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
};

function cleanForSave(fields: ProfileField[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (!(f.key in values)) continue;
    let v = values[f.key];
    if (f.type === 'roofTable' && Array.isArray(v)) v = (v as Array<{ name: string; area: unknown }>).filter((r) => r.name || r.area).map((r) => ({ name: r.name, area: Number(r.area) }));
    if ((f.type === 'number' || f.type === 'integer') && v !== '' && v !== null) v = Number(v);
    out[f.key] = v === '' ? null : v;
  }
  return out;
}

const FieldsForm: React.FC<{ fields: ProfileField[]; values: Record<string, unknown>; onChange: (k: string, v: unknown) => void; errors: Record<string, string>; missing?: Set<string>; required?: Set<string>; locked?: Set<string> }> = ({ fields, values, onChange, errors, missing, required, locked }) => {
  const { isAr } = usePlatform();
  const meta = useProfileMeta();
  return (
    <div className="pf-row">
      {fields.map((f) => (
        <div key={f.key} className={`pf-field${missing?.has(f.key) ? ' missing' : ''}`} style={f.type === 'textarea' || f.type === 'roofTable' ? { gridColumn: '1 / -1' } : undefined}>
          <label>{isAr ? f.labelAr : f.labelEn}{required?.has(f.key) ? <span className="req"> *</span> : null}</label>
          <ProfileInput f={f} value={values[f.key]} values={values} governorates={meta?.governorates ?? []} onChange={(v) => onChange(f.key, v)} disabled={locked?.has(f.key)} />
          {f.hintAr ? <div className="hint">{isAr ? f.hintAr : f.hintEn}</div> : null}
          {errors[f.key] ? <div className="err">{issueText(errors[f.key], isAr)}</div> : null}
        </div>
      ))}
    </div>
  );
};

const DocRow: React.FC<{ kind: string; label: string; doc: ProfileDoc | null; ownerId?: string; required?: boolean; onUploaded: () => void }> = ({ kind, label, doc, ownerId, required, onUploaded }) => {
  const { t, isAr } = usePlatform();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setErr('');
    try { await api.uploadDocument(kind, file, ownerId); onUploaded(); } catch (e) { setErr(errText(e, isAr)); } finally { setBusy(false); }
  };
  const open = async () => { if (doc) window.open(URL.createObjectURL(await api.downloadDocument(doc.id)), '_blank'); };
  return (
    <div className={`pf-doc ${doc ? 'ok' : required ? 'missing' : ''}`}>
      <div>
        <b>{label}</b>{required ? <span style={{ color: '#C8102E' }}> *</span> : null}
        <div className="pf-muted" style={{ fontSize: 12.5 }}>{doc ? `${doc.originalName} · v${doc.version}` : t('لم يُرفع بعد (PDF)', 'Not uploaded yet (PDF)')}</div>
        {err ? <div style={{ color: '#B91C1C', fontSize: 12.5 }}>{err}</div> : null}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {doc ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => void open()}><Download size={14} /></button> : null}
        <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
          <FileUp size={14} /> {busy ? t('جارٍ الرفع…', 'Uploading…') : doc ? t('استبدال', 'Replace') : t('رفع', 'Upload')}
          <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
      </div>
    </div>
  );
};

// ── hub (initiative chooser) ────────────────────────────────────────────

const TONE: Record<string, string> = { success: 'ok', warning: 'warn', danger: 'bad', info: 'info', neutral: '' };

export const HubPage: React.FC = () => {
  const { t, isAr, me } = usePlatform();
  useEffect(() => { void store.reloadMe(); }, []);
  if (!me) return <Loading />;
  const ms = me.memberships;
  return (
    <div className="pf-container pf-page pf-gap">
      <div className="pf-section-head">
        <div><h2>{t('مبادراتي', 'My initiatives')}</h2><p>{t('اختر المبادرة التي تريد الدخول على لوحتها.', 'Choose the initiative whose dashboard you want to open.')}</p></div>
        <a className="btn btn-outline" href="#initiatives"><Plus size={16} /> {t('التقديم على مبادرة أخرى', 'Apply to another initiative')}</a>
      </div>
      {me.user.platformRole ? (
        <div className="pf-box" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div><b><ShieldCheck size={18} style={{ verticalAlign: 'middle' }} /> {isAr ? me.platformRoleLabel?.ar : me.platformRoleLabel?.en}</b><div className="pf-muted">{t('لوحة الإدارة الموحدة لكل المبادرات', 'The unified administration of every initiative')}</div></div>
          <a className="btn btn-primary" href="#admin">{t('لوحة الإدارة', 'Administration')}</a>
        </div>
      ) : null}
      {ms.length === 0 && !me.adminEntries.length ? (
        <div className="pf-box pf-empty">
          <p>{t('لم تقدّم على أي مبادرة بعد.', 'You have not applied to any initiative yet.')}</p>
          <a className="btn btn-primary" href="#initiatives" style={{ marginTop: 12 }}>{t('تصفح المبادرات', 'Browse initiatives')}</a>
        </div>
      ) : (
        <div className="pf-hub-grid">
          {ms.map((m) => (
            <div key={m.initiativeId} className="pf-hub-card">
              <div className="pf-hub-head" style={{ background: `linear-gradient(135deg, ${m.themeColor}, ${m.accentColor})` }}>
                <div style={{ fontSize: 12.5, opacity: 0.9 }}>{isAr ? m.roleLabelAr : m.roleLabelEn}</div>
                <h3>{isAr ? m.titleAr : m.titleEn}</h3>
              </div>
              <div className="pf-hub-body">
                {m.status !== 'active' ? <Alert tone="err">{t('عضويتك في هذه المبادرة موقوفة.', 'Your membership in this initiative is suspended.')}</Alert> : null}
                {m.card ? (
                  <>
                    <div><span className={`pf-chip ${TONE[m.card.tone ?? ''] ?? ''}`}>{isAr ? m.card.statusAr : m.card.statusEn}</span>{m.card.applicationNumber ? <span className="pf-muted" style={{ marginInlineStart: 8, fontSize: 13 }}>{m.card.applicationNumber}</span> : null}</div>
                    {m.card.nextActionAr ? <div className="pf-card-text">{t('المطلوب الآن', 'Next step')}: <b>{isAr ? m.card.nextActionAr : m.card.nextActionEn}</b></div> : null}
                  </>
                ) : null}
                {m.access.status !== 'full' && m.access.messageAr ? <Alert tone={m.access.status === 'blocked' ? 'warn' : 'info'}>{isAr ? m.access.messageAr : m.access.messageEn}</Alert> : null}
                {m.unread ? <div className="pf-muted" style={{ fontSize: 13 }}>{t(`${m.unread} إشعار غير مقروء`, `${m.unread} unread notification(s)`)}</div> : null}
                <div style={{ marginTop: 'auto' }}>
                  {m.status === 'active' ? <a className="btn btn-primary" href={`#i/${m.initiativeId}/${m.card?.view ?? m.defaultView}`}><LayoutDashboard size={16} /> {t('ادخل لوحة المبادرة', 'Open the dashboard')}</a> : null}
                </div>
              </div>
            </div>
          ))}
          {me.adminEntries.map((a) => (
            <div key={a.initiativeId} className="pf-hub-card">
              <div className="pf-hub-head" style={{ background: '#334155' }}><div style={{ fontSize: 12.5, opacity: 0.9 }}>{t('مدير المنصة', 'Platform administrator')}</div><h3>{isAr ? a.titleAr : a.titleEn}</h3></div>
              <div className="pf-hub-body"><a className="btn btn-outline" href={`#i/${a.initiativeId}/${a.defaultView}`}>{t('إدارة المبادرة', 'Manage the initiative')}</a></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── profile ────────────────────────────────────────────────────────────

export const ProfilePage: React.FC = () => {
  const { t, isAr, query } = usePlatform();
  const meta = useProfileMeta();
  const [tab, setTab] = useState<'person' | 'factories'>(query.get('tab') === 'factories' ? 'factories' : 'person');
  const [person, setPerson] = useState<{ values: Record<string, unknown>; documents: ProfileDoc[]; email: string } | null>(null);
  const [factories, setFactories] = useState<Array<{ id: string; role: string; values: Record<string, unknown>; documents: ProfileDoc[] }> | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    const [p, f] = await Promise.all([api.profile(), api.factories()]);
    setPerson(p); setFactories(f);
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!meta || !person || !factories) return <Loading />;
  const personFields = meta.fields.filter((f) => f.scope === 'person');
  const factoryFields = meta.fields.filter((f) => f.scope === 'factory');
  const savePerson = async () => {
    setErrors({}); setMsg(null);
    try { await api.saveProfile(cleanForSave(personFields, { ...person.values, ...draft })); setDraft({}); await load(); setMsg({ ok: true, text: t('تم حفظ بياناتك.', 'Your data was saved.') }); }
    catch (e) { setErrors(fieldErrors(e)); setMsg({ ok: false, text: errText(e, isAr) }); }
  };
  const saveFactory = async () => {
    setErrors({}); setMsg(null);
    try {
      const base = editing && editing !== 'new' ? factories.find((x) => x.id === editing)?.values ?? {} : {};
      const vals = cleanForSave(factoryFields, { ...base, ...draft });
      if (editing === 'new') await api.createFactory(vals); else if (editing) await api.saveFactory(editing, vals);
      setDraft({}); setEditing(null); await load(); setMsg({ ok: true, text: t('تم حفظ بيانات المنشأة.', 'Facility data saved.') });
    } catch (e) { setErrors(fieldErrors(e)); setMsg({ ok: false, text: errText(e, isAr) }); }
  };
  const lockedPerson = new Set(person.values['person.nationalId'] ? ['person.nationalId'] : []);
  return (
    <div className="pf-container pf-page">
      <div className="pf-section-head"><div><h2>{t('بياناتي', 'My data')}</h2><p>{t('تُستخدم في كل المبادرات — أدخلها مرة واحدة.', 'Used by every initiative — enter it once.')}</p></div></div>
      <div className="pf-tabs">
        <button type="button" className={tab === 'person' ? 'active' : ''} onClick={() => setTab('person')}><UserRound size={15} /> {t('البيانات الشخصية', 'Personal data')}</button>
        <button type="button" className={tab === 'factories' ? 'active' : ''} onClick={() => setTab('factories')}><Building2 size={15} /> {t('منشآتي', 'My facilities')} ({factories.length})</button>
      </div>
      {msg ? <div style={{ marginBottom: 14 }}><Alert tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Alert></div> : null}
      {tab === 'person' ? (
        <div className="pf-gap">
          <div className="pf-box">
            <h3>{t('البيانات الشخصية', 'Personal data')}</h3>
            <p className="pf-muted" style={{ marginBottom: 12 }}>{t('البريد الإلكتروني للحساب', 'Account e-mail')}: <b dir="ltr">{person.email}</b></p>
            <FieldsForm fields={personFields} values={{ ...person.values, ...draft }} onChange={(k, v) => setDraft({ ...draft, [k]: v })} errors={errors} locked={lockedPerson} />
            <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => void savePerson()}>{t('حفظ', 'Save')}</button>
          </div>
          <div className="pf-box pf-gap" style={{ gap: 10 }}>
            <h3>{t('مستنداتي الشخصية', 'My personal documents')}</h3>
            {meta.documentKinds.filter((d) => d.scope === 'person').map((d) => <DocRow key={d.kind} kind={d.kind} label={isAr ? d.labelAr : d.labelEn} doc={person.documents.find((x) => x.kind === d.kind) ?? null} onUploaded={() => void load()} />)}
          </div>
        </div>
      ) : (
        <div className="pf-gap">
          {factories.map((f) => (
            <div key={f.id} className="pf-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <h3>{String(f.values['factory.companyName'] ?? '')}</h3>
                {f.role === 'owner' && editing !== f.id ? <button type="button" className="btn btn-outline btn-sm" onClick={() => { setEditing(f.id); setDraft({}); }}>{t('تعديل', 'Edit')}</button> : null}
              </div>
              {editing === f.id ? (
                <>
                  <FieldsForm fields={factoryFields} values={{ ...f.values, ...draft }} onChange={(k, v) => setDraft({ ...draft, [k]: v })} errors={errors} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button type="button" className="btn btn-primary" onClick={() => void saveFactory()}>{t('حفظ', 'Save')}</button>
                    <button type="button" className="btn btn-ghost" onClick={() => { setEditing(null); setDraft({}); }}>{t('إلغاء', 'Cancel')}</button>
                  </div>
                </>
              ) : (
                <p className="pf-muted">{[f.values['factory.industrialRegistryNumber'], f.values['factory.governorate'], f.values['factory.address']].filter(Boolean).join(' · ')}</p>
              )}
              <div className="pf-gap" style={{ gap: 10, marginTop: 12 }}>
                {meta.documentKinds.filter((d) => d.scope === 'factory').map((d) => <DocRow key={d.kind} kind={d.kind} label={isAr ? d.labelAr : d.labelEn} ownerId={f.id} doc={f.documents.find((x) => x.kind === d.kind) ?? null} onUploaded={() => void load()} />)}
              </div>
            </div>
          ))}
          {editing === 'new' ? (
            <div className="pf-box">
              <h3>{t('منشأة جديدة', 'New facility')}</h3>
              <FieldsForm fields={factoryFields} values={draft} onChange={(k, v) => setDraft({ ...draft, [k]: v })} errors={errors} required={new Set(['factory.companyName'])} />
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="button" className="btn btn-primary" onClick={() => void saveFactory()}>{t('إضافة', 'Add')}</button>
                <button type="button" className="btn btn-ghost" onClick={() => { setEditing(null); setDraft({}); }}>{t('إلغاء', 'Cancel')}</button>
              </div>
            </div>
          ) : <button type="button" className="btn btn-outline" onClick={() => { setEditing('new'); setDraft({}); }}><Plus size={16} /> {t('إضافة منشأة', 'Add a facility')}</button>}
        </div>
      )}
    </div>
  );
};

// ── apply: only the missing data, then enroll ───────────────────────────

export const ApplyPage: React.FC = () => {
  const { t, isAr, param, query } = usePlatform();
  const slug = param ?? '';
  const [factoryId, setFactoryId] = useState<string | null>(query.get('factory'));
  const [req, setReq] = useState<Requirements | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newFactory, setNewFactory] = useState(false);
  const load = useCallback(async (fid = factoryId) => { const r = await api.requirements(slug, fid); setReq(r); if (r.selectedFactoryId && r.selectedFactoryId !== fid) setFactoryId(r.selectedFactoryId); }, [slug, factoryId]);
  useEffect(() => { void load().catch((e) => setMsg({ ok: false, text: errText(e, isAr) })); }, [load, isAr]);
  const missingKeys = useMemo(() => new Set((req?.missing ?? []).map((m) => m.key)), [req]);
  if (!req) return msg ? <div className="pf-container pf-page"><Alert tone="err">{msg.text}</Alert></div> : <Loading />;
  const title = isAr ? req.titleAr : req.titleEn;
  if (req.enrolled) {
    return (
      <div className="pf-container pf-page"><div className="pf-box pf-auth" style={{ maxWidth: 560 }}>
        <Alert tone="ok">{t(`أنت مسجل في «${title}».`, `You are enrolled in "${title}".`)}</Alert>
        <a className="btn btn-primary" style={{ marginTop: 14 }} href={`#i/${req.initiativeId}/${req.defaultView ?? ''}`}>{t('ادخل لوحة المبادرة', 'Open the dashboard')}</a>
      </div></div>
    );
  }
  const missingPerson = req.missing.filter((m) => m.scope === 'person');
  const missingFactory = req.missing.filter((m) => m.scope === 'factory');
  const filled = req.fields.filter((f) => f.filled);
  const save = async () => {
    setBusy(true); setErrors({}); setMsg(null);
    try {
      const pv = cleanForSave(missingPerson, draft);
      if (Object.keys(pv).length) await api.saveProfile(pv);
      const fv = cleanForSave(req.fields.filter((f) => f.scope === 'factory'), draft);
      if (req.subject === 'factory' && Object.keys(fv).length) {
        if (newFactory || !factoryId) { const c = await api.createFactory(fv); setFactoryId(c.id); setNewFactory(false); await load(c.id); }
        else { await api.saveFactory(factoryId, fv); await load(factoryId); }
      } else await load();
      setDraft({});
      setMsg({ ok: true, text: t('تم حفظ البيانات في ملفك — تُستخدم في كل المبادرات.', 'Saved to your profile — reused by every initiative.') });
    } catch (e) { setErrors(fieldErrors(e)); setMsg({ ok: false, text: errText(e, isAr) }); } finally { setBusy(false); }
  };
  const enroll = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.enroll(slug, req.selectedFactoryId);
      await store.reloadMe();
      store.go(`i/${r.initiativeId}/${r.view}`);
    } catch (e) { setMsg({ ok: false, text: errText(e, isAr) }); await load(); } finally { setBusy(false); }
  };
  const showFactoryForm = req.subject === 'factory' && (newFactory || !req.factoryOptions.length);
  const factoryFormFields = showFactoryForm ? req.fields.filter((f) => f.scope === 'factory') : missingFactory;
  const total = req.fields.filter((f) => f.required).length + req.documents.filter((d) => d.required).length;
  const done = req.fields.filter((f) => f.required && f.filled).length + req.documents.filter((d) => d.required && d.filled).length;
  return (
    <div className="pf-container pf-page pf-gap">
      <div className="pf-section-head">
        <div><h2>{t(`التقديم على «${title}»`, `Applying to "${title}"`)}</h2>
          <p>{t('استخدمنا بياناتك المسجلة على المنصة — المطلوب منك فقط استكمال ما ينقص متطلبات هذه المبادرة.', 'We used your platform data — you only complete what this initiative still needs.')}</p></div>
        <span className={`pf-chip ${req.complete ? 'ok' : 'warn'}`}>{req.complete ? t('البيانات مكتملة', 'Data complete') : t(`مكتمل ${done} من ${total}`, `${done} of ${total} complete`)}</span>
      </div>
      {req.blockers.map((b) => <Alert key={b.code} tone="err">{isAr ? b.messageAr : b.messageEn}</Alert>)}
      {msg ? <Alert tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Alert> : null}

      {req.subject === 'factory' ? (
        <div className="pf-box">
          <h3><Building2 size={18} style={{ verticalAlign: 'middle' }} /> {t('المنشأة المتقدمة', 'The applying facility')}</h3>
          {req.factoryOptions.length ? (
            <div className="pf-row">
              <div className="pf-field">
                <label>{t('اختر منشأة من منشآتك', 'Choose one of your facilities')}</label>
                <select value={newFactory ? '__new' : (req.selectedFactoryId ?? '')} onChange={(e) => {
                  if (e.target.value === '__new') { setNewFactory(true); setDraft({}); } else { setNewFactory(false); setFactoryId(e.target.value || null); setDraft({}); void load(e.target.value || null); }
                }}>
                  <option value="">{t('— اختر —', '— choose —')}</option>
                  {req.factoryOptions.map((f) => <option key={f.id} value={f.id}>{f.companyName}</option>)}
                  <option value="__new">{t('+ منشأة جديدة', '+ A new facility')}</option>
                </select>
              </div>
            </div>
          ) : <p className="pf-muted">{t('لا توجد منشأة في ملفك بعد — أدخل بياناتها مرة واحدة هنا.', 'No facility in your profile yet — enter its data once here.')}</p>}
        </div>
      ) : null}

      {(missingPerson.length || factoryFormFields.length) ? (
        <div className="pf-box">
          <h3><CircleAlert size={18} style={{ verticalAlign: 'middle', color: '#B45309' }} /> {t('البيانات الناقصة', 'Missing data')}</h3>
          {missingPerson.length ? <>
            <p className="pf-muted" style={{ margin: '4px 0 10px' }}>{t('بياناتك الشخصية', 'Your personal data')}</p>
            <FieldsForm fields={missingPerson} values={draft} onChange={(k, v) => setDraft({ ...draft, [k]: v })} errors={errors} missing={missingKeys} required={missingKeys} />
          </> : null}
          {factoryFormFields.length && (req.selectedFactoryId || showFactoryForm) ? <>
            <p className="pf-muted" style={{ margin: '14px 0 10px' }}>{t('بيانات المنشأة', 'Facility data')}</p>
            <FieldsForm fields={factoryFormFields} values={draft} onChange={(k, v) => setDraft({ ...draft, [k]: v })} errors={errors} missing={missingKeys}
              required={new Set(req.fields.filter((f) => f.required && f.scope === 'factory').map((f) => f.key))} />
          </> : null}
          <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} disabled={busy} onClick={() => void save()}>{busy ? t('جارٍ الحفظ…', 'Saving…') : t('حفظ البيانات', 'Save the data')}</button>
        </div>
      ) : null}

      {req.documents.length ? (
        <div className="pf-box pf-gap" style={{ gap: 10 }}>
          <h3><FileUp size={18} style={{ verticalAlign: 'middle' }} /> {t('المستندات', 'Documents')}</h3>
          {req.subject === 'factory' && !req.selectedFactoryId ? <p className="pf-muted">{t('اختر المنشأة أو احفظ بياناتها أولًا لرفع مستنداتها.', 'Choose or save the facility first to upload its documents.')}</p>
            : req.documents.map((d) => <DocRow key={d.kind} kind={d.kind} label={isAr ? d.labelAr : d.labelEn} doc={d.document} required={d.required}
              ownerId={d.scope === 'factory' ? req.selectedFactoryId ?? undefined : undefined} onUploaded={() => void load()} />)}
        </div>
      ) : null}

      {filled.length ? (
        <details className="pf-box">
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}><CheckCircle2 size={16} style={{ verticalAlign: 'middle', color: '#047857' }} /> {t(`بيانات موجودة في ملفك وستُستخدم (${filled.length})`, `Data already in your profile that will be used (${filled.length})`)}</summary>
          <table className="pf-table" style={{ marginTop: 10 }}><tbody>
            {filled.map((f) => <tr key={f.key}><th style={{ width: '40%' }}>{isAr ? f.labelAr : f.labelEn}</th><td>{Array.isArray(f.value) ? `${(f.value as unknown[]).length} ${t('بند', 'item(s)')}` : String(f.value)}</td></tr>)}
          </tbody></table>
          <a href="#profile" style={{ fontSize: 13 }}>{t('تعديل من صفحة «بياناتي»', 'Edit from "My data"')}</a>
        </details>
      ) : null}

      <div className="pf-box" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <b>{t('الخطوة التالية', 'Next step')}</b>
          <div className="pf-muted">{(isAr ? req.moduleStepsAr : req.moduleStepsEn)[0] ?? t('استكمال نموذج المبادرة', 'Complete the initiative form')}</div>
        </div>
        <button type="button" className="btn btn-primary btn-lg" disabled={!req.complete || busy} onClick={() => void enroll()}>{t('فتح ملف التقديم والمتابعة', 'Open my application and continue')}</button>
      </div>
    </div>
  );
};

// ── notifications ───────────────────────────────────────────────────────

export const NotificationsPage: React.FC = () => {
  const { t, isAr } = usePlatform();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.notifications>> | null>(null);
  const [page, setPage] = useState(1);
  const load = useCallback(() => api.notifications(page).then(setD).catch(() => undefined), [page]);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <Loading />;
  const open = async (n: (typeof d.items)[number]) => { if (!n.readAt) await api.markRead(n.id).catch(() => undefined); void store.reloadMe(); if (n.link) store.go(n.link); else void load(); };
  return (
    <div className="pf-container pf-page pf-gap">
      <div className="pf-section-head">
        <div><h2>{t('الإشعارات', 'Notifications')}</h2><p>{t('إشعارات كل مبادراتك في مكان واحد.', 'Notifications of all your initiatives in one place.')}</p></div>
        {d.unread ? <button type="button" className="btn btn-outline" onClick={() => void api.markAllRead().then(load).then(() => store.reloadMe())}>{t('تعليم الكل كمقروء', 'Mark all as read')}</button> : null}
      </div>
      {d.items.length ? (
        <div className="pf-gap" style={{ gap: 10 }}>
          {d.items.map((n) => (
            <button key={n.id} type="button" className="pf-box" onClick={() => void open(n)} style={{ textAlign: 'start', cursor: 'pointer', borderInlineStart: n.readAt ? undefined : '4px solid #C8102E' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <b>{n.title}</b><span className="pf-muted" style={{ fontSize: 12 }}>{new Date(n.createdAt).toLocaleString(isAr ? 'ar-EG' : 'en-GB')}</span>
              </div>
              <div className="pf-card-text">{n.body}</div>
              {n.initiativeId ? <span className="pf-chip" style={{ marginTop: 6 }}>{n.initiativeId === 'shams' ? t('شمس الصناعة', 'Shams El-Senaa') : n.initiativeId === 'sona3' ? t('صُنّاع المستقبل', 'Future Makers') : n.initiativeId}</span> : null}
            </button>
          ))}
          {d.totalPages > 1 ? <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('السابق', 'Previous')}</button>
            <button type="button" className="btn btn-ghost" disabled={page >= d.totalPages} onClick={() => setPage(page + 1)}>{t('التالي', 'Next')}</button>
          </div> : null}
        </div>
      ) : <div className="pf-box pf-empty">{t('لا توجد إشعارات.', 'No notifications.')}</div>}
    </div>
  );
};
