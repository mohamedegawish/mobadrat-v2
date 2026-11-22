import React from 'react';
import { useStore } from '../../store/state';
import { useSiteContent, type Bi } from '../../content/siteContent';

const TextPage: React.FC<{ title: string; items: Bi[] }> = ({ title, items }) => {
  const { isAr, t } = useStore();
  return (
    <div className="container-custom page">
      <h1>{title}</h1>
      <div className="card sec prose">
        {items.length ? items.map((p, i) => <p key={i}>{isAr ? p.ar : p.en}</p>) : <p className="hint">{t('لم يُضف محتوى لهذه الصفحة بعد.', 'No content has been added to this page yet.')}</p>}
      </div>
    </div>
  );
};

export const AboutView: React.FC = () => { const { t } = useStore(); return <TextPage title={t('عن المبادرة', 'About the initiative')} items={useSiteContent().about} />; };
export const ContactView: React.FC = () => { const { t } = useStore(); return <TextPage title={t('تواصل معنا', 'Contact us')} items={useSiteContent().contact} />; };
export const TermsView: React.FC = () => { const { t } = useStore(); return <TextPage title={t('الشروط والأحكام', 'Terms & conditions')} items={useSiteContent().terms} />; };

export const FaqView: React.FC = () => {
  const { isAr, t } = useStore();
  const { faq } = useSiteContent();
  return (
    <div className="container-custom page">
      <h1>{t('الأسئلة الشائعة', 'Frequently asked questions')}</h1>
      {faq.length ? faq.map((f, i) => (
        <details key={i} className="card sec faq-item">
          <summary>{isAr ? f.q.ar : f.q.en}</summary>
          <p>{isAr ? f.a.ar : f.a.en}</p>
        </details>
      )) : <div className="card sec"><p className="hint">{t('لم تُضف أسئلة بعد.', 'No questions have been added yet.')}</p></div>}
    </div>
  );
};
