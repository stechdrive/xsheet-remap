import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-ts/**',
      '**/node_modules/**',
      '**/.pytest_cache/**',
      '**/__pycache__/**',
      'apps/web/public/ocr/ort/**',
      '.tmp/**',
      'apps/desktop/src-tauri/target/**',
      'apps/sheet-corrector/src-tauri/target/**',
      'apps/sheet-corrector/src-tauri/gen/**',
      'reference-local/**',
      'release-local/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'vite.config.ts', 'vitest.config.ts', 'tools/**/*.ts', 'tools/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
)
