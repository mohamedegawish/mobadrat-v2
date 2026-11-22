import React from 'react';
import { Badge } from './Badge';
import { useStore } from '../../store/state';
import type { ApplicationState } from '../../api';

/** اسم الحالة من السيرفر (meta) بلون موحد. */
export const StateBadge: React.FC<{ state: ApplicationState; labelAr?: string; labelEn?: string }> = ({ state, labelAr, labelEn }) => {
  const { isAr, meta } = useStore();
  const m = meta?.states?.find((s) => s.state === state);
  const label = isAr ? (labelAr ?? m?.labelAr ?? state) : (labelEn ?? m?.labelEn ?? state);
  return <Badge status={state}>{label}</Badge>;
};
