import React, { useEffect, useState } from 'react';
import { apiFetchBlob } from '../../api/client';

/**
 * شعار مقدم الخدمة. الصورة تُجلب بالتوكن (لا يمكن لـ<img> إرسال Authorization) ثم تُعرض عبر object URL.
 * المفتاح هو logoUrl نفسه (يحمل بصمة الملف) فيتجدد الشعار عند استبداله ولا يُجلب مرتين في الجلسة.
 */
const cache = new Map<string, Promise<string>>();

function load(logoUrl: string): Promise<string> {
  let p = cache.get(logoUrl);
  if (!p) {
    const [path, qs = ''] = logoUrl.split('?');
    const v = new URLSearchParams(qs).get('v') ?? '';
    p = apiFetchBlob(path, v ? { v } : {}).then((b) => URL.createObjectURL(b));
    p.catch(() => cache.delete(logoUrl));
    cache.set(logoUrl, p);
  }
  return p;
}

export const ProviderLogo: React.FC<{ logoUrl: string | null | undefined; name: string; size?: number }> = ({ logoUrl, name, size = 48 }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (logoUrl) load(logoUrl).then((u) => { if (alive) setSrc(u); }).catch(() => { /* يبقى الحرف الأول */ });
    return () => { alive = false; };
  }, [logoUrl]);
  const box: React.CSSProperties = { width: size, height: size, borderRadius: 8, border: '1px solid var(--border, #E2E8F0)', background: '#fff', flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' };
  if (src) return <span style={box}><img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} data-testid="provider-logo" /></span>;
  return <span style={{ ...box, color: 'var(--text-secondary, #64748B)', fontWeight: 700, fontSize: size * 0.4 }} aria-hidden>{name.trim().charAt(0)}</span>;
};
