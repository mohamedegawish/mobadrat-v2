import React, { useMemo, useState } from 'react';
import { usePlatformStore } from '../../store/state';
import { canEditContent } from '../../platform/store';
import { Search, Filter, Layers, Plus, Factory } from 'lucide-react';
import { InitiativeCard, publicInitiatives } from './InitiativeCard';

/**
 * InitiativesView — الكتالوج الخفيف: شبكة المبادرات فقط (بحث + تصنيف + بطاقات + مقاييس مختصرة).
 * بدون الهيرو (HeroSlider يبقى في صفحة العرض العام إن لزم، لا هنا).
 * زر «عرض الصفحة» ينقل لصفحة المبادرة المنفصلة عبر navigate('initiative-detail', id) بدل المودال.
 */
export const InitiativesView: React.FC = () => {
  const { initiatives, language, navigate, me } = usePlatformStore();
  const isAr = language === 'ar';
  const isAdmin = canEditContent(me);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Build categories dynamically from live initiatives data
  const categoryOptions = useMemo(() => {
    const categories = new Set<string>();
    initiatives.forEach(init => {
      if (init.category) categories.add(init.category);
      if (init.categoryEn) categories.add(init.categoryEn);
    });
    return [
      { v: 'ALL', ar: 'الكل', en: 'All' },
      ...Array.from(categories).map(cat => ({ v: cat, ar: cat, en: cat }))
    ];
  }, [initiatives]);

  const filteredInitiatives = publicInitiatives(initiatives).filter(init => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      init.titleAr.toLowerCase().includes(q) ||
      init.titleEn.toLowerCase().includes(q) ||
      init.taglineAr.toLowerCase().includes(q) ||
      init.taglineEn.toLowerCase().includes(q);
    const matchesCat = selectedCategory === 'ALL' || init.category === selectedCategory || init.categoryEn === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const metrics = useMemo(() => {
    const pub = publicInitiatives(initiatives);
    const active = pub.filter(i => i.status === 'active').length;
    const targetFactories = pub.reduce((s, i) => s + (i.impactMetrics?.targetFactories ?? 0), 0);
    return { active, targetFactories, total: pub.length };
  }, [initiatives]);

  return (
    <div className="container-custom" style={{ padding: '2rem 1.5rem 3rem 1.5rem' }}>
      {/* Trust / Metrics Bento — مختصر */}
      <section style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.85rem' }}>
          {[
            { icon: Layers, labelAr: 'مبادرات نشطة', labelEn: 'Active', value: String(metrics.active), subAr: `من ${metrics.total} مبادرة`, subEn: `of ${metrics.total}` },
            { icon: Factory, labelAr: 'مصانع مستهدفة', labelEn: 'Target Factories', value: metrics.targetFactories.toLocaleString(isAr ? 'ar-EG' : 'en-US'), subAr: 'حتى 2027', subEn: 'by 2027' },
          ].map(stat => (
            <div key={stat.labelEn} className="card metric-bento" style={{ padding: '0.95rem 1rem', display: 'flex', gap: '0.75rem', alignItems: 'center', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', background: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '12px', background: 'var(--egypt-red-soft)', border: '1px solid rgba(200,16,46,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--egypt-red)' }}>
                <stat.icon size={18} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>{isAr ? stat.labelAr : stat.labelEn}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', marginTop: '0.15rem' }}>
                  <span style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{stat.value}</span>
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-light)', marginTop: '0.1rem' }}>{isAr ? stat.subAr : stat.subEn}</div>
              </div>
            </div>
          ))}
        </div>
        <style>{`@media (max-width: 480px){ section div[style*="repeat(2"]{ grid-template-columns: 1fr !important; } }`}</style>
      </section>

      {/* Search & Filter */}
      <section style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-pill" style={{ flex: '1 1 420px', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.45rem 0.35rem 0.55rem', minHeight: '44px' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '9999px', background: 'var(--bg-muted)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--text-muted)' }}>
              <Search size={16} />
            </div>
            <input
              type="text"
              placeholder={isAr ? 'ابحث عن مبادرة — طاقة شمسية، تحديث، غزل، تمويل 5%...' : 'Search — solar, modernization, textiles, 5%...'}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: '0.88rem', fontWeight: 500, color: 'var(--text-main)', minWidth: 0 }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="btn btn-ghost" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', borderRadius: '9999px' }}>{isAr ? 'مسح' : 'Clear'}</button>
            )}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.70rem', fontWeight: 700, color: 'var(--gov-teal)', background: '#F0FDFA', border: '1px solid #CCFBF1', padding: '0.22rem 0.5rem', borderRadius: '9999px', flexShrink: 0 }}>
              <Layers size={11} /> {isAr ? `${filteredInitiatives.length} نتيجة` : `${filteredInitiatives.length} results`}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', padding: '0.45rem 0.7rem', borderRadius: '9999px' }}>
              <Filter size={14} /> {isAr ? 'التصنيف' : 'Category'}
            </span>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {categoryOptions.map(opt => {
                const active = selectedCategory === opt.v;
                return (
                  <button
                    key={opt.v}
                    onClick={() => setSelectedCategory(opt.v)}
                    style={{
                      padding: '0.42rem 0.75rem',
                      borderRadius: '9999px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      border: '1px solid',
                      cursor: 'pointer',
                      transition: 'all 0.18s cubic-bezier(0.16,1,0.3,1)',
                      background: active ? 'var(--egypt-red)' : 'var(--bg-surface)',
                      color: active ? '#fff' : 'var(--text-secondary)',
                      borderColor: active ? 'var(--egypt-red)' : 'var(--border-subtle)',
                      boxShadow: active ? '0 4px 14px rgba(200,16,46,0.14)' : 'none',
                    }}
                  >
                    {isAr ? opt.ar : opt.en}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.7rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {isAr ? 'التصفية لا تغيّر العدّاد العلوي — البحث بالنص والتصنيف فقط.' : 'Filter by text + category only.'}
          </span>
        </div>
      </section>

      {/* Initiatives Grid */}
      <section id="initiatives-grid">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em', margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ width: '3px', height: '20px', background: 'var(--egypt-red)', borderRadius: '9999px', display: 'inline-block', flexShrink: 0 }} />
              {isAr ? 'المبادرات المتاحة للتقديم' : 'Available Initiatives'}
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--egypt-red)', background: 'var(--egypt-red-soft)', border: '1px solid rgba(200,16,46,0.08)', padding: '0.18rem 0.5rem', borderRadius: '9999px' }}>{filteredInitiatives.length}</span>
            </h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0.35rem 0 0 0', lineHeight: 1.5 }}>
              {isAr ? 'اختر مبادرة لاستعراض صفحتها، فحص الأهلية، ثم التقديم الإلكتروني.' : 'Pick an initiative to open its page, check eligibility, then apply.'}
            </p>
          </div>
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => navigate('admin-catalog')} style={{ fontSize: '0.85rem', boxShadow: '0 4px 14px rgba(200,16,46,0.14)' }}>
              <Plus size={15} />
              <span>{isAr ? 'إنشاء مبادرة جديدة' : 'New Initiative'}</span>
            </button>
          )}
        </div>

        <div className="reveal-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 380px), 1fr))', gap: '1.15rem' }}>
          {filteredInitiatives.map(initiative => (
            <InitiativeCard key={initiative.id} initiative={initiative} />
          ))}
          {filteredInitiatives.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '2.5rem 1.25rem', gridColumn: '1 / -1', borderRadius: 'var(--radius-xl)' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '16px', background: 'var(--bg-muted)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem auto', color: 'var(--text-muted)' }}>
                <Search size={20} />
              </div>
              <p style={{ color: 'var(--text-main)', fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.35rem 0' }}>{isAr ? 'لا توجد نتائج مطابقة' : 'No matching results'}</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 1rem 0' }}>{isAr ? 'جرّب كلمات مختلفة أو غيّر التصنيف إلى "الكل".' : 'Try different keywords or switch category to All.'}</p>
              <button className="btn btn-secondary" style={{ borderRadius: '9999px' }} onClick={() => { setSearchQuery(''); setSelectedCategory('ALL'); }}>
                {isAr ? 'إعادة الضبط' : 'Reset'}
              </button>
            </div>
          )}
        </div>
      </section>

    </div>
  );
};
