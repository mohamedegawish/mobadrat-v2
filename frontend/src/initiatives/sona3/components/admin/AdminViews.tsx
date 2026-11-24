/* eslint-disable @typescript-eslint/no-explicit-any */
// شاشات الأدمن: الجاهزية، الدورات والأوزان، الحسابات، الجهات، التدقيق، الربط، الإشعارات.
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { apiFetch } from '../../api/client';
import { errorText, useStore } from '../../store/state';
import { Loading, ErrorState } from '../common/StateViews';
import { useToast } from '../common/ToastSystem';
import { Pill } from '../common/FormKit';

const V1 = '/api/v1';
function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const { isAr } = useStore();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { fn().then((d) => { setData(d); setError(''); }).catch((e) => setError(errorText(e, isAr))); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  return { data, error, load };
}
const Wrap: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => <div className="container-custom page"><h1>{title}</h1>{children}</div>;

export const AdminDashboardView: React.FC = () => {
  const { t, isAr } = useStore();
  const { data, error, load } = useLoad(() => api.adminReadiness() as Promise<any>);
  return (
    <Wrap title={t('جاهزية التشغيل', 'Operational readiness')}>
      {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Loading /> : (
        <>
          <p><Pill kind={data.ok ? 'ok' : 'bad'}>{data.ok ? t('جاهز', 'Ready') : t('يحتاج إجراء', 'Needs action')}</Pill></p>
          {data.checks.map((c: any) => (
            <div key={c.key} className={`card sec ${c.ok ? 'ok' : 'warn'}`}>
              <b>{c.ok ? '✔' : '✘'} {isAr ? c.labelAr : c.labelEn}</b>
              <div>{isAr ? c.detailAr : c.detailEn}</div>
              {c.items?.length ? <ul>{c.items.map((i: any) => <li key={i.id}>{isAr ? i.labelAr : i.labelEn} {isAr ? i.extraAr : i.extraEn}</li>)}</ul> : null}
            </div>
          ))}
        </>
      )}
    </Wrap>
  );
};

export const CohortsView: React.FC = () => {
  const { t, isAr, meta } = useStore();
  const toast = useToast();
  const { data, error, load } = useLoad(() => apiFetch<any>(`${V1}/admin/cohorts`).then((r) => r.data.items as any[]));
  const criteria: any[] = (meta as any)?.criteria ?? [];
  const [f, setF] = useState<any>({ evaluationTarget: 500, selectionTarget: 300, maxAge: 40 });
  const [w, setW] = useState<Record<string, Record<string, number>>>({});
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); load(); toast.toast('success', t('تم الحفظ', 'Saved')); } catch (e) { toast.toast('error', errorText(e, isAr)); } };
  const create = () => run(() => apiFetch(`${V1}/admin/cohorts`, { method: 'POST', body: { ...f, evaluationTarget: Number(f.evaluationTarget), selectionTarget: Number(f.selectionTarget), maxAge: Number(f.maxAge) } }));
  const input = (k: string, label: string, type = 'text') => <div className="fld"><label>{label}</label><input className="input" type={type} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>;
  return (
    <Wrap title={t('دورات التقديم وأوزان التقييم', 'Cohorts & weights')}>
      <div className="card sec"><h3>{t('دورة جديدة', 'New cohort')}</h3>
        <div className="grid2">{input('nameAr', t('الاسم', 'Name'))}{input('opensAt', t('بداية التقديم', 'Opens'), 'date')}{input('closesAt', t('نهاية التقديم', 'Closes'), 'date')}
          {input('evaluationTarget', t('مستهدف التقييم', 'Evaluation target'), 'number')}{input('selectionTarget', t('مستهدف الاختيار', 'Selection target'), 'number')}{input('maxAge', t('الحد الأقصى للسن', 'Max age'), 'number')}</div>
        <button className="btn btn-primary" onClick={create}>{t('إنشاء', 'Create')}</button></div>
      {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Loading /> : data.map((c) => {
        const cur = w[c.id] ?? c.weights;
        const sum = criteria.reduce((s, k) => s + (Number(cur[k.key]) || 0), 0);
        return (
          <div key={c.id} className="card sec">
            <h3>{c.nameAr} <Pill>{c.status}</Pill></h3>
            <p>{c.opensAt} → {c.closesAt} · {t('اختيار', 'select')} {c.selectionTarget}/{c.evaluationTarget} · {t('سن ≤', 'age ≤')} {c.maxAge}</p>
            <div className="grid2">{criteria.map((k) => (
              <div key={k.key} className="fld"><label>{isAr ? k.labelAr : k.labelEn}</label>
                <input className="input" type="number" dir="ltr" disabled={c.weightsLocked} value={cur[k.key] ?? 0} onChange={(e) => setW({ ...w, [c.id]: { ...cur, [k.key]: Number(e.target.value) } })} /></div>
            ))}</div>
            <p>{t('المجموع', 'Total')}: <b className={sum === 100 ? '' : 'err'}>{sum}</b> {c.weightsLocked ? <Pill kind="neutral">{t('مقفلة — بدأ التقييم', 'locked — scoring started')}</Pill> : null}</p>
            {!c.weightsLocked ? <button className="btn btn-primary" disabled={sum !== 100} onClick={() => run(() => apiFetch(`${V1}/admin/cohorts/${c.id}/weights`, { method: 'PUT', body: { weights: cur } }))}>{t('حفظ الأوزان', 'Save weights')}</button> : null}
          </div>
        );
      })}
    </Wrap>
  );
};

/** قائمة عامة للقراءة: أعمدة تُستخرج تلقائيًا من أول صف. */
const GenericList: React.FC<{ title: string; path: string; pick?: (r: any) => any[] }> = ({ title, path, pick }) => {
  const { data, error, load } = useLoad(() => apiFetch<any>(`${V1}${path}`).then((r) => { const d = r.data; return (pick ? pick(d) : d.items ?? d) as any[]; }), [path]);
  const cols = data?.length ? Object.keys(data[0]).filter((k) => typeof data[0][k] !== 'object' && !/hash|password/i.test(k)).slice(0, 8) : [];
  return (
    <Wrap title={title}>
      {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Loading variant="table" /> : (
        <div className="tbl-wrap"><table className="tbl"><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{data.map((r, i) => <tr key={r.id ?? i}>{cols.map((c) => <td key={c}>{String(r[c] ?? '')}</td>)}</tr>)}</tbody></table></div>
      )}
    </Wrap>
  );
};

export const AccountsView: React.FC = () => {
  const { t, isAr } = useStore();
  const toast = useToast();
  const { data, error, load } = useLoad(() => api.adminUsers({}));
  const { data: orgs } = useLoad(() => api.adminOrganizations());
  const [f, setF] = useState<any>({ role: 'evaluator' });
  const roles = ['imc_officer', 'evaluator', 'funder_reviewer', 'system_admin'];
  const create = async () => {
    try { const r: any = await api.adminCreateUser(f); window.alert(`${t('كلمة المرور المؤقتة', 'Temporary password')}: ${r.temporaryPassword}`); setF({ role: 'evaluator' }); load(); } catch (e) { toast.toast('error', errorText(e, isAr)); }
  };
  const orgOf = (role: string) => (orgs ?? []).filter((o: any) => ({ imc_officer: 'imc', evaluator: 'committee', funder_reviewer: 'funder', system_admin: 'admin' } as any)[role] === o.type);
  return (
    <Wrap title={t('الحسابات', 'Accounts')}>
      <div className="card sec grid2">
        <input className="input" placeholder={t('الاسم', 'Name')} value={f.nameAr ?? ''} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
        <input className="input" placeholder="email" dir="ltr" value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value, organizationId: '' })}>{roles.map((r) => <option key={r}>{r}</option>)}</select>
        <select className="input" value={f.organizationId ?? ''} onChange={(e) => setF({ ...f, organizationId: e.target.value })}><option value="">{t('الجهة', 'Organization')}</option>{orgOf(f.role).map((o: any) => <option key={o.id} value={o.id}>{o.nameAr}</option>)}</select>
        <button className="btn btn-primary" onClick={create}>{t('إنشاء حساب', 'Create account')}</button>
      </div>
      {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Loading variant="table" /> : (
        <div className="tbl-wrap"><table className="tbl"><tbody>{data.items.map((u: any) => <tr key={u.id}><td>{u.nameAr}</td><td dir="ltr">{u.email}</td><td>{u.role}</td><td>{u.isActive ? '✔' : '✘'}</td></tr>)}</tbody></table></div>
      )}
    </Wrap>
  );
};

export const OrganizationsView: React.FC = () => {
  const { t, isAr } = useStore();
  const toast = useToast();
  const { data, error, load } = useLoad(() => api.adminOrganizations());
  const [f, setF] = useState<any>({});
  const add = async () => { try { await apiFetch(`${V1}/admin/organizations`, { method: 'POST', body: { type: 'funder', nameAr: f.nameAr, nameEn: f.nameEn || f.nameAr, contactEmail: f.contactEmail } }); setF({}); load(); } catch (e) { toast.toast('error', errorText(e, isAr)); } };
  return (
    <Wrap title={t('الجهات (التمويل واللجان)', 'Organizations')}>
      <div className="card sec grid2">
        <input className="input" placeholder={t('اسم جهة تمويل', 'Funder name')} value={f.nameAr ?? ''} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
        <input className="input" placeholder="email" dir="ltr" value={f.contactEmail ?? ''} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} />
        <button className="btn btn-primary" onClick={add}>{t('إضافة جهة تمويل', 'Add funder')}</button>
      </div>
      {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Loading variant="table" /> : (
        <div className="tbl-wrap"><table className="tbl"><tbody>{data.map((o: any) => <tr key={o.id}><td>{o.nameAr}</td><td>{o.type}</td><td>{o.isActive ? '✔' : '✘'}</td></tr>)}</tbody></table></div>
      )}
    </Wrap>
  );
};

export const AuditView: React.FC = () => <GenericList title="Audit" path="/admin/audit-logs?pageSize=100" />;
export const IntegrationView: React.FC = () => <GenericList title="API keys" path="/admin/integration-keys" />;
export const OutboxView: React.FC = () => <GenericList title="Notifications" path="/admin/notifications?pageSize=100" />;
