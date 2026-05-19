/**
 * 1stOne F1 — ESLint flat config (ESLint v9 — audit O7).
 *
 * ESLint v9 dropped the legacy `.eslintrc` format; with no `eslint.config.js`
 * present, `npm run lint` failed outright. This is the replacement flat
 * config. It lints the app source (src/**) only — Deno edge functions under
 * supabase/ run a different runtime/global set and are out of scope here.
 *
 * Type-aware linting is intentionally NOT enabled (no `parserOptions.project`)
 * — `tsc --noEmit` already owns type correctness in the verified-batch gate;
 * ESLint here covers the lint-only rules (hook deps, unused vars, etc.).
 */

const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const reactHooks = require('eslint-plugin-react-hooks');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'android/**',
      'ios/**',
      'dist/**',
      'coverage/**',
      'landing/**',
      'scripts/**',
      'supabase/**',
      '.expo/**',
      'eslint.config.js',
      'babel.config.js',
      'metro.config.js',
      'app.config.js',
      'jest.setup.js',
      'generate_audit.js',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2021,
        __DEV__: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // TypeScript itself catches undefined / redeclared identifiers; the
      // core rules misfire on TS syntax (types, overloads, enums).
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` is used deliberately at typed boundaries (Supabase row casts,
      // navigation props, error catches) — already silenced inline where it
      // matters. Keep it advisory, not build-breaking.
      '@typescript-eslint/no-explicit-any': 'warn',
      // require() is idiomatic in React Native (static asset resolution).
      '@typescript-eslint/no-require-imports': 'off',
      // Empty catch blocks are an intentional "best-effort, ignore failure".
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/__tests__/**'],
    languageOptions: { globals: { ...globals.jest } },
  },
];
