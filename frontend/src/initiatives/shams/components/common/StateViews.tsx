import React from 'react';
import { AlertTriangle, Inbox, Lock } from 'lucide-react';
import { SkeletonCard, SkeletonTable } from './SkeletonLoader';
import { useStore } from '../../store/state';

/** حالات التحميل والفراغ والخطأ الموحدة لكل شاشة. */
export const Loading: React.FC<{ variant?: 'cards' | 'table' }> = ({ variant = 'cards' }) => (
  <div aria-busy="true" aria-live="polite">{variant === 'table' ? <SkeletonTable rows={6} /> : <SkeletonCard count={3} />}</div>
);

export const Empty: React.FC<{ title: string; hint?: React.ReactNode; action?: React.ReactNode }> = ({ title, hint, action }) => (
  <div className="state-box">
    <Inbox size={36} aria-hidden />
    <div className="state-box-title">{title}</div>
    {hint ? <div style={{ fontSize: '0.85rem' }}>{hint}</div> : null}
    {action}
  </div>
);

/** M4: طلب غير متاح لهذا الحساب (404/403) — رسالة واضحة دون «إعادة المحاولة». */
export const NotAvailable: React.FC = () => {
  const { t, user, store } = useStore();
  return (
    <div className="state-box" role="alert" data-testid="not-available">
      <Lock size={36} aria-hidden />
      <div className="state-box-title">{t('هذا الطلب غير متاح لحسابك', 'This application is not available to your account')}</div>
      <div style={{ fontSize: '0.85rem' }}>{t('قد يكون الرابط لطلب جهة أخرى، أو لم يصل الطلب لمرحلتك بعد.', 'The link may belong to another organization, or the application has not reached your stage yet.')}</div>
      {user ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => store.goHome()}>{t('الصفحة الرئيسية لدورك', 'Go to your home page')}</button> : null}
    </div>
  );
};

export const ErrorState: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => {
  const { t } = useStore();
  return (
    <div className="state-box" role="alert">
      <AlertTriangle size={36} aria-hidden style={{ color: 'var(--status-rejected)' }} />
      <div className="state-box-title">{t('تعذر تحميل البيانات', 'Could not load data')}</div>
      <div style={{ fontSize: '0.85rem' }}>{message}</div>
      {onRetry ? <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>{t('إعادة المحاولة', 'Retry')}</button> : null}
    </div>
  );
};
