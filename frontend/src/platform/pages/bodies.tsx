/**
 * دليل الجهات — the platform's unified directory of participating bodies. One record per real body, linked to its
 * organization in each initiative it takes part in, with its activity across initiatives. Super admins manage it; the
 * ministry viewer and the auditor read it. A link grants nothing: people keep exactly their memberships.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building, Link2, Unlink, Plus, Sparkles } from 'lucide-react';
import { api, errText, type BodyOrganizations, type PlatformBody, type PlatformBodyDetail } from '../api';
import { usePlatform, canManage } from '../store';
import { Alert, Loading } from '../layout';

const num = (n: number | undefined, isAr: boolean) => (n ?? 0).toLocaleString(isAr ? 'ar-EG' : 'en-US');
const when = (iso: string | null | undefined, isAr: boolean) => (iso ? new Date(iso).toLocaleDateString(isAr ? 'ar-EG' : 'en-GB') : '—');

type Msg = { ok: boolean; text: string } | null;

const EMPTY_FORM = { nameAr: '', nameEn: '', kind: 'center', description: '', contactEmail: '', contactPhone: '', website: '' };

/** The fields of a body (create and edit share it). */
const BodyFields: React.FC<{ f: typeof EMPTY_FORM; set: (f: typeof EMPTY_FORM) => void; kinds: Array<{ key: string; labelAr: string; labelEn: string }>; idPrefix: string }> = ({ f, set, kinds, idPrefix }) => {
  const { t, isAr } = usePlatform();
  const field = (k: keyof typeof EMPTY_FORM, label: string, opts: { dir?: 'ltr'; wide?: boolean } = {}) => (
    <div className="pf-field" style={opts.wide ? { gridColumn: '1 / -1' } : undefined}>
      <label htmlFor={`${idPrefix}-${k}`}>{label}</label>
      {k === 'description'
        ? <textarea id={`${idPrefix}-${k}`} rows={2} value={f[k]} onChange={(e) => set({ ...f, [k]: e.target.value })} />
        : <input id={`${idPrefix}-${k}`} dir={opts.dir} value={f[k]} onChange={(e) => set({ ...f, [k]: e.target.value })} />}
    </div>
  );
  return (
    <div className="pf-form-grid">
      {field('nameAr', t('اسم الجهة (عربي) *', 'Name (Arabic) *'))}
      {field('nameEn', t('اسم الجهة (إنجليزي)', 'Name (English)'), { dir: 'ltr' })}
      <div className="pf-field">
        <label htmlFor={`${idPrefix}-kind`}>{t('نوع الجهة', 'Kind')}</label>
        <select id={`${idPrefix}-kind`} value={f.kind} onChange={(e) => set({ ...f, kind: e.target.value })}>{kinds.map((k) => <option key={k.key} value={k.key}>{isAr ? k.labelAr : k.labelEn}</option>)}</select>
      </div>
      {field('contactEmail', t('بريد التواصل', 'Contact e-mail'), { dir: 'ltr' })}
      {field('contactPhone', t('هاتف التواصل', 'Contact phone'), { dir: 'ltr' })}
      {field('website', t('الموقع الإلكتروني', 'Website'), { dir: 'ltr' })}
      {field('description', t('نبذة', 'About'), { wide: true })}
    </div>
  );
};

const ActivityCells: React.FC<{ a: { staff: number; decisions: number; pending: number; lastActivityAt: string | null } | null }> = ({ a }) => {
  const { isAr } = usePlatform();
  if (!a) return <><td>—</td><td>—</td><td>—</td><td>—</td></>;
  return (
    <>
      <td className="num">{num(a.staff, isAr)}</td>
      <td className="num">{num(a.decisions, isAr)}</td>
      <td className="num">{a.pending ? <span className="pf-chip warn">{num(a.pending, isAr)}</span> : num(0, isAr)}</td>
      <td className="pf-muted">{when(a.lastActivityAt, isAr)}</td>
    </>
  );
};

// ── the directory ─────────────────────────────────────────────────────────

export const AdminBodies: React.FC = () => {
  const { t, isAr, me } = usePlatform();
  const manage = canManage(me);
  const [filters, setFilters] = useState({ q: '', kind: '', initiativeId: '', status: '' });
  const [d, setD] = useState<Awaited<ReturnType<typeof api.adminBodies>> | null>(null);
  const [orgs, setOrgs] = useState<BodyOrganizations | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [newLinks, setNewLinks] = useState<Record<string, string>>({});
  const [linkTo, setLinkTo] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    api.adminBodies(filters).then(setD).catch((e) => setMsg({ ok: false, text: errText(e, isAr) }));
    api.adminBodyOrganizations().then(setOrgs).catch(() => undefined);
  }, [filters, isAr]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); after?.(); load(); } catch (e) { setMsg({ ok: false, text: errText(e, isAr) }); }
  };
  const unlinked = useMemo(() => (orgs?.items ?? []).filter((o) => !o.body), [orgs]);
  const allBodies = d?.items ?? [];

  return (
    <div className="pf-gap">
      <div className="pf-section-head">
        <div>
          <h2><Building size={20} style={{ verticalAlign: 'middle' }} /> {t('دليل الجهات', 'Directory of bodies')}</h2>
          <p className="pf-muted">{t('كل جهة حقيقية مرة واحدة، مربوطة بجهتها في كل مبادرة تشارك فيها، مع نشاطها في كل المبادرات. الربط للمتابعة فقط ولا يعطي أي صلاحية.', 'Each real body once, linked to its organization in every initiative it takes part in, with its activity everywhere. A link is for follow-up only and grants nothing.')}</p>
        </div>
      </div>
      {msg ? <Alert tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Alert> : null}

      <div className="pf-row" role="search">
        <div className="pf-field" style={{ minWidth: 220 }}><label htmlFor="bodies-q">{t('بحث', 'Search')}</label><input id="bodies-q" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder={t('اسم الجهة', 'Body name')} /></div>
        <div className="pf-field"><label htmlFor="bodies-kind">{t('النوع', 'Kind')}</label>
          <select id="bodies-kind" value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value })}><option value="">{t('الكل', 'All')}</option>{(d?.kinds ?? []).map((k) => <option key={k.key} value={k.key}>{isAr ? k.labelAr : k.labelEn}</option>)}</select></div>
        <div className="pf-field"><label htmlFor="bodies-initiative">{t('المبادرة', 'Initiative')}</label>
          <select id="bodies-initiative" value={filters.initiativeId} onChange={(e) => setFilters({ ...filters, initiativeId: e.target.value })}><option value="">{t('الكل', 'All')}</option>{(d?.initiatives ?? []).map((i) => <option key={i.id} value={i.id}>{isAr ? i.titleAr : i.titleEn}</option>)}</select></div>
        <div className="pf-field"><label htmlFor="bodies-status">{t('الحالة', 'Status')}</label>
          <select id="bodies-status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">{t('الكل', 'All')}</option><option value="active">{t('نشطة', 'Active')}</option><option value="inactive">{t('موقوفة', 'Inactive')}</option></select></div>
      </div>

      {!d ? <Loading /> : d.items.length === 0 ? <div className="pf-box pf-empty"><p>{t('لا توجد جهات مطابقة.', 'No matching bodies.')}</p></div> : (
        <div className="pf-table-wrap">
          <table className="pf-table" data-testid="bodies-table">
            <thead><tr><th>{t('الجهة', 'Body')}</th><th>{t('في المبادرات', 'In the initiatives')}</th><th>{t('العاملون', 'Staff')}</th><th>{t('القرارات', 'Decisions')}</th><th>{t('بانتظارها', 'Pending')}</th><th>{t('آخر نشاط', 'Last activity')}</th></tr></thead>
            <tbody>{d.items.map((b: PlatformBody) => (
              <tr key={b.id} data-body={b.id}>
                <td><a href={`#admin-body/${b.id}`}><b>{isAr ? b.nameAr : (b.nameEn || b.nameAr)}</b></a>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}><span className="pf-chip">{isAr ? b.kindLabelAr : b.kindLabelEn}</span>{!b.isActive ? <span className="pf-chip bad">{t('موقوفة', 'Inactive')}</span> : null}</div></td>
                <td>{b.links.length ? b.links.map((l) => (
                  <div key={l.initiativeId} style={{ marginBottom: 4 }}><span className="pf-chip">{isAr ? l.titleAr : l.titleEn}</span> {l.organization ? (isAr ? l.organization.nameAr : l.organization.nameEn || l.organization.nameAr) : <span className="pf-chip bad">{t('الجهة حُذفت من المبادرة', 'Removed from the initiative')}</span>}{l.organization && !l.organization.isActive ? <span className="pf-chip warn">{t('موقوفة في المبادرة', 'Inactive there')}</span> : null}</div>
                )) : <span className="pf-muted">{t('غير مربوطة بعد', 'Not linked yet')}</span>}</td>
                <ActivityCells a={b.totals} />
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {orgs && (orgs.suggestions.length || unlinked.length) ? (
        <div className="pf-box pf-gap" data-testid="unlinked-box">
          <h3>{t('جهات المبادرات غير المربوطة بالدليل', 'Initiative organizations not in the directory')}</h3>
          {orgs.suggestions.map((s) => (
            <div key={s.organizations.map((o) => `${o.initiativeId}:${o.organizationId}`).join('|')} className="pf-suggestion" data-testid="body-suggestion">
              <div><Sparkles size={15} style={{ verticalAlign: 'middle' }} /> <b>{s.nameAr}</b> — {t('نفس الجهة في', 'the same body in')} {s.organizations.map((o) => o.titleAr).join(' + ')}</div>
              {manage ? <button type="button" className="btn btn-primary btn-sm" onClick={() => void act(() => api.adminCreateBody({ nameAr: s.nameAr.replace(/\s*\([^)]*\)\s*/g, ' ').trim() || s.nameAr, nameEn: s.nameEn, kind: 'other', links: s.organizations.map((o) => ({ initiativeId: o.initiativeId, organizationId: o.organizationId })) }), t('أُضيفت الجهة ورُبطت بالمبادرتين.', 'The body was added and linked.'))}>{t('إضافة جهة واحدة وربطها', 'Add one body and link')}</button> : null}
            </div>
          ))}
          {unlinked.length ? (
            <div className="pf-table-wrap"><table className="pf-table">
              <thead><tr><th>{t('المبادرة', 'Initiative')}</th><th>{t('الجهة في المبادرة', 'Organization')}</th><th>{t('دورها', 'Role')}</th>{manage ? <th>{t('ربط', 'Link')}</th> : null}</tr></thead>
              <tbody>{unlinked.map((o) => {
                const key = `${o.initiativeId}:${o.organization.id}`;
                const candidates = allBodies.filter((b) => b.isActive && !b.links.some((l) => l.initiativeId === o.initiativeId));
                return (
                  <tr key={key} data-org={key}>
                    <td>{isAr ? o.titleAr : o.titleEn}</td>
                    <td>{isAr ? o.organization.nameAr : o.organization.nameEn || o.organization.nameAr}{!o.organization.isActive ? <span className="pf-chip warn">{t('موقوفة', 'Inactive')}</span> : null}</td>
                    <td className="pf-muted">{isAr ? o.organization.typeLabelAr : o.organization.typeLabelEn}</td>
                    {manage ? <td style={{ whiteSpace: 'nowrap' }}>
                      <select aria-label={t('اختر جهة من الدليل', 'Pick a body')} value={linkTo[key] ?? ''} onChange={(e) => setLinkTo({ ...linkTo, [key]: e.target.value })}>
                        <option value="">{t('— جهة موجودة —', '— existing body —')}</option>{candidates.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
                      </select>{' '}
                      <button type="button" className="btn btn-ghost btn-sm" disabled={!linkTo[key]} onClick={() => void act(() => api.adminLinkBody(linkTo[key], { initiativeId: o.initiativeId, organizationId: o.organization.id }), t('رُبطت الجهة.', 'Linked.'))}><Link2 size={14} /> {t('ربط', 'Link')}</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(() => api.adminCreateBody({ nameAr: o.organization.nameAr, nameEn: o.organization.nameEn, kind: 'other', links: [{ initiativeId: o.initiativeId, organizationId: o.organization.id }] }), t('أُضيفت جهة جديدة بهذا الاسم ورُبطت.', 'A new body with this name was added and linked.'))}><Plus size={14} /> {t('جهة جديدة منها', 'New body from it')}</button>
                    </td> : null}
                  </tr>
                );
              })}</tbody>
            </table></div>
          ) : null}
        </div>
      ) : null}

      {manage && d ? (
        <div className="pf-box pf-gap" data-testid="new-body">
          <h3><Plus size={16} style={{ verticalAlign: 'middle' }} /> {t('جهة جديدة', 'New body')}</h3>
          <BodyFields f={form} set={setForm} kinds={d.kinds} idPrefix="new-body" />
          <div className="pf-row">
            {d.initiatives.map((i) => {
              const options = unlinked.filter((o) => o.initiativeId === i.id);
              return (
                <div key={i.id} className="pf-field"><label htmlFor={`new-body-link-${i.id}`}>{t('جهتها في', 'Its organization in')} {isAr ? i.titleAr : i.titleEn}</label>
                  <select id={`new-body-link-${i.id}`} value={newLinks[i.id] ?? ''} onChange={(e) => setNewLinks({ ...newLinks, [i.id]: e.target.value })}>
                    <option value="">{t('— لا تشارك —', '— not involved —')}</option>{options.map((o) => <option key={o.organization.id} value={o.organization.id}>{o.organization.nameAr}</option>)}
                  </select></div>
              );
            })}
          </div>
          <div><button type="button" className="btn btn-primary" onClick={() => void act(
            () => api.adminCreateBody({ ...form, links: Object.entries(newLinks).filter(([, v]) => v).map(([initiativeId, organizationId]) => ({ initiativeId, organizationId })) }),
            t('أُضيفت الجهة إلى الدليل.', 'The body was added.'), () => { setForm(EMPTY_FORM); setNewLinks({}); },
          )}>{t('إضافة إلى الدليل', 'Add to the directory')}</button></div>
        </div>
      ) : null}
    </div>
  );
};

// ── one body ──────────────────────────────────────────────────────────────

export const AdminBody: React.FC = () => {
  const { t, isAr, me, param } = usePlatform();
  const manage = canManage(me);
  const [b, setB] = useState<PlatformBodyDetail | null>(null);
  const [orgs, setOrgs] = useState<BodyOrganizations | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [pick, setPick] = useState({ initiativeId: '', organizationId: '' });
  const [missing, setMissing] = useState(false);
  const load = useCallback(() => {
    if (!param) return;
    api.adminBody(param).then((x) => {
      setB(x);
      setForm({ nameAr: x.nameAr, nameEn: x.nameEn, kind: x.kind, description: x.description, contactEmail: x.contactEmail, contactPhone: x.contactPhone, website: x.website });
    }).catch((e) => { if ((e as { http?: number }).http === 404) setMissing(true); else setMsg({ ok: false, text: errText(e, isAr) }); });
    if (manage) api.adminBodyOrganizations().then(setOrgs).catch(() => undefined);
  }, [param, isAr, manage]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); after?.(); load(); } catch (e) { setMsg({ ok: false, text: errText(e, isAr) }); }
  };
  if (missing) return <div className="pf-gap"><Alert tone="err">{t('الجهة غير موجودة في الدليل (ربما حُذفت).', 'This body is not in the directory (it may have been deleted).')}</Alert><a href="#admin-bodies">{t('العودة إلى دليل الجهات', 'Back to the directory')}</a></div>;
  if (!b) return msg ? <Alert tone="err">{msg.text}</Alert> : <Loading />;
  const freeInitiatives = b.initiatives.filter((i) => !b.links.some((l) => l.initiativeId === i.id));
  const candidates = (orgs?.items ?? []).filter((o) => !o.body && o.initiativeId === pick.initiativeId);

  return (
    <div className="pf-gap" data-testid="body-detail">
      <a href="#admin-bodies">{t('→ دليل الجهات', '← Directory of bodies')}</a>
      <div className="pf-section-head">
        <div>
          <h2>{isAr ? b.nameAr : b.nameEn || b.nameAr}</h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><span className="pf-chip">{isAr ? b.kindLabelAr : b.kindLabelEn}</span><span className={`pf-chip ${b.isActive ? 'ok' : 'bad'}`}>{b.isActive ? t('نشطة', 'Active') : t('موقوفة', 'Inactive')}</span></div>
          {b.description ? <p className="pf-muted" style={{ marginTop: 6 }}>{b.description}</p> : null}
        </div>
      </div>
      {msg ? <Alert tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Alert> : null}

      <div className="pf-kpis">
        <div className="pf-kpi"><b>{num(b.totals.initiatives, isAr)}</b><span>{t('مبادرة تشارك فيها', 'Initiatives')}</span></div>
        <div className="pf-kpi"><b>{num(b.totals.staff, isAr)}</b><span>{t('من العاملين', 'Staff')}</span></div>
        <div className="pf-kpi"><b>{num(b.totals.decisions, isAr)}</b><span>{t('قرار', 'Decisions')}</span></div>
        <div className="pf-kpi"><b>{num(b.totals.pending, isAr)}</b><span>{t('طلب بانتظارها', 'Pending')}</span></div>
      </div>

      <div className="pf-box">
        <h3>{t('في كل مبادرة', 'In each initiative')}</h3>
        {b.links.length ? (
          <div className="pf-table-wrap"><table className="pf-table" data-testid="body-links">
            <thead><tr><th>{t('المبادرة', 'Initiative')}</th><th>{t('جهتها هناك', 'Its organization')}</th><th>{t('العاملون', 'Staff')}</th><th>{t('القرارات', 'Decisions')}</th><th>{t('بانتظارها', 'Pending')}</th><th>{t('آخر نشاط', 'Last activity')}</th>{manage ? <th /> : null}</tr></thead>
            <tbody>{b.links.map((l) => (
              <tr key={l.initiativeId} data-initiative={l.initiativeId}>
                <td>{isAr ? l.titleAr : l.titleEn}</td>
                <td>{l.organization ? <>{isAr ? l.organization.nameAr : l.organization.nameEn || l.organization.nameAr}<div className="pf-muted" style={{ fontSize: 12.5 }}>{isAr ? l.organization.typeLabelAr : l.organization.typeLabelEn}</div>{!l.organization.isActive ? <span className="pf-chip warn">{t('موقوفة في المبادرة', 'Inactive there')}</span> : null}</>
                  : <span className="pf-chip bad">{t('الجهة حُذفت من المبادرة', 'Removed from the initiative')}</span>}</td>
                <ActivityCells a={l.activity} />
                {manage ? <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (window.confirm(t(`فصل «${b.nameAr}» عن جهتها في ${l.titleAr}؟ لا يتغير شيء داخل المبادرة.`, `Unlink from ${l.titleEn}? Nothing changes inside the initiative.`))) void act(() => api.adminUnlinkBody(b.id, l.initiativeId), t('فُصل الربط.', 'Unlinked.')); }}><Unlink size={14} /> {t('فصل', 'Unlink')}</button></td> : null}
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="pf-muted">{t('غير مربوطة بأي مبادرة بعد.', 'Not linked to any initiative yet.')}</p>}
        {manage && b.isActive && freeInitiatives.length ? (
          <div className="pf-row" style={{ marginTop: 12 }} data-testid="link-form">
            <div className="pf-field"><label htmlFor="link-initiative">{t('ربط بجهة في مبادرة', 'Link an organization of')}</label>
              <select id="link-initiative" value={pick.initiativeId} onChange={(e) => setPick({ initiativeId: e.target.value, organizationId: '' })}><option value="">—</option>{freeInitiatives.map((i) => <option key={i.id} value={i.id}>{isAr ? i.titleAr : i.titleEn}</option>)}</select></div>
            <div className="pf-field"><label htmlFor="link-org">{t('الجهة', 'Organization')}</label>
              <select id="link-org" value={pick.organizationId} disabled={!pick.initiativeId} onChange={(e) => setPick({ ...pick, organizationId: e.target.value })}><option value="">—</option>{candidates.map((o) => <option key={o.organization.id} value={o.organization.id}>{o.organization.nameAr} — {o.organization.typeLabelAr}</option>)}</select></div>
            <div style={{ alignSelf: 'end' }}><button type="button" className="btn btn-primary" disabled={!pick.organizationId} onClick={() => void act(() => api.adminLinkBody(b.id, pick), t('رُبطت الجهة.', 'Linked.'), () => setPick({ initiativeId: '', organizationId: '' }))}><Link2 size={15} /> {t('ربط', 'Link')}</button></div>
          </div>
        ) : null}
      </div>

      <div className="pf-box">
        <h3>{t('العاملون في الجهة', 'Its people')}</h3>
        {b.people.length ? (
          <div className="pf-table-wrap"><table className="pf-table" data-testid="body-people">
            <thead><tr><th>{t('الاسم', 'Name')}</th><th>{t('المبادرة', 'Initiative')}</th><th>{t('الدور', 'Role')}</th><th>{t('الحالة', 'Status')}</th></tr></thead>
            <tbody>{b.people.map((p) => (
              <tr key={`${p.userId}:${p.initiativeId}`}>
                <td><b>{p.nameAr}</b><div className="pf-muted" dir="ltr" style={{ fontSize: 12.5 }}>{p.email}</div></td>
                <td>{p.titleAr}</td>
                <td>{isAr ? p.roleLabelAr : p.roleLabelEn}</td>
                <td><span className={`pf-chip ${p.isActive && p.status === 'active' ? 'ok' : 'bad'}`}>{p.isActive && p.status === 'active' ? t('نشط', 'Active') : t('موقوف', 'Inactive')}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="pf-muted">{t('لا يوجد عاملون مسجلون في جهاتها بالمبادرات.', 'No staff in its organizations yet.')}</p>}
        <p className="pf-muted" style={{ fontSize: 12.5, marginTop: 8 }}>{t('حسابات العاملين وصلاحياتهم تُدار من شاشات كل مبادرة؛ الدليل يعرضها فقط.', 'Staff accounts and their roles are managed in each initiative\'s screens; the directory only shows them.')}</p>
      </div>

      {manage ? (
        <div className="pf-box pf-gap" data-testid="edit-body">
          <h3>{t('بيانات الجهة', 'Body details')}</h3>
          <BodyFields f={form} set={setForm} kinds={b.kinds} idPrefix="edit-body" />
          <div className="pf-row">
            <button type="button" className="btn btn-primary" onClick={() => void act(() => api.adminUpdateBody(b.id, form), t('حُفظت بيانات الجهة.', 'Saved.'))}>{t('حفظ', 'Save')}</button>
            <button type="button" className="btn btn-ghost" onClick={() => void act(() => api.adminUpdateBody(b.id, { isActive: !b.isActive }), b.isActive ? t('أُوقفت الجهة.', 'Deactivated.') : t('فُعّلت الجهة.', 'Activated.'))}>{b.isActive ? t('إيقاف الجهة', 'Deactivate') : t('تفعيل الجهة', 'Activate')}</button>
            <button type="button" className="btn btn-ghost" disabled={b.links.length > 0} title={b.links.length ? t('افصل الروابط أولًا', 'Unlink first') : undefined}
              onClick={() => { if (window.confirm(t(`حذف «${b.nameAr}» من الدليل نهائيًا؟`, 'Delete this body from the directory?'))) void act(() => api.adminDeleteBody(b.id), t('حُذفت الجهة.', 'Deleted.'), () => { window.location.hash = '#admin-bodies'; }); }}>{t('حذف من الدليل', 'Delete')}</button>
          </div>
          {b.links.length ? <p className="pf-muted" style={{ fontSize: 12.5 }}>{t('لا تُحذف جهة مربوطة: افصل روابطها أولًا، أو أوقفها.', 'A linked body cannot be deleted: unlink it first, or deactivate it.')}</p> : null}
        </div>
      ) : null}
    </div>
  );
};
