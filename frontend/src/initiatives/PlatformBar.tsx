/**
 * The thin platform strip shown above every initiative module: back to the platform, the initiative chooser, and the
 * language follows the platform. Styled inline so it is independent of both the platform and the module stylesheets.
 */
import React from 'react';

export const PlatformBar: React.FC<{ titleAr: string; titleEn: string }> = ({ titleAr, titleEn }) => {
  const isAr = document.documentElement.lang !== 'en';
  const link: React.CSSProperties = { color: '#fff', textDecoration: 'none', fontWeight: 600, opacity: 0.92 };
  return (
    <div dir={isAr ? 'rtl' : 'ltr'} style={{ background: '#0B2545', color: '#fff', fontSize: 13, fontFamily: "'IBM Plex Sans Arabic', Tahoma, sans-serif" }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '6px 16px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <a href="#home" style={link}>{isAr ? '← المنصة الوطنية للمبادرات الصناعية' : '← National Industrial Initiatives Platform'}</a>
        <span style={{ opacity: 0.6 }}>|</span>
        <a href="#hub" style={link}>{isAr ? 'مبادراتي' : 'My initiatives'}</a>
        <span style={{ marginInlineStart: 'auto', opacity: 0.75 }}>{isAr ? titleAr : titleEn}</span>
      </div>
    </div>
  );
};
