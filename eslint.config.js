import eslint from '@eslint/js';
import checkFile from 'eslint-plugin-check-file';
import importX from 'eslint-plugin-import-x';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const DOMAIN_FILES = [
  'src/math/**/*.ts',
  'src/world/**/*.ts',
  'src/flight/**/*.ts',
  'src/player/**/*.ts',
];

const DOMAIN_IMPORT_RESTRICTIONS = [
  'error',
  {
    paths: [
      {
        name: 'three',
        message:
          'Domain code must not import Three.js. Keep rendering and scene objects in render/.',
      },
      {
        name: 'three-mesh-bvh',
        message:
          'Domain code must not import mesh/BVH helpers. Keep geometry work in render/.',
      },
      {
        name: 'postprocessing',
        message: 'Domain code must not import postprocessing. Keep effects in render/.',
      },
      {
        name: '@dimforge/rapier3d',
        message:
          'Physics engine bindings belong in physics/ or app wiring — not in pure domain modules.',
      },
    ],
    patterns: [
      {
        group: ['**/render/**', '**/editor/**', '**/game/**'],
        message:
          'Domain code must not import render/, editor/, or game/. Presentation, dev tools, and play-loop orchestration stay at the edge.',
      },
    ],
  },
];

const DOMAIN_GLOBAL_RESTRICTIONS = [
  'error',
  {
    name: 'document',
    message: 'Domain code must not touch the DOM. Use render/, app/, or game/ for browser APIs.',
  },
  {
    name: 'window',
    message: 'Domain code must not touch the DOM. Use render/, app/, or game/ for browser APIs.',
  },
  {
    name: 'HTMLElement',
    message: 'Domain code must not reference DOM types. Use render/, app/, or game/ for UI.',
  },
];

/** Target SRP budget for factories and pure functions. */
const MAX_FN_LINES = {
  max: 120,
  skipBlankLines: true,
  skipComments: true,
};

/**
 * Temporary hard ceiling for editor/render UI factories. Target remains 120;
 * lower this toward 120 as megafunctions are split.
 */
const MAX_FN_LINES_EDITOR_RENDER = {
  max: 400,
  skipBlankLines: true,
  skipComments: true,
};

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-editor/**',
      'release/**',
      'target/**',
      'node_modules/**',
      'docs/**',
      '**/*.d.ts',
      'scripts/**/*.mjs',
      'vite.config.ts',
    ],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // Handled by TypeScript. Avoid false positives on .mjs scripts and build output.
      'no-undef': 'off',
    },
  },

  // Filename convention:
  // - *.ts  → kebab-case  (modules, hooks, utilities)
  // - *.tsx → PascalCase  (React UI), except Vite entry main.tsx
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.d.ts', 'src/**/main.tsx'],
    plugins: {
      'check-file': checkFile,
    },
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        {
          '**/*.tsx': 'PASCAL_CASE',
          '**/*.ts': 'KEBAB_CASE',
        },
        { ignoreMiddleExtensions: true },
      ],
    },
  },

  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: ['./tsconfig.json'],
        },
        node: {
          extensions: ['.js', '.ts', '.tsx', '.mjs'],
        },
      },
    },
  },

  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    plugins: {
      sonarjs,
      'import-x': importX,
    },
    rules: {
      // TypeScript owns undefined-name checking.

      // --- DRY ---
      'import-x/no-duplicates': 'error',
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/no-all-duplicated-branches': 'warn',
      'sonarjs/no-duplicate-string': ['warn', { threshold: 5 }],

      // --- SRP / complexity ---
      complexity: ['error', { max: 20 }],
      'max-depth': ['warn', { max: 4 }],
      'max-params': ['error', { max: 8 }],
      'max-lines-per-function': ['error', MAX_FN_LINES],
      'sonarjs/cognitive-complexity': ['error', 20],

      // --- SOLID (what ESLint can reasonably enforce) ---
      '@typescript-eslint/no-extraneous-class': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'import-x/no-cycle': ['warn', { maxDepth: 4 }],
      'class-methods-use-this': [
        'warn',
        {
          exceptMethods: [
            'canActivate',
            'canDeactivate',
            'transform',
            'intercept',
          ],
        },
      ],

      '@typescript-eslint/no-empty-function': [
        'warn',
        { allow: ['decoratedFunctions'] },
      ],
    },
  },

  // DDD: pure domain layers must stay free of presentation and platform APIs.
  {
    files: DOMAIN_FILES,
    rules: {
      'no-restricted-imports': DOMAIN_IMPORT_RESTRICTIONS,
      'no-restricted-globals': DOMAIN_GLOBAL_RESTRICTIONS,
      'max-lines-per-function': ['error', MAX_FN_LINES],
    },
  },

  // DDD: render reads domain state but should not depend on app orchestration
  // or the play-loop composition layer.
  {
    files: ['src/render/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/app/**'],
              message:
                'render/ must not import app/. Dependency flows app → game → render → domain.',
            },
            {
              group: ['**/game/**'],
              message:
                'render/ must not import game/. Dependency flows app → game → render → domain.',
            },
          ],
        },
      ],
      // Temporary debt ceiling — target remains MAX_FN_LINES (120).
      'max-lines-per-function': ['error', MAX_FN_LINES_EDITOR_RENDER],
    },
  },

  // Editor chrome / panel factories — same temporary ceiling as render/.
  {
    files: ['src/editor/**/*.{ts,tsx}'],
    rules: {
      'max-lines-per-function': ['error', MAX_FN_LINES_EDITOR_RENDER],
    },
  },

  // DDD + SRP: entry modules wire features; keep domain logic out of giant orchestrators.
  {
    files: ['src/app/**/*.ts', 'src/game-main.ts', 'src/editor-main.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 900, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': ['error', MAX_FN_LINES],
      'sonarjs/cognitive-complexity': ['warn', 20],
    },
  },

  // SRP: game/ hosts the play-loop composition split into feature modules.
  {
    files: ['src/game/**/*.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 900, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': ['error', MAX_FN_LINES],
      'sonarjs/cognitive-complexity': ['warn', 20],
    },
  },

  // Scripts and specs are utilities — lighter architectural enforcement.
  {
    files: ['scripts/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
      'max-lines-per-function': 'off',
      'sonarjs/cognitive-complexity': 'off',
      complexity: 'off',
    },
  },

  // Legacy CJS in a few tooling paths; prefer ESM in new code.
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },
);
