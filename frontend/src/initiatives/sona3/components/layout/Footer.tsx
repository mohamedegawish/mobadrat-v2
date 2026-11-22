import React from 'react';
import { useStore } from '../../store/state';
import { useSiteContent } from '../../content/siteContent';
import { SupportContact } from '../common/SupportContact';

export const Footer: React.FC = () => {
  const { isAr, meta } = useStore();
  const { siteName, ministry, footerRights } = useSiteContent();
  return (
    <footer className="site-footer">
      <div className="container-custom" style={{ padding: '0 1rem' }}>
        <div className="site-footer-grid">
          <div className="row">
            <img src="/sona3/logo.jpeg" alt="" height={34} style={{ borderRadius: 8 }} />
            <div>
              <div style={{ fontWeight: 800 }}>{isAr ? `مبادرة ${siteName.ar}` : `${siteName.en} Initiative`}</div>
              <small>{isAr ? ministry.ar : ministry.en}</small>
            </div>
          </div>
          <small>
            <SupportContact />
            {meta?.support.email || meta?.support.phone ? <br /> : null}
            © {new Date().getFullYear()} {isAr ? footerRights.ar : footerRights.en}
          </small>
        </div>
      </div>
    </footer>
  );
};
