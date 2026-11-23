/**
 * The initiative's bar under the platform header: where you are (المبادرات › the initiative), your role in it, the
 * initiative's own tabs and its notification bell. The platform header, footer, account menu and language switch are the
 * platform's — an initiative is a section of the one platform, not a second site. Styled by the platform stylesheet
 * (.ini-bar in styles/platform.css), so it looks the same in every initiative.
 */
import React from 'react';
import { ChevronLeft, ChevronRight, Globe } from 'lucide-react';
import { setShellLang } from '../core/shell';

export interface InitiativeBarItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  /** A platform route (e.g. «#initiative/shams») or the module's own navigation. */
  href?: string;
  onClick?: () => void;
}

export const InitiativeBar: React.FC<{
  isAr: boolean;
  slug: string;
  titleAr: string;
  titleEn: string;
  icon?: React.ReactNode;
  roleLabel?: string;
  items: InitiativeBarItem[];
  /** Extra controls at the end of the bar (the initiative's notification bell). */
  extra?: React.ReactNode;
  /** A staff workspace: the compact header hides its top strip, so the language switch is offered here. */
  workspace?: boolean;
}> = ({ isAr, slug, titleAr, titleEn, icon, roleLabel, items, extra, workspace }) => {
  const Sep = isAr ? ChevronLeft : ChevronRight;
  return (
    <div className="ini-bar" data-testid="initiative-bar">
      <div className="container-custom ini-bar-row">
        <nav className="ini-crumbs" aria-label={isAr ? 'مسار التنقل' : 'Breadcrumb'}>
          <a href="#initiatives">{isAr ? 'المبادرات' : 'Initiatives'}</a>
          <Sep size={14} aria-hidden />
          <a href={`#initiative/${slug}`} className="ini-crumb-title">{icon}{isAr ? titleAr : titleEn}</a>
          {roleLabel ? <span className="ini-role">{roleLabel}</span> : null}
        </nav>
        <div className="ini-tabs" role="navigation" aria-label={isAr ? `أقسام ${titleAr}` : `${titleEn} sections`}>
          {items.map((it) => (
            it.href
              ? <a key={it.key} href={it.href} className={`ini-tab${it.active ? ' active' : ''}`} aria-current={it.active ? 'page' : undefined}>{it.icon}{it.label}</a>
              : <button key={it.key} type="button" className={`ini-tab${it.active ? ' active' : ''}`} aria-current={it.active ? 'page' : undefined} onClick={it.onClick}>{it.icon}{it.label}</button>
          ))}
          {extra}
          {workspace ? (
            <button type="button" className="ini-tab" onClick={() => setShellLang(isAr ? 'en' : 'ar')} aria-label={isAr ? 'تبديل اللغة إلى الإنجليزية' : 'Switch language to Arabic'}>
              <Globe size={15} />{isAr ? 'English' : 'العربية'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
