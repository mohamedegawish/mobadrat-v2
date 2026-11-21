// Async-safety lint (npm run lint:async, together with scripts/check-async.mjs). The database API is Promise-based: these
// type-aware rules catch an un-awaited query, a Promise used as a condition, and an async function passed where a
// synchronous callback is expected. Only these rules are enabled — this is not a style linter.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'scripts/**', 'tests/**', 'src/**/tests/**', 'src/initiatives/*/e2eServer.ts', 'src/initiatives/*/_legacy/**'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false, attributes: false } }],
      '@typescript-eslint/await-thenable': 'error',
    },
  },
);
