import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { usePlatformStore } from '../../store/state';
import { EgyptianEagle } from '../common/EgyptianEagle';

/** Official Government Footer — مخفي في وضع الإدارة لتوفير المساحة */
export const Footer: React.FC = () => {
  const { language } = usePlatformStore();
  const isAr = language === 'ar';
  return (
    <footer style={{ background: '#070B14', color: '#94A3B8', padding: '2.5rem 0 1.5rem 0', position: 'relative', borderTop: '1px solid #1E293B' }}>
      {/* Top flag ribbon */}
      <div style={{ height: '4px', width: '100%', background: 'var(--egypt-flag-ribbon)' }} />
      <div style={{ padding: '1.25rem 0 1.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="container-custom">
          <div className="footer-brand-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: 'var(--radius-sm)', background: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <EgyptianEagle size={34} />
              </div>
              <div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#FFFFFF' }}>
                  {isAr ? 'بوابة مبادرات وزارة الصناعة' : 'Ministry of Industry Initiatives Portal'}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
                  {isAr ? 'وزارة الصناعة — جمهورية مصر العربية' : 'Ministry of Industry — Arab Republic of Egypt'}
                </div>
              </div>
            </div>

            <div className="footer-links-row" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.85rem', color: '#CBD5E1' }}>
                <span>{isAr ? 'هيئة التنمية الصناعية (IDA)' : 'IDA Authority'}</span>
                <span style={{ opacity: 0.3 }}>|</span>
                <span>{isAr ? 'مركز تحديث الصناعة (IMC)' : 'IMC Center'}</span>
                <span style={{ opacity: 0.3 }}>|</span>
                <span>{isAr ? 'القطاع المصرفي المصري' : 'Egyptian Banking Sector'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container-custom">
        <div className="footer-copyright-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#64748B', flexWrap: 'wrap', gap: '0.5rem', paddingTop: '1rem' }}>
          <div>
            © 2026 {isAr ? 'جميع الحقوق محفوظة لوزارة الصناعة المصرية.' : 'All rights reserved to the Egyptian Ministry of Industry.'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: '#94A3B8' }}>
            <ShieldCheck size={14} style={{ color: '#C8102E' }} />
            <span>{isAr ? 'جمهورية مصر العربية' : 'Arab Republic of Egypt'}</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
