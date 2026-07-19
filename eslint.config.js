'use strict';

const globals = require('globals');

/** Configuración plana de ESLint 9. */
module.exports = [
  {
    ignores: ['node_modules/**', 'logs/**', 'coverage/**'],
  },

  // Backend: CommonJS sobre Node
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': 'off',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      curly: ['error', 'multi-line'],
      'no-throw-literal': 'error',
      'prefer-promise-reject-errors': 'error',
      'no-return-await': 'error',
      'require-atomic-updates': 'off',
    },
  },

  // Frontend: ES modules sobre navegador
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      // El frontend no debe volver a construir HTML con datos scrapeados
      'no-restricted-properties': [
        'error',
        {
          property: 'innerHTML',
          message: 'Usa textContent o los helpers de dom.js: innerHTML reintroduce el XSS.',
        },
        {
          property: 'outerHTML',
          message: 'Usa los helpers de dom.js en vez de outerHTML.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'event', message: 'Usa el parámetro del handler.' },
      ],
    },
  },

  // Tests
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
];
