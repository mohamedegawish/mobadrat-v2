/**
 * The ONE page shell shared by the platform and every initiative module: an initiative's screens render inside the
 * platform's header and footer, so the shell owns what both sides need to agree on:
 *  - the language (the platform header switches it; every module follows);
 *  - the workspace mode (a module showing a staff workspace asks for the compact header and no footer).
 */
export type ShellLang = 'ar' | 'en';

const LANG_KEY = 'mobadrat_lang_v2';
const langListeners = new Set<(l: ShellLang) => void>();

export function getShellLang(): ShellLang {
  try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ar'; } catch { return 'ar'; }
}

/** Sets the page language for the platform and every module (persisted; <html lang/dir> follows). */
export function setShellLang(l: ShellLang): void {
  try { localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ }
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  langListeners.forEach((fn) => fn(l));
}

export function onShellLang(fn: (l: ShellLang) => void): () => void {
  langListeners.add(fn);
  return () => { langListeners.delete(fn); };
}

let workspace = false;
const workspaceListeners = new Set<() => void>();

/** A module tells the shell it shows a staff workspace (compact header, no footer) or a normal page. */
export function setShellWorkspace(on: boolean): void {
  if (on === workspace) return;
  workspace = on;
  workspaceListeners.forEach((fn) => fn());
}
export function getShellWorkspace(): boolean { return workspace; }
export function onShellWorkspace(fn: () => void): () => void {
  workspaceListeners.add(fn);
  return () => { workspaceListeners.delete(fn); };
}
