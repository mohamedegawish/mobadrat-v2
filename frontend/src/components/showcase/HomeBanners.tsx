import React, { useEffect, useState } from 'react';
import { usePlatformStore } from '../../store/state';
import { resolveApiAssetUrl, type Banner } from '../../platform/api';
import { ChevronLeft, ChevronRight, ArrowLeft, ArrowRight, Sun, Factory, TrendingDown } from 'lucide-react';

type BannerPlacement = Banner['placement'];
type HomeBannerShape = Banner;

const ROTATE_MS = 6000;

export const DEFAULT_BANNERS: HomeBannerShape[] = [
  {
    id: 'banner-shams-default',
    imageUrl: '/covers/shams-banner-full.jpg',
    titleAr: 'شمس الصناعة',
    titleEn: 'Shams El-Senaa',
    subtitleAr: 'البرنامج القومي للطاقة الشمسية\nطاقة أنظف - صناعة أكثر تنافسية - مستقبل أكثر استدامة',
    subtitleEn: 'National Solar Program\nCleaner energy - More competitive industry - Sustainable future',
    ctaLabelAr: 'طاقة متجددة 100% | تخفيض تكاليف التشغيل',
    ctaLabelEn: '100% Renewable Energy | Reduced Operating Costs',
    linkType: 'initiative',
    linkTarget: 'shams',
    placement: 'before_steps',
    sortOrder: 1,
    active: true,
    startsAt: '',
    endsAt: '',
  },
];

type BannerContent = Pick<HomeBannerShape, 'imageUrl' | 'titleAr' | 'titleEn' | 'subtitleAr' | 'subtitleEn' | 'ctaLabelAr' | 'ctaLabelEn'>;

/** نص اللغة الحالية، ويرجع للغة الأخرى إن كان فارغاً. */
const pick = (isAr: boolean, ar: string, en: string) => (isAr ? ar || en : en || ar).trim();

export const bannerHasText = (b: BannerContent, isAr: boolean) =>
  Boolean(pick(isAr, b.titleAr, b.titleEn) || pick(isAr, b.subtitleAr, b.subtitleEn));

/** محتوى بانر واحد (صورة + نص + زر) — مشترك بين الصفحة الرئيسية ومعاينة الإدارة. */
export const BannerVisual: React.FC<{
  banner: BannerContent;
  isAr: boolean;
  showCta: boolean;
  eager?: boolean;
  /** الصورة لم تُحمَّل (رابط صفحة لا صورة، أو موقع يمنع التضمين) */
  onImageError?: () => void;
}> = ({ banner, isAr, showCta, eager, onImageError }) => {
  const title = pick(isAr, banner.titleAr, banner.titleEn);
  const sub = pick(isAr, banner.subtitleAr, banner.subtitleEn);
  const cta = pick(isAr, banner.ctaLabelAr, banner.ctaLabelEn);

  // إذا كانت الصورة هي البانر المصمم المكتمل مسبقاً، تُعرض مباشرة بدون تكرار النص
  const isFullGraphic = banner.imageUrl?.includes('shams-banner-full') && 
    (title === 'شمس الصناعة' || !title);

  // تحليل أسطر النص التوضيحي (العنوان الفرعي + الشعار)
  const subLines = sub.split('\n').map(l => l.trim()).filter(Boolean);

  // تحليل شارات المزايا المفصولة بـ | أو فاصلة
  const badges = cta.includes('|')
    ? cta.split('|').map(b => b.trim()).filter(Boolean)
    : (cta ? [cta] : []);

  return (
    <>
      {banner.imageUrl && (
        <img
          className="home-feature-img"
          src={resolveApiAssetUrl(banner.imageUrl)}
          alt={title || ''}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={e => { e.currentTarget.style.visibility = 'hidden'; onImageError?.(); }}
          onLoad={e => { e.currentTarget.style.visibility = ''; }}
        />
      )}
      {!isFullGraphic && (title || sub || badges.length > 0) && (
        <>
          <div className="home-feature-shade" aria-hidden style={{ '--shade-dir': isAr ? '270deg' : '90deg' } as React.CSSProperties} />
          <div className="home-feature-text shams-banner-content">
            {title && (
              <div className="shams-banner-title-row">
                <span className="shams-banner-logo" aria-hidden>
                  <Sun size={24} style={{ color: '#E5A93C' }} />
                  <Factory size={20} style={{ color: '#E5A93C' }} />
                </span>
                <strong className="home-feature-title shams-banner-title">{title}</strong>
              </div>
            )}
            {subLines.map((line, idx) => (
              <p key={idx} className={idx === 0 ? 'shams-sub-primary' : 'shams-sub-tagline'}>
                {line}
              </p>
            ))}
            {badges.length > 0 && (
              <div className="shams-banner-badges">
                {badges.map((b, idx) => (
                  <span key={idx} className="shams-banner-pill">
                    {idx === 0 ? <Sun size={13} style={{ color: '#38BDF8' }} /> : <TrendingDown size={13} style={{ color: '#38BDF8' }} />}
                    <span>{b}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
};

/**
 * HomeBanners — بانرات الإعلانات لمكان واحد في الصفحة الرئيسية (تُدار من «بانرات الرئيسية» في الإدارة).
 * تدعم سلايدر يتقلب تلقائياً مع إمكانية التنقل والتوقف عند المرور والتحويل عند النقر.
 */
export const HomeBanners: React.FC<{ placement: BannerPlacement }> = ({ placement }) => {
  const { language, homeBanners, initiatives, navigate } = usePlatformStore();
  const isAr = language === 'ar';
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  
  const userSlides = homeBanners.filter(b => b.placement === placement && !failed.has(b.id));
  const fallback = placement === 'before_steps' ? DEFAULT_BANNERS : [];
  const slides = userSlides.length > 0 ? userSlides : fallback;
  const count = slides.length;

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion] = useState(() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  });

  useEffect(() => {
    if (paused || reducedMotion || count <= 1) return;
    const t = window.setInterval(() => setIndex(i => (i + 1) % count), ROTATE_MS);
    return () => window.clearInterval(t);
  }, [paused, reducedMotion, count]);

  if (count === 0) return null;
  const active = index % count;

  const renderSlide = (b: HomeBannerShape, i: number) => {
    const isActive = i === active;
    const className = `home-feature-slide${isActive ? ' is-active' : ''}`;
    const toInitiative = b.linkType === 'initiative' && Boolean(b.linkTarget);
    const linked = b.linkType === 'url' || toInitiative;
    const content = (
      <BannerVisual banner={b} isAr={isAr} showCta={linked} eager={i === 0}
        onImageError={() => setFailed(prev => new Set(prev).add(b.id))} />
    );
    const label = bannerHasText(b, isAr) ? undefined : (isAr ? 'فتح الإعلان' : 'Open announcement');

    if (b.linkType === 'url') {
      return (
        <a key={b.id} className={className} aria-hidden={!isActive || undefined} aria-label={label}
          href={b.linkTarget} target="_blank" rel="noopener noreferrer">
          {content}
        </a>
      );
    }
    if (toInitiative) {
      return (
        <a key={b.id} className={className} aria-hidden={!isActive || undefined} aria-label={label}
          href="#initiative-detail"
          onClick={e => { e.preventDefault(); navigate('initiative-detail', b.linkTarget); }}>
          {content}
        </a>
      );
    }
    return <div key={b.id} className={className} aria-hidden={!isActive || undefined}>{content}</div>;
  };

  return (
    <section
      className="home-section"
      aria-label={isAr ? 'إعلانات' : 'Announcements'}
      aria-roledescription={count > 1 ? (isAr ? 'سلايدر إعلانات' : 'carousel') : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false); }}
    >
      <div className={`home-feature${slides.some(b => bannerHasText(b, isAr)) ? ' has-text' : ''}`}>
        {slides.map(renderSlide)}

        {count > 1 && (
          <div className="home-feature-controls">
            <button type="button" className="home-feature-nav" onClick={() => setIndex((active - 1 + count) % count)}
              aria-label={isAr ? 'الإعلان السابق' : 'Previous ad'}>
              {isAr ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
            {slides.map((b, i) => (
              <button key={b.id} type="button" className="home-feature-dot" onClick={() => setIndex(i)}
                aria-label={isAr ? `الإعلان ${i + 1}` : `Ad ${i + 1}`} aria-current={i === active} />
            ))}
            <button type="button" className="home-feature-nav" onClick={() => setIndex((active + 1) % count)}
              aria-label={isAr ? 'الإعلان التالي' : 'Next ad'}>
              {isAr ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
