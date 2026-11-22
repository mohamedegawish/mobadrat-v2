import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * CSS isolation: the platform and every initiative module ship their own stylesheets (their own branding). Each stylesheet
 * is scoped to its wrapper element so they never leak into each other — and Vite never unloads a lazily loaded stylesheet,
 * so scoping is required, not cosmetic:
 *   src/styles/**                 → .platform-root
 *   src/initiatives/<id>/**       → .theme-<id>
 * `:root`, `html` and `body` rules become rules of the wrapper; `html[lang|dir]` qualifiers stay on <html>.
 */
function scopeOf(file: string): string | null {
  const f = file.replace(/\\/g, '/');
  const m = /\/src\/initiatives\/([a-z0-9_-]+)\//.exec(f);
  if (m) return `.theme-${m[1]}`;
  if (/\/src\/styles\//.test(f)) return '.platform-root';
  return null;
}

export function scopeSelector(prefix: string, selector: string): string {
  const s = selector.trim();
  if (!s || s.startsWith('@')) return selector;
  if (s === ':root' || s === 'html' || s === 'body' || s === 'html body' || s === ':root body' || s === '#root') return prefix;
  const html = /^html(\[[^\]]+\])+\s*/.exec(s);
  if (html) {
    const q = html[0].trim();
    const rest = s.slice(html[0].length);
    if (rest === '' || rest === 'body') return `${q} ${prefix}`;
    return `${q} ${prefix} ${rest.replace(/^body\s+/, '')}`;
  }
  if (/^(html|body)\s+/.test(s)) return `${prefix} ${s.replace(/^(html\s+)?body\s+|^html\s+/, '')}`;
  if (s.startsWith(prefix)) return s;
  return `${prefix} ${s}`;
}

interface CssRule { selectors: string[]; parent?: { type?: string; name?: string } }
interface CssRoot { source?: { input?: { file?: string } }; walkRules: (cb: (rule: CssRule) => void) => void }

const scopedCss = Object.assign(() => ({
  postcssPlugin: 'mobadrat-scoped-css',
  Once(root: CssRoot) {
    const scope = scopeOf(root.source?.input?.file ?? '');
    if (!scope) return;
    root.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name ?? '')) return;
      rule.selectors = rule.selectors.map((sel) => scopeSelector(scope, sel));
    });
  },
}), { postcss: true as const });

export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [scopedCss()] } },
  build: {
    rollupOptions: {
      output: { manualChunks: { xlsx: ['xlsx'] } },
    },
  },
  server: {
    port: 5173,
    open: false,
    host: true,
    // Development: the platform API on :5000 (same origin through the proxy, so the refresh cookie works).
    proxy: {
      '/api': { target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:5000', changeOrigin: true },
      '/health': { target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:5000', changeOrigin: true },
    },
  },
});
