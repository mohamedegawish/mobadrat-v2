import React, { useState } from 'react';
import { usePlatformStore, startApplication, applyStateOf } from '../../store/state';
import { Initiative, DEFAULT_CUSTOMIZATION } from '../../types';
import { resolveCoverUrl } from '../../platform/api';
import { canEditContent } from '../../platform/store';
import { ArrowLeft, ArrowRight, Edit3, LayoutGrid } from 'lucide-react';
import { PreEligibilityModal } from './PreEligibilityModal';
import { formatBillions } from '../../utils/format';

/** الحالات التي يراها الجمهور (الباك يخفي المسودة والمؤرشفة عن غير الإدارة). */
const PUBLIC_INITIATIVE_STATUSES = ['coming_soon', 'active', 'closed', 'completed'];

/** المبادرات المعروضة للجمهور، وشمس الصناعة أولاً دائماً. */
export const publicInitiatives = (initiatives: Initiative[]): Initiative[] =>
  initiatives
    .filter(init => PUBLIC_INITIATIVE_STATUSES.includes(init.status))
    .sort((a, b) => (a.id === 'shams' ? 0 : 1) - (b.id === 'shams' ? 0 : 1));

/**
 * InitiativeCard — بطاقة المبادرة (الكتالوج والصفحة الرئيسية): الغلاف + المختصر + أزرار التفاصيل / الأهلية / التقديم.
 * compact (الصفحة الرئيسية): زرّان فقط — التفاصيل والتقديم — بمسافات أوسع.
 * التقديم: مسجل في المبادرة → لوحتها · مسجل الدخول → خطوة التقديم · زائر → تسجيل الدخول ثم العودة.
 */
export const InitiativeCard: React.FC<{ initiative: Initiative; compact?: boolean }> = ({ initiative, compact = false }) => {
  const { language, navigate, me } = usePlatformStore();
  const isAr = language === 'ar';
  const isAdmin = canEditContent(me);
  const [showEligibility, setShowEligibility] = useState(false);
  const isComingSoon = initiative.status === 'coming_soon';
  const custom = { ...DEFAULT_CUSTOMIZATION, ...(initiative.customization || {}) };
  const applyState = applyStateOf(initiative, me);

  return (
    <>
      <div
        className="card card-interactive initiative-card"
        style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', borderRadius: 'var(--radius-lg)' }}
      >
        <div
          className="card-cover initiative-cover"
          style={{ height: '168px', position: 'relative', background: 'var(--egypt-black)', flexShrink: 0, overflow: 'hidden', cursor: 'pointer' }}
          onClick={() => navigate('initiative-detail', initiative.id)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('initiative-detail', initiative.id); } }}
          role="link"
          tabIndex={0}
          aria-label={isAr ? `فتح صفحة مبادرة ${initiative.titleAr}` : `Open ${initiative.titleEn} page`}
          title={isAr ? initiative.titleAr : initiative.titleEn}
        >
          <img
            src={resolveCoverUrl(initiative.coverImage)}
            alt={isAr ? initiative.titleAr : initiative.titleEn}
            loading="lazy"
            decoding="async"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(15,23,42,0.08) 0%, rgba(15,23,42,0.42) 82%)' }} />
          <div style={{ position: 'absolute', top: '0.75rem', right: isAr ? '0.75rem' : 'auto', left: isAr ? 'auto' : '0.75rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.01em', background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.8)', padding: '0.26rem 0.65rem', borderRadius: '9999px', color: '#0F172A', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
              {isAr ? initiative.category : initiative.categoryEn}
            </span>
          </div>
          {isComingSoon && (
            <div style={{ position: 'absolute', top: '0.75rem', left: isAr ? '0.75rem' : 'auto', right: isAr ? 'auto' : '0.75rem' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 750, color: '#92400E', background: 'rgba(255, 251, 235, 0.95)', backdropFilter: 'blur(8px)', border: '1px solid #FDE68A', borderRadius: '9999px', padding: '0.26rem 0.65rem', boxShadow: '0 2px 8px rgba(146,64,14,0.12)' }}>
                {isAr ? initiative.badgeTextAr : initiative.badgeTextEn}
              </span>
            </div>
          )}
          <div style={{ position: 'absolute', bottom: '0.75rem', right: isAr ? '0.75rem' : 'auto', left: isAr ? 'auto' : '0.75rem', display: 'flex', alignItems: 'end', gap: '0.6rem' }}>
            {initiative.budgetTotalEGP > 0 && (
            <div style={{ color: '#fff' }}>
              <div style={{ fontSize: '0.66rem', fontWeight: 700, opacity: 0.9, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{isAr ? 'المخصصات' : 'Allocation'}</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums', textShadow: '0 1px 10px rgba(0,0,0,0.22)' }}>
                {formatBillions(initiative.budgetTotalEGP, isAr)} <span style={{ fontSize: '0.72rem', fontWeight: 700, opacity: 0.92 }}>{isAr ? 'مليار ج.م' : 'B EGP'}</span>
              </div>
            </div>
            )}
            {(initiative.impactMetrics?.targetFactories ?? 0) > 0 && (
            <span style={{ fontSize: '0.66rem', fontWeight: 700, background: 'rgba(255,255,255,0.14)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.22)', color: '#fff', padding: '0.22rem 0.45rem', borderRadius: '9999px' }}>
              {isAr ? `${(initiative.impactMetrics?.targetFactories ?? 0).toLocaleString('ar-EG')} مصنع مستهدف` : `${(initiative.impactMetrics?.targetFactories ?? 0).toLocaleString('en-US')} factories`}
            </span>
            )}
          </div>
        </div>

        <div style={{ padding: compact ? '1.35rem' : '1.1rem 1.15rem 1rem 1.15rem', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <h3
            style={{ fontSize: '1.02rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.35, margin: 0, letterSpacing: '-0.015em', cursor: 'pointer' }}
            onClick={() => navigate('initiative-detail', initiative.id)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('initiative-detail', initiative.id); } }}
            role="link"
            tabIndex={0}
            title={isAr ? initiative.titleAr : initiative.titleEn}
          >
            {isAr ? initiative.titleAr : initiative.titleEn}
          </h3>
          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.65, margin: '0.45rem 0 0 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: '2.7em' }}>
            {isAr ? initiative.taglineAr : initiative.taglineEn}
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? '0.45rem' : '0.32rem', marginTop: compact ? '1rem' : '0.75rem', marginBottom: compact ? '1.25rem' : 0 }}>
            {((initiative.targetSectors ?? []).slice(0, 3)).map((sec, i) => (
              <span key={i} style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', fontSize: '0.70rem', fontWeight: 600, padding: '0.22rem 0.5rem', borderRadius: '9999px', border: '1px solid var(--border-subtle)', maxWidth: '14ch', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {sec}
              </span>
            ))}
            {(initiative.targetSectors ?? []).length > 3 && (
              <span style={{ fontSize: '0.70rem', fontWeight: 700, color: 'var(--text-muted)', alignSelf: 'center', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', padding: '0.18rem 0.45rem', borderRadius: '9999px' }}>
                +{(initiative.targetSectors ?? []).length - 3}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: compact ? '0.75rem' : '0.45rem', borderTop: '1px solid var(--border-subtle)', paddingTop: compact ? '1.15rem' : '0.85rem', marginTop: compact ? 'auto' : '0.9rem' }}>
            <button className="btn btn-secondary" style={{ flex: 1, padding: '0.55rem 0.7rem', minHeight: compact ? '44px' : undefined, fontSize: '0.82rem', borderRadius: '9999px' }} onClick={e => { e.stopPropagation(); navigate('initiative-detail', initiative.id); }}>
              <LayoutGrid size={14} />
              <span>{compact ? (isAr ? 'التفاصيل' : 'Details') : (isAr ? 'عرض الصفحة' : 'View Page')}</span>
            </button>
            {!compact && custom.enablePreEligibility && (
              <button className="btn btn-outline" style={{ padding: '0.55rem 0.7rem', fontSize: '0.82rem', borderRadius: '9999px' }} onClick={e => { e.stopPropagation(); setShowEligibility(true); }} title={isAr ? 'فحص الأهلية' : 'Quiz'}>
                <span>{isAr ? 'الأهلية' : 'Quiz'}</span>
              </button>
            )}
            <button
              className="btn btn-primary"
              style={{ flex: compact ? 1 : 1.15, padding: '0.55rem 0.85rem', minHeight: compact ? '44px' : undefined, fontSize: '0.82rem', borderRadius: '9999px' }}
              onClick={e => { e.stopPropagation(); startApplication(initiative.id); }}
              disabled={isComingSoon || applyState === 'closed' || applyState === 'info'}
            >
              <span>{applyState === 'member' ? (isAr ? 'لوحة المبادرة' : 'Dashboard') : (isAr ? 'التقديم' : 'Apply')}</span>
              <span className="btn-arrow">{isAr ? <ArrowLeft size={13} /> : <ArrowRight size={13} />}</span>
            </button>
          </div>

          {!compact && isAdmin && (
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.55rem' }}>
              {/* الإدارة الكاملة (تعديل/حالة/نسخ/حذف/تحليلات) في مساحة المبادرة بالأدمن */}
              <button className="btn btn-secondary" style={{ flex: 1, fontSize: '0.78rem', padding: '0.42rem', borderRadius: '9999px' }} onClick={() => navigate('admin-catalog')}>
                <Edit3 size={12} />
                <span>{isAr ? 'إدارة' : 'Manage'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {showEligibility && (
        <PreEligibilityModal
          initiative={initiative}
          onClose={() => setShowEligibility(false)}
          onProceedToApply={() => startApplication(initiative.id)}
        />
      )}
    </>
  );
};
