import React from 'react';
import { useStore } from '../../store/state';
import { EgyptianEagle } from '../common/EgyptianEagle';
import { SITE_NAME, MINISTRY } from '../../content/shams';

export const Footer: React.FC = () => {
  const { isAr, t } = useStore();
  return (
    <footer className="site-footer">
      <div className="container-custom" style={{ padding: '0 1rem' }}>
        <div className="site-footer-grid">
          <div className="row footer-brand">
            {/* نفس شعاري الهيدر بألوانهما الأصلية على بلاطة بيضاء — الفلتر الأبيض كان يحوّل النسر إلى ظل مصمت بلا تفاصيل */}
            <span className="footer-emblem"><img src="/ministry-industry-logo.png" alt={t('شعار وزارة الصناعة', 'Ministry of Industry logo')} width={40} height={40} /></span>
            <span className="footer-emblem"><EgyptianEagle size={28} /></span>
            <span className="footer-emblem is-mark"><img src="/imc-logo.png" alt={t('شعار مركز تحديث الصناعة (IMC)', 'Industrial Modernisation Centre (IMC) logo')} width={44} height={44} /></span>
            <div>
              <div style={{ fontWeight: 800 }}>{isAr ? `مبادرة ${SITE_NAME.ar}` : `${SITE_NAME.en} Initiative`}</div>
              <small>{isAr ? MINISTRY.ar : MINISTRY.en}</small>
            </div>
          </div>
          <small>
            © {new Date().getFullYear()} {t('وزارة الصناعة — جميع الحقوق محفوظة', 'Ministry of Industry — All rights reserved')}
          </small>
        </div>
      </div>
    </footer>
  );
};
