import React from 'react';
import { useStore } from '../../store/state';

/** I9: قناة الاستفسار الرسمية (SUPPORT_EMAIL / SUPPORT_PHONE من السيرفر) — لا تُعرض إن لم تُضبط. */
export const SupportContact: React.FC<{ prefixAr?: string; prefixEn?: string }> = ({ prefixAr = 'للاستفسار:', prefixEn = 'Questions:' }) => {
  const { isAr, meta } = useStore();
  const s = meta?.support;
  if (!s || (!s.email && !s.phone)) return null;
  return (
    <span data-testid="support-contact">
      {isAr ? prefixAr : prefixEn}{' '}
      {s.email ? <a href={`mailto:${s.email}`} dir="ltr">{s.email}</a> : null}
      {s.email && s.phone ? ' — ' : null}
      {s.phone ? <a href={`tel:${s.phone.replace(/\s+/g, '')}`} dir="ltr">{s.phone}</a> : null}
    </span>
  );
};
