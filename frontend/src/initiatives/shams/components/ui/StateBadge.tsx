import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Badge } from './Badge';
import { useStore } from '../../store/state';
import type { ApplicationState } from '../../api';

/** اسم الحالة من السيرفر (meta) بلون موحد. */
export const StateBadge: React.FC<{ state: ApplicationState; labelAr?: string; labelEn?: string }> = ({ state, labelAr, labelEn }) => {
  const { isAr, meta } = useStore();
  const m = meta?.states.find((s) => s.state === state);
  const label = isAr ? (labelAr ?? m?.labelAr ?? state) : (labelEn ?? m?.labelEn ?? state);
  // الحالات النهائية بمؤشر لا يعتمد على اللون وحده: ✓ للتعاقد، ✗ لعدم التعاقد/الرفض النهائي.
  const iconStyle = { verticalAlign: '-2px', marginInlineEnd: 3 } as const;
  const icon = state === 'CONTRACTED' ? <CheckCircle2 size={12} aria-hidden="true" style={iconStyle} />
    : state === 'CLOSED_NOT_CONTRACTED' || state === 'REJECTED' ? <XCircle size={12} aria-hidden="true" style={iconStyle} /> : null;
  return <Badge status={state}>{icon}{label}</Badge>;
};
