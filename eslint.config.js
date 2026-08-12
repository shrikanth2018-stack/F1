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

      // ── The theme mandate, enforced ────────────────────────────────
      //
      // `src/theme/index.ts` opens with "MANDATE: Zero hardcoded values" and
      // `ThemedText` with "All text MUST use this component". Both were
      // written as COMMENTS, and both have been quietly violated for months —
      // including on WalletScreen, which carries seven hardcoded numbers.
      // A comment cannot fail a build, so the mandate never had teeth.
      //
      // ERROR, and it earned that. These landed at `warn` on 12 Aug 2026
      // against 72 violations, which were then burned down to ZERO — 16
      // colour call sites and 14 font sizes — before this was flipped.
      // `check.yml` runs lint as a real gate where errors fail, so from here
      // a hardcoded colour or font size cannot reach main at all.
      //
      // One severity covers all five selectors, which is why the flip waited
      // for every category to reach zero rather than ratcheting one at a
      // time. If a future category is added with a backlog, add it as a
      // SECOND rule entry at `warn` rather than dropping this one back —
      // reopening a closed ratchet gives the whole thing back.
      //
      // What is deliberately NOT restricted: bare numbers for padding,
      // margin, width and height. Those are layout facts, not design tokens —
      // a control that is 40pt because it is 40pt is better named by a local
      // constant with a reason beside it than by a theme entry nothing else
      // shares. The mandate is about values that must MOVE TOGETHER when the
      // design changes: colour, the type scale, leading, radii.
      'no-restricted-syntax': [
        'error',
        {
          // Colour written into a style object. The one that is always wrong:
          // a literal cannot follow a retheme, ever.
          //
          // MATCHED BY PATTERN, NOT BY A LIST. The first version of this rule
          // enumerated seventeen property names and still missed six that the
          // app actually uses — textShadowColor, labelColor, textColor,
          // bgColor, lightColor, accentColor — so it reported zero while
          // `textShadowColor: 'rgba(0,0,0,0.85)'` and an Android notification
          // `lightColor: '#38bdf8'` sat in the tree untouched. A hand-kept
          // list of a platform's property names is a list that is already out
          // of date. Anything ending in `Color`, plus bare `background`.
          selector:
            "Property[key.name=/([Cc]olor|^background)$/] > Literal[value=/^(#|rgba?\\()/]",
          message:
            'Hardcoded colour. Use Theme.colors.* — a literal will not follow a retheme.',
        },
        {
          // Same, written as a JSX prop. Matched on the VALUE, not the prop
          // name: `color="muted"` is ThemedText's semantic palette and is
          // correct — there are 1,296 of those and none of them is a defect.
          selector:
            "JSXAttribute[name.name=/[Cc]olor$/] > Literal[value=/^(#|rgba?\\()/]",
          message:
            'Hardcoded colour. Use Theme.colors.* (ThemedText\'s color="muted" style names are fine).',
        },
        {
          // A literal only. `Theme.typography.sizes.body` is a MemberExpression
          // and `sizes.body + 2` a BinaryExpression — neither matches, so
          // deriving from the scale stays allowed.
          selector: "Property[key.name='fontSize'] > Literal",
          message: 'Hardcoded font size. Use Theme.typography.sizes.*.',
        },
        {
          selector: "Property[key.name='fontFamily'] > Literal",
          message: 'Hardcoded font family. Use Theme.typography.fontFamily.',
        },
        {
          // Emphasis is size and colour, never weight — see the note on
          // typography.emphasisStep. Currently zero occurrences; this keeps it
          // that way.
          selector: "Property[key.name='fontWeight'] > Literal[value='bold']",
          message:
            'No bold anywhere. Emphasis is size + colour — see Theme.typography.emphasisStep.',
        },
      ],
    },
  },
  {
    // The theme is where the literals are SUPPOSED to live. Restricting it
    // here would be restricting the definition of the thing being enforced.
    files: ['src/theme/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // ── The map components — a DELIBERATE exemption ─────────────────
    //
    // 44 of the 72 violations the mandate found on the day it was switched
    // on — 61% — live in these four files. Exempted by an explicit owner
    // decision (12 Aug 2026) rather than fixed.
    //
    // WHY IT IS DEFENSIBLE. The `.tsx` pair are the WEB variants: they render
    // `@react-google-maps/api` through raw DOM `<div style={{…}}>`, not React
    // Native StyleSheet, and most of their colour is a Google Maps dark-style
    // array — a third-party data format with its own colour vocabulary that
    // does not correspond to the app palette. `fillColor` on a zone polygon
    // is map-domain styling in the same way. These are also the least-seen
    // surfaces in the app: admin only, and the two heaviest are web only.
    //
    // WHAT THIS EXEMPTION IS NOT. It is not a claim that every literal in
    // here is correct. Some of it is ordinary chrome that merely sits on a
    // map — a search box at `rgba(26,26,26,0.9)`, `color: '#fff'`,
    // `fontSize: 14` — and those would be theme values anywhere else in the
    // app. The honest description is: a scope decision, taken so the burn-down
    // spends its effort on the 28 violations across the surfaces customers
    // and staff actually look at.
    //
    // THE COST, stated plainly: these four files can now drift further
    // without anything saying so. Re-check them by hand whenever the palette
    // changes — the rest of the app will follow a retheme and these will not.
    //
    // TO UNDO: delete this block. Nothing else depends on it.
    files: [
      'src/components/ZoneMap.tsx',
      'src/components/ZoneMap.native.tsx',
      'src/components/PinMap.tsx',
      'src/components/PinMap.native.tsx',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/__tests__/**'],
    languageOptions: { globals: { ...globals.jest } },
    // A fixture is DATA, not chrome. `bannerStyle.test.ts` builds rows shaped
    // like the `banners` table, whose `bg_color` column holds whatever colour
    // an admin picked — a literal there is the point of the test, and routing
    // it through the theme would be asserting against our own palette instead
    // of against the value the database will actually hand us.
    rules: { 'no-restricted-syntax': 'off' },
  },
];
