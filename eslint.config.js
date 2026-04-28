import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/lib/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.config.{js,ts,mjs,cjs}',
      'fixtures/**',
      '.firebase/**',
      // Standalone Node ESM scripts run directly via `node script.mjs`.
      // They aren't part of any tsconfig and don't need typed linting.
      'scripts/**/*.mjs',
    ],
  },

  // Base JS rules
  js.configs.recommended,

  // TypeScript strict + type-checked
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        project: [
          './apps/web/tsconfig.app.json',
          './apps/web/tsconfig.node.json',
          './apps/functions/tsconfig.json',
          './apps/pdf-renderer/tsconfig.json',
          './packages/shared/tsconfig.json',
          './tsconfig.scripts.json',
        ],
        tsconfigRootDir: __dirname,
        ecmaFeatures: { jsx: true },
      },
    },
  },

  // React + a11y for the web app
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'react-refresh': reactRefreshPlugin,
      'jsx-a11y': jsxA11yPlugin,
    },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs['jsx-runtime'].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...jsxA11yPlugin.configs.recommended.rules,
      // react-refresh is a hot-reload DX hint, not a correctness rule.
      // Disabled because shadcn/ui patterns (variants alongside components,
      // hooks colocated with providers) trip it without real benefit.
      'react-refresh/only-export-components': 'off',
      // React Compiler-aware rule. We're not using the compiler yet; manual
      // memoization is the correct pattern, not something to flag.
      'react-hooks/preserve-manual-memoization': 'off',
      'react/prop-types': 'off',
    },
    settings: { react: { version: 'detect' } },
  },

  // Cloud Functions / Cloud Run / scripts: Node globals
  {
    files: [
      'apps/functions/**/*.ts',
      'apps/pdf-renderer/**/*.ts',
      'scripts/**/*.ts',
      'packages/shared/**/*.ts',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Prettier integration
  {
    plugins: { prettier: prettierPlugin },
    rules: {
      ...prettierConfig.rules,
      'prettier/prettier': 'warn',
    },
  },

  // Project-wide tweaks
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      // React event handlers idiomatically use `onClick={() => setX(v)}`
      // shorthand; setX returns void but the expression is clear.
      '@typescript-eslint/no-confusing-void-expression': 'off',
      // Subscription/form-sync hooks legitimately reset state in effects
      // when their inputs change; the React docs' "lift state up" advice
      // doesn't always apply (e.g., Firestore subscription paths).
      'react-hooks/set-state-in-effect': 'off',
    },
  },

  // Test files: unsafe-* rules are noisy on test fixtures because test
  // libraries (rules-unit-testing, vitest matchers) have intentionally loose
  // types. Real type safety still applies in production code.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
